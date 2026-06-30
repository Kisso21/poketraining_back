import { Router } from "express";
import { run, get } from "../db.js";
import { checkCasinoUnlock } from "./achievements.js";
import { addToJackpot } from "./jackpot.js";
import { getIO } from "../socket.js";

const router = Router();
const DAILY_LIMIT = 5000;
const POKEDOLLARS_DAILY_LIMIT = 50000;
const MAX_POKEDOLLARS_DELTA = 5000;
// Plafond plus élevé pour les DÉPENSES (montant négatif) : certains achats serveur
// (ex. expédition safari à 10 000₽) dépassent le plafond des gains.
const MAX_SPEND_DELTA = 100000;
const MAX_ITEM_REWARD = 10;
const VALID_ITEMS = new Set(["pokeball","superball","hyperball","masterball","resetball","superbonbon","potion","lootbox"]);

function parseInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

async function getDailyEarned(userId, today) {
  const row = await get(`SELECT earned FROM daily_rewards WHERE user_id = ? AND date = ?`, [userId, today]);
  return row ? Number(row.earned) || 0 : 0;
}

async function creditDailyPokedollars(userId, amount, today, limit) {
  const current = await getDailyEarned(userId, today);
  if (current >= limit) return { credited: 0, capped: true };
  const credited = Math.min(amount, limit - current);
  await run(`UPDATE inventory SET pokedollars = COALESCE(pokedollars,0) + ? WHERE user_id = ?`, [credited, userId]);
  await run(
    `INSERT INTO daily_rewards (user_id, date, earned) VALUES (?,?,?)
     ON CONFLICT(user_id, date) DO UPDATE SET earned = earned + ?`,
    [userId, today, credited, credited]
  );
  return { credited, capped: credited < amount };
}

