import sqlite3 from "sqlite3";
import process from "process";

const DB_PATH = process.env.DB_PATH || "./users.db";
export const db = new sqlite3.Database(DB_PATH);

// WAL mode : lectures concurrentes sans bloquer les écritures
db.run("PRAGMA journal_mode=WAL");
db.run("PRAGMA busy_timeout=5000");  // attend 5s si la DB est verrouillée
db.run("PRAGMA synchronous=NORMAL"); // perf sans sacrifier la durabilité

export const GEN1_POKEMONS = [
  "Bulbizarre","Herbizarre","Florizarre","Salamèche","Reptincel","Dracaufeu",
  "Carapuce","Carabaffe","Tortank","Chenipan","Chrysacier","Papilusion",
  "Aspicot","Coconfort","Dardargnan","Roucool","Roucoups","Roucarnage",
  "Rattata","Rattatac","Piafabec","Rapasdepic","Abo","Arbok","Pikachu","Raichu",
  "Sabelette","Sablaireau","Nidoran♀","Nidorina","Nidoqueen","Nidoran♂","Nidorino","Nidoking",
  "Mélofée","Mélodelfe","Goupix","Feunard","Rondoudou","Grodoudou",
  "Nosferapti","Nosferalto","Mystherbe","Ortide","Rafflesia","Paras","Parasect",
  "Mimitoss","Aéromite","Taupiqueur","Triopikeur","Miaouss","Persian",
  "Psykokwak","Akwakwak","Férosinge","Colossinge","Caninos","Arcanin",
  "Ptitard","Têtarte","Tartard","Abra","Kadabra","Alakazam",
  "Machoc","Machopeur","Mackogneur","Chétiflor","Boustiflor","Empiflor",
  "Tentacool","Tentacruel","Racaillou","Gravalanch","Grolem","Ponyta","Galopa",
  "Ramoloss","Flagadoss","Magnéti","Magnéton","Canarticho","Doduo","Dodrio",
  "Otaria","Lamantine","Tadmorv","Grotadmorv","Kokiyas","Crustabri",
  "Fantominus","Spectrum","Ectoplasma","Onix","Soporifik","Hypnomade",
  "Krabby","Krabboss","Voltorbe","Électrode","Noeunoeuf","Noadkoko",
  "Osselait","Ossatueur","Kicklee","Tygnon","Excelangue","Smogo","Smogogo",
  "Rhinocorne","Rhinoféros","Leveinard","Saquedeneu","Kangourex",
  "Hypotrempe","Hypocéan","Poissirène","Poissoroy","Stari","Staross",
  "M. Mime","Insécateur","Lippoutou","Élektek","Magmar","Scarabrute","Tauros",
  "Magicarpe","Léviator","Lokhlass","Métamorph","Évoli","Aquali","Voltali","Pyroli",
  "Porygon","Amonita","Amonistar","Kabuto","Kabutops","Ptéra","Ronflex",
  "Artikodin","Électhor","Sulfura","Minidraco","Draco","Dracolosse","Mewtwo","Mew",
];

export const GEN2_POKEMONS = [
  "Germignon","Macronium","Méganium","Héricendre","Feurisson","Typhlosion",
  "Kaiminus","Crocrodil","Aligatueur","Fouinette","Fouinar",
  "Hoothoot","Noarfang","Coxy","Coxyclaque","Mimigal","Migalos",
  "Nostenfer","Loupio","Lanturn","Pichu","Mélo","Toudoudou",
  "Togepi","Togetic","Natu","Xatu","Wattouat","Lainergie","Pharamp",
  "Joliflor","Marill","Azumarill","Simularbre","Tarpaud",
  "Granivol","Floravol","Cotovol","Capumain","Tournegrin","Héliatronc",
  "Yanma","Axoloto","Maraiste","Mentali","Noctali","Cornèbre",
  "Roigada","Feuforêve","Zarbi","Qulbutoké","Girafarig","Pomdepik",
  "Foretress","Insolourdo","Scorplane","Steelix","Snubbull","Granbull",
  "Qwilfish","Cizayox","Caratroc","Scarhino","Farfuret",
  "Teddiursa","Ursaring","Limagma","Volcaropod","Marcacrin","Cochignon",
  "Corayon","Rémoraid","Octillery","Cadoizo","Démanta","Airmure",
  "Malosse","Démolosse","Hyporoi","Phanpy","Donphan","Porygon2",
  "Cerfrousse","Queulorior","Debugant","Kapoera","Lippouti",
  "Élekid","Magby","Écrémeuh","Leuphorie",
  "Raikou","Entei","Suicune","Embrylex","Ymphect","Tyranocif",
  "Lugia","Ho-Oh","Celebi",
];

