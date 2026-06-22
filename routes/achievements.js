import { Router } from "express";
import { run, get, all, GEN1_POKEMONS, GEN3_POKEMONS, GEN4_POKEMONS } from "../db.js";
import { XP_THRESHOLDS, MAX_LEVEL_BASE, maxLevelFor } from "./levels.js";

function computeLevel(xp, cap = MAX_LEVEL_BASE) {
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return Math.min(level, cap);
}

const router = Router();

// ── Récompenses en Pokédollars ──────────────────────────────────────────────
const REWARDS = {
  // PokéTraining
  "unlock-level-2":        250,
  "unlock-level-3":        350,
  "unlock-level-4":        450,
  "unlock-level-5":        550,
  "unlock-level-6":        600,
  "unlock-level-7":        700,
  "unlock-pokeclick":      100,
  "unlock-casino":         500,
  "unlock-safari":         500,
  "unlock-dessin":        1000,
  "unlock-memory":        1000,
  "unlock-radar":         2000,
  "unlock-stop":          2500,
  "unlock-poketrade":      300,
  "unlock-arene":          400,
  "unlock-versus":         500,
  // Safari biomes
  "safari-foret":          300,
  "safari-ocean":          300,
  "safari-volcan":         400,
  "safari-montagne":       400,
  "safari-marais":         400,
  "safari-tempete":        500,
  "safari-ciel":           500,
  // Pokédex — familles existantes
  "pokedex-starters":      300,
  "pokedex-fossiles":      400,
  "pokedex-eevee":         500,
  "pokedex-pseudo-leg":    600,
  "pokedex-legendaires":   800,
  "pokedex-mewtwo":       1000,
  "pokedex-mew":          1200,
  "pokedex-missingno":     800,
  "pokedex-shiny-hunter":  500,
  "pokedex-shiny-master": 1500,
  // Pokédex — nouvelles familles
  "pokedex-bulba-line":    400,
  "pokedex-char-line":     400,
  "pokedex-squirtle-line": 400,
  "pokedex-pikachu-line":  300,
  "pokedex-nido-lines":    500,
  "pokedex-ghost-line":    500,
  "pokedex-machamp-line":  400,
  "pokedex-abra-line":     500,
  "pokedex-magikarp-line": 600,
  "pokedex-butter-line":   300,
  // Shiny
  "shiny-dracaufeu":      1500,
  "shiny-tortank":        1500,
  "shiny-florizarre":     1500,
  "shiny-pikachu":        1000,
  "shiny-oiseau-leg":     2000,
  "shiny-ectoplasma":     1200,
  "shiny-mewtwo":         3000,
  "shiny-mew":            3000,
  "shiny-col-10":         2500,
  "shiny-col-20":         5000,
  // Progression avancée
  "level-10":             1000,
  "level-15":             2500,
  "level-20":             5000,
  "level-25":             7500,
  "level-30":            10000,
  "level-40":            15000,
  "level-50":            20000,
  "level-60":            25000,
  "level-70":            30000,
  "level-75":            35000,
  "level-80":            40000,
  "level-90":            45000,
  "level-100":           50000,
  "level-150":           75000,
  "level-200":          100000,
  // Pokédex — compteurs
  "pokedex-normal-25":     500,
  "pokedex-normal-75":    1200,
  "pokedex-normal-125":   2500,
  "pokedex-normal-151":  10000,
  "pokedex-total-200":   10000,
  // Pokédex — familles avancées
  "pokedex-bird-lines":    400,
  "pokedex-rat-line":      300,
  "pokedex-ekans-line":    400,
  "pokedex-sand-line":     400,
  "pokedex-clefairy-line": 500,
  "pokedex-vulpix-line":   500,
  "pokedex-zubat-line":    400,
  "pokedex-oddish-line":   600,
  "pokedex-poli-line":     600,
  "pokedex-geodude-line":  600,
  "pokedex-slowpoke-line": 500,
  "pokedex-magnemite-line":500,
  "pokedex-shellder-line": 500,
  "pokedex-rhyhorn-line":  600,
  "pokedex-horsea-line":   500,
  // Shiny avancé
  "shiny-col-30":          7500,
  "shiny-col-50":         15000,
  "shiny-col-75":         25000,
  // ── Gen 2 ────────────────────────────────────────────────────────
  "pokedex-gen2-starters":    400,  "pokedex-germignon-line":   400,
  "pokedex-hericendre-line":  400,  "pokedex-kaiminus-line":    400,
  "pokedex-pichu-line":       300,  "pokedex-togepi-line":      400,
  "pokedex-eevee-gen2":       500,  "pokedex-marill-line":      300,
  "pokedex-crobat-line":      400,  "pokedex-steelix-line":     500,
  "pokedex-scizor-line":      500,  "pokedex-kingdra-line":     600,
  "pokedex-porygon-line":     500,  "pokedex-tyranocif-line":   700,
  "pokedex-malosse-line":     400,  "pokedex-baby-gen2":        500,
  "pokedex-chiens-leg":      1000,  "pokedex-lugia":           1200,
  "pokedex-ho-oh":           1200,  "pokedex-celebi":          2000,
  "pokedex-gen2-legendaires":1500,  "pokedex-normal-200":      5000,
  "pokedex-normal-251":     20000,  "pokedex-roigada-line":     500,
  "pokedex-wattouat-line":    400,  "pokedex-gen2-bug-team":    400,
  "pokedex-gen2-sans-evo-5":  500,  "pokedex-johto-25":         600,
  "pokedex-gen2-tenebres":    500,  "pokedex-gen2-glace":       500,
  "pokedex-normal-175":      7500,  "pokedex-total-300":       15000,
  "pokedex-total-500":      30000,  "pokedex-ditto":            300,
  "pokedex-fighting-gen1":    500,  "pokedex-eevee-complete":   800,
  "shiny-meganium":          1500,  "shiny-typhlosion":        1500,
  "shiny-aligatueur":        1500,  "shiny-lugia":             3000,
  "shiny-ho-oh":             3000,  "shiny-celebi":            4000,
  "shiny-chien-leg":         2500,  "shiny-tyranocif":         2000,
  "shiny-evoli-gen2":        2000,  "shiny-missingno":         5000,
  // Passifs
  "passif-luckycoin":     1000,
  "passif-appat":         1000,
  "passif-charmechroma":  2500,
  "passif-glitch":       15000,
  // Passifs Gen 3 & 4
  "passif-multiexp":          5000,
  "passif-corneabondance":    8000,
  "passif-superappat":       12000,
  "passif-supercharmechroma":20000,
  // ── 40 nouveaux succès Gen 2 ─────────────────────────────────────────
  "pokedex-fouinette-line":        350,  "pokedex-hoothoot-line":         350,
  "pokedex-loupio-line":           400,  "pokedex-natu-line":             400,
  "pokedex-granivol-line":         450,  "pokedex-tournegrin-line":       400,
  "pokedex-axoloto-line":          400,  "pokedex-pomdepik-line":         500,
  "pokedex-snubbull-line":         350,  "pokedex-teddiursa-line":        400,
  "pokedex-limagma-line":          450,  "pokedex-remoraid-line":         450,
  "pokedex-phanpy-line":           400,  "pokedex-elekid-family":         300,
  "pokedex-magby-family":          300,  "pokedex-gen2-acier":            600,
  "pokedex-gen2-combat-collect":   400,  "pokedex-gen2-fee-collect":      450,
  "pokedex-gen2-psy-collect":      500,  "pokedex-gen2-sol-collect":      450,
  "pokedex-gen2-feu-collect":      500,  "pokedex-gen2-electrik-collect": 500,
  "pokedex-solitaires-johto":      700,  "pokedex-gen2-eau-collect":      600,
  "pokedex-gen2-mystere":          500,  "pokedex-johto-50":             1000,
  "pokedex-johto-75":             2000,  "pokedex-johto-full":           5000,
  "shiny-scarhino":               1800,  "shiny-cizayox":                1800,
  "shiny-leuphorie":              2000,  "shiny-togetic":                1200,
  "shiny-zarbi":                  3000,  "shiny-hyporoi":                2500,
  "shiny-donphan":                1500,  "shiny-corsola":                1200,
  "shiny-snubbull-granbull":      1000,  "shiny-col-100":               40000,
  "shiny-gen2-starters-all":      5000,  "shiny-gen2-legendary-all":    10000,
  "shiny-dex-251":               75000,
  // ── Déverrouillage Gen 3 & 4 ─────────────────────────────────────────────
  "unlock-gen3-4": 5000,
  // ── Boss final (tous les badges) ─────────────────────────────────────────
  "final-boss": 25000,
  // ── Succès Gen 3 ──
  "g3-arcko-line": 400,
  "g3-poussifeu-line": 400,
  "g3-gobou-line": 400,
  "g3-medhyena-line": 300,
  "g3-zigzaton-line": 300,
  "g3-chenipotte-line": 400,
  "g3-blindalys-line": 300,
  "g3-nenupiot-line": 400,
  "g3-grainipiot-line": 400,
  "g3-nirondelle-line": 300,
  "g3-goelise-line": 300,
  "g3-tarsal-line": 400,
  "g3-arakdo-line": 300,
  "g3-balignon-line": 300,
  "g3-parecool-line": 400,
  "g3-ningale-line": 400,
  "g3-chuchmur-line": 400,
  "g3-makuhita-line": 300,
  "g3-skitty-line": 300,
  "g3-galekid-line": 400,
  "g3-meditikka-line": 300,
  "g3-dynavolt-line": 300,
  "g3-muciole-line": 300,
  "g3-gloupti-line": 300,
  "g3-carvanha-line": 300,
  "g3-wailmer-line": 300,
  "g3-chamallot-line": 300,
  "g3-spoink-line": 300,
  "g3-kraknoix-line": 500,
  "g3-cacnea-line": 300,
  "g3-tylton-line": 300,
  "g3-barloche-line": 300,
  "g3-ecrapince-line": 300,
  "g3-balbuto-line": 300,
  "g3-barpau-line": 400,
  "g3-polichombr-line": 300,
  "g3-skelenox-line": 300,
  "g3-obalie-line": 400,
  "g3-stalgamin-line": 300,
  "g3-coquiperl-line": 400,
  "g3-lilia-line": 400,
  "g3-anorith-line": 400,
  "g3-draby-line": 600,
  "g3-terhal-line": 600,
  "g3-absol": 300,
  "g3-relicanth": 300,
  "g3-zangoose-seviper": 400,
  "g3-lune-soleil": 400,
  "g3-plus-minus": 400,
  "g3-tenefix-mysdibule": 400,
  "g3-regirock": 800,
  "g3-regice": 800,
  "g3-registeel": 800,
  "g3-regis": 1500,
  "g3-latias": 800,
  "g3-latios": 800,
  "g3-eon": 1500,
  "g3-kyogre": 800,
  "g3-groudon": 800,
  "g3-rayquaza": 800,
  "g3-weather-trio": 1500,
  "g3-jirachi": 1200,
  "g3-deoxys": 1200,
  "g3-all-legends": 2500,
  "g3-count-25": 500,
  "g3-count-50": 1000,
  "g3-count-75": 1500,
  "g3-count-100": 2500,
  "g3-count-full": 10000,
  "g3-shiny-starters": 5000,
  "g3-shiny-gardevoir": 2000,
  "g3-shiny-metalosse": 2000,
  "g3-shiny-drattak": 2000,
  "g3-shiny-rayquaza": 3000,
  "g3-shiny-regis": 10000,
  "g3-shiny-jungko": 2000,
  "g3-shiny-bragegali": 2000,
  "g3-shiny-laggron": 2000,
  "g3-shiny-ludicolo": 2000,
  "g3-shiny-tengalice": 2000,
  "g3-shiny-monaflemit": 2000,
  "g3-shiny-brouhabam": 2000,
  "g3-shiny-libegon": 2000,
  "g3-shiny-altaria": 2000,
  "g3-shiny-milobellus": 2000,
  "g3-shiny-absol": 2000,
  "g3-shiny-kaimorse": 2000,
  "g3-shiny-sharpedo": 2000,
  "g3-shiny-camerupt": 2000,
  "g3-shiny-branette": 2000,
  "g3-shiny-teraclope": 2000,
  "g3-shiny-regirock": 2500,
  "g3-shiny-regice": 2500,
  "g3-shiny-registeel": 2500,
  "g3-shiny-latias": 2500,
  "g3-shiny-latios": 2500,
  "g3-shiny-eon": 4000,
  "g3-shiny-kyogre": 2500,
  "g3-shiny-groudon": 2500,
  "g3-shiny-jirachi": 3000,
  // ── Succès Gen 4 ──
  "g4-tortipouss-line": 400,
  "g4-ouisticram-line": 400,
  "g4-tiplouf-line": 400,
  "g4-etourmi-line": 400,
  "g4-keunotor-line": 300,
  "g4-crikzik-line": 300,
  "g4-lixy-line": 400,
  "g4-rozbouton-line": 300,
  "g4-kranidos-line": 400,
  "g4-dinoclier-line": 400,
  "g4-cheniti-line": 400,
  "g4-apitrini-line": 300,
  "g4-mustebouee-line": 300,
  "g4-ceribou-line": 300,
  "g4-sancoki-line": 300,
  "g4-baudrive-line": 300,
  "g4-laporeille-line": 300,
  "g4-chaglam-line": 300,
  "g4-moufouette-line": 300,
  "g4-archeomire-line": 300,
  "g4-griknot-line": 600,
  "g4-riolu-line": 400,
  "g4-hippopotas-line": 300,
  "g4-rapion-line": 300,
  "g4-cradopaud-line": 300,
  "g4-ecayon-line": 300,
  "g4-blizzi-line": 300,
  "g4-eeveelutions": 500,
  "g4-pachirisu": 300,
  "g4-spiritomb": 400,
  "g4-vortente": 300,
  "g4-motisma": 400,
  "g4-pijako": 300,
  "g4-corboss": 300,
  "g4-magirave": 300,
  "g4-togekiss": 300,
  "g4-magnezone": 300,
  "g4-electivire": 300,
  "g4-magmortar": 300,
  "g4-mammochon": 300,
  "g4-porygonz": 300,
  "g4-yanmega": 300,
  "g4-gliscor": 300,
  "g4-froslass": 300,
  "g4-evos-anciens": 800,
  "g4-evos-johto": 800,
  "g4-gallame-momartik": 400,
  "g4-babies": 500,
  "g4-capidextre": 300,
  "g4-crehelf": 800,
  "g4-crefollet": 800,
  "g4-crefadet": 800,
  "g4-lake-trio": 1500,
  "g4-dialga": 800,
  "g4-palkia": 800,
  "g4-giratina": 800,
  "g4-creation-trio": 1500,
  "g4-heatran": 800,
  "g4-regigigas": 800,
  "g4-cresselia": 800,
  "g4-phione": 800,
  "g4-manaphy": 1200,
  "g4-darkrai": 1200,
  "g4-shaymin": 1200,
  "g4-arceus": 1500,
  "g4-all-legends": 2500,
  "g4-count-25": 500,
  "g4-count-50": 1000,
  "g4-count-75": 1500,
  "g4-count-full": 10000,
  "g4-shiny-starters": 5000,
  "g4-shiny-lucario": 2000,
  "g4-shiny-carchacrok": 2000,
  "g4-shiny-giratina": 3000,
  "g4-shiny-lake-trio": 10000,
  "g4-shiny-torterra": 2000,
  "g4-shiny-simiabraz": 2000,
  "g4-shiny-pingoleon": 2000,
  "g4-shiny-luxray": 2000,
  "g4-shiny-etouraptor": 2000,
  "g4-shiny-roserade": 2000,
  "g4-shiny-togekiss": 2000,
  "g4-shiny-magnezone": 2000,
  "g4-shiny-electivire": 2000,
  "g4-shiny-magmortar": 2000,
  "g4-shiny-rhinastoc": 2000,
  "g4-shiny-mammochon": 2000,
  "g4-shiny-yanmega": 2000,
  "g4-shiny-leafeon": 2000,
  "g4-shiny-glaceon": 2000,
  "g4-shiny-gallame": 2000,
  "g4-shiny-froslass": 2000,
  "g4-shiny-spiritomb": 2000,
  "g4-shiny-crehelf": 2500,
  "g4-shiny-crefollet": 2500,
  "g4-shiny-crefadet": 2500,
  "g4-shiny-dialga": 2500,
  "g4-shiny-palkia": 2500,
  "g4-shiny-darkrai": 3000,
  "g4-shiny-arceus": 4000,
};

