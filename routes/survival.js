import { Router } from "express";
import { get, run, all } from "../db.js";
import * as BE from "../lib/battleEngine.js";
import * as SE from "../lib/survivalEngine.js";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────
async function getActiveRun(username) {
  return get(`SELECT * FROM survival_runs WHERE username=? AND status='active'`, [username]);
}

// ─── Cooldown entre deux tentatives (1h après la fin d'un run) ────────
const ATTEMPT_COOLDOWN_MS = 60 * 60 * 1000;

async function getSurvivalCooldown(username) {
  return get(`SELECT next_attempt_at FROM survival_cooldowns WHERE username=?`, [username]);
}

async function setSurvivalCooldown(username) {
  const nextAvailableAt = new Date(Date.now() + ATTEMPT_COOLDOWN_MS).toISOString();
  await run(
    `INSERT INTO survival_cooldowns (username, next_attempt_at) VALUES (?,?)
     ON CONFLICT(username) DO UPDATE SET next_attempt_at = excluded.next_attempt_at`,
    [username, nextAvailableAt]
  );
  return nextAvailableAt;
}

async function saveState(runId, state, streak, currency) {
  await run(
    `UPDATE survival_runs SET state_json=?, streak=?, currency=?, updated_at=datetime('now') WHERE id=?`,
    [JSON.stringify(state), streak, currency, runId]
  );
}

function buildBattleForStreak(streak, playerTeam, pool, activeMutations, playerLegendaryCount = 0) {
  const { aiLevel, teamSize, isFinalBoss } = SE.getSurvivalProfile(streak);
  const opponentTeam = SE.buildOpponentTeam(pool, teamSize, playerTeam, aiLevel, playerLegendaryCount);
  return { opponentTeam, aiLevel, isFinalBoss, trainerLabel: `Dresseur #${streak + 1}` };
}

function initBattleState(state, opponentTeam) {
  const p1HP    = state.team.map(s => s.curHP);
  const p1MaxHP = state.team.map(s => s.maxHP);
  const p2HP    = opponentTeam.map(p => Math.round((p.hp||45) * BE.HP_SCALE));

  // Si le Pokémon actif est K.O., trouver le premier vivant
  let p1Active = state.activeIdx;
  if ((p1HP[p1Active] ?? 0) <= 0) {
    const alive = p1HP.findIndex(hp => hp > 0);
    if (alive !== -1) { p1Active = alive; state.activeIdx = alive; }
  }

  return {
    p1HP, p2HP,
    p1MaxHP: [...p1MaxHP],
    p2MaxHP: [...p2HP],
    p1Active,
    p2Active: 0,
    p1Status: state.team.map(() => null),
    p2Status: opponentTeam.map(() => null),
    turn: 1,
    winner: null,
    waitingFor: "both",
  };
}

async function creditReward(username, reward) {
  if (reward.pokedollars > 0) {
    await run(`UPDATE inventory SET pokedollars = pokedollars + ? WHERE user_id = (SELECT id FROM users WHERE username=?)`,
      [reward.pokedollars, username]);
  }
  if (reward.superball > 0) {
    await run(`UPDATE inventory SET superball = COALESCE(superball,0) + ? WHERE user_id = (SELECT id FROM users WHERE username=?)`,
      [reward.superball, username]);
  }
  if (reward.lootbox > 0) {
    await run(`UPDATE inventory SET lootbox = COALESCE(lootbox,0) + ? WHERE user_id = (SELECT id FROM users WHERE username=?)`,
      [reward.lootbox, username]);
  }
}

