import { Router }       from "express";
import jwt              from "jsonwebtoken";
import { randomUUID }   from "crypto";
import { readFileSync }  from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { run, get, all } from "../db.js";
import * as BE           from "../lib/battleEngine.js";

const router = Router();
const __dir  = dirname(fileURLToPath(import.meta.url));

// Données Pokémon (validées côté serveur) — Gen 1+2 + Gen 3+4
const GEN12_POKEMON = JSON.parse(readFileSync(join(__dir, "../gen1_2.json"), "utf-8"));
const GEN34_PATH    = join(__dir, "../../html/data/gen3_4.json");
const GEN34_POKEMON = (() => { try { return JSON.parse(readFileSync(GEN34_PATH, "utf-8")); } catch { return []; } })();
const ALL_POKEMON   = [...GEN12_POKEMON, ...GEN34_POKEMON];
const POKEMON_MAP   = Object.fromEntries(ALL_POKEMON.map(p => [p.nom || p.name, p]));

// Arènes valides pour le vote
const VALID_ARENAS = [
  "pierre","ondine","bob","erika","koga","morgane","auguste",
  "albert","hector","blanche","mortimer","chuck","jasmine","fredo","sandra",
];

// ── In-memory state ───────────────────────────────────────────────────────────
// queue: { mode → Map<username, socketId> }
const queues = { "3v3": new Map(), "6v6": new Map() };

// matches: matchId → { id, mode, p1, p2, state, team1, team2,
//                      arenaVote1, arenaVote2, arena,
//                      battleState, pendingActions,
//                      actionTimer, reconnectTimers: {p1, p2},
//                      disconnected: Set<'p1'|'p2'> }
const matches = new Map();

// playerToMatch: username → matchId
const playerToMatch = new Map();

// socketToUser: socketId → username (versus-specific, set on join_queue)
const socketToUser = new Map();

// Points ladder
const POINTS = { win: 20, loss: -10, forfeit: -15, win_by_forfeit: 10 };
const RECONNECT_MS      = 90_000;  // 90s pour se reconnecter
const ACTION_TIMEOUT_MS = 30_000;  // 30s pour soumettre une action
const TEAM_TIMEOUT_MS   = 60_000;  // 60s pour construire l'équipe
const ARENA_TIMEOUT_MS  = 30_000;  // 30s pour voter l'arène

// ── Helpers ───────────────────────────────────────────────────────────────────

function verifySocketToken(token) {
  try { return jwt.verify(token, process.env.JWT_SECRET); }
  catch { return null; }
}

async function getUserId(username) {
  const row = await get("SELECT id FROM users WHERE username=?", [username]);
  return row?.id || null;
}

async function getLadderTable(mode) {
  return mode === "3v3" ? "versus_ladder_3v3" : "versus_ladder_6v6";
}

async function ensureLadderRow(username, mode) {
  const t = await getLadderTable(mode);
  await run(`INSERT OR IGNORE INTO ${t} (username) VALUES (?)`, [username]);
}

async function applyLadderPoints(username, mode, delta, isWin) {
  await ensureLadderRow(username, mode);
  const t = await getLadderTable(mode);
  const col = isWin ? "wins" : "losses";
  await run(
    `UPDATE ${t} SET points=MAX(0,points+?), ${col}=${col}+1 WHERE username=?`,
    [delta, username]
  );
}

function broadcastQueueUpdate(io, mode) {
  const players = [...queues[mode].keys()];
  io.emit("versus:queue_update", { players, mode });
}

function getMatchPlayer(match, username) {
  return match.p1 === username ? "p1" : match.p2 === username ? "p2" : null;
}

function getOpponent(match, username) {
  return match.p1 === username ? match.p2 : match.p1;
}

function getOpponentSocketId(io, match, username) {
  const opp = getOpponent(match, username);
  return queues[match.mode]?.get(opp) || socketToUser.get(opp);
}

function emitToMatch(io, match, event, data) {
  const s1 = socketToUser.get(match.p1);
  const s2 = socketToUser.get(match.p2);
  if (s1) io.to(s1).emit(event, data);
  if (s2) io.to(s2).emit(event, data);
}

function emitToPlayer(io, username, event, data) {
  const sid = socketToUser.get(username);
  if (sid) io.to(sid).emit(event, data);
}

