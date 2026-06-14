import { Router } from "express";
import { run, get, all, GEN3_POKEMONS, GEN4_POKEMONS } from "../db.js";
import { pushNotification } from "./notifications.js";

// req.user est déjà injecté par verifyToken dans server.js
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Accès refusé" });
  next();
};

// ── Restriction génération : les Pokémon Gen 3/4 ne sont visibles/échangeables
// que par les joueurs ayant débloqué le succès "unlock-gen3-4". ────────────────
const GEN34_SET = new Set([...GEN3_POKEMONS, ...GEN4_POKEMONS]);
const isGen34 = (name) => GEN34_SET.has(name);

async function hasGen34Unlock(userId) {
  const row = await get(
    `SELECT claimed FROM achievements WHERE user_id = ? AND achievement_id = 'unlock-gen3-4'`,
    [userId]
  );
  return Number(row?.claimed) === 1;
}

const router = Router();

/* ── Expiration automatique des annonces ────────────────────────── */
async function expireOldTrades() {
  const expired = await all(
    `SELECT id, creator_id, pokemon_name, is_shiny FROM pokemon_trades
     WHERE status = 'active' AND expires_at < datetime('now')`
  );
  for (const t of expired) {
    // Pokémon expiré retourne dans la réserve du créateur (il était déjà dans son Pokédex)
    await run(
      `INSERT INTO pokemon_reserve (user_id, pokemon_name, is_shiny) VALUES (?, ?, ?)`,
      [t.creator_id, t.pokemon_name, t.is_shiny]
    );
    await run(`UPDATE pokemon_trades SET status = 'expired' WHERE id = ?`, [t.id]);
  }
}

