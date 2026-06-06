import { run, get, all } from "../db.js";

const REWARDS = {
  1: { masterball: 1, lootbox: 5, pokedollars: 25000 },
  2: { hyperball:  1, lootbox: 3, pokedollars: 15000 },
  3: { hyperball:  1, lootbox: 1, pokedollars:  5000 },
};

async function distributeRewards(mode) {
  const table  = mode === "3v3" ? "versus_ladder_3v3" : "versus_ladder_6v6";
  const top3   = await all(`SELECT username,points FROM ${table} ORDER BY points DESC LIMIT 3`);

  for (let i = 0; i < top3.length; i++) {
    const rank    = i + 1;
    const rewards = REWARDS[rank];
    const { username } = top3[i];

    const userRow = await get("SELECT id FROM users WHERE username=?", [username]);
    if (!userRow) continue;

    const sets  = Object.keys(rewards).map(k => `${k}=${k}+?`).join(", ");
    const vals  = [...Object.values(rewards), userRow.id];
    await run(`UPDATE inventory SET ${sets} WHERE user_id=?`, vals);
  }
}

async function resetLadder(mode) {
  const table = mode === "3v3" ? "versus_ladder_3v3" : "versus_ladder_6v6";

  // Récupérer le numéro de saison actuel
  const row    = await get(`SELECT MAX(season) as s FROM ${table}`);
  const season = (row?.s || 1);

  await distributeRewards(mode);

  // Archiver la saison
  await run(
    `INSERT INTO versus_seasons (mode,season,ended_at,rewards_distributed) VALUES (?,?,datetime('now'),1)`,
    [mode, season]
  );

  // Reset des points + incrément saison
  await run(`UPDATE ${table} SET points=0, wins=0, losses=0, season=season+1`);

  console.log(`✅ Ladder ${mode} saison ${season} reset — récompenses distribuées`);
}

export async function runWeeklyReset() {
  try {
    await resetLadder("3v3");
    await resetLadder("6v6");
  } catch (err) {
    console.error("❌ Erreur reset ladder weekly:", err);
  }
}

// Planifie le prochain lundi à 00:00 UTC
export function scheduleWeeklyReset() {
  const now         = new Date();
  const next        = new Date();
  const daysToMon   = ((1 + 7 - now.getUTCDay()) % 7) || 7;
  next.setUTCDate(now.getUTCDate() + daysToMon);
  next.setUTCHours(0, 0, 0, 0);
  const delay = next - now;

  console.log(`⏰ Prochain reset ladder : ${next.toUTCString()} (dans ${Math.round(delay/3600000)}h)`);

  setTimeout(async () => {
    await runWeeklyReset();
    scheduleWeeklyReset(); // planifier la semaine suivante
  }, delay);
}