async function saveMatchToDB(match) {
  await run(
    `INSERT OR REPLACE INTO versus_matches
     (id,mode,player1,player2,state,team1_json,team2_json,arena_vote1,arena_vote2,arena,battle_json,winner,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
    [
      match.id, match.mode, match.p1, match.p2, match.state,
      JSON.stringify(match.team1 || []),
      JSON.stringify(match.team2 || []),
      match.arenaVote1 || null,
      match.arenaVote2 || null,
      match.arena || null,
      JSON.stringify(match.battleState || {}),
      match.winner || null,
    ]
  );
}

// ── Team validation ───────────────────────────────────────────────────────────

async function validateTeam(username, pokemonNames, mode) {
  const size = mode === "3v3" ? 3 : 6;
  if (!Array.isArray(pokemonNames) || pokemonNames.length !== size) {
    return { ok: false, error: `Équipe de ${size} Pokémon requise` };
  }
  const userId = await getUserId(username);
  if (!userId) return { ok: false, error: "Utilisateur introuvable" };

  for (const entry of pokemonNames) {
    const { name, isShiny } = entry;
    if (!POKEMON_MAP[name]) return { ok: false, error: `Pokémon inconnu : ${name}` };
    const owned = await get(
      "SELECT id FROM captures WHERE user_id=? AND pokemon_name=? AND is_shiny=?",
      [userId, name, isShiny ? 1 : 0]
    );
    if (!owned) return { ok: false, error: `Vous ne possédez pas ${isShiny?"✦":""}${name}` };
  }

  // Construire le tableau d'objets avec stats (depuis gen1_2.json) + shiny bonus
  const team = pokemonNames.map(({ name, isShiny }) => {
    const base = { ...POKEMON_MAP[name] };
    if (isShiny) {
      base.imgAnim = base.gif_shiny  || base.imgShiny || base.img;
      base.imgBack = base.gif_shiny_back || base.gif_normal_back || base.img;
      base.img     = base.imgShiny      || base.img;
      base.hp     = Math.round((base.hp     || 45) * 1.05);
      base.atk    = Math.round((base.atk    || 50) * 1.05);
      base.def    = Math.round((base.def    || 50) * 1.05);
      base.sp_atk = Math.round((base.sp_atk || 50) * 1.05);
      base.sp_def = Math.round((base.sp_def || 50) * 1.05);
      base.speed  = Math.round((base.speed  || 50) * 1.05);
      base.isShiny = true;
    } else {
      base.imgAnim = base.gif_normal || base.img;
      base.imgBack = base.gif_normal_back || base.img;
    }
    return base;
  });

  return { ok: true, team };
}

// ── Match lifecycle ───────────────────────────────────────────────────────────

function startTeamBuildingPhase(io, match) {
  match.state = "team_building";
  const deadline = Date.now() + TEAM_TIMEOUT_MS;
  emitToMatch(io, match, "versus:phase", {
    phase: "team_building", deadline, mode: match.mode,
    opponent: { p1: match.p2, p2: match.p1 },
  });
  // Timeout : équipe auto si un joueur ne soumet pas
  match.teamTimer = setTimeout(() => handleTeamTimeout(io, match.id), TEAM_TIMEOUT_MS);
  saveMatchToDB(match);
}

async function handleTeamTimeout(io, matchId) {
  const match = matches.get(matchId);
  if (!match || match.state !== "team_building") return;

  // Forfait pour ceux qui n'ont pas soumis d'équipe
  if (!match.team1 && !match.team2) {
    endMatch(io, match, null, "no_teams");
    return;
  }
  if (!match.team1) { endMatch(io, match, match.p2, "timeout"); return; }
  if (!match.team2) { endMatch(io, match, match.p1, "timeout"); return; }
}

function startArenaVotePhase(io, match) {
  match.state = "arena_vote";
  const deadline = Date.now() + ARENA_TIMEOUT_MS;
  emitToMatch(io, match, "versus:phase", { phase: "arena_vote", deadline });
  match.arenaTimer = setTimeout(() => handleArenaVoteTimeout(io, match.id), ARENA_TIMEOUT_MS);
  saveMatchToDB(match);
}

function handleArenaVoteTimeout(io, matchId) {
  const match = matches.get(matchId);
  if (!match || match.state !== "arena_vote") return;
  resolveArenaVote(io, match);
}

function resolveArenaVote(io, match) {
  if (match.arenaTimer) { clearTimeout(match.arenaTimer); match.arenaTimer = null; }
  const v1 = match.arenaVote1, v2 = match.arenaVote2;
  const candidates = [v1, v2].filter(Boolean);
  match.arena = candidates.length > 0
    ? candidates[Math.floor(Math.random() * candidates.length)]
    : VALID_ARENAS[Math.floor(Math.random() * VALID_ARENAS.length)];
  startBattlePhase(io, match);
}

function startBattlePhase(io, match) {
  match.state   = "battle";
  match.battleState  = BE.initBattleState(match.team1, match.team2);
  match.pendingActions = { p1: null, p2: null };

  emitToMatch(io, match, "versus:phase", {
    phase: "battle",
    arena: match.arena,
    team1: match.team1.map(p => ({ name: BE.pokeName(p), img: p.imgAnim || p.gif_normal || p.img, imgBack: p.imgBack || p.gif_normal_back || p.img, isShiny: !!p.isShiny })),
    team2: match.team2.map(p => ({ name: BE.pokeName(p), img: p.imgAnim || p.gif_normal || p.img, imgBack: p.imgBack || p.gif_normal_back || p.img, isShiny: !!p.isShiny })),
  });
  saveMatchToDB(match);
  startActionTimer(io, match);
}

function startActionTimer(io, match) {
  if (match.actionTimer) clearTimeout(match.actionTimer);
  const deadline = Date.now() + ACTION_TIMEOUT_MS;
  emitToMatch(io, match, "versus:turn_start", {
    state: publicBattleState(match),
    deadline,
  });
  match.actionTimer = setTimeout(() => resolveActionTimeout(io, match.id), ACTION_TIMEOUT_MS);
}

function resolveActionTimeout(io, matchId) {
  const match = matches.get(matchId);
  if (!match || match.state !== "battle") return;

  // Auto-action pour les joueurs AFK
  const { p1, p2 } = match.pendingActions;
  const actions = {
    p1: p1 || BE.autoAction(match.team1[match.battleState.p1Active]),
    p2: p2 || BE.autoAction(match.team2[match.battleState.p2Active]),
  };
  executeTurn(io, match, actions);
}

function executeTurn(io, match, actions) {
  if (match.actionTimer) { clearTimeout(match.actionTimer); match.actionTimer = null; }
  match.pendingActions = { p1: null, p2: null };

  const prevState = match.battleState;

  // p1First est calculé une seule fois dans resolveTurn pour éviter toute discordance
  // entre la résolution réelle et les données d'animation envoyées au client.
  const { newState, logs, secondKoedByFirst, p1First } = BE.resolveTurn(
    match.battleState, match.team1, match.team2, actions,
    { p1: match.p1, p2: match.p2 }
  );
  match.battleState = newState;

  // Données d'animation pour le frontend
  // Si le pokemon du second attaquant était KO avant son tour, on supprime son animation
  const secondAtk = p1First
    ? (secondKoedByFirst ? null : (actions.p2?.type === "attack" ? { atkType: actions.p2.atkType, useSpecial: !!actions.p2.useSpecial } : null))
    : (secondKoedByFirst ? null : (actions.p1?.type === "attack" ? { atkType: actions.p1.atkType, useSpecial: !!actions.p1.useSpecial } : null));

  const anim = {
    first:  p1First ? "p1" : "p2",
    p1Atk:  p1First
      ? (actions.p1?.type === "attack" ? { atkType: actions.p1.atkType, useSpecial: !!actions.p1.useSpecial } : null)
      : secondAtk,
    p2Atk:  p1First
      ? secondAtk
      : (actions.p2?.type === "attack" ? { atkType: actions.p2.atkType, useSpecial: !!actions.p2.useSpecial } : null),
    p1Ko:   prevState.p1HP[prevState.p1Active] > 0 && newState.p1HP[prevState.p1Active] <= 0,
    p2Ko:   prevState.p2HP[prevState.p2Active] > 0 && newState.p2HP[prevState.p2Active] <= 0,
  };

  emitToMatch(io, match, "versus:turn_result", {
    state: publicBattleState(match),
    logs, anim,
  });

  if (newState.winner) {
    const winner = newState.winner === "p1" ? match.p1 : match.p2;
    endMatch(io, match, winner, "battle");
  } else {
    saveMatchToDB(match);
    startActionTimer(io, match);
  }
}

function publicBattleState(match) {
  const s = match.battleState;
  return {
    p1HP: s.p1HP, p2HP: s.p2HP,
    p1MaxHP: s.p1MaxHP, p2MaxHP: s.p2MaxHP,
    p1Active: s.p1Active, p2Active: s.p2Active,
    turn: s.turn, winner: s.winner,
    waitingFor: s.waitingFor,
    p1Submitted: !!match.pendingActions?.p1,
    p2Submitted: !!match.pendingActions?.p2,
  };
}

async function endMatch(io, match, winnerUsername, reason) {
  if (match.actionTimer) { clearTimeout(match.actionTimer); match.actionTimer = null; }
  if (match.teamTimer)   { clearTimeout(match.teamTimer);   match.teamTimer   = null; }
  if (match.arenaTimer)  { clearTimeout(match.arenaTimer);  match.arenaTimer  = null; }
  for (const t of Object.values(match.reconnectTimers || {})) clearTimeout(t);

  match.state  = "finished";
  match.winner = winnerUsername;

  // Ladder
  let p1Delta = 0, p2Delta = 0;
  if (winnerUsername) {
    const loser = winnerUsername === match.p1 ? match.p2 : match.p1;
    if (reason === "battle") {
      p1Delta = winnerUsername === match.p1 ? POINTS.win : POINTS.loss;
      p2Delta = winnerUsername === match.p2 ? POINTS.win : POINTS.loss;
    } else {
      // forfait/timeout
      p1Delta = winnerUsername === match.p1 ? POINTS.win_by_forfeit : POINTS.forfeit;
      p2Delta = winnerUsername === match.p2 ? POINTS.win_by_forfeit : POINTS.forfeit;
    }
    await applyLadderPoints(winnerUsername, match.mode, p1Delta === POINTS.win || p1Delta === POINTS.win_by_forfeit ? p1Delta : p2Delta, true);
    await applyLadderPoints(loser, match.mode, p1Delta === POINTS.loss || p1Delta === POINTS.forfeit ? p1Delta : p2Delta, false);
  }

  // Points par joueur
  const p1Points = await get(`SELECT points FROM ${await getLadderTable(match.mode)} WHERE username=?`, [match.p1]);
  const p2Points = await get(`SELECT points FROM ${await getLadderTable(match.mode)} WHERE username=?`, [match.p2]);

  emitToPlayer(io, match.p1, "versus:battle_end", {
    winner: winnerUsername,
    isWinner: winnerUsername === match.p1,
    reason,
    pointsDelta: p1Delta,
    newPoints: p1Points?.points ?? 0,
  });
  emitToPlayer(io, match.p2, "versus:battle_end", {
    winner: winnerUsername,
    isWinner: winnerUsername === match.p2,
    reason,
    pointsDelta: p2Delta,
    newPoints: p2Points?.points ?? 0,
  });

  await saveMatchToDB(match);
  playerToMatch.delete(match.p1);
  playerToMatch.delete(match.p2);
  matches.delete(match.id);
}

// ── Socket setup ──────────────────────────────────────────────────────────────

export function setupVersusSocket(io) {
  io.on("connection", (socket) => {

    // ── Rejoindre la file ───────────────────────────────────────
    socket.on("versus:join_queue", async ({ token, mode }) => {
      const user = verifySocketToken(token);
      if (!user || !["3v3","6v6"].includes(mode)) return;
      const username = user.username;

      // Retirer d'une éventuelle file existante
      for (const m of ["3v3","6v6"]) {
        if (queues[m].has(username)) queues[m].delete(username);
      }

      // Retirer d'un match en cours si existant
      if (playerToMatch.has(username)) {
        socket.emit("versus:error", { message: "Vous avez déjà un match en cours." });
        return;
      }

      socketToUser.set(socket.id, username);
      socketToUser.set(username, socket.id); // username → socketId reverse map
      queues[mode].set(username, socket.id);

      await run(
        `INSERT OR REPLACE INTO versus_queue (username,mode) VALUES (?,?)`,
        [username, mode]
      );

      socket.emit("versus:joined_queue", { mode });
      await broadcastQueueUpdate(io, mode);

      // Chercher un adversaire
      const queue = queues[mode];
      if (queue.size >= 2) {
        const iter  = queue.entries();
        const [u1, s1] = iter.next().value;
        const [u2, s2] = iter.next().value;

        queue.delete(u1);
        queue.delete(u2);
        await run(`DELETE FROM versus_queue WHERE username IN (?,?)`, [u1, u2]);

        const matchId = randomUUID();
        const match = {
          id: matchId, mode,
          p1: u1, p2: u2,
          state: "team_building",
          team1: null, team2: null,
          arenaVote1: null, arenaVote2: null, arena: null,
          battleState: null,
          pendingActions: { p1: null, p2: null },
          actionTimer: null, teamTimer: null, arenaTimer: null,
          reconnectTimers: {},
          disconnected: new Set(),
        };
        matches.set(matchId, match);
        playerToMatch.set(u1, matchId);
        playerToMatch.set(u2, matchId);

        // Mettre à jour le reverse map socket
        socketToUser.set(u1, s1);
        socketToUser.set(u2, s2);

        // Avatars des deux joueurs pour l'écran d'intro
        const [row1, row2] = await Promise.all([
          get(`SELECT avatar FROM users WHERE username=?`, [u1]),
          get(`SELECT avatar FROM users WHERE username=?`, [u2]),
        ]);
        const avatar1 = row1?.avatar || null;
        const avatar2 = row2?.avatar || null;

        io.to(s1).emit("versus:matched", { matchId, opponent: u2, mode, youAre: "p1", myAvatar: avatar1, oppAvatar: avatar2 });
        io.to(s2).emit("versus:matched", { matchId, opponent: u1, mode, youAre: "p2", myAvatar: avatar2, oppAvatar: avatar1 });

        await broadcastQueueUpdate(io, mode);
        startTeamBuildingPhase(io, match);
      }
    });

    // ── Quitter la file ─────────────────────────────────────────
    socket.on("versus:leave_queue", async ({ token }) => {
      const user = verifySocketToken(token);
      if (!user) return;
      const username = user.username;
      for (const m of ["3v3","6v6"]) queues[m].delete(username);
      await run(`DELETE FROM versus_queue WHERE username=?`, [username]);
      socket.emit("versus:left_queue");
      for (const m of ["3v3","6v6"]) await broadcastQueueUpdate(io, m);
    });

    // ── Soumettre équipe ────────────────────────────────────────
    socket.on("versus:submit_team", async ({ token, matchId, team }) => {
      const user = verifySocketToken(token);
      if (!user) return;
      const username = user.username;
      const match    = matches.get(matchId);
      if (!match || match.state !== "team_building") return;

      const player = getMatchPlayer(match, username);
      if (!player) return;
      if (match[`team${player === "p1" ? 1 : 2}`]) return; // déjà soumis

      const { ok, error, team: validatedTeam } = await validateTeam(username, team, match.mode);
      if (!ok) { socket.emit("versus:error", { message: error }); return; }

      if (player === "p1") match.team1 = validatedTeam;
      else                 match.team2 = validatedTeam;

      socket.emit("versus:team_accepted");
      emitToPlayer(io, getOpponent(match, username), "versus:opponent_ready", { phase: "team_building" });

      if (match.team1 && match.team2) {
        if (match.teamTimer) { clearTimeout(match.teamTimer); match.teamTimer = null; }
        startArenaVotePhase(io, match);
      }
    });

    // ── Annuler équipe (avant que les deux aient soumis) ────────
    socket.on("versus:cancel_team", ({ token, matchId }) => {
      const user = verifySocketToken(token);
      if (!user) return;
      const username = user.username;
      const match    = matches.get(matchId);
      if (!match || match.state !== "team_building") return;

      const player = getMatchPlayer(match, username);
      if (!player) return;

      // Ne permet pas d'annuler si les deux ont déjà soumis (arène vote en cours)
      const teamKey = player === "p1" ? "team1" : "team2";
      if (!match[teamKey]) return; // pas encore soumis, rien à annuler

      match[teamKey] = null;
      socket.emit("versus:team_cancelled");
      emitToPlayer(io, getOpponent(match, username), "versus:opponent_ready", { phase: "team_building", cancelled: true });
    });

    // ── Voter pour une arène ────────────────────────────────────
    socket.on("versus:vote_arena", ({ token, matchId, arena }) => {
      const user = verifySocketToken(token);
      if (!user) return;
      const username = user.username;
      const match    = matches.get(matchId);
      if (!match || match.state !== "arena_vote") return;
      if (!VALID_ARENAS.includes(arena)) return;

      const player = getMatchPlayer(match, username);
      if (!player) return;

      if (player === "p1") match.arenaVote1 = arena;
      else                 match.arenaVote2 = arena;

      socket.emit("versus:vote_accepted", { arena });
      emitToPlayer(io, getOpponent(match, username), "versus:opponent_ready", { phase: "arena_vote" });

      if (match.arenaVote1 && match.arenaVote2) resolveArenaVote(io, match);
    });

    // ── Action de combat ────────────────────────────────────────
    socket.on("versus:action", ({ token, matchId, action }) => {
      const user = verifySocketToken(token);
      if (!user) return;
      const username = user.username;
      const match    = matches.get(matchId);
      if (!match || match.state !== "battle") return;

      const player = getMatchPlayer(match, username);
      if (!player) return;
      if (match.pendingActions[player]) return; // déjà soumis ce tour

      // Valider l'action
      const bs  = match.battleState;
      const team = player === "p1" ? match.team1 : match.team2;
      const hpArr = player === "p1" ? bs.p1HP : bs.p2HP;
      const active = player === "p1" ? bs.p1Active : bs.p2Active;

      if (action.type === "switch") {
        const idx = action.switchIdx;
        if (typeof idx !== "number" || idx < 0 || idx >= team.length) return;
        if (hpArr[idx] <= 0 || idx === active) return;
        match.pendingActions[player] = { type: "switch", switchIdx: idx };
      } else if (action.type === "attack") {
        const types = BE.getTypes(team[active]);
        if (!types.includes(action.atkType)) return;
        match.pendingActions[player] = {
          type: "attack",
          atkType: action.atkType,
          useSpecial: !!action.useSpecial,
        };
      } else return;

      socket.emit("versus:action_accepted");
      emitToPlayer(io, getOpponent(match, username), "versus:opponent_acted");

      // Si les deux ont soumis → résoudre immédiatement
      if (match.pendingActions.p1 && match.pendingActions.p2) {
        executeTurn(io, match, match.pendingActions);
      }
    });

    // ── Abandon volontaire ──────────────────────────────────────
    socket.on("versus:forfeit", async ({ token, matchId }) => {
      const user = verifySocketToken(token);
      if (!user) return;
      const username = user.username;
      const match    = matches.get(matchId);
      if (!match) return;
      if (getMatchPlayer(match, username) === null) return;
      const winner = getOpponent(match, username);
      await endMatch(io, match, winner, "forfeit");
    });

    // ── Reconnexion au match ────────────────────────────────────
    socket.on("versus:reconnect", async ({ token, matchId }) => {
      const user = verifySocketToken(token);
      if (!user) return;
      const username = user.username;
      const match    = matches.get(matchId);
      if (!match) { socket.emit("versus:error", { message: "Match introuvable" }); return; }
      if (!getMatchPlayer(match, username)) return;

      // Annuler le timer de reconnexion
      const rkey = `${matchId}_${username}`;
      if (match.reconnectTimers[rkey]) {
        clearTimeout(match.reconnectTimers[rkey]);
        delete match.reconnectTimers[rkey];
      }
      match.disconnected.delete(username === match.p1 ? "p1" : "p2");

      socketToUser.set(socket.id, username);
      socketToUser.set(username, socket.id);

      // Renvoyer l'état complet
      socket.emit("versus:reconnected", {
        match: {
          id: match.id, mode: match.mode, state: match.state,
          opponent: getOpponent(match, username),
          youAre: getMatchPlayer(match, username),
          arena: match.arena,
          team1Names: match.team1?.map(p => ({ name: BE.pokeName(p), img: p.imgAnim || p.gif_normal || p.img, imgBack: p.imgBack || p.gif_normal_back || p.img, isShiny: !!p.isShiny })),
          team2Names: match.team2?.map(p => ({ name: BE.pokeName(p), img: p.imgAnim || p.gif_normal || p.img, imgBack: p.imgBack || p.gif_normal_back || p.img, isShiny: !!p.isShiny })),
          battleState: match.battleState ? publicBattleState(match) : null,
        }
      });
      emitToPlayer(io, getOpponent(match, username), "versus:opponent_reconnected");
    });

    // ── Déconnexion ─────────────────────────────────────────────
    socket.on("disconnect", async () => {
      const username = socketToUser.get(socket.id);
      if (!username) return;
      socketToUser.delete(socket.id);

      // Nettoyer file d'attente
      for (const m of ["3v3","6v6"]) {
        if (queues[m].get(username) === socket.id) {
          queues[m].delete(username);
          await run(`DELETE FROM versus_queue WHERE username=?`, [username]);
          await broadcastQueueUpdate(io, m);
        }
      }

      // Gérer déconnexion en match
      const matchId = playerToMatch.get(username);
      if (!matchId) return;
      const match = matches.get(matchId);
      if (!match || match.state === "finished") return;

      const player = getMatchPlayer(match, username);
      if (!player) return;
      match.disconnected.add(player);

      const deadline = Date.now() + RECONNECT_MS;
      emitToPlayer(io, getOpponent(match, username), "versus:opponent_disconnected", {
        deadline,
        reconnectSecs: RECONNECT_MS / 1000,
      });

      const rkey = `${matchId}_${username}`;
      match.reconnectTimers[rkey] = setTimeout(async () => {
        const m = matches.get(matchId);
        if (!m || m.state === "finished") return;
        if (m.disconnected.has(player)) {
          await endMatch(io, m, getOpponent(m, username), "disconnect");
        }
      }, RECONNECT_MS);
    });
  });
}

// ── HTTP routes ───────────────────────────────────────────────────────────────

// GET /api/versus/ladder/:mode — top 50
router.get("/ladder/:mode", async (req, res) => {
  const { mode } = req.params;
  if (!["3v3","6v6"].includes(mode)) return res.status(400).json({ error: "Mode invalide" });
  try {
    const t    = await getLadderTable(mode);
    const rows = await all(
      `SELECT username,points,wins,losses,season FROM ${t} ORDER BY points DESC LIMIT 50`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/versus/my-ladder/:username/:mode — rank + points d'un joueur
router.get("/my-ladder/:username/:mode", async (req, res) => {
  const { username, mode } = req.params;
  if (!["3v3","6v6"].includes(mode)) return res.status(400).json({ error: "Mode invalide" });
  try {
    const t   = await getLadderTable(mode);
    const row = await get(`SELECT points,wins,losses,season FROM ${t} WHERE username=?`, [username]);
    if (!row) return res.json({ points:0, wins:0, losses:0, rank:null });
    const rankRow = await get(
      `SELECT COUNT(*)+1 AS rank FROM ${t} WHERE points > ?`, [row.points]
    );
    res.json({ ...row, rank: rankRow?.rank ?? null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/versus/queue — liste des files d'attente
router.get("/queue", (req, res) => {
  res.json({
    "3v3": [...queues["3v3"].keys()],
    "6v6": [...queues["6v6"].keys()],
  });
});

// ── Routes admin ──────────────────────────────────────────────────────────────

// GET /api/versus/admin/ladder/:mode — ladder complet (admin)
router.get("/admin/ladder/:mode", async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin requis" });
  const { mode } = req.params;
  if (!["3v3","6v6"].includes(mode)) return res.status(400).json({ error: "Mode invalide" });
  try {
    const t = await getLadderTable(mode);
    const rows = await all(`SELECT username,points,wins,losses,season FROM ${t} ORDER BY points DESC`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/versus/admin/points — ajouter/retirer des points à un joueur
router.post("/admin/points", async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin requis" });
  const { username, mode, delta } = req.body;
  if (!["3v3","6v6"].includes(mode)) return res.status(400).json({ error: "Mode invalide" });
  const d = parseInt(delta);
  if (isNaN(d)) return res.status(400).json({ error: "Delta invalide" });
  try {
    const t = await getLadderTable(mode);
    await ensureLadderRow(username, mode);
    await run(`UPDATE ${t} SET points=MAX(0,points+?) WHERE username=?`, [d, username]);
    const row = await get(`SELECT points,wins,losses FROM ${t} WHERE username=?`, [username]);
    res.json({ success: true, ...row });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/versus/admin/reset-ladder — reset un ladder complet
router.post("/admin/reset-ladder", async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin requis" });
  const { mode } = req.body;
  if (!["3v3","6v6"].includes(mode)) return res.status(400).json({ error: "Mode invalide" });
  try {
    const t = await getLadderTable(mode);
    await run(`DELETE FROM ${t}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
