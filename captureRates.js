// Calcul AUTORITAIRE du taux de capture, côté serveur.
// Miroir de poketraining-v2/src/utils/captureRates.js (+ le bonus capture des
// badges de badgesConfig.js). Le client n'est plus juge du résultat : il envoie
// seulement la balle lancée, le serveur calcule le taux ET tire le succès.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));

// id + stage + BST (somme des stats de base) par nom FR.
// gen 1-2 dans le repo backend, gen 3-4 dans html/data.
const NAME_MAP = {};
function loadPokemon(path) {
  try {
    const arr = JSON.parse(readFileSync(path, "utf8"));
    for (const p of arr) {
      const name = p.name || p.nom;
      if (!name || NAME_MAP[name]) continue;
      const bst = (p.hp || 0) + (p.atk || 0) + (p.def || 0) + (p.sp_atk || 0) + (p.sp_def || 0) + (p.speed || 0);
      NAME_MAP[name] = { id: p.id || 0, stage: p.stage || 1, bst };
    }
  } catch { /* fichier indisponible : catégorie retombera sur stade1 */ }
}
loadPokemon(join(__dir, "gen1_2.json"));
loadPokemon(join(__dir, "../html/data/gen3_4.json"));

// Bornes réelles de BST sur tout le dataset chargé, pour normaliser le multiplicateur.
// MissingNo (id 0, catégorie "random") exclu : son BST factice fausserait le minimum.
const ALL_BST = Object.entries(NAME_MAP)
  .filter(([name, p]) => name !== "MissingNo" && p.id !== 0 && p.bst > 0)
  .map(([, p]) => p.bst);
const BST_MIN = ALL_BST.length ? Math.min(...ALL_BST) : 180;
const BST_MAX = ALL_BST.length ? Math.max(...ALL_BST) : 720;

// Multiplicateur de difficulté basé sur le BST : plus un Pokémon est statistiquement
// costaud, plus il est dur à capturer. Va de 1.4 (BST le plus faible du dataset) à
// 0.6 (BST le plus élevé), interpolé linéairement.
const BST_MULT_MAX = 1.4;
const BST_MULT_MIN = 0.6;
export function getBstMultiplier(pokemonName) {
  const bst = NAME_MAP[pokemonName]?.bst;
  if (!bst || BST_MAX === BST_MIN) return 1.0;
  const t = Math.min(1, Math.max(0, (bst - BST_MIN) / (BST_MAX - BST_MIN)));
  return +(BST_MULT_MAX - t * (BST_MULT_MAX - BST_MULT_MIN)).toFixed(3);
}

// Listes identiques à captureRates.js côté front.
const FOSSILS     = new Set([138,139,140,141,142, 345,346,347,348, 408,409,410,411]);
const LEGENDARIES = new Set([144,145,146,150,243,244,245,249,250,
  377,378,379,380,381,382,383,384, 480,481,482,483,484,485,486,487,488]);
const MYTHICS     = new Set([151,251, 385,386, 489,490,491,492,493]);
const SANS_EVO    = new Set([83,108,114,115,122,127,128,131,132,143,
  190,193,198,200,201,203,206,207,211,213,214,215,222,225,226,227,234,235,
  302,303,311,312,313,314,324,327,335,336,337,338,351,352,357,359,369,370,
  417,441,442,455,479]);

const MULTIPLIERS = { stade1:1.00, stade2:0.70, sansevo:0.70, stade3:0.45, fossile:0.45, legendaire:0.25, mythic:0.10 };
const BASE        = { pokeball:20, superball:45, hyperball:70, masterball:100 };

export function getPokemonCategory(pokemonName) {
  const p  = NAME_MAP[pokemonName];
  const id = p?.id || 0;
  if (id === 0 || pokemonName === "MissingNo") return "random";
  if (MYTHICS.has(id))     return "mythic";
  if (LEGENDARIES.has(id)) return "legendaire";
  if (FOSSILS.has(id))     return "fossile";
  if (SANS_EVO.has(id))    return "sansevo";
  const stage = p?.stage || 1;
  if (stage >= 3) return "stade3";
  if (stage === 2) return "stade2";
  return "stade1";
}

