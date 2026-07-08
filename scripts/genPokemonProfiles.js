// ─────────────────────────────────────────────────────────────────────────────
// Génère/rafraîchit la table de référence pokemon_profiles pour le PokéÉlevage.
//
//   Usage :  node scripts/genPokemonProfiles.js
//
// Source : /var/www/html/data/gen1_2.json + gen3_4.json (les données servies au
// front). Sortie : une ligne par Pokémon (nom FR) avec tier, gen, types, stats
// brutes + stats normalisées (%). Idempotent (INSERT OR REPLACE).
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { run, all } from "../db.js";
import { classifyTier, genFromId, normalizeStats } from "../lib/eggProfiles.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = resolve(__dirname, "../../html/data");

function loadPokemon() {
  const g12 = JSON.parse(readFileSync(resolve(DATA_DIR, "gen1_2.json"), "utf8"));
  const g34 = JSON.parse(readFileSync(resolve(DATA_DIR, "gen3_4.json"), "utf8"));
  // Dédoublonnage par nom (au cas où un Pokémon apparaîtrait dans les deux fichiers).
  const byName = new Map();
  for (const p of [...g12, ...g34]) {
    if (!p?.id || !p?.name) continue;         // ignore entrées vides / MissingNo (id 0)
    byName.set(p.name, p);
  }
  return [...byName.values()];
}

async function main() {
  // Autonome : garantit la table même si le serveur n'a pas encore rejoué initDB().
  await run(`CREATE TABLE IF NOT EXISTS pokemon_profiles (
    pokemon   TEXT PRIMARY KEY,
    dex_id    INTEGER NOT NULL,
    gen       INTEGER NOT NULL,
    tier      TEXT    NOT NULL,
    type1     TEXT    NOT NULL,
    type2     TEXT,
    base_hp   INTEGER, base_atk INTEGER, base_def INTEGER,
    base_spa  INTEGER, base_spd INTEGER, base_vit INTEGER,
    norm_hp   REAL, norm_atk REAL, norm_def REAL,
    norm_spa  REAL, norm_spd REAL, norm_vit REAL
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_profiles_tier_gen ON pokemon_profiles(tier, gen)`);

  const pokemons = loadPokemon();
  let n = 0;

  for (const p of pokemons) {
    const stats = {
      hp:  p.hp  ?? 0, atk: p.atk    ?? 0, def: p.def    ?? 0,
      spa: p.sp_atk ?? 0, spd: p.sp_def ?? 0, vit: p.speed ?? 0,
    };
    const norm = normalizeStats(stats);
    const tier = classifyTier(p.name, p.stage);
    const gen  = genFromId(p.id);

    await run(
      `INSERT OR REPLACE INTO pokemon_profiles
         (pokemon, dex_id, gen, tier, type1, type2,
          base_hp, base_atk, base_def, base_spa, base_spd, base_vit,
          norm_hp, norm_atk, norm_def, norm_spa, norm_spd, norm_vit)
       VALUES (?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?)`,
      [
        p.name, p.id, gen, tier, p.type1, p.type2 || null,
        stats.hp, stats.atk, stats.def, stats.spa, stats.spd, stats.vit,
        norm.norm_hp, norm.norm_atk, norm.norm_def, norm.norm_spa, norm.norm_spd, norm.norm_vit,
      ]
    );
    n++;
  }

  // Récapitulatif
  const rows = await all(
    `SELECT tier, gen<=2 AS g12, COUNT(*) AS c FROM pokemon_profiles GROUP BY tier, g12`
  );
  const summary = {};
  for (const r of rows) {
    summary[r.tier] ??= { gen12: 0, gen34: 0 };
    summary[r.tier][r.g12 ? "gen12" : "gen34"] = r.c;
  }

  console.log(`✅ ${n} profils Pokémon générés.`);
  for (const tier of ["stade1", "stade2", "stade3", "legendary", "mythic"]) {
    const s = summary[tier] || { gen12: 0, gen34: 0 };
    console.log(`   ${tier.padEnd(10)} gen1-2=${String(s.gen12).padStart(3)}  gen3-4=${String(s.gen34).padStart(3)}  total=${String(s.gen12 + s.gen34).padStart(3)}`);
  }
  process.exit(0);
}

main().catch(e => { console.error("❌", e); process.exit(1); });
