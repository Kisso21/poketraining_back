import { Router } from "express";
import bcrypt from "bcrypt";
import os from "os";
import fs from "fs";
import { execSync } from "child_process";
import { run, get, all, GEN1_POKEMONS } from "../db.js";
import { verifyAdmin, ALLOWED_ITEM_COLUMNS } from "../middleware/auth.js";
import { emitToUser } from "../socket.js";
import { broadcastRocket } from "./teamRocket.js";
import { VALID_ITEMS } from "./events.js";

const router = Router();

router.use(verifyAdmin);

// GET /api/admin/user/:username
router.get("/user/:username", async (req, res) => {
  try {
    const u = await get(
      `SELECT u.id, u.username, u.role,
              i.pokedollars, i.pokeball, i.superball, i.hyperball, i.masterball,
              i.resetball, i.superbonbon, i.potion, i.lootbox
       FROM users u LEFT JOIN inventory i ON i.user_id = u.id
       WHERE u.username = ?`, [req.params.username]
    );
    if (!u) return res.status(404).json({ error: "Utilisateur introuvable" });
    res.json(u);
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/inventory/modify
router.post("/inventory/modify", async (req, res) => {
  const { targetUsername, item, delta } = req.body;
  if (!ALLOWED_ITEM_COLUMNS.has(item)) return res.status(400).json({ error: "Item invalide" });
  try {
    const u = await get("SELECT id FROM users WHERE username = ?", [targetUsername]);
    if (!u) return res.status(404).json({ error: "Utilisateur introuvable" });
    await run(
      `UPDATE inventory SET ${item} = MAX(0, COALESCE(${item}, 0) + ?) WHERE user_id = ?`,
      [Math.round(delta), u.id]
    );
    const inv = await get(
      `SELECT pokedollars, pokeball, superball, hyperball, masterball, resetball, superbonbon, potion, lootbox
       FROM inventory WHERE user_id = ?`, [u.id]
    );
    res.json({ success: true, inventory: inv });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/pokeclick/reset
router.post("/pokeclick/reset", async (req, res) => {
  const { targetUserId, type } = req.body;
  try {
    if (type === "upgrades" || type === "all")
      await run("DELETE FROM pokeclick_upgrades WHERE user_id = ?", [targetUserId]);
    if (type === "daily" || type === "all")
      await run("DELETE FROM daily_farm WHERE user_id = ?", [targetUserId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/pokeclick/toggle — ajoute ou retire un upgrade individuel
router.post("/pokeclick/toggle", async (req, res) => {
  const { targetUserId, upgradeKey, give } = req.body;
  try {
    if (give) {
      await run(
        "INSERT OR IGNORE INTO pokeclick_upgrades (user_id, upgrade_key) VALUES (?, ?)",
        [targetUserId, upgradeKey]
      );
    } else {
      await run(
        "DELETE FROM pokeclick_upgrades WHERE user_id = ? AND upgrade_key = ?",
        [targetUserId, upgradeKey]
      );
    }
    const rows = await all("SELECT upgrade_key FROM pokeclick_upgrades WHERE user_id = ?", [targetUserId]);
    res.json({ upgrades: rows.map(r => r.upgrade_key) });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// GET /api/admin/games/:userId
router.get("/games/:userId", async (req, res) => {
  try {
    const rows = await all(
      "SELECT game_type, next_available_at, updated_at FROM game_states WHERE user_id = ?",
      [req.params.userId]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/game/reset
router.post("/game/reset", async (req, res) => {
  const { targetUserId, gameType } = req.body;
  try {
    if (gameType === "all") {
      await run("DELETE FROM game_states WHERE user_id = ?", [targetUserId]);
    } else {
      await run("DELETE FROM game_states WHERE user_id = ? AND game_type = ?", [targetUserId, gameType]);
    }
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ── Niveau (admin) ──────────────────────────────────────────────────

const XP_THRESHOLDS_ADMIN = [
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
  // Niveaux 101-200
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
function computeLevelAdmin(xp) {
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS_ADMIN.length; i++) {
    if (xp >= XP_THRESHOLDS_ADMIN[i]) level = i + 1; else break;
  }
  return Math.min(level, 200);
}

// GET /api/admin/level/:userId
router.get("/level/:userId", async (req, res) => {
  try {
    const ts = await get(
      `SELECT xp, level, stat_points_available, stat_dresseur, stat_collectionneur, stat_tresorier, stat_legende
       FROM trainer_stats WHERE user_id = ?`, [req.params.userId]
    );
    if (!ts) return res.status(404).json({ error: "Utilisateur introuvable" });
    const computedLevel = computeLevelAdmin(ts.xp || 0);
    if (computedLevel !== ts.level) {
      await run(`UPDATE trainer_stats SET level = ? WHERE user_id = ?`, [computedLevel, req.params.userId]);
    }
    res.json({ ...ts, level: computedLevel });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/level/addxp
router.post("/level/addxp", async (req, res) => {
  const { targetUserId, delta } = req.body;
  try {
    const ts = await get(`SELECT xp, level FROM trainer_stats WHERE user_id = ?`, [targetUserId]);
    if (!ts) return res.status(404).json({ error: "Utilisateur introuvable" });
    const newXp     = Math.max(0, (ts.xp || 0) + Math.round(delta));
    const oldLevel  = computeLevelAdmin(ts.xp || 0);
    const newLevel  = computeLevelAdmin(newXp);
    const levelDiff = newLevel - oldLevel;
    const bonusPoints = levelDiff > 0 ? levelDiff * 2 : 0;
    await run(
      `UPDATE trainer_stats SET xp = ?, level = ?, stat_points_available = MAX(0, stat_points_available + ?) WHERE user_id = ?`,
      [newXp, newLevel, bonusPoints, targetUserId]
    );
    const updated = await get(
      `SELECT xp, level, stat_points_available, stat_dresseur, stat_collectionneur, stat_tresorier, stat_legende FROM trainer_stats WHERE user_id = ?`,
      [targetUserId]
    );
    res.json({ success: true, ...updated });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/level/resetstats
router.post("/level/resetstats", async (req, res) => {
  const { targetUserId } = req.body;
  try {
    const ts = await get(
      `SELECT stat_dresseur, stat_collectionneur, stat_tresorier, stat_legende FROM trainer_stats WHERE user_id = ?`,
      [targetUserId]
    );
    if (!ts) return res.status(404).json({ error: "Utilisateur introuvable" });
    const usedPoints = (ts.stat_dresseur||0) + (ts.stat_collectionneur||0) + (ts.stat_tresorier||0) + (ts.stat_legende||0);
    await run(
      `UPDATE trainer_stats SET stat_points_available = stat_points_available + ?,
       stat_dresseur = 0, stat_collectionneur = 0, stat_tresorier = 0, stat_legende = 0 WHERE user_id = ?`,
      [usedPoints, targetUserId]
    );
    const updated = await get(
      `SELECT xp, level, stat_points_available, stat_dresseur, stat_collectionneur, stat_tresorier, stat_legende FROM trainer_stats WHERE user_id = ?`,
      [targetUserId]
    );
    res.json({ success: true, ...updated });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/level/setpoints
router.post("/level/setpoints", async (req, res) => {
  const { targetUserId, points } = req.body;
  try {
    await run(`UPDATE trainer_stats SET stat_points_available = ? WHERE user_id = ?`, [Math.max(0, Math.round(points)), targetUserId]);
    const updated = await get(
      `SELECT xp, level, stat_points_available, stat_dresseur, stat_collectionneur, stat_tresorier, stat_legende FROM trainer_stats WHERE user_id = ?`,
      [targetUserId]
    );
    res.json({ success: true, ...updated });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/level/modifystat
router.post("/level/modifystat", async (req, res) => {
  const { targetUserId, stat, delta } = req.body;
  const VALID = ["dresseur", "collectionneur", "tresorier", "legende"];
  if (!VALID.includes(stat) || !Number.isInteger(delta) || delta === 0)
    return res.status(400).json({ error: "Paramètres invalides" });
  try {
    await run(
      `UPDATE trainer_stats SET stat_${stat} = MAX(0, stat_${stat} + ?) WHERE user_id = ?`,
      [delta, targetUserId]
    );
    const updated = await get(
      `SELECT xp, level, stat_points_available, stat_dresseur, stat_collectionneur, stat_tresorier, stat_legende FROM trainer_stats WHERE user_id = ?`,
      [targetUserId]
    );
    res.json({ success: true, ...updated });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// GET /api/admin/passives/:userId
router.get("/passives/:userId", async (req, res) => {
  try {
    const rows = await all(
      "SELECT item, unlocked, active FROM user_passives WHERE user_id = ?",
      [req.params.userId]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/passive/remove
router.post("/passive/remove", async (req, res) => {
  const { targetUserId, item } = req.body;
  try {
    await run(
      "UPDATE user_passives SET unlocked = 0, active = 0 WHERE user_id = ? AND item = ?",
      [targetUserId, item]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/passive/set  (unlock ou lock)
router.post("/passive/set", async (req, res) => {
  const { targetUserId, item, unlocked } = req.body;
  try {
    if (unlocked) {
      await run(
        "UPDATE user_passives SET unlocked = 1 WHERE user_id = ? AND item = ?",
        [targetUserId, item]
      );
    } else {
      await run(
        "UPDATE user_passives SET unlocked = 0, active = 0 WHERE user_id = ? AND item = ?",
        [targetUserId, item]
      );
    }
    const rows = await all("SELECT item, unlocked, active FROM user_passives WHERE user_id = ?", [targetUserId]);
    res.json({ success: true, passives: rows });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/user/setrole
router.post("/user/setrole", async (req, res) => {
  const { targetUsername, role } = req.body;
  if (!["user", "admin"].includes(role)) return res.status(400).json({ error: "Rôle invalide" });
  if (targetUsername === req.user.username) return res.status(400).json({ error: "Impossible de modifier son propre rôle" });
  try {
    const u = await get("SELECT id FROM users WHERE username = ?", [targetUsername]);
    if (!u) return res.status(404).json({ error: "Utilisateur introuvable" });
    await run("UPDATE users SET role = ? WHERE id = ?", [role, u.id]);
    emitToUser(u.id, "role_updated", { role });
    res.json({ success: true, role });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/user/setpassword
router.post("/user/setpassword", async (req, res) => {
  const { targetUsername, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: "Mot de passe trop court (min 4 caractères)" });
  try {
    const u = await get("SELECT id FROM users WHERE username = ?", [targetUsername]);
    if (!u) return res.status(404).json({ error: "Utilisateur introuvable" });
    const hashed = await bcrypt.hash(newPassword, 10);
    await run("UPDATE users SET password = ? WHERE id = ?", [hashed, u.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// GET /api/admin/achievements/:userId
router.get("/achievements/:userId", async (req, res) => {
  try {
    const rows = await all(
      "SELECT achievement_id, unlocked, claimed FROM achievements WHERE user_id = ?",
      [req.params.userId]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/achievements/reset-all — supprime tous les succès d'un joueur
router.post("/achievements/reset-all", async (req, res) => {
  const { targetUserId } = req.body;
  try {
    await run("DELETE FROM achievements WHERE user_id = ?", [targetUserId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/achievement/set
router.post("/achievement/set", async (req, res) => {
  const { targetUserId, achievementId, unlocked } = req.body;
  try {
    if (unlocked) {
      await run(
        `INSERT INTO achievements (user_id, achievement_id, unlocked, claimed) VALUES (?,?,1,0)
         ON CONFLICT(user_id, achievement_id) DO UPDATE SET unlocked = 1`,
        [targetUserId, achievementId]
      );
    } else {
      await run(
        "DELETE FROM achievements WHERE user_id = ? AND achievement_id = ?",
        [targetUserId, achievementId]
      );
    }
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

router.delete("/deleteUser/:username", async (req, res) => {
  const { username } = req.params;
  if (username === req.user.username) return res.status(400).json({ error: "Impossible de supprimer son propre compte" });
  try {
    const user = await get("SELECT id FROM users WHERE username=?", [username]);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    await run(`DELETE FROM captures             WHERE user_id = ?`, [user.id]);
    await run(`DELETE FROM user_passives        WHERE user_id = ?`, [user.id]);
    await run(`DELETE FROM achievements         WHERE user_id = ?`, [user.id]);
    await run(`DELETE FROM game_states          WHERE user_id = ?`, [user.id]);
    await run(`DELETE FROM user_badges          WHERE user_id = ?`, [user.id]);
    await run(`DELETE FROM user_arenes          WHERE username = ?`, [username]);
    await run(`DELETE FROM inventory            WHERE user_id = ?`, [user.id]);
    await run(`DELETE FROM trainer_stats        WHERE user_id = ?`, [user.id]);
    await run(`DELETE FROM pokeclick_upgrades   WHERE user_id = ?`, [user.id]);
    await run(`DELETE FROM daily_farm           WHERE user_id = ?`, [user.id]);
    await run(`DELETE FROM pokeclick_drop_log   WHERE user_id = ?`, [user.id]);
    await run(`DELETE FROM users                WHERE id = ?`, [user.id]);

    res.json({ success: true, message: `Utilisateur ${username} supprimé.` });
  } catch (err) {
    console.error("Erreur suppression:", err);
    res.status(500).json({ error: "Erreur lors de la suppression" });
  }
});

// GET /api/admin/captures/:userId
router.get("/captures/:userId", async (req, res) => {
  try {
    const rows = await all(
      "SELECT pokemon_name, is_shiny FROM captures WHERE user_id = ? ORDER BY pokemon_name",
      [req.params.userId]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/captures/add
router.post("/captures/add", async (req, res) => {
  const { targetUserId, pokemonName, isShiny } = req.body;
  try {
    await run(
      "INSERT OR IGNORE INTO captures (user_id, pokemon_name, is_shiny) VALUES (?,?,?)",
      [targetUserId, pokemonName, isShiny ? 1 : 0]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/captures/remove
router.post("/captures/remove", async (req, res) => {
  const { targetUserId, pokemonName, isShiny } = req.body;
  try {
    await run(
      "DELETE FROM captures WHERE user_id = ? AND pokemon_name = ? AND is_shiny = ?",
      [targetUserId, pokemonName, isShiny ? 1 : 0]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/captures/addall  (tous les Pokémon normaux ou shiny)
router.post("/captures/addall", async (req, res) => {
  const { targetUserId, isShiny, pokemonList } = req.body;
  try {
    for (const name of pokemonList) {
      await run(
        "INSERT OR IGNORE INTO captures (user_id, pokemon_name, is_shiny) VALUES (?,?,?)",
        [targetUserId, name, isShiny ? 1 : 0]
      );
    }
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/captures/removeall
router.post("/captures/removeall", async (req, res) => {
  const { targetUserId, isShiny } = req.body;
  try {
    if (isShiny === null || isShiny === undefined) {
      await run("DELETE FROM captures WHERE user_id = ?", [targetUserId]);
    } else {
      await run("DELETE FROM captures WHERE user_id = ? AND is_shiny = ?", [targetUserId, isShiny ? 1 : 0]);
    }
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ── Réserve admin ──────────────────────────────────────────────────

// GET /api/admin/reserve/:userId
router.get("/reserve/:userId", async (req, res) => {
  try {
    const rows = await all(
      "SELECT id, pokemon_name AS name, is_shiny AS isShiny, caught_at AS caughtAt FROM pokemon_reserve WHERE user_id = ? ORDER BY caught_at DESC",
      [req.params.userId]
    );
    res.json(rows);
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/reserve/add
router.post("/reserve/add", async (req, res) => {
  const { targetUserId, pokemonName, isShiny, qty = 1 } = req.body;
  try {
    for (let i = 0; i < Math.min(qty, 99); i++) {
      await run(
        "INSERT INTO pokemon_reserve (user_id, pokemon_name, is_shiny) VALUES (?,?,?)",
        [targetUserId, pokemonName, isShiny ? 1 : 0]
      );
    }
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/reserve/remove  (par id d'entrée)
router.post("/reserve/remove", async (req, res) => {
  const { targetUserId, entryId } = req.body;
  try {
    await run("DELETE FROM pokemon_reserve WHERE id = ? AND user_id = ?", [entryId, targetUserId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// GET /api/admin/stats
router.get("/stats", async (req, res) => {
  try {
    const [users, captures, shinys, economy, topRich, recentUsers] = await Promise.all([
      get("SELECT COUNT(*) as count FROM users"),
      get("SELECT COUNT(*) as count FROM captures WHERE is_shiny = 0"),
      get("SELECT COUNT(*) as count FROM captures WHERE is_shiny = 1"),
      get("SELECT COALESCE(SUM(pokedollars),0) as total, COALESCE(MAX(pokedollars),0) as max FROM inventory"),
      all("SELECT u.username, u.role, COALESCE(i.pokedollars,0) as pokedollars FROM users u LEFT JOIN inventory i ON i.user_id = u.id ORDER BY i.pokedollars DESC LIMIT 5"),
      all("SELECT username FROM users ORDER BY id DESC LIMIT 5"),
    ]);
    res.json({
      users:            users.count,
      captures:         captures.count,
      shinys:           shinys.count,
      totalPokedollars: economy.total,
      maxPokedollars:   economy.max,
      topRich,
      recentUsers,
    });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// GET /api/admin/teamrocket — état complet (butin, fuite, localisation)
router.get("/teamrocket", async (req, res) => {
  try {
    const row = await get("SELECT * FROM team_rocket WHERE id = 1");
    if (!row) return res.json({ exists: false });
    let inventaire = [];
    try { inventaire = JSON.parse(row.inventaire || "[]"); } catch { inventaire = []; }
    let finder = null;
    if (row.finder_id) {
      finder = await get("SELECT username FROM users WHERE id = ?", [row.finder_id]);
    }
    res.json({
      compteur:    row.compteur,
      seuil:       50,
      statut:      row.statut,
      page_cachee: row.page_cachee,
      pos_x:       row.pos_x,
      pos_y:       row.pos_y,
      fled_at:     row.fled_at,
      updated_at:  row.updated_at,
      finder:      finder?.username ?? null,
      inventaire,
    });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/teamrocket/reset — force le retour au shop (débloque le cycle)
router.post("/teamrocket/reset", async (req, res) => {
  try {
    await run(
      `UPDATE team_rocket SET compteur = 0, statut = 'au_shop', page_cachee = NULL,
       pos_x = NULL, pos_y = NULL, inventaire = '[]', finder_id = NULL,
       updated_at = CURRENT_TIMESTAMP WHERE id = 1`
    );
    await broadcastRocket();
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// ─── Codes promo ──────────────────────────────────────────────────
// GET /api/admin/promo-codes  → liste des codes
router.get("/promo-codes", async (req, res) => {
  try {
    const rows = await all(
      `SELECT p.id, p.code, p.reward_data, p.uses, p.max_uses, p.is_active, p.created_at, u.username AS created_by
       FROM promo_codes p LEFT JOIN users u ON u.id = p.created_by
       ORDER BY p.created_at DESC`
    );
    res.json(rows.map(r => ({
      id:        r.id,
      code:      r.code,
      rewardData: (() => { try { return JSON.parse(r.reward_data || "{}"); } catch { return {}; } })(),
      uses:      r.uses,
      maxUses:   r.max_uses,
      isActive:  !!r.is_active,
      createdAt: r.created_at,
      createdBy: r.created_by,
    })));
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// POST /api/admin/promo-codes  → créer un code { code, rewardData }
router.post("/promo-codes", async (req, res) => {
  const { code, rewardData, maxUses } = req.body;
  const clean = (code || "").trim();
  if (!clean) return res.status(400).json({ error: "Nom du code requis" });
  if (clean.length > 40) return res.status(400).json({ error: "Code trop long (40 max)" });

  // Limite d'utilisation optionnelle (NULL = illimité)
  let maxUsesVal = null;
  if (maxUses !== undefined && maxUses !== null && maxUses !== "") {
    const m = parseInt(maxUses);
    if (!Number.isFinite(m) || m < 1)
      return res.status(400).json({ error: "Limite d'utilisation invalide" });
    maxUsesVal = m;
  }

  // Filtre les récompenses valides et positives
  const rd = {};
  for (const [item, qty] of Object.entries(rewardData || {})) {
    const n = parseInt(qty);
    if (VALID_ITEMS.has(item) && Number.isFinite(n) && n > 0) rd[item] = n;
  }
  if (Object.keys(rd).length === 0)
    return res.status(400).json({ error: "Ajoute au moins une récompense" });

  try {
    const result = await run(
      `INSERT INTO promo_codes (code, reward_data, max_uses, created_by) VALUES (?,?,?,?)`,
      [clean, JSON.stringify(rd), maxUsesVal, req.user.id]
    );
    res.json({ success: true, id: result.lastID });
  } catch (err) {
    if (err.message?.includes("UNIQUE"))
      return res.status(400).json({ error: "Ce code existe déjà" });
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /api/admin/promo-codes/:id
router.delete("/promo-codes/:id", async (req, res) => {
  try {
    await run(`DELETE FROM promo_codes WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// GET /api/admin/server-stats
router.get("/server-stats", (req, res) => {
  try {
    // Disque
    const dfLine = execSync("df -B1 /").toString().trim().split("\n")[1].split(/\s+/);
    const diskTotal = parseInt(dfLine[1]);
    const diskUsed  = parseInt(dfLine[2]);
    const diskFree  = parseInt(dfLine[3]);

    // DB
    const dbPath = process.env.DB_PATH || "./users.db";
    let dbSize = 0;
    try { dbSize = fs.statSync(dbPath).size; } catch {}

    // Mémoire
    const memTotal = os.totalmem();
    const memFree  = os.freemem();
    const memUsed  = memTotal - memFree;

    // CPU load average
    const [load1, load5, load15] = os.loadavg();

    // Uptime
    const sysUptime  = os.uptime();
    const procUptime = process.uptime();

    // Connexions actives (nombre de fichiers ouverts, approximation)
    const cpuCount = os.cpus().length;

    res.json({
      disk:    { total: diskTotal, used: diskUsed, free: diskFree },
      memory:  { total: memTotal,  used: memUsed,  free: memFree  },
      db:      { size: dbSize },
      cpu:     { load1, load5, load15, cores: cpuCount },
      uptime:  { system: sysUptime, process: procUptime },
      node:    process.version,
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur lecture serveur" });
  }
});

// POST /api/admin/game/resetglobal  — reset un cooldown pour TOUS les joueurs
router.post("/game/resetglobal", async (req, res) => {
  const { gameType } = req.body;
  if (!gameType) return res.status(400).json({ error: "gameType requis" });
  try {
    if (gameType === "all") {
      await run("DELETE FROM game_states");
    } else {
      await run("DELETE FROM game_states WHERE game_type = ?", [gameType]);
    }
    res.json({ success: true });
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

router.get("/users", async (req, res) => {
  try {
    const users = await all(
      `SELECT u.id, u.username, u.role, u.last_game_type, u.last_game_at,
              COALESCE(i.pokedollars, 0) as pokedollars,
              COALESCE(SUM(CASE WHEN c.is_shiny = 0 THEN 1 ELSE 0 END), 0) as normal_count,
              COALESCE(SUM(CASE WHEN c.is_shiny = 1 THEN 1 ELSE 0 END), 0) as shiny_count
       FROM users u
       LEFT JOIN inventory i ON i.user_id = u.id
       LEFT JOIN captures c ON c.user_id = u.id
       GROUP BY u.id
       ORDER BY u.id DESC`
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Routes debug uniquement en développement
if (process.env.NODE_ENV !== "production") {
  router.post("/debug/fillpokedex/:username", async (req, res) => {
    const user = await get("SELECT id FROM users WHERE username=?", [req.params.username]);
    if (!user) return res.status(404).json({ error: "Introuvable" });

    for (const p of GEN1_POKEMONS) {
      await run("INSERT OR IGNORE INTO captures (userId, pokemonName, isShiny) VALUES (?,?,0)", [user.id, p]);
    }
    res.json({ success: true, message: "Pokédex rempli" });
  });

  router.post("/debug/fillshiny/:username", async (req, res) => {
    const user = await get("SELECT id FROM users WHERE username=?", [req.params.username]);
    if (!user) return res.status(404).json({ error: "Introuvable" });

    for (const p of GEN1_POKEMONS) {
      await run("INSERT OR IGNORE INTO captures (userId, pokemonName, isShiny) VALUES (?,?,1)", [user.id, p]);
    }
    res.json({ success: true, message: "ShinyDex rempli" });
  });
}

export default router;