// ── Récompenses en items (pokédollars + max 1 item) ─────────────────────────
const ITEM_REWARDS = {
  // PokéTraining
  "unlock-level-2":        { pokeball: 2 },
  "unlock-level-3":        { superball: 1 },
  "unlock-level-4":        { potion: 1 },
  "unlock-level-5":        { hyperball: 1 },
  "unlock-level-6":        { lootbox: 1 },
  "unlock-level-7":        { hyperball: 1 },
  "unlock-pokeclick":      { superbonbon: 1 },
  "unlock-casino":         { lootbox: 1 },
  "unlock-safari":         { resetball: 1 },
  "unlock-dessin":         { lootbox: 2 },
  "unlock-memory":         { superball: 2 },
  "unlock-radar":          { lootbox: 2 },
  "unlock-stop":           { superball: 2, lootbox: 1 },
  "unlock-poketrade":      { lootbox: 1 },
  "unlock-arene":          { lootbox: 1 },
  "unlock-versus":         { lootbox: 1 },
  // Safari biomes
  "safari-foret":          { pokeball: 2 },
  "safari-ocean":          { superball: 1 },
  "safari-volcan":         { superball: 1 },
  "safari-montagne":       { potion: 1 },
  "safari-marais":         { potion: 1 },
  "safari-tempete":        { hyperball: 1 },
  "safari-ciel":           { superball: 1 },
  // Pokédex — familles existantes
  "pokedex-starters":      { superball: 1 },
  "pokedex-fossiles":      { superbonbon: 1 },
  "pokedex-eevee":         { potion: 1 },
  "pokedex-pseudo-leg":    { hyperball: 1 },
  "pokedex-legendaires":   { lootbox: 1 },
  "pokedex-mewtwo":        { hyperball: 1 },
  "pokedex-mew":           { lootbox: 1 },
  "pokedex-missingno":     { resetball: 1 },
  "pokedex-shiny-hunter":  { lootbox: 1 },
  "pokedex-shiny-master":  { hyperball: 2 },
  // Pokédex — nouvelles familles
  "pokedex-bulba-line":    { superball: 1 },
  "pokedex-char-line":     { superball: 1 },
  "pokedex-squirtle-line": { superball: 1 },
  "pokedex-pikachu-line":  { potion: 1 },
  "pokedex-nido-lines":    { superbonbon: 1 },
  "pokedex-ghost-line":    { lootbox: 1 },
  "pokedex-machamp-line":  { superbonbon: 1 },
  "pokedex-abra-line":     { superbonbon: 1 },
  "pokedex-magikarp-line": { hyperball: 1 },
  "pokedex-butter-line":   { potion: 1 },
  // Progression avancée
  "level-10":              { lootbox: 1 },
  "level-15":              { hyperball: 1 },
  "level-20":              { lootbox: 2 },
  "level-25":              { lootbox: 2 },
  "level-30":              { hyperball: 2 },
  "level-40":              { lootbox: 3 },
  "level-50":              { masterball: 1 },
  "level-60":              { lootbox: 3 },
  "level-70":              { lootbox: 3 },
  "level-75":              { resetball: 1 },
  "level-80":              { lootbox: 3 },
  "level-90":              { lootbox: 3 },
  "level-100":             { masterball: 1 },
  "level-150":             { masterball: 1, lootbox: 3 },
  "level-200":             { masterball: 2, lootbox: 5 },
  // Pokédex — compteurs
  "pokedex-normal-25":     { pokeball: 2 },
  "pokedex-normal-75":     { superball: 1 },
  "pokedex-normal-125":    { hyperball: 1 },
  "pokedex-normal-151":    { masterball: 1 },
  "pokedex-total-200":     { resetball: 1 },
  // Pokédex — familles avancées
  "pokedex-bird-lines":    { superball: 1 },
  "pokedex-rat-line":      { potion: 1 },
  "pokedex-ekans-line":    { potion: 1 },
  "pokedex-sand-line":     { superball: 1 },
  "pokedex-clefairy-line": { superbonbon: 1 },
  "pokedex-vulpix-line":   { superball: 1 },
  "pokedex-zubat-line":    { potion: 1 },
  "pokedex-oddish-line":   { superball: 1 },
  "pokedex-poli-line":     { superball: 1 },
  "pokedex-geodude-line":  { superbonbon: 1 },
  "pokedex-slowpoke-line": { potion: 1 },
  "pokedex-magnemite-line":{ superball: 1 },
  "pokedex-shellder-line": { superball: 1 },
  "pokedex-rhyhorn-line":  { hyperball: 1 },
  "pokedex-horsea-line":   { superball: 1 },
  // Shiny
  "shiny-dracaufeu":       { hyperball: 1 },
  "shiny-tortank":         { hyperball: 1 },
  "shiny-florizarre":      { hyperball: 1 },
  "shiny-pikachu":         { lootbox: 1 },
  "shiny-oiseau-leg":      { lootbox: 1 },
  "shiny-ectoplasma":      { lootbox: 1 },
  "shiny-mewtwo":          { hyperball: 2 },
  "shiny-mew":             { lootbox: 1 },
  "shiny-col-10":          { lootbox: 1 },
  "shiny-col-20":          { hyperball: 2 },
  "shiny-col-30":          { hyperball: 2 },
  "shiny-col-50":          { lootbox: 3 },
  "shiny-col-75":          { masterball: 1 },
  // ── Gen 2 ────────────────────────────────────────────────────────
  "pokedex-gen2-starters":    { lootbox: 1 },   "pokedex-germignon-line":   { lootbox: 1 },
  "pokedex-hericendre-line":  { lootbox: 1 },   "pokedex-kaiminus-line":    { lootbox: 1 },
  "pokedex-pichu-line":       { potion: 1 },    "pokedex-togepi-line":      { superbonbon: 1 },
  "pokedex-eevee-gen2":       { lootbox: 1 },   "pokedex-marill-line":      { potion: 1 },
  "pokedex-crobat-line":      { lootbox: 1 },   "pokedex-steelix-line":     { lootbox: 1 },
  "pokedex-scizor-line":      { lootbox: 1 },   "pokedex-kingdra-line":     { lootbox: 1 },
  "pokedex-porygon-line":     { lootbox: 1 },   "pokedex-tyranocif-line":   { lootbox: 1 },
  "pokedex-malosse-line":     { superball: 1 },  "pokedex-baby-gen2":        { lootbox: 1 },
  "pokedex-chiens-leg":       { lootbox: 2 },   "pokedex-lugia":            { lootbox: 1 },
  "pokedex-ho-oh":            { lootbox: 1 },   "pokedex-celebi":           { lootbox: 2 },
  "pokedex-gen2-legendaires": { lootbox: 2 },   "pokedex-normal-200":       { lootbox: 2 },
  "pokedex-normal-251":       { masterball: 1 }, "pokedex-roigada-line":     { superball: 1 },
  "pokedex-wattouat-line":    { superball: 1 },  "pokedex-gen2-bug-team":    { potion: 1 },
  "pokedex-gen2-sans-evo-5":  { lootbox: 1 },   "pokedex-johto-25":         { lootbox: 1 },
  "pokedex-gen2-tenebres":    { lootbox: 1 },   "pokedex-gen2-glace":       { superball: 1 },
  "pokedex-normal-175":       { lootbox: 2 },   "pokedex-total-300":        { lootbox: 2 },
  "pokedex-total-500":        { masterball: 1 }, "pokedex-ditto":            { potion: 1 },
  "pokedex-fighting-gen1":    { lootbox: 1 },   "pokedex-eevee-complete":   { lootbox: 2 },
  "shiny-meganium":           { lootbox: 1 },   "shiny-typhlosion":         { lootbox: 1 },
  "shiny-aligatueur":         { lootbox: 1 },   "shiny-lugia":              { lootbox: 2 },
  "shiny-ho-oh":              { lootbox: 2 },   "shiny-celebi":             { lootbox: 2 },
  "shiny-chien-leg":          { lootbox: 2 },   "shiny-tyranocif":          { lootbox: 2 },
  "shiny-evoli-gen2":         { lootbox: 1 },   "shiny-missingno":          { masterball: 1 },
  // ── 40 nouveaux succès Gen 2 ─────────────────────────────────────────
  "pokedex-fouinette-line":        { potion: 1 },    "pokedex-hoothoot-line":         { potion: 1 },
  "pokedex-loupio-line":           { superball: 1 }, "pokedex-natu-line":             { superball: 1 },
  "pokedex-granivol-line":         { superball: 1 }, "pokedex-tournegrin-line":       { superball: 1 },
  "pokedex-axoloto-line":          { superball: 1 }, "pokedex-pomdepik-line":         { superball: 1 },
  "pokedex-snubbull-line":         { potion: 1 },    "pokedex-teddiursa-line":        { superball: 1 },
  "pokedex-limagma-line":          { superball: 1 }, "pokedex-remoraid-line":         { superball: 1 },
  "pokedex-phanpy-line":           { superball: 1 }, "pokedex-elekid-family":         { potion: 1 },
  "pokedex-magby-family":          { potion: 1 },    "pokedex-gen2-acier":            { hyperball: 1 },
  "pokedex-gen2-combat-collect":   { superball: 1 }, "pokedex-gen2-fee-collect":      { superbonbon: 1 },
  "pokedex-gen2-psy-collect":      { lootbox: 1 },   "pokedex-gen2-sol-collect":      { superbonbon: 1 },
  "pokedex-gen2-feu-collect":      { lootbox: 1 },   "pokedex-gen2-electrik-collect": { lootbox: 1 },
  "pokedex-solitaires-johto":      { lootbox: 1 },   "pokedex-gen2-eau-collect":      { lootbox: 1 },
  "pokedex-gen2-mystere":          { lootbox: 1 },   "pokedex-johto-50":              { resetball: 1 },
  "pokedex-johto-75":              { lootbox: 1 },   "pokedex-johto-full":            { masterball: 1 },
  "shiny-scarhino":                { hyperball: 1 },  "shiny-cizayox":                 { hyperball: 1 },
  "shiny-leuphorie":               { lootbox: 1 },   "shiny-togetic":                 { hyperball: 1 },
  "shiny-zarbi":                   { lootbox: 2 },   "shiny-hyporoi":                 { lootbox: 1 },
  "shiny-donphan":                 { hyperball: 1 },  "shiny-corsola":                 { hyperball: 1 },
  "shiny-snubbull-granbull":       { superball: 1 },  "shiny-col-100":                 { masterball: 1 },
  "shiny-gen2-starters-all":       { lootbox: 2 },   "shiny-gen2-legendary-all":      { masterball: 1 },
  "shiny-dex-251":                 { masterball: 3, lootbox: 5 },
  // ── Déverrouillage Gen 3 & 4 ─────────────────────────────────────────────
  "unlock-gen3-4": { masterball: 1, lootbox: 3 },
  // ── Boss final (tous les badges) ─────────────────────────────────────────
  "final-boss": { lootbox: 10 },
  // ── Objets Gen 3 ──
  "g3-arcko-line": { superball: 1, superbonbon: 1 },
  "g3-poussifeu-line": { superball: 1, superbonbon: 1 },
  "g3-gobou-line": { superball: 1, superbonbon: 1 },
  "g3-medhyena-line": { superball: 1 },
  "g3-zigzaton-line": { superball: 1 },
  "g3-chenipotte-line": { superball: 1, superbonbon: 1 },
  "g3-blindalys-line": { superball: 1 },
  "g3-nenupiot-line": { superball: 1, superbonbon: 1 },
  "g3-grainipiot-line": { superball: 1, superbonbon: 1 },
  "g3-nirondelle-line": { superball: 1 },
  "g3-goelise-line": { superball: 1 },
  "g3-tarsal-line": { superball: 1, superbonbon: 1 },
  "g3-arakdo-line": { superball: 1 },
  "g3-balignon-line": { superball: 1 },
  "g3-parecool-line": { superball: 1, superbonbon: 1 },
  "g3-ningale-line": { superball: 1, superbonbon: 1 },
  "g3-chuchmur-line": { superball: 1, superbonbon: 1 },
  "g3-makuhita-line": { superball: 1 },
  "g3-skitty-line": { superball: 1 },
  "g3-galekid-line": { superball: 1, superbonbon: 1 },
  "g3-meditikka-line": { superball: 1 },
  "g3-dynavolt-line": { superball: 1 },
  "g3-muciole-line": { superball: 1 },
  "g3-gloupti-line": { superball: 1 },
  "g3-carvanha-line": { superball: 1 },
  "g3-wailmer-line": { superball: 1 },
  "g3-chamallot-line": { superball: 1 },
  "g3-spoink-line": { superball: 1 },
  "g3-kraknoix-line": { hyperball: 1, superball: 1 },
  "g3-cacnea-line": { superball: 1 },
  "g3-tylton-line": { superball: 1 },
  "g3-barloche-line": { superball: 1 },
  "g3-ecrapince-line": { superball: 1 },
  "g3-balbuto-line": { superball: 1 },
  "g3-barpau-line": { superball: 1, superbonbon: 1 },
  "g3-polichombr-line": { superball: 1 },
  "g3-skelenox-line": { superball: 1 },
  "g3-obalie-line": { superball: 1, superbonbon: 1 },
  "g3-stalgamin-line": { superball: 1 },
  "g3-coquiperl-line": { superball: 1, superbonbon: 1 },
  "g3-lilia-line": { superball: 1, superbonbon: 1 },
  "g3-anorith-line": { superball: 1, superbonbon: 1 },
  "g3-draby-line": { hyperball: 2, superbonbon: 1 },
  "g3-terhal-line": { hyperball: 2, superbonbon: 1 },
  "g3-absol": { superball: 1 },
  "g3-relicanth": { superball: 1 },
  "g3-zangoose-seviper": { superball: 1, superbonbon: 1 },
  "g3-lune-soleil": { superball: 1, superbonbon: 1 },
  "g3-plus-minus": { superball: 1, superbonbon: 1 },
  "g3-tenefix-mysdibule": { superball: 1, superbonbon: 1 },
  "g3-regirock": { lootbox: 1, hyperball: 1 },
  "g3-regice": { lootbox: 1, hyperball: 1 },
  "g3-registeel": { lootbox: 1, hyperball: 1 },
  "g3-regis": { lootbox: 2, resetball: 1 },
  "g3-latias": { lootbox: 1, hyperball: 1 },
  "g3-latios": { lootbox: 1, hyperball: 1 },
  "g3-eon": { lootbox: 2, resetball: 1 },
  "g3-kyogre": { lootbox: 1, hyperball: 1 },
  "g3-groudon": { lootbox: 1, hyperball: 1 },
  "g3-rayquaza": { lootbox: 1, hyperball: 1 },
  "g3-weather-trio": { lootbox: 2, resetball: 1 },
  "g3-jirachi": { lootbox: 1, superbonbon: 1 },
  "g3-deoxys": { lootbox: 1, superbonbon: 1 },
  "g3-all-legends": { masterball: 1, lootbox: 2 },
  "g3-count-25": { superball: 2, superbonbon: 1 },
  "g3-count-50": { hyperball: 2, superbonbon: 1 },
  "g3-count-75": { lootbox: 1, hyperball: 2 },
  "g3-count-100": { lootbox: 1, resetball: 1, hyperball: 2 },
  "g3-count-full": { masterball: 1, lootbox: 3 },
  "g3-shiny-starters": { lootbox: 2, superbonbon: 1 },
  "g3-shiny-gardevoir": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-metalosse": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-drattak": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-rayquaza": { lootbox: 2, superbonbon: 1 },
  "g3-shiny-regis": { masterball: 1, lootbox: 3 },
  "g3-shiny-jungko": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-bragegali": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-laggron": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-ludicolo": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-tengalice": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-monaflemit": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-brouhabam": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-libegon": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-altaria": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-milobellus": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-absol": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-kaimorse": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-sharpedo": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-camerupt": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-branette": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-teraclope": { lootbox: 1, superbonbon: 1 },
  "g3-shiny-regirock": { lootbox: 2, hyperball: 2 },
  "g3-shiny-regice": { lootbox: 2, hyperball: 2 },
  "g3-shiny-registeel": { lootbox: 2, hyperball: 2 },
  "g3-shiny-latias": { lootbox: 2, hyperball: 2 },
  "g3-shiny-latios": { lootbox: 2, hyperball: 2 },
  "g3-shiny-eon": { lootbox: 2, superbonbon: 1 },
  "g3-shiny-kyogre": { lootbox: 2, hyperball: 2 },
  "g3-shiny-groudon": { lootbox: 2, hyperball: 2 },
  "g3-shiny-jirachi": { lootbox: 2, superbonbon: 1 },
  // ── Objets Gen 4 ──
  "g4-tortipouss-line": { superball: 1, superbonbon: 1 },
  "g4-ouisticram-line": { superball: 1, superbonbon: 1 },
  "g4-tiplouf-line": { superball: 1, superbonbon: 1 },
  "g4-etourmi-line": { superball: 1, superbonbon: 1 },
  "g4-keunotor-line": { superball: 1 },
  "g4-crikzik-line": { superball: 1 },
  "g4-lixy-line": { superball: 1, superbonbon: 1 },
  "g4-rozbouton-line": { superball: 1 },
  "g4-kranidos-line": { superball: 1, superbonbon: 1 },
  "g4-dinoclier-line": { superball: 1, superbonbon: 1 },
  "g4-cheniti-line": { superball: 1, superbonbon: 1 },
  "g4-apitrini-line": { superball: 1 },
  "g4-mustebouee-line": { superball: 1 },
  "g4-ceribou-line": { superball: 1 },
  "g4-sancoki-line": { superball: 1 },
  "g4-baudrive-line": { superball: 1 },
  "g4-laporeille-line": { superball: 1 },
  "g4-chaglam-line": { superball: 1 },
  "g4-moufouette-line": { superball: 1 },
  "g4-archeomire-line": { superball: 1 },
  "g4-griknot-line": { hyperball: 2, superbonbon: 1 },
  "g4-riolu-line": { superball: 1, superbonbon: 1 },
  "g4-hippopotas-line": { superball: 1 },
  "g4-rapion-line": { superball: 1 },
  "g4-cradopaud-line": { superball: 1 },
  "g4-ecayon-line": { superball: 1 },
  "g4-blizzi-line": { superball: 1 },
  "g4-eeveelutions": { hyperball: 1, superball: 1 },
  "g4-pachirisu": { superball: 1 },
  "g4-spiritomb": { superball: 1, superbonbon: 1 },
  "g4-vortente": { superball: 1 },
  "g4-motisma": { superball: 1, superbonbon: 1 },
  "g4-pijako": { superball: 1 },
  "g4-corboss": { superball: 1 },
  "g4-magirave": { superball: 1 },
  "g4-togekiss": { superball: 1 },
  "g4-magnezone": { superball: 1 },
  "g4-electivire": { superball: 1 },
  "g4-magmortar": { superball: 1 },
  "g4-mammochon": { superball: 1 },
  "g4-porygonz": { superball: 1 },
  "g4-yanmega": { superball: 1 },
  "g4-gliscor": { superball: 1 },
  "g4-froslass": { superball: 1 },
  "g4-evos-anciens": { lootbox: 1, hyperball: 1 },
  "g4-evos-johto": { lootbox: 1, hyperball: 1 },
  "g4-gallame-momartik": { superball: 1, superbonbon: 1 },
  "g4-babies": { hyperball: 1, superball: 1 },
  "g4-capidextre": { superball: 1 },
  "g4-crehelf": { lootbox: 1, hyperball: 1 },
  "g4-crefollet": { lootbox: 1, hyperball: 1 },
  "g4-crefadet": { lootbox: 1, hyperball: 1 },
  "g4-lake-trio": { lootbox: 2, resetball: 1 },
  "g4-dialga": { lootbox: 1, hyperball: 1 },
  "g4-palkia": { lootbox: 1, hyperball: 1 },
  "g4-giratina": { lootbox: 1, hyperball: 1 },
  "g4-creation-trio": { lootbox: 2, resetball: 1 },
  "g4-heatran": { lootbox: 1, hyperball: 1 },
  "g4-regigigas": { lootbox: 1, hyperball: 1 },
  "g4-cresselia": { lootbox: 1, hyperball: 1 },
  "g4-phione": { lootbox: 1, hyperball: 1 },
  "g4-manaphy": { lootbox: 1, superbonbon: 1 },
  "g4-darkrai": { lootbox: 1, superbonbon: 1 },
  "g4-shaymin": { lootbox: 1, superbonbon: 1 },
  "g4-arceus": { masterball: 1, lootbox: 2 },
  "g4-all-legends": { masterball: 1, lootbox: 2 },
  "g4-count-25": { superball: 2, superbonbon: 1 },
  "g4-count-50": { hyperball: 2, superbonbon: 1 },
  "g4-count-75": { lootbox: 1, hyperball: 2 },
  "g4-count-full": { masterball: 1, lootbox: 3 },
  "g4-shiny-starters": { lootbox: 2, superbonbon: 1 },
  "g4-shiny-lucario": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-carchacrok": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-giratina": { lootbox: 2, superbonbon: 1 },
  "g4-shiny-lake-trio": { masterball: 1, lootbox: 3 },
  "g4-shiny-torterra": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-simiabraz": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-pingoleon": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-luxray": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-etouraptor": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-roserade": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-togekiss": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-magnezone": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-electivire": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-magmortar": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-rhinastoc": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-mammochon": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-yanmega": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-leafeon": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-glaceon": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-gallame": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-froslass": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-spiritomb": { lootbox: 1, superbonbon: 1 },
  "g4-shiny-crehelf": { lootbox: 2, hyperball: 2 },
  "g4-shiny-crefollet": { lootbox: 2, hyperball: 2 },
  "g4-shiny-crefadet": { lootbox: 2, hyperball: 2 },
  "g4-shiny-dialga": { lootbox: 2, hyperball: 2 },
  "g4-shiny-palkia": { lootbox: 2, hyperball: 2 },
  "g4-shiny-darkrai": { lootbox: 2, superbonbon: 1 },
  "g4-shiny-arceus": { masterball: 1, lootbox: 2 },
};

