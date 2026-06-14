import { Router } from "express";
import { run, get, all } from "../db.js";
import { emitToUser } from "../socket.js";

const router = Router();

/**
 * Crée une notification persistée pour un joueur et la pousse en temps réel
 * (event socket "notification") s'il est connecté.
 * @param {number} userId   destinataire
 * @param {string} type     ex: "trade_sold", "trade_exchanged"
 * @param {string} message  texte affiché
 * @param {object} [data]   payload optionnel (sérialisé en JSON)
 */
export async function pushNotification(userId, type, message, data = null) {
  if (!userId) return;
  const dataStr = data ? JSON.stringify(data) : null;
  const res = await run(
    `INSERT INTO notifications (user_id, type, message, data) VALUES (?,?,?,?)`,
    [userId, type, message, dataStr]
  );
  emitToUser(userId, "notification", {
    id: res?.lastID,
    type,
    message,
    data,
    is_read: 0,
    created_at: new Date().toISOString(),
  });
}

/* ── GET /api/notifications — liste récente + nombre non lus ─────── */
router.get("/", async (req, res) => {
  try {
    const rows = await all(
      `SELECT id, type, message, data, is_read, created_at
       FROM notifications WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    const unread = await get(
      `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0`,
      [req.user.id]
    );
    const notifications = rows.map(r => ({
      ...r,
      data: r.data ? JSON.parse(r.data) : null,
    }));
    res.json({ notifications, unread: unread?.c || 0 });
  } catch (err) {
    console.error("Erreur GET notifications:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* ── POST /api/notifications/read — marque comme lues ───────────── */
router.post("/read", async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (Array.isArray(ids) && ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      await run(
        `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${placeholders})`,
        [req.user.id, ...ids]
      );
    } else {
      await run(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [req.user.id]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Erreur POST notifications/read:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
