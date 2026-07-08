// ─────────────────────────────────────────────────────────────────────────────
// PokéÉlevage — backend. TOUTES les validations critiques sont serveur-autoritaires.
//   GET  /api/elevage                → état complet (slots, œufs, baies, prix, catalogue)
//   POST /api/elevage/slots/buy      → débloque le slot suivant
//   POST /api/elevage/berries/buy    → achète des baies
//   POST /api/elevage/eggs/buy       → achète un œuf + tire sa rareté
//   POST /api/elevage/eggs/feed      → nourrit un œuf d'une baie
//   POST /api/elevage/eggs/action    → action quotidienne (couver/repas/ecouter/polir)
//   POST /api/elevage/eggs/hatch     → fait éclore un œuf prêt → capture
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from "express";
import { run, get, all } from "../db.js";
import {
  RARITY_ROLL, RARITIES, RARITY_DURATION_S, HATCH_FLOOR_S,
  HUNGER_CAP, HUNGER_REGEN_INTERVAL_S,
  TYPE_BERRIES, STAT_BERRIES,
  SPECIAL_BERRIES, ONCE_PER_EGG, ALL_BERRIES,
} from "../lib/eggProfiles.js";
import { topCandidates, loadPool, gen34Unlocked, performHatch } from "../lib/eggHatch.js";
import { getIO } from "../socket.js";

const router = Router();

// ── Paramètres d'équilibrage (voir livrable 5) ───────────────────────────────
const MAX_SLOTS            = 3;
const STARF_BONUS          = 2;      // +2 points de % shiny
const POLIR_BONUS          = 2;      // +2 points de % shiny
const COUVER_REDUCTION     = 0.10;   // −10% du temps total
const LANSAT_UPGRADE_CHANCE = 0.05;  // 5% de monter d'un palier
const ACTION_COOLDOWN_S    = 24 * 3600; // 24h entre deux actions (depuis la dernière action)

// Baies achetables en boutique = uniquement type + stat.
// Les baies or et spéciales ne sont PAS vendues : elles viendront de drops (arbres Safari).
const PURCHASABLE_BERRIES = new Set([...Object.keys(TYPE_BERRIES), ...Object.keys(STAT_BERRIES)]);

// ── Prix par défaut (seedés dans elevage_prices, éditables via admin) ─────────
const DEFAULT_PRICES = (() => {
  const p = { egg: 1000, slot_2: 5000, slot_3: 20000, slot_4: 60000, slot_5: 150000 };
  for (const b of Object.keys(TYPE_BERRIES)) p[b] = 200;
  for (const b of Object.keys(STAT_BERRIES)) p[b] = 350;
  return p;
})();

