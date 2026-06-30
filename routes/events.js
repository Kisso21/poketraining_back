import { Router }        from "express";
import { run, get, all } from "../db.js";
import { verifyToken, verifyAdmin, optionalToken } from "../middleware/auth.js";
import { getIO, emitToUser } from "../socket.js";
import { checkAchievements } from "./achievements.js";

const router = Router();

export const VALID_ITEMS = new Set(["pokeball","superball","hyperball","masterball","resetball","superbonbon","potion","lootbox","pokedollars","ticketsafari","goldappat","sablier","charmeeclaire"]);

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

// ── Tirage au Sort : fenêtre d'inscription puis roue animée ─────────
const TIRAGE_WHEEL_MS = 10000; // durée de l'animation de la roue côté client
const tirageTimers = new Map(); // eventId -> timeout (fin d'inscription)

// Exécute le tirage animé : choisit le gagnant, donne la récompense,
// broadcast la roue, puis révèle le gagnant à la fin de l'animation.
async function runTirageDraw(eventId) {
  const event = await get(
    `SELECT * FROM events WHERE id=? AND type='tirage' AND is_active=1 AND claimed_by IS NULL`,
    [eventId]
  );
  if (!event) return null;

  const entries  = await all(`SELECT user_id, username FROM tirage_entries WHERE event_id=?`, [eventId]);
  const rd       = JSON.parse(event.reward_data || "{}");
  const publicRd = Object.fromEntries(Object.entries(rd).filter(([k]) => !k.startsWith("_")));

  // Aucun inscrit → on clôture sans gagnant
  if (entries.length === 0) {
    await run(`UPDATE events SET is_active=0 WHERE id=?`, [eventId]);
    await run(`DELETE FROM tirage_entries WHERE event_id=?`, [eventId]);
    getIO()?.emit("event:end", { reason: "expired" });
    return { winner: null };
  }

  const win = entries[Math.floor(Math.random() * entries.length)];
  await giveReward(win.user_id, publicRd);
  await run(
    `UPDATE events SET claimed_by=?, winner_username=?, is_active=0, claimed_at=datetime('now') WHERE id=?`,
    [win.user_id, win.username, eventId]
  );
  await run(`DELETE FROM tirage_entries WHERE event_id=?`, [eventId]);

  // Tout le monde voit la même roue (mêmes participants, même gagnant)
  getIO()?.emit("tirage:draw", {
    eventId,
    participants: entries.map(e => e.username),
    winner:       win.username,
    durationMs:   TIRAGE_WHEEL_MS,
    rewardData:   publicRd,
  });

  // Révélation synchronisée à la fin de l'animation
  setTimeout(() => {
    getIO()?.emit("event:claimed", { eventId, winner: win.username, rewardData: publicRd });
    getIO()?.emit("event:end",     { reason: "claimed", winner: win.username });
  }, TIRAGE_WHEEL_MS + 600);

  return { winner: win.username };
}

function scheduleTirageDraw(eventId, delayMs) {
  if (tirageTimers.has(eventId)) clearTimeout(tirageTimers.get(eventId));
  const t = setTimeout(() => {
    tirageTimers.delete(eventId);
    runTirageDraw(eventId).catch(() => {});
  }, Math.max(0, delayMs));
  tirageTimers.set(eventId, t);
}

// ── Enchères : fenêtre de mises, le plus offrant remporte le lot ─────
const auctionTimers = new Map(); // eventId -> timeout (clôture des enchères)

// Mise minimale suivante : meilleure offre + incrément, ou prix de départ
function nextMinBid(rd, current) {
  const startBid = Math.max(parseInt(rd._startBid) || 0, 1);
  const minInc   = Math.max(parseInt(rd._minInc)   || 1, 1);
  return current ? current.amount + minInc : startBid;
}