// ── Récompenses en passifs (débloquent le passif à la réclamation) ──────────
const PASSIVE_REWARDS = {
  "passif-luckycoin":    "luckycoin",
  "passif-appat":        "appat",
  "passif-charmechroma": "charmechroma",
  "passif-glitch":       "glitch",
  "passif-multiexp":          "multiexp",
  "passif-corneabondance":    "corneabondance",
  "passif-superappat":        "superappat",
  "passif-supercharmechroma": "supercharmechroma",
};

// ── Succès basés sur le niveau ──────────────────────────────────────────────
const LEVEL_REQS = {
  "unlock-level-2": 2,
  "unlock-level-3": 3,
  "unlock-level-4": 4,
  "unlock-level-5": 5,
  "unlock-level-6": 6,
  "unlock-level-7": 7,
  "unlock-dessin":  15,
  "unlock-memory":  10,
  "unlock-radar":   12,
  "unlock-stop":    14,
  "level-10":       10,
  "level-15":       15,
  "level-20":       20,
  "level-25":       25,
  "level-30":       30,
  "level-40":       40,
  "level-50":       50,
  "level-60":       60,
  "level-70":       70,
  "level-75":       75,
  "level-80":       80,
  "level-90":       90,
  "level-100":      100,
  "level-150":      150,
  "level-200":      200,
};