/* ── Helper : ajoute un Pokémon reçu au Pokédex ou à la réserve ─── */
async function receivePokemon(userId, pokemonName, isShiny) {
  const flag = isShiny ? 1 : 0;
  const existing = await get(
    `SELECT id FROM captures WHERE user_id = ? AND pokemon_name = ? AND is_shiny = ?`,
    [userId, pokemonName, flag]
  );
  if (!existing) {
    // Nouveau Pokémon → Pokédex
    await run(
      `INSERT OR IGNORE INTO captures (user_id, pokemon_name, is_shiny, captured_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [userId, pokemonName, flag]
    );
  } else {
    // Déjà dans le Pokédex → réserve
    await run(
      `INSERT INTO pokemon_reserve (user_id, pokemon_name, is_shiny) VALUES (?, ?, ?)`,
      [userId, pokemonName, flag]
    );
  }
}

/* ── GET /api/trade  — offres du marché (hors propres annonces) ─── */
router.get("/", async (req, res) => {
  try {
    await expireOldTrades();
    const trades = await all(
      `SELECT t.*, u.avatar AS creator_avatar
       FROM pokemon_trades t
       LEFT JOIN users u ON u.id = t.creator_id
       WHERE t.status = 'active' AND t.creator_id != ?
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );
    // Filtrage serveur : sans le succès Gen 3/4, on masque toute offre impliquant
    // un Pokémon Gen 3/4 (proposé ou demandé). Non contournable côté client.
    const gen34Unlocked = await hasGen34Unlock(req.user.id);
    const visible = gen34Unlocked
      ? trades
      : trades.filter(t => !isGen34(t.pokemon_name) && !isGen34(t.requested_pokemon));
    res.json({ trades: visible });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* ── GET /api/trade/my  — historique complet du joueur ──────────── */
router.get("/my", async (req, res) => {
  try {
    await expireOldTrades();
    const trades = await all(
      `SELECT * FROM pokemon_trades
       WHERE creator_id = ? OR acceptor_id = ?
       ORDER BY created_at DESC`,
      [req.user.id, req.user.id]
    );
    res.json({ trades });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* ── POST /api/trade/create  — publier une annonce ───────────────── */
router.post("/create", async (req, res) => {
  const { reserve_entry_id, trade_type, price, requested_pokemon, requested_shiny, duration_days } = req.body;

  if (!["sale", "exchange"].includes(trade_type))
    return res.status(400).json({ error: "Type invalide" });
  if (trade_type === "sale" && (!price || Number(price) <= 0))
    return res.status(400).json({ error: "Prix requis (> 0)" });
  if (trade_type === "exchange" && !requested_pokemon?.trim())
    return res.status(400).json({ error: "Pokémon demandé requis" });
  const days = Number(duration_days);
  if (![1, 2, 3].includes(days))
    return res.status(400).json({ error: "Durée invalide (1–3 jours)" });

  try {
    const entry = await get(
      `SELECT id, pokemon_name, is_shiny FROM pokemon_reserve WHERE id = ? AND user_id = ?`,
      [reserve_entry_id, req.user.id]
    );
    if (!entry) return res.status(400).json({ error: "Pokémon introuvable dans ta réserve" });

    // Retirer de la réserve (bloqué pendant l'annonce)
    await run(`DELETE FROM pokemon_reserve WHERE id = ?`, [entry.id]);

    const modifier = `+${days} days`;
    await run(
      `INSERT INTO pokemon_trades
         (creator_id, creator_username, pokemon_name, is_shiny, trade_type,
          price, requested_pokemon, requested_shiny, duration_days, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
      [
        req.user.id, req.user.username,
        entry.pokemon_name, entry.is_shiny,
        trade_type,
        trade_type === "sale" ? Number(price) : null,
        trade_type === "exchange" ? requested_pokemon.trim() : null,
        trade_type === "exchange" ? (requested_shiny ? 1 : 0) : 0,
        days, modifier,
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* ── POST /api/trade/:id/accept  — accepter une offre ───────────── */
router.post("/:id/accept", async (req, res) => {
  const tradeId = Number(req.params.id);
  const { reserve_entry_id } = req.body;

  try {
    await expireOldTrades();

    const trade = await get(
      `SELECT * FROM pokemon_trades WHERE id = ? AND status = 'active'`,
      [tradeId]
    );
    if (!trade) return res.status(404).json({ error: "Annonce introuvable ou expirée" });
    if (trade.creator_id === req.user.id)
      return res.status(400).json({ error: "Impossible d'accepter ta propre annonce" });

    // Défense en profondeur : interdire l'acceptation d'une offre Gen 3/4 sans le succès
    if (isGen34(trade.pokemon_name) || isGen34(trade.requested_pokemon)) {
      if (!(await hasGen34Unlock(req.user.id)))
        return res.status(403).json({ error: "Succès Gen 3/4 requis pour cette offre" });
    }

    if (trade.trade_type === "sale") {
      const inv = await get(`SELECT pokedollars FROM inventory WHERE user_id = ?`, [req.user.id]);
      if (!inv || inv.pokedollars < trade.price)
        return res.status(400).json({ error: `Pokédollars insuffisants (besoin : ${trade.price} ₽)` });

      await run(`UPDATE inventory SET pokedollars = pokedollars - ? WHERE user_id = ?`, [trade.price, req.user.id]);
      await run(`UPDATE inventory SET pokedollars = pokedollars + ? WHERE user_id = ?`, [trade.price, trade.creator_id]);

      // L'acheteur reçoit le Pokémon : Pokédex si nouveau, sinon réserve
      await receivePokemon(req.user.id, trade.pokemon_name, trade.is_shiny);

    } else {
      // Échange : vérifier que l'acheteur possède le Pokémon demandé
      let matchEntry;
      if (reserve_entry_id) {
        matchEntry = await get(
          `SELECT id FROM pokemon_reserve
           WHERE id = ? AND user_id = ? AND pokemon_name = ? AND is_shiny = ?`,
          [reserve_entry_id, req.user.id, trade.requested_pokemon, trade.requested_shiny]
        );
      }
      if (!matchEntry) {
        matchEntry = await get(
          `SELECT id FROM pokemon_reserve
           WHERE user_id = ? AND pokemon_name = ? AND is_shiny = ? LIMIT 1`,
          [req.user.id, trade.requested_pokemon, trade.requested_shiny]
        );
      }
      if (!matchEntry)
        return res.status(400).json({ error: `Tu n'as pas ${trade.requested_shiny ? "✦ " : ""}${trade.requested_pokemon} dans ta réserve` });

      // Retirer le Pokémon proposé par l'accepteur
      await run(`DELETE FROM pokemon_reserve WHERE id = ?`, [matchEntry.id]);

      // L'accepteur reçoit le Pokémon du créateur : Pokédex si nouveau, sinon réserve
      await receivePokemon(req.user.id, trade.pokemon_name, trade.is_shiny);

      // Le créateur reçoit le Pokémon de l'accepteur : Pokédex si nouveau, sinon réserve
      await receivePokemon(trade.creator_id, trade.requested_pokemon, trade.requested_shiny);
    }

    await run(
      `UPDATE pokemon_trades
       SET status = 'completed', acceptor_id = ?, acceptor_username = ?, completed_at = datetime('now')
       WHERE id = ?`,
      [req.user.id, req.user.username, tradeId]
    );

    // Notification au créateur (vendeur / proposant) une fois la transaction finalisée
    const shinyTag = trade.is_shiny ? "✦ " : "";
    if (trade.trade_type === "sale") {
      await pushNotification(
        trade.creator_id,
        "trade_sold",
        `💰 ${req.user.username} a acheté ton ${shinyTag}${trade.pokemon_name} pour ${trade.price} ₽ !`,
        { tradeId, pokemon: trade.pokemon_name, is_shiny: trade.is_shiny, price: trade.price, buyer: req.user.username }
      );
    } else {
      const reqShinyTag = trade.requested_shiny ? "✦ " : "";
      await pushNotification(
        trade.creator_id,
        "trade_exchanged",
        `🔁 ${req.user.username} a accepté ton échange : ${shinyTag}${trade.pokemon_name} ↔ ${reqShinyTag}${trade.requested_pokemon} !`,
        { tradeId, gave: trade.pokemon_name, received: trade.requested_pokemon, partner: req.user.username }
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* ── GET /api/trade/admin/all  — toutes les annonces actives (admin) */
router.get("/admin/all", requireAdmin, async (req, res) => {
  try {
    await expireOldTrades();
    const trades = await all(
      `SELECT * FROM pokemon_trades WHERE status = 'active' ORDER BY created_at DESC`
    );
    res.json({ trades });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* ── DELETE /api/trade/admin/:id  — supprimer une annonce (admin) ── */
router.delete("/admin/:id", requireAdmin, async (req, res) => {
  const tradeId = Number(req.params.id);
  const reason  = req.body?.reason?.trim() || null;
  try {
    const trade = await get(
      `SELECT * FROM pokemon_trades WHERE id = ? AND status = 'active'`,
      [tradeId]
    );
    if (!trade) return res.status(404).json({ error: "Annonce introuvable" });

    // Restituer le Pokémon au créateur
    await run(
      `INSERT INTO pokemon_reserve (user_id, pokemon_name, is_shiny) VALUES (?, ?, ?)`,
      [trade.creator_id, trade.pokemon_name, trade.is_shiny]
    );
    // Marquer comme annulée avec raison admin
    await run(
      `UPDATE pokemon_trades
       SET status = 'cancelled', admin_reason = ?, completed_at = datetime('now')
       WHERE id = ?`,
      [reason ?? "Supprimée par un administrateur", tradeId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/* ── DELETE /api/trade/:id  — annuler une annonce ───────────────── */
router.delete("/:id", async (req, res) => {
  const tradeId = Number(req.params.id);
  try {
    const trade = await get(
      `SELECT * FROM pokemon_trades WHERE id = ? AND creator_id = ? AND status = 'active'`,
      [tradeId, req.user.id]
    );
    if (!trade) return res.status(404).json({ error: "Annonce introuvable" });

    // Restituer le Pokémon dans la réserve du créateur
    await run(
      `INSERT INTO pokemon_reserve (user_id, pokemon_name, is_shiny) VALUES (?, ?, ?)`,
      [req.user.id, trade.pokemon_name, trade.is_shiny]
    );
    await run(
      `UPDATE pokemon_trades SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?`,
      [tradeId]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
