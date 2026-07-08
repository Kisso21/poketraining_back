// ─────────────────────────────────────────────────────────────────────────────
// PokéÉlevage — constantes partagées (classification des Pokémon + baies).
// Utilisé par scripts/genPokemonProfiles.js (génération de pokemon_profiles)
// et par routes/elevage.js (achat, nourrissage, éclosion).
//
// NB : les ensembles Légendaire/Mythic/Fossile/Sans-évo reflètent ceux de
// routes/inventory.js (getPokemonCategory) qui font autorité sur le site.
// ─────────────────────────────────────────────────────────────────────────────

// ── Ensembles d'autorité (miroir de routes/inventory.js) ─────────────────────
export const MYTHICS = new Set([
  "Mewtwo", "Mew", "Celebi",           // Gen 1-2
  "Jirachi", "Deoxys",                  // Gen 3
  "Phione", "Manaphy", "Darkrai", "Shaymin", "Arceus", // Gen 4
]);

export const LEGENDARIES = new Set([
  "Artikodin", "Électhor", "Sulfura",   // Gen 1
  "Raikou", "Entei", "Suicune", "Lugia", "Ho-Oh", // Gen 2
  "Regirock", "Regice", "Registeel", "Latias", "Latios", "Kyogre", "Groudon", "Rayquaza", // Gen 3
  "Dialga", "Palkia", "Heatran", "Regigigas", "Giratina", "Cresselia", "Créhelf", "Créfollet", "Créfadet", // Gen 4
]);

export const FOSSILS = new Set([
  "Amonita", "Amonistar", "Kabuto", "Kabutops", "Ptéra", // Gen 1-2
  "Lilia", "Vacilys", "Anorith", "Armaldo",              // Gen 3
  "Kranidos", "Charkos", "Dinoclier", "Bastiodon",       // Gen 4
]);

export const SANS_EVO = new Set([
  // Gen 1
  "Canarticho", "Onix", "Kicklee", "Tygnon", "Excelangue", "Saquedeneu", "Kangourex",
  "M. Mime", "Insécateur", "Lippoutou", "Élektek", "Magmar", "Scarabrute", "Tauros",
  "Lokhlass", "Métamorph", "Porygon", "Ronflex",
  // Gen 2
  "Capumain", "Yanma", "Cornèbre", "Feuforêve", "Zarbi", "Girafarig", "Insolourdo", "Scorplane",
  "Qwilfish", "Caratroc", "Scarhino", "Farfuret", "Corayon", "Cadoizo", "Démanta", "Airmure",
  "Cerfrousse", "Queulorior",
  // Gen 3
  "Relicanth", "Lovdisc", "Kecleon", "Ténéfix", "Mysdibule", "Tropius", "Éoko", "Absol",
  // Gen 4
  "Pachirisu", "Spiritomb", "Manzaï", "Motisma",
]);

// ── Paliers de rareté (rarity) ───────────────────────────────────────────────
export const RARITIES = ["stade1", "stade2", "stade3", "legendary", "mythic"];

// Taux de tirage à l'achat (somme = 100).
export const RARITY_ROLL = [
  { rarity: "stade1",    chance: 50   },
  { rarity: "stade2",    chance: 30   },
  { rarity: "stade3",    chance: 16   },
  { rarity: "legendary", chance: 3.5  },
  { rarity: "mythic",    chance: 0.5  },
];

// Durée d'incubation par palier (en secondes). Plancher absolu : 12h.
export const HATCH_FLOOR_S = 12 * 3600;

// Jauge de faim : un œuf peut manger jusqu'à HUNGER_CAP baies de type/stat d'un coup,
// puis la jauge se régénère en continu à raison de HUNGER_REGEN_PER_HOUR baies/heure
// (hors spéciales, déjà limitées via ONCE_PER_EGG). Empêche le gavage instantané
// sans plafonner la précision atteignable sur la durée de l'incubation.
export const HUNGER_CAP = 5;
export const HUNGER_REGEN_PER_HOUR = 5;
export const HUNGER_REGEN_INTERVAL_S = 3600 / HUNGER_REGEN_PER_HOUR; // secondes pour regagner 1 baie
export const RARITY_DURATION_S = {
  stade1:    24 * 3600,
  stade2:    48 * 3600,
  stade3:    72 * 3600,
  legendary:  5 * 24 * 3600,
  mythic:     7 * 24 * 3600,
};

// ── Classification ───────────────────────────────────────────────────────────
export function genFromId(id) {
  if (id <= 151) return 1;
  if (id <= 251) return 2;
  if (id <= 386) return 3;
  return 4;
}

// tier d'un Pokémon à partir de son nom + son stade d'évolution (1/2/3).
//   Mythic / Légendaire      → palier dédié
//   Fossile                  → stade3 (spec : « formes finales + fossiles »)
//   Sans évolution           → stade2 (spec : « intermédiaires + sans évolution »)
//   Sinon selon la profondeur d'évolution (stage) : 3→stade3, 2→stade2, 1→stade1
export function classifyTier(name, stage) {
  if (MYTHICS.has(name))     return "mythic";
  if (LEGENDARIES.has(name)) return "legendary";
  if (FOSSILS.has(name))     return "stade3";
  if (SANS_EVO.has(name))    return "stade2";
  if (stage === 3)           return "stade3";
  if (stage === 2)           return "stade2";
  return "stade1";
}

// Normalise 6 stats brutes en pourcentages (part de chaque stat dans le total).
export function normalizeStats({ hp, atk, def, spa, spd, vit }) {
  const total = (hp + atk + def + spa + spd + vit) || 1;
  const pct = v => Math.round((v / total) * 10000) / 100; // 2 décimales
  return {
    norm_hp: pct(hp), norm_atk: pct(atk), norm_def: pct(def),
    norm_spa: pct(spa), norm_spd: pct(spd), norm_vit: pct(vit),
  };
}

// ── Baies ────────────────────────────────────────────────────────────────────
// berry_id = basename du sprite dans /sprites/items/ (sans « -berry.png »).

// 18 baies de type → +1 au compteur du type correspondant.
export const TYPE_BERRIES = {
  chilan: "Normal",  occa: "Feu",      passho: "Eau",     rindo: "Plante",
  wacan: "Électrik", yache: "Glace",   chople: "Combat",  kebia: "Poison",
  shuca: "Sol",      coba: "Vol",      payapa: "Psy",     tanga: "Insecte",
  charti: "Roche",   kasib: "Spectre", haban: "Dragon",   colbur: "Ténèbres",
  babiri: "Acier",   pecha: "Fée",
};

// 6 baies de stat → +1 à la stat (clé interne : hp/atk/def/spa/spd/vit).
export const STAT_BERRIES = {
  pomeg: "hp", kelpsy: "atk", qualot: "def",
  hondew: "spa", grepa: "spd", tamato: "vit",
};

// Baies spéciales à effet immédiat (une utilisation par œuf, sauf Starf qui est répétable).
// Salac réinitialise le profil nourri (stats + type) de l'œuf.
export const SPECIAL_BERRIES = new Set(["micle", "lansat", "enigma", "starf", "salac"]);

// Baies dont l'usage est limité à 1 par œuf (Starf est répétable → cumul du shiny).
export const ONCE_PER_EGG = new Set([...SPECIAL_BERRIES].filter(b => b !== "starf"));

// Ensemble complet des berry_id valides (pour la validation serveur).
export const ALL_BERRIES = new Set([
  ...Object.keys(TYPE_BERRIES),
  ...Object.keys(STAT_BERRIES),
  ...SPECIAL_BERRIES,
]);
