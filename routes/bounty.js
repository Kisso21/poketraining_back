import { Router } from "express";
import { run, get, GEN1_POKEMONS, GEN2_POKEMONS } from "../db.js";
import { getPokemonCategory } from "./inventory.js";
import { getIO } from "../socket.js";

const router = Router();

// Rotation toutes les 6 heures
export const BOUNTY_CYCLE_MS = 6 * 60 * 60 * 1000;

// Prime selon la catégorie du Pokémon recherché (doublée si capturé shiny)
const PRIZE_BY_CATEGORY = {
  mythic:     25000,
  legendaire: 15000,
  fossile:     8000,
  stade3:      5000,
  sansevo:     2500,
  stade1ou2:   2500,
};
function prizeFor(name) {
  return PRIZE_BY_CATEGORY[getPokemonCategory(name)] || 2500;
}

// Pool gen 1-2 uniquement (accessible à tous les joueurs), hors MissingNo
const POOL = [...GEN1_POKEMONS, ...GEN2_POKEMONS].filter(n => n && n !== "MissingNo");

function pickPokemon() {
  return POOL[Math.floor(Math.random() * POOL.length)];
}

// Garantit un Pokémon recherché courant (rotation paresseuse si expiré/absent).
// Renvoie la ligne bounty à jour.
export async function ensureCurrentBounty() {
  const row = await get(`SELECT cycle_id, pokemon_name, prize, started_at FROM bounty WHERE id = 1`);
  const startedMs = row?.started_at ? new Date(row.started_at.replace(" ", "T") + "Z").getTime() : 0;
  const expired = !row?.pokemon_name || !startedMs || (Date.now() - startedMs >= BOUNTY_CYCLE_MS);
  if (!expired) return row;

  const name  = pickPokemon();
  const prize = prizeFor(name);
  await run(
    `UPDATE bounty SET cycle_id = cycle_id + 1, pokemon_name = ?, prize = ?, started_at = datetime('now') WHERE id = 1`,
    [name, prize]
  );
  return get(`SELECT cycle_id, pokemon_name, prize, started_at FROM bounty WHERE id = 1`);
}

// Verse la prime si le Pokémon capturé est le recherché (1 fois / cycle / joueur).
// Appelé depuis le flux de capture. Renvoie { awarded, amount } ou null.
export async function awardBountyIfMatch(userId, pokemonName, isShiny) {
  try {
    const b = await ensureCurrentBounty();
    if (!b?.pokemon_name || b.pokemon_name !== pokemonName) return null;

    // Verrou atomique : l'INSERT échoue si la prime a déjà été réclamée ce cycle
    const ins = await run(
      `INSERT OR IGNORE INTO bounty_claims (user_id, cycle_id) VALUES (?,?)`,
      [userId, b.cycle_id]
    );
    if (ins.changes === 0) return null; // déjà réclamée ce cycle

    const amount = b.prize * (Number(isShiny) === 1 ? 2 : 1);
    await run(`UPDATE inventory SET pokedollars = pokedollars + ? WHERE user_id = ?`, [amount, userId]);
    getIO()?.emit("sync:inventory", { userId });
    return { awarded: true, amount, pokemon: b.pokemon_name, shiny: Number(isShiny) === 1 };
  } catch {
    return null;
  }
}

// GET /api/bounty — Pokémon recherché courant + statut du joueur
router.get("/", async (req, res) => {
  try {
    const b = await ensureCurrentBounty();
    const startedMs = b?.started_at ? new Date(b.started_at.replace(" ", "T") + "Z").getTime() : Date.now();
    const claim = await get(
      `SELECT 1 AS c FROM bounty_claims WHERE user_id = ? AND cycle_id = ?`,
      [req.user.id, b.cycle_id]
    );
    res.json({
      pokemon: b.pokemon_name,
      prize: b.prize,
      endsAt: new Date(startedMs + BOUNTY_CYCLE_MS).toISOString(),
      claimed: !!claim,
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
