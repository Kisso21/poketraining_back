import nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

export async function sendVerificationEmail(to, username, verifyUrl) {
  const APP_URL = process.env.APP_URL || "https://poketraining.fr";
  await transporter.sendMail({
    from:    `"PokéTraining" <${process.env.SMTP_USER}>`,
    to,
    subject: `Confirme ton email PokéTraining, ${username} !`,
    html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;background:#111;font-family:Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#06060f;color:#fff;border-radius:14px;overflow:hidden;border:1px solid rgba(204,0,0,0.35)">
  <div style="background:linear-gradient(135deg,#CC0000 0%,#880000 100%);padding:28px 24px;text-align:center">
    <h1 style="font-size:22px;margin:0 0 4px;letter-spacing:3px;color:#fff;font-weight:900">POKÉTRAINING</h1>
    <p style="font-size:11px;margin:0;color:rgba(255,255,255,0.55);letter-spacing:2px">GEN I &amp; II · 251 POKÉMON</p>
  </div>
  <div style="height:3px;background:linear-gradient(90deg,transparent,#E8C840,transparent)"></div>
  <div style="padding:32px 28px">
    <p style="margin-top:0;font-size:16px;line-height:1.5">Bienvenue, <strong style="color:#E8C840">${username}</strong> !</p>
    <p style="color:rgba(255,255,255,0.7);line-height:1.75;font-size:14px">Clique sur le bouton ci-dessous pour confirmer ton adresse email.</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${verifyUrl}" style="background:linear-gradient(135deg,#CC0000,#990000);color:#fff;padding:15px 40px;border-radius:8px;text-decoration:none;font-weight:900;font-size:13px;display:inline-block;letter-spacing:1.5px">✓ CONFIRMER MON EMAIL</a>
    </div>
    <p style="font-size:12px;color:rgba(255,255,255,0.4);line-height:1.8">Ce lien est valable <strong style="color:rgba(255,255,255,0.6)">24 heures</strong>.</p>
  </div>
  <div style="background:rgba(0,0,0,0.5);padding:14px 20px;text-align:center;font-size:11px;color:rgba(255,255,255,0.18);border-top:1px solid rgba(255,255,255,0.05)">
    PokéTraining &nbsp;·&nbsp; <a href="${APP_URL}" style="color:rgba(204,0,0,0.5);text-decoration:none">poketraining.fr</a>
  </div>
</div>
</body>
</html>
    `,
  });
}

export async function sendWelcomeEmail(to, username) {
  const APP_URL = process.env.APP_URL || "https://poketraining.fr";
  await transporter.sendMail({
    from:    `"PokéTraining" <${process.env.SMTP_USER}>`,
    to,
    subject: `Bienvenue sur PokéTraining, ${username} !`,
    html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:20px;background:#111;font-family:Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#06060f;color:#fff;border-radius:14px;overflow:hidden;border:1px solid rgba(204,0,0,0.35)">

  <div style="background:linear-gradient(135deg,#CC0000 0%,#880000 100%);padding:28px 24px;text-align:center">
    <img src="${APP_URL}/assets/icons/pokeball.png" width="60" alt="" style="margin-bottom:12px;filter:drop-shadow(0 0 14px rgba(255,255,255,0.45))" />
    <h1 style="font-size:22px;margin:0 0 4px;letter-spacing:3px;color:#fff;font-weight:900">POKÉTRAINING</h1>
    <p style="font-size:11px;margin:0;color:rgba(255,255,255,0.55);letter-spacing:2px">GEN I &amp; II · 251 POKÉMON</p>
  </div>

  <div style="height:3px;background:linear-gradient(90deg,transparent,#E8C840,transparent)"></div>

  <div style="padding:32px 28px">
    <p style="margin-top:0;font-size:16px;line-height:1.5">
      Bienvenue, <strong style="color:#E8C840">${username}</strong>&nbsp;! 🎉
    </p>
    <p style="color:rgba(255,255,255,0.7);line-height:1.75;font-size:14px">
      Ton compte PokéTraining a bien été créé. Tu fais maintenant partie de la communauté des Dresseurs !
    </p>

    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(232,200,64,0.18);border-radius:10px;padding:18px 22px;margin:24px 0">
      <p style="margin:0 0 10px;font-size:10px;color:rgba(232,200,64,0.65);letter-spacing:2.5px;font-weight:bold">TON COMPTE</p>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:5px 0;font-size:13px;color:rgba(255,255,255,0.5);width:130px">Nom de Dresseur</td>
          <td style="padding:5px 0;font-size:14px;font-weight:bold;color:#fff">${username}</td>
        </tr>
        <tr>
          <td style="padding:5px 0;font-size:13px;color:rgba(255,255,255,0.5)">Email</td>
          <td style="padding:5px 0;font-size:13px;color:rgba(255,255,255,0.6)">${to}</td>
        </tr>
      </table>
    </div>

    <p style="color:rgba(255,255,255,0.7);line-height:1.75;font-size:14px;margin-bottom:8px">Ce qui t'attend :</p>
    <ul style="color:rgba(255,255,255,0.65);line-height:2.1;padding-left:22px;margin:0 0 28px;font-size:13px">
      <li>🎮 <strong style="color:#fff">10+ mini-jeux</strong> Pokémon à relever chaque jour</li>
      <li>✨ Pokémon <strong style="color:#fff">Shiny</strong> rares à capturer dans le Pokédex</li>
      <li>📈 Progression jusqu'au <strong style="color:#fff">niveau 100</strong></li>
      <li>🏆 Arènes, succès, Safari, Casino et bien plus</li>
    </ul>

    <div style="text-align:center;margin:28px 0 20px">
      <a href="${APP_URL}"
         style="background:linear-gradient(135deg,#CC0000,#990000);color:#fff;padding:15px 40px;border-radius:8px;text-decoration:none;font-weight:900;font-size:13px;display:inline-block;letter-spacing:1.5px;box-shadow:0 4px 20px rgba(204,0,0,0.45)">
        ▶ COMMENCER L'AVENTURE
      </a>
    </div>

    <p style="font-size:12px;color:rgba(255,255,255,0.25);text-align:center;margin:0">
      Merci de nous rejoindre dans cette aventure Pokémon !&nbsp;&nbsp;🔴⚪
    </p>
  </div>

  <div style="background:rgba(0,0,0,0.5);padding:14px 20px;text-align:center;font-size:11px;color:rgba(255,255,255,0.18);border-top:1px solid rgba(255,255,255,0.05)">
    PokéTraining &nbsp;·&nbsp;
    <a href="${APP_URL}" style="color:rgba(204,0,0,0.5);text-decoration:none">poketraining.fr</a><br>
    <span style="font-size:10px">Cet email t'a été envoyé suite à la création de ton compte.</span>
  </div>

</div>
</body>
</html>
    `,
  });
}