export const GEN3_POKEMONS = [
  "Arcko","Massko","Jungko","Poussifeu","Galifeu","Braségali","Gobou","Flobio",
  "Laggron","Medhyèna","Grahyèna","Zigzaton","Linéon","Chenipotte","Armulys",
  "Charmillon","Blindalys","Papinox","Nénupiot","Lombre","Ludicolo","Grainipiot",
  "Pifeuil","Tengalice","Nirondelle","Hélédelle","Goélise","Bekipan","Tarsal",
  "Kirlia","Gardevoir","Arakdo","Maskadra","Balignon","Chapignon","Parecool",
  "Vigoroth","Monaflèmit","Ningale","Ninjask","Munja","Chuchmur","Ramboum",
  "Brouhabam","Makuhita","Hariyama","Azurill","Tarinor","Skitty","Delcatty",
  "Ténéfix","Mysdibule","Galekid","Galegon","Galeking","Méditikka","Charmina",
  "Dynavolt","Élecsprint","Posipi","Négapi","Muciole","Lumivole","Rosélia",
  "Gloupti","Avaltout","Carvanha","Sharpedo","Wailmer","Wailord","Chamallot",
  "Camérupt","Chartor","Spoink","Groret","Spinda","Kraknoix","Vibraninf","Libégon",
  "Cacnea","Cacturne","Tylton","Altaria","Mangriff","Séviper","Séléroc","Solaroc",
  "Barloche","Barbicha","Écrapince","Colhomard","Balbuto","Kaorine","Lilia",
  "Vacilys","Anorith","Armaldo","Barpau","Milobellus","Morphéo","Kecleon",
  "Polichombr","Branette","Skelénox","Téraclope","Tropius","Éoko","Absol","Okéoké",
  "Stalgamin","Oniglali","Obalie","Phogleur","Kaimorse","Coquiperl","Serpang",
  "Rosabyss","Relicanth","Lovdisc","Draby","Drackhaus","Drattak","Terhal","Métang",
  "Métalosse","Regirock","Regice","Registeel","Latias","Latios","Kyogre","Groudon",
  "Rayquaza","Jirachi","Deoxys",
];

export const GEN4_POKEMONS = [
  "Tortipouss","Boskara","Torterra","Ouisticram","Chimpenfeu","Simiabraz",
  "Tiplouf","Prinplouf","Pingoléon","Étourmi","Étourvol","Étouraptor","Keunotor",
  "Castorno","Crikzik","Mélokrik","Lixy","Luxio","Luxray","Rozbouton","Roserade",
  "Kranidos","Charkos","Dinoclier","Bastiodon","Cheniti","Cheniselle","Papilord",
  "Apitrini","Apireine","Pachirisu","Mustébouée","Mustéflott","Ceribou","Ceriflor",
  "Sancoki","Tritosor","Capidextre","Baudrive","Grodrive","Laporeille","Lockpin",
  "Magirêve","Corboss","Chaglam","Chaffreux","Korillon","Moufouette","Moufflair",
  "Archéomire","Archéodong","Manzaï","Mime Jr.","Ptiravi","Pijako","Spiritomb",
  "Griknot","Carmache","Carchacrok","Goinfrex","Riolu","Lucario","Hippopotas",
  "Hippodocus","Rapion","Drascore","Cradopaud","Coatox","Vortente","Écayon",
  "Luminéon","Babimanta","Blizzi","Blizzaroi","Dimoret","Magnézone","Coudlangue",
  "Rhinastoc","Bouldeneu","Élekable","Maganon","Togekiss","Yanmega","Phyllali",
  "Givrali","Scorvol","Mammochon","Porygon-Z","Gallame","Tarinorme","Noctunoir",
  "Momartik","Motisma","Créhelf","Créfollet","Créfadet","Dialga","Palkia",
  "Heatran","Regigigas","Giratina","Cresselia","Phione","Manaphy","Darkrai",
  "Shaymin","Arceus",
];

export const PASSIVES = ["charmechroma","appat","luckycoin","glitch",
  "multiexp","corneabondance","supercharmechroma","superappat"];
