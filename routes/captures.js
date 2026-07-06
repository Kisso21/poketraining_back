import { Router } from "express";
import { run, get, all, GEN1_POKEMONS, GEN2_POKEMONS, GEN3_POKEMONS, GEN4_POKEMONS } from "../db.js";
import { checkAchievements } from "./achievements.js";
import { awardBountyIfMatch } from "./bounty.js";
import { getPokemonCategory, computeCaptureBreakdown, computeBadgeCaptureBonus } from "../captureRates.js";
import { getIO } from "../socket.js";

const router = Router();
const CAPTURABLE_SET = new Set([...GEN1_POKEMONS, ...GEN2_POKEMONS, ...GEN3_POKEMONS, ...GEN4_POKEMONS, "MissingNo"]);
const GEN34_SET = new Set([...GEN3_POKEMONS, ...GEN4_POKEMONS]);
const VALID_BALLS = ["pokeball", "superball", "hyperball", "masterball"];

// Enregistre une capture réussie : pokédex, ou réserve revendable si doublon.
// Gère le Charme Éclair (shiny armé), consomme le state et déclenche les succès.
// Renvoie { addedToReserve, isShiny, newAchievements, message } — logique partagée
// entre POST /capture (legacy) et POST /capture/throw (taux autoritaire serveur).
async function persistCapture(userId, pokemonName, isShiny, captureState) {
  const armed = await get(`SELECT armed_shiny FROM inventory WHERE user_id = ?`, [userId]);
  if (Number(armed?.armed_shiny) === 1) {
    isShiny = 1;
    await run(`UPDATE inventory SET armed_shiny = 0 WHERE user_id = ?`, [userId]);
    getIO()?.emit("sync:armed", { userId, armedShiny: 0 });
  }

  const result = await run(
    `INSERT OR IGNORE INTO captures (user_id, pokemon_name, is_shiny) VALUES (?,?,?)`,
    [userId, pokemonName, isShiny]
  );
  await consumeCaptureState(captureState);

  if (result.changes === 0) {
    await run(
      `INSERT INTO pokemon_reserve (user_id, pokemon_name, is_shiny) VALUES (?,?,?)`,
      [userId, pokemonName, isShiny]
    );
    getIO()?.emit("sync:pokedex", { userId, pokemonName, isShiny, addedToReserve: true, newAchievements: [] });
    return { addedToReserve: true, isShiny, newAchievements: [], message: pokemonName + " ajouté à ta réserve !" };
  }

  const newAchievements = await checkAchievements(userId).catch(() => []);
  getIO()?.emit("sync:pokedex", { userId, pokemonName, isShiny, addedToReserve: false, newAchievements });
  return { addedToReserve: false, isShiny, newAchievements, message: pokemonName + " capturé !" };
}

function stateMatchesCapture(rawState, pokemonName) {
  if (!rawState) return false;
  let state;
  try { state = JSON.parse(rawState); } catch { return false; }

  const candidateName = state.secret || state.targetName;
  if (candidateName !== pokemonName || state.captureClaimed === true) return false;

  return state.finished === true
    || state.bloque === true
    || state.phase === "finished"
    || state.phase === "gameover";
}

async function getCaptureState(userId, pokemonName) {
  const states = await all(
    `SELECT id, state FROM game_states WHERE user_id = ?`,
    [userId]
  );
  return states.find(row => stateMatchesCapture(row.state, pokemonName)) || null;
}