// Taux de base pour UNE balle. Master Ball toujours 100. MissingNo (random) :
// taux tiré au hasard, comme côté front (mais seed serveur : le client ne dicte rien).
// bstMult affine le taux à l'intérieur de la catégorie selon la puissance statistique
// du Pokémon (1.4 = BST le plus faible du jeu, 0.6 = BST le plus élevé).
function getBaseRate(category, ballType, bstMult = 1.0) {
  if (ballType === "masterball") return 100;
  if (category === "random") {
    const seed = Math.random();
    if (ballType === "pokeball")  return Math.max(1, Math.round(seed * 20));
    if (ballType === "superball") return Math.max(3, Math.round(5  + seed * 35));
    if (ballType === "hyperball") return Math.max(8, Math.round(10 + seed * 55));
    return 0;
  }
  const mult = MULTIPLIERS[category] ?? 1.0;
  return Math.round((BASE[ballType] ?? 0) * mult * bstMult);
}

// Décomposition complète du calcul (base calculée UNE seule fois — nécessaire
// pour MissingNo dont la base est aléatoire). Reproduit getFinalRates + dupRarePenalty.
// Renvoie chaque terme, utile pour le mode debug admin.
export function computeCaptureBreakdown(category, ballType, bonuses = {}, pokemonName = null) {
  const { scoreBonus = 0, dresseurBonus = 0, appAtBonus = 0, badgeCaptureBonus = 0, dupRarePenalty = false } = bonuses;
  const bstMult = pokemonName ? getBstMultiplier(pokemonName) : 1.0;
  const base = getBaseRate(category, ballType, bstMult);
  if (ballType === "masterball") {
    return { category, ballType, base: 100, bstMult: 1, scoreBonus: 0, dresseurBonus: 0, appAtBonus: 0,
      badgeCaptureBonus: 0, total: 0, beforePenalty: 100, dupRarePenalty: false, rate: 100 };
  }
  const dBonus = Math.round(dresseurBonus);
  const bBonus = Math.round(badgeCaptureBonus);
  const total  = scoreBonus + dBonus + appAtBonus + bBonus;
  const beforePenalty = Math.min(100, base + total);
  const rate = dupRarePenalty ? Math.round(beforePenalty / 2) : beforePenalty;
  return { category, ballType, base, bstMult, scoreBonus, dresseurBonus: dBonus, appAtBonus,
    badgeCaptureBonus: bBonus, total, beforePenalty, dupRarePenalty, rate };
}

// Taux final (0-100). Master Ball reste 100.
export function computeFinalRate(category, ballType, bonuses = {}, pokemonName = null) {
  return computeCaptureBreakdown(category, ballType, bonuses, pokemonName).rate;
}

// Bonus capture des badges (miroir de badgesConfig.js, NON plafonné comme côté front).
// Une arène compte si elle est vaincue (user_arenes.defeated) OU si son badge est possédé.
const ARENA_CAPTURE = [
  { id:"pierre",   badge:"Badge Roche",    value:0.20 },
  { id:"ondine",   badge:"Badge Cascade",  value:0.20 },
  { id:"bob",      badge:"Badge Foudre",   value:0.20 },
  { id:"erika",    badge:"Badge Prisme",   value:0.20 },
  { id:"koga",     badge:"Badge Âme",      value:0.20 },
  { id:"albert",   badge:"Badge Zéphyr",   value:0.20 },
  { id:"hector",   badge:"Badge Essaim",   value:0.20 },
  { id:"blanche",  badge:"Badge Plaine",   value:0.20 },
  { id:"mortimer", badge:"Badge Brume",    value:0.20 },
  { id:"chuck",    badge:"Badge Choc",     value:0.20 },
  // 6 arènes Élite Sinnoh — bonus capture additionnel
  { id:"melina",   badge:"Badge Cobalt",   value:0.50 },
  { id:"lovis",    badge:"Badge Palustre", value:0.50 },
  { id:"kimera",   badge:"Badge Fantôme",  value:0.50 },
  { id:"charles",  badge:"Badge Mine",     value:0.50 },
  { id:"gladys",   badge:"Badge Glace",    value:0.50 },
  { id:"tanguy",   badge:"Badge Phare",    value:0.50 },
];

export function computeBadgeCaptureBonus(defeatedAreneIds = [], ownedBadges = []) {
  const areneSet = new Set(defeatedAreneIds);
  const badgeSet = new Set(ownedBadges);
  let sum = 0;
  for (const a of ARENA_CAPTURE) {
    if (areneSet.has(a.id) || badgeSet.has(a.badge)) sum += a.value;
  }
  return +sum.toFixed(2);
}
