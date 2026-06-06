import { Router } from "express";
import { run, get, all } from "../db.js";
import { optionalToken, verifyToken, verifyAdmin } from "../middleware/auth.js";
import { getIO } from "../socket.js";

const router = Router();

const JACKPOT_THRESHOLD = 100000;              // ₽ pour ouvrir la loterie
const JACKPOT_DURATION  = 2 * 60 * 60 * 1000; // 2h en ms
const WINNERS_COUNT     = 4;

// ─── Broadcast de l'état courant à tous les clients ───────────────────────────
async function broadcastJackpot() {
  try {
    const jackpot    = await get("SELECT * FROM casino_jackpot WHERE id = 1");
    if (!jackpot) return;
    const countRow   = await get("SELECT COUNT(*) AS cnt FROM casino_lottery_entries");
    getIO()?.emit("jackpot:update", {
      amount:         jackpot.amount,
      state:          jackpot.state,
      threshold:      JACKPOT_THRESHOLD,
      lotteryEndTime: jackpot.lottery_end_time,
      lastWinners:    JSON.parse(jackpot.last_winners || "[]"),
      lastDrawAt:     jackpot.last_draw_at,
      entryCount:     countRow?.cnt ?? 0,
      winnersCount:   WINNERS_COUNT,
    });
  } catch {}
}

// ─── Fonction interne : ajoute à la cagnotte (appelée depuis rewards.js) ──────
export async function addToJackpot(betAmount) {
  if (!betAmount || betAmount <= 0) return;
  try {
    const jackpot = await get("SELECT state FROM casino_jackpot WHERE id = 1");
    if (!jackpot || jackpot.state !== "accumulating") return;
    await run("UPDATE casino_jackpot SET amount = amount + ? WHERE id = 1", [betAmount]);
    await checkThreshold();
    broadcastJackpot(); // temps réel — sans await pour ne pas bloquer la mise
  } catch {}
}

async function checkThreshold() {
  const jackpot = await get("SELECT amount, state FROM casino_jackpot WHERE id = 1");
  if (!jackpot || jackpot.state !== "accumulating") return;
  if (jackpot.amount >= JACKPOT_THRESHOLD) {
    const lotteryEnd = Date.now() + JACKPOT_DURATION;
    await run(
      "UPDATE casino_jackpot SET state = 'lottery_open', lottery_end_time = ? WHERE id = 1",
      [lotteryEnd]
    );
  }
}

async function runLottery() {
  const jackpot = await get("SELECT * FROM casino_jackpot WHERE id = 1");
  if (!jackpot || jackpot.state !== "lottery_open") return;

  const entries = await all("SELECT user_id, username FROM casino_lottery_entries");
  const amount  = jackpot.amount;

  if (entries.length === 0) {
    await run(
      "UPDATE casino_jackpot SET state = 'accumulating', amount = 0, lottery_end_time = NULL, last_winners = '[]', last_draw_at = ? WHERE id = 1",
      [Date.now()]
    );
    await broadcastJackpot();
    return;
  }

  // Mélange Fisher-Yates
  const pool = [...entries];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const numWinners = Math.min(WINNERS_COUNT, pool.length);
  const gain       = Math.floor(amount / numWinners);
  const selected   = pool.slice(0, numWinners);
  const winners    = [];

  for (const w of selected) {
    await run(
      "UPDATE inventory SET pokedollars = COALESCE(pokedollars,0) + ? WHERE user_id = ?",
      [gain, w.user_id]
    );
    winners.push({ userId: w.user_id, username: w.username, gain });
  }

  await run(
    "UPDATE casino_jackpot SET state = 'accumulating', amount = 0, lottery_end_time = NULL, last_winners = ?, last_draw_at = ? WHERE id = 1",
    [JSON.stringify(winners), Date.now()]
  );
  await run("DELETE FROM casino_lottery_entries");
  await broadcastJackpot();
}

