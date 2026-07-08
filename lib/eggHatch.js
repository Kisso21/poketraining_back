// ─────────────────────────────────────────────────────────────────────────────
// PokéÉlevage — algorithme d'éclosion + capture (partagé route joueur / admin).
// Aucune logique de prix/économie ici : uniquement sélection du Pokémon et capture.
// ─────────────────────────────────────────────────────────────────────────────
import { run, get, all } from "../db.js";
import { checkAchievements } from "../routes/achievements.js";
import { getIO } from "../socket.js";
import {
  TYPE_BERRIES, STAT_BERRIES,
} from "./eggProfiles.js";

// ── Paramètres d'algorithme (voir livrable équilibrage) ──────────────────────
export const ELEVAGE_BASE_SHINY   = 0.01;  // 1% de base, indépendant de tout autre bonus
export const MAX_MANHATTAN        = 200;    // distance max entre deux profils normalisés (%)
export const PRECISION_GUARANTEED = 90;     // ≥ → candidat n°1 garanti
export const PRECISION_TOP3       = 60;     // ≥ → tirage pondéré top 3 ; < → aléatoire type

const randOf = arr => arr[Math.floor(Math.random() * arr.length)];

// ── Agrégation du profil nourri ──────────────────────────────────────────────
export function aggregateFeed(feedRows) {
  const typeCount = {};
  const statVec = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, vit: 0 };
  for (const { berry_id, qty } of feedRows) {
    if (TYPE_BERRIES[berry_id]) typeCount[TYPE_BERRIES[berry_id]] = (typeCount[TYPE_BERRIES[berry_id]] || 0) + qty;
    else if (STAT_BERRIES[berry_id]) statVec[STAT_BERRIES[berry_id]] += qty;
  }
  return { typeCount, statVec };
}

export function normalizeVec(v) {
  const tot = v.hp + v.atk + v.def + v.spa + v.spd + v.vit;
  if (!tot) return null;
  return {
    hp: 100 * v.hp / tot, atk: 100 * v.atk / tot, def: 100 * v.def / tot,
    spa: 100 * v.spa / tot, spd: 100 * v.spd / tot, vit: 100 * v.vit / tot,
  };
}

function manhattan(a, p) {
  return Math.abs(a.hp - p.norm_hp) + Math.abs(a.atk - p.norm_atk) + Math.abs(a.def - p.norm_def)
       + Math.abs(a.spa - p.norm_spa) + Math.abs(a.spd - p.norm_spd) + Math.abs(a.vit - p.norm_vit);
}

const hasType = (p, t) => p.type1 === t || p.type2 === t;

function pickTypes(typeCount) {
  const entries = Object.entries(typeCount).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return { primary: null, secondary: null };
  const primary = entries[0][0], top = entries[0][1];
  const secondary = (entries[1] && entries[1][1] >= 0.30 * top) ? entries[1][0] : null;
  return { primary, secondary };
}

function filterByType(pool, primary, secondary) {
  if (!primary) return pool;
  if (secondary) {
    const both = pool.filter(p => hasType(p, primary) && hasType(p, secondary));
    if (both.length) return both;
  }
  const prim = pool.filter(p => hasType(p, primary));
  return prim.length ? prim : pool;
}

export function rankPool(pool, feed) {
  const { typeCount, statVec } = feed;
  const { primary, secondary } = pickTypes(typeCount);
  const filtered = filterByType(pool, primary, secondary);
  const normFed = normalizeVec(statVec);
  if (!normFed) return { ranked: filtered.map(p => ({ p, dist: null })), filtered, precision: null };
  const ranked = filtered
    .map(p => ({ p, dist: manhattan(normFed, p) }))
    .sort((a, b) => a.dist - b.dist);
  const precision = ranked.length ? 100 * (1 - ranked[0].dist / MAX_MANHATTAN) : 0;
  return { ranked, filtered, precision };
}

function weightedPick(cands) {
  const weights = cands.map(c => 1 / (c.dist + 1));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < cands.length; i++) { r -= weights[i]; if (r <= 0) return cands[i].p; }
  return cands[cands.length - 1].p;
}

const isContrib = berryId => !!(TYPE_BERRIES[berryId] || STAT_BERRIES[berryId]);

