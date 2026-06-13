import { Router }        from "express";
import { run, get, all } from "../db.js";
import { verifyToken, verifyAdmin, optionalToken } from "../middleware/auth.js";
import { getIO, getConnectedUserIds } from "../socket.js";

const router = Router();

export const VALID_ITEMS = new Set(["pokeball","superball","hyperball","masterball","resetball","superbonbon","potion","lootbox","pokedollars"]);

export async function giveReward(userId, rewardData) {
  for (const [item, qty] of Object.entries(rewardData)) {
    if (item.startsWith("_") || !VALID_ITEMS.has(item) || !qty) continue;
    if (item === "pokedollars") {
      await run(`UPDATE inventory SET pokedollars = pokedollars + ? WHERE user_id = ?`, [qty, userId]);
    } else {
      await run(`UPDATE inventory SET ${item} = COALESCE(${item}, 0) + ? WHERE user_id = ?`, [qty, userId]);
    }
  }
}

// Retire les champs privés (_answer, _multiplier, etc.) avant d'envoyer au client
function publicEvent(event) {
  if (!event) return null;
  const rd = JSON.parse(event.reward_data || "{}");
  const publicRd = Object.fromEntries(Object.entries(rd).filter(([k]) => !k.startsWith("_")));
  return { ...event, rewardData: publicRd };
}