// ── Succès basés sur le Pokédex ─────────────────────────────────────────────
// all       : tous ces Pokémon (normal ou shiny)
// groups    : au moins un de chaque groupe (normal ou shiny)
// shinyAll  : tous ces Pokémon en version shiny
// shinyGroups: au moins un de chaque groupe en shiny
// shinyCount : nombre total de shinys capturés
// normalCount: nombre total de Pokémon normaux capturés
// normalAll  : tous ces Pokémon en version normale
// totalCount : nombre total de captures
// biomeCount : nombre de captures dans un groupe de types Safari
const SAFARI_BIOME_REQS = {
  "foret": {
    "count": 10,
    "names": [
      "Bulbizarre",
      "Herbizarre",
      "Florizarre",
      "Chenipan",
      "Chrysacier",
      "Papilusion",
      "Aspicot",
      "Coconfort",
      "Dardargnan",
      "Mystherbe",
      "Ortide",
      "Rafflesia",
      "Paras",
      "Parasect",
      "Mimitoss",
      "Aéromite",
      "Chétiflor",
      "Boustiflor",
      "Empiflor",
      "Noeunoeuf",
      "Noadkoko",
      "Saquedeneu",
      "Insécateur",
      "Scarabrute"
    ]
  },
  "ocean": {
    "count": 10,
    "names": [
      "Carapuce",
      "Carabaffe",
      "Tortank",
      "Psykokwak",
      "Akwakwak",
      "Ptitard",
      "Têtarte",
      "Tartard",
      "Tentacool",
      "Tentacruel",
      "Ramoloss",
      "Flagadoss",
      "Otaria",
      "Lamantine",
      "Kokiyas",
      "Crustabri",
      "Krabby",
      "Krabboss",
      "Hypotrempe",
      "Hypocéan",
      "Poissirène",
      "Poissoroy",
      "Stari",
      "Staross",
      "Lippoutou",
      "Magicarpe",
      "Léviator",
      "Lokhlass",
      "Aquali",
      "Amonita",
      "Amonistar",
      "Kabuto",
      "Kabutops",
      "Artikodin"
    ]
  },
  "volcan": {
    "count": 10,
    "names": [
      "Salamèche",
      "Reptincel",
      "Dracaufeu",
      "Goupix",
      "Feunard",
      "Caninos",
      "Arcanin",
      "Ponyta",
      "Galopa",
      "Magmar",
      "Pyroli",
      "Sulfura"
    ]
  },
  "montagne": {
    "count": 10,
    "names": [
      "Sabelette",
      "Sablaireau",
      "Nidoqueen",
      "Nidoking",
      "Taupiqueur",
      "Triopikeur",
      "Férosinge",
      "Colossinge",
      "Tartard",
      "Machoc",
      "Machopeur",
      "Mackogneur",
      "Racaillou",
      "Gravalanch",
      "Grolem",
      "Onix",
      "Osselait",
      "Ossatueur",
      "Kicklee",
      "Tygnon",
      "Rhinocorne",
      "Rhinoféros",
      "Amonita",
      "Amonistar",
      "Kabuto",
      "Kabutops",
      "Ptéra"
    ]
  },
  "marais": {
    "count": 10,
    "names": [
      "Bulbizarre",
      "Herbizarre",
      "Florizarre",
      "Aspicot",
      "Coconfort",
      "Dardargnan",
      "Abo",
      "Arbok",
      "Nidoran♀",
      "Nidorina",
      "Nidoqueen",
      "Nidoran♂",
      "Nidorino",
      "Nidoking",
      "Nosferapti",
      "Nosferalto",
      "Mystherbe",
      "Ortide",
      "Rafflesia",
      "Mimitoss",
      "Aéromite",
      "Chétiflor",
      "Boustiflor",
      "Empiflor",
      "Tentacool",
      "Tentacruel",
      "Tadmorv",
      "Grotadmorv",
      "Fantominus",
      "Spectrum",
      "Ectoplasma",
      "Smogo",
      "Smogogo"
    ]
  },
  "tempete": {
    "count": 10,
    "names": [
      "Pikachu",
      "Raichu",
      "Abra",
      "Kadabra",
      "Alakazam",
      "Ramoloss",
      "Flagadoss",
      "Magnéti",
      "Magnéton",
      "Fantominus",
      "Spectrum",
      "Ectoplasma",
      "Soporifik",
      "Hypnomade",
      "Voltorbe",
      "Électrode",
      "Noeunoeuf",
      "Noadkoko",
      "Staross",
      "M. Mime",
      "Lippoutou",
      "Élektek",
      "Voltali",
      "Électhor",
      "Mewtwo",
      "Mew"
    ]
  },
  "ciel": {
    "count": 10,
    "names": [
      "Dracaufeu",
      "Papilusion",
      "Roucool",
      "Roucoups",
      "Roucarnage",
      "Piafabec",
      "Rapasdepic",
      "Nosferapti",
      "Nosferalto",
      "Canarticho",
      "Doduo",
      "Dodrio",
      "Insécateur",
      "Léviator",
      "Ptéra",
      "Artikodin",
      "Électhor",
      "Sulfura",
      "Minidraco",
      "Draco",
      "Dracolosse"
    ]
  }
};

