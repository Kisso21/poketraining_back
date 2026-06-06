import { Router }   from "express";
import bcrypt        from "bcrypt";
import jwt           from "jsonwebtoken";
import crypto        from "crypto";
import { run, get }  from "../db.js";
import { PASSIVES, BADGES, ARENES } from "../db.js";
import { verifyToken } from "../middleware/auth.js";
import { sendVerificationEmail, sendWelcomeEmail } from "../mailer.js";

const router = Router();

const APP_URL = process.env.APP_URL || "https://poketraining.fr";

// Bloquer les méthodes non-POST sur les routes publiques d'auth
router.all("/login",    (req, res, next) => req.method === "POST" ? next() : res.status(405).json({ error: "Méthode non autorisée" }));
router.all("/register", (req, res, next) => req.method === "POST" ? next() : res.status(405).json({ error: "Méthode non autorisée" }));

// ─── Register ────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/register", async (req, res) => {
  const { username, password, email } = req.body;
  if (!username?.trim() || !password)
    return res.status(400).json({ error: "Nom et mot de passe requis" });
  if (username.length < 2 || username.length > 20)
    return res.status(400).json({ error: "Nom entre 2 et 20 caractères" });
  if (password.length < 8 || password.length > 72)
    return res.status(400).json({ error: "Mot de passe entre 8 et 72 caractères" });
  if (!email?.trim())
    return res.status(400).json({ error: "Adresse email requise" });
  if (!EMAIL_RE.test(email.trim()))
    return res.status(400).json({ error: "Adresse email invalide" });

  const emailNorm = email.trim().toLowerCase();

  // Vérifier unicité email avant insertion
  const existing = await get(`SELECT id FROM users WHERE email = ?`, [emailNorm]);
  if (existing)
    return res.status(400).json({ error: "Email déjà utilisé" });

  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await run(
      `INSERT INTO users (username, password, email) VALUES (?,?,?)`,
      [username.trim(), hashed, emailNorm]
    );
    const userId = result.lastID;

    await run(`INSERT INTO inventory (user_id, pokeball) VALUES (?,5)`, [userId]);
    await run(`INSERT INTO trainer_stats (user_id, stat_points_available) VALUES (?,5)`, [userId]);

    await Promise.all([
      ...PASSIVES.map(p => run(`INSERT OR IGNORE INTO user_passives (user_id, item) VALUES (?,?)`, [userId, p])),
      ...BADGES.map(b   => run(`INSERT OR IGNORE INTO user_badges (user_id, badge) VALUES (?,?)`, [userId, b])),
      ...ARENES.map((a, i) => run(`INSERT OR IGNORE INTO user_arenes (username, arene, unlocked) VALUES (?,?,?)`, [username.trim(), a, i === 0 ? 1 : 0])),
    ]);

    await run(`UPDATE users SET email_verified = 0 WHERE id = ?`, [userId]);

    const verifyToken  = crypto.randomBytes(32).toString("hex");
    const verifyExpiry = Date.now() + 24 * 60 * 60 * 1000;
    await run(
      `INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?,?,?)`,
      [userId, verifyToken, verifyExpiry]
    );

    const token = jwt.sign(
      { id: userId, username: username.trim(), role: "user", emailVerified: false },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    const verifyUrl = `${APP_URL}/?verify_token=${verifyToken}`;
    sendVerificationEmail(emailNorm, username.trim(), verifyUrl).catch(err =>
      console.error("Erreur envoi email vérification:", err)
    );

    return res.json({
      success: true, token, id: userId, username: username.trim(),
      emailVerified: false,
      pokedollars: 0, pokeball: 5, superball: 0, hyperball: 0, masterball: 0,
    });
  } catch (err) {
    if (err.message?.includes("UNIQUE constraint failed: users.username"))
      return res.status(400).json({ error: "Nom déjà utilisé" });
    if (err.message?.includes("UNIQUE constraint failed: users.email"))
      return res.status(400).json({ error: "Email déjà utilisé" });
    console.error("Erreur register:", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Login ───────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Nom et mot de passe requis" });

  try {
    const user = await get(
      `SELECT u.id, u.username, u.password, u.role,
              COALESCE(i.pokedollars,0) AS pokedollars,
              COALESCE(i.pokeball,0)    AS pokeball,
              COALESCE(i.superball,0)   AS superball,
              COALESCE(i.hyperball,0)   AS hyperball,
              COALESCE(i.masterball,0)  AS masterball
       FROM users u
       LEFT JOIN inventory i ON i.user_id = u.id
       WHERE u.username = ?`,
      [username]
    );
    if (!user) return res.status(400).json({ error: "Identifiants incorrects" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: "Identifiants incorrects" });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role || "user" },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.json({
      success:     true,
      token,
      userId:      user.id,
      username:    user.username,
      pokedollars: user.pokedollars,
      pokeball:    user.pokeball,
      superball:   user.superball,
      hyperball:   user.hyperball,
      masterball:  user.masterball,
      role:        user.role || "user",
    });
  } catch (err) {
    console.error("Erreur login:", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Refresh token ───────────────────────────────────────────────────
router.post("/refresh", async (req, res) => {
  const header = req.headers["authorization"];
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Token manquant" });
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    const dbUser  = await get(`SELECT role FROM users WHERE id = ?`, [payload.id]);
    const role    = dbUser?.role || "user";
    const newToken = jwt.sign(
      { id: payload.id, username: payload.username, role },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );
    res.json({ token: newToken, role });
  } catch {
    res.status(401).json({ error: "Token invalide ou expiré" });
  }
});

// ─── Rôle courant (sync après changement admin) ──────────────────────
router.get("/me", verifyToken, async (req, res) => {
  try {
    const user = await get(`SELECT role FROM users WHERE id = ?`, [req.user.id]);
    res.json({ role: user?.role || "user" });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Mot de passe oublié ─────────────────────────────────────────────
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: "Email requis" });

  // Toujours répondre success pour ne pas révéler si l'email existe
  res.json({ success: true });

  try {
    const user = await get(`SELECT id, username FROM users WHERE email = ?`, [email.trim().toLowerCase()]);
    if (!user) return;

    const token  = crypto.randomBytes(32).toString("hex");
    const expiry = Date.now() + 60 * 60 * 1000; // 1 heure

    // Invalider les anciens tokens de cet utilisateur
    await run(`UPDATE reset_tokens SET used = 1 WHERE user_id = ? AND used = 0`, [user.id]);
    await run(`INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?,?,?)`, [user.id, token, expiry]);

    const resetUrl = `${APP_URL}/?reset_token=${token}`;

    await transporter.sendMail({
      from:    `"PokéTraining" <${process.env.SMTP_USER}>`,
      to:      email.trim(),
      subject: "Réinitialisation de ton mot de passe PokéTraining",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0a0a1a;color:#fff;border-radius:12px;overflow:hidden">
          <div style="background:#CC0000;padding:20px;text-align:center">
            <img src="${APP_URL}/assets/icons/pokeball.png" width="48" style="margin-bottom:8px" />
            <h1 style="font-size:18px;margin:0;letter-spacing:2px">POKÉTRAINING</h1>
          </div>
          <div style="padding:28px">
            <p style="margin-top:0">Bonjour <strong>${user.username}</strong>,</p>
            <p>Tu as demandé à réinitialiser ton mot de passe. Clique sur le bouton ci-dessous :</p>
            <div style="text-align:center;margin:28px 0">
              <a href="${resetUrl}" style="background:#CC0000;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
                ▶ Réinitialiser mon mot de passe
              </a>
            </div>
            <p style="font-size:13px;color:#aaa">Ce lien est valable <strong>1 heure</strong>. Si tu n'as pas fait cette demande, ignore cet email.</p>
          </div>
          <div style="background:#111;padding:12px;text-align:center;font-size:11px;color:#555">
            PokéTraining · Génération I
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error("Erreur forgot-password:", err);
  }
});

// ─── Réinitialiser le mot de passe ───────────────────────────────────
router.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: "Token et nouveau mot de passe requis" });
  if (newPassword.length < 8 || newPassword.length > 72)
    return res.status(400).json({ error: "Mot de passe entre 8 et 72 caractères" });

  try {
    const row = await get(
      `SELECT * FROM reset_tokens WHERE token = ? AND used = 0 AND expires_at > ?`,
      [token, Date.now()]
    );
    if (!row) return res.status(400).json({ error: "Lien invalide ou expiré" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await run(`UPDATE users SET password = ? WHERE id = ?`, [hashed, row.user_id]);
    await run(`UPDATE reset_tokens SET used = 1 WHERE id = ?`, [row.id]);

    res.json({ success: true });
  } catch (err) {
    console.error("Erreur reset-password:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Mettre à jour l'email (authentifié) ────────────────────────────
router.post("/user/update-email", verifyToken, async (req, res) => {
  const { email } = req.body;
  const userId = req.user.id;

  if (!email?.trim()) {
    // Permettre de supprimer l'email
    await run(`UPDATE users SET email = NULL WHERE id = ?`, [userId]);
    return res.json({ success: true, email: null });
  }

  const cleaned = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleaned)) return res.status(400).json({ error: "Email invalide" });

  try {
    await run(`UPDATE users SET email = ? WHERE id = ?`, [cleaned, userId]);
    res.json({ success: true, email: cleaned });
  } catch (err) {
    if (err.message?.includes("UNIQUE")) return res.status(400).json({ error: "Cet email est déjà utilisé" });
    console.error("Erreur update-email:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Changer le mot de passe (authentifié) ──────────────────────────
router.post("/user/change-password", verifyToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Tous les champs sont requis" });
  if (newPassword.length < 8 || newPassword.length > 72)
    return res.status(400).json({ error: "Nouveau mot de passe entre 8 et 72 caractères" });

  try {
    const user = await get(`SELECT password FROM users WHERE id = ?`, [userId]);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(400).json({ error: "Mot de passe actuel incorrect" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await run(`UPDATE users SET password = ? WHERE id = ?`, [hashed, userId]);

    res.json({ success: true });
  } catch (err) {
    console.error("Erreur change-password:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Récupérer l'email de l'utilisateur connecté ────────────────────
router.get("/user/email", verifyToken, async (req, res) => {
  try {
    const user = await get(`SELECT email FROM users WHERE id = ?`, [req.user.id]);
    res.json({ email: user?.email || null });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Avatar ──────────────────────────────────────────────────────────
router.post("/user/avatar", verifyToken, async (req, res) => {
  const { avatar } = req.body;
  if (!avatar || typeof avatar !== "string")
    return res.status(400).json({ error: "Données invalides" });
  if (!avatar.startsWith("data:image/jpeg;base64,") && !avatar.startsWith("data:image/png;base64,"))
    return res.status(400).json({ error: "Format non supporté (JPEG/PNG requis)" });
  if (avatar.length > 400000) // ~300KB base64 max
    return res.status(400).json({ error: "Image trop volumineuse (300KB max)" });
  try {
    await run(`UPDATE users SET avatar = ? WHERE id = ?`, [avatar, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Erreur avatar:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/user/avatar", verifyToken, async (req, res) => {
  try {
    const user = await get(`SELECT avatar FROM users WHERE id = ?`, [req.user.id]);
    res.json({ avatar: user?.avatar || null });
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Vérification d'email ────────────────────────────────────────────
router.get("/verify-email", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token manquant" });
  try {
    const row = await get(
      `SELECT * FROM email_verification_tokens WHERE token = ? AND used = 0 AND expires_at > ?`,
      [token, Date.now()]
    );
    if (!row) return res.status(400).json({ error: "Lien invalide ou expiré" });
    await run(`UPDATE users SET email_verified = 1 WHERE id = ?`, [row.user_id]);
    await run(`UPDATE email_verification_tokens SET used = 1 WHERE id = ?`, [row.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Erreur verify-email:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ─── Renvoyer l'email de vérification ───────────────────────────────
router.post("/resend-verify", verifyToken, async (req, res) => {
  try {
    const user = await get(`SELECT username, email, email_verified FROM users WHERE id = ?`, [req.user.id]);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    if (user.email_verified) return res.status(400).json({ error: "Email déjà vérifié" });
    if (!user.email) return res.status(400).json({ error: "Aucun email associé au compte" });
    await run(`UPDATE email_verification_tokens SET used = 1 WHERE user_id = ? AND used = 0`, [req.user.id]);
    const verifyToken  = crypto.randomBytes(32).toString("hex");
    const verifyExpiry = Date.now() + 24 * 60 * 60 * 1000;
    await run(
      `INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?,?,?)`,
      [req.user.id, verifyToken, verifyExpiry]
    );
    const verifyUrl = `${APP_URL}/?verify_token=${verifyToken}`;
    await sendVerificationEmail(user.email, user.username, verifyUrl);
    res.json({ success: true });
  } catch (err) {
    console.error("Erreur resend-verify:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