// Clôture l'enchère : le meneur conserve sa mise (déjà retenue) et reçoit le lot.
async function settleAuction(eventId) {
  const event = await get(
    `SELECT * FROM events WHERE id=? AND type='enchere' AND is_active=1 AND claimed_by IS NULL`,
    [eventId]
  );
  if (!event) return null;

  const rd       = JSON.parse(event.reward_data || "{}");
  const publicRd = Object.fromEntries(Object.entries(rd).filter(([k]) => !k.startsWith("_")));
  const top      = await get(`SELECT * FROM auction_bids WHERE event_id=?`, [eventId]);

  // Aucune mise → on clôture sans gagnant
  if (!top) {
    await run(`UPDATE events SET is_active=0 WHERE id=?`, [eventId]);
    getIO()?.emit("event:end", { reason: "expired" });
    return { winner: null };
  }

  await giveReward(top.user_id, publicRd);

  // Lot Pokémon (optionnel) → Pokédex si le gagnant ne l'a pas encore,
  // sinon (doublon) dans sa réserve. Même logique que la capture en jeu.
  const pkmn  = publicRd.pokemon;
  if (pkmn?.name) {
    const shiny = pkmn.shiny ? 1 : 0;
    const label = `${pkmn.shiny ? "✨ " : ""}${pkmn.name}`;
    const ins = await run(
      `INSERT OR IGNORE INTO captures (user_id, pokemon_name, is_shiny) VALUES (?,?,?)`,
      [top.user_id, pkmn.name, shiny]
    );
    if (ins.changes === 0) {
      // Déjà dans le Pokédex → le double part en réserve (revendable)
      await run(
        `INSERT INTO pokemon_reserve (user_id, pokemon_name, is_shiny) VALUES (?,?,?)`,
        [top.user_id, pkmn.name, shiny]
      );
      getIO()?.emit("sync:pokedex", { userId: top.user_id, pokemonName: pkmn.name, isShiny: shiny, addedToReserve: true, newAchievements: [] });
      emitToUser(top.user_id, "notification", {
        message: `Tu remportes ${label} aux enchères ! Tu l'avais déjà : le double t'attend dans ta réserve.`,
      });
    } else {
      // Nouveau → ajouté au Pokédex
      const newAchievements = await checkAchievements(top.user_id).catch(() => []);
      getIO()?.emit("sync:pokedex", { userId: top.user_id, pokemonName: pkmn.name, isShiny: shiny, addedToReserve: false, newAchievements });
      emitToUser(top.user_id, "notification", {
        message: `Tu remportes ${label} aux enchères ! Nouveau : il rejoint ton Pokédex.`,
      });
    }
  }

  await run(
    `UPDATE events SET claimed_by=?, winner_username=?, is_active=0, claimed_at=datetime('now') WHERE id=?`,
    [top.user_id, top.username, eventId]
  );
  await run(`DELETE FROM auction_bids WHERE event_id=?`, [eventId]);

  getIO()?.emit("event:claimed", { eventId, winner: top.username, rewardData: publicRd });
  getIO()?.emit("event:end",     { reason: "claimed", winner: top.username });
  emitToUser(top.user_id, "sync:inventory", {}); // le lot vient d'arriver
  return { winner: top.username };
}

function scheduleAuctionSettle(eventId, delayMs) {
  if (auctionTimers.has(eventId)) clearTimeout(auctionTimers.get(eventId));
  const t = setTimeout(() => {
    auctionTimers.delete(eventId);
    settleAuction(eventId).catch(() => {});
  }, Math.max(0, delayMs));
  auctionTimers.set(eventId, t);
}