// ─── GET /api/casino/jackpot ───────────────────────────────────────────────────
router.get("/jackpot", optionalToken, async (req, res) => {
  try {
    let jackpot = await get("SELECT * FROM casino_jackpot WHERE id = 1");
    if (!jackpot) {
      await run("INSERT OR IGNORE INTO casino_jackpot (id, amount, state) VALUES (1, 0, 'accumulating')");
      jackpot = await get("SELECT * FROM casino_jackpot WHERE id = 1");
    }

    // Tirage automatique si le délai est écoulé
    if (jackpot.state === "lottery_open" && jackpot.lottery_end_time && Date.now() >= jackpot.lottery_end_time) {
      await runLottery();
      jackpot = await get("SELECT * FROM casino_jackpot WHERE id = 1");
    }

    let isRegistered = false;
    if (req.user) {
      const entry = await get("SELECT user_id FROM casino_lottery_entries WHERE user_id = ?", [req.user.id]);
      isRegistered = !!entry;
    }

    const countRow   = await get("SELECT COUNT(*) AS cnt FROM casino_lottery_entries");
    const entryCount = countRow?.cnt ?? 0;

    res.json({
      amount:         jackpot.amount,
      state:          jackpot.state,
      threshold:      JACKPOT_THRESHOLD,
      lotteryEndTime: jackpot.lottery_end_time,
      lastWinners:    JSON.parse(jackpot.last_winners || "[]"),
      lastDrawAt:     jackpot.last_draw_at,
      isRegistered,
      entryCount,
      winnersCount:   WINNERS_COUNT,
    });
  } catch (err) {
    console.error("Jackpot GET error:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── POST /api/casino/jackpot/register ────────────────────────────────────────
router.post("/jackpot/register", verifyToken, async (req, res) => {
  try {
    const jackpot = await get("SELECT state, lottery_end_time FROM casino_jackpot WHERE id = 1");
    if (!jackpot || jackpot.state !== "lottery_open")
      return res.status(400).json({ error: "La loterie n'est pas ouverte" });
    if (jackpot.lottery_end_time && Date.now() >= jackpot.lottery_end_time)
      return res.status(400).json({ error: "La fenêtre d'inscription est fermée" });

    const user = await get("SELECT id, username FROM users WHERE id = ?", [req.user.id]);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    await run(
      "INSERT OR IGNORE INTO casino_lottery_entries (user_id, username) VALUES (?, ?)",
      [user.id, user.username]
    );

    // Broadcast le nouveau compteur d'inscrits à tous
    broadcastJackpot();

    const entry = await get("SELECT user_id FROM casino_lottery_entries WHERE user_id = ?", [user.id]);
    res.json({ success: true, registered: !!entry });
  } catch (err) {
    console.error("Jackpot register error:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── POST /api/casino/jackpot/admin/reset ─────────────────────────────────────
router.post("/jackpot/admin/reset", verifyAdmin, async (req, res) => {
  try {
    await run(
      "UPDATE casino_jackpot SET state = 'accumulating', amount = 0, lottery_end_time = NULL WHERE id = 1"
    );
    await run("DELETE FROM casino_lottery_entries");
    await broadcastJackpot();
    res.json({ success: true });
  } catch (err) {
    console.error("Jackpot admin reset error:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── POST /api/casino/jackpot/admin/draw ──────────────────────────────────────
router.post("/jackpot/admin/draw", verifyAdmin, async (req, res) => {
  try {
    const jackpot = await get("SELECT state FROM casino_jackpot WHERE id = 1");
    if (!jackpot || jackpot.state !== "lottery_open")
      return res.status(400).json({ error: "La loterie n'est pas ouverte" });
    await runLottery();
    const updated = await get("SELECT * FROM casino_jackpot WHERE id = 1");
    res.json({ success: true, lastWinners: JSON.parse(updated.last_winners || "[]") });
  } catch (err) {
    console.error("Jackpot admin draw error:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