const GEN2_NAMES = [
  "Germignon","Macronium","Méganium","Héricendre","Feurisson","Typhlosion",
  "Kaiminus","Crocrodil","Aligatueur","Fouinette","Fouinar","Hoothoot","Noarfang",
  "Coxy","Coxyclaque","Mimigal","Migalos","Nostenfer","Loupio","Lanturn",
  "Pichu","Mélo","Toudoudou","Togepi","Togetic","Natu","Xatu",
  "Wattouat","Lainergie","Pharamp","Joliflor","Marill","Azumarill","Simularbre",
  "Tarpaud","Granivol","Floravol","Cotovol","Capumain","Tournegrin","Héliatronc",
  "Yanma","Axoloto","Maraiste","Mentali","Noctali","Cornèbre","Roigada","Feuforêve",
  "Zarbi","Qulbutoké","Girafarig","Pomdepik","Foretress","Insolourdo","Scorplane",
  "Steelix","Snubbull","Granbull","Qwilfish","Cizayox","Caratroc","Scarhino",
  "Farfuret","Teddiursa","Ursaring","Limagma","Volcaropod","Marcacrin","Cochignon",
  "Corayon","Rémoraid","Octillery","Cadoizo","Démanta","Airmure","Malosse",
  "Démolosse","Hyporoi","Phanpy","Donphan","Porygon2","Cerfrousse","Queulorior",
  "Debugant","Kapoera","Lippouti","Élekid","Magby","Écrémeuh","Leuphorie",
  "Raikou","Entei","Suicune","Embrylex","Ymphect","Tyranocif","Lugia","Ho-Oh","Celebi",
];

