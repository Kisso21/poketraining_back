import { Router } from "express";
import { run, get, all } from "../db.js";

const router = Router();
const MAX_TEAMS = 10;

// GET /:username — liste des équipes favorites
router.get("/:username", async (req, res) => {
  try {
    const rows = await all(
      `SELECT id, name, slots_json, created_at FROM user_teams WHERE username = ? ORDER BY id DESC`,
      [req.user.username]
    );
    const teams = rows.map(r => {
      let slots = [];
      try { slots = JSON.parse(r.slots_json) || []; } catch {}
      return { id: r.id, name: r.name, slots, createdAt: r.created_at };
    });
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:username — sauvegarder une nouvelle équipe favorite
router.post("/:username", async (req, res) => {
  const username = req.user.username;
  const { name, slots } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Nom manquant" });
  if (!Array.isArray(slots) || slots.length !== 6 || slots.some(s => !s || !s.name)) {
    return res.status(400).json({ error: "L'équipe doit contenir 6 Pokémon" });
  }
  try {
    const countRow = await get(`SELECT COUNT(*) AS n FROM user_teams WHERE username = ?`, [username]);
    if ((countRow?.n || 0) >= MAX_TEAMS) {
      return res.status(400).json({ error: `Limite de ${MAX_TEAMS} équipes atteinte` });
    }
    const cleanSlots = slots.map(s => ({ name: String(s.name), isShiny: !!s.isShiny }));
    const result = await run(
      `INSERT INTO user_teams (username, name, slots_json) VALUES (?,?,?)`,
      [username, name.trim().slice(0, 40), JSON.stringify(cleanSlots)]
    );
    res.json({ success: true, id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:username/:teamId — supprimer une équipe favorite
router.delete("/:username/:teamId", async (req, res) => {
  try {
    await run(
      `DELETE FROM user_teams WHERE username = ? AND id = ?`,
      [req.user.username, req.params.teamId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