let _seeded = false;
async function ensureSeed(userId) {
  if (!_seeded) {
    for (const [item, price] of Object.entries(DEFAULT_PRICES)) {
      await run(`INSERT OR IGNORE INTO elevage_prices (item, price) VALUES (?,?)`, [item, price]);
    }
    _seeded = true;
  }
  await run(`INSERT OR IGNORE INTO user_slots (user_id, slots_unlocked) VALUES (?, 1)`, [userId]);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const nowS  = () => Math.floor(Date.now() / 1000);
const today = () => new Date().toISOString().slice(0, 10);
const randOf = arr => arr[Math.floor(Math.random() * arr.length)];

async function getPrices() {
  const rows = await all(`SELECT item, price FROM elevage_prices`);
  const map = {};
  for (const r of rows) map[r.item] = r.price;
  return map;
}

async function priceOf(item) {
  const r = await get(`SELECT price FROM elevage_prices WHERE item = ?`, [item]);
  return r ? r.price : (DEFAULT_PRICES[item] ?? null);
}

// Jauge de faim au temps t : régénère en continu, plafonnée à HUNGER_CAP.
// feed_bucket_at = 0 (jamais nourri / migration) → jauge pleine.
function hungerBucket(egg, t) {
  if (!egg.feed_bucket_at) return HUNGER_CAP;
  const regen = (t - egg.feed_bucket_at) / HUNGER_REGEN_INTERVAL_S;
  return Math.min(HUNGER_CAP, (egg.feed_bucket ?? HUNGER_CAP) + regen);
}

// Débit atomique des Pokédollars ; renvoie true si le solde suffisait.
async function spend(userId, amount) {
  const r = await run(
    `UPDATE inventory SET pokedollars = pokedollars - ? WHERE user_id = ? AND pokedollars >= ?`,
    [amount, userId, amount]
  );
  if (r.changes > 0) getIO()?.emit("sync:inventory", { userId });
  return r.changes > 0;
}

function rollRarity() {
  const r = Math.random() * RARITY_ROLL.reduce((s, e) => s + e.chance, 0);
  let sum = 0;
  for (const e of RARITY_ROLL) { sum += e.chance; if (r <= sum) return e.rarity; }
  return "stade1";
}

function nextRarity(rarity) {
  const i = RARITIES.indexOf(rarity);
  return i >= 0 && i < RARITIES.length - 1 ? RARITIES[i + 1] : rarity;
}

// Contribution d'une baie au profil (type ou stat). null = spéciale (effet immédiat).
function contributionOf(berryId) {
  if (TYPE_BERRIES[berryId]) return { kind: "type", key: TYPE_BERRIES[berryId], base: 1 };
  if (STAT_BERRIES[berryId]) return { kind: "stat", key: STAT_BERRIES[berryId], base: 1 };
  return null;
}

// L'algorithme d'éclosion, la capture et gen34Unlocked vivent dans lib/eggHatch.js
// (partagés avec l'admin) et sont importés en tête de fichier.

// ── Sérialisation d'un œuf pour le front ─────────────────────────────────────
async function serializeEgg(egg) {
  const feedRows = await all(`SELECT berry_id, qty FROM egg_feedings WHERE egg_id = ?`, [egg.id]);
  const feedings = {};
  const typeCount = {}, statVec = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, vit: 0 };
  const specialsUsed = [];
  for (const { berry_id, qty } of feedRows) {
    feedings[berry_id] = qty;
    if (TYPE_BERRIES[berry_id]) typeCount[TYPE_BERRIES[berry_id]] = (typeCount[TYPE_BERRIES[berry_id]] || 0) + qty;
    else if (STAT_BERRIES[berry_id]) statVec[STAT_BERRIES[berry_id]] += qty;
    else specialsUsed.push(berry_id);
  }
  // Cooldown d'action = 24h après la dernière action effectuée.
  const nextActionAt = (egg.last_action_at || 0) > 0 ? egg.last_action_at + ACTION_COOLDOWN_S : 0;
  const inCooldown = nextActionAt > nowS();
  // Jauge de faim : régénère en continu (HUNGER_CAP baies max, 1 baie / HUNGER_REGEN_INTERVAL_S).
  const t = nowS();
  const bucket = hungerBucket(egg, t);
  const nextHungerUnitAt = bucket < HUNGER_CAP
    ? t + Math.ceil((1 - (bucket - Math.floor(bucket))) * HUNGER_REGEN_INTERVAL_S)
    : null;
  return {
    id: egg.id, slot: egg.slot, rarity: egg.rarity,
    created_at: egg.created_at, hatch_at: egg.hatch_at, now: t,
    ready: t >= egg.hatch_at,
    shiny_bonus: egg.shiny_bonus, enigma: !!egg.enigma, meal_armed: !!egg.meal_armed,
    feedings, typeGauge: typeCount, statGauge: statVec, specialsUsed,
    hunger: Math.round(bucket * 10) / 10, hungerCap: HUNGER_CAP, nextHungerUnitAt,
    dailyAction: inCooldown ? egg.last_action : null,
    nextActionAt: inCooldown ? nextActionAt : null,
  };
}

