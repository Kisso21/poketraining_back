import { Router } from "express";
import { run, get, all } from "../db.js";
import { getIO } from "../socket.js";

const router = Router();

// ── Barème ────────────────────────────────────────────────────────────────
// Argent de base FIXE : 1000 ₽, auquel on applique le multiplicateur de série.
export const BASE_START = 1000;
export const BASE_STEP  = 0;        // base constante quel que soit le jour
// Multiplicateur : +0,1 par jour réclamé dans le mois, sans reset sur un jour manqué. Plafonné ×3.
export const MULT_STEP = 0.1;
export const MAX_MULT  = 3;         // ×3 atteint vers J21 → reste ×3 jusqu'à J30+
// Lootbox/jour = partie entière du multiplicateur (au moins 1)

// Incrémente dès le 1er jour : J1 → ×1,1 = 1100 ; J2 → ×1,2 ; … plafond ×3 (J20+) = 3000
export function multiplierFor(streak) {
  const m = 1 + MULT_STEP * Math.max(0, streak);
  return Math.round(Math.min(MAX_MULT, m) * 10) / 10;
}
export function lootboxFor(mult) {
  return Math.max(1, Math.floor(mult + 1e-9));
}
export function baseForDay() {
  return BASE_START;
}

// ── Jours spéciaux : 2 Hyper Ball + 2 Reset Ball / mois, remplacent la lootbox ──
// Tirage déterministe (stable sur le mois, identique pour tous les joueurs).
function rngFromSeed(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
export function specialDaysForMonth(year, month, daysInMonth) {
  const rng = rngFromSeed(year * 1000 + month * 31 + 7);
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  for (let i = days.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [days[i], days[j]] = [days[j], days[i]];
  }
  const map = {};
  map[days[0]] = "hyperball"; map[days[1]] = "hyperball";
  map[days[2]] = "resetball"; map[days[3]] = "resetball";
  return map;
}
function dailyItemFor(specialMap, day) {
  return specialMap[day] || "lootbox";
}

// ── Dates en fuseau France (le serveur tourne en UTC) ─────────────────────
const TZ = "Europe/Paris";
const pad = n => String(n).padStart(2, "0");
// Composants de date (année/mois/jour) tels qu'affichés en France
export function parisParts(d = new Date()) {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const [y, m, day] = s.split("-").map(Number);
  return { y, m, day };
}
// GET /api/daily/status — état du calendrier mensuel pour le joueur
router.get("/status", async (req, res) => {
  try {
    const userId = req.user.id;
    const { y: year, m: month, day: today } = parisParts();
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthPrefix = `${year}-${pad(month)}-`;

    const login = await get(`SELECT best_streak FROM daily_login WHERE user_id = ?`, [userId]);
    const claims = await all(
      `SELECT claim_date FROM daily_claims WHERE user_id = ? AND claim_date LIKE ?`,
      [userId, monthPrefix + "%"]
    );
    const claimedDays = claims.map(c => Number(c.claim_date.slice(8, 10)));
    const canClaim = !claimedDays.includes(today);

    // Compte le nombre de jours réclamés ce mois (peu importe les jours manqués entre-temps)
    const prospective = canClaim ? claimedDays.length + 1 : claimedDays.length;
    const mult = multiplierFor(prospective);
    const specialDays = specialDaysForMonth(year, month, daysInMonth);
    const todayItem = dailyItemFor(specialDays, today);

    res.json({
      year, month, today, daysInMonth,
      claimedDays,
      canClaim,
      streak: prospective,
      bestStreak: login?.best_streak || 0,
      multiplier: mult,
      todayMoney: Math.round(baseForDay(today) * mult),
      todayItem,
      todayItemCount: lootboxFor(mult),
      specialDays,
      config: { baseStart: BASE_START, baseStep: BASE_STEP, multStep: MULT_STEP, maxMult: MAX_MULT },
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/daily/claim — réclame la récompense du jour courant
router.post("/claim", async (req, res) => {
  try {
    const userId = req.user.id;
    const { y: year, m: month, day: dayOfMonth } = parisParts();
    const today = `${year}-${pad(month)}-${pad(dayOfMonth)}`;
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthPrefix = `${year}-${pad(month)}-`;

    // Verrou atomique : la clé primaire (user_id, claim_date) empêche tout
    // double crédit, même en cas de requêtes concurrentes. On ne crédite QUE
    // si cet INSERT a réellement inséré la ligne.
    const claimIns = await run(`INSERT OR IGNORE INTO daily_claims (user_id, claim_date) VALUES (?,?)`, [userId, today]);
    if (claimIns.changes === 0) return res.status(400).json({ error: "Récompense déjà réclamée aujourd'hui" });

    const login = await get(`SELECT best_streak FROM daily_login WHERE user_id = ?`, [userId]);
    // Multiplicateur basé sur le nombre de jours réclamés ce mois (les jours manqués entre-temps ne le remettent pas à 1)
    const { c: newStreak } = await get(
      `SELECT COUNT(*) AS c FROM daily_claims WHERE user_id = ? AND claim_date LIKE ?`,
      [userId, monthPrefix + "%"]
    );
    const best = Math.max(login?.best_streak || 0, newStreak);
    const mult = multiplierFor(newStreak);
    const money = Math.round(baseForDay(dayOfMonth) * mult);
    const count = lootboxFor(mult);
    let item = dailyItemFor(specialDaysForMonth(year, month, daysInMonth), dayOfMonth);
    if (!["lootbox", "hyperball", "resetball"].includes(item)) item = "lootbox"; // whitelist défensive (nom de colonne)

    await run(
      `INSERT INTO daily_login (user_id, streak, last_claim_date, best_streak) VALUES (?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET streak = ?, last_claim_date = ?, best_streak = ?`,
      [userId, newStreak, today, best, newStreak, today, best]
    );
    await run(
      `UPDATE inventory SET pokedollars = pokedollars + ?, ${item} = COALESCE(${item},0) + ? WHERE user_id = ?`,
      [money, count, userId]
    );

    getIO()?.emit("sync:inventory", { userId });
    res.json({ success: true, money, item, count, streak: newStreak, multiplier: mult, day: dayOfMonth });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
