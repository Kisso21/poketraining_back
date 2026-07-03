import { Router } from "express";
import bcrypt from "bcrypt";
import os from "os";
import fs from "fs";
import { execSync } from "child_process";
import { run, get, all, GEN1_POKEMONS } from "../db.js";
import { verifyAdmin, ALLOWED_ITEM_COLUMNS } from "../middleware/auth.js";
import { emitToUser, getIO } from "../socket.js";
import { broadcastRocket } from "./teamRocket.js";
import { VALID_ITEMS } from "./events.js";
import { LOOT_TABLE, SHOP_ITEM_KEYS } from "./inventory.js";
import { parisParts, multiplierFor, lootboxFor, baseForDay, BASE_START, BASE_STEP, specialDaysForMonth } from "./dailyLogin.js";

const router = Router();

router.use(verifyAdmin);

// GET /api/admin/user/:username
router.get("/user/:username", async (req, res) => {
  try {
    const u = await get(
      `SELECT u.id, u.username, u.role,
              i.pokedollars, i.pokeball, i.superball, i.hyperball, i.masterball,
              i.resetball, i.superbonbon, i.potion, i.lootbox,
              i.ticketsafari, i.goldappat, i.sablier, i.charmeeclaire
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
      `SELECT pokedollars, pokeball, superball, hyperball, masterball, resetball, superbonbon, potion, lootbox,
              ticketsafari, goldappat, sablier, charmeeclaire
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
    const [users, captures, shinys, economy, topRich, recentUsers, topPokemon] = await Promise.all([
      get("SELECT COUNT(*) as count FROM users"),
      get("SELECT COUNT(*) as count FROM captures WHERE is_shiny = 0"),
      get("SELECT COUNT(*) as count FROM captures WHERE is_shiny = 1"),
      get("SELECT COALESCE(SUM(pokedollars),0) as total, COALESCE(MAX(pokedollars),0) as max FROM inventory"),
      all("SELECT u.username, u.role, COALESCE(i.pokedollars,0) as pokedollars FROM users u LEFT JOIN inventory i ON i.user_id = u.id ORDER BY i.pokedollars DESC LIMIT 5"),
      all("SELECT username FROM users ORDER BY id DESC LIMIT 5"),
      // Top 5 joueurs par total de Pokémon capturés (normaux + shiny)
      all("SELECT u.username, u.role, COUNT(c.id) as total FROM users u LEFT JOIN captures c ON c.user_id = u.id GROUP BY u.id ORDER BY total DESC LIMIT 5"),
    ]);

    // Activité par période (fenêtres glissantes) : inscrits + joueurs ayant joué
    const signupsSince = (since) => get(`SELECT COUNT(*) as n FROM users WHERE created_at >= datetime('now', ?)`, [since]);
    const activeSince  = (since) => get(`SELECT COUNT(DISTINCT user_id) as n FROM game_states WHERE updated_at >= datetime('now', ?)`, [since]);
    const [sd, sw, sm, ad, aw, am] = await Promise.all([
      signupsSince("-1 day"), signupsSince("-7 days"), signupsSince("-30 days"),
      activeSince("-1 day"),  activeSince("-7 days"),  activeSince("-30 days"),
    ]);

    res.json({
      users:            users.count,
      captures:         captures.count,
      shinys:           shinys.count,
      totalPokedollars: economy.total,
      maxPokedollars:   economy.max,
      topRich,
      recentUsers,
      topPokemon,
      activity: {
        signups: { day: sd.n, week: sw.n, month: sm.n },
        active:  { day: ad.n, week: aw.n, month: am.n },
      },
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

// POST /api/admin/teamrocket/bag/remove — retire un Pokémon du sac (par index)
// body: { index }
router.post("/teamrocket/bag/remove", async (req, res) => {
  const index = parseInt(req.body.index, 10);
  if (!Number.isInteger(index) || index < 0)
    return res.status(400).json({ error: "Index invalide" });
  try {
    const row = await get("SELECT inventaire FROM team_rocket WHERE id = 1");
    if (!row) return res.status(404).json({ error: "Team Rocket introuvable" });

    let inventaire = [];
    try { inventaire = JSON.parse(row.inventaire || "[]"); } catch { inventaire = []; }
    if (index >= inventaire.length)
      return res.status(400).json({ error: "Index hors limites" });

    const [removed] = inventaire.splice(index, 1);
    await run(
      `UPDATE team_rocket SET inventaire = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
      [JSON.stringify(inventaire)]
    );
    await broadcastRocket();
    res.json({ success: true, removed, inventaire });
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
      `SELECT u.id, u.username, u.role, u.email, u.email_verified, u.last_game_type, u.last_game_at,
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

/* ══════════════════════════════════════════════════════════════════
   ACTIONS GLOBALES — appliquées à TOUS les joueurs en une requête
   Sécurité : colonnes whitelistées (ALLOWED_ITEM_COLUMNS) → pas d'injection
   SQL sur les noms de colonnes ; valeurs paramétrées et bornées ; UPDATE
   unique atomique ; audit dans admin_global_log ; resync broadcast.
══════════════════════════════════════════════════════════════════ */
const GLOBAL_MAX_VALUE = 100_000_000;   // borne de sécurité sur les montants
const intInRange = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) && Math.abs(n) <= GLOBAL_MAX_VALUE ? n : null;
};

// POST /api/admin/global/apply
// body: { op:"give"|"set"|"convert", item?, value?, from?, to?, rate? }
router.post("/global/apply", async (req, res) => {
  const { op } = req.body;

  try {
    let sql, params, detail, label;

    if (op === "give") {
      const { item } = req.body;
      const value = intInRange(req.body.value);
      if (!ALLOWED_ITEM_COLUMNS.has(item)) return res.status(400).json({ error: "Objet invalide" });
      if (value === null || value === 0)   return res.status(400).json({ error: "Montant invalide" });
      // Donne (ou retire si négatif) ; jamais en dessous de 0
      sql = `UPDATE inventory SET ${item} = MAX(0, COALESCE(${item},0) + ?)`;
      params = [value];
      detail = { item, value };
      label = `${value > 0 ? "+" : ""}${value} ${item} à tous`;

    } else if (op === "set") {
      const { item } = req.body;
      const value = intInRange(req.body.value);
      if (!ALLOWED_ITEM_COLUMNS.has(item)) return res.status(400).json({ error: "Objet invalide" });
      if (value === null || value < 0)     return res.status(400).json({ error: "Valeur invalide" });
      sql = `UPDATE inventory SET ${item} = ?`;
      params = [value];
      detail = { item, value };
      label = `${item} = ${value} pour tous`;

    } else if (op === "convert") {
      const { from, to } = req.body;
      const rate = intInRange(req.body.rate);
      if (!ALLOWED_ITEM_COLUMNS.has(from) || !ALLOWED_ITEM_COLUMNS.has(to))
        return res.status(400).json({ error: "Objet invalide" });
      if (from === to)                  return res.status(400).json({ error: "Source et destination identiques" });
      if (rate === null || rate <= 0)   return res.status(400).json({ error: "Taux invalide" });
      // Pour chaque joueur possédant `from` : `to` += from*rate, puis `from` = 0
      sql = `UPDATE inventory SET ${to} = MAX(0, COALESCE(${to},0) + COALESCE(${from},0) * ?), ${from} = 0 WHERE COALESCE(${from},0) > 0`;
      params = [rate];
      detail = { from, to, rate };
      label = `${from} → ${to} (×${rate}) pour tous`;

    } else {
      return res.status(400).json({ error: "Opération inconnue" });
    }

    const result = await run(sql, params);
    const affected = result?.changes ?? 0;

    await run(
      `INSERT INTO admin_global_log (admin, op, detail, affected) VALUES (?,?,?,?)`,
      [req.user?.username || "?", op, JSON.stringify(detail), affected]
    );

    // Resync : un broadcast suffit, chaque client re-fetch son inventaire
    getIO()?.emit("sync:inventory", {});

    res.json({ success: true, affected, label });
  } catch (err) {
    console.error("Erreur global/apply:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/admin/lootbox-table — table de loot réelle (source unique de vérité)
const POKEMON_LABEL = {
  "stade1ou2,sansevo": "Pokémon Stade 1/2 ou sans évo",
  "stade3":            "Pokémon Stade 3",
  "legendaire":        "Pokémon Légendaire",
  "fossile,stade3":    "Pokémon Fossile / Stade 3",
  "mythic":            "Pokémon Mythique",
  "legendaire,mythic": "Pokémon Légendaire / Mythique",
};
router.get("/lootbox-table", (req, res) => {
  const total = LOOT_TABLE.reduce((s, e) => s + e.chance, 0);
  const rows = LOOT_TABLE.map(e => {
    let label;
    if (e.type === "pokemon") {
      const base = POKEMON_LABEL[(e.catFilter || []).join(",")] || "Pokémon";
      label = e.isShiny ? `✦ Shiny ${base.replace(/^Pokémon /, "")}` : base;
    } else {
      label = e.key === "pokedollars" ? `Pokédollars ×${e.value}` : `${e.key} ×${e.value}`;
    }
    return { label, key: e.key, value: e.value ?? 1, type: e.type, rarity: e.rarity, chance: e.chance, isShiny: !!e.isShiny };
  });
  res.json({ total, rows });
});

// GET /api/admin/global/log — historique des actions globales
router.get("/global/log", async (req, res) => {
  try {
    const rows = await all(`SELECT id, admin, op, detail, affected, created_at FROM admin_global_log ORDER BY id DESC LIMIT 30`);
    res.json(rows.map(r => ({ ...r, detail: (() => { try { return JSON.parse(r.detail); } catch { return {}; } })() })));
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/admin/shop/prices — prix actuels (achat/vente) de la boutique
router.get("/shop/prices", async (req, res) => {
  try {
    const rows = await all(`SELECT item, buy, sell FROM shop_prices`);
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/admin/shop/prices — met à jour les prix (achat/vente) de la boutique
// body: { prices: [{ item, buy, sell }, ...] }
router.post("/shop/prices", async (req, res) => {
  const { prices } = req.body;
  if (!Array.isArray(prices) || prices.length === 0) {
    return res.status(400).json({ error: "Aucun prix fourni" });
  }
  const MAX = 1_000_000_000;
  const allowed = new Set(SHOP_ITEM_KEYS);
  const clean = [];
  for (const p of prices) {
    if (!p || !allowed.has(p.item)) continue;
    const buy  = Math.round(Number(p.buy));
    const sell = Math.round(Number(p.sell));
    if (!Number.isFinite(buy) || !Number.isFinite(sell) || buy < 0 || sell < 0 || buy > MAX || sell > MAX) {
      return res.status(400).json({ error: `Valeur invalide pour ${p.item}` });
    }
    clean.push({ item: p.item, buy, sell });
  }
  if (clean.length === 0) return res.status(400).json({ error: "Aucun prix valide" });
  try {
    for (const { item, buy, sell } of clean) {
      await run(`UPDATE shop_prices SET buy = ?, sell = ? WHERE item = ?`, [buy, sell, item]);
    }
    // Avertit les clients que la boutique a changé (la ShopModal refetch à l'ouverture)
    getIO()?.emit("shop:prices-updated", {});
    const rows = await all(`SELECT item, buy, sell FROM shop_prices`);
    res.json({ success: true, prices: rows });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Calendrier de récompense quotidienne d'un joueur ──────────────────────
function dailyMonthCtx() {
  const { y, m, day } = parisParts();
  const pad = n => String(n).padStart(2, "0");
  return { year: y, month: m, today: day, daysInMonth: new Date(y, m, 0).getDate(), prefix: `${y}-${pad(m)}-`, pad };
}

// Recalcule le nombre de jours réclamés dans le mois en cours (les jours manqués
// entre-temps ne remettent pas le multiplicateur à zéro) → met à jour daily_login.
async function recomputeDailyStreak(userId) {
  const ctx = dailyMonthCtx();
  const rows = await all(
    `SELECT claim_date FROM daily_claims WHERE user_id = ? AND claim_date LIKE ? ORDER BY claim_date DESC`,
    [userId, ctx.prefix + "%"]
  );
  const cur = await get(`SELECT best_streak FROM daily_login WHERE user_id = ?`, [userId]);
  const streak = rows.length;
  const last = rows[0]?.claim_date || null;
  const best = Math.max(cur?.best_streak || 0, streak);
  await run(`INSERT INTO daily_login (user_id, streak, last_claim_date, best_streak) VALUES (?,?,?,?)
             ON CONFLICT(user_id) DO UPDATE SET streak = ?, last_claim_date = ?, best_streak = ?`,
             [userId, streak, last, best, streak, last, best]);
  return { streak };
}

// GET /api/admin/daily/:username — calendrier + série du joueur
router.get("/daily/:username", async (req, res) => {
  try {
    const u = await get(`SELECT id FROM users WHERE username = ?`, [req.params.username]);
    if (!u) return res.status(404).json({ error: "Utilisateur introuvable" });
    const ctx = dailyMonthCtx();
    const login = await get(`SELECT last_claim_date, best_streak FROM daily_login WHERE user_id = ?`, [u.id]);
    const claims = await all(
      `SELECT claim_date FROM daily_claims WHERE user_id = ? AND claim_date LIKE ?`,
      [u.id, ctx.prefix + "%"]
    );
    const streak = claims.length;
    res.json({
      year: ctx.year, month: ctx.month, today: ctx.today, daysInMonth: ctx.daysInMonth,
      claimedDays: claims.map(c => Number(c.claim_date.slice(8, 10))),
      streak,
      bestStreak: login?.best_streak || 0,
      multiplier: multiplierFor(streak),
      lastClaim: login?.last_claim_date || null,
      specialDays: specialDaysForMonth(ctx.year, ctx.month, ctx.daysInMonth),
      config: { baseStart: BASE_START, baseStep: BASE_STEP },
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/admin/daily/:username/toggle — coche/décoche un jour du mois courant
router.post("/daily/:username/toggle", async (req, res) => {
  try {
    const u = await get(`SELECT id FROM users WHERE username = ?`, [req.params.username]);
    if (!u) return res.status(404).json({ error: "Utilisateur introuvable" });
    const ctx = dailyMonthCtx();
    const day = parseInt(req.body.day, 10);
    if (!Number.isInteger(day) || day < 1 || day > ctx.daysInMonth) {
      return res.status(400).json({ error: "Jour invalide" });
    }
    const date = ctx.prefix + ctx.pad(day);
    const exists = await get(`SELECT 1 AS c FROM daily_claims WHERE user_id = ? AND claim_date = ?`, [u.id, date]);

    if (exists) await run(`DELETE FROM daily_claims WHERE user_id = ? AND claim_date = ?`, [u.id, date]);
    else        await run(`INSERT OR IGNORE INTO daily_claims (user_id, claim_date) VALUES (?,?)`, [u.id, date]);

    // Recalcule la série (donc le multiplicateur) d'après les jours cochés
    const { streak } = await recomputeDailyStreak(u.id);
    const mult = multiplierFor(streak);

    let reward = null;
    if (!exists) {
      // Coche : crédite la récompense du jour (base × multiplicateur recalculé)
      const money = Math.round(baseForDay(day) * mult);
      const count = lootboxFor(mult);
      let item = specialDaysForMonth(ctx.year, ctx.month, ctx.daysInMonth)[day] || "lootbox";
      if (!["lootbox", "hyperball", "resetball"].includes(item)) item = "lootbox"; // whitelist défensive
      await run(`UPDATE inventory SET pokedollars = pokedollars + ?, ${item} = COALESCE(${item},0) + ? WHERE user_id = ?`, [money, count, u.id]);
      getIO()?.emit("sync:inventory", { userId: u.id });
      reward = { money, item, count, multiplier: mult };
    }

    const claims = await all(
      `SELECT claim_date FROM daily_claims WHERE user_id = ? AND claim_date LIKE ?`,
      [u.id, ctx.prefix + "%"]
    );
    res.json({ success: true, added: !exists, reward, streak, multiplier: mult, claimedDays: claims.map(c => Number(c.claim_date.slice(8, 10))) });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/admin/daily/:username/streak — fixe la série de connexion du joueur
router.post("/daily/:username/streak", async (req, res) => {
  try {
    const u = await get(`SELECT id FROM users WHERE username = ?`, [req.params.username]);
    if (!u) return res.status(404).json({ error: "Utilisateur introuvable" });
    const ctx = dailyMonthCtx();
    let streak = parseInt(req.body.streak, 10);
    if (!Number.isInteger(streak) || streak < 0) streak = 0;
    streak = Math.min(streak, ctx.today); // ne peut pas dépasser le nombre de jours écoulés ce mois

    // Reconstruit réellement le calendrier : coche les `streak` derniers jours jusqu'à aujourd'hui,
    // pour que le multiplicateur (basé sur daily_claims) reflète bien la valeur forcée.
    await run(`DELETE FROM daily_claims WHERE user_id = ? AND claim_date LIKE ?`, [u.id, ctx.prefix + "%"]);
    for (let i = 0; i < streak; i++) {
      await run(`INSERT OR IGNORE INTO daily_claims (user_id, claim_date) VALUES (?,?)`, [u.id, ctx.prefix + ctx.pad(ctx.today - i)]);
    }

    const today = ctx.prefix + ctx.pad(ctx.today);
    const cur = await get(`SELECT best_streak FROM daily_login WHERE user_id = ?`, [u.id]);
    const best = Math.max(cur?.best_streak || 0, streak);
    await run(
      `INSERT INTO daily_login (user_id, streak, last_claim_date, best_streak) VALUES (?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET streak = ?, last_claim_date = ?, best_streak = ?`,
      [u.id, streak, today, best, streak, today, best]
    );
    res.json({ success: true, streak, bestStreak: best });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/admin/teamrocket/history — qui a retrouvé la Team Rocket + Pokémon pris
router.get("/teamrocket/history", async (req, res) => {
  try {
    const rows = await all(
      `SELECT id, username, pokemon_name, is_shiny, created_at
       FROM team_rocket_history ORDER BY id DESC LIMIT 50`
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
