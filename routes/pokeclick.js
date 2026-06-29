import { Router } from "express";
import { readFileSync } from "fs";
import { run, get, all } from "../db.js";

const router = Router();

// ── Données Pokémon (HP) pour l'endurance — chargées une seule fois ──────────
// Mêmes fichiers que le front (/data/...) pour que les valeurs HP coïncident.
const POKEMON_HP = (() => {
  const map = {};
  for (const f of ["/var/www/html/data/gen1_2.json", "/var/www/html/data/gen3_4.json"]) {
    try {
      const arr = JSON.parse(readFileSync(f, "utf8"));
      for (const p of arr) {
        const name = p.nom || p.name;
        if (name) map[name] = p.hp ?? 45;
      }
    } catch { /* fichier absent : on ignore */ }
  }
  return map;
})();

// ── Endurance (miroir exact de la logique client) ───────────────────────────
const STAMINA_PER_HP = 6;
const REGEN_MIN_MS   = 1 * 3600 * 1000;   // 1 h (Pokémon fragile)
const REGEN_MAX_MS   = 4 * 3600 * 1000;   // 4 h (Pokémon endurant)
const maxStaminaFor  = (hp) => Math.max(60, Math.round((hp || 45) * STAMINA_PER_HP));
const regenMsFor     = (hp) => {
  const f = Math.max(0, Math.min(1, ((hp || 45) - 20) / (150 - 20)));
  return REGEN_MIN_MS + f * (REGEN_MAX_MS - REGEN_MIN_MS);
};
// Endurance courante à partir de l'ancre {cur, ts} (régénère au repos).
function currentStamina(rec, hp) {
  const max = maxStaminaFor(hp);
  if (!rec) return max; // jamais utilisé → plein
  const regen = ((Date.now() - rec.ts) / regenMsFor(hp)) * max;
  return Math.max(0, Math.min(max, rec.cur + regen));
}
const loadStaminaRec = (userId, pokemon) =>
  get(`SELECT cur, ts FROM pokeclick_stamina WHERE user_id = ? AND pokemon = ?`, [userId, pokemon]);
const saveStaminaRec = (userId, pokemon, cur, ts) =>
  run(`INSERT INTO pokeclick_stamina (user_id, pokemon, cur, ts) VALUES (?,?,?,?)
       ON CONFLICT(user_id, pokemon) DO UPDATE SET cur = ?, ts = ?`,
      [userId, pokemon, cur, ts, cur, ts]);
const ownsPokemon = async (userId, pokemon) =>
  !!(await get(`SELECT 1 FROM captures WHERE user_id = ? AND pokemon_name = ? LIMIT 1`, [userId, pokemon]));
// Clé d'endurance : normal et shiny sont des entités distinctes (endurance indépendante).
// Le nom de base sert toujours au HP et à la possession ; le suffixe ne touche que le stockage.
const staminaKey = (name, shiny) => (shiny ? `${name}#shiny` : name);

function getDailyLimit(ownedKeys) {
  if (ownedKeys.includes("goldball"))   return 10000;
  if (ownedKeys.includes("masterball")) return 8000;
  if (ownedKeys.includes("hyperball"))  return 7000;
  if (ownedKeys.includes("superball"))  return 6000;
  return 5000;
}

const UPGRADES = {
  superball:     { price: 5000,   type: "ball" },
  hyperball:     { price: 15000,  type: "ball" },
  masterball:    { price: 50000,  type: "ball" },
  goldball:      { price: 100000, type: "ball" },
  drop_items:    { price: 50000,  type: "drop" },
  drop_booster:  { price: 100000, type: "drop" },
  table_loot:    { price: 25000,  type: "drop" },
  double_slot:   { price: 75000,  type: "feature" },
};

function clickReward(ownedKeys) {
  // ₽/clic par palier (la ball la plus haute possédée détermine la valeur)
  if (ownedKeys.includes("goldball"))   return 5;
  if (ownedKeys.includes("masterball")) return 4;
  if (ownedKeys.includes("hyperball"))  return 3;
  if (ownedKeys.includes("superball"))  return 2;
  return 1;
}

