import { Router } from "express";
import { run, get, all } from "../db.js";
import { checkAchievements } from "./achievements.js";

const router = Router();

const ARENE_CONFIG = [
  { id: "pierre",   label: "Pierre",    badge: "Badge Roche",    type: "Roche",    region: "Kanto", reward: { pokedollars: 2000,  superball: 2 } },
  { id: "ondine",   label: "Ondine",    badge: "Badge Cascade",  type: "Eau",      region: "Kanto", reward: { pokedollars: 2500,  superball: 2 } },
  { id: "bob",      label: "Major Bob", badge: "Badge Foudre",   type: "Électrik", region: "Kanto", reward: { pokedollars: 3000,  hyperball: 1 } },
  { id: "erika",    label: "Erika",     badge: "Badge Prisme",   type: "Plante",   region: "Kanto", reward: { pokedollars: 3500,  superbonbon: 1 } },
  { id: "koga",     label: "Koga",      badge: "Badge Âme",      type: "Poison",   region: "Kanto", reward: { pokedollars: 4000,  resetball: 1 } },
  { id: "morgane",  label: "Morgane",   badge: "Badge Marais",   type: "Psy",      region: "Kanto", reward: { pokedollars: 4500,  hyperball: 1 } },
  { id: "auguste",  label: "Auguste",   badge: "Badge Volcan",   type: "Feu",      region: "Kanto", reward: { pokedollars: 5000,  lootbox: 1 } },
  { id: "albert",   label: "Albert",    badge: "Badge Zéphyr",   type: "Vol",      region: "Johto", reward: { pokedollars: 5500,  superball: 2 } },
  { id: "hector",   label: "Hector",    badge: "Badge Essaim",   type: "Insecte",  region: "Johto", reward: { pokedollars: 6000,  hyperball: 1 } },
  { id: "blanche",  label: "Blanche",   badge: "Badge Plaine",   type: "Normal",   region: "Johto", reward: { pokedollars: 6500,  superbonbon: 1 } },
  { id: "mortimer", label: "Mortimer",  badge: "Badge Brume",    type: "Spectre",  region: "Johto", reward: { pokedollars: 7000,  resetball: 1 } },
  { id: "chuck",    label: "Chuck",     badge: "Badge Choc",     type: "Combat",   region: "Johto", reward: { pokedollars: 7500,  hyperball: 1 } },
  { id: "jasmine",  label: "Jasmine",   badge: "Badge Minéral",  type: "Acier",    region: "Johto", reward: { pokedollars: 8000,  hyperball: 1 } },
  { id: "fredo",    label: "Fredo",     badge: "Badge Glacier",  type: "Glace",    region: "Johto", reward: { pokedollars: 8500,  superbonbon: 1 } },
  { id: "sandra",   label: "Sandra",    badge: "Badge Lever",    type: "Dragon",   region: "Johto", reward: { pokedollars: 10000, lootbox: 1 } },
  // ── Arènes Élite (gen 3 / 4) — débloquées après Sandra ET le succès unlock-gen3-4 ──
  { id: "roxanne",  label: "Roxanne",      badge: "Badge Caillou",   type: "Roche",    type2: "Eau",      region: "Hoenn",  tier: "elite", reward: { pokedollars: 11000, superball: 3 } },
  { id: "bastien",  label: "Bastien",      badge: "Badge Genou",     type: "Combat",   type2: "Psy",      region: "Hoenn",  tier: "elite", reward: { pokedollars: 12000, hyperball: 2 } },
  { id: "voltere",  label: "Voltère",      badge: "Badge Dynamo",    type: "Électrik", type2: "Sol",      region: "Hoenn",  tier: "elite", reward: { pokedollars: 13000, superbonbon: 1 } },
  { id: "adriane",  label: "Adriane",      badge: "Badge Chaleur",   type: "Feu",      type2: "Eau",      region: "Hoenn",  tier: "elite", reward: { pokedollars: 14000, hyperball: 2 } },
  { id: "norman",   label: "Norman",       badge: "Badge Équilibre", type: "Normal",   type2: "Combat",   region: "Hoenn",  tier: "elite", reward: { pokedollars: 15000, resetball: 1 } },
  { id: "alizee",   label: "Alizée",       badge: "Badge Plume",     type: "Vol",      type2: "Électrik", region: "Hoenn",  tier: "elite", reward: { pokedollars: 16000, superbonbon: 1 } },
  { id: "levytatia",label: "Lévy & Tatia", badge: "Badge Esprit",    type: "Psy",      type2: "Ténèbres", region: "Hoenn",  tier: "elite", reward: { pokedollars: 17000, hyperball: 2 } },
  { id: "marc",     label: "Marc",         badge: "Badge Pluie",     type: "Eau",      type2: "Plante",   region: "Hoenn",  tier: "elite", reward: { pokedollars: 18000, lootbox: 1 } },
  { id: "pierrick", label: "Pierrick",     badge: "Badge Charbon",   type: "Roche",    type2: "Plante",   region: "Sinnoh", tier: "elite", reward: { pokedollars: 19000, superball: 3 } },
  { id: "flo",      label: "Flo",          badge: "Badge Forêt",     type: "Plante",   type2: "Feu",      region: "Sinnoh", tier: "elite", reward: { pokedollars: 20000, hyperball: 2 } },
  { id: "melina",   label: "Mélina",       badge: "Badge Cobalt",    type: "Combat",   type2: "Vol",      region: "Sinnoh", tier: "elite", reward: { pokedollars: 21000, superbonbon: 1 } },
  { id: "lovis",    label: "Lovis",        badge: "Badge Palustre",  type: "Eau",      type2: "Électrik", region: "Sinnoh", tier: "elite", reward: { pokedollars: 22000, hyperball: 2 } },
  { id: "kimera",   label: "Kiméra",       badge: "Badge Fantôme",   type: "Spectre",  type2: "Ténèbres", region: "Sinnoh", tier: "elite", reward: { pokedollars: 23000, resetball: 1 } },
  { id: "charles",  label: "Charles",      badge: "Badge Mine",      type: "Acier",    type2: "Feu",      region: "Sinnoh", tier: "elite", reward: { pokedollars: 24000, superbonbon: 2 } },
  { id: "gladys",   label: "Gladys",       badge: "Badge Glace",     type: "Glace",    type2: "Acier",    region: "Sinnoh", tier: "elite", reward: { pokedollars: 25000, hyperball: 3 } },
  { id: "tanguy",   label: "Tanguy",       badge: "Badge Phare",     type: "Électrik", type2: "Sol",      region: "Sinnoh", tier: "elite", reward: { pokedollars: 30000, lootbox: 2 } },
];

