import { Router } from "express";
import { run, get, all } from "../db.js";
import { broadcastRocket, randomHidePage, randomPos, ROCKET_SEUIL } from "./teamRocket.js";

const router = Router();

// Prix de revente par catégorie — Gen 1 à 4
const FOSSIL_IDS = new Set([
  138,139,140,141,142,        // Gen 1 : Amonita, Amonistar, Kabuto, Kabutops, Ptéra
  345,346,347,348,            // Gen 3 : Lilia, Vacilys, Anorith, Armaldo
  408,409,410,411,            // Gen 4 : Kranidos, Charkos, Dinoclier, Bastiodon
]);
const LEGEND_IDS = new Set([
  144,145,146,150,            // Gen 1 : Artikodin, Électhor, Sulfura, Mewtwo
  243,244,245,249,250,        // Gen 2 : Raikou, Entei, Suicune, Lugia, Ho-Oh
  377,378,379,380,381,        // Gen 3 : Regirock, Regice, Registeel, Latias, Latios
  382,383,384,                // Gen 3 : Kyogre, Groudon, Rayquaza
  480,481,482,483,484,        // Gen 4 : Créhelf, Créfollet, Créfadet, Dialga, Palkia
  485,486,487,488,            // Gen 4 : Heatran, Regigigas, Giratina, Cresselia
]);
const MYTHIC_IDS = new Set([
  151, 251,                   // Gen 1-2 : Mew, Celebi
  385, 386,                   // Gen 3 : Jirachi, Deoxys
  489,490,491,492,493,        // Gen 4 : Phione, Manaphy, Darkrai, Shaymin, Arceus
]);
const NO_EVO_IDS = new Set([83,108,114,115,122,127,128,131,132,143,190,193,198,200,201,203,206,207,211,213,214,215,222,225,226,227,234,235]);

function getSellPrice(pokemonData, isShiny) {
  const { id, stage } = pokemonData;
  let base;
  if      (MYTHIC_IDS.has(id))  base = 15000;
  else if (LEGEND_IDS.has(id))  base = 10000;
  else if (FOSSIL_IDS.has(id))  base = 5000;
  else if (NO_EVO_IDS.has(id))  base = 2000;
  else if (stage === 3)         base = 5000;
  else if (stage === 2)         base = 2000;
  else                          base = 500;
  return isShiny ? base * 2 : base;
}

// GET /api/reserve — liste la réserve du joueur
router.get("/", async (req, res) => {
  try {
    const rows = await all(
      `SELECT id, pokemon_name AS name, is_shiny AS isShiny, caught_at AS caughtAt
       FROM pokemon_reserve WHERE user_id = ? ORDER BY caught_at DESC`,
      [req.user.id]
    );
    res.json({ reserve: rows });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/reserve/sell — vend un ou plusieurs Pokémon de la réserve
// body: { ids: [1,2,3] }  (ids dans pokemon_reserve)
router.post("/sell", async (req, res) => {
  const userId = req.user.id;
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0)
    return res.status(400).json({ error: "Aucun Pokémon sélectionné" });

  try {
    // Team Rocket : ventes bloquées tant qu'elle n'est pas de retour au shop
    const rocket = await get(`SELECT statut FROM team_rocket WHERE id = 1`);
    if (rocket && rocket.statut !== "au_shop")
      return res.status(403).json({ error: "La Team Rocket est partie avec tous les Pokémon !" });

    const placeholders = ids.map(() => "?").join(",");
    const entries = await all(
      `SELECT id, pokemon_name AS name, is_shiny AS isShiny
       FROM pokemon_reserve WHERE id IN (${placeholders}) AND user_id = ?`,
      [...ids, userId]
    );

    if (entries.length === 0)
      return res.status(404).json({ error: "Pokémon introuvables dans ta réserve" });

    const { readFileSync } = await import("fs");
    const gen12 = JSON.parse(readFileSync("/var/www/html/data/gen1_2.json", "utf8"));
    const gen34 = (() => { try { return JSON.parse(readFileSync("/var/www/html/data/gen3_4.json", "utf8")); } catch { return []; } })();
    const pkMap = {};
    [...gen12, ...gen34].forEach(p => { pkMap[p.nom || p.name] = p; });

    let total = 0;
    for (const entry of entries) {
      const pkData = pkMap[entry.name] || {};
      const price  = getSellPrice({ id: pkData.id || 0, stage: pkData.stage || 1, type1: pkData.type1, type2: pkData.type2 }, Number(entry.isShiny) === 1);
      total += price;
    }

    // Vente Team Rocket : aucun bonus (ni Trésorier, ni Lucky Coin)
    const gained = total;

    // Supprimer les entrées vendues
    await run(
      `DELETE FROM pokemon_reserve WHERE id IN (${placeholders}) AND user_id = ?`,
      [...ids, userId]
    );

    // Créditer les pokédollars (pas de limite journalière)
    await run(`UPDATE inventory SET pokedollars = pokedollars + ? WHERE user_id = ?`, [gained, userId]);

    // Team Rocket : +1 par Pokémon vendu, ajout au butin, fuite à 50/50
    try {
      const tr = await get(`SELECT compteur, inventaire FROM team_rocket WHERE id = 1 AND statut = 'au_shop'`);
      if (tr) {
        let butin = [];
        try { butin = JSON.parse(tr.inventaire || "[]"); } catch { butin = []; }
        for (const e of entries) butin.push({ name: e.name, isShiny: Number(e.isShiny) === 1 ? 1 : 0 });
        const newCount = Math.min(ROCKET_SEUIL, (tr.compteur || 0) + entries.length);
        if (newCount >= ROCKET_SEUIL) {
          const pos = randomPos();
          await run(
            `UPDATE team_rocket SET compteur = ?, inventaire = ?, statut = 'en_fuite',
             page_cachee = ?, pos_x = ?, pos_y = ?, finder_id = NULL, fled_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
            [ROCKET_SEUIL, JSON.stringify(butin), randomHidePage(), pos.x, pos.y]
          );
        } else {
          await run(
            `UPDATE team_rocket SET compteur = ?, inventaire = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
            [newCount, JSON.stringify(butin)]
          );
        }
        broadcastRocket();
      }
    } catch (e) { console.error("Team Rocket sell hook:", e); }

    const newBalance = await get(`SELECT pokedollars FROM inventory WHERE user_id = ?`, [userId]);
    res.json({
      success: true,
      earned: gained,
      baseEarned: total,
      appliedBonus: false,
      tresorierBonus: 0,
      newBalance: newBalance?.pokedollars ?? 0,
      sold: entries.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
export { getSellPrice };