async function getDailyEarned(userId) {
  const today = new Date().toISOString().split("T")[0];
  const row = await get(`SELECT earned FROM daily_farm WHERE user_id = ? AND date = ?`, [userId, today]);
  return row ? row.earned : 0;
}

async function creditFarm(userId, amount) {
  const today = new Date().toISOString().split("T")[0];
  await run(`UPDATE inventory SET pokedollars = COALESCE(pokedollars,0) + ? WHERE user_id = ?`, [amount, userId]);
  await run(
    `INSERT INTO daily_farm (user_id, date, earned) VALUES (?,?,?)
     ON CONFLICT(user_id, date) DO UPDATE SET earned = earned + ?`,
    [userId, today, amount, amount]
  );
}

// GET /upgrades/:userId
router.get("/upgrades/:userId", async (req, res) => {
  try {
    const rows = await all(`SELECT upgrade_key FROM pokeclick_upgrades WHERE user_id = ?`, [req.user.id]);
    res.json({ upgrades: rows.map(r => r.upgrade_key) });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /buy
router.post("/buy", async (req, res) => {
  const { upgradeKey } = req.body;
  const userId = req.user.id;
  if (!upgradeKey || !UPGRADES[upgradeKey])
    return res.status(400).json({ error: "Paramètres invalides" });

  try {
    const already = await get(
      `SELECT 1 FROM pokeclick_upgrades WHERE user_id = ? AND upgrade_key = ?`,
      [userId, upgradeKey]
    );
    if (already) return res.status(400).json({ error: "Déjà acheté" });

    const upg = UPGRADES[upgradeKey];
    const inv = await get(`SELECT pokedollars FROM inventory WHERE user_id = ?`, [userId]);
    if (!inv || (inv.pokedollars || 0) < upg.price)
      return res.status(400).json({ error: "Pas assez de Pokédollars" });

    await run(`UPDATE inventory SET pokedollars = pokedollars - ? WHERE user_id = ?`, [upg.price, userId]);
    await run(`INSERT INTO pokeclick_upgrades (user_id, upgrade_key) VALUES (?,?)`, [userId, upgradeKey]);

    const newInv = await get(
      `SELECT pokedollars, pokeball, superball, hyperball, masterball, resetball, superbonbon, potion, lootbox FROM inventory WHERE user_id = ?`,
      [userId]
    );
    res.json({ success: true, inventory: newInv });
  } catch (err) {
    console.error("Erreur buy pokeclick:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /click
router.post("/click", async (req, res) => {
  const { combo, pokemon, auto, shiny } = req.body;
  const userId = req.user.id;

  try {
    const rows = await all(`SELECT upgrade_key FROM pokeclick_upgrades WHERE user_id = ?`, [userId]);
    const owned = rows.map(r => r.upgrade_key);
    const dailyLimit = getDailyLimit(owned);

    const earned = await getDailyEarned(userId);
    if (earned >= dailyLimit) return res.json({ success: true, gained: 0, remaining: 0, drops: [] });

    // ── Endurance (auto-clic uniquement) : autoritative côté serveur ──────────
    // Le clic manuel ne consomme pas d'endurance (comportement historique).
    // Vaut pour le Pokémon actif comme pour le remplaçant qui vient d'être permuté :
    // chaque Pokémon a sa propre ancre, on valide celui que le client envoie.
    let stamina = null, staminaMax = null;
    if (auto) {
      const name = typeof pokemon === "string" ? pokemon : null;
      if (!name || !(name in POKEMON_HP) || !(await ownsPokemon(userId, name))) {
        return res.json({ success: true, gained: 0, remaining: Math.max(0, dailyLimit - earned), drops: [], exhausted: true });
      }
      const hp = POKEMON_HP[name];
      const key = staminaKey(name, !!shiny);
      staminaMax = maxStaminaFor(hp);
      const cur  = currentStamina(await loadStaminaRec(userId, key), hp);
      if (cur < 1) {
        // Ré-ancre pour figer la régénération courante, puis refuse le crédit/drop.
        await saveStaminaRec(userId, key, cur, Date.now());
        return res.json({ success: true, gained: 0, remaining: Math.max(0, dailyLimit - earned), drops: [], exhausted: true, stamina: cur, staminaMax });
      }
      stamina = cur - 1;
      await saveStaminaRec(userId, key, stamina, Date.now());
    }

    // Combo (×0.1 par tranche de 20 clics, max ×2.0) — ne multiplie QUE les drops
    const comboMult = Math.min(2.0, 1 + Math.floor(Math.max(0, combo || 0) / 20) * 0.1);
    // Pokédollars par clic : valeur fixe de la ball (1 à 5), SANS combo
    const reward = Math.min(clickReward(owned), dailyLimit - earned);
    await creditFarm(userId, reward);

    // Drop rolls — comboMult et ballMult s'appliquent aux drops
    // ballMult = ₽/clic de la ball (1 à 5) : comme les meilleures balls atteignent
    // la limite en moins de clics, ce facteur garde les drops/jour ∝ à la limite.
    const drops = [];
    const roll  = () => Math.random();
    const boostMult = owned.includes("drop_booster") ? 2.0 : 1.0;
    const ballMult  = clickReward(owned); // 1 à 5 selon la ball possédée
    const dropMult  = boostMult * comboMult * ballMult;

    // Pokéball : toujours actif
    if (roll() < 0.000375 * dropMult) { drops.push("pokeball"); await run(`UPDATE inventory SET pokeball = pokeball + 1 WHERE user_id = ?`, [userId]); }

    // Drops balls (upgrade requis)
    if (owned.includes("superball")  && roll() < 0.0002 * dropMult) { drops.push("superball");  await run(`UPDATE inventory SET superball  = superball  + 1 WHERE user_id = ?`, [userId]); }
    if (owned.includes("hyperball")  && roll() < 0.000025 * dropMult) { drops.push("hyperball");  await run(`UPDATE inventory SET hyperball  = hyperball  + 1 WHERE user_id = ?`, [userId]); }
    if (owned.includes("masterball") && roll() < 0.0000025 * dropMult) { drops.push("masterball"); await run(`UPDATE inventory SET masterball = masterball + 1 WHERE user_id = ?`, [userId]); }

    // Drops items (upgrade requis)
    if (owned.includes("drop_items")) {
      if (roll() < 0.0001875 * dropMult) { drops.push("potion");      await run(`UPDATE inventory SET potion      = potion      + 1 WHERE user_id = ?`, [userId]); }
      if (roll() < 0.000125 * dropMult) { drops.push("resetball");   await run(`UPDATE inventory SET resetball   = resetball   + 1 WHERE user_id = ?`, [userId]); }
      if (roll() < 0.00005 * dropMult) { drops.push("superbonbon"); await run(`UPDATE inventory SET superbonbon = superbonbon + 1 WHERE user_id = ?`, [userId]); }
      if (roll() < 0.0000125 * dropMult) { drops.push("lootbox");    await run(`UPDATE inventory SET lootbox     = lootbox     + 1 WHERE user_id = ?`, [userId]); }
    }

    // Enregistrement de l'historique des drops
    if (drops.length > 0) {
      const today = new Date().toISOString().split("T")[0];
      const counts = {};
      drops.forEach(d => { counts[d] = (counts[d] || 0) + 1; });
      for (const [item, count] of Object.entries(counts)) {
        await run(
          `INSERT INTO pokeclick_drop_log (user_id, date, item, count) VALUES (?,?,?,?)
           ON CONFLICT(user_id, date, item) DO UPDATE SET count = count + ?`,
          [userId, today, item, count, count]
        );
      }
    }

    const newEarned = Math.min(dailyLimit, earned + reward);
    res.json({ success: true, gained: reward, comboMult, remaining: Math.max(0, dailyLimit - newEarned), drops, dailyLimit, stamina, staminaMax });
  } catch (err) {
    console.error("Erreur click:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /stamina/:userId — ancres d'endurance de tous les Pokémon de l'utilisateur
// (actif + remplaçant + tous ceux déjà utilisés). Le front affiche la régén en
// prédisant localement, mais le serveur reste seul juge lors des clics.
router.get("/stamina/:userId", async (req, res) => {
  try {
    const rows = await all(`SELECT pokemon, cur, ts FROM pokeclick_stamina WHERE user_id = ?`, [req.user.id]);
    const map = {};
    for (const r of rows) map[r.pokemon] = { cur: r.cur, ts: r.ts };
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /drops/:userId — historique des 7 derniers jours
router.get("/drops/:userId", async (req, res) => {
  try {
    const rows = await all(
      `SELECT date, item, count FROM pokeclick_drop_log
       WHERE user_id = ? ORDER BY date DESC LIMIT 100`,
      [req.user.id]
    );
    // Convertir en { "2026-05-25": { pokeball: 2, ... }, ... }
    const history = {};
    rows.forEach(({ date, item, count }) => {
      if (!history[date]) history[date] = {};
      history[date][item] = count;
    });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /autoclick — crédite un montant calculé côté client (pas de gains idle)
router.post("/autoclick", async (req, res) => {
  const { amount } = req.body;
  const userId = req.user.id;

  try {
    const rows = await all(`SELECT upgrade_key FROM pokeclick_upgrades WHERE user_id = ?`, [userId]);
    const owned = rows.map(r => r.upgrade_key);
    const dailyLimit = getDailyLimit(owned);

    const earned = await getDailyEarned(userId);
    if (earned >= dailyLimit) return res.json({ gained: 0, remaining: 0 });

    const safeAmount = Math.min(Math.max(0, Math.floor(amount || 0)), 60);
    const gain = Math.min(safeAmount, dailyLimit - earned);

    if (gain > 0) await creditFarm(userId, gain);

    res.json({ gained: gain, remaining: Math.max(0, dailyLimit - Math.min(dailyLimit, earned + gain)) });
  } catch (err) {
    console.error("Erreur autoclick:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /heal — consomme 1 Potion pour restaurer 20 % d'endurance d'un Pokémon
router.post("/heal", async (req, res) => {
  const userId = req.user.id;
  const { pokemon, shiny } = req.body;
  const name = typeof pokemon === "string" ? pokemon : null;
  // Valide AVANT de consommer : un Pokémon inconnu ne doit jamais gâcher une Potion.
  if (!name || !(name in POKEMON_HP)) {
    return res.status(400).json({ error: "Pokémon invalide" });
  }
  try {
    const hp         = POKEMON_HP[name];
    const key        = staminaKey(name, !!shiny);
    const staminaMax = maxStaminaFor(hp);
    const cur        = currentStamina(await loadStaminaRec(userId, key), hp);

    // Déjà au max : on ne consomme pas de Potion (évite le gaspillage sur double-clic).
    if (cur >= staminaMax) {
      return res.json({ success: true, alreadyFull: true, stamina: cur, staminaMax });
    }

    // Décrément atomique : ne réussit que s'il reste au moins 1 Potion
    const upd = await run(
      `UPDATE inventory SET potion = potion - 1 WHERE user_id = ? AND potion > 0`,
      [userId]
    );
    if (!upd.changes) return res.status(400).json({ error: "Aucune Potion disponible" });
    const inv = await get(`SELECT potion FROM inventory WHERE user_id = ?`, [userId]);

    // Restauration d'endurance autoritative (+20 % du max) pour le Pokémon ciblé.
    const stamina = Math.min(staminaMax, cur + staminaMax * 0.2);
    await saveStaminaRec(userId, key, stamina, Date.now());

    res.json({ success: true, potion: inv?.potion ?? 0, stamina, staminaMax });
  } catch (err) {
    console.error("Erreur heal:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
