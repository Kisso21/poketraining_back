import { Router } from "express";
import { run, get } from "../db.js";
import { addToJackpot } from "./jackpot.js";
import { checkCasinoUnlock } from "./achievements.js";
import { getIO } from "../socket.js";

// ══════════════════════════════════════════════════════════════════════════════
// CASINO AUTORITATIF CÔTÉ SERVEUR — slots / gratte / hi-lo
// Le serveur débite la mise, tire le résultat avec SON RNG, crédite le gain.
// Le client ne fait qu'animer : il ne décide plus jamais des montants.
// (Le Crash a déjà sa propre logique serveur dans crash.js ; le jackpot dans jackpot.js.)
// ══════════════════════════════════════════════════════════════════════════════

const router = Router();
const MAX_BET = 5000;

// ── Helpers communs ──────────────────────────────────────────────────────────
async function getBalance(userId) {
  const inv = await get(`SELECT pokedollars FROM inventory WHERE user_id = ?`, [userId]);
  return inv ? (inv.pokedollars || 0) : null;
}
function parseBet(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_BET) return null;
  return n;
}
async function debit(userId, amount) {
  await run(`UPDATE inventory SET pokedollars = pokedollars - ? WHERE user_id = ?`, [amount, userId]);
  addToJackpot(Math.max(1, Math.round(amount * 0.05))).catch(() => {});
}
async function credit(userId, amount) {
  if (amount > 0) await run(`UPDATE inventory SET pokedollars = pokedollars + ? WHERE user_id = ?`, [amount, userId]);
}
async function syncBalance(userId, credited) {
  const row = await get(`SELECT pokedollars FROM inventory WHERE user_id = ?`, [userId]);
  const bal = row?.pokedollars ?? 0;
  getIO()?.emit("sync:inventory", { userId, inventory: { pokedollars: bal } });
  if (credited > 0) checkCasinoUnlock(userId, bal).catch(() => {});
  return bal;
}

// ══════════════════════════════════════ SLOTS ════════════════════════════════
const SLOTS = [
  { id: 129, label: "Magicarpe", weight: 35, x3: 3   },
  { id: 39,  label: "Rondoudou", weight: 25, x3: 9   },
  { id: 25,  label: "Pikachu",   weight: 18, x3: 16  },
  { id: 145, label: "Électhor",  weight: 10, x3: 40  },
  { id: 150, label: "Mewtwo",    weight: 7,  x3: 80  },
  { id: 151, label: "Mew",       weight: 5,  x3: 160 },
];
const SLOT_POOL = SLOTS.flatMap(s => Array(s.weight).fill(s));
const pickSlot  = () => SLOT_POOL[Math.floor(Math.random() * SLOT_POOL.length)];

