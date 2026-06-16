import { Router } from "express";
import { run, get } from "../db.js";
import { verifyToken } from "../middleware/auth.js";
import { getIO } from "../socket.js";
import { addToJackpot } from "./jackpot.js";

const router = Router();

// ── Constantes ──────────────────────────────────────────────────────────────
const WAIT_MS   = 10_000;
const RESULT_MS =  5_000;
const TICK_MS   =    100;
const GROWTH    = 0.0001; // per ms — same formula exposed to client

const calcMult = (ms) => Math.max(1.00, parseFloat(Math.exp(GROWTH * ms).toFixed(2)));

function genCrashPoint() {
  // P(crash at 1.00) = 3% house edge via Bustabit-style distribution
  const r = Math.random();
  if (r < 0.03) return 1.00;
  return parseFloat(Math.max(1.00, 0.97 / (1 - r)).toFixed(2));
}

// ── État partagé en mémoire ─────────────────────────────────────────────────
let game = {
  phase:     "waiting",
  roundId:   0,
  crash:     null,
  startTime: null,
  waitEnd:   null,
  bets:      {}, // userId → { username, amount, out, mult, gain }
  lastMult:  1.00,
  history:   [], // last 20 crash points
};
let ticker = null;

// ── Helpers ─────────────────────────────────────────────────────────────────
function publicBets() {
  return Object.entries(game.bets).map(([uid, b]) => ({
    userId:   +uid,
    username: b.username,
    amount:   b.amount,
    out:      b.out,
    mult:     b.mult,
    gain:     b.gain,
  }));
}

function broadcastState(extra = {}) {
  getIO()?.emit("crash:state", {
    phase:     game.phase,
    roundId:   game.roundId,
    waitEnd:   game.waitEnd,
    startTime: game.startTime,
    bets:      publicBets(),
    history:   game.history,
    lastMult:  game.lastMult,
    ...extra,
  });
}

// ── Boucle de jeu ───────────────────────────────────────────────────────────
function startWaiting() {
  if (ticker) { clearInterval(ticker); ticker = null; }
  game.phase     = "waiting";
  game.roundId  += 1;
  game.crash     = genCrashPoint();
  game.startTime = null;
  game.waitEnd   = Date.now() + WAIT_MS;
  game.bets      = {};
  game.lastMult  = 1.00;
  broadcastState();
  setTimeout(startRunning, WAIT_MS);
}

function startRunning() {
  if (game.phase !== "waiting") return;
  game.phase     = "running";
  game.startTime = Date.now();
  broadcastState();

  ticker = setInterval(() => {
    const elapsed = Date.now() - game.startTime;
    const mult    = calcMult(elapsed);
    game.lastMult = mult;

    if (mult >= game.crash) {
      clearInterval(ticker);
      ticker = null;
      doCrash(elapsed);
    } else {
      getIO()?.emit("crash:tick", { multiplier: mult, elapsed });
    }
  }, TICK_MS);
}

function doCrash(elapsed) {
  const finalMult   = calcMult(elapsed);
  game.phase        = "crashed";
  game.lastMult     = finalMult;

  for (const bet of Object.values(game.bets)) {
    if (!bet.out) {
      bet.out  = true;
      bet.mult = null;
      bet.gain = -bet.amount;
    }
  }

  game.history.unshift(finalMult);
  if (game.history.length > 20) game.history.pop();

  broadcastState();
  setTimeout(startWaiting, RESULT_MS);
}

// ── Routes REST ─────────────────────────────────────────────────────────────

// GET /api/crash/state
router.get("/state", (req, res) => {
  res.json({
    phase:     game.phase,
    roundId:   game.roundId,
    waitEnd:   game.waitEnd,
    startTime: game.startTime,
    elapsed:   game.startTime ? Date.now() - game.startTime : null,
    bets:      publicBets(),
    history:   game.history,
    lastMult:  game.lastMult,
  });
});

// POST /api/crash/bet
router.post("/bet", verifyToken, async (req, res) => {
  const userId   = req.user.id;
  const username = req.user.username;
  const amount   = parseInt(req.body.amount, 10);

  if (!amount || amount < 10 || amount > 500_000)
    return res.status(400).json({ error: "Mise invalide (10–500 000₽)" });
  if (game.phase !== "waiting")
    return res.status(400).json({ error: "Les mises sont fermées" });
  if (game.bets[userId])
    return res.status(400).json({ error: "Tu as déjà misé ce round" });

  try {
    const inv = await get("SELECT pokedollars FROM inventory WHERE user_id = ?", [userId]);
    if (!inv || (inv.pokedollars ?? 0) < amount)
      return res.status(400).json({ error: "Solde insuffisant" });

    await run("UPDATE inventory SET pokedollars = pokedollars - ? WHERE user_id = ?", [amount, userId]);
    addToJackpot(Math.max(1, Math.round(amount * 0.05))).catch(() => {});
    game.bets[userId] = { username, amount, out: false, mult: null, gain: null };

    broadcastState();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/crash/cashout
router.post("/cashout", verifyToken, async (req, res) => {
  const userId = req.user.id;

  if (game.phase !== "running")
    return res.status(400).json({ error: "Pas en cours de partie" });

  const bet = game.bets[userId];
  if (!bet)      return res.status(400).json({ error: "Aucune mise ce round" });
  if (bet.out)   return res.status(400).json({ error: "Déjà encaissé" });

  const elapsed   = Date.now() - game.startTime;
  const mult      = calcMult(elapsed);
  const winAmount = Math.floor(bet.amount * mult);
  const gain      = winAmount - bet.amount;

  try {
    await run("UPDATE inventory SET pokedollars = pokedollars + ? WHERE user_id = ?", [winAmount, userId]);
    bet.out  = true;
    bet.mult = mult;
    bet.gain = gain;

    broadcastState();
    res.json({ ok: true, multiplier: mult, gain, winAmount });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Démarre la boucle après que le serveur ait configuré Socket.IO
setTimeout(startWaiting, 1500);

export default router;
