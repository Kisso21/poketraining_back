import { Router } from "express";
import { run, get } from "../db.js";
import { getIO } from "../socket.js";

const router = Router();

// Seuil de fuite et pages où la Team Rocket peut se cacher.
// Doit rester aligné avec ALL_GAME_IDS + "home" côté front (App.jsx).
export const ROCKET_SEUIL = 50;
export const HIDE_PAGES = [
  "home",
  "devinette", "ombre", "cri", "carte", "text", "atq", "palette", "pixel",
  "galop", "pokeclick", "pokecharlie", "casino", "safari", "anagramme",
  "dessin", "poketrade", "arene", "versus", "memory", "radar", "stop",
];

export function randomHidePage() {
  return HIDE_PAGES[Math.floor(Math.random() * HIDE_PAGES.length)];
}

// Position aléatoire (en %) — coordonnées du CENTRE du sprite côté front.
// Large amplitude pour couvrir tout l'écran (coins compris) sans déborder.
export function randomPos() {
  const x = Math.round((5 + Math.random() * 90) * 10) / 10;  // 5% → 95%
  const y = Math.round((10 + Math.random() * 82) * 10) / 10; // 10% → 92%
  return { x, y };
}

// ─── Broadcast de l'état public à tous les clients (jamais l'inventaire) ──────
export async function broadcastRocket() {
  try {
    const row = await get("SELECT compteur, statut, page_cachee, pos_x, pos_y FROM team_rocket WHERE id = 1");
    if (!row) return;
    getIO()?.emit("rocket:update", {
      compteur:    row.compteur,
      seuil:       ROCKET_SEUIL,
      statut:      row.statut,
      page_cachee: row.page_cachee,
      pos_x:       row.pos_x,
      pos_y:       row.pos_y,
    });
  } catch {}
}

// GET /api/teamrocket — état courant (fetch initial / resync)
router.get("/", async (req, res) => {
  try {
    const row = await get("SELECT compteur, statut, page_cachee, pos_x, pos_y FROM team_rocket WHERE id = 1");
    res.json({
      compteur:    row?.compteur ?? 0,
      seuil:       ROCKET_SEUIL,
      statut:      row?.statut ?? "au_shop",
      page_cachee: row?.page_cachee ?? null,
      pos_x:       row?.pos_x ?? null,
      pos_y:       row?.pos_y ?? null,
    });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/teamrocket/found — premier joueur à cliquer sur le sprite caché
router.post("/found", async (req, res) => {
  const userId = req.user.id;
  try {
    // Verrou atomique : un seul UPDATE peut réussir (statut en_fuite + finder vide)
    const result = await run(
      `UPDATE team_rocket SET statut = 'retrouvee', finder_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = 1 AND statut = 'en_fuite' AND finder_id IS NULL`,
      [userId]
    );

    if (result.changes === 0) {
      return res.status(409).json({ error: "Trop tard, quelqu'un a déjà trouvé la Team Rocket !" });
    }

    const row = await get("SELECT inventaire FROM team_rocket WHERE id = 1");
    let inventaire = [];
    try { inventaire = JSON.parse(row?.inventaire || "[]"); } catch { inventaire = []; }

    broadcastRocket(); // notifie tout le monde que la fuite est terminée
    res.json({ success: true, inventaire });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/teamrocket/release — le finder ferme sans choisir : la Team Rocket
// repart en fuite (même page) pour que la chasse reprenne. Évite de bloquer le cycle.
router.post("/release", async (req, res) => {
  const userId = req.user.id;
  try {
    const result = await run(
      `UPDATE team_rocket SET statut = 'en_fuite', finder_id = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = 1 AND statut = 'retrouvee' AND finder_id = ?`,
      [userId]
    );
    if (result.changes > 0) broadcastRocket();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/teamrocket/claim — le finder récupère 1 SEUL Pokémon du butin
// body: { picks: [index] }
router.post("/claim", async (req, res) => {
  const userId = req.user.id;
  const { picks } = req.body;

  if (!Array.isArray(picks) || picks.length !== 1) {
    return res.status(400).json({ error: "Choisis 1 Pokémon" });
  }
  const uniquePicks = [...new Set(picks.map(Number))];
  if (uniquePicks.length !== picks.length || uniquePicks.some(i => !Number.isInteger(i) || i < 0)) {
    return res.status(400).json({ error: "Choix invalide" });
  }

  try {
    const row = await get("SELECT statut, finder_id, inventaire FROM team_rocket WHERE id = 1");
    if (!row || row.statut !== "retrouvee" || row.finder_id !== userId) {
      return res.status(403).json({ error: "Tu n'as pas trouvé la Team Rocket" });
    }

    let inventaire = [];
    try { inventaire = JSON.parse(row.inventaire || "[]"); } catch { inventaire = []; }
    if (uniquePicks.some(i => i >= inventaire.length)) {
      return res.status(400).json({ error: "Choix invalide" });
    }

    const recovered = [];
    for (const idx of uniquePicks) {
      const { name, isShiny } = inventaire[idx];
      const shiny = isShiny ? 1 : 0;
      // Même logique que POST /capture : Pokédex si nouveau, sinon réserve
      const ins = await run(
        `INSERT OR IGNORE INTO captures (user_id, pokemon_name, is_shiny) VALUES (?,?,?)`,
        [userId, name, shiny]
      );
      const addedToReserve = ins.changes === 0;
      if (addedToReserve) {
        await run(
          `INSERT INTO pokemon_reserve (user_id, pokemon_name, is_shiny) VALUES (?,?,?)`,
          [userId, name, shiny]
        );
      }
      recovered.push({ name, isShiny: shiny, addedToReserve });
      getIO()?.emit("sync:pokedex", { userId, pokemonName: name, isShiny: shiny, addedToReserve, newAchievements: [] });
      // Historique : trace qui a retrouvé la Team Rocket et le Pokémon récupéré
      const u = await get("SELECT username FROM users WHERE id = ?", [userId]);
      await run(
        `INSERT INTO team_rocket_history (user_id, username, pokemon_name, is_shiny) VALUES (?,?,?,?)`,
        [userId, u?.username || "?", name, shiny]
      );
    }

    // Reset complet : le cycle recommence, le shop est débloqué
    await run(
      `UPDATE team_rocket SET compteur = 0, statut = 'au_shop', page_cachee = NULL,
       inventaire = '[]', finder_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = 1`
    );
    broadcastRocket();

    res.json({ success: true, recovered });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