// POST /api/casino/slots/spin { bet }
router.post("/slots/spin", async (req, res) => {
  const userId = req.user.id;
  const bet = parseBet(req.body.bet);
  if (bet == null) return res.status(400).json({ error: "Mise invalide" });
  try {
    const bal = await getBalance(userId);
    if (bal == null) return res.status(404).json({ error: "Introuvable" });
    if (bal < bet)   return res.status(400).json({ error: "Solde insuffisant" });

    await debit(userId, bet);

    const final = [pickSlot(), pickSlot(), pickSlot()];
    let mult = 0;
    if (final[0].id === final[1].id && final[1].id === final[2].id) mult = final[0].x3;
    else if (final[0].id === final[1].id || final[1].id === final[2].id || final[0].id === final[2].id) mult = 1;
    const gain = Math.floor(bet * mult);
    await credit(userId, gain);

    const balance = await syncBalance(userId, gain);
    res.json({ reels: final.map(s => s.id), mult, gain, symbol: { id: final[0].id, label: final[0].label }, balance });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ══════════════════════════════════════ GRATTE ═══════════════════════════════
const TICKET_COST = 25;
const GRATTE_PRIZES = [
  { key: "poke-ball",   label: "Pokéball",    gain: 30,   w: 55 },
  { key: "great-ball",  label: "Super Ball",  gain: 90,   w: 25 },
  { key: "ultra-ball",  label: "Hyper Ball",  gain: 300,  w: 13 },
  { key: "star-piece",  label: "Étoile",      gain: 900,  w: 6  },
  { key: "big-nugget",  label: "Gros Nugget", gain: 1500, w: 2  },
  { key: "master-ball", label: "Master Ball", gain: 3000, w: 1  },
];
const PRIZE_POOL = GRATTE_PRIZES.flatMap(p => Array(p.w).fill(p));
const NUGGET = { key: "nugget", label: "Minerai", gain: 0 };

// Tickets en cours, en mémoire (comme le Hi-Lo) : un seul ticket non résolu par
// joueur. Un redémarrage serveur annule un ticket non gratté (mise déjà débitée
// perdue — cas rare et accepté).
const scratchTickets = new Map(); // userId -> { prize, winPositions, gain, ticketId }

// Construit une grille 3×3 qui contient TOUJOURS exactement 3 fois le symbole-prix
// (les 3 cases gagnantes, à des positions aléatoires). Les 6 autres cases sont du
// remplissage (minerai ou autres symboles plafonnés à 2) : jamais un second trio.
// Le joueur gagne s'il découvre les 3 cases gagnantes parmi ses 5 grattages, soit
// P = C(6,2)/C(9,5) = 15/126 ≈ 11,9 % (RTP ~90 %).
function buildScratchGrid(prize) {
  const cells = Array(9).fill(null);
  const pos   = [0,1,2,3,4,5,6,7,8];
  for (let i = 8; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pos[i], pos[j]] = [pos[j], pos[i]]; }
  const winPositions = pos.slice(0, 3);
  const winSet = new Set(winPositions);
  const others = GRATTE_PRIZES.filter(p => p.key !== prize.key);
  const used   = {};
  for (let i = 0; i < 9; i++) {
    if (winSet.has(i)) { cells[i] = prize; continue; }
    let sym;
    if (Math.random() < 0.55) {
      sym = NUGGET;
    } else {
      const avail = others.filter(p => (used[p.key] || 0) < 2);
      sym = avail.length ? avail[Math.floor(Math.random() * avail.length)] : NUGGET;
    }
    used[sym.key] = (used[sym.key] || 0) + 1;
    cells[i] = sym;
  }
  return { cells, winPositions };
}

// POST /api/casino/scratch/buy — débite le ticket et génère la grille. L'issue
// n'est PAS décidée ici : elle dépend des cases que le joueur grattera (/claim).
router.post("/scratch/buy", async (req, res) => {
  const userId = req.user.id;
  try {
    const bal = await getBalance(userId);
    if (bal == null) return res.status(404).json({ error: "Introuvable" });
    if (bal < TICKET_COST) return res.status(400).json({ error: "Solde insuffisant" });

    await debit(userId, TICKET_COST);

    const prize = PRIZE_POOL[Math.floor(Math.random() * PRIZE_POOL.length)];
    const { cells, winPositions } = buildScratchGrid(prize);
    const ticketId = (scratchTickets.get(userId)?.ticketId || 0) + 1;
    scratchTickets.set(userId, { prize, winPositions, gain: prize.gain, ticketId });

    const balance = await syncBalance(userId, 0);
    res.json({ cells, prize, ticketId, balance });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/casino/scratch/claim { ticketId, revealed:number[] } — résout le ticket :
// gagné si les 5 cases grattées contiennent les 3 cases gagnantes. Crédite le gain.
router.post("/scratch/claim", async (req, res) => {
  const userId = req.user.id;
  const ticket = scratchTickets.get(userId);
  if (!ticket) return res.status(400).json({ error: "Aucun ticket en cours" });

  const { ticketId } = req.body || {};
  if (ticketId !== ticket.ticketId) return res.status(400).json({ error: "Ticket invalide" });

  const revealed = Array.isArray(req.body?.revealed) ? req.body.revealed : [];
  const set = new Set(revealed.filter(n => Number.isInteger(n) && n >= 0 && n <= 8));
  if (set.size > 5) return res.status(400).json({ error: "Trop de cases grattées" });

  const win  = ticket.winPositions.every(p => set.has(p));
  const gain = win ? ticket.gain : 0;
  try {
    await credit(userId, gain);
    scratchTickets.delete(userId); // un seul claim par ticket
    const balance = await syncBalance(userId, gain);
    res.json({ win, gain, prize: ticket.prize, winPositions: ticket.winPositions, balance });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ══════════════════════════════════════ HI-LO ════════════════════════════════
// État par joueur, en mémoire (comme le Crash). Un redémarrage serveur annule une
// manche en cours — la mise (déjà débitée) est alors perdue, cas rare et accepté.
const hiloGames = new Map(); // userId -> { bet, current, accMult }

function calcMult(n, dir) {
  const p = dir === "higher" ? (100 - n) / 100 : (n - 1) / 100;
  if (p <= 0.02) return 0;
  return parseFloat((0.96 / p).toFixed(2));
}

// POST /api/casino/hilo/start { bet }
router.post("/hilo/start", async (req, res) => {
  const userId = req.user.id;
  const bet = parseBet(req.body.bet);
  if (bet == null) return res.status(400).json({ error: "Mise invalide" });
  try {
    const bal = await getBalance(userId);
    if (bal == null) return res.status(404).json({ error: "Introuvable" });
    if (bal < bet)   return res.status(400).json({ error: "Solde insuffisant" });

    await debit(userId, bet);
    const current = Math.floor(Math.random() * 96) + 3; // 3–98
    hiloGames.set(userId, { bet, current, accMult: 1 });
    const balance = await syncBalance(userId, 0);
    res.json({ current, accMult: 1, balance });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/casino/hilo/guess { dir: "higher" | "lower" }
router.post("/hilo/guess", async (req, res) => {
  const userId = req.user.id;
  const dir = req.body.dir;
  if (dir !== "higher" && dir !== "lower") return res.status(400).json({ error: "Direction invalide" });
  const game = hiloGames.get(userId);
  if (!game) return res.status(400).json({ error: "Aucune partie en cours" });

  const mult = calcMult(game.current, dir);
  if (mult === 0) return res.status(400).json({ error: "Trop risqué" }); // direction impossible

  const next    = Math.floor(Math.random() * 100) + 1;
  const correct = dir === "higher" ? next > game.current : next < game.current;

  if (correct) {
    game.accMult = parseFloat((game.accMult * mult).toFixed(2));
    game.current = next;
    return res.json({ next, correct: true, accMult: game.accMult, mult });
  } else {
    hiloGames.delete(userId); // mise perdue (déjà débitée)
    return res.json({ next, correct: false, lost: true, mult });
  }
});

// POST /api/casino/hilo/cashout
router.post("/hilo/cashout", async (req, res) => {
  const userId = req.user.id;
  const game = hiloGames.get(userId);
  if (!game) return res.status(400).json({ error: "Aucune partie en cours" });
  if (game.accMult <= 1) return res.status(400).json({ error: "Rien à encaisser" });
  try {
    const winAmount = Math.floor(game.bet * game.accMult);
    await credit(userId, winAmount);
    hiloGames.delete(userId);
    const balance = await syncBalance(userId, winAmount);
    res.json({ winAmount, accMult: game.accMult, balance });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
