import { Router } from "express";
import { run, get } from "../db.js";
import { checkAchievements } from "./achievements.js";
import { getIO } from "../socket.js";

const router = Router();

export const XP_THRESHOLDS = [
     0,    50,   110,   180,   260,   350,   450,   560,   680,   810,
   950,  1100,  1260,  1430,  1610,  1800,  2000,  2210,  2430,  2660,
  2900,  3150,  3410,  3680,  3960,  4250,  4550,  4860,  5180,  5510,
  5850,  6200,  6560,  6930,  7310,  7700,  8100,  8510,  8930,  9360,
  9800, 10250, 10710, 11180, 11660, 12150, 12650, 13160, 13680, 14210,
 14750, 15300, 15860, 16430, 17010, 17600, 18200, 18810, 19430, 20060,
 20700, 21350, 22010, 22680, 23360, 24050, 24750, 25460, 26180, 26910,
 27650, 28400, 29160, 29930, 30710, 31500, 32300, 33110, 33930, 34760,
 35600, 36450, 37310, 38180, 39060, 39950, 40850, 41760, 42680, 43610,
 44550, 45500, 46460, 47430, 48410, 49400, 50400, 51410, 52430, 53460,
  // ── Niveaux 101-200 (débloqués par la gen 3/4) ──────────────────────────
    54500,   55550,   56610,   57680,   58760,   59850,   60950,   62060,   63180,   64310,
    65450,   66600,   67760,   68930,   70110,   71300,   72500,   73710,   74930,   76160,
    77400,   78650,   79910,   81180,   82460,   83750,   85050,   86360,   87680,   89010,
    90350,   91700,   93060,   94430,   95810,   97200,   98600,  100010,  101430,  102860,
   104300,  105750,  107210,  108680,  110160,  111650,  113150,  114660,  116180,  117710,
   119250,  120800,  122360,  123930,  125510,  127100,  128700,  130310,  131930,  133560,
   135200,  136850,  138510,  140180,  141860,  143550,  145250,  146960,  148680,  150410,
   152150,  153900,  155660,  157430,  159210,  161000,  162800,  164610,  166430,  168260,
   170100,  171950,  173810,  175680,  177560,  179450,  181350,  183260,  185180,  187110,
   189050,  191000,  192960,  194930,  196910,  198900,  200900,  202910,  204930,  206960,
];
// Plafond de base = 100 ; débloque 200 quand la gen 3/4 est obtenue.
export const MAX_LEVEL_BASE   = 100;
export const MAX_LEVEL_GEN34  = 200;
// Borne haute absolue de la courbe (conservée pour compatibilité d'import).
export const MAX_LEVEL        = MAX_LEVEL_GEN34;
const        POINTS_PER_LEVEL = 2;
const        RESET_COST       = 50000;

// Plafond de niveau applicable selon le déblocage gen 3/4.
export function maxLevelFor(gen34Unlocked) {
  return gen34Unlocked ? MAX_LEVEL_GEN34 : MAX_LEVEL_BASE;
}

async function isGen34Unlocked(userId) {
  const row = await get(
    `SELECT claimed FROM achievements WHERE user_id = ? AND achievement_id = 'unlock-gen3-4'`,
    [userId]
  );
  return Number(row?.claimed) === 1;
}

function computeLevel(xp, cap = MAX_LEVEL_BASE) {
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return Math.min(level, cap);
}

