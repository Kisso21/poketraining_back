import { Router } from "express";
import { run, get } from "../db.js";
import { getIO } from "../socket.js";
import https from "https";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Récompense identique au client (GameBase.calcReward) — max 500. Le serveur fait foi.
const calcReward = (score) => score >= 100 ? 500 : score <= 0 ? 0 : Math.round(400 * score / 90);

// Jeux « à secret » : la victoire est VÉRIFIÉE par le serveur (comparaison de la
// proposition envoyée par le client avec le secret déjà stocké), au lieu de faire
// confiance au flag `won` du client. Couvre les 8 jeux où correct = guess === secret.
const SECRET_GAMES = new Set(["ombre", "cri", "devinette", "pixel", "palette", "carte", "atq", "text"]);
const normalizeGuess = (v) => String(v ?? "").trim().toLowerCase();

export const FR_TO_CRY_ID = {
  "Bulbizarre":1,"Herbizarre":2,"Florizarre":3,"Salamèche":4,"Reptincel":5,"Dracaufeu":6,
  "Carapuce":7,"Carabaffe":8,"Tortank":9,"Chenipan":10,"Chrysacier":11,"Papilusion":12,
  "Aspicot":13,"Coconfort":14,"Dardargnan":15,"Roucool":16,"Roucoups":17,"Roucarnage":18,
  "Rattata":19,"Rattatac":20,"Piafabec":21,"Rapasdepic":22,"Abo":23,"Arbok":24,
  "Pikachu":25,"Raichu":26,"Sabelette":27,"Sablaireau":28,"Nidoran♀":29,"Nidorina":30,
  "Nidoqueen":31,"Nidoran♂":32,"Nidorino":33,"Nidoking":34,"Mélofée":35,"Mélodelfe":36,
  "Goupix":37,"Feunard":38,"Rondoudou":39,"Grodoudou":40,"Nosferapti":41,"Nosferalto":42,
  "Mystherbe":43,"Ortide":44,"Rafflesia":45,"Paras":46,"Parasect":47,"Mimitoss":48,
  "Aéromite":49,"Taupiqueur":50,"Triopikeur":51,"Miaouss":52,"Persian":53,"Psykokwak":54,
  "Akwakwak":55,"Férosinge":56,"Colossinge":57,"Caninos":58,"Arcanin":59,"Ptitard":60,
  "Têtarte":61,"Tartard":62,"Abra":63,"Kadabra":64,"Alakazam":65,"Machoc":66,
  "Machopeur":67,"Mackogneur":68,"Chétiflor":69,"Boustiflor":70,"Empiflor":71,
  "Tentacool":72,"Tentacruel":73,"Racaillou":74,"Gravalanch":75,"Grolem":76,
  "Ponyta":77,"Galopa":78,"Ramoloss":79,"Flagadoss":80,"Magnéti":81,"Magnéton":82,
  "Canarticho":83,"Doduo":84,"Dodrio":85,"Otaria":86,"Lamantine":87,"Tadmorv":88,
  "Grotadmorv":89,"Kokiyas":90,"Crustabri":91,"Fantominus":92,"Spectrum":93,"Ectoplasma":94,
  "Onix":95,"Soporifik":96,"Hypnomade":97,"Krabby":98,"Krabboss":99,"Voltorbe":100,
  "Électrode":101,"Noeunoeuf":102,"Noadkoko":103,"Osselait":104,"Ossatueur":105,
  "Kicklee":106,"Tygnon":107,"Excelangue":108,"Smogo":109,"Smogogo":110,"Rhinocorne":111,
  "Rhinoféros":112,"Leveinard":113,"Saquedeneu":114,"Kangourex":115,"Hypotrempe":116,
  "Hypocéan":117,"Poissirène":118,"Poissoroy":119,"Stari":120,"Staross":121,"M. Mime":122,
  "Insécateur":123,"Lippoutou":124,"Élektek":125,"Magmar":126,"Scarabrute":127,"Tauros":128,
  "Magicarpe":129,"Léviator":130,"Lokhlass":131,"Métamorph":132,"Évoli":133,"Aquali":134,
  "Voltali":135,"Pyroli":136,"Porygon":137,"Amonita":138,"Amonistar":139,"Kabuto":140,
  "Kabutops":141,"Ptéra":142,"Ronflex":143,"Artikodin":144,"Électhor":145,"Sulfura":146,
  "Minidraco":147,"Draco":148,"Dracolosse":149,"Mewtwo":150,"Mew":151,
  "Germignon":152,"Macronium":153,"Méganium":154,"Héricendre":155,"Feurisson":156,"Typhlosion":157,
  "Kaiminus":158,"Crocrodil":159,"Aligatueur":160,"Fouinette":161,"Fouinar":162,
  "Hoothoot":163,"Noarfang":164,"Coxy":165,"Coxyclaque":166,"Mimigal":167,"Migalos":168,
  "Nostenfer":169,"Loupio":170,"Lanturn":171,"Pichu":172,"Mélo":173,"Toudoudou":174,
  "Togepi":175,"Togetic":176,"Natu":177,"Xatu":178,"Wattouat":179,"Lainergie":180,
  "Pharamp":181,"Joliflor":182,"Marill":183,"Azumarill":184,"Simularbre":185,"Tarpaud":186,
  "Granivol":187,"Floravol":188,"Cotovol":189,"Capumain":190,"Tournegrin":191,"Héliatronc":192,
  "Yanma":193,"Axoloto":194,"Maraiste":195,"Mentali":196,"Noctali":197,"Cornèbre":198,
  "Roigada":199,"Feuforêve":200,"Zarbi":201,"Qulbutoké":202,"Girafarig":203,"Pomdepik":204,
  "Foretress":205,"Insolourdo":206,"Scorplane":207,"Steelix":208,"Snubbull":209,"Granbull":210,
  "Qwilfish":211,"Cizayox":212,"Caratroc":213,"Scarhino":214,"Farfuret":215,"Teddiursa":216,
  "Ursaring":217,"Limagma":218,"Volcaropod":219,"Marcacrin":220,"Cochignon":221,"Corayon":222,
  "Rémoraid":223,"Octillery":224,"Cadoizo":225,"Démanta":226,"Airmure":227,"Malosse":228,
  "Démolosse":229,"Hyporoi":230,"Phanpy":231,"Donphan":232,"Porygon2":233,"Cerfrousse":234,
  "Queulorior":235,"Debugant":236,"Kapoera":237,"Lippouti":238,"Élekid":239,"Magby":240,
  "Écrémeuh":241,"Leuphorie":242,"Raikou":243,"Entei":244,"Suicune":245,"Embrylex":246,
  "Ymphect":247,"Tyranocif":248,"Lugia":249,"Ho-Oh":250,"Celebi":251,
};