const POKEDEX_REQS = {
  "safari-foret":          { biomeCount: SAFARI_BIOME_REQS.foret },
  "safari-ocean":          { biomeCount: SAFARI_BIOME_REQS.ocean },
  "safari-volcan":         { biomeCount: SAFARI_BIOME_REQS.volcan },
  "safari-montagne":       { biomeCount: SAFARI_BIOME_REQS.montagne },
  "safari-marais":         { biomeCount: SAFARI_BIOME_REQS.marais },
  "safari-tempete":        { biomeCount: SAFARI_BIOME_REQS.tempete },
  "safari-ciel":           { biomeCount: SAFARI_BIOME_REQS.ciel },
  // Familles existantes
  "pokedex-starters":      { all: ["Bulbizarre", "Salamèche", "Carapuce"] },
  "pokedex-fossiles":      { groups: [["Amonita","Amonistar"], ["Kabuto","Kabutops"], ["Ptéra"]] },
  "pokedex-eevee":         { all: ["Évoli", "Aquali", "Voltali", "Pyroli"] },
  "pokedex-pseudo-leg":    { all: ["Minidraco", "Draco", "Dracolosse"] },
  "pokedex-legendaires":   { all: ["Artikodin", "Électhor", "Sulfura"] },
  "pokedex-mewtwo":        { all: ["Mewtwo"] },
  "pokedex-mew":           { all: ["Mew"] },
  "pokedex-missingno":     { all: ["MissingNo"] },
  "pokedex-shiny-hunter":  { shinyCount: 1 },
  "pokedex-shiny-master":  { shinyCount: 5 },
  // Nouvelles familles
  "pokedex-bulba-line":    { all: ["Bulbizarre", "Herbizarre", "Florizarre"] },
  "pokedex-char-line":     { all: ["Salamèche", "Reptincel", "Dracaufeu"] },
  "pokedex-squirtle-line": { all: ["Carapuce", "Carabaffe", "Tortank"] },
  "pokedex-pikachu-line":  { all: ["Pikachu", "Raichu"] },
  "pokedex-nido-lines":    { all: ["Nidoran♀", "Nidorina", "Nidoqueen", "Nidoran♂", "Nidorino", "Nidoking"] },
  "pokedex-ghost-line":    { all: ["Fantominus", "Spectrum", "Ectoplasma"] },
  "pokedex-machamp-line":  { all: ["Machoc", "Machopeur", "Mackogneur"] },
  "pokedex-abra-line":     { all: ["Abra", "Kadabra", "Alakazam"] },
  "pokedex-magikarp-line": { all: ["Magicarpe", "Léviator"] },
  "pokedex-butter-line":   { all: ["Chenipan", "Chrysacier", "Papilusion"] },
  // Compteurs avancés
  "pokedex-normal-25":     { normalCount: 25 },
  "pokedex-normal-75":     { normalCount: 75 },
  "pokedex-normal-125":    { normalCount: 125 },
  "pokedex-normal-151":    { normalAll: GEN1_POKEMONS },
  "pokedex-total-200":     { totalCount: 200 },
  // Familles avancées
  "pokedex-bird-lines":    { all: ["Roucool", "Roucoups", "Roucarnage", "Piafabec", "Rapasdepic"] },
  "pokedex-rat-line":      { all: ["Rattata", "Rattatac"] },
  "pokedex-ekans-line":    { all: ["Abo", "Arbok"] },
  "pokedex-sand-line":     { all: ["Sabelette", "Sablaireau"] },
  "pokedex-clefairy-line": { all: ["Mélofée", "Mélodelfe"] },
  "pokedex-vulpix-line":   { all: ["Goupix", "Feunard"] },
  "pokedex-zubat-line":    { all: ["Nosferapti", "Nosferalto"] },
  "pokedex-oddish-line":   { all: ["Mystherbe", "Ortide", "Rafflesia"] },
  "pokedex-poli-line":     { all: ["Ptitard", "Têtarte", "Tartard"] },
  "pokedex-geodude-line":  { all: ["Racaillou", "Gravalanch", "Grolem"] },
  "pokedex-slowpoke-line": { all: ["Ramoloss", "Flagadoss"] },
  "pokedex-magnemite-line":{ all: ["Magnéti", "Magnéton"] },
  "pokedex-shellder-line": { all: ["Kokiyas", "Crustabri"] },
  "pokedex-rhyhorn-line":  { all: ["Rhinocorne", "Rhinoféros"] },
  "pokedex-horsea-line":   { all: ["Hypotrempe", "Hypocéan"] },
  // Shinys spécifiques
  "shiny-dracaufeu":       { shinyAll: ["Dracaufeu"] },
  "shiny-tortank":         { shinyAll: ["Tortank"] },
  "shiny-florizarre":      { shinyAll: ["Florizarre"] },
  "shiny-pikachu":         { shinyAll: ["Pikachu"] },
  "shiny-oiseau-leg":      { shinyGroups: [["Artikodin", "Électhor", "Sulfura"]] },
  "shiny-ectoplasma":      { shinyAll: ["Ectoplasma"] },
  "shiny-mewtwo":          { shinyAll: ["Mewtwo"] },
  "shiny-mew":             { shinyAll: ["Mew"] },
  "shiny-col-10":          { shinyCount: 10 },
  "shiny-col-20":          { shinyCount: 20 },
  "shiny-col-30":          { shinyCount: 30 },
  "shiny-col-50":          { shinyCount: 50 },
  // Passifs (count-based)
  "passif-luckycoin":      { totalCount: 25 },
  "passif-appat":          { shinyCount: 3 },
  "passif-charmechroma":   { normalCount: 100 },
  "passif-glitch":         { totalCount: 120 },
  // Passifs Gen 3 & 4 (captures gen 3/4 — nécessitent gen 3/4 débloquée)
  "passif-multiexp":           { biomeCount: { count: 25,  names: [...GEN3_POKEMONS, ...GEN4_POKEMONS] } },
  "passif-corneabondance":     { biomeCount: { count: 50,  names: [...GEN3_POKEMONS, ...GEN4_POKEMONS] } },
  "passif-superappat":         { biomeCount: { count: 75,  names: [...GEN3_POKEMONS, ...GEN4_POKEMONS] } },
  "passif-supercharmechroma":  { biomeCount: { count: 100, names: [...GEN3_POKEMONS, ...GEN4_POKEMONS] } },
  // ── 20 nouveaux succès ───────────────────────────────────────────
  "pokedex-ditto":         { all: ["Métamorph"] },
  "pokedex-fighting-gen1": { all: ["Machoc", "Kicklee", "Tygnon"] },
  "pokedex-eevee-complete":{ all: ["Évoli", "Aquali", "Voltali", "Pyroli", "Mentali", "Noctali"] },
  "pokedex-normal-175":    { normalCount: 175 },
  "pokedex-total-300":     { totalCount: 300 },
  "pokedex-total-500":     { totalCount: 500 },
  // ── Gen 2 — familles ─────────────────────────────────────────────
  "pokedex-gen2-starters":    { all: ["Germignon", "Héricendre", "Kaiminus"] },
  "pokedex-germignon-line":   { all: ["Germignon", "Macronium", "Méganium"] },
  "pokedex-hericendre-line":  { all: ["Héricendre", "Feurisson", "Typhlosion"] },
  "pokedex-kaiminus-line":    { all: ["Kaiminus", "Crocrodil", "Aligatueur"] },
  "pokedex-pichu-line":       { all: ["Pichu", "Pikachu", "Raichu"] },
  "pokedex-togepi-line":      { all: ["Togepi", "Togetic"] },
  "pokedex-eevee-gen2":       { all: ["Mentali", "Noctali"] },
  "pokedex-marill-line":      { all: ["Marill", "Azumarill"] },
  "pokedex-crobat-line":      { all: ["Nosferapti", "Nosferalto", "Nostenfer"] },
  "pokedex-steelix-line":     { all: ["Onix", "Steelix"] },
  "pokedex-scizor-line":      { groups: [["Insécateur"], ["Cizayox"]] },
  "pokedex-kingdra-line":     { groups: [["Hypotrempe"], ["Hypocéan"], ["Hyporoi"]] },
  "pokedex-porygon-line":     { all: ["Porygon", "Porygon2"] },
  "pokedex-tyranocif-line":   { all: ["Embrylex", "Ymphect", "Tyranocif"] },
  "pokedex-malosse-line":     { all: ["Malosse", "Démolosse"] },
  "pokedex-baby-gen2":        { all: ["Pichu", "Mélo", "Toudoudou", "Togepi", "Debugant"] },
  "pokedex-chiens-leg":       { all: ["Raikou", "Entei", "Suicune"] },
  "pokedex-lugia":            { all: ["Lugia"] },
  "pokedex-ho-oh":            { all: ["Ho-Oh"] },
  "pokedex-gen2-legendaires": { all: ["Raikou", "Entei", "Suicune", "Lugia", "Ho-Oh"] },
  "pokedex-celebi":           { all: ["Celebi"] },
  "pokedex-roigada-line":     { all: ["Roigada", "Tarpaud"] },
  "pokedex-wattouat-line":    { all: ["Wattouat", "Lainergie", "Pharamp"] },
  "pokedex-gen2-bug-team":    { all: ["Coxy", "Coxyclaque", "Mimigal", "Migalos", "Yanma"] },
  "pokedex-gen2-sans-evo-5":  { biomeCount: { count: 5, names: ["Zarbi","Girafarig","Scarhino","Airmure","Queulorior","Cadoizo","Caratroc","Insolourdo","Cornèbre","Farfuret","Capumain","Yanma","Scorplane","Corayon","Qwilfish","Démanta","Cerfrousse","Feuforêve"] } },
  "pokedex-johto-25":         { biomeCount: { count: 25,  names: GEN2_NAMES } },
  "pokedex-gen2-tenebres":    { all: ["Noctali", "Cornèbre", "Farfuret", "Malosse", "Démolosse"] },
  "pokedex-gen2-glace":       { all: ["Marcacrin", "Cochignon", "Cadoizo"] },
  // ── Gen 2 — compteurs ────────────────────────────────────────────
  "pokedex-normal-200":       { normalCount: 200 },
  "pokedex-normal-251":       { normalAll: [...GEN1_POKEMONS, ...GEN2_NAMES] },
  // ── Gen 2 — shiny ────────────────────────────────────────────────
  "shiny-meganium":    { shinyAll: ["Méganium"] },
  "shiny-typhlosion":  { shinyAll: ["Typhlosion"] },
  "shiny-aligatueur":  { shinyAll: ["Aligatueur"] },
  "shiny-chien-leg":   { shinyGroups: [["Raikou", "Entei", "Suicune"]] },
  "shiny-lugia":       { shinyAll: ["Lugia"] },
  "shiny-ho-oh":       { shinyAll: ["Ho-Oh"] },
  "shiny-celebi":      { shinyAll: ["Celebi"] },
  "shiny-tyranocif":   { shinyAll: ["Tyranocif"] },
  "shiny-evoli-gen2":  { shinyGroups: [["Mentali", "Noctali"]] },
  "shiny-missingno":   { shinyAll: ["MissingNo"] },
  "shiny-col-75":      { shinyCount: 75 },
  // ── 40 nouveaux succès Gen 2 ─────────────────────────────────────────
  // Familles Gen 2
  "pokedex-fouinette-line":        { all: ["Fouinette", "Fouinar"] },
  "pokedex-hoothoot-line":         { all: ["Hoothoot", "Noarfang"] },
  "pokedex-loupio-line":           { all: ["Loupio", "Lanturn"] },
  "pokedex-natu-line":             { all: ["Natu", "Xatu"] },
  "pokedex-granivol-line":         { all: ["Granivol", "Floravol", "Cotovol"] },
  "pokedex-tournegrin-line":       { all: ["Tournegrin", "Héliatronc"] },
  "pokedex-axoloto-line":          { all: ["Axoloto", "Maraiste"] },
  "pokedex-pomdepik-line":         { all: ["Pomdepik", "Foretress"] },
  "pokedex-snubbull-line":         { all: ["Snubbull", "Granbull"] },
  "pokedex-teddiursa-line":        { all: ["Teddiursa", "Ursaring"] },
  "pokedex-limagma-line":          { all: ["Limagma", "Volcaropod"] },
  "pokedex-remoraid-line":         { all: ["Rémoraid", "Octillery"] },
  "pokedex-phanpy-line":           { all: ["Phanpy", "Donphan"] },
  "pokedex-elekid-family":         { all: ["Élekid"] },
  "pokedex-magby-family":          { all: ["Magby"] },
  // Thématiques Gen 2
  "pokedex-gen2-acier":            { all: ["Foretress", "Cizayox", "Steelix", "Airmure"] },
  "pokedex-gen2-combat-collect":   { all: ["Scarhino", "Kapoera"] },
  "pokedex-gen2-fee-collect":      { all: ["Joliflor", "Snubbull", "Granbull"] },
  "pokedex-gen2-psy-collect":      { all: ["Natu", "Xatu", "Qulbutoké", "Girafarig"] },
  "pokedex-gen2-sol-collect":      { all: ["Axoloto", "Maraiste", "Phanpy", "Donphan"] },
  "pokedex-gen2-feu-collect":      { all: ["Héricendre", "Feurisson", "Typhlosion", "Limagma", "Volcaropod"] },
  "pokedex-gen2-electrik-collect": { all: ["Pichu", "Pharamp", "Élekid", "Raikou"] },
  "pokedex-solitaires-johto":      { biomeCount: { count: 10, names: ["Girafarig","Capumain","Insolourdo","Caratroc","Scorplane","Airmure","Démanta","Cerfrousse","Queulorior","Écrémeuh","Zarbi","Qulbutoké","Feuforêve","Corayon","Qwilfish","Simularbre","Tarpaud","Yanma","Cornèbre","Farfuret"] } },
  "pokedex-gen2-eau-collect":      { biomeCount: { count: 10, names: ["Loupio","Lanturn","Marill","Azumarill","Axoloto","Maraiste","Tarpaud","Rémoraid","Octillery","Corayon","Qwilfish","Hyporoi","Kaiminus","Crocrodil","Aligatueur"] } },
  "pokedex-gen2-mystere":          { all: ["Zarbi", "Qulbutoké", "Feuforêve"] },
  // Compteurs Gen 2
  "pokedex-johto-50":              { biomeCount: { count: 50,  names: GEN2_NAMES } },
  "pokedex-johto-75":              { biomeCount: { count: 75,  names: GEN2_NAMES } },
  "pokedex-johto-full":            { biomeCount: { count: 100, names: GEN2_NAMES } },
  // Shiny Gen 2 inédits
  "shiny-scarhino":                { shinyAll: ["Scarhino"] },
  "shiny-cizayox":                 { shinyAll: ["Cizayox"] },
  "shiny-leuphorie":               { shinyAll: ["Leuphorie"] },
  "shiny-togetic":                 { shinyAll: ["Togetic"] },
  "shiny-zarbi":                   { shinyAll: ["Zarbi"] },
  "shiny-hyporoi":                 { shinyAll: ["Hyporoi"] },
  "shiny-donphan":                 { shinyAll: ["Donphan"] },
  "shiny-corsola":                 { shinyAll: ["Corayon"] },
  "shiny-snubbull-granbull":       { shinyGroups: [["Snubbull", "Granbull"]] },
  "shiny-col-100":                 { shinyCount: 100 },
  "shiny-gen2-starters-all":       { shinyAll: ["Méganium", "Typhlosion", "Aligatueur"] },
  "shiny-gen2-legendary-all":      { shinyAll: ["Raikou", "Entei", "Suicune", "Lugia", "Ho-Oh"] },
  "shiny-dex-251":                 { shinyAll: [...GEN1_POKEMONS, ...GEN2_NAMES] },
  // ── Déverrouillage Gen 3 & 4 (succès caché) ──────────────────────────────
  "unlock-gen3-4": { normalAll: [...GEN1_POKEMONS, ...GEN2_NAMES] },
  // ── Pokédex Gen 3 ──
  "g3-arcko-line": { all: ["Arcko", "Massko", "Jungko"] },
  "g3-poussifeu-line": { all: ["Poussifeu", "Galifeu", "Braségali"] },
  "g3-gobou-line": { all: ["Gobou", "Flobio", "Laggron"] },
  "g3-medhyena-line": { all: ["Medhyèna", "Grahyèna"] },
  "g3-zigzaton-line": { all: ["Zigzaton", "Linéon"] },
  "g3-chenipotte-line": { all: ["Chenipotte", "Armulys", "Charmillon"] },
  "g3-blindalys-line": { all: ["Blindalys", "Papinox"] },
  "g3-nenupiot-line": { all: ["Nénupiot", "Lombre", "Ludicolo"] },
  "g3-grainipiot-line": { all: ["Grainipiot", "Pifeuil", "Tengalice"] },
  "g3-nirondelle-line": { all: ["Nirondelle", "Hélédelle"] },
  "g3-goelise-line": { all: ["Goélise", "Bekipan"] },
  "g3-tarsal-line": { all: ["Tarsal", "Kirlia", "Gardevoir"] },
  "g3-arakdo-line": { all: ["Arakdo", "Maskadra"] },
  "g3-balignon-line": { all: ["Balignon", "Chapignon"] },
  "g3-parecool-line": { all: ["Parecool", "Vigoroth", "Monaflèmit"] },
  "g3-ningale-line": { all: ["Ningale", "Ninjask", "Munja"] },
  "g3-chuchmur-line": { all: ["Chuchmur", "Ramboum", "Brouhabam"] },
  "g3-makuhita-line": { all: ["Makuhita", "Hariyama"] },
  "g3-skitty-line": { all: ["Skitty", "Delcatty"] },
  "g3-galekid-line": { all: ["Galekid", "Galegon", "Galeking"] },
  "g3-meditikka-line": { all: ["Méditikka", "Charmina"] },
  "g3-dynavolt-line": { all: ["Dynavolt", "Élecsprint"] },
  "g3-muciole-line": { all: ["Muciole", "Lumivole"] },
  "g3-gloupti-line": { all: ["Gloupti", "Avaltout"] },
  "g3-carvanha-line": { all: ["Carvanha", "Sharpedo"] },
  "g3-wailmer-line": { all: ["Wailmer", "Wailord"] },
  "g3-chamallot-line": { all: ["Chamallot", "Camérupt"] },
  "g3-spoink-line": { all: ["Spoink", "Groret"] },
  "g3-kraknoix-line": { all: ["Kraknoix", "Vibraninf", "Libégon"] },
  "g3-cacnea-line": { all: ["Cacnea", "Cacturne"] },
  "g3-tylton-line": { all: ["Tylton", "Altaria"] },
  "g3-barloche-line": { all: ["Barloche", "Barbicha"] },
  "g3-ecrapince-line": { all: ["Écrapince", "Colhomard"] },
  "g3-balbuto-line": { all: ["Balbuto", "Kaorine"] },
  "g3-barpau-line": { all: ["Barpau", "Milobellus"] },
  "g3-polichombr-line": { all: ["Polichombr", "Branette"] },
  "g3-skelenox-line": { all: ["Skelénox", "Téraclope"] },
  "g3-obalie-line": { all: ["Obalie", "Phogleur", "Kaimorse"] },
  "g3-stalgamin-line": { all: ["Stalgamin", "Oniglali"] },
  "g3-coquiperl-line": { all: ["Coquiperl", "Serpang", "Rosabyss"] },
  "g3-lilia-line": { all: ["Lilia", "Vacilys"] },
  "g3-anorith-line": { all: ["Anorith", "Armaldo"] },
  "g3-draby-line": { all: ["Draby", "Drackhaus", "Drattak"] },
  "g3-terhal-line": { all: ["Terhal", "Métang", "Métalosse"] },
  "g3-absol": { all: ["Absol"] },
  "g3-relicanth": { all: ["Relicanth"] },
  "g3-zangoose-seviper": { all: ["Mangriff", "Séviper"] },
  "g3-lune-soleil": { all: ["Séléroc", "Solaroc"] },
  "g3-plus-minus": { all: ["Posipi", "Négapi"] },
  "g3-tenefix-mysdibule": { all: ["Ténéfix", "Mysdibule"] },
  "g3-regirock": { all: ["Regirock"] },
  "g3-regice": { all: ["Regice"] },
  "g3-registeel": { all: ["Registeel"] },
  "g3-regis": { all: ["Regirock", "Regice", "Registeel"] },
  "g3-latias": { all: ["Latias"] },
  "g3-latios": { all: ["Latios"] },
  "g3-eon": { all: ["Latias", "Latios"] },
  "g3-kyogre": { all: ["Kyogre"] },
  "g3-groudon": { all: ["Groudon"] },
  "g3-rayquaza": { all: ["Rayquaza"] },
  "g3-weather-trio": { all: ["Kyogre", "Groudon", "Rayquaza"] },
  "g3-jirachi": { all: ["Jirachi"] },
  "g3-deoxys": { all: ["Deoxys"] },
  "g3-all-legends": { all: ["Regirock", "Regice", "Registeel", "Latias", "Latios", "Kyogre", "Groudon", "Rayquaza", "Jirachi", "Deoxys"] },
  "g3-count-25": { biomeCount: { count: 25, names: GEN3_POKEMONS } },
  "g3-count-50": { biomeCount: { count: 50, names: GEN3_POKEMONS } },
  "g3-count-75": { biomeCount: { count: 75, names: GEN3_POKEMONS } },
  "g3-count-100": { biomeCount: { count: 100, names: GEN3_POKEMONS } },
  "g3-count-full": { biomeCount: { count: 135, names: GEN3_POKEMONS } },
  "g3-shiny-starters": { shinyAll: ["Jungko", "Braségali", "Laggron"] },
  "g3-shiny-gardevoir": { shinyAll: ["Gardevoir"] },
  "g3-shiny-metalosse": { shinyAll: ["Métalosse"] },
  "g3-shiny-drattak": { shinyAll: ["Drattak"] },
  "g3-shiny-rayquaza": { shinyAll: ["Rayquaza"] },
  "g3-shiny-regis": { shinyAll: ["Regirock", "Regice", "Registeel"] },
  "g3-shiny-jungko": { shinyAll: ["Jungko"] },
  "g3-shiny-bragegali": { shinyAll: ["Braségali"] },
  "g3-shiny-laggron": { shinyAll: ["Laggron"] },
  "g3-shiny-ludicolo": { shinyAll: ["Ludicolo"] },
  "g3-shiny-tengalice": { shinyAll: ["Tengalice"] },
  "g3-shiny-monaflemit": { shinyAll: ["Monaflèmit"] },
  "g3-shiny-brouhabam": { shinyAll: ["Brouhabam"] },
  "g3-shiny-libegon": { shinyAll: ["Libégon"] },
  "g3-shiny-altaria": { shinyAll: ["Altaria"] },
  "g3-shiny-milobellus": { shinyAll: ["Milobellus"] },
  "g3-shiny-absol": { shinyAll: ["Absol"] },
  "g3-shiny-kaimorse": { shinyAll: ["Kaimorse"] },
  "g3-shiny-sharpedo": { shinyAll: ["Sharpedo"] },
  "g3-shiny-camerupt": { shinyAll: ["Camérupt"] },
  "g3-shiny-branette": { shinyAll: ["Branette"] },
  "g3-shiny-teraclope": { shinyAll: ["Téraclope"] },
  "g3-shiny-regirock": { shinyAll: ["Regirock"] },
  "g3-shiny-regice": { shinyAll: ["Regice"] },
  "g3-shiny-registeel": { shinyAll: ["Registeel"] },
  "g3-shiny-latias": { shinyAll: ["Latias"] },
  "g3-shiny-latios": { shinyAll: ["Latios"] },
  "g3-shiny-eon": { shinyAll: ["Latias", "Latios"] },
  "g3-shiny-kyogre": { shinyAll: ["Kyogre"] },
  "g3-shiny-groudon": { shinyAll: ["Groudon"] },
  "g3-shiny-jirachi": { shinyAll: ["Jirachi"] },
  // ── Pokédex Gen 4 ──
  "g4-tortipouss-line": { all: ["Tortipouss", "Boskara", "Torterra"] },
  "g4-ouisticram-line": { all: ["Ouisticram", "Chimpenfeu", "Simiabraz"] },
  "g4-tiplouf-line": { all: ["Tiplouf", "Prinplouf", "Pingoléon"] },
  "g4-etourmi-line": { all: ["Étourmi", "Étourvol", "Étouraptor"] },
  "g4-keunotor-line": { all: ["Keunotor", "Castorno"] },
  "g4-crikzik-line": { all: ["Crikzik", "Mélokrik"] },
  "g4-lixy-line": { all: ["Lixy", "Luxio", "Luxray"] },
  "g4-rozbouton-line": { all: ["Rozbouton", "Roserade"] },
  "g4-kranidos-line": { all: ["Kranidos", "Charkos"] },
  "g4-dinoclier-line": { all: ["Dinoclier", "Bastiodon"] },
  "g4-cheniti-line": { all: ["Cheniti", "Cheniselle", "Papilord"] },
  "g4-apitrini-line": { all: ["Apitrini", "Apireine"] },
  "g4-mustebouee-line": { all: ["Mustébouée", "Mustéflott"] },
  "g4-ceribou-line": { all: ["Ceribou", "Ceriflor"] },
  "g4-sancoki-line": { all: ["Sancoki", "Tritosor"] },
  "g4-baudrive-line": { all: ["Baudrive", "Grodrive"] },
  "g4-laporeille-line": { all: ["Laporeille", "Lockpin"] },
  "g4-chaglam-line": { all: ["Chaglam", "Chaffreux"] },
  "g4-moufouette-line": { all: ["Moufouette", "Moufflair"] },
  "g4-archeomire-line": { all: ["Archéomire", "Archéodong"] },
  "g4-griknot-line": { all: ["Griknot", "Carmache", "Carchacrok"] },
  "g4-riolu-line": { all: ["Riolu", "Lucario"] },
  "g4-hippopotas-line": { all: ["Hippopotas", "Hippodocus"] },
  "g4-rapion-line": { all: ["Rapion", "Drascore"] },
  "g4-cradopaud-line": { all: ["Cradopaud", "Coatox"] },
  "g4-ecayon-line": { all: ["Écayon", "Luminéon"] },
  "g4-blizzi-line": { all: ["Blizzi", "Blizzaroi"] },
  "g4-eeveelutions": { all: ["Phyllali", "Givrali"] },
  "g4-pachirisu": { all: ["Pachirisu"] },
  "g4-spiritomb": { all: ["Spiritomb"] },
  "g4-vortente": { all: ["Vortente"] },
  "g4-motisma": { all: ["Motisma"] },
  "g4-pijako": { all: ["Pijako"] },
  "g4-corboss": { all: ["Corboss"] },
  "g4-magirave": { all: ["Magirêve"] },
  "g4-togekiss": { all: ["Togekiss"] },
  "g4-magnezone": { all: ["Magnézone"] },
  "g4-electivire": { all: ["Élekable"] },
  "g4-magmortar": { all: ["Maganon"] },
  "g4-mammochon": { all: ["Mammochon"] },
  "g4-porygonz": { all: ["Porygon-Z"] },
  "g4-yanmega": { all: ["Yanmega"] },
  "g4-gliscor": { all: ["Scorvol"] },
  "g4-froslass": { all: ["Momartik"] },
  "g4-evos-anciens": { all: ["Magnézone", "Élekable", "Maganon", "Rhinastoc", "Bouldeneu", "Coudlangue", "Tarinorme"] },
  "g4-evos-johto": { all: ["Togekiss", "Yanmega", "Scorvol", "Mammochon", "Porygon-Z", "Dimoret", "Noctunoir"] },
  "g4-gallame-momartik": { all: ["Gallame", "Momartik"] },
  "g4-babies": { all: ["Manzaï", "Mime Jr.", "Ptiravi", "Goinfrex", "Korillon", "Babimanta"] },
  "g4-capidextre": { all: ["Capidextre"] },
  "g4-crehelf": { all: ["Créhelf"] },
  "g4-crefollet": { all: ["Créfollet"] },
  "g4-crefadet": { all: ["Créfadet"] },
  "g4-lake-trio": { all: ["Créhelf", "Créfollet", "Créfadet"] },
  "g4-dialga": { all: ["Dialga"] },
  "g4-palkia": { all: ["Palkia"] },
  "g4-giratina": { all: ["Giratina"] },
  "g4-creation-trio": { all: ["Dialga", "Palkia", "Giratina"] },
  "g4-heatran": { all: ["Heatran"] },
  "g4-regigigas": { all: ["Regigigas"] },
  "g4-cresselia": { all: ["Cresselia"] },
  "g4-phione": { all: ["Phione"] },
  "g4-manaphy": { all: ["Manaphy"] },
  "g4-darkrai": { all: ["Darkrai"] },
  "g4-shaymin": { all: ["Shaymin"] },
  "g4-arceus": { all: ["Arceus"] },
  "g4-all-legends": { all: ["Créhelf", "Créfollet", "Créfadet", "Dialga", "Palkia", "Giratina", "Heatran", "Regigigas", "Cresselia", "Phione", "Manaphy", "Darkrai", "Shaymin", "Arceus"] },
  "g4-count-25": { biomeCount: { count: 25, names: GEN4_POKEMONS } },
  "g4-count-50": { biomeCount: { count: 50, names: GEN4_POKEMONS } },
  "g4-count-75": { biomeCount: { count: 75, names: GEN4_POKEMONS } },
  "g4-count-full": { biomeCount: { count: 107, names: GEN4_POKEMONS } },
  "g4-shiny-starters": { shinyAll: ["Torterra", "Simiabraz", "Pingoléon"] },
  "g4-shiny-lucario": { shinyAll: ["Lucario"] },
  "g4-shiny-carchacrok": { shinyAll: ["Carchacrok"] },
  "g4-shiny-giratina": { shinyAll: ["Giratina"] },
  "g4-shiny-lake-trio": { shinyAll: ["Créhelf", "Créfollet", "Créfadet"] },
  "g4-shiny-torterra": { shinyAll: ["Torterra"] },
  "g4-shiny-simiabraz": { shinyAll: ["Simiabraz"] },
  "g4-shiny-pingoleon": { shinyAll: ["Pingoléon"] },
  "g4-shiny-luxray": { shinyAll: ["Luxray"] },
  "g4-shiny-etouraptor": { shinyAll: ["Étouraptor"] },
  "g4-shiny-roserade": { shinyAll: ["Roserade"] },
  "g4-shiny-togekiss": { shinyAll: ["Togekiss"] },
  "g4-shiny-magnezone": { shinyAll: ["Magnézone"] },
  "g4-shiny-electivire": { shinyAll: ["Élekable"] },
  "g4-shiny-magmortar": { shinyAll: ["Maganon"] },
  "g4-shiny-rhinastoc": { shinyAll: ["Rhinastoc"] },
  "g4-shiny-mammochon": { shinyAll: ["Mammochon"] },
  "g4-shiny-yanmega": { shinyAll: ["Yanmega"] },
  "g4-shiny-leafeon": { shinyAll: ["Phyllali"] },
  "g4-shiny-glaceon": { shinyAll: ["Givrali"] },
  "g4-shiny-gallame": { shinyAll: ["Gallame"] },
  "g4-shiny-froslass": { shinyAll: ["Momartik"] },
  "g4-shiny-spiritomb": { shinyAll: ["Spiritomb"] },
  "g4-shiny-crehelf": { shinyAll: ["Créhelf"] },
  "g4-shiny-crefollet": { shinyAll: ["Créfollet"] },
  "g4-shiny-crefadet": { shinyAll: ["Créfadet"] },
  "g4-shiny-dialga": { shinyAll: ["Dialga"] },
  "g4-shiny-palkia": { shinyAll: ["Palkia"] },
  "g4-shiny-darkrai": { shinyAll: ["Darkrai"] },
  "g4-shiny-arceus": { shinyAll: ["Arceus"] },
};