// Sélectionne le Pokémon qui éclot selon le profil nourri.
export function selectHatch(pool, egg, feedRows) {
  if (!pool.length) return null;
  if (egg.enigma) return randOf(pool);
  const feed = aggregateFeed(feedRows.filter(f => isContrib(f.berry_id)));
  const anyType = Object.keys(feed.typeCount).length > 0;
  const anyStat = !!normalizeVec(feed.statVec);
  if (!anyType && !anyStat) return randOf(pool);
  const { ranked, filtered, precision } = rankPool(pool, feed);
  if (precision === null) return randOf(filtered);
  if (precision >= PRECISION_GUARANTEED) return ranked[0].p;
  if (precision >= PRECISION_TOP3) return weightedPick(ranked.slice(0, 3));
  return randOf(filtered);
}

// Top-N candidats (Micle / Écouter / affichage admin) → liste de noms.
export function topCandidates(pool, egg, feedRows, n) {
  if (!pool.length) return [];
  if (egg.enigma) return pool.slice().sort(() => Math.random() - 0.5).slice(0, n).map(p => p.pokemon);
  const feed = aggregateFeed(feedRows.filter(f => isContrib(f.berry_id)));
  const { ranked, filtered, precision } = rankPool(pool, feed);
  if (precision === null) return filtered.slice().sort(() => Math.random() - 0.5).slice(0, n).map(p => p.pokemon);
  return ranked.slice(0, n).map(r => r.p.pokemon);
}

// ── Accès données ────────────────────────────────────────────────────────────
export async function gen34Unlocked(userId) {
  const row = await get(
    `SELECT claimed FROM achievements WHERE user_id = ? AND achievement_id = 'unlock-gen3-4'`,
    [userId]
  );
  return Number(row?.claimed) === 1;
}

export async function loadPool(rarity, gen34) {
  return all(`SELECT * FROM pokemon_profiles WHERE tier = ? AND gen <= ?`, [rarity, gen34 ? 4 : 2]);
}

// ── Capture (indépendante : ni Charme Éclair, ni passifs) ────────────────────
export async function hatchCapture(userId, pokemonName, isShiny) {
  const result = await run(
    `INSERT OR IGNORE INTO captures (user_id, pokemon_name, is_shiny) VALUES (?,?,?)`,
    [userId, pokemonName, isShiny]
  );
  if (result.changes === 0) {
    await run(
      `INSERT INTO pokemon_reserve (user_id, pokemon_name, is_shiny) VALUES (?,?,?)`,
      [userId, pokemonName, isShiny]
    );
    getIO()?.emit("sync:pokedex", { userId, pokemonName, isShiny, addedToReserve: true, newAchievements: [] });
    return { addedToReserve: true, newAchievements: [] };
  }
  const newAchievements = await checkAchievements(userId).catch(() => []);
  getIO()?.emit("sync:pokedex", { userId, pokemonName, isShiny, addedToReserve: false, newAchievements });
  return { addedToReserve: false, newAchievements };
}

// Éclosion complète d'un œuf → capture + libération du slot. Réutilisée joueur & admin.
export async function performHatch(egg) {
  const g34 = await gen34Unlocked(egg.user_id);
  const pool = await loadPool(egg.rarity, g34);
  const feedRows = await all(`SELECT berry_id, qty FROM egg_feedings WHERE egg_id = ?`, [egg.id]);

  const chosen = selectHatch(pool, egg, feedRows);
  if (!chosen) return null;

  const shinyProb = ELEVAGE_BASE_SHINY + (egg.shiny_bonus || 0) / 100;
  const isShiny = Math.random() < shinyProb ? 1 : 0;

  const cap = await hatchCapture(egg.user_id, chosen.pokemon, isShiny);

  await run(`DELETE FROM eggs WHERE id = ?`, [egg.id]);
  await run(`DELETE FROM egg_feedings WHERE egg_id = ?`, [egg.id]);
  await run(`DELETE FROM daily_actions WHERE egg_id = ?`, [egg.id]);

  return {
    pokemon: chosen.pokemon, dexId: chosen.dex_id, isShiny: !!isShiny,
    rarity: egg.rarity, addedToReserve: cap.addedToReserve, newAchievements: cap.newAchievements,
  };
}