// Rembourse le meneur courant (mise retenue) — utilisé à l'annulation
async function refundAuctionLeader(eventId) {
  const top = await get(`SELECT * FROM auction_bids WHERE event_id=?`, [eventId]);
  if (!top) return;
  await run(`UPDATE inventory SET pokedollars = pokedollars + ? WHERE user_id = ?`, [top.amount, top.user_id]);
  await run(`DELETE FROM auction_bids WHERE event_id=?`, [eventId]);
  emitToUser(top.user_id, "sync:inventory", {});
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
    const payload = publicEvent(event);
    // Tirage en cours : compteur d'inscrits + statut perso
    if (payload?.type === "tirage") {
      const cnt = await get(`SELECT COUNT(*) AS cnt FROM tirage_entries WHERE event_id=?`, [payload.id]);
      payload.tirageCount = cnt?.cnt ?? 0;
      payload.tirageJoined = req.user
        ? !!(await get(`SELECT 1 FROM tirage_entries WHERE event_id=? AND user_id=?`, [payload.id, req.user.id]))
        : false;
    }
    // Enchère en cours : meilleure offre + mise minimale suivante
    if (payload?.type === "enchere") {
      const rd  = JSON.parse(event.reward_data || "{}");
      const top = await get(`SELECT * FROM auction_bids WHERE event_id=?`, [payload.id]);
      payload.auctionStart  = Math.max(parseInt(rd._startBid) || 0, 1);
      payload.auctionBid    = top?.amount ?? 0;
      payload.auctionBidder = top?.username ?? null;
      payload.auctionMin    = nextMinBid(rd, top);
      payload.auctionIsMine = req.user && top ? top.user_id === req.user.id : false;
    }
    res.json(payload);
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

  const VALID_TYPES = ["premier_clic", "pluie", "annonce", "double_xp", "devinette", "tirage", "pokemon_rare", "sondage", "enchere"];
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

    // Tirage au Sort → ouvre une fenêtre d'inscription, puis roue animée à la fin
    if (type === "tirage") {
      getIO()?.emit("event:start", payload);
      const delay = endsAt ? new Date(endsAt).getTime() - Date.now() : 60000;
      scheduleTirageDraw(result.lastID, delay);
      return res.json({ success: true, event: payload });
    }

    // Enchères → fenêtre de mises, le plus offrant remporte le lot à la clôture
    if (type === "enchere") {
      payload.auctionStart  = Math.max(parseInt(rewardData._startBid) || 0, 1);
      payload.auctionBid    = 0;
      payload.auctionBidder = null;
      payload.auctionMin    = payload.auctionStart;
      getIO()?.emit("event:start", payload);
      const delay = endsAt ? new Date(endsAt).getTime() - Date.now() : 120000;
      scheduleAuctionSettle(result.lastID, delay);
      return res.json({ success: true, event: payload });
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
    // Enchère en cours : rembourser la mise retenue du meneur avant clôture
    const auction = await get(`SELECT id FROM events WHERE is_active=1 AND type='enchere'`);
    if (auction) {
      if (auctionTimers.has(auction.id)) { clearTimeout(auctionTimers.get(auction.id)); auctionTimers.delete(auction.id); }
      await refundAuctionLeader(auction.id);
    }
    await run(`UPDATE events SET is_active = 0 WHERE is_active = 1`);
    getIO()?.emit("event:end", { reason: "cancelled" });
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ── POST /api/events/draw (admin, lance la roue immédiatement) ──────
router.post("/draw", verifyAdmin, async (req, res) => {
  const { eventId } = req.body;
  try {
    const event = await get(`SELECT * FROM events WHERE id=? AND type='tirage' AND is_active=1 AND claimed_by IS NULL`, [eventId]);
    if (!event) return res.status(400).json({ error: "Aucun tirage actif" });

    const count = await get(`SELECT COUNT(*) AS cnt FROM tirage_entries WHERE event_id=?`, [eventId]);
    if (!count?.cnt) return res.status(400).json({ error: "Aucun inscrit pour le tirage" });

    if (tirageTimers.has(eventId)) { clearTimeout(tirageTimers.get(eventId)); tirageTimers.delete(eventId); }
    const result = await runTirageDraw(eventId);
    res.json({ success: true, winner: result?.winner ?? null });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ── POST /api/events/tirage/join (joueur s'inscrit au tirage) ───────
router.post("/tirage/join", verifyToken, async (req, res) => {
  const { eventId } = req.body;
  try {
    const event = await get(
      `SELECT * FROM events WHERE id=? AND type='tirage' AND is_active=1 AND claimed_by IS NULL`,
      [eventId]
    );
    if (!event) return res.status(400).json({ error: "Aucun tirage en cours" });
    if (event.ends_at && new Date(event.ends_at).getTime() <= Date.now())
      return res.status(400).json({ error: "Les inscriptions sont fermées" });

    await run(
      `INSERT OR IGNORE INTO tirage_entries (event_id, user_id, username) VALUES (?,?,?)`,
      [eventId, req.user.id, req.user.username]
    );
    const count = await get(`SELECT COUNT(*) AS cnt FROM tirage_entries WHERE event_id=?`, [eventId]);
    getIO()?.emit("tirage:entry", { eventId, count: count?.cnt ?? 0 });
    res.json({ success: true, count: count?.cnt ?? 0 });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ── POST /api/events/bid (enchère) ─────────────────────────────────
router.post("/bid", verifyToken, async (req, res) => {
  const { eventId, amount } = req.body;
  const userId   = req.user.id;
  const username = req.user.username;
  const bid = parseInt(amount);
  if (!bid || bid <= 0) return res.status(400).json({ error: "Mise invalide" });
  try {
    const event = await get(`SELECT * FROM events WHERE id=? AND type='enchere' AND is_active=1 AND claimed_by IS NULL`, [eventId]);
    if (!event) return res.status(409).json({ error: "Enchère terminée ou introuvable" });
    if (event.ends_at && new Date(event.ends_at).getTime() <= Date.now())
      return res.status(400).json({ error: "Les enchères sont closes" });

    const rd      = JSON.parse(event.reward_data || "{}");
    const current = await get(`SELECT * FROM auction_bids WHERE event_id=?`, [eventId]);
    const minBid  = nextMinBid(rd, current);
    if (bid < minBid) return res.status(400).json({ error: `Mise minimale : ${minBid.toLocaleString("fr-FR")} ₽` });

    // Retenue de la mise (escrow) : on débite, en s'assurant du solde (anti-race)
    const deb = await run(
      `UPDATE inventory SET pokedollars = pokedollars - ? WHERE user_id = ? AND pokedollars >= ?`,
      [bid, userId, bid]
    );
    if (deb.changes === 0) return res.status(400).json({ error: "Pokédollars insuffisants" });

    // Remboursement du meneur précédent (sa mise n'est plus retenue)
    if (current) {
      await run(`UPDATE inventory SET pokedollars = pokedollars + ? WHERE user_id = ?`, [current.amount, current.user_id]);
      emitToUser(current.user_id, "sync:inventory", {});
      emitToUser(current.user_id, "notification", { message: `Tu as été surenchéri sur "${event.title}" — mise remboursée.` });
    }

    await run(
      `INSERT OR REPLACE INTO auction_bids (event_id, user_id, username, amount) VALUES (?,?,?,?)`,
      [eventId, userId, username, bid]
    );

    const newMin = nextMinBid(rd, { amount: bid });
    getIO()?.emit("auction:bid", { eventId, amount: bid, bidder: username, min: newMin });
    emitToUser(userId, "sync:inventory", {});
    res.json({ success: true, amount: bid, min: newMin });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ── GET /api/events/prize-owned/:eventId (joueur : a-t-il déjà le lot ?) ──
router.get("/prize-owned/:eventId", verifyToken, async (req, res) => {
  try {
    const event = await get(`SELECT reward_data FROM events WHERE id=? AND type='enchere'`, [req.params.eventId]);
    if (!event) return res.json({ hasPrize: false, owned: false });
    const pkmn = JSON.parse(event.reward_data || "{}").pokemon;
    if (!pkmn?.name) return res.json({ hasPrize: false, owned: false });
    const row = await get(
      `SELECT 1 FROM captures WHERE user_id=? AND pokemon_name=? AND is_shiny=?`,
      [req.user.id, pkmn.name, pkmn.shiny ? 1 : 0]
    );
    res.json({ hasPrize: true, owned: !!row, shiny: pkmn.shiny ? 1 : 0 });
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
    const rows = await all(`SELECT id, type, ends_at FROM events WHERE is_active = 1 AND ends_at IS NOT NULL`);
    for (const ev of rows) {
      const delay = new Date(ev.ends_at).getTime() - Date.now();

      // Tirage au Sort : la fin de la fenêtre déclenche la roue, pas une expiration
      if (ev.type === "tirage") {
        scheduleTirageDraw(ev.id, delay);
        console.log(`⏰ Tirage ${ev.id} repris (roue dans ${Math.max(0, Math.round(delay / 1000))}s)`);
        continue;
      }

      // Enchère : la fin de la fenêtre déclenche la clôture (attribution du lot)
      if (ev.type === "enchere") {
        scheduleAuctionSettle(ev.id, delay);
        console.log(`⏰ Enchère ${ev.id} reprise (clôture dans ${Math.max(0, Math.round(delay / 1000))}s)`);
        continue;
      }

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