export const BADGES   = [
  "Badge Roche","Badge Cascade","Badge Foudre","Badge Prisme","Badge Âme","Badge Marais","Badge Volcan",
  "Badge Zéphyr","Badge Essaim","Badge Plaine","Badge Brume","Badge Choc","Badge Minéral","Badge Glacier","Badge Lever",
];
export const ARENES   = [
  "pierre","ondine","bob","erika","koga","morgane","auguste",
  "albert","hector","blanche","mortimer","chuck","jasmine","fredo","sandra",
];

function dbRun(sql, params = []) {
  return new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));
}
function dbAll(sql, params = []) {
  return new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));
}

export async function initDB() {
  // Identité uniquement
  await dbRun(`CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    role       TEXT DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Colonne email (ajout rétrocompatible — SQLite interdit UNIQUE sur ALTER TABLE)
  try { await dbRun(`ALTER TABLE users ADD COLUMN email TEXT`); } catch {}
  try { await dbRun(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL`); } catch {}
  // Colonne avatar (base64 JPEG, ~30KB max)
  try { await dbRun(`ALTER TABLE users ADD COLUMN avatar TEXT`); } catch {}
  // Email vérifié — 1 pour les comptes existants, 0 pour les nouveaux
  try { await dbRun(`ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1`); } catch {}
  // Dernière connexion
  try { await dbRun(`ALTER TABLE users ADD COLUMN last_login TIMESTAMP`); } catch {}
  // Dernier jeu terminé
  try { await dbRun(`ALTER TABLE users ADD COLUMN last_game_type TEXT`); } catch {}
  try { await dbRun(`ALTER TABLE users ADD COLUMN last_game_at TIMESTAMP`); } catch {}

  // Tokens de vérification d'email (valides 24h)
  await dbRun(`CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    token      TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL,
    used       INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // Tokens de réinitialisation de mot de passe (valides 1h)
  await dbRun(`CREATE TABLE IF NOT EXISTS reset_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    token      TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL,
    used       INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  // Inventaire séparé — 1 ligne par joueur
  await dbRun(`CREATE TABLE IF NOT EXISTS inventory (
    user_id    INTEGER PRIMARY KEY,
    pokedollars INTEGER DEFAULT 0,
    pokeball    INTEGER DEFAULT 5,
    superball   INTEGER DEFAULT 0,
    hyperball   INTEGER DEFAULT 0,
    masterball  INTEGER DEFAULT 0,
    resetball   INTEGER DEFAULT 0,
    superbonbon INTEGER DEFAULT 0,
    potion      INTEGER DEFAULT 0,
    lootbox     INTEGER DEFAULT 0,
    ticketsafari  INTEGER DEFAULT 0,
    goldappat     INTEGER DEFAULT 0,
    sablier       INTEGER DEFAULT 0,
    charmeeclaire INTEGER DEFAULT 0,
    armed_pokemon TEXT,
    armed_shiny   INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  // Migrations rétrocompatibles (silencieux si déjà présentes)
  for (const col of [
    "ticketsafari INTEGER DEFAULT 0",
    "goldappat INTEGER DEFAULT 0",
    "sablier INTEGER DEFAULT 0",
    "charmeeclaire INTEGER DEFAULT 0",
    "armed_pokemon TEXT",
    "armed_shiny INTEGER DEFAULT 0",
  ]) {
    try { await dbRun(`ALTER TABLE inventory ADD COLUMN ${col}`); } catch {}
  }

  // Niveau et stats — 1 ligne par joueur
  await dbRun(`CREATE TABLE IF NOT EXISTS trainer_stats (
    user_id               INTEGER PRIMARY KEY,
    level                 INTEGER DEFAULT 1,
    xp                    INTEGER DEFAULT 0,
    stat_points_available INTEGER DEFAULT 0,
    stat_dresseur         INTEGER DEFAULT 0,
    stat_collectionneur   INTEGER DEFAULT 0,
    stat_tresorier        INTEGER DEFAULT 0,
    stat_legende          INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Captures — nommage snake_case cohérent
  await dbRun(`CREATE TABLE IF NOT EXISTS captures (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    pokemon_name TEXT NOT NULL,
    is_shiny     INTEGER NOT NULL DEFAULT 0 CHECK (is_shiny IN (0,1)),
    captured_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, pokemon_name, is_shiny),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Pokémon rencontrés en jeu (Pokédex "Vu mais non capturé" + compteur de vues)
  await dbRun(`CREATE TABLE IF NOT EXISTS pokemon_seen (
    user_id       INTEGER NOT NULL,
    pokemon_name  TEXT NOT NULL,
    seen_count    INTEGER NOT NULL DEFAULT 1,
    first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, pokemon_name),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  // Migration : compteur ajouté après coup (silencieux si déjà présent)
  try { await dbRun(`ALTER TABLE pokemon_seen ADD COLUMN seen_count INTEGER NOT NULL DEFAULT 1`); } catch {}

  // États de jeu — inchangé
  await dbRun(`CREATE TABLE IF NOT EXISTS game_states (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL,
    game_type        TEXT NOT NULL,
    state            TEXT NOT NULL,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    next_available_at TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(user_id, game_type)
  )`);
  // Récompense déjà encaissée pour la fenêtre de cooldown courante (anti double-crédit).
  try { await dbRun(`ALTER TABLE game_states ADD COLUMN reward_claimed INTEGER NOT NULL DEFAULT 0`); } catch {}

  // Succès — inchangé
  await dbRun(`CREATE TABLE IF NOT EXISTS achievements (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL,
    achievement_id TEXT NOT NULL,
    unlocked       INTEGER NOT NULL DEFAULT 0,
    claimed        INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(user_id, achievement_id)
  )`);

  // Passifs — user_id au lieu de username
  await dbRun(`CREATE TABLE IF NOT EXISTS user_passives (
    user_id  INTEGER NOT NULL,
    item     TEXT NOT NULL,
    unlocked INTEGER DEFAULT 0,
    active   INTEGER DEFAULT 0,
    PRIMARY KEY(user_id, item),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Durabilité des passifs (utilisée par Corne d'Abondance : 100, -5/lootbox, recharge quotidienne)
  try { await dbRun(`ALTER TABLE user_passives ADD COLUMN durability INTEGER NOT NULL DEFAULT 100`); } catch {}
  try { await dbRun(`ALTER TABLE user_passives ADD COLUMN durability_date TEXT`); } catch {}

  // Badges — user_id au lieu de username
  await dbRun(`CREATE TABLE IF NOT EXISTS user_badges (
    user_id       INTEGER NOT NULL,
    badge         TEXT NOT NULL,
    unlocked      INTEGER DEFAULT 0,
    date_obtained TEXT DEFAULT NULL,
    PRIMARY KEY(user_id, badge),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Arènes — gardé avec username (route existante inchangée côté URL)
  await dbRun(`CREATE TABLE IF NOT EXISTS user_arenes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL,
    arene         TEXT NOT NULL,
    unlocked      INTEGER DEFAULT 0,
    defeated      INTEGER DEFAULT 0,
    in_progress   INTEGER DEFAULT 0,
    last_try      TEXT DEFAULT NULL,
    progress_json TEXT DEFAULT '{}',
    UNIQUE(username, arene)
  )`);
  // Horodatage de la dernière victoire (conservé même après reset du cooldown)
  try { await dbRun(`ALTER TABLE user_arenes ADD COLUMN won_at TEXT DEFAULT NULL`); } catch {}

  // PokéClick upgrades
  await dbRun(`CREATE TABLE IF NOT EXISTS pokeclick_upgrades (
    user_id     INTEGER NOT NULL,
    upgrade_key TEXT NOT NULL,
    PRIMARY KEY(user_id, upgrade_key),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // PokéClick meta (autoclick timestamp)
  await dbRun(`CREATE TABLE IF NOT EXISTS pokeclick_meta (
    user_id          INTEGER PRIMARY KEY,
    autoclick_last_at TEXT DEFAULT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // PokéClick — endurance autoritative côté serveur (ancre {cur, ts} par Pokémon).
  // Empêche la triche : le client ne décide plus de son endurance.
  await dbRun(`CREATE TABLE IF NOT EXISTS pokeclick_stamina (
    user_id INTEGER NOT NULL,
    pokemon TEXT NOT NULL,
    cur     REAL NOT NULL,
    ts      INTEGER NOT NULL,
    PRIMARY KEY(user_id, pokemon),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Journal d'audit des actions globales admin (requêtes appliquées à tous les joueurs)
  await dbRun(`CREATE TABLE IF NOT EXISTS admin_global_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    admin      TEXT NOT NULL,
    op         TEXT NOT NULL,
    detail     TEXT,
    affected   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Historique drops PokéClick
  await dbRun(`CREATE TABLE IF NOT EXISTS pokeclick_drop_log (
    user_id INTEGER NOT NULL,
    date    TEXT NOT NULL,
    item    TEXT NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, date, item),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Farm quotidienne — inchangé
  await dbRun(`CREATE TABLE IF NOT EXISTS daily_farm (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date    TEXT NOT NULL,
    earned  REAL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(user_id, date)
  )`);

  // Gains généraux hors PokéClick (mini-jeux, casino, safari, bonus)
  await dbRun(`CREATE TABLE IF NOT EXISTS daily_rewards (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date    TEXT NOT NULL,
    earned  REAL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(user_id, date)
  )`);

  // Réserve de doublons (Pokémon déjà capturés, revendables)
  await dbRun(`CREATE TABLE IF NOT EXISTS pokemon_reserve (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    pokemon_name TEXT NOT NULL,
    is_shiny     INTEGER NOT NULL DEFAULT 0 CHECK (is_shiny IN (0,1)),
    caught_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // PokéTrade — annonces de vente et d'échange
  await dbRun(`CREATE TABLE IF NOT EXISTS pokemon_trades (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id         INTEGER NOT NULL,
    creator_username   TEXT NOT NULL,
    pokemon_name       TEXT NOT NULL,
    is_shiny           INTEGER NOT NULL DEFAULT 0,
    trade_type         TEXT NOT NULL CHECK (trade_type IN ('sale','exchange')),
    price              INTEGER,
    requested_pokemon  TEXT,
    requested_shiny    INTEGER DEFAULT 0,
    duration_days      INTEGER NOT NULL DEFAULT 1,
    status             TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','completed','expired','cancelled')),
    acceptor_id        INTEGER,
    acceptor_username  TEXT,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at         TIMESTAMP NOT NULL,
    completed_at       TIMESTAMP,
    FOREIGN KEY(creator_id) REFERENCES users(id)
  )`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_trades_status ON pokemon_trades(status)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_trades_creator ON pokemon_trades(creator_id)`);
  // Migration : colonne raison suppression admin (silencieux si déjà présente)
  try { await dbRun(`ALTER TABLE pokemon_trades ADD COLUMN admin_reason TEXT`); } catch {}

  // Notifications joueur (ventes/échanges PokéTrade, etc.)
  await dbRun(`CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    type        TEXT NOT NULL,
    message     TEXT NOT NULL,
    data        TEXT,
    is_read     INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read)`);

  // Événements en temps réel
  await dbRun(`CREATE TABLE IF NOT EXISTS events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    type             TEXT NOT NULL,
    title            TEXT NOT NULL,
    description      TEXT,
    reward_data      TEXT DEFAULT '{}',
    duration_seconds INTEGER,
    started_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ends_at          TIMESTAMP,
    claimed_by       INTEGER,
    claimed_at       TIMESTAMP,
    winner_username  TEXT,
    is_active        INTEGER DEFAULT 1,
    created_by       INTEGER,
    FOREIGN KEY(claimed_by) REFERENCES users(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  )`);

  // Index
  // Votes de sondage
  await dbRun(`CREATE TABLE IF NOT EXISTS poll_votes (
    event_id     INTEGER NOT NULL,
    user_id      INTEGER NOT NULL,
    option_index INTEGER NOT NULL,
    voted_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id, user_id),
    FOREIGN KEY (event_id) REFERENCES events(id),
    FOREIGN KEY (user_id)  REFERENCES users(id)
  )`);

  // Inscriptions au Tirage au Sort (événement admin)
  await dbRun(`CREATE TABLE IF NOT EXISTS tirage_entries (
    event_id  INTEGER NOT NULL,
    user_id   INTEGER NOT NULL,
    username  TEXT NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id, user_id),
    FOREIGN KEY (event_id) REFERENCES events(id),
    FOREIGN KEY (user_id)  REFERENCES users(id)
  )`);

  // Enchères (événement admin) — une seule ligne par enchère = la meilleure
  // offre courante. Les Pokédollars du meneur sont retenus (escrow) ; ils sont
  // remboursés s'il est surenchéri, ou définitivement dépensés s'il remporte le lot.
  await dbRun(`CREATE TABLE IF NOT EXISTS auction_bids (
    event_id  INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL,
    username  TEXT NOT NULL,
    amount    INTEGER NOT NULL,
    bid_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id),
    FOREIGN KEY (user_id)  REFERENCES users(id)
  )`);

  await dbRun(`CREATE INDEX IF NOT EXISTS idx_captures_user      ON captures(user_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_reserve_user       ON pokemon_reserve(user_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_game_states_user   ON game_states(user_id, game_type)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_daily_farm_user    ON daily_farm(user_id, date)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_daily_rewards_user ON daily_rewards(user_id, date)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_achievements_user  ON achievements(user_id)`);

  // Données initiales pour les comptes déjà existants (migration)
  const users = await dbAll("SELECT id, username FROM users");
  for (const { id, username } of users) {
    await dbRun(`INSERT OR IGNORE INTO inventory (user_id) VALUES (?)`, [id]);
    await dbRun(`INSERT OR IGNORE INTO trainer_stats (user_id) VALUES (?)`, [id]);
    for (const p of PASSIVES) {
      await dbRun(`INSERT OR IGNORE INTO user_passives (user_id, item) VALUES (?,?)`, [id, p]);
    }
    for (const b of BADGES) {
      await dbRun(`INSERT OR IGNORE INTO user_badges (user_id, badge) VALUES (?,?)`, [id, b]);
    }
    for (let i = 0; i < ARENES.length; i++) {
      await dbRun(`INSERT OR IGNORE INTO user_arenes (username, arene, unlocked) VALUES (?,?,?)`, [username, ARENES[i], i === 0 ? 1 : 0]);
    }
  }

  // ── Cagnotte Casino ───────────────────────────────────────────────────────
  await dbRun(`CREATE TABLE IF NOT EXISTS casino_jackpot (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    amount           INTEGER DEFAULT 0,
    state            TEXT    DEFAULT 'accumulating',
    lottery_end_time INTEGER,
    last_winners     TEXT    DEFAULT '[]',
    last_draw_at     INTEGER
  )`);

  // Initialise le singleton s'il n'existe pas encore
  await dbRun(`INSERT OR IGNORE INTO casino_jackpot (id, amount, state) VALUES (1, 0, 'accumulating')`);

  await dbRun(`CREATE TABLE IF NOT EXISTS casino_lottery_entries (
    user_id      INTEGER PRIMARY KEY,
    username     TEXT    NOT NULL,
    registered_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // ── Team Rocket (singleton global, temps réel) ────────────────────────────
  // compteur 0..50 incrémenté à chaque Pokémon vendu en réserve. À 50 la Team
  // Rocket s'enfuit (statut en_fuite) et se cache sur une page aléatoire.
  await dbRun(`CREATE TABLE IF NOT EXISTS team_rocket (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    compteur     INTEGER NOT NULL DEFAULT 0,
    statut       TEXT    NOT NULL DEFAULT 'au_shop',
    page_cachee  TEXT,
    inventaire   TEXT    NOT NULL DEFAULT '[]',
    finder_id    INTEGER,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await dbRun(`INSERT OR IGNORE INTO team_rocket (id) VALUES (1)`);
  // Migration : horodatage du déclenchement de la fuite (silencieux si déjà présent)
  try { await dbRun(`ALTER TABLE team_rocket ADD COLUMN fled_at TIMESTAMP`); } catch {}
  // Migration : position (en %) du sprite sur la page piégée
  try { await dbRun(`ALTER TABLE team_rocket ADD COLUMN pos_x REAL`); } catch {}
  try { await dbRun(`ALTER TABLE team_rocket ADD COLUMN pos_y REAL`); } catch {}

  // Historique : qui a retrouvé la Team Rocket et quel Pokémon a été récupéré
  await dbRun(`CREATE TABLE IF NOT EXISTS team_rocket_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    username      TEXT    NOT NULL,
    pokemon_name  TEXT    NOT NULL,
    is_shiny      INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // ── Prix de la boutique (éditables via l'admin) ───────────────────────────
  // Source d'autorité des transactions ET de l'affichage. Seedée une seule fois
  // avec les valeurs par défaut ; les modifications admin écrasent les lignes.
  await dbRun(`CREATE TABLE IF NOT EXISTS shop_prices (
    item TEXT PRIMARY KEY,
    buy  INTEGER NOT NULL,
    sell INTEGER NOT NULL
  )`);
  const SHOP_SEED = [
    ["pokeball", 250, 75], ["superball", 1500, 450], ["hyperball", 5000, 1500], ["masterball", 200000, 60000],
    ["resetball", 10000, 3000], ["superbonbon", 2000, 600], ["potion", 1500, 450], ["lootbox", 3000, 900],
    ["sablier", 2000, 600], ["ticketsafari", 50000, 15000], ["goldappat", 100000, 30000], ["charmeeclaire", 125000, 37500],
  ];
  for (const [item, buy, sell] of SHOP_SEED) {
    await dbRun(`INSERT OR IGNORE INTO shop_prices (item, buy, sell) VALUES (?,?,?)`, [item, buy, sell]);
  }

  // ── Récompense de connexion quotidienne (streak) ──────────────────────────
  await dbRun(`CREATE TABLE IF NOT EXISTS daily_login (
    user_id         INTEGER PRIMARY KEY,
    streak          INTEGER NOT NULL DEFAULT 0,
    last_claim_date TEXT,
    best_streak     INTEGER NOT NULL DEFAULT 0
  )`);
  // Un enregistrement par jour réclamé (pour cocher les cases du calendrier mensuel)
  await dbRun(`CREATE TABLE IF NOT EXISTS daily_claims (
    user_id    INTEGER NOT NULL,
    claim_date TEXT    NOT NULL,
    PRIMARY KEY (user_id, claim_date)
  )`);

  // ── Pokémon recherché (bounty) ────────────────────────────────────────────
  await dbRun(`CREATE TABLE IF NOT EXISTS bounty (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    cycle_id     INTEGER NOT NULL DEFAULT 0,
    pokemon_name TEXT,
    prize        INTEGER NOT NULL DEFAULT 0,
    started_at   TIMESTAMP
  )`);
  await dbRun(`INSERT OR IGNORE INTO bounty (id) VALUES (1)`);
  await dbRun(`CREATE TABLE IF NOT EXISTS bounty_claims (
    user_id  INTEGER NOT NULL,
    cycle_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, cycle_id)
  )`);

  // ── PokéVersus ────────────────────────────────────────────────────────────
  await dbRun(`CREATE TABLE IF NOT EXISTS versus_queue (
    username  TEXT PRIMARY KEY,
    mode      TEXT NOT NULL CHECK(mode IN ('3v3','6v6')),
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS versus_matches (
    id          TEXT PRIMARY KEY,
    mode        TEXT NOT NULL,
    player1     TEXT NOT NULL,
    player2     TEXT NOT NULL,
    state       TEXT NOT NULL DEFAULT 'team_building',
    team1_json  TEXT DEFAULT '[]',
    team2_json  TEXT DEFAULT '[]',
    arena_vote1 TEXT,
    arena_vote2 TEXT,
    arena       TEXT,
    battle_json TEXT DEFAULT '{}',
    winner      TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS versus_ladder_3v3 (
    username TEXT PRIMARY KEY,
    points   INTEGER DEFAULT 0,
    wins     INTEGER DEFAULT 0,
    losses   INTEGER DEFAULT 0,
    season   INTEGER DEFAULT 1
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS versus_ladder_6v6 (
    username TEXT PRIMARY KEY,
    points   INTEGER DEFAULT 0,
    wins     INTEGER DEFAULT 0,
    losses   INTEGER DEFAULT 0,
    season   INTEGER DEFAULT 1
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS versus_seasons (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    mode                TEXT NOT NULL,
    season              INTEGER NOT NULL,
    ended_at            DATETIME,
    rewards_distributed INTEGER DEFAULT 0
  )`);

  // Codes promo (récompenses à l'inscription)
  await dbRun(`CREATE TABLE IF NOT EXISTS promo_codes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    reward_data TEXT DEFAULT '{}',
    uses        INTEGER DEFAULT 0,
    max_uses    INTEGER,
    is_active   INTEGER DEFAULT 1,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by  INTEGER,
    FOREIGN KEY(created_by) REFERENCES users(id)
  )`);
  // Limite d'utilisation (NULL = illimité) — ajout rétrocompatible
  try { await dbRun(`ALTER TABLE promo_codes ADD COLUMN max_uses INTEGER`); } catch {}

  await dbRun(`CREATE INDEX IF NOT EXISTS idx_versus_ladder_3v3_pts ON versus_ladder_3v3(points DESC)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_versus_ladder_6v6_pts ON versus_ladder_6v6(points DESC)`);

  console.log("✅ Base de données initialisée");
}

export function run(sql, params = []) {
  return new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));
}
export function get(sql, params = []) {
  return new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
}
export function all(sql, params = []) {
  return new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));
}