// ─── GET /:username — état du run actif ──────────────────────────────
router.get("/:username", async (req, res) => {
  try {
    const row = await getActiveRun(req.params.username);
    if (!row) return res.json({ active: false });
    const state = JSON.parse(row.state_json);
    res.json({ active: true, streak: row.streak, currency: row.currency, status: row.status, state });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ─── GET /:username/cooldown — temps de récupération avant la prochaine tentative ──
router.get("/:username/cooldown", async (req, res) => {
  try {
    const row = await getSurvivalCooldown(req.params.username);
    const now  = Date.now();
    const next = row?.next_attempt_at ? new Date(row.next_attempt_at).getTime() : 0;
    if (row?.next_attempt_at && now < next) {
      return res.json({ canPlay: false, remaining: Math.ceil((next - now) / 1000), nextAvailableAt: row.next_attempt_at });
    }
    res.json({ canPlay: true, nextAvailableAt: null });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ─── POST /:username/start ────────────────────────────────────────────
router.post("/:username/start", async (req, res) => {
  try {
    const { username } = req.params;
    const existing = await getActiveRun(username);
    if (existing) return res.status(400).json({ error: "Un run est déjà en cours." });

    const cd = await getSurvivalCooldown(username);
    if (cd?.next_attempt_at && Date.now() < new Date(cd.next_attempt_at).getTime()) {
      return res.status(429).json({ error: "Temps de récupération en cours avant une nouvelle tentative.", nextAvailableAt: cd.next_attempt_at });
    }

    const { team } = req.body; // [{name, isShiny}] x <=6
    if (!team || !Array.isArray(team) || team.length < 1) {
      return res.status(400).json({ error: "Équipe invalide." });
    }

    // Validate team members
    const validTeam = team.slice(0, 6).filter(s => s?.name && SE.POKEMON_MAP[s.name]);
    if (validTeam.length < 1) return res.status(400).json({ error: "Aucun Pokémon valide." });

    const legendaryCount = validTeam.filter(s => SE.isLegendary(s.name)).length;
    if (legendaryCount > 1) {
      return res.status(400).json({ error: "Maximum 1 légendaire/mythique autorisé dans l'équipe de départ." });
    }

    // Build initial state with full HP
    const slots = validTeam.map(s => {
      const base = SE.POKEMON_MAP[s.name];
      const maxHP = Math.round((base.hp||45) * BE.HP_SCALE);
      return {
        name: s.name, isShiny: !!s.isShiny,
        curHP: maxHP, maxHP,
        statMods: { hp:0, atk:0, def:0, sp_atk:0, sp_def:0, speed:0 },
        fainted: false,
      };
    });

    const state = {
      team: slots,
      activeIdx: 0,
      phase: "battle",
      battle: null,
      pendingChoices: null,
      pendingMutationOptions: null,
      mutations: [],
      pokemonMutations: [],
      tempBuffs: [],
      nextOpponentPreview: null,
      shopInventory: {},
      shopAvailable: false,
      respinsLeft: 3,
      extraChoices: 0,
      fightsSinceLastFreePotion: 0,
      log: [],
    };

    // Build first opponent
    const playerBases = slots.map(s => SE.POKEMON_MAP[s.name]);
    const { opponentTeam, aiLevel, isFinalBoss, trainerLabel } = buildBattleForStreak(0, playerBases, SE.ALL_POKEMON, []);
    state.battle = {
      opponentTeam,
      battleState: initBattleState(state, opponentTeam),
      aiLevel, isFinalBoss, trainerLabel,
      firstKoRevivalUsed: false,
    };

    // Apply first_send_atk mutation (not active yet at start, only when chosen later)
    // Add first_send_atk tempBuff at each battle start (only when mutation is active)

    const newRun = await run(
      `INSERT INTO survival_runs (username, status, streak, currency, team_json, state_json) VALUES (?,?,?,?,?,?)`,
      [username, "active", 0, 0, JSON.stringify(validTeam), JSON.stringify(state)]
    );

    res.json({ active: true, streak: 0, currency: 0, status: "active", state });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── POST /:username/turn ─────────────────────────────────────────────
router.post("/:username/turn", async (req, res) => {
  try {
    const { username } = req.params;
    const row = await getActiveRun(username);
    if (!row) return res.status(404).json({ error: "Aucun run actif." });
    const state = JSON.parse(row.state_json);
    if (state.phase !== "battle") return res.status(400).json({ error: "Pas en phase de combat." });

    const battle = state.battle;
    const { atkType, useSpecial, switchIdx } = req.body;

    // ── Choix de remplacement après K.O. ──────────────────────────
    if (battle?.battleState?.waitingFor === "switch_p1") {
      if (typeof switchIdx !== "number") return res.status(400).json({ error: "Choix de Pokémon requis." });
      const bs = battle.battleState;
      if (switchIdx < 0 || switchIdx >= state.team.length || bs.p1HP[switchIdx] <= 0) {
        return res.status(400).json({ error: "Pokémon invalide ou K.O." });
      }
      bs.p1Active = switchIdx;
      bs.waitingFor = "both";
      state.activeIdx = switchIdx;
      const switchLogs = [`${state.team[switchIdx].name} entre au combat !`];
      state.log = [...(state.log || []), ...switchLogs].slice(-50);
      await saveState(row.id, state, row.streak, row.currency);
      return res.json({ active: true, streak: row.streak, currency: row.currency, status: "active", state, logs: switchLogs });
    }

    const isSwitch = typeof switchIdx === "number";

    const playerAction = isSwitch
      ? { type: "switch", switchIdx }
      : { type: "attack", atkType, useSpecial: !!useSpecial };

    // Build effective teams
    const effectivePlayer   = SE.buildEffectivePlayerTeam(state);
    const effectiveOpponent = SE.buildEffectiveOpponentTeam(battle.opponentTeam, state.mutations);

    // AI action
    const aiAction = SE.chooseAiAction(battle.battleState, effectivePlayer, effectiveOpponent, battle.aiLevel);

    // Snapshot HP before turn for first_ko_revival check
    const prevP1HP = [...battle.battleState.p1HP];

    // Resolve turn
    const { newState: newBS, logs } = BE.resolveTurn(
      battle.battleState, effectivePlayer, effectiveOpponent,
      { p1: playerAction, p2: aiAction },
      { p1: username, p2: battle.trainerLabel },
      { playerChoosesSwitch: true }
    );

    // ── Post-turn mutation hooks ────────────────────────────────────
    // switch_heal_10: per-Pokémon, stacking
    if (isSwitch && newBS.p1Active !== battle.battleState.p1Active) {
      const incoming = newBS.p1Active;
      const switchHealCount = (state.pokemonMutations||[]).filter(m => m.id === "switch_heal_10" && m.targetIdx === incoming).length;
      if (switchHealCount > 0) {
        const healAmt = Math.round(state.team[incoming].maxHP * 0.10 * switchHealCount);
        newBS.p1HP[incoming] = Math.min(state.team[incoming].maxHP, newBS.p1HP[incoming] + healAmt);
        logs.push(`Mutation "Souffle de repli" : ${state.team[incoming].name} récupère ${healAmt} PV.`);
      }
    }

    // first_ko_revival: per-Pokémon, stacking
    if (!battle.firstKoRevivalUsed) {
      const koIdx = prevP1HP.findIndex((hp, i) => hp > 0 && newBS.p1HP[i] <= 0);
      if (koIdx !== -1) {
        const revivalCount = (state.pokemonMutations||[]).filter(m => m.id === "first_ko_revival" && m.targetIdx === koIdx).length;
        if (revivalCount > 0) {
          const reviveHP = Math.min(state.team[koIdx].maxHP, Math.ceil(state.team[koIdx].maxHP * 0.20 * revivalCount));
          newBS.p1HP[koIdx] = reviveHP;
          battle.firstKoRevivalUsed = true;
          logs.push(`Mutation "Volonté de fer" : ${state.team[koIdx].name} revient avec ${reviveHP} PV !`);
          if (newBS.winner === "p2" && newBS.p1HP.some(h => h > 0)) {
            newBS.winner = null;
            newBS.waitingFor = "both";
          }
          if (newBS.waitingFor === "switch_p1" && koIdx === newBS.p1Active) {
            newBS.waitingFor = "both";
          }
        }
      }
    }

    battle.battleState = newBS;

    // Sync team HP and activeIdx
    state.team.forEach((slot, i) => {
      slot.curHP   = newBS.p1HP[i];
      slot.fainted = slot.curHP <= 0;
    });
    state.activeIdx = newBS.p1Active;

    // Decrement tempBuffs
    state.tempBuffs = (state.tempBuffs || [])
      .map(b => ({ ...b, turnsLeft: b.turnsLeft - 1 }))
      .filter(b => b.turnsLeft > 0);

    state.log = [...(state.log || []), ...logs].slice(-50);

    // ── Check battle result ─────────────────────────────────────────
    if (newBS.winner === "p1") {
      // Victory
      const streakAfter = row.streak + 1;
      const currencyGain = SE.computeCurrencyGain(row.streak, state.mutations);
      let newCurrency = row.currency + currencyGain;
      logs.push(`+${currencyGain} Jetons de Survie !`);

      // auto_heal_victory mutation — per-Pokémon
      const autoHealMap = new Map();
      for (const m of (state.pokemonMutations||[])) {
        if (m.id === "auto_heal_victory") autoHealMap.set(m.targetIdx, (autoHealMap.get(m.targetIdx)||0) + 1);
      }
      if (autoHealMap.size > 0) {
        for (const [i, count] of autoHealMap) {
          const slot = state.team[i];
          if (!slot || slot.curHP <= 0) continue;
          const heal = Math.round(slot.maxHP * 0.15 * count);
          slot.curHP = Math.min(slot.maxHP, slot.curHP + heal);
        }
        state.team.forEach((s, i) => { newBS.p1HP[i] = s.curHP; });
        logs.push("Mutation \"Camp de récupération\" : certains Pokémon récupèrent des PV.");
      }

      // free_potion_every5 mutation
      state.fightsSinceLastFreePotion = (state.fightsSinceLastFreePotion || 0) + 1;
      if (state.mutations.includes("free_potion_every5") && state.fightsSinceLastFreePotion >= 5) {
        state.shopInventory.surv_potion_petite = (state.shopInventory.surv_potion_petite || 0) + 1;
        state.fightsSinceLastFreePotion = 0;
        logs.push("Mutation \"Ravitaillement\" : 1 Potion Petite reçue !");
      }

      if (streakAfter >= SE.TOTAL_FIGHTS) {
        // ── VICTOIRE ──
        state.phase = "victory";
        state.battle = null;
        const reward = SE.computeRunReward(streakAfter, "victory");
        await creditReward(username, reward);
        await run(`UPDATE survival_runs SET status='victory', streak=?, currency=?, state_json=?, updated_at=datetime('now') WHERE id=?`,
          [streakAfter, newCurrency, JSON.stringify(state), row.id]);
        const nextAvailableAt = await setSurvivalCooldown(username);
        return res.json({ active: true, streak: streakAfter, currency: newCurrency, status: "victory", state, logs, reward, nextAvailableAt });
      }

        // Build next battle (stored for repérage reveal + reuse)
      const playerBases = state.team.map(s => SE.POKEMON_MAP[s.name]);
      const nextBattle = buildBattleForStreak(streakAfter, playerBases, SE.ALL_POKEMON, state.mutations);
      state._nextBattle = {
        opponentTeam: nextBattle.opponentTeam,
        aiLevel: nextBattle.aiLevel,
        isFinalBoss: nextBattle.isFinalBoss,
        trainerLabel: nextBattle.trainerLabel,
      };

      // Spin wheel: pick 2 distinct options
      state.pendingChoices = SE.spinWheelMultiple(3 + (state.extraChoices || 0));
      state.phase = "event";
      state.battle = null;
      state.nextOpponentPreview = null;

      // Guaranteed shop every 5 wins
      if (streakAfter % 5 === 0) { state.shopAvailable = true; }

      // Init respinsLeft on first event phase if not set
      if (state.respinsLeft === undefined) state.respinsLeft = 3;

      await run(`UPDATE survival_runs SET streak=?, currency=?, state_json=?, updated_at=datetime('now') WHERE id=?`,
        [streakAfter, newCurrency, JSON.stringify(state), row.id]);
      return res.json({ active: true, streak: streakAfter, currency: newCurrency, status: "active", state, logs });
    }

    if (newBS.winner === "p2") {
      // Défaite
      state.phase = "gameover";
      state.battle = null;
      const reward = SE.computeRunReward(row.streak, "defeat");
      await creditReward(username, reward);
      await run(`UPDATE survival_runs SET status='defeat', streak=?, currency=?, state_json=?, updated_at=datetime('now') WHERE id=?`,
        [row.streak, row.currency, JSON.stringify(state), row.id]);
      const nextAvailableAt = await setSurvivalCooldown(username);
      return res.json({ active: false, streak: row.streak, currency: row.currency, status: "defeat", state, logs, reward, nextAvailableAt });
    }

    // Combat en cours
    await saveState(row.id, state, row.streak, row.currency);
    res.json({ active: true, streak: row.streak, currency: row.currency, status: "active", state, logs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── POST /:username/choice — backward compat (anciens runs) ─────────
router.post("/:username/choice", async (req, res) => {
  try {
    const { username } = req.params;
    const row = await getActiveRun(username);
    if (!row) return res.status(404).json({ error: "Aucun run actif." });
    const state = JSON.parse(row.state_json);
    if (state.phase !== "choice") return res.status(400).json({ error: "Pas en phase de choix." });

    const { choiceId, targetIdx, stat } = req.body;
    const validIds = (state.pendingChoices || []).map(c => c.id);
    if (!validIds.includes(choiceId)) return res.status(400).json({ error: "Choix invalide." });

    const logs = [];
    let newCurrency = row.currency;

    if (choiceId === "shop") {
      state.phase = "shop";
    } else if (choiceId === "mutation") {
      state.pendingMutationOptions = SE.pickMutationOptions(state.mutations, 3);
      state.phase = "mutation_pick";
    } else {
      const delta = applyChoice(state, choiceId, targetIdx, stat, logs);
      newCurrency += delta;
      await startNextBattle(state, row.streak, logs);
    }

    state.pendingChoices = null;
    await saveState(row.id, state, row.streak, newCurrency);
    res.json({ active: true, streak: row.streak, currency: newCurrency, status: "active", state, logs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── POST /:username/event/relaunch ──────────────────────────────────
router.post("/:username/event/relaunch", async (req, res) => {
  try {
    const { username } = req.params;
    const row = await getActiveRun(username);
    if (!row) return res.status(404).json({ error: "Aucun run actif." });
    const state = JSON.parse(row.state_json);
    if (state.phase !== "event") return res.status(400).json({ error: "Pas en phase d'événement." });
    if ((state.respinsLeft || 0) <= 0) return res.status(400).json({ error: "Plus de Relances disponibles." });

    const n = 3 + (state.extraChoices || 0);
    state.pendingChoices = SE.spinWheelMultiple(n);
    state.respinsLeft = (state.respinsLeft || 0) - 1;

    await saveState(row.id, state, row.streak, row.currency);
    res.json({ active: true, streak: row.streak, currency: row.currency, status: "active", state, logs: [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── POST /:username/event/confirm ────────────────────────────────────
router.post("/:username/event/confirm", async (req, res) => {
  try {
    const { username } = req.params;
    const row = await getActiveRun(username);
    if (!row) return res.status(404).json({ error: "Aucun run actif." });
    const state = JSON.parse(row.state_json);
    if (state.phase !== "event") return res.status(400).json({ error: "Pas en phase d'événement." });

    const { choiceId, targetIdx, stat } = req.body;
    const validIds = (state.pendingChoices || []).map(c => c.id);
    if (!validIds.includes(choiceId)) return res.status(400).json({ error: "Choix invalide." });

    const logs = [];
    const { nextPhase, currencyDelta } = applyEventEffect(state, choiceId, targetIdx, stat, logs);
    const newCurrency = row.currency + currencyDelta;

    state.pendingChoices = null;

    if (nextPhase) {
      state.phase = nextPhase;
    } else {
      state.phase = "check_team";
    }

    await saveState(row.id, state, row.streak, newCurrency);
    res.json({ active: true, streak: row.streak, currency: newCurrency, status: "active", state, logs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── POST /:username/check-team/continue ─────────────────────────────
router.post("/:username/check-team/continue", async (req, res) => {
  try {
    const { username } = req.params;
    const row = await getActiveRun(username);
    if (!row) return res.status(404).json({ error: "Aucun run actif." });
    const state = JSON.parse(row.state_json);
    if (state.phase !== "check_team") return res.status(400).json({ error: "Pas en phase Vérif' Équipe." });

    const logs = [];
    await startNextBattle(state, row.streak, logs);
    state.shopAvailable = false;

    await saveState(row.id, state, row.streak, row.currency);
    res.json({ active: true, streak: row.streak, currency: row.currency, status: "active", state, logs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── POST /:username/check-team/shop ─────────────────────────────────
router.post("/:username/check-team/shop", async (req, res) => {
  try {
    const { username } = req.params;
    const row = await getActiveRun(username);
    if (!row) return res.status(404).json({ error: "Aucun run actif." });
    const state = JSON.parse(row.state_json);
    if (state.phase !== "check_team") return res.status(400).json({ error: "Pas en phase Vérif' Équipe." });
    if (!state.shopAvailable) return res.status(400).json({ error: "Boutique non disponible." });

    state.phase = "shop";
    await saveState(row.id, state, row.streak, row.currency);
    res.json({ active: true, streak: row.streak, currency: row.currency, status: "active", state });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

function applyChoice(state, choiceId, targetIdx, stat, logs) {
  const idx = typeof targetIdx === "number" ? targetIdx : 0;
  const slot = state.team[idx];
  let currencyDelta = 0;

  if (choiceId === "heal_full" && slot) {
    slot.curHP = slot.maxHP;
    logs.push(`${slot.name} est entièrement soigné !`);

  } else if (choiceId === "heal_team" && slot) {
    if (slot.curHP <= 0) {
      logs.push(`${slot.name} est K.O., impossible de soigner.`);
    } else {
      const heal = Math.round(slot.maxHP * 0.25);
      slot.curHP = Math.min(slot.maxHP, slot.curHP + heal);
      logs.push(`${slot.name} récupère 25% de ses PV max (+${heal} PV).`);
    }

  } else if (choiceId === "ranimation" && slot) {
    let reviveHP = Math.round(slot.maxHP * 0.50);
    const reviveCount = (state.pokemonMutations||[]).filter(m => m.id === "revive_bonus_25" && m.targetIdx === idx).length;
    if (reviveCount > 0) reviveHP = Math.round(reviveHP * Math.pow(1.25, reviveCount));
    slot.curHP  = Math.min(slot.maxHP, reviveHP);
    slot.fainted = false;
    logs.push(`${slot.name} est ranimé avec ${slot.curHP} PV !`);

  } else if (choiceId === "stat_boost" && slot && stat) {
    const validStats = ["atk","def","sp_atk","sp_def","speed","hp"];
    if (validStats.includes(stat)) {
      const mods = slot.statMods || {};
      const current = mods[stat] || 0;
      if (current >= 30) {
        logs.push(`${slot.name} est déjà au maximum pour ${stat}.`);
      } else {
        mods[stat] = Math.min(30, current + 10);
        slot.statMods = mods;
        if (stat === "hp") {
          const prev = slot.maxHP;
          const base  = SE.POKEMON_MAP[slot.name]?.hp || 45;
          slot.maxHP  = Math.round(base * (1 + mods.hp/100) * BE.HP_SCALE);
          slot.curHP  = Math.min(slot.maxHP, slot.curHP + (slot.maxHP - prev));
        }
        logs.push(`${slot.name} : +10% ${stat} (total : +${mods[stat]}%).`);
      }
    }

  } else if (choiceId === "stat_general" && slot) {
    const boostStats = ["atk","def","sp_atk","sp_def","speed"];
    const mods = slot.statMods || {};
    for (const s of boostStats) mods[s] = Math.min(30, (mods[s]||0) + 5);
    slot.statMods = mods;
    logs.push(`${slot.name} : +5% à toutes les stats offensives/défensives.`);

  } else if (choiceId === "fortification" && slot) {
    const prev = slot.maxHP;
    slot.maxHP  = Math.round(prev * 1.15);
    slot.curHP  = Math.min(slot.maxHP, slot.curHP + (slot.maxHP - prev));
    logs.push(`${slot.name} : +15% PV max (${slot.maxHP} PV max).`);

  } else if (choiceId === "rotation" && slot) {
    state.activeIdx = idx;
    logs.push(`${slot.name} sera en tête pour le prochain combat.`);

  } else if (choiceId === "reperage") {
    state.nextOpponentPreview = (state._nextBattle?.opponentTeam || []).map(p => ({ name: p.name }));
    logs.push("Repérage effectué : composition du prochain dresseur révélée.");

  } else if (choiceId === "butin") {
    let gain = 15 + Math.floor(Math.random() * 11);
    const butinDoubleCount = (state.mutations||[]).filter(m => m === "butin_double").length;
    if (butinDoubleCount > 0) gain = Math.round(gain * Math.pow(2, butinDoubleCount));
    currencyDelta += gain;
    logs.push(`+${gain} Jetons de Survie.`);

  } else if (choiceId === "pari_risque" && slot) {
    if (slot.curHP <= 0) {
      logs.push(`${slot.name} est K.O., le pari n'a aucun effet.`);
    } else {
      const win = Math.random() < 0.5;
      if (win) {
        slot.curHP = slot.maxHP;
        logs.push(`Pari risqué : gagné ! ${slot.name} est entièrement soigné.`);
      } else {
        slot.curHP = Math.max(1, Math.round(slot.curHP * 0.80));
        logs.push(`Pari risqué : perdu. ${slot.name} perd 20% de ses PV courants.`);
      }
    }
  }

  return currencyDelta;
}

// applyEventEffect: gère les 13 secteurs de la roue
// Retourne { nextPhase, currencyDelta }
function applyEventEffect(state, sectorId, targetIdx, stat, logs) {
  // Header log: nom du secteur + description + Pokémon ciblé si applicable
  const sectorMeta = SE.WHEEL_SECTORS.find(s => s.id === sectorId);
  if (sectorMeta) {
    const pokeName = (sectorMeta.requiresTarget && typeof targetIdx === "number") ? state.team[targetIdx]?.name : null;
    const prefix = pokeName ? `[${pokeName}] ` : "";
    logs.push(`${prefix}${sectorMeta.label} — ${sectorMeta.desc}`);
  }

  if (sectorId === "jackpot") {
    const idx = typeof targetIdx === "number" ? targetIdx : -1;
    const slot = idx >= 0 ? state.team[idx] : null;
    if (slot && slot.curHP > 0) {
      const heal = Math.round(slot.maxHP * 0.20);
      slot.curHP = Math.min(slot.maxHP, slot.curHP + heal);
      logs.push(`Jackpot ! +50 Jetons de Survie. ${slot.name} récupère 20% de ses PV max (+${heal} PV).`);
    } else {
      logs.push("Jackpot ! +50 Jetons de Survie.");
    }
    return { nextPhase: null, currencyDelta: 50 };
  }
  if (sectorId === "malediction") {
    state.respinsLeft = (state.respinsLeft || 0) + 1;
    const idx = typeof targetIdx === "number" ? targetIdx : -1;
    const slot = idx >= 0 ? state.team[idx] : null;
    if (slot && slot.curHP > 0) {
      slot.curHP = Math.max(1, Math.round(slot.curHP * 0.85));
      logs.push(`Malédiction : +1 Relance accordée. ${slot.name} perd 15% de ses PV courants.`);
    } else {
      logs.push("Malédiction : +1 Relance accordée.");
    }
    return { nextPhase: null, currencyDelta: 0 };
  }
  if (sectorId === "extra_legendary") {
    return { nextPhase: "legendary_swap", currencyDelta: 0 };
  }
  if (sectorId === "extra_choice") {
    state.extraChoices = (state.extraChoices || 0) + 1;
    const total = 3 + state.extraChoices;
    logs.push(`+1 Choix : vous aurez désormais ${total} options à chaque tirage.`);
    return { nextPhase: null, currencyDelta: 0 };
  }
  if (sectorId === "shop") {
    return { nextPhase: "shop", currencyDelta: 0 };
  }
  // Mutations directement dans la roue (stacking, pas de dédoublonnage)
  if (SE.MUTATION_IDS.has(sectorId)) {
    SE.applyMutationToState(state, sectorId, targetIdx);
    return { nextPhase: null, currencyDelta: 0 };
  }
  // Remaining sectors delegate to applyChoice
  const currencyDelta = applyChoice(state, sectorId, targetIdx, stat, logs);
  return { nextPhase: null, currencyDelta };
}

async function startNextBattle(state, currentStreak, logs) {
  const streak = currentStreak;
  const playerBases = state.team.map(s => SE.POKEMON_MAP[s.name]);
  const playerLegendaryCount = state.team.filter(s => SE.isLegendary(s.name)).length;

  if (state._nextBattle) {
    const nb = state._nextBattle;
    delete state._nextBattle;
    state.battle = {
      ...nb,
      battleState: initBattleState(state, nb.opponentTeam),
      firstKoRevivalUsed: false,
    };
  } else {
    const { opponentTeam, aiLevel, isFinalBoss, trainerLabel } = buildBattleForStreak(streak, playerBases, SE.ALL_POKEMON, state.mutations, playerLegendaryCount);
    state.battle = {
      opponentTeam, aiLevel, isFinalBoss, trainerLabel,
      battleState: initBattleState(state, opponentTeam),
      firstKoRevivalUsed: false,
    };
  }

  // first_send_atk mutation — per-Pokémon, stacking
  const firstSendAtks = (state.pokemonMutations||[]).filter(m => m.id === "first_send_atk" && m.targetIdx === state.activeIdx);
  if (firstSendAtks.length > 0) {
    state.tempBuffs = (state.tempBuffs || []).filter(b => b.source !== "first_send_atk");
    const pct = 25 * firstSendAtks.length;
    state.tempBuffs.push({ targetIdx: state.activeIdx, pct, turnsLeft: 3, source: "first_send_atk" });
    logs.push(`Mutation "Élan du champion" : ${state.team[state.activeIdx].name} +${pct}% ATK pendant 3 tours.`);
  }

  state.phase = "battle";
  state.nextOpponentPreview = null;
}

// ─── POST /:username/legendary-swap/pick ─────────────────────────────
router.post("/:username/legendary-swap/pick", async (req, res) => {
  try {
    const { username } = req.params;
    const row = await getActiveRun(username);
    if (!row) return res.status(404).json({ error: "Aucun run actif." });
    const state = JSON.parse(row.state_json);
    if (state.phase !== "legendary_swap") return res.status(400).json({ error: "Pas en phase d'échange légendaire." });

    const { legendaryName, replaceIdx } = req.body;
    if (!SE.isLegendary(legendaryName) || !SE.POKEMON_MAP[legendaryName]) {
      return res.status(400).json({ error: "Pokémon invalide ou non légendaire." });
    }
    if (typeof replaceIdx !== "number" || replaceIdx < 0 || replaceIdx >= state.team.length) {
      return res.status(400).json({ error: "Index de remplacement invalide." });
    }

    const base = SE.POKEMON_MAP[legendaryName];
    const maxHP = Math.round((base.hp || 45) * BE.HP_SCALE);
    state.team[replaceIdx] = {
      name: legendaryName, isShiny: false,
      curHP: maxHP, maxHP,
      statMods: { hp:0, atk:0, def:0, sp_atk:0, sp_def:0, speed:0 },
      fainted: false,
    };

    state.pendingChoices = null;
    state.phase = "check_team";

    const logs = [`${legendaryName} rejoint l'équipe en remplacement !`];
    await saveState(row.id, state, row.streak, row.currency);
    res.json({ active: true, streak: row.streak, currency: row.currency, status: "active", state, logs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── POST /:username/mutation-pick ────────────────────────────────────
router.post("/:username/mutation-pick", async (req, res) => {
  try {
    const { username } = req.params;
    const row = await getActiveRun(username);
    if (!row) return res.status(404).json({ error: "Aucun run actif." });
    const state = JSON.parse(row.state_json);
    if (state.phase !== "mutation_pick") return res.status(400).json({ error: "Pas en phase de sélection de mutation." });

    const { mutationId, targetIdx } = req.body;
    const validIds = (state.pendingMutationOptions || []).map(m => m.id);
    if (!validIds.includes(mutationId)) return res.status(400).json({ error: "Mutation invalide." });

    const logs = [];
    const effectiveTargetIdx = typeof targetIdx === "number" ? targetIdx : 0;
    SE.applyMutationToState(state, mutationId, effectiveTargetIdx);
    const mut = SE.MUTATION_POOL.find(m => m.id === mutationId);
    const pokeName = (mut?.requiresTarget) ? state.team[effectiveTargetIdx]?.name : null;
    const prefix = pokeName ? `[${pokeName}] ` : "";
    logs.push(`${prefix}${mut?.label} — ${mut?.desc || ""}`);

    state.pendingMutationOptions = null;
    state.phase = "check_team";

    await saveState(row.id, state, row.streak, row.currency);
    res.json({ active: true, streak: row.streak, currency: row.currency, status: "active", state, logs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── GET /:username/shop-prices ───────────────────────────────────────
router.get("/:username/shop-prices", async (req, res) => {
  try {
    const row = await getActiveRun(req.params.username);
    const prices = { ...SE.SHOP_PRICES };
    if (row) {
      const state = JSON.parse(row.state_json);
      const discountCount = (state.mutations||[]).filter(m => m === "potions_discount").length;
      if (discountCount > 0) {
        const factor = Math.pow(0.75, discountCount);
        for (const k of Object.keys(prices)) prices[k] = Math.round(prices[k] * factor);
      }
    }
    res.json(prices);
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ─── POST /:username/shop/buy ─────────────────────────────────────────
router.post("/:username/shop/buy", async (req, res) => {
  try {
    const { username } = req.params;
    const row = await getActiveRun(username);
    if (!row) return res.status(404).json({ error: "Aucun run actif." });
    const state = JSON.parse(row.state_json);
    if (state.phase !== "shop") return res.status(400).json({ error: "Pas en phase boutique." });

    const { item } = req.body;
    if (!SE.SHOP_PRICES[item]) return res.status(400).json({ error: "Objet inconnu." });

    let price = SE.SHOP_PRICES[item];
    const discountCount = (state.mutations||[]).filter(m => m === "potions_discount").length;
    if (discountCount > 0) price = Math.round(price * Math.pow(0.75, discountCount));

    let cur = row.currency;
    if (cur < price) return res.status(400).json({ error: "Jetons insuffisants." });
    cur -= price;

    state.shopInventory = state.shopInventory || {};
    state.shopInventory[item] = (state.shopInventory[item] || 0) + 1;

    await saveState(row.id, state, row.streak, cur);
    res.json({ active: true, streak: row.streak, currency: cur, status: "active", state });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── POST /:username/shop/use-potion ─────────────────────────────────
router.post("/:username/shop/use-potion", async (req, res) => {
  try {
    const { username } = req.params;
    const row = await getActiveRun(username);
    if (!row) return res.status(404).json({ error: "Aucun run actif." });
    const state = JSON.parse(row.state_json);
    if (state.phase !== "shop") return res.status(400).json({ error: "Pas en phase boutique." });

    const { item, targetIdx } = req.body;
    if (!SE.POTION_HEAL[item]) return res.status(400).json({ error: "Objet inconnu." });
    const inv = state.shopInventory || {};
    if (!inv[item] || inv[item] <= 0) return res.status(400).json({ error: "Objet non disponible." });

    const slot = state.team[targetIdx ?? 0];
    if (!slot) return res.status(400).json({ error: "Pokémon invalide." });

    const { pct, revive } = SE.POTION_HEAL[item];
    const logs = [];

    if (revive) {
      if (!slot.fainted) return res.status(400).json({ error: "Ce Pokémon n'est pas K.O." });
      let hp = Math.round(slot.maxHP * pct / 100);
      const reviveCount = (state.pokemonMutations||[]).filter(m => m.id === "revive_bonus_25" && m.targetIdx === (targetIdx??0)).length;
      if (reviveCount > 0) hp = Math.round(hp * Math.pow(1.25, reviveCount));
      slot.curHP   = Math.min(slot.maxHP, hp);
      slot.fainted = false;
      logs.push(`${slot.name} est ranimé avec ${slot.curHP} PV.`);
    } else {
      if (slot.fainted) return res.status(400).json({ error: "Ce Pokémon est K.O., utilisez un Rappel." });
      const heal = Math.round(slot.maxHP * pct / 100);
      slot.curHP  = Math.min(slot.maxHP, slot.curHP + heal);
      logs.push(`${slot.name} récupère ${heal} PV (${slot.curHP}/${slot.maxHP}).`);
    }

    inv[item]--;
    state.shopInventory = inv;

    await saveState(row.id, state, row.streak, row.currency);
    res.json({ active: true, streak: row.streak, currency: row.currency, status: "active", state, logs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── POST /:username/shop/continue ───────────────────────────────────
router.post("/:username/shop/continue", async (req, res) => {
  try {
    const { username } = req.params;
    const row = await getActiveRun(username);
    if (!row) return res.status(404).json({ error: "Aucun run actif." });
    const state = JSON.parse(row.state_json);
    if (state.phase !== "shop") return res.status(400).json({ error: "Pas en phase boutique." });

    const logs = [];
    state.phase = "check_team";
    state.shopAvailable = false;

    await saveState(row.id, state, row.streak, row.currency);
    res.json({ active: true, streak: row.streak, currency: row.currency, status: "active", state, logs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── POST /:username/quit ─────────────────────────────────────────────
router.post("/:username/quit", async (req, res) => {
  try {
    const { username } = req.params;
    const row = await getActiveRun(username);
    if (!row) return res.status(404).json({ error: "Aucun run actif." });
    const state = JSON.parse(row.state_json);

    state.phase = "gameover";
    const reward = SE.computeRunReward(row.streak, "quit");
    await creditReward(username, reward);
    await run(`UPDATE survival_runs SET status='quit', streak=?, state_json=?, updated_at=datetime('now') WHERE id=?`,
      [row.streak, JSON.stringify(state), row.id]);
    const nextAvailableAt = await setSurvivalCooldown(username);
    res.json({ active: false, streak: row.streak, currency: row.currency, status: "quit", state, reward, nextAvailableAt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── POST /:username/reorder ──────────────────────────────────────────
router.post("/:username/reorder", async (req, res) => {
  try {
    const { username } = req.params;
    const row = await getActiveRun(username);
    if (!row) return res.status(404).json({ error: "Aucun run actif." });
    const state = JSON.parse(row.state_json);
    if (state.phase !== "choice" && state.phase !== "shop" && state.phase !== "check_team" && state.phase !== "event") {
      return res.status(400).json({ error: "Réorganisation impossible en phase de combat." });
    }

    const { order } = req.body; // tableau d'indices, ex: [2,0,1,3,4,5]
    if (!Array.isArray(order) || order.length !== state.team.length) {
      return res.status(400).json({ error: "Ordre invalide." });
    }
    const sorted = [...order].sort((a, b) => a - b);
    if (!sorted.every((v, i) => v === i)) return res.status(400).json({ error: "Ordre invalide." });

    state.team = order.map(i => state.team[i]);
    state.activeIdx = 0; // le premier de la nouvelle liste devient actif

    await saveState(row.id, state, row.streak, row.currency);
    res.json({ active: true, streak: row.streak, currency: row.currency, status: "active", state });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── GET /:username/history ───────────────────────────────────────────
router.get("/:username/history", async (req, res) => {
  try {
    const rows = await all(
      `SELECT id, status, streak, created_at, updated_at FROM survival_runs WHERE username=? ORDER BY updated_at DESC LIMIT 10`,
      [req.params.username]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

export default router;
