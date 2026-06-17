import { Router } from "express";
import { run, get, all } from "../db.js";

const router = Router();

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
  const { humanClick, combo } = req.body;
  const userId = req.user.id;

  try {
    const rows = await all(`SELECT upgrade_key FROM pokeclick_upgrades WHERE user_id = ?`, [userId]);
    const owned = rows.map(r => r.upgrade_key);
    const dailyLimit = getDailyLimit(owned);

    const earned = await getDailyEarned(userId);
    if (earned >= dailyLimit) return res.json({ success: true, gained: 0, remaining: 0, drops: [] });

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
    res.json({ success: true, gained: reward, comboMult, remaining: Math.max(0, dailyLimit - newEarned), drops, dailyLimit });
  } catch (err) {
    console.error("Erreur click:", err);
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

// POST /heal — consomme 1 Potion pour restaurer l'endurance d'un Pokémon (PokéClick)
router.post("/heal", async (req, res) => {
  const userId = req.user.id;
  try {
    // Décrément atomique : ne réussit que s'il reste au moins 1 Potion
    const upd = await run(
      `UPDATE inventory SET potion = potion - 1 WHERE user_id = ? AND potion > 0`,
      [userId]
    );
    if (!upd.changes) return res.status(400).json({ error: "Aucune Potion disponible" });
    const inv = await get(`SELECT potion FROM inventory WHERE user_id = ?`, [userId]);
    res.json({ success: true, potion: inv?.potion ?? 0 });
  } catch (err) {
    console.error("Erreur heal:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