async function consumeCaptureState(row) {
  if (!row?.id) return;
  let state;
  try { state = JSON.parse(row.state || "{}"); } catch { return; }
  state.captureClaimed = true;
  await run(`UPDATE game_states SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [JSON.stringify(state), row.id]);
}

// GET /api/captures/:userId
router.get("/captures/:userId", async (req, res) => {
  try {
    const rows = await all(
      `SELECT pokemon_name AS pokemonName, is_shiny AS isShiny FROM captures WHERE user_id = ?`,
      [req.user.id]
    );
    res.json({ captures: rows });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/capture
router.post("/capture", async (req, res) => {
  let { pokemonName, isShiny = 0 } = req.body;
  const userId = req.user.id;
  isShiny = isShiny ? 1 : 0;
  if (!pokemonName) return res.status(400).json({ error: "Données manquantes" });
  pokemonName = String(pokemonName).trim();
  if (!CAPTURABLE_SET.has(pokemonName)) return res.status(400).json({ error: "Pokémon invalide" });

  try {
    const user = await get(`SELECT id FROM users WHERE id = ?`, [userId]);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    if (GEN34_SET.has(pokemonName)) {
      const ach = await get(
        `SELECT claimed FROM achievements WHERE user_id = ? AND achievement_id = 'unlock-gen3-4'`,
        [userId]
      );
      if (!ach || !Number(ach.claimed)) {
        return res.status(403).json({ error: "Générations 3 & 4 non débloquées" });
      }
    }

    const captureState = await getCaptureState(userId, pokemonName);
    if (!captureState) return res.status(403).json({ error: "Capture non autorisée pour cette partie" });

    const cap = await persistCapture(userId, pokemonName, isShiny, captureState);
    res.json({
      success: true,
      addedToReserve: cap.addedToReserve,
      message: cap.message,
      isShiny: cap.isShiny,
      newAchievements: cap.newAchievements,
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/capture/throw
// Lancer de balle AUTORITAIRE : le serveur décrémente la balle, calcule le taux
// (catégorie, stat Dresseur, appâts, badges, malus doublon) et TIRE le succès.
// Le client n'envoie plus « willSucceed » — il ne peut donc plus forcer la capture.
router.post("/capture/throw", async (req, res) => {
  const userId   = req.user.id;
  const username = req.user.username;
  let { pokemonName, ballType } = req.body;
  let isShiny = req.body.isShiny ? 1 : 0;
  let score   = Number(req.body.score);
  if (!Number.isFinite(score)) score = 0;
  score = Math.max(0, Math.min(100, Math.round(score))); // borne comme /game/reset

  if (!pokemonName || !ballType) return res.status(400).json({ error: "Données manquantes" });
  pokemonName = String(pokemonName).trim();
  if (!CAPTURABLE_SET.has(pokemonName)) return res.status(400).json({ error: "Pokémon invalide" });
  if (!VALID_BALLS.includes(ballType)) return res.status(400).json({ error: "Type de Pokéball invalide" });

  try {
    if (GEN34_SET.has(pokemonName)) {
      const ach = await get(
        `SELECT claimed FROM achievements WHERE user_id = ? AND achievement_id = 'unlock-gen3-4'`,
        [userId]
      );
      if (!ach || !Number(ach.claimed)) {
        return res.status(403).json({ error: "Générations 3 & 4 non débloquées" });
      }
    }

    // Autorisation : une partie terminée correspondant à ce Pokémon, non consommée.
    const captureState = await getCaptureState(userId, pokemonName);
    if (!captureState) return res.status(403).json({ error: "Capture non autorisée pour cette partie" });

    // Balle disponible ? décrément atomique (colonne sécurisée par la whitelist).
    const inv = await get(`SELECT ${ballType} AS n FROM inventory WHERE user_id = ?`, [userId]);
    if ((inv?.n || 0) <= 0) return res.status(400).json({ error: "Plus de balles !" });
    await run(`UPDATE inventory SET ${ballType} = ${ballType} - 1 WHERE user_id = ?`, [userId]);
    const fullInv = await get(`SELECT * FROM inventory WHERE user_id = ?`, [userId]);
    getIO()?.emit("sync:inventory", { userId, inventory: fullInv });

    // ── Calcul du taux, entièrement côté serveur ──
    const category = getPokemonCategory(pokemonName);

    const ts            = await get(`SELECT stat_dresseur FROM trainer_stats WHERE user_id = ?`, [userId]);
    const dresseurBonus = Math.round((ts?.stat_dresseur || 0) * 0.1);

    const passRows  = await all(
      `SELECT item FROM user_passives WHERE user_id = ? AND active = 1 AND item IN ('appat','superappat')`,
      [userId]
    );
    const activeSet = new Set(passRows.map(p => p.item));
    const appAtBonus = (activeSet.has("appat") ? 3 : 0) + (activeSet.has("superappat") ? 5 : 0);

    const areneRows  = await all(`SELECT arene FROM user_arenes WHERE username = ? AND defeated = 1`, [username]);
    const badgeRows  = await all(`SELECT badge FROM user_badges WHERE user_id = ? AND unlocked = 1`, [userId]);
    const badgeCaptureBonus = computeBadgeCaptureBonus(areneRows.map(r => r.arene), badgeRows.map(b => b.badge));

    const scoreBonus = Math.floor(score / 10);

    // Malus doublon : légendaire/mythique normal déjà possédé → taux ÷2.
    let dupRarePenalty = false;
    if ((category === "legendaire" || category === "mythic") && !isShiny) {
      const owns = await get(
        `SELECT 1 AS x FROM captures WHERE user_id = ? AND pokemon_name = ? AND is_shiny = 0`,
        [userId, pokemonName]
      );
      dupRarePenalty = !!owns;
    }

    const br   = computeCaptureBreakdown(category, ballType, {
      scoreBonus, dresseurBonus, appAtBonus, badgeCaptureBonus, dupRarePenalty,
    });
    const roll   = Math.random() * 100;
    const caught = roll < br.rate;

    // Mode debug : détail complet du calcul + tirage, réservé aux comptes admin.
    const debug = req.user.role === "admin"
      ? { ...br, roll: +roll.toFixed(4), caught }
      : undefined;

    if (!caught) {
      return res.json({ success: true, caught: false, rate: br.rate, debug, inventory: fullInv });
    }

    const cap = await persistCapture(userId, pokemonName, isShiny, captureState);
    res.json({
      success: true,
      caught: true,
      rate: br.rate,
      debug,
      addedToReserve: cap.addedToReserve,
      isShiny: cap.isShiny,
      newAchievements: cap.newAchievements,
      message: cap.message,
      inventory: fullInv,
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/pokedex/seen — marque un Pokémon comme rencontré pendant une partie
// La prime « Pokémon recherché » se déclenche ICI (à la RENCONTRE, pas à la capture).
router.post("/pokedex/seen", async (req, res) => {
  let { pokemonName } = req.body;
  const isShiny = Number(req.body.isShiny) === 1 ? 1 : 0;
  if (!pokemonName) return res.status(400).json({ error: "Données manquantes" });
  pokemonName = String(pokemonName).trim();
  if (!CAPTURABLE_SET.has(pokemonName)) return res.status(400).json({ error: "Pokémon invalide" });
  try {
    await run(
      `INSERT INTO pokemon_seen (user_id, pokemon_name, seen_count) VALUES (?,?,1)
       ON CONFLICT(user_id, pokemon_name) DO UPDATE SET seen_count = seen_count + 1`,
      [req.user.id, pokemonName]
    );
    // Prime versée dès la rencontre (normal = prime, shiny = ×2), 1×/cycle/joueur
    const bounty = await awardBountyIfMatch(req.user.id, pokemonName, isShiny);
    res.json({ success: true, bounty });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/pokedex/:userId
router.get("/pokedex/:userId", async (req, res) => {
  try {
    const rows = await all(
      `SELECT pokemon_name AS pokemonName, is_shiny AS isShiny FROM captures WHERE user_id = ?`,
      [req.user.id]
    );
    const pokedex = {};
    rows.forEach(r => {
      const name = String(r.pokemonName).trim();
      if (!pokedex[name]) pokedex[name] = { normal: false, shiny: false };
      if (Number(r.isShiny) === 0) pokedex[name].normal = true;
      if (Number(r.isShiny) === 1) pokedex[name].shiny  = true;
    });
    // Pokémon rencontrés — liste séparée pour ne pas changer la sémantique
    // de `pokemons` (clé présente = capturé).
    // `seen` : noms vus mais non capturés (tag "Vu mais non capturé")
    // `seenCounts` : nombre de fois où chaque Pokémon a été vu (capturé ou non)
    const seenRows = await all(
      `SELECT pokemon_name AS pokemonName, seen_count AS seenCount FROM pokemon_seen WHERE user_id = ?`,
      [req.user.id]
    );
    const seenCounts = {};
    seenRows.forEach(r => { seenCounts[String(r.pokemonName).trim()] = Number(r.seenCount) || 1; });
    const seen = Object.keys(seenCounts).filter(name => !pokedex[name]);
    res.json({ captured: rows.length, total: 251, pokemons: pokedex, seen, seenCounts });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/leaderboard
router.get("/leaderboard", async (req, res) => {
  try {
    const rows = await all(`
      SELECT u.id, u.username,
             COUNT(c.id)                                    AS captures,
             SUM(CASE WHEN c.is_shiny = 1 THEN 1 ELSE 0 END) AS shinyCaptures,
             COALESCE(i.pokedollars, 0)                     AS pokedollars
      FROM users u
      LEFT JOIN captures c  ON c.user_id  = u.id
      LEFT JOIN inventory i ON i.user_id  = u.id
      WHERE u.role != 'admin'
      GROUP BY u.id
      ORDER BY captures DESC, i.pokedollars DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