// GET /api/level/:userId
router.get("/:userId", async (req, res) => {
  try {
    const ts = await get(
      `SELECT level, xp, stat_points_available, stat_dresseur, stat_collectionneur, stat_tresorier, stat_legende
       FROM trainer_stats WHERE user_id = ?`,
      [req.user.id]
    );
    if (!ts) return res.status(404).json({ error: "Utilisateur introuvable" });

    const cap          = maxLevelFor(await isGen34Unlocked(req.user.id));
    const currentLevel = computeLevel(ts.xp || 0, cap);
    if (currentLevel !== ts.level) {
      await run(`UPDATE trainer_stats SET level = ? WHERE user_id = ?`, [currentLevel, req.user.id]);
    }
    const xpForCurrent = XP_THRESHOLDS[currentLevel - 1] || 0;
    const xpForNext    = currentLevel < cap ? XP_THRESHOLDS[currentLevel] : null;

    res.json({
      level:               currentLevel,
      xp:                  ts.xp || 0,
      xpForCurrent,
      xpForNext,
      statPointsAvailable: ts.stat_points_available || 0,
      stats: {
        dresseur:       ts.stat_dresseur       || 0,
        collectionneur: ts.stat_collectionneur || 0,
        tresorier:      ts.stat_tresorier      || 0,
        legende:        ts.stat_legende        || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/level/:userId/addxp
router.post("/:userId/addxp", async (req, res) => {
  const { score } = req.body;
  if (score == null) return res.status(400).json({ error: "score requis" });

  let xpGain;
  if      (score >= 100) xpGain = 50;
  else if (score >= 80)  xpGain = 35;
  else if (score >= 60)  xpGain = 25;
  else if (score >= 40)  xpGain = 15;
  else if (score >= 1)   xpGain = 8;
  else                   xpGain = 0;

  if (xpGain === 0) return res.json({ xpGain: 0, levelUp: false });

  try {
    // Vérifier si un événement Double XP est actif
    const doubleXpEvent = await get(`
      SELECT reward_data FROM events
      WHERE type = 'double_xp' AND is_active = 1
        AND (ends_at IS NULL OR ends_at > datetime('now'))
      LIMIT 1
    `);
    if (doubleXpEvent) {
      const rd = JSON.parse(doubleXpEvent.reward_data || "{}");
      xpGain = Math.round(xpGain * (rd._multiplier || 2));
    }

    // Passif Multi Exp : +25% d'XP tant qu'il est équipé
    const multiexp = await get(
      `SELECT active FROM user_passives WHERE user_id = ? AND item = 'multiexp'`,
      [req.user.id]
    );
    if (multiexp?.active === 1) xpGain = Math.round(xpGain * 1.25);

    const ts = await get(`SELECT xp FROM trainer_stats WHERE user_id = ?`, [req.user.id]);
    if (!ts) return res.status(404).json({ error: "Utilisateur introuvable" });

    const cap      = maxLevelFor(await isGen34Unlocked(req.user.id));
    const oldXp    = ts.xp || 0;
    const newXp    = oldXp + xpGain;
    const oldLevel = computeLevel(oldXp, cap);
    const newLevel = computeLevel(newXp, cap);
    const levelUp  = newLevel > oldLevel;
    const pointsToAdd = levelUp ? (newLevel - oldLevel) * POINTS_PER_LEVEL : 0;

    await run(
      `UPDATE trainer_stats SET xp = ?, level = ?, stat_points_available = stat_points_available + ? WHERE user_id = ?`,
      [newXp, newLevel, pointsToAdd, req.user.id]
    );

    // Déclencher la détection des succès de niveau en temps réel
    if (levelUp) checkAchievements(req.user.id).catch(() => {});

    getIO()?.emit("sync:level", { userId: req.user.id, xpGain, newXp, oldLevel, newLevel, levelUp, pointsGained: pointsToAdd });
    res.json({ xpGain, newXp, oldLevel, newLevel, levelUp, pointsGained: pointsToAdd });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/level/:userId/allocate
router.post("/:userId/allocate", async (req, res) => {
  const { stat, points } = req.body;
  const validStats = ["dresseur","collectionneur","tresorier","legende"];
  if (!validStats.includes(stat) || !points || points < 1)
    return res.status(400).json({ error: "Paramètres invalides" });

  const MAX_STAT = 100;

  try {
    const ts = await get(
      `SELECT stat_points_available, stat_${stat} FROM trainer_stats WHERE user_id = ?`,
      [req.user.id]
    );
    if (!ts) return res.status(404).json({ error: "Utilisateur introuvable" });
    const currentVal = ts[`stat_${stat}`] || 0;
    if (currentVal >= MAX_STAT)
      return res.status(400).json({ error: `Stat ${stat} déjà au maximum (${MAX_STAT} pts)` });
    const toAdd = Math.min(points, MAX_STAT - currentVal);
    if ((ts.stat_points_available || 0) < toAdd)
      return res.status(400).json({ error: "Pas assez de points disponibles" });

    await run(
      `UPDATE trainer_stats SET stat_points_available = stat_points_available - ?, stat_${stat} = stat_${stat} + ? WHERE user_id = ?`,
      [toAdd, toAdd, req.user.id]
    );

    const updated = await get(
      `SELECT stat_points_available, stat_dresseur, stat_collectionneur, stat_tresorier, stat_legende FROM trainer_stats WHERE user_id = ?`,
      [req.user.id]
    );
    res.json({
      success: true,
      statPointsAvailable: updated.stat_points_available,
      stats: {
        dresseur:       updated.stat_dresseur,
        collectionneur: updated.stat_collectionneur,
        tresorier:      updated.stat_tresorier,
        legende:        updated.stat_legende,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/level/:userId/reset-stats
router.post("/:userId/reset-stats", async (req, res) => {
  try {
    const inv = await get(`SELECT pokedollars FROM inventory WHERE user_id = ?`, [req.user.id]);
    if (!inv) return res.status(404).json({ error: "Utilisateur introuvable" });
    if ((inv.pokedollars || 0) < RESET_COST)
      return res.status(400).json({ error: `Reset coûte ${RESET_COST}₽` });

    const ts = await get(
      `SELECT stat_dresseur, stat_collectionneur, stat_tresorier, stat_legende FROM trainer_stats WHERE user_id = ?`,
      [req.user.id]
    );
    const usedPoints = (ts.stat_dresseur || 0) + (ts.stat_collectionneur || 0)
                     + (ts.stat_tresorier || 0) + (ts.stat_legende || 0);

    await run(`UPDATE inventory SET pokedollars = pokedollars - ? WHERE user_id = ?`, [RESET_COST, req.user.id]);
    await run(
      `UPDATE trainer_stats SET stat_points_available = stat_points_available + ?,
       stat_dresseur = 0, stat_collectionneur = 0, stat_tresorier = 0, stat_legende = 0 WHERE user_id = ?`,
      [usedPoints, req.user.id]
    );

    res.json({ success: true, message: `Stats réinitialisées ! ${usedPoints} points récupérés.` });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