// Vérifie et déverrouille tous les succès mérités — retourne les IDs nouvellement débloqués
// Nombre total de badges d'arène (15 classiques Kanto/Johto + 16 Élite Hoenn/Sinnoh).
const TOTAL_ARENA_BADGES = 31;

export async function checkAchievements(userId) {
  const [existing, ts] = await Promise.all([
    all(`SELECT achievement_id FROM achievements WHERE user_id = ? AND unlocked = 1`, [userId]),
    get(`SELECT level, xp FROM trainer_stats WHERE user_id = ?`, [userId]),
  ]);

  const unlockedSet = new Set(existing.map(r => r.achievement_id));
  // Plafond de niveau : 200 si la gen 3/4 est réclamée, sinon 100
  const gen34Row = await get(
    `SELECT claimed FROM achievements WHERE user_id = ? AND achievement_id = 'unlock-gen3-4'`,
    [userId]
  );
  const levelCap = maxLevelFor(Number(gen34Row?.claimed) === 1);
  // Recalcul depuis l'XP pour éviter une colonne level désynchronisée
  const level = Math.max(ts?.level || 1, computeLevel(ts?.xp || 0, levelCap));
  const toUnlock    = [];

  // Vérification par niveau
  for (const [id, required] of Object.entries(LEVEL_REQS)) {
    if (unlockedSet.has(id)) continue;
    if (level >= required) toUnlock.push(id);
  }

  // Vérification par Pokédex + compteurs (une seule requête captures)
  const pendingPokedex = Object.keys(POKEDEX_REQS).filter(id => !unlockedSet.has(id));
  if (pendingPokedex.length > 0) {
    const captures = await all(
      `SELECT pokemon_name, is_shiny FROM captures WHERE user_id = ?`,
      [userId]
    );
    // Aliases ancien↔nouveau noms pour rétrocompatibilité
    const NAME_ALIASES = {
      "Melofee":"Mélofée","Melodelfe":"Mélodelfe","Aeromite":"Aéromite","Ferosinge":"Férosinge",
      "Chetiflor":"Chétiflor","Magneti":"Magnéti","Magneton":"Magnéton","Electrode":"Électrode",
      "Rhinoferos":"Rhinoféros","Hypocean":"Hypocéan","Insecateur":"Insécateur","Elektek":"Élektek",
      "Leviator":"Léviator","Metamorph":"Métamorph","Evoli":"Évoli","Ptéra":"Ptéra",
      "Electhor":"Électhor","Mélofée":"Melofee","Mélodelfe":"Melodelfe","Aéromite":"Aéromite",
      "Férosinge":"Férosinge","Chétiflor":"Chétiflor","Magnéti":"Magnéti","Magnéton":"Magnéton",
      "Électrode":"Électrode","Rhinoféros":"Rhinoféros","Hypocéan":"Hypocéan","Insécateur":"Insécateur",
      "Élektek":"Élektek","Léviator":"Léviator","Métamorph":"Metamorph","Évoli":"Evoli",
      "Ptéra":"Ptéra","Électhor":"Électhor",
    };
    const expandSet = (s) => { for (const [k,v] of Object.entries(NAME_ALIASES)) { if (s.has(k)) s.add(v); } return s; };
    const capturedAny    = expandSet(new Set(captures.map(r => r.pokemon_name)));
    const capturedNormal = expandSet(new Set(captures.filter(r => Number(r.is_shiny) === 0).map(r => r.pokemon_name)));
    const capturedShiny  = expandSet(new Set(captures.filter(r => Number(r.is_shiny) === 1).map(r => r.pokemon_name)));
    const shinyCount     = capturedShiny.size;
    const normalCount    = captures.filter(r => Number(r.is_shiny) === 0).length;
    const totalCount     = captures.length;

    // Casino : vérifier si le solde >= 20 000₽
    if (!unlockedSet.has("unlock-casino")) {
      const inv = await get(`SELECT pokedollars FROM inventory WHERE user_id = ?`, [userId]);
      if ((inv?.pokedollars || 0) >= 20000) toUnlock.push("unlock-casino");
    }

    // Safari : total captures >= 50
    if (!unlockedSet.has("unlock-safari") && totalCount >= 50) toUnlock.push("unlock-safari");

    // PokéTrade : 3 Pokémon en réserve
    if (!unlockedSet.has("unlock-poketrade")) {
      const resRow = await get(`SELECT COUNT(*) as cnt FROM pokemon_reserve WHERE user_id = ?`, [userId]);
      if ((resRow?.cnt || 0) >= 3) toUnlock.push("unlock-poketrade");
    }

    // PokéArène : 6 Pokémon différents dans le Pokédex
    if (!unlockedSet.has("unlock-arene") && capturedAny.size >= 6) toUnlock.push("unlock-arene");

    // PokéVersus : Badge Roche + Badge Cascade obtenus
    if (!unlockedSet.has("unlock-versus")) {
      const badgeRow = await get(
        `SELECT COUNT(*) as cnt FROM user_badges WHERE user_id = ? AND badge IN ('Badge Roche', 'Badge Cascade') AND unlocked = 1`,
        [userId]
      );
      if ((badgeRow?.cnt || 0) >= 2) toUnlock.push("unlock-versus");
    }

    for (const id of pendingPokedex) {
      const req = POKEDEX_REQS[id];
      let met = false;
      if (req.all)          met = req.all.every(n => capturedAny.has(n));
      else if (req.groups)  met = req.groups.every(g => g.some(n => capturedAny.has(n)));
      else if (req.shinyAll)      met = req.shinyAll.every(n => capturedShiny.has(n));
      else if (req.shinyGroups)   met = req.shinyGroups.every(g => g.some(n => capturedShiny.has(n)));
      else if (req.shinyCount  !== undefined) met = shinyCount  >= req.shinyCount;
      else if (req.normalCount !== undefined) met = normalCount >= req.normalCount;
      else if (req.normalAll)    met = req.normalAll.every(n => capturedNormal.has(n));
      else if (req.totalCount  !== undefined) met = totalCount  >= req.totalCount;
      else if (req.biomeCount) met = req.biomeCount.names.filter(n => capturedAny.has(n)).length >= req.biomeCount.count;
      if (met) toUnlock.push(id);
    }
  } else {
    // Même sans pendingPokedex, vérifier casino, safari et nouveaux déblocages
    if (!unlockedSet.has("unlock-casino")) {
      const inv = await get(`SELECT pokedollars FROM inventory WHERE user_id = ?`, [userId]);
      if ((inv?.pokedollars || 0) >= 20000) toUnlock.push("unlock-casino");
    }
    if (!unlockedSet.has("unlock-safari")) {
      const row = await get(`SELECT COUNT(*) as cnt FROM captures WHERE user_id = ?`, [userId]);
      if ((row?.cnt || 0) >= 50) toUnlock.push("unlock-safari");
    }
    if (!unlockedSet.has("unlock-poketrade")) {
      const resRow = await get(`SELECT COUNT(*) as cnt FROM pokemon_reserve WHERE user_id = ?`, [userId]);
      if ((resRow?.cnt || 0) >= 3) toUnlock.push("unlock-poketrade");
    }
    if (!unlockedSet.has("unlock-arene")) {
      const capRow = await get(`SELECT COUNT(DISTINCT pokemon_name) as cnt FROM captures WHERE user_id = ?`, [userId]);
      if ((capRow?.cnt || 0) >= 6) toUnlock.push("unlock-arene");
    }
    if (!unlockedSet.has("unlock-versus")) {
      const badgeRow = await get(
        `SELECT COUNT(*) as cnt FROM user_badges WHERE user_id = ? AND badge IN ('Badge Roche', 'Badge Cascade') AND unlocked = 1`,
        [userId]
      );
      if ((badgeRow?.cnt || 0) >= 2) toUnlock.push("unlock-versus");
    }
  }

  // Boss final : posséder TOUS les badges d'arène (15 classiques + 16 Élite = 31)
  if (!unlockedSet.has("final-boss")) {
    const badgeRow = await get(
      `SELECT COUNT(*) as cnt FROM user_badges WHERE user_id = ? AND unlocked = 1`,
      [userId]
    );
    if ((badgeRow?.cnt || 0) >= TOTAL_ARENA_BADGES) toUnlock.push("final-boss");
  }

  // Dédupliquer (casino/safari peuvent être dans les deux branches)
  const unique = [...new Set(toUnlock)];

  for (const id of unique) {
    await run(
      `INSERT INTO achievements (user_id, achievement_id, unlocked, claimed) VALUES (?,?,1,0)
       ON CONFLICT(user_id, achievement_id) DO UPDATE SET unlocked = 1`,
      [userId, id]
    );
  }

  return unique;
}

