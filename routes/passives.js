import { Router } from "express";
import { run, get, all } from "../db.js";

const router = Router();
const LABELS = { charmechroma:"Charme Chroma", appat:"Appât", luckycoin:"Lucky Coin", glitch:"Glitch" };

async function getUserId(username) {
  const row = await get(`SELECT id FROM users WHERE username = ?`, [username]);
  return row?.id ?? null;
}

// GET /api/passives/:username
router.get("/:username", async (req, res) => {
  try {
    const userId = await getUserId(req.user.username);
    if (!userId) return res.status(404).json({ error: "Utilisateur introuvable" });

    const rows = await all(`SELECT item, unlocked, active FROM user_passives WHERE user_id = ?`, [userId]);
    const passives = {};
    rows.forEach(r => { passives[r.item] = { item: r.item, unlocked: !!r.unlocked, active: !!r.active }; });
    res.json(Object.values(passives));
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/passives/:username/toggle
router.post("/:username/toggle", async (req, res) => {
  const { item } = req.body;
  if (!item) return res.status(400).json({ error: "Item manquant" });

  try {
    const userId = await getUserId(req.user.username);
    if (!userId) return res.status(404).json({ error: "Utilisateur introuvable" });

    const row = await get(`SELECT unlocked, active FROM user_passives WHERE user_id = ? AND item = ?`, [userId, item]);
    if (!row)          return res.status(404).json({ error: "Objet inconnu" });
    if (!row.unlocked) return res.status(403).json({ error: "Objet non débloqué" });

    const newState = row.active ? 0 : 1;
    await run(`UPDATE user_passives SET active = 0 WHERE user_id = ?`, [userId]);
    if (newState === 1) {
      await run(`UPDATE user_passives SET active = 1 WHERE user_id = ? AND item = ?`, [userId, item]);
    }

    const rows = await all(`SELECT item, unlocked, active FROM user_passives WHERE user_id = ?`, [userId]);
    const passives = {};
    rows.forEach(r => { passives[r.item] = { item: r.item, unlocked: !!r.unlocked, active: !!r.active }; });

    res.json({
      success: true,
      message: newState ? `✅ ${LABELS[item]} activé` : `❌ ${LABELS[item]} désactivé`,
      passives: Object.values(passives),
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
