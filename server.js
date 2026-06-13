import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createServer }    from "http";
import { Server as SocketIO } from "socket.io";
import { transporter }       from "./mailer.js";
import https                 from "https";

import { initDB, get, run } from "./db.js";
import { setIO }       from "./socket.js";
import { verifyToken, verifyAdmin, optionalToken } from "./middleware/auth.js";
import authRoutes        from "./routes/auth.js";
import inventoryRoutes   from "./routes/inventory.js";
import gameStateRoutes   from "./routes/gameState.js";
import rewardRoutes      from "./routes/rewards.js";
import captureRoutes     from "./routes/captures.js";
import achievementRoutes from "./routes/achievements.js";
import passiveRoutes     from "./routes/passives.js";
import adminRoutes       from "./routes/admin.js";
import levelRoutes       from "./routes/levels.js";
import pokeclickRoutes   from "./routes/pokeclick.js";
import areneRoutes       from "./routes/arenes.js";
import reserveRoutes     from "./routes/reserve.js";
import pokeTradeRoutes   from "./routes/pokeTrade.js";
import eventRoutes, { resumeEventTimers } from "./routes/events.js";
import versusRoutes, { setupVersusSocket } from "./routes/versus.js";
import jackpotRoutes from "./routes/jackpot.js";
import teamRocketRoutes from "./routes/teamRocket.js";
import { scheduleWeeklyReset } from "./jobs/ladderReset.js";
import { FR_TO_CRY_ID } from "./routes/gameState.js";

const PORT    = process.env.PORT || 3000;
const ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") || ["https://poketraining.fr"];

const app    = express();
const server = createServer(app);

// ─── Socket.io ───────────────────────────────────────────────────
const socketOrigins = process.env.NODE_ENV === "production"
  ? ORIGINS
  : true; // accepte toutes origines en développement (localhost:5173, etc.)
const io = new SocketIO(server, { cors: { origin: socketOrigins, credentials: true } });
setIO(io);
io.on("connection", () => {});
setupVersusSocket(io);

// ─── Middleware ───────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP géré par Nginx/Vite
app.use(cors({ origin: ORIGINS, methods: ["GET","POST","DELETE"], credentials: true }));
app.use("/api/user/avatar", express.json({ limit: "512kb" }));
app.use(express.json({ limit: "16kb" }));

// Rate limiting global : 10 000 req/15min par IP (skip localhost)
app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requêtes, réessaie dans quelques minutes." },
  skip: (req) => req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1",
}));

// PokéClick : pas de rate limit strict (autoclick = beaucoup de requêtes légitimes)
app.use("/api/pokeclick/click",     rateLimit({ windowMs: 1000, max: 20, message: { error: "Trop vite !" } }));
app.use("/api/pokeclick/autoclick", rateLimit({ windowMs: 1000, max: 20, message: { error: "Trop vite !" } }));

// Rate limiting auth : 50 tentatives/heure
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: { error: "Trop de tentatives de connexion. Réessaie dans une heure." },
});
app.use("/api/login",    authLimiter);
app.use("/api/register", authLimiter);

// Rate limiting support mail : 5/heure
const supportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: "Limite de messages support atteinte (5/heure)." },
});
app.use("/api/support",          supportLimiter);
app.use("/api/forgot-password",  rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: { error: "Trop de demandes. Réessaie dans une heure." } }));

app.post("/api/support", express.json(), async (req, res) => {
  const { username, subject, message } = req.body;
  if (!subject || !message) return res.status(400).json({ error: "Sujet et message obligatoires" });
  try {
    const row        = username ? await get(`SELECT email FROM users WHERE username = ?`, [username]) : null;
    const playerMail = row?.email || null;

    const mailOptions = {
      from:    `"PokéTraining Support" <${process.env.SMTP_USER}>`,
      to:      process.env.SMTP_USER,
      subject: `[Support] ${subject} (par ${username || "Anonyme"})`,
      text:    `Utilisateur : ${username || "Anonyme"}\nEmail : ${playerMail || "non renseigné"}\nSujet : ${subject}\n\nMessage :\n${message}`,
    };
    if (playerMail) mailOptions.replyTo = playerMail;

    await transporter.sendMail(mailOptions);
    res.json({ success: true });
  } catch (err) {
    console.error("Erreur mail:", err);
    res.status(500).json({ error: "Erreur envoi mail" });
  }
});