// POST /api/reward
router.post("/reward", async (req, res) => {
  const { rewardType } = req.body;
  const amount = parseInteger(req.body.amount);
  const userId = req.user.id;
  if (!rewardType || amount == null || amount <= 0)
    return res.status(400).json({ error: "Paramètres invalides" });

  const today = new Date().toISOString().split("T")[0];

  try {
    if (rewardType === "pokedollars") {
      if (amount > MAX_POKEDOLLARS_DELTA) return res.status(400).json({ error: "Gain trop élevé" });
      const result = await creditDailyPokedollars(userId, amount, today, DAILY_LIMIT);
      if (result.credited <= 0) return res.status(400).json({ error: "⚠️ Limite quotidienne atteinte !" });
      const inv = await get(`SELECT pokedollars, pokeball, superball, hyperball, masterball, resetball, superbonbon, potion, lootbox FROM inventory WHERE user_id = ?`, [userId]);
      getIO()?.emit("sync:inventory", { userId, inventory: inv });
      return res.json({ success: true, inventory: inv, credited: result.credited, capped: result.capped });
    }

    if (rewardType === "bonus") {
      const safeAmount = Math.min(amount, 50000);
      const result = await creditDailyPokedollars(userId, safeAmount, today, 100000);
      if (result.credited <= 0) return res.status(400).json({ error: "Limite journalière atteinte" });
      const inv = await get(`SELECT pokedollars, pokeball, superball, hyperball, masterball, resetball, superbonbon, potion, lootbox FROM inventory WHERE user_id = ?`, [userId]);
      getIO()?.emit("sync:inventory", { userId, inventory: inv });
      return res.json({ success: true, inventory: inv, credited: result.credited, capped: result.capped });
    }

    if (!VALID_ITEMS.has(rewardType)) return res.status(400).json({ error: "Type invalide" });
    if (amount > MAX_ITEM_REWARD) return res.status(400).json({ error: "Quantité trop élevée" });
    await run(`UPDATE inventory SET ${rewardType} = ${rewardType} + ? WHERE user_id = ?`, [amount, userId]);
    const inv = await get(`SELECT pokedollars, pokeball, superball, hyperball, masterball, resetball, superbonbon, potion, lootbox FROM inventory WHERE user_id = ?`, [userId]);
    getIO()?.emit("sync:inventory", { userId, inventory: inv });
    return res.json({ success: true, inventory: inv });
  } catch (err) {
    console.error("Erreur reward:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/farm-progress/:userId
router.get("/farm-progress/:userId", async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  try {
    const row = await get(`SELECT earned FROM daily_farm WHERE user_id = ? AND date = ?`, [req.user.id, today]);
    const earned = row ? Number(row.earned) || 0 : 0;
    res.json({ earned, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - earned), percent: Math.min(100, (earned / DAILY_LIMIT) * 100) });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/pokedollars/:userId
router.get("/pokedollars/:userId", async (req, res) => {
  try {
    const row = await get(`SELECT pokedollars FROM inventory WHERE user_id = ?`, [req.user.id]);
    if (!row) return res.status(404).json({ error: "Introuvable" });
    res.json({ pokedollars: row.pokedollars });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/pokedollars
router.post("/pokedollars", async (req, res) => {
  const pokedollars = parseInteger(req.body.pokedollars);
  const userId   = req.user.id;

  if (pokedollars == null || pokedollars === 0)
    return res.status(400).json({ error: "Montant invalide" });
  // ⛔ AUCUN crédit positif accepté ici. Les gains sont attribués UNIQUEMENT par le
  // serveur (fin de partie via /game/reset, casino via casinoGames.js, safari via
  // safari-reward, etc.). Cette route ne sert plus qu'aux DÉPENSES (montant négatif),
  // ce qui ferme définitivement la faille d'auto-crédit illimité.
  if (pokedollars > 0)
    return res.status(403).json({ error: "Crédit non autorisé : les gains sont attribués par le serveur." });
  if (Math.abs(pokedollars) > MAX_SPEND_DELTA)
    return res.status(400).json({ error: "Montant trop élevé" });

  try {
    const inv = await get(`SELECT pokedollars FROM inventory WHERE user_id = ?`, [userId]);
    if (!inv) return res.status(404).json({ error: "Introuvable" });

    // Bonus tresorier + luckycoin
    const ts          = await get(`SELECT stat_tresorier FROM trainer_stats WHERE user_id = ?`, [userId]);
    const tresorier   = ts?.stat_tresorier || 0;
    const baseGain    = pokedollars > 0 ? pokedollars + tresorier * 3 : pokedollars;

    const passive     = await get(`SELECT active FROM user_passives WHERE user_id = ? AND item = 'luckycoin'`, [userId]);
    const shouldBonus = passive?.active === 1 && pokedollars > 0;
    const requestedGain = shouldBonus ? Math.round(baseGain * 1.25) : baseGain;

    if (requestedGain < 0) {
      if ((inv.pokedollars || 0) + requestedGain < 0)
        return res.status(400).json({ error: "Pas assez de Pokédollars" });
      await run(`UPDATE inventory SET pokedollars = COALESCE(pokedollars,0) + ? WHERE user_id = ?`, [requestedGain, userId]);
      const row = await get(`SELECT pokedollars FROM inventory WHERE user_id = ?`, [userId]);
      getIO()?.emit("sync:inventory", { userId, inventory: { pokedollars: row.pokedollars } });
      return res.json({ success: true, pokedollars: row.pokedollars, appliedBonus: false, gained: requestedGain });
    }

    await run(`UPDATE inventory SET pokedollars = COALESCE(pokedollars,0) + ? WHERE user_id = ?`, [requestedGain, userId]);
    const row = await get(`SELECT pokedollars FROM inventory WHERE user_id = ?`, [userId]);
    checkCasinoUnlock(userId, row.pokedollars).catch(() => {});
    getIO()?.emit("sync:inventory", { userId, inventory: { pokedollars: row.pokedollars } });
    res.json({ success: true, pokedollars: row.pokedollars, appliedBonus: shouldBonus, gained: requestedGain });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