// Gardé pour compatibilité ascendante (appelé depuis rewards.js)
export async function checkCasinoUnlock(userId, balance) {
  if (balance < 20000) return;
  await run(
    `INSERT INTO achievements (user_id, achievement_id, unlocked, claimed)
     VALUES (?, 'unlock-casino', 1, 0)
     ON CONFLICT(user_id, achievement_id) DO UPDATE SET unlocked = 1`,
    [userId]
  );
}

// GET /api/achievements/:userId
router.get("/:userId", async (req, res) => {
  try {
    await checkAchievements(req.user.id).catch(() => {});
    const rows = await all(`SELECT * FROM achievements WHERE user_id = ?`, [req.user.id]);
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Erreur DB" });
  }
});

const VALID_ACHIEVEMENT_IDS = new Set([...Object.keys(REWARDS), ...Object.keys(POKEDEX_REQS)]);

// POST /api/achievements/unlock  (admin ou frontend action utilisateur)
router.post("/unlock", async (req, res) => {
  const { achievementId } = req.body;
  const userId = req.user.id;
  if (!achievementId) return res.status(400).json({ error: "Paramètres manquants" });
  if (!VALID_ACHIEVEMENT_IDS.has(achievementId)) return res.status(400).json({ error: "Succès invalide" });
  try {
    await run(
      `INSERT INTO achievements (user_id, achievement_id, unlocked, claimed) VALUES (?,?,1,0)
       ON CONFLICT(user_id, achievement_id) DO UPDATE SET unlocked = 1`,
      [userId, achievementId]
    );
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Erreur DB" });
  }
});

// POST /api/achievements/claim
router.post("/claim", async (req, res) => {
  const { achievementId } = req.body;
  const userId = req.user.id;
  try {
    const row = await get(
      `SELECT * FROM achievements WHERE user_id = ? AND achievement_id = ?`,
      [userId, achievementId]
    );
    if (!row || row.unlocked === 0) return res.status(400).json({ error: "Succès non débloqué" });
    if (row.claimed === 1)          return res.status(400).json({ error: "Récompense déjà récupérée" });

    // Validation supplémentaire pour unlock-versus : vérifier que les 2 badges sont réellement obtenus
    if (achievementId === "unlock-versus") {
      const badgeRow = await get(
        `SELECT COUNT(*) as cnt FROM user_badges WHERE user_id = ? AND badge IN ('Badge Roche', 'Badge Cascade') AND unlocked = 1`,
        [userId]
      );
      if ((badgeRow?.cnt || 0) < 2) return res.status(400).json({ error: "Conditions du succès non remplies (badges manquants)" });
    }

    const reward  = REWARDS[achievementId] || 0;
    const items   = ITEM_REWARDS[achievementId] || {};
    const passive = PASSIVE_REWARDS[achievementId] || null;

    await run(`UPDATE achievements SET claimed = 1 WHERE user_id = ? AND achievement_id = ?`, [userId, achievementId]);

    if (reward > 0) {
      await run(`UPDATE inventory SET pokedollars = pokedollars + ? WHERE user_id = ?`, [reward, userId]);
    }

    const VALID_ITEMS = new Set(["pokeball","superball","hyperball","masterball","resetball","superbonbon","potion","lootbox"]);
    for (const [item, qty] of Object.entries(items)) {
      if (!VALID_ITEMS.has(item)) continue;
      await run(
        `UPDATE inventory SET ${item} = COALESCE(${item}, 0) + ? WHERE user_id = ?`,
        [qty, userId]
      );
    }

    if (passive) {
      await run(
        `UPDATE user_passives SET unlocked = 1 WHERE user_id = ? AND item = ?`,
        [userId, passive]
      );
    }

    const updated = await get(`SELECT pokedollars FROM inventory WHERE user_id = ?`, [userId]);
    res.json({
      message: "🏅 Récompense récupérée !",
      reward, items, passive,
      newBalance: updated?.pokedollars ?? 0,
    });
  } catch (err) {
    console.error("Erreur claim:", err);
    res.status(500).json({ error: "Erreur DB" });
  }
});

export default router;