// ── GET /api/events/active ──────────────────────────────────────────
// Note : datetime(ends_at) normalise le format ISO ("...T...Z") stocké par
// new Date().toISOString() — une comparaison texte brute avec datetime('now')
// était toujours vraie ('T' > ' ') et les événements n'expiraient jamais.
router.get("/active", optionalToken, async (req, res) => {
  try {
    // Filet de sécurité : désactive les événements expirés dont le timer
    // mémoire a été perdu (ex. redémarrage du serveur)
    await run(`
      UPDATE events SET is_active = 0
      WHERE is_active = 1 AND ends_at IS NOT NULL AND datetime(ends_at) <= datetime('now')
    `);
    const event = await get(`
      SELECT * FROM events
      WHERE is_active = 1
        AND (ends_at IS NULL OR datetime(ends_at) > datetime('now'))
        AND (type NOT IN ('premier_clic','devinette') OR claimed_by IS NULL)
      ORDER BY started_at DESC LIMIT 1
    `);
    res.json(publicEvent(event));
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ── GET /api/events/history ─────────────────────────────────────────
router.get("/history", verifyAdmin, async (req, res) => {
  try {
    const rows = await all(`SELECT * FROM events ORDER BY started_at DESC LIMIT 50`);
    res.json(rows.map(r => ({
      ...r,
      rewardData: (() => { try { return JSON.parse(r.reward_data || "{}"); } catch { return {}; } })(),
    })));
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ── POST /api/events/create (admin) ────────────────────────────────
router.post("/create", verifyAdmin, async (req, res) => {
  const { type, title, description, rewardData = {}, durationSeconds } = req.body;
  if (!type || !title) return res.status(400).json({ error: "type et title requis" });

  const VALID_TYPES = ["premier_clic", "pluie", "annonce", "double_xp", "devinette", "tirage", "pokemon_rare", "sondage"];
  if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: "Type invalide" });

  try {
    await run(`UPDATE events SET is_active = 0 WHERE is_active = 1`);

    const defaultDuration = type === "annonce" && !durationSeconds ? 7200 : durationSeconds;
    const endsAt = defaultDuration
      ? new Date(Date.now() + defaultDuration * 1000).toISOString()
      : null;

    const result = await run(`
      INSERT INTO events (type, title, description, reward_data, duration_seconds, ends_at, is_active, created_by)
      VALUES (?,?,?,?,?,?,1,?)
    `, [type, title, description || "", JSON.stringify(rewardData), durationSeconds || null, endsAt, req.user.id]);

    const event = await get(`SELECT * FROM events WHERE id = ?`, [result.lastID]);
    const payload = publicEvent(event);

    // Pluie → distribuer immédiatement à tous
    if (type === "pluie") {
      const publicRd = Object.fromEntries(Object.entries(rewardData).filter(([k]) => !k.startsWith("_")));
      const users = await all(`SELECT id FROM users WHERE role != 'admin'`);
      for (const u of users) await giveReward(u.id, publicRd);
      await run(`UPDATE events SET is_active = 0 WHERE id = ?`, [result.lastID]);
      payload.is_active = 0;
      payload.rewardData = publicRd;
      // Émettre start puis end après 4s pour que l'overlay apparaisse puis se ferme
      getIO()?.emit("event:start", payload);
      setTimeout(() => getIO()?.emit("event:end", { reason: "distributed", rewardData: publicRd }), 4000);
      return res.json({ success: true, event: payload });
    }

    // Double XP / Pokémon Rare → auto-expiration via ends_at (géré par /active)

    // Tirage au Sort → auto-draw si des joueurs sont connectés
    if (type === "tirage") {
      const connectedIds = getConnectedUserIds(req.user.id);
      if (connectedIds.length > 0) {
        const winnerId   = connectedIds[Math.floor(Math.random() * connectedIds.length)];
        const winnerRow  = await get("SELECT id, username FROM users WHERE id = ?", [winnerId]);
        if (winnerRow) {
          const publicRd = Object.fromEntries(Object.entries(rewardData).filter(([k]) => !k.startsWith("_")));
          await giveReward(winnerId, publicRd);
          await run(`UPDATE events SET claimed_by=?, winner_username=?, is_active=0, claimed_at=datetime('now') WHERE id=?`,
            [winnerId, winnerRow.username, result.lastID]);
          payload.winner_username = winnerRow.username;
          payload.is_active = 0;
          getIO()?.emit("event:start",   payload);
          getIO()?.emit("event:claimed", { eventId: result.lastID, winner: winnerRow.username, rewardData: publicRd });
          setTimeout(() => getIO()?.emit("event:end", { reason: "claimed", winner: winnerRow.username }), 3000);
          return res.json({ success: true, event: payload });
        }
      }
    }

    getIO()?.emit("event:start", payload);

    // Auto-end quand ends_at est atteint
    if (endsAt && type !== "tirage") {
      const delay = new Date(endsAt).getTime() - Date.now();
      if (delay > 0) {
        setTimeout(async () => {
          await run(`UPDATE events SET is_active = 0 WHERE id = ? AND is_active = 1`, [result.lastID]);
          getIO()?.emit("event:end", { reason: "expired" });
        }, delay);
      }
    }

    res.json({ success: true, event: payload });
  } catch (err) {
    console.error("Erreur création événement:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── POST /api/events/cancel (admin) ────────────────────────────────
router.post("/cancel", verifyAdmin, async (req, res) => {
  try {
    await run(`UPDATE events SET is_active = 0 WHERE is_active = 1`);
    getIO()?.emit("event:end", { reason: "cancelled" });
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ── POST /api/events/draw (admin, tirage manuel) ────────────────────
router.post("/draw", verifyAdmin, async (req, res) => {
  const { eventId } = req.body;
  try {
    const event = await get(`SELECT * FROM events WHERE id=? AND type='tirage' AND is_active=1 AND claimed_by IS NULL`, [eventId]);
    if (!event) return res.status(400).json({ error: "Aucun tirage actif" });

    const connectedIds = getConnectedUserIds(req.user.id);
    if (!connectedIds.length) return res.status(400).json({ error: "Aucun joueur connecté pour le tirage" });

    const winnerId  = connectedIds[Math.floor(Math.random() * connectedIds.length)];
    const winnerRow = await get("SELECT id, username FROM users WHERE id = ?", [winnerId]);
    if (!winnerRow) return res.status(500).json({ error: "Erreur sélection gagnant" });

    const rewardData = JSON.parse(event.reward_data || "{}");
    const publicRd   = Object.fromEntries(Object.entries(rewardData).filter(([k]) => !k.startsWith("_")));

    await giveReward(winnerId, publicRd);
    await run(`UPDATE events SET claimed_by=?, winner_username=?, is_active=0, claimed_at=datetime('now') WHERE id=?`,
      [winnerId, winnerRow.username, eventId]);

    getIO()?.emit("event:claimed", { eventId, winner: winnerRow.username, rewardData: publicRd });
    getIO()?.emit("event:end",     { reason: "claimed", winner: winnerRow.username });

    res.json({ success: true, winner: winnerRow.username });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ── POST /api/events/claim (premier_clic) ──────────────────────────
router.post("/claim", verifyToken, async (req, res) => {
  const { eventId } = req.body;
  const userId   = req.user.id;
  const username = req.user.username;
  try {
    const event = await get(`SELECT * FROM events WHERE id=? AND type='premier_clic' AND is_active=1 AND claimed_by IS NULL`, [eventId]);
    if (!event) return res.status(409).json({ error: "Déjà réclamé ou expiré !" });

    const upd = await run(`UPDATE events SET claimed_by=?, claimed_at=datetime('now'), winner_username=?, is_active=0 WHERE id=? AND claimed_by IS NULL`,
      [userId, username, eventId]);
    if (upd.changes === 0) return res.status(409).json({ error: "Trop tard !" });

    const rd = JSON.parse(event.reward_data || "{}");
    const publicRd = Object.fromEntries(Object.entries(rd).filter(([k]) => !k.startsWith("_")));
    await giveReward(userId, publicRd);

    getIO()?.emit("event:claimed", { eventId, winner: username, rewardData: publicRd });
    getIO()?.emit("event:end",     { reason: "claimed", winner: username });
    res.json({ success: true, winner: username, rewardData: publicRd });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ── POST /api/events/answer (devinette) ────────────────────────────
router.post("/answer", verifyToken, async (req, res) => {
  const { eventId, answer } = req.body;
  const userId   = req.user.id;
  const username = req.user.username;
  if (!answer?.trim()) return res.status(400).json({ error: "Réponse vide" });
  try {
    const event = await get(`SELECT * FROM events WHERE id=? AND type='devinette' AND is_active=1 AND claimed_by IS NULL`, [eventId]);
    if (!event) return res.status(409).json({ error: "Événement terminé ou déjà remporté !" });

    const rd = JSON.parse(event.reward_data || "{}");
    const correct = (rd._answer || "").trim().toLowerCase();
    if (answer.trim().toLowerCase() !== correct) return res.status(400).json({ error: "Mauvaise réponse !" });

    const upd = await run(`UPDATE events SET claimed_by=?, claimed_at=datetime('now'), winner_username=?, is_active=0 WHERE id=? AND claimed_by IS NULL`,
      [userId, username, eventId]);
    if (upd.changes === 0) return res.status(409).json({ error: "Trop tard !" });

    const publicRd = Object.fromEntries(Object.entries(rd).filter(([k]) => !k.startsWith("_")));
    await giveReward(userId, publicRd);

    getIO()?.emit("event:claimed", { eventId, winner: username, rewardData: publicRd });
    getIO()?.emit("event:end",     { reason: "claimed", winner: username });
    res.json({ success: true, winner: username, rewardData: publicRd });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ── POST /api/events/vote (sondage) ────────────────────────────────
router.post("/vote", verifyToken, async (req, res) => {
  const { eventId, optionIndex } = req.body;
  const userId = req.user.id;
  if (optionIndex === undefined || optionIndex === null) return res.status(400).json({ error: "optionIndex requis" });
  try {
    const event = await get(`SELECT * FROM events WHERE id=? AND type='sondage' AND is_active=1`, [eventId]);
    if (!event) return res.status(409).json({ error: "Sondage terminé ou introuvable" });

    const rd      = JSON.parse(event.reward_data || "{}");
    const options = rd.options || [];
    if (optionIndex < 0 || optionIndex >= options.length) return res.status(400).json({ error: "Option invalide" });

    try {
      await run(`INSERT INTO poll_votes (event_id, user_id, option_index) VALUES (?,?,?)`, [eventId, userId, optionIndex]);
    } catch {
      return res.status(409).json({ error: "Tu as déjà voté !" });
    }

    getIO()?.emit("poll:vote", { eventId });
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ── GET /api/events/poll-results/:eventId (admin) ──────────────────
router.get("/poll-results/:eventId", verifyAdmin, async (req, res) => {
  try {
    const event = await get(`SELECT * FROM events WHERE id=? AND type='sondage'`, [req.params.eventId]);
    if (!event) return res.status(404).json({ error: "Sondage introuvable" });

    const rd      = JSON.parse(event.reward_data || "{}");
    const options = rd.options || [];

    const rows  = await all(`SELECT option_index, COUNT(*) as count FROM poll_votes WHERE event_id=? GROUP BY option_index`, [req.params.eventId]);
    const votes = options.map((_, i) => (rows.find(r => r.option_index === i)?.count || 0));
    const total = votes.reduce((a, b) => a + b, 0);

    res.json({ options, votes, total });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ── GET /api/events/my-vote/:eventId (joueur connecté) ─────────────
router.get("/my-vote/:eventId", verifyToken, async (req, res) => {
  try {
    const row = await get(`SELECT option_index FROM poll_votes WHERE event_id=? AND user_id=?`, [req.params.eventId, req.user.id]);
    res.json({ voted: !!row, optionIndex: row?.option_index ?? null });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ── Reprise des timers d'expiration après redémarrage ───────────────
// L'auto-expiration repose sur un setTimeout en mémoire : il est perdu quand
// le process redémarre (pm2 restart, crash). Au démarrage, on désactive les
// événements déjà expirés et on reprogramme les timers de ceux encore actifs.
export async function resumeEventTimers() {
  try {
    const rows = await all(`SELECT id, ends_at FROM events WHERE is_active = 1 AND ends_at IS NOT NULL`);
    for (const ev of rows) {
      const delay = new Date(ev.ends_at).getTime() - Date.now();
      const expire = async () => {
        const upd = await run(`UPDATE events SET is_active = 0 WHERE id = ? AND is_active = 1`, [ev.id]);
        if (upd.changes > 0) getIO()?.emit("event:end", { reason: "expired" });
      };
      if (delay <= 0) {
        await expire();
        console.log(`🧹 Événement ${ev.id} expiré pendant l'arrêt du serveur — désactivé`);
      } else {
        setTimeout(() => expire().catch(() => {}), delay);
        console.log(`⏰ Timer d'expiration repris pour l'événement ${ev.id} (dans ${Math.round(delay / 1000)}s)`);
      }
    }
  } catch (err) {
    console.error("Erreur resumeEventTimers:", err);
  }
}

export default router;