// Complète le mapping avec les noms FR → id national des Gen 3 & 4 (cris disponibles
// pour toutes les générations). Chargé depuis le fichier de données du front.
try {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const gen34 = JSON.parse(readFileSync(join(__dir, "../../html/data/gen3_4.json"), "utf8"));
  for (const p of gen34) {
    const name = p.name || p.nom;
    if (name && p.id && !FR_TO_CRY_ID[name]) FR_TO_CRY_ID[name] = p.id;
  }
} catch { /* fichier indisponible : on garde le mapping gen 1-2 */ }

const router = Router();
const COOLDOWN_MS = 30 * 60 * 1000;
const VALID_GAME_TYPES = new Set(["pixel","atq","carte","text","galop","ombre","devinette","palette","cri","pokecharlie","pokeclick","safari","anagramme","dessin","memory","radar","stop"]);

router.post("/game-state/:userId/:gameType", async (req, res) => {
  const { gameType } = req.params;
  const { state } = req.body;
  if (!state) return res.status(400).json({ error: "Paramètres manquants" });
  if (!VALID_GAME_TYPES.has(gameType)) return res.status(400).json({ error: "Type de jeu invalide" });

  try {
    await run(
      `INSERT INTO game_states (user_id, game_type, state)
       VALUES (?,?,?)
       ON CONFLICT(user_id, game_type)
       DO UPDATE SET state = excluded.state, updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, gameType, JSON.stringify(state)]
    );
    if (state.finished === true) {
      await run(
        `UPDATE users SET last_game_type = ?, last_game_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [gameType, req.user.id]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/game-state/:userId/:gameType", async (req, res) => {
  const { gameType } = req.params;
  if (!VALID_GAME_TYPES.has(gameType)) return res.status(400).json({ error: "Type de jeu invalide" });
  try {
    const row = await get("SELECT state FROM game_states WHERE user_id = ? AND game_type = ?", [req.user.id, gameType]);
    if (!row) return res.json({ success: false, state: null });
    const state = JSON.parse(row.state);
    res.json({ success: true, state });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.get("/game/canplay/:userId/:gameType", async (req, res) => {
  const { gameType } = req.params;
  if (!VALID_GAME_TYPES.has(gameType)) return res.status(400).json({ error: "Type de jeu invalide" });
  try {
    const row = await get(`SELECT next_available_at, state FROM game_states WHERE user_id = ? AND game_type = ?`, [req.user.id, gameType]);
    if (!row) return res.json({ canPlay: true, inProgress: false });

    const now  = Date.now();
    const next = row.next_available_at ? new Date(row.next_available_at).getTime() : 0;
    let inProgress = false;
    try { inProgress = JSON.parse(row.state || "{}").finished === false; } catch {}

    if (now < next) {
      return res.json({ canPlay: false, inProgress, remaining: Math.ceil((next - now) / 1000), nextAvailableAt: row.next_available_at });
    }
    res.json({ canPlay: true, inProgress, nextAvailableAt: null });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/game/reset", async (req, res) => {
  const { gameType } = req.body;
  if (!gameType) return res.status(400).json({ error: "Paramètres manquants" });
  if (!VALID_GAME_TYPES.has(gameType)) return res.status(400).json({ error: "Type de jeu invalide" });

  const userId = req.user.id;
  let score    = Number(req.body.score);
  if (!Number.isFinite(score)) score = 0;
  score = Math.max(0, Math.min(100, Math.round(score)));

  try {
    const existing = await get(
      `SELECT next_available_at, reward_claimed, state FROM game_states WHERE user_id = ? AND game_type = ?`,
      [userId, gameType]
    );
    const alreadyActive = existing?.next_available_at && new Date(existing.next_available_at) > new Date();

    // Détermination de la victoire. Pour les jeux à secret, le SERVEUR fait foi :
    // il compare la proposition (req.body.guess) au secret déjà enregistré dans le state.
    // Le flag `won` du client n'est plus pris en compte pour ces jeux.
    let won = req.body.won === true;
    if (SECRET_GAMES.has(gameType)) {
      let storedSecret = null;
      try { storedSecret = JSON.parse(existing?.state || "{}").secret; } catch { /* state illisible */ }
      if (storedSecret) {
        won = normalizeGuess(req.body.guess) !== "" &&
              normalizeGuess(req.body.guess) === normalizeGuess(storedSecret);
      }
      // Si aucun secret n'est stocké (cas limite : state perdu), on retombe sur le `won` client.
    }

    // Une nouvelle fenêtre de cooldown rouvre le droit à UNE récompense (reward_claimed=0).
    // Tant que la fenêtre est active, le gain ne peut être encaissé qu'une seule fois.
    // Rejouer la requête → reward_claimed déjà à 1 → aucun gain. Le client ne peut donc
    // plus se créditer à volonté (faille d'argent illimité fermée), et le montant est
    // calculé par le serveur (calcReward), pas dicté par le client.
    if (!alreadyActive) {
      const nextAvailableAt = new Date(Date.now() + COOLDOWN_MS).toISOString();
      await run(
        `INSERT INTO game_states (user_id, game_type, state, next_available_at, reward_claimed)
         VALUES (?,?,?,?,0)
         ON CONFLICT(user_id, game_type)
         DO UPDATE SET next_available_at = excluded.next_available_at, reward_claimed = 0, updated_at = CURRENT_TIMESTAMP`,
        [userId, gameType, JSON.stringify({ reset: true }), nextAvailableAt]
      );
    }

    let reward = 0;
    const claimed = alreadyActive ? (existing?.reward_claimed ? 1 : 0) : 0;
    if (won && score > 0 && claimed === 0) {
      const base      = calcReward(score);
      const ts        = await get(`SELECT stat_tresorier FROM trainer_stats WHERE user_id = ?`, [userId]);
      const tresorier = ts?.stat_tresorier || 0;
      const lucky     = await get(`SELECT active FROM user_passives WHERE user_id = ? AND item = 'luckycoin'`, [userId]);
      // Passif Arène Élite : +10 ₽/jeu par arène de gen 3/4 vaincue
      const uname     = await get(`SELECT username FROM users WHERE id = ?`, [userId]);
      const eliteRow  = uname ? await get(
        `SELECT COUNT(*) AS n FROM user_arenes WHERE username = ? AND defeated = 1 AND arene IN
         ('roxanne','bastien','voltere','adriane','norman','alizee','levytatia','marc',
          'pierrick','flo','melina','lovis','kimera','charles','gladys','tanguy')`,
        [uname.username]
      ) : null;
      const eliteBonus = (eliteRow?.n || 0) * 10;
      let gain = base + tresorier * 3 + eliteBonus;
      if (lucky?.active === 1) gain = Math.round(gain * 1.25);
      if (gain > 0) {
        await run(`UPDATE inventory SET pokedollars = COALESCE(pokedollars,0) + ? WHERE user_id = ?`, [gain, userId]);
        await run(`UPDATE game_states SET reward_claimed = 1 WHERE user_id = ? AND game_type = ?`, [userId, gameType]);
        reward = gain;
        const inv = await get(`SELECT pokedollars FROM inventory WHERE user_id = ?`, [userId]);
        getIO()?.emit("sync:inventory", { userId, inventory: { pokedollars: inv?.pokedollars ?? 0 } });
      }
    }
    const row = await get(`SELECT next_available_at FROM game_states WHERE user_id = ? AND game_type = ?`, [userId, gameType]);
    res.json({ success: true, nextAvailableAt: row?.next_available_at || null, reward });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

router.post("/game/unlockAll", async (req, res) => {
  try {
    await run(`UPDATE game_states SET next_available_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`, [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Proxy audio cri — public car new Audio() ne peut pas envoyer de header Authorization
router.get("/cry/:userId/:gameType", async (req, res) => {
  const { userId, gameType } = req.params;
  const resolvedUserId = req.user?.id ?? userId;
  try {
    const row = await get("SELECT state FROM game_states WHERE user_id = ? AND game_type = ?", [resolvedUserId, gameType]);
    if (!row) return res.status(404).json({ error: "Partie non trouvée" });
    const state = JSON.parse(row.state || "{}");
    const pokemonName = state.secret;
    if (!pokemonName) return res.status(404).json({ error: "Pokémon non trouvé" });
    // Priorité à l'id sauvegardé (toutes générations) ; fallback sur le mapping gen 1-2.
    const id = state.secretId || FR_TO_CRY_ID[pokemonName];
    if (!id) return res.status(404).json({ error: "Cri non disponible" });
    const url = `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${id}.ogg`;
    https.get(url, (upstream) => {
      if (upstream.statusCode !== 200) return res.status(502).json({ error: "Cri indisponible" });
      res.setHeader("Content-Type", "audio/ogg");
      res.setHeader("Cache-Control", "no-store");
      upstream.pipe(res);
    }).on("error", () => res.status(502).json({ error: "Erreur réseau" }));
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