// Catalogue statique (baies → rôle) pour piloter la boutique/inventaire côté front.
const CATALOG = {
  typeBerries: TYPE_BERRIES,
  statBerries: STAT_BERRIES,
  specialBerries: [...SPECIAL_BERRIES],
  rarities: RARITY_ROLL,
  durations: RARITY_DURATION_S,
  hatchFloor: HATCH_FLOOR_S,
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/elevage — état complet
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;
    await ensureSeed(userId);

    const slotsRow = await get(`SELECT slots_unlocked FROM user_slots WHERE user_id = ?`, [userId]);
    const eggRows  = await all(`SELECT * FROM eggs WHERE user_id = ? ORDER BY slot`, [userId]);
    const eggs     = await Promise.all(eggRows.map(serializeEgg));
    const berryRows = await all(`SELECT berry_id, qty FROM user_berries WHERE user_id = ? AND qty > 0`, [userId]);
    const berries = {};
    for (const b of berryRows) berries[b.berry_id] = b.qty;

    res.json({
      slotsUnlocked: slotsRow?.slots_unlocked || 1,
      maxSlots: MAX_SLOTS,
      eggs, berries,
      prices: await getPrices(),
      gen34Unlocked: await gen34Unlocked(userId),
      catalog: CATALOG,
    });
  } catch (e) {
    console.error("elevage GET", e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/elevage/slots/buy — débloque le slot suivant
// ─────────────────────────────────────────────────────────────────────────────
router.post("/slots/buy", async (req, res) => {
  try {
    const userId = req.user.id;
    await ensureSeed(userId);
    const slotsRow = await get(`SELECT slots_unlocked FROM user_slots WHERE user_id = ?`, [userId]);
    const current = slotsRow?.slots_unlocked || 1;
    if (current >= MAX_SLOTS) return res.status(400).json({ error: "Tous les slots sont déjà débloqués." });

    const cost = await priceOf(`slot_${current + 1}`);
    if (cost == null) return res.status(400).json({ error: "Prix introuvable." });
    if (!(await spend(userId, cost))) return res.status(400).json({ error: "Pas assez de Pokédollars." });

    await run(`UPDATE user_slots SET slots_unlocked = slots_unlocked + 1 WHERE user_id = ?`, [userId]);
    res.json({ success: true, slotsUnlocked: current + 1 });
  } catch (e) {
    console.error("elevage slots/buy", e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/elevage/berries/buy — { berry_id, qty }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/berries/buy", async (req, res) => {
  try {
    const userId = req.user.id;
    await ensureSeed(userId);
    const berryId = String(req.body.berry_id || "");
    let qty = parseInt(req.body.qty, 10);
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    qty = Math.min(qty, 99);
    if (!PURCHASABLE_BERRIES.has(berryId)) return res.status(400).json({ error: "Cette baie n'est pas en vente." });

    const unit = await priceOf(berryId);
    if (unit == null) return res.status(400).json({ error: "Prix introuvable." });
    if (!(await spend(userId, unit * qty))) return res.status(400).json({ error: "Pas assez de Pokédollars." });

    await run(
      `INSERT INTO user_berries (user_id, berry_id, qty) VALUES (?,?,?)
       ON CONFLICT(user_id, berry_id) DO UPDATE SET qty = qty + excluded.qty`,
      [userId, berryId, qty]
    );
    const row = await get(`SELECT qty FROM user_berries WHERE user_id = ? AND berry_id = ?`, [userId, berryId]);
    res.json({ success: true, berry_id: berryId, qty: row?.qty || 0 });
  } catch (e) {
    console.error("elevage berries/buy", e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/elevage/berries/sell — { berry_id, qty } : revend au ratio SELL_RATIO
// ─────────────────────────────────────────────────────────────────────────────
const BERRY_SELL_RATIO = 0.30; // 30% du prix d'achat, comme le shop principal
router.post("/berries/sell", async (req, res) => {
  try {
    const userId = req.user.id;
    await ensureSeed(userId);
    const berryId = String(req.body.berry_id || "");
    let qty = parseInt(req.body.qty, 10);
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    qty = Math.min(qty, 99);
    if (!ALL_BERRIES.has(berryId)) return res.status(400).json({ error: "Baie invalide." });

    const buyPrice = await priceOf(berryId);
    if (buyPrice == null) return res.status(400).json({ error: "Cette baie n'est pas revendable." });
    const unit = Math.max(1, Math.floor(buyPrice * BERRY_SELL_RATIO));

    const dec = await run(
      `UPDATE user_berries SET qty = qty - ? WHERE user_id = ? AND berry_id = ? AND qty >= ?`,
      [qty, userId, berryId, qty]
    );
    if (dec.changes === 0) return res.status(400).json({ error: "Tu n'as pas assez de cette baie." });

    await run(`UPDATE inventory SET pokedollars = pokedollars + ? WHERE user_id = ?`, [unit * qty, userId]);
    getIO()?.emit("sync:inventory", { userId });
    const row = await get(`SELECT qty FROM user_berries WHERE user_id = ? AND berry_id = ?`, [userId, berryId]);
    res.json({ success: true, berry_id: berryId, qty: row?.qty || 0, gained: unit * qty });
  } catch (e) {
    console.error("elevage berries/sell", e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/elevage/eggs/buy — { slot } : achète un œuf et tire sa rareté
// ─────────────────────────────────────────────────────────────────────────────
router.post("/eggs/buy", async (req, res) => {
  try {
    const userId = req.user.id;
    await ensureSeed(userId);
    const slot = parseInt(req.body.slot, 10);
    const slotsRow = await get(`SELECT slots_unlocked FROM user_slots WHERE user_id = ?`, [userId]);
    const unlocked = slotsRow?.slots_unlocked || 1;
    if (!Number.isInteger(slot) || slot < 0 || slot >= unlocked)
      return res.status(400).json({ error: "Slot invalide ou verrouillé." });

    const existing = await get(`SELECT id FROM eggs WHERE user_id = ? AND slot = ?`, [userId, slot]);
    if (existing) return res.status(400).json({ error: "Ce slot contient déjà un œuf." });

    const cost = await priceOf("egg");
    if (!(await spend(userId, cost))) return res.status(400).json({ error: "Pas assez de Pokédollars." });

    const rarity   = rollRarity();
    const duration = RARITY_DURATION_S[rarity];
    const created  = nowS();
    const hatchAt  = created + Math.max(duration, HATCH_FLOOR_S);

    const r = await run(
      `INSERT INTO eggs (user_id, slot, rarity, created_at, hatch_at) VALUES (?,?,?,?,?)`,
      [userId, slot, rarity, created, hatchAt]
    );
    const egg = await get(`SELECT * FROM eggs WHERE id = ?`, [r.lastID]);
    res.json({ success: true, rarity, egg: await serializeEgg(egg) });
  } catch (e) {
    console.error("elevage eggs/buy", e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Charge l'œuf d'un slot en vérifiant l'appartenance.
async function loadEgg(userId, slot) {
  if (!Number.isInteger(slot)) return null;
  return get(`SELECT * FROM eggs WHERE user_id = ? AND slot = ?`, [userId, slot]);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/elevage/eggs/feed — { slot, berry_id }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/eggs/feed", async (req, res) => {
  try {
    const userId = req.user.id;
    const slot = parseInt(req.body.slot, 10);
    const berryId = String(req.body.berry_id || "");
    if (!ALL_BERRIES.has(berryId)) return res.status(400).json({ error: "Baie invalide." });

    const egg = await loadEgg(userId, slot);
    if (!egg) return res.status(400).json({ error: "Aucun œuf sur ce slot." });
    if (nowS() >= egg.hatch_at) return res.status(400).json({ error: "Cet œuf est prêt à éclore." });

    // Verrou 1×/œuf pour les baies or et spéciales.
    if (ONCE_PER_EGG.has(berryId)) {
      const used = await get(`SELECT 1 AS x FROM egg_feedings WHERE egg_id = ? AND berry_id = ?`, [egg.id, berryId]);
      if (used) return res.status(400).json({ error: "Cette baie a déjà été utilisée sur cet œuf." });
    }

    // Jauge de faim (les spéciales n'y puisent pas) : régénère HUNGER_CAP baies/HUNGER_REGEN_INTERVAL_S.
    let newBucket = null;
    if (TYPE_BERRIES[berryId] || STAT_BERRIES[berryId]) {
      const bucket = hungerBucket(egg, nowS());
      if (bucket < 1) {
        return res.status(400).json({ error: "Cet œuf n'a plus faim pour l'instant. Patiente un peu avant de le nourrir à nouveau." });
      }
      newBucket = bucket - 1;
    }

    // Consomme 1 baie de l'inventaire (atomique).
    const dec = await run(
      `UPDATE user_berries SET qty = qty - 1 WHERE user_id = ? AND berry_id = ? AND qty >= 1`,
      [userId, berryId]
    );
    if (dec.changes === 0) return res.status(400).json({ error: "Tu n'as pas cette baie." });

    const info = { berry: berryId };

    if (SPECIAL_BERRIES.has(berryId)) {
      // Baies spéciales : effet immédiat, marquées « utilisées ».
      await run(`INSERT OR IGNORE INTO egg_feedings (egg_id, berry_id, qty) VALUES (?,?,1)`, [egg.id, berryId]);

      if (berryId === "micle") {
        const g34 = await gen34Unlocked(userId);
        const pool = await all(`SELECT * FROM pokemon_profiles WHERE tier = ? AND gen <= ?`, [egg.rarity, g34 ? 4 : 2]);
        const feedRows = await all(`SELECT berry_id, qty FROM egg_feedings WHERE egg_id = ?`, [egg.id]);
        info.reveal = topCandidates(pool, egg, feedRows, 3);
      } else if (berryId === "starf") {
        await run(`UPDATE eggs SET shiny_bonus = shiny_bonus + ? WHERE id = ?`, [STARF_BONUS, egg.id]);
        info.shinyBonusAdded = STARF_BONUS;
      } else if (berryId === "enigma") {
        const remaining = egg.hatch_at - nowS();
        const newHatch = Math.max(nowS() + Math.floor(remaining / 2), egg.created_at + HATCH_FLOOR_S);
        await run(`UPDATE eggs SET enigma = 1, hatch_at = ? WHERE id = ?`, [newHatch, egg.id]);
        info.enigma = true;
      } else if (berryId === "lansat") {
        const success = Math.random() < LANSAT_UPGRADE_CHANCE;
        if (success && egg.rarity !== "mythic") {
          await run(`UPDATE eggs SET rarity = ? WHERE id = ?`, [nextRarity(egg.rarity), egg.id]);
        }
        info.lansatSuccess = success;
      } else if (berryId === "salac") {
        // Réinitialise le profil nourri (stats + type), sans toucher aux autres effets (shiny, enigma, repas...).
        const contribIds = [...Object.keys(TYPE_BERRIES), ...Object.keys(STAT_BERRIES)];
        await run(
          `DELETE FROM egg_feedings WHERE egg_id = ? AND berry_id IN (${contribIds.map(() => "?").join(",")})`,
          [egg.id, ...contribIds]
        );
        info.reset = true;
      }
    } else {
      // Baies de type / stat : ajoutent au profil (× meal si Repas soigné armé) + consomment 1 point de faim.
      const c = contributionOf(berryId);
      const mult = egg.meal_armed ? 2 : 1;
      const add = c.base * mult;
      await run(
        `INSERT INTO egg_feedings (egg_id, berry_id, qty) VALUES (?,?,?)
         ON CONFLICT(egg_id, berry_id) DO UPDATE SET qty = qty + excluded.qty`,
        [egg.id, berryId, add]
      );
      await run(`UPDATE eggs SET feed_bucket = ?, feed_bucket_at = ? WHERE id = ?`, [newBucket, nowS(), egg.id]);
      if (egg.meal_armed) {
        await run(`UPDATE eggs SET meal_armed = 0 WHERE id = ?`, [egg.id]);
        info.mealConsumed = true;
      }
      info.added = add;
    }

    const fresh = await get(`SELECT * FROM eggs WHERE id = ?`, [egg.id]);
    res.json({ success: true, ...info, egg: await serializeEgg(fresh) });
  } catch (e) {
    console.error("elevage eggs/feed", e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/elevage/eggs/action — { slot, action } : 1 action / œuf / jour
// ─────────────────────────────────────────────────────────────────────────────
const VALID_ACTIONS = new Set(["couver", "repas", "ecouter", "polir"]);
router.post("/eggs/action", async (req, res) => {
  try {
    const userId = req.user.id;
    const slot = parseInt(req.body.slot, 10);
    const action = String(req.body.action || "");
    if (!VALID_ACTIONS.has(action)) return res.status(400).json({ error: "Action invalide." });

    const egg = await loadEgg(userId, slot);
    if (!egg) return res.status(400).json({ error: "Aucun œuf sur ce slot." });
    if (nowS() >= egg.hatch_at) return res.status(400).json({ error: "Cet œuf est prêt à éclore." });

    // Verrou serveur : 24h entre deux actions (depuis la dernière action effectuée).
    if ((egg.last_action_at || 0) > 0 && nowS() < egg.last_action_at + ACTION_COOLDOWN_S) {
      return res.status(400).json({ error: "Action déjà utilisée — attends 24h depuis la dernière." });
    }
    await run(`UPDATE eggs SET last_action_at = ?, last_action = ? WHERE id = ?`, [nowS(), action, egg.id]);

    const info = { action };
    if (action === "couver") {
      const reduction = Math.floor(RARITY_DURATION_S[egg.rarity] * COUVER_REDUCTION);
      const newHatch = Math.max(egg.hatch_at - reduction, egg.created_at + HATCH_FLOOR_S);
      await run(`UPDATE eggs SET hatch_at = ? WHERE id = ?`, [newHatch, egg.id]);
    } else if (action === "repas") {
      await run(`UPDATE eggs SET meal_armed = 1 WHERE id = ?`, [egg.id]);
    } else if (action === "polir") {
      await run(`UPDATE eggs SET shiny_bonus = shiny_bonus + ? WHERE id = ?`, [POLIR_BONUS, egg.id]);
    } else if (action === "ecouter") {
      const g34 = await gen34Unlocked(userId);
      const pool = await all(`SELECT * FROM pokemon_profiles WHERE tier = ? AND gen <= ?`, [egg.rarity, g34 ? 4 : 2]);
      const feedRows = await all(`SELECT berry_id, qty FROM egg_feedings WHERE egg_id = ?`, [egg.id]);
      info.reveal = topCandidates(pool, egg, feedRows, 5);
    }

    const fresh = await get(`SELECT * FROM eggs WHERE id = ?`, [egg.id]);
    res.json({ success: true, ...info, egg: await serializeEgg(fresh) });
  } catch (e) {
    console.error("elevage eggs/action", e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/elevage/eggs/hatch — { slot } : éclosion + capture
// ─────────────────────────────────────────────────────────────────────────────
router.post("/eggs/hatch", async (req, res) => {
  try {
    const userId = req.user.id;
    const slot = parseInt(req.body.slot, 10);
    const egg = await loadEgg(userId, slot);
    if (!egg) return res.status(400).json({ error: "Aucun œuf sur ce slot." });
    if (nowS() < egg.hatch_at) return res.status(400).json({ error: "L'œuf n'est pas encore prêt." });

    const result = await performHatch(egg);
    if (!result) return res.status(500).json({ error: "Pool vide pour cette rareté." });

    res.json({ success: true, ...result });
  } catch (e) {
    console.error("elevage eggs/hatch", e);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