// Première arène Élite : déblocage conditionné au succès gen 3/4
const FIRST_ELITE_ID = "roxanne";
async function gen34Claimed(username) {
  const u = await get(`SELECT id FROM users WHERE username = ?`, [username]);
  if (!u) return false;
  const row = await get(
    `SELECT claimed FROM achievements WHERE user_id = ? AND achievement_id = 'unlock-gen3-4'`,
    [u.id]
  );
  return Number(row?.claimed) === 1;
}

const ARENE_ORDER = ARENE_CONFIG.map(a => a.id);
const ARENE_MAP   = Object.fromEntries(ARENE_CONFIG.map(a => [a.id, a]));

// GET /:username — liste toutes les arènes avec statut
router.get("/:username", async (req, res) => {
  try {
    const rows = await all(
      `SELECT arene, unlocked, defeated, in_progress, last_try FROM user_arenes WHERE username = ?`,
      [req.user.username]
    );
    const rowMap = Object.fromEntries((rows || []).map(r => [r.arene, r]));

    // Charger les badges réellement obtenus en base
    const userId = await get(`SELECT id FROM users WHERE username = ?`, [req.user.username]);
    const badgeRows = userId ? await all(
      `SELECT badge FROM user_badges WHERE user_id = ? AND unlocked = 1`,
      [userId.id]
    ) : [];
    const badgeSet = new Set(badgeRows.map(b => b.badge));

    // Déblocage Élite : Sandra vaincue + succès gen 3/4 récupéré
    const sandraRow = rowMap["sandra"];
    const sandraDefeated = (sandraRow ? !!sandraRow.defeated : false)
      || badgeSet.has(ARENE_MAP["sandra"].badge);
    const eliteUnlocked = sandraDefeated && await gen34Claimed(req.user.username);

    const result = ARENE_CONFIG.map((cfg, i) => {
      const row = rowMap[cfg.id];
      // defeated est true si soit l'arène a été vaincue, soit le badge existe en base
      const defeated = (row ? !!row.defeated : false) || (cfg.badge ? badgeSet.has(cfg.badge) : false);
      let unlocked = row ? !!row.unlocked : i === 0;
      // La 1re arène Élite n'est jouable qu'une fois la condition gen 3/4 remplie ;
      // les arènes Élite sont masquées tant que la condition n'est pas remplie.
      if (cfg.id === FIRST_ELITE_ID) unlocked = eliteUnlocked;
      return {
        ...cfg,
        unlocked,
        defeated,
        inProgress: row ? !!row.in_progress : false,
        lastTry:    row?.last_try ? row.last_try.replace(' ', 'T') + 'Z' : null,
        eliteLocked: cfg.tier === "elite" && !eliteUnlocked,
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /victory/:username — victoire : récompenses + badge + déverrouillage suivant
router.post("/victory/:username", async (req, res) => {
  const username = req.user.username;
  const { arene } = req.body;
  if (!arene) return res.status(400).json({ error: "Arène manquante" });
  const cfg = ARENE_MAP[arene];
  if (!cfg) return res.status(400).json({ error: "Arène invalide" });

  try {
    const row = await get(
      `SELECT unlocked, defeated FROM user_arenes WHERE username=? AND arene=?`,
      [username, arene]
    );
    const isFirstArena = arene === ARENE_ORDER[0];
    // La 1re arène Élite est accessible dès que la condition gen 3/4 est remplie,
    // même sans ligne user_arenes (le déblocage est calculé dynamiquement).
    let eliteEntryOk = false;
    if (arene === FIRST_ELITE_ID) {
      const sandra = await get(`SELECT defeated FROM user_arenes WHERE username=? AND arene='sandra'`, [username]);
      eliteEntryOk = !!sandra?.defeated && await gen34Claimed(username);
    }
    const bypassLock = isFirstArena || eliteEntryOk;
    if (!row && !bypassLock) return res.status(403).json({ error: "Arène verrouillée" });
    if (row && !row.unlocked && !bypassLock) return res.status(403).json({ error: "Arène verrouillée" });
    if (row?.defeated) return res.status(400).json({ error: "Déjà vaincue" });

    // Créer la ligne si elle n'existe pas (première arène pour nouveaux joueurs)
    await run(
      `INSERT OR IGNORE INTO user_arenes (username, arene, unlocked) VALUES (?,?,1)`,
      [username, arene]
    );

    await run(
      `UPDATE user_arenes SET defeated=1, in_progress=0, progress_json='{}', last_try=datetime('now') WHERE username=? AND arene=?`,
      [username, arene]
    );

    // Débloquer la suivante
    const nextIdx = ARENE_ORDER.indexOf(arene) + 1;
    if (nextIdx < ARENE_ORDER.length) {
      const nextId = ARENE_ORDER[nextIdx];
      await run(`INSERT OR IGNORE INTO user_arenes (username, arene, unlocked) VALUES (?,?,1)`, [username, nextId]);
      await run(`UPDATE user_arenes SET unlocked=1 WHERE username=? AND arene=?`, [username, nextId]);
    }

    // Récompenses
    const uRow = await get(`SELECT id FROM users WHERE username = ?`, [username]);
    if (uRow) {
      const { pokedollars = 0, ...items } = cfg.reward;
      const itemKeys = Object.keys(items);
      if (itemKeys.length > 0) {
        const setCols = ["pokedollars = pokedollars + ?", ...itemKeys.map(k => `${k} = ${k} + ?`)].join(", ");
        await run(
          `UPDATE inventory SET ${setCols} WHERE user_id = ?`,
          [pokedollars, ...Object.values(items), uRow.id]
        );
      } else {
        await run(`UPDATE inventory SET pokedollars = pokedollars + ? WHERE user_id = ?`, [pokedollars, uRow.id]);
      }

      if (cfg.badge) {
        await run(
          `INSERT OR IGNORE INTO user_badges (user_id, badge) VALUES (?,?)`,
          [uRow.id, cfg.badge]
        );
        await run(
          `UPDATE user_badges SET unlocked=1, date_obtained=datetime('now') WHERE user_id=? AND badge=?`,
          [uRow.id, cfg.badge]
        );
        checkAchievements(uRow.id).catch(() => {});
      }
    }

    res.json({
      success: true,
      reward: cfg.reward,
      nextUnlocked: nextIdx < ARENE_ORDER.length ? ARENE_ORDER[nextIdx] : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /progress/:username — sauvegarder progression en cours
router.post("/progress/:username", async (req, res) => {
  const username = req.user.username;
  const { arene, progress } = req.body;
  if (!arene || !ARENE_MAP[arene]) return res.status(400).json({ error: "Paramètres manquants" });
  try {
    await run(
      `INSERT OR IGNORE INTO user_arenes (username, arene, unlocked) VALUES (?,?,0)`,
      [username, arene]
    );
    await run(
      `UPDATE user_arenes SET progress_json=?, in_progress=1 WHERE username=? AND arene=?`,
      [JSON.stringify(progress || {}), username, arene]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /save/:username/:arene — charger progression
router.get("/save/:username/:arene", async (req, res) => {
  try {
    const row = await get(
      `SELECT progress_json FROM user_arenes WHERE username=? AND arene=?`,
      [req.user.username, req.params.arene]
    );
    let progress = null;
    try { progress = row?.progress_json ? JSON.parse(row.progress_json) : null; } catch {}
    res.json({ progress });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /reset/:username/:arene — réinitialiser progression
router.post("/reset/:username/:arene", async (req, res) => {
  try {
    await run(
      `UPDATE user_arenes SET progress_json='{}', in_progress=0 WHERE username=? AND arene=?`,
      [req.user.username, req.params.arene]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /defeat/:username — défaite : pose le cooldown + efface la progression
router.post("/defeat/:username", async (req, res) => {
  const username = req.user.username;
  const { arene } = req.body;
  if (!arene || !ARENE_MAP[arene]) return res.status(400).json({ error: "Arène invalide" });
  try {
    await run(`INSERT OR IGNORE INTO user_arenes (username, arene, unlocked) VALUES (?,?,0)`, [username, arene]);
    await run(
      `UPDATE user_arenes SET in_progress=0, progress_json='{}', last_try=datetime('now') WHERE username=? AND arene=?`,
      [username, arene]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Routes admin ──────────────────────────────────────────────────────────────

// GET /admin/user/:username — liste des arènes d'un utilisateur (admin)
router.get("/admin/user/:username", async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin requis" });
  try {
    const rows = await all(
      `SELECT arene, unlocked, defeated, last_try FROM user_arenes WHERE username = ?`,
      [req.params.username]
    );
    const rowMap = Object.fromEntries((rows || []).map(r => [r.arene, r]));
    const result = ARENE_CONFIG.map((cfg, i) => ({
      ...cfg,
      unlocked: rowMap[cfg.id] ? !!rowMap[cfg.id].unlocked : i === 0,
      defeated: rowMap[cfg.id] ? !!rowMap[cfg.id].defeated : false,
      lastTry:  rowMap[cfg.id]?.last_try ? rowMap[cfg.id].last_try.replace(' ', 'T') + 'Z' : null,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/set — modifier l'état d'une arène (admin)
// action: "unlock" | "defeat" | "reset"
router.post("/admin/set", async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin requis" });
  const { username, arene, action } = req.body;
  const cfg = ARENE_MAP[arene];
  if (!cfg || !["unlock","defeat","reset","cooldown_reset"].includes(action)) return res.status(400).json({ error: "Paramètres invalides" });

  try {
    await run(`INSERT OR IGNORE INTO user_arenes (username, arene, unlocked) VALUES (?,?,0)`, [username, arene]);

    if (action === "unlock") {
      await run(`UPDATE user_arenes SET unlocked=1, defeated=0, in_progress=0, progress_json='{}' WHERE username=? AND arene=?`, [username, arene]);
    } else if (action === "defeat") {
      await run(`UPDATE user_arenes SET unlocked=1, defeated=1, in_progress=0, progress_json='{}' WHERE username=? AND arene=?`, [username, arene]);
      const uRow = await get(`SELECT id FROM users WHERE username = ?`, [username]);
      if (uRow && cfg.badge) {
        await run(`INSERT OR IGNORE INTO user_badges (user_id, badge) VALUES (?,?)`, [uRow.id, cfg.badge]);
        await run(`UPDATE user_badges SET unlocked=1, date_obtained=datetime('now') WHERE user_id=? AND badge=?`, [uRow.id, cfg.badge]);
      }
    } else if (action === "cooldown_reset") {
      await run(`UPDATE user_arenes SET last_try=NULL WHERE username=? AND arene=?`, [username, arene]);
    } else if (action === "reset") {
      await run(`UPDATE user_arenes SET unlocked=0, defeated=0, in_progress=0, progress_json='{}', last_try=NULL WHERE username=? AND arene=?`, [username, arene]);
      const uRow = await get(`SELECT id FROM users WHERE username = ?`, [username]);
      if (uRow && cfg.badge) {
        await run(`UPDATE user_badges SET unlocked=0, date_obtained=NULL WHERE user_id=? AND badge=?`, [uRow.id, cfg.badge]);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