// ─── Routes ───────────────────────────────────────────────────────
// Publiques (sans token)
app.use("/api",          authRoutes);    // /login + /register
app.get("/api/ping", optionalToken, (req, res) => {
  if (req.user?.id) {
    run(`UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?`, [req.user.id]).catch(() => {});
  }
  res.json({ status: "ok" });
});
app.get("/api/leaderboard", async (req, res) => {
  const { all } = await import("./db.js");
  try {
    const rows = await all(`
      SELECT u.id, u.username,
             COUNT(c.id)                                    AS captures,
             SUM(CASE WHEN c.is_shiny = 1 THEN 1 ELSE 0 END) AS shinyCaptures,
             COALESCE(i.pokedollars, 0)                     AS pokedollars
      FROM users u
      LEFT JOIN captures c  ON c.user_id  = u.id
      LEFT JOIN inventory i ON i.user_id  = u.id
      WHERE u.role != 'admin'
      GROUP BY u.id
      ORDER BY captures DESC, i.pokedollars DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch { res.status(500).json({ error: "Erreur serveur" }); }
});

// Cry par ID direct (Pokédex) — public, pas de game state requis
app.get("/api/cry/pokemon/:pokeId", (req, res) => {
  const pokeId = parseInt(req.params.pokeId, 10);
  if (!pokeId || pokeId < 1 || pokeId > 898) return res.status(400).json({ error: "ID invalide" });
  const url = `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${pokeId}.ogg`;
  https.get(url, (upstream) => {
    if (upstream.statusCode !== 200) return res.status(502).json({ error: "Cri indisponible" });
    res.setHeader("Content-Type", "audio/ogg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    upstream.pipe(res);
  }).on("error", () => res.status(502).json({ error: "Erreur réseau" }));
});

// Cry : public (new Audio() ne peut pas envoyer de header Authorization)
app.get("/api/cry/:userId/:gameType", optionalToken, async (req, res) => {
  const { userId, gameType } = req.params;
  const resolvedId = req.user?.id ?? userId;
  try {
    const row = await get("SELECT state FROM game_states WHERE user_id = ? AND game_type = ?", [resolvedId, gameType]);
    if (!row) return res.status(404).json({ error: "Partie non trouvée" });
    const state = JSON.parse(row.state || "{}");
    const pokeId = FR_TO_CRY_ID[state.secret];
    if (!pokeId) return res.status(404).json({ error: "Cri non disponible" });
    const url = `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${pokeId}.ogg`;
    https.get(url, (upstream) => {
      if (upstream.statusCode !== 200) return res.status(502).json({ error: "Cri indisponible" });
      res.setHeader("Content-Type", "audio/ogg");
      res.setHeader("Cache-Control", "no-store");
      upstream.pipe(res);
    }).on("error", () => res.status(502).json({ error: "Erreur réseau" }));
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Casino jackpot — semi-public (optionalToken géré dans la route)
app.use("/api/casino",                   jackpotRoutes);

// Protégées (token requis)
app.use("/api",               verifyToken, gameStateRoutes);
app.use("/api",               verifyToken, rewardRoutes);
app.use("/api",               verifyToken, captureRoutes);
app.use("/api/inventory",     verifyToken, inventoryRoutes);
app.use("/api/achievements",  verifyToken, achievementRoutes);
app.use("/api/passives",      verifyToken, passiveRoutes);
app.use("/api/level",         verifyToken, levelRoutes);
app.use("/api/pokeclick",     verifyToken, pokeclickRoutes);
app.use("/api/arenes",        verifyToken, areneRoutes);
app.use("/api/reserve",      verifyToken, reserveRoutes);
app.use("/api/teamrocket",   verifyToken, teamRocketRoutes);
app.use("/api/trade",        verifyToken, pokeTradeRoutes);
app.use("/api/admin",         verifyAdmin, adminRoutes);
app.use("/api/events",                    eventRoutes);
app.use("/api/versus",     verifyToken,  versusRoutes);

app.use("/api/badges/:username", async (req, res) => {
  const { get, all } = await import("./db.js");
  try {
    const user = await get(`SELECT id FROM users WHERE username = ?`, [req.params.username]);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    const rows = await all(`SELECT badge, unlocked, date_obtained FROM user_badges WHERE user_id = ?`, [user.id]);
    res.json(rows.map(r => ({ badge: r.badge, unlocked: !!r.unlocked, date_obtenu: r.date_obtained })));
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Gestion des erreurs globales ─────────────────────────────────
process.on("uncaughtException", (err) => {
  console.error("❌ uncaughtException:", err);
  // Ne pas quitter : laisser le process continuer
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ unhandledRejection:", reason);
  // Ne pas quitter
});

// ─── Arrêt gracieux (PM2 restart / SIGTERM) ───────────────────────
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM — arrêt gracieux...");
  server.close(() => {
    console.log("✅ Serveur fermé proprement");
    process.exit(0);
  });
  // Force l'arrêt après 5 s si des connexions persistent
  setTimeout(() => { console.log("⏱ Timeout — arrêt forcé"); process.exit(0); }, 5000).unref();
});

// ─── Démarrage ────────────────────────────────────────────────────
let _bindRetries = 0;
const MAX_BIND_RETRIES = 10;

initDB().then(() => {
  scheduleWeeklyReset();
  resumeEventTimers(); // reprend l'expiration des événements actifs après redémarrage
  server.listen(PORT, () => { _bindRetries = 0; console.log(`🚀 PokéTraining backend → port ${PORT}`); });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      _bindRetries++;
      if (_bindRetries > MAX_BIND_RETRIES) {
        console.error(`❌ Port ${PORT} toujours occupé après ${MAX_BIND_RETRIES} tentatives — abandon`);
        process.exit(1);
      }
      console.error(`⚠️ Port ${PORT} déjà utilisé — nouvelle tentative dans 1s (${_bindRetries}/${MAX_BIND_RETRIES})`);
      setTimeout(() => { server.close(); server.listen(PORT); }, 1000);
    } else {
      console.error("❌ Erreur serveur:", err);
    }
  });
}).catch(err => {
  console.error("❌ Erreur initDB:", err);
  process.exit(1);
});
