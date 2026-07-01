import { Router } from "express";
import { run, get, all, GEN1_POKEMONS, GEN2_POKEMONS, GEN3_POKEMONS, GEN4_POKEMONS } from "../db.js";
import { getIO } from "../socket.js";

const router = Router();

// Les 4 premiers sont des "balls", le reste des "objets" (pour le libellé d'achat).
const BALL_KEYS = ["pokeball","superball","hyperball","masterball"];
export const SHOP_ITEM_KEYS = [...BALL_KEYS, "resetball","superbonbon","potion","lootbox","sablier","ticketsafari","goldappat","charmeeclaire"];
const VALID_ITEMS = new Set([...SHOP_ITEM_KEYS, "pokedollars"]);

function validItem(col) { return VALID_ITEMS.has(col); }

// Prix lus en base (table shop_prices, éditable via l'admin) → source d'autorité.
async function getBuyPrice(item)  { const r = await get(`SELECT buy  FROM shop_prices WHERE item = ?`, [item]); return r ? r.buy  : null; }
async function getSellPrice(item) { const r = await get(`SELECT sell FROM shop_prices WHERE item = ?`, [item]); return r ? r.sell : null; }

// ── Pokémon categories for lootbox ──────────────────────────────────────────
const FOSSILS = new Set([
  // Gen 1-2
  "Amonita","Amonistar","Kabuto","Kabutops","Ptéra",
  // Gen 3
  "Lilia","Vacilys","Anorith","Armaldo",
  // Gen 4
  "Kranidos","Charkos","Dinoclier","Bastiodon",
]);
const LEGENDARIES = new Set([
  // Gen 1
  "Artikodin","Électhor","Sulfura",
  // Gen 2
  "Raikou","Entei","Suicune","Lugia","Ho-Oh",
  // Gen 3
  "Regirock","Regice","Registeel","Latias","Latios","Kyogre","Groudon","Rayquaza",
  // Gen 4
  "Dialga","Palkia","Heatran","Regigigas","Giratina","Cresselia","Créhelf","Créfollet","Créfadet",
]);
const MYTHICS = new Set([
  // Gen 1-2
  "Mewtwo","Mew","Celebi",
  // Gen 3
  "Jirachi","Deoxys",
  // Gen 4
  "Phione","Manaphy","Darkrai","Shaymin","Arceus",
]);
const SANS_EVO = new Set([
  // Gen 1
  "Canarticho","Onix","Kicklee","Tygnon","Excelangue","Saquedeneu","Kangourex","M. Mime","Insécateur","Lippoutou","Élektek","Magmar","Scarabrute","Tauros","Lokhlass","Métamorph","Porygon","Ronflex",
  // Gen 2
  "Capumain","Yanma","Cornèbre","Feuforêve","Zarbi","Girafarig","Insolourdo","Scorplane",
  "Qwilfish","Caratroc","Scarhino","Farfuret","Corayon","Cadoizo","Démanta","Airmure",
  "Cerfrousse","Queulorior",
  // Gen 3
  "Relicanth","Lovdisc","Kecleon","Ténéfix","Mysdibule","Tropius","Éoko","Absol",
  // Gen 4
  "Pachirisu","Spiritomb","Manzaï","Motisma",
]);
const STAGE3 = new Set([
  // Gen 1
  "Florizarre","Dracaufeu","Tortank","Papilusion","Dardargnan","Roucarnage","Nidoqueen","Nidoking","Rafflesia","Tartard","Alakazam","Mackogneur","Empiflor","Grolem","Ectoplasma","Dracolosse",
  // Gen 2
  "Méganium","Typhlosion","Aligatueur","Nostenfer","Pharamp","Joliflor","Azumarill","Tarpaud","Cotovol","Hyporoi","Leuphorie","Tyranocif",
  // Gen 3
  "Jungko","Braségali","Laggron","Ludicolo","Gardevoir","Monaflèmit","Galeking","Brouhabam","Libégon","Kaimorse","Drattak","Métalosse",
  // Gen 4
  "Torterra","Simiabraz","Pingoléon","Étouraptor","Luxray","Papilord","Magnézone","Élekable","Maganon","Togekiss","Mammochon","Porygon-Z","Noctunoir","Gallame",
]);
const GLITCH = new Set(["MissingNo"]);

export function getPokemonCategory(name) {
  if (MYTHICS.has(name))     return "mythic";
  if (LEGENDARIES.has(name)) return "legendaire";
  if (FOSSILS.has(name))     return "fossile";
  if (STAGE3.has(name))      return "stade3";
  if (SANS_EVO.has(name))    return "sansevo";
  if (GLITCH.has(name))      return "glitch";
  return "stade1ou2";
}

// ── Loot table ───────────────────────────────────────────────────────────────
// Total : 100% (50 + 40 + 7 + 2.5 + 0.5)
export const LOOT_TABLE = [
  // ── Commun — 50% ──────────────────────────────────────────────────────────
  { key:"pokedollars", value:500,  qty:500,  rarity:"commun",     chance:20,   type:"item" },
  { key:"pokeball",    value:3,    qty:3,    rarity:"commun",     chance:18,   type:"item" },
  { key:"potion",      value:1,    qty:1,    rarity:"commun",     chance:12,   type:"item" },
  // ── Rare — 40% (39% items + 1% pokémon) ──────────────────────────────────
  { key:"pokedollars", value:1000, qty:1000, rarity:"rare",       chance:15,   type:"item" },
  { key:"superball",   value:2,    qty:2,    rarity:"rare",       chance:12,   type:"item" },
  { key:"superbonbon", value:1,    qty:1,    rarity:"rare",       chance:9,    type:"item" },
  { key:"sablier",     value:1,    qty:1,    rarity:"rare",       chance:3,    type:"item" },
  { key:"pokemon",     catFilter:["stade1ou2","sansevo"], rarity:"rare",       chance:1,    type:"pokemon", isShiny:false },
  // ── Épique — 7% ──────────────────────────────────────────────────────────
  { key:"pokedollars",  value:7500, qty:7500, rarity:"epique",    chance:2.5,  type:"item" },
  { key:"hyperball",   value:1,    qty:1,    rarity:"epique",     chance:2,    type:"item" },
  { key:"resetball",   value:1,    qty:1,    rarity:"epique",     chance:1.4,  type:"item" },
  { key:"pokemon",     catFilter:["stade3"],  rarity:"epique",    chance:1,    type:"pokemon", isShiny:false },
  { key:"pokemon",     catFilter:["stade1ou2","sansevo"], rarity:"epique",     chance:0.1,  type:"pokemon", isShiny:true },
  // ── Légendaire — 2.4% ───────────────────────────────────────────────────
  { key:"pokedollars",   value:20000, qty:20000, rarity:"legendaire", chance:1,    type:"item" },
  { key:"ticketsafari",  value:1,     qty:1,     rarity:"legendaire", chance:0.8,  type:"item" },
  { key:"goldappat",     value:1,     qty:1,     rarity:"legendaire", chance:0.49, type:"item" },
  { key:"pokemon",     catFilter:["legendaire"], rarity:"legendaire",          chance:0.1,  type:"pokemon", isShiny:false },
  { key:"pokemon",     catFilter:["fossile","stade3"], rarity:"legendaire",    chance:0.01, type:"pokemon", isShiny:true },
  // ── Mythique — 0.6% ─────────────────────────────────────────────────────
  { key:"charmeeclaire", value:1,   qty:1,    rarity:"mythique",  chance:0.35, type:"item" },
  { key:"masterball",   value:1,    qty:1,    rarity:"mythique",  chance:0.15, type:"item" },
  { key:"pokemon",     catFilter:["mythic"],  rarity:"mythique",  chance:0.09, type:"pokemon", isShiny:false },
  { key:"pokemon",     catFilter:["legendaire","mythic"], rarity:"mythique",   chance:0.01, type:"pokemon", isShiny:true },
];

function rollLootPrize(capturedSet, glitchActive = false, gen34Unlocked = false, corneBoost = false) {
  // MissingNo exclusif — seulement si passif Glitch actif (0.5%)
  if (glitchActive && Math.random() < 0.005 && !capturedSet.has("MissingNo:0")) {
    return { item:"pokemon", qty:1, rarity:"mythique", pokemon:{ name:"MissingNo", isShiny:false, category:"glitch" } };
  }

  // Corne d'Abondance : double les chances des raretés Rare et au-dessus.
  // On renormalise en tirant sur la somme réelle des poids (qui dépasse 100).
  const table = corneBoost
    ? LOOT_TABLE.map(e => e.rarity === "commun" ? e : { ...e, chance: e.chance * 2 })
    : LOOT_TABLE;
  const totalChance = corneBoost ? table.reduce((s, e) => s + e.chance, 0) : 100;

  const r = Math.random() * totalChance;
  let sum = 0, slot;
  for (const entry of table) { sum += entry.chance; if (r <= sum) { slot = entry; break; } }
  if (!slot) slot = table[0];

  if (slot.type === "pokemon") {
    const pool = gen34Unlocked
      ? [...GEN1_POKEMONS, ...GEN2_POKEMONS, ...GEN3_POKEMONS, ...GEN4_POKEMONS]
      : [...GEN1_POKEMONS, ...GEN2_POKEMONS];
    const candidates = pool.filter(name => {
      if (GLITCH.has(name)) return false;
      const cat = getPokemonCategory(name);
      if (!slot.catFilter.includes(cat)) return false;
      return !capturedSet.has(`${name}:${slot.isShiny ? 1 : 0}`);
    });
    if (candidates.length === 0)
      return { item:"pokedollars", qty:500, rarity:"commun", fallback:true };
    const name = candidates[Math.floor(Math.random() * candidates.length)];
    return { item:"pokemon", qty:1, rarity:slot.rarity, pokemon:{ name, isShiny:slot.isShiny, category:getPokemonCategory(name) } };
  }
  return { item:slot.key, qty:slot.value, rarity:slot.rarity };
}

async function getInventoryByUserId(userId) {
  return get(
    `SELECT pokedollars, pokeball, superball, hyperball, masterball,
            resetball, superbonbon, potion, lootbox,
            ticketsafari, goldappat, sablier, charmeeclaire,
            armed_pokemon, armed_shiny
     FROM inventory
     WHERE user_id = ?`,
    [userId]
  );
}

async function getInventoryByUsername(username) {
  return get(
    `SELECT i.pokedollars, i.pokeball, i.superball, i.hyperball, i.masterball,
            i.resetball, i.superbonbon, i.potion, i.lootbox,
            i.ticketsafari, i.goldappat, i.sablier, i.charmeeclaire,
            i.armed_pokemon, i.armed_shiny
     FROM inventory i
     JOIN users u ON u.id = i.user_id
     WHERE u.username = ?`,
    [username]
  );
}

async function getUserByUsername(username) {
  return get(`SELECT id FROM users WHERE username = ?`, [username]);
}

// GET /api/inventory/:username
router.get("/:username", async (req, res) => {
  try {
    const row = await getInventoryByUserId(req.user.id);
    if (!row) return res.status(404).json({ error: "Utilisateur non trouvé" });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/inventory/useball/:username
router.post("/useball/:username", async (req, res) => {
  const username = req.user.username;
  const { ballType } = req.body;
  const validBalls = ["pokeball","superball","hyperball","masterball"];
  if (!validBalls.includes(ballType)) return res.status(400).json({ error: "Type de Pokéball invalide" });

  try {
    const user = await getUserByUsername(username);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });

    const inv = await get(`SELECT ${ballType} FROM inventory WHERE user_id = ?`, [user.id]);
    if ((inv?.[ballType] || 0) <= 0) return res.status(400).json({ error: `Pas assez de ${ballType}` });

    await run(`UPDATE inventory SET ${ballType} = ${ballType} - 1 WHERE user_id = ?`, [user.id]);
    const updated = await getInventoryByUsername(username);
    getIO()?.emit("sync:inventory", { userId: user.id, inventory: updated });
    res.json({ success: true, inventory: updated });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// GET /api/inventory/shop/prices — prix actuels (achat/vente) de tous les objets
router.get("/shop/prices", async (req, res) => {
  try {
    const rows = await all(`SELECT item, buy, sell FROM shop_prices`);
    const map = {};
    rows.forEach(r => { map[r.item] = { buy: r.buy, sell: r.sell }; });
    res.json(map);
  } catch {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/inventory/shop/:username/buy
router.post("/shop/:username/buy", async (req, res) => {
  const username = req.user.username;
  const { ballType, item } = req.body;

  // Quantité optionnelle (rétro-compatible : défaut 1, plafonnée à 99)
  let qty = parseInt(req.body.qty, 10);
  if (!Number.isFinite(qty) || qty < 1) qty = 1;
  qty = Math.min(qty, 99);

  const col = ballType || item;
  if (!col || !validItem(col) || col === "pokedollars" || !SHOP_ITEM_KEYS.includes(col)) {
    return res.status(400).json({ error: "Achat invalide" });
  }

  try {
    const user = await getUserByUsername(username);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });

    const unitCost = await getBuyPrice(col);
    if (unitCost == null) return res.status(400).json({ error: "Objet invalide" });
    const cost = unitCost * qty;
    const isBall = BALL_KEYS.includes(col);
    const msg = qty > 1 ? `Tu as acheté ${qty} ${col} !` : (isBall ? `Tu as acheté une ${col} !` : `Tu as acheté un ${col} !`);

    const inv = await get(`SELECT pokedollars FROM inventory WHERE user_id = ?`, [user.id]);
    if ((inv?.pokedollars || 0) < cost) return res.status(400).json({ error: "Pas assez de Pokédollars" });

    await run(
      `UPDATE inventory SET pokedollars = pokedollars - ?, ${col} = COALESCE(${col},0) + ? WHERE user_id = ?`,
      [cost, qty, user.id]
    );
    const updated = await getInventoryByUsername(username);
    getIO()?.emit("sync:inventory", { userId: user.id, inventory: updated });
    res.json({ success: true, message: msg, inventory: updated, item: col });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/inventory/shop/:username/sell
router.post("/shop/:username/sell", async (req, res) => {
  const username = req.user.username;
  const target = req.body.ballType || req.body.item;

  if (!target || !validItem(target) || target === "pokedollars" || !SHOP_ITEM_KEYS.includes(target))
    return res.status(400).json({ error: "Vente invalide" });

  // Quantité optionnelle (défaut 1, plafonnée à 99 et au stock disponible)
  let qty = parseInt(req.body.qty, 10);
  if (!Number.isFinite(qty) || qty < 1) qty = 1;
  qty = Math.min(qty, 99);

  try {
    const user = await getUserByUsername(username);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });

    const unitSell = await getSellPrice(target);
    if (unitSell == null) return res.status(400).json({ error: "Vente invalide" });

    const inv = await get(`SELECT ${target} FROM inventory WHERE user_id = ?`, [user.id]);
    const stock = inv?.[target] || 0;
    if (stock <= 0) return res.status(400).json({ error: `Tu n'as pas de ${target} à vendre` });

    const sellQty = Math.min(qty, stock);
    const value   = unitSell * sellQty;
    await run(
      `UPDATE inventory SET pokedollars = pokedollars + ?, ${target} = ${target} - ? WHERE user_id = ?`,
      [value, sellQty, user.id]
    );
    const updated = await getInventoryByUsername(username);
    getIO()?.emit("sync:inventory", { userId: user.id, inventory: updated });
    const msg = sellQty > 1 ? `Tu as vendu ${sellQty} ${target} pour ${value}₽ !` : `Tu as vendu un ${target} pour ${value}₽ !`;
    res.json({ success: true, message: msg, inventory: updated, item: target, sold: sellQty });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/inventory/useitem/:username
router.post("/useitem/:username", async (req, res) => {
  const username = req.user.username;
  const { item, gameType } = req.body;
  const validItems = ["resetball","superbonbon","potion","lootbox","ticketsafari","goldappat","sablier","charmeeclaire"];
  if (!item || !validItems.includes(item)) return res.status(400).json({ error: "Item non utilisable" });

  try {
    const user = await getUserByUsername(username);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    const inv = await get(`SELECT resetball, superbonbon, potion, lootbox, ticketsafari, goldappat, sablier, charmeeclaire FROM inventory WHERE user_id = ?`, [user.id]);
    if ((inv?.[item] || 0) <= 0) return res.status(400).json({ error: "Objet non disponible" });

    // ── Ticket Safari : remet à zéro les relances safari (gratuites + payantes) ──
    if (item === "ticketsafari") {
      const row   = await get(`SELECT state FROM game_states WHERE user_id = ? AND game_type = 'safari'`, [user.id]);
      let state   = {};
      try { state = row?.state ? JSON.parse(row.state) : {}; } catch {}
      const today = new Date().toISOString().split("T")[0];
      state = { ...state, date: today, freeUsed: 0, boughtUsed: 0 };
      await run(
        `INSERT INTO game_states (user_id, game_type, state) VALUES (?, 'safari', ?)
         ON CONFLICT(user_id, game_type) DO UPDATE SET state = excluded.state, updated_at = CURRENT_TIMESTAMP`,
        [user.id, JSON.stringify(state)]
      );
      await run(`UPDATE inventory SET ticketsafari = ticketsafari - 1 WHERE user_id = ?`, [user.id]);
      const updated = await getInventoryByUsername(username);
      getIO()?.emit("sync:inventory", { userId: user.id, inventory: updated });
      return res.json({ success: true, message: "🎫 Relances du Safari réinitialisées !", inventory: updated });
    }

    // ── Sablier : annule le cooldown d'UN seul jeu ──────────────────────────────
    if (item === "sablier") {
      if (!gameType) return res.status(400).json({ error: "gameType requis" });
      await run(`UPDATE game_states SET next_available_at = ? WHERE user_id = ? AND game_type = ?`, [new Date().toISOString(), user.id, gameType]);
      await run(`UPDATE inventory SET sablier = sablier - 1 WHERE user_id = ?`, [user.id]);
      const updated = await getInventoryByUsername(username);
      getIO()?.emit("sync:inventory", { userId: user.id, inventory: updated });
      return res.json({ success: true, message: `⏳ Cooldown du jeu ${gameType} annulé !`, inventory: updated });
    }

    // ── Gold Appât : arme le prochain Pokémon des jeux/safari ───────────────────
    if (item === "goldappat") {
      const pokemon = String(req.body.pokemon || "").trim();
      if (!pokemon) return res.status(400).json({ error: "Pokémon requis" });
      const gen12 = new Set([...GEN1_POKEMONS, ...GEN2_POKEMONS]);
      const gen34 = new Set([...GEN3_POKEMONS, ...GEN4_POKEMONS]);
      if (!gen12.has(pokemon) && !gen34.has(pokemon)) return res.status(400).json({ error: "Pokémon inconnu" });
      if (gen34.has(pokemon)) {
        const g = await get(`SELECT claimed FROM achievements WHERE user_id = ? AND achievement_id = 'unlock-gen3-4'`, [user.id]);
        if (Number(g?.claimed) !== 1) return res.status(403).json({ error: "Tu n'as pas encore débloqué la Gen 3/4" });
      }
      await run(`UPDATE inventory SET armed_pokemon = ?, goldappat = goldappat - 1 WHERE user_id = ?`, [pokemon, user.id]);
      const updated = await getInventoryByUsername(username);
      getIO()?.emit("sync:inventory", { userId: user.id, inventory: updated });
      getIO()?.emit("sync:armed", { userId: user.id, armedPokemon: pokemon });
      return res.json({ success: true, message: `🟡 ${pokemon} apparaîtra à ton prochain jeu !`, inventory: updated, armedPokemon: pokemon });
    }

    // ── Charme Éclair : arme un shiny garanti à la prochaine capture ────────────
    if (item === "charmeeclaire") {
      await run(`UPDATE inventory SET armed_shiny = 1, charmeeclaire = charmeeclaire - 1 WHERE user_id = ?`, [user.id]);
      const updated = await getInventoryByUsername(username);
      getIO()?.emit("sync:inventory", { userId: user.id, inventory: updated });
      getIO()?.emit("sync:armed", { userId: user.id, armedShiny: 1 });
      return res.json({ success: true, message: "✨ Ton prochain Pokémon sera shiny !", inventory: updated, armedShiny: 1 });
    }

    if (item === "resetball") {
      await run(`UPDATE inventory SET resetball = resetball - 1 WHERE user_id = ?`, [user.id]);
      await run(`UPDATE game_states SET next_available_at = ? WHERE user_id = ?`, [new Date().toISOString(), user.id]);
      const updated = await getInventoryByUsername(username);
      getIO()?.emit("sync:inventory", { userId: user.id, inventory: updated });
      return res.json({ success: true, message: "⏰ Tous les timers ont été réinitialisés !" });
    }

    if (item === "superbonbon") {
      const GAME_TYPES = ["ombre","cri","carte","text","atq"];
      const actions = await Promise.all(GAME_TYPES.map(async (game) => {
        const row     = await get(`SELECT state, next_available_at FROM game_states WHERE user_id = ? AND game_type = ?`, [user.id, game]);
        const state   = row?.state ? JSON.parse(row.state) : {};
        const finished  = state.finished === true;
        const available = !row?.next_available_at || new Date(row.next_available_at) <= new Date();
        if (finished && available)   return { game, action: "reset+reveal" };
        if (!finished && !available) return { game, action: "reveal" };
        if (!finished && available)  return { game, action: "ask-confirm" };
        return null;
      }));
      return res.json({ success: true, message: "🍬 Superbonbon prêt à être utilisé", actions: actions.filter(Boolean) });
    }

    if (item === "potion") {
      if (!gameType) return res.status(400).json({ error: "gameType requis" });
      const gs    = await get(`SELECT id, state FROM game_states WHERE user_id = ? AND game_type = ?`, [user.id, gameType]);
      const state = gs?.state ? JSON.parse(gs.state) : {};
      state.score = Math.min(100, (state.score || 0) + 20);
      const now   = new Date().toISOString();
      if (gs) {
        await run(`UPDATE game_states SET state = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(state), now, gs.id]);
      } else {
        await run(`INSERT INTO game_states (user_id, game_type, state, updated_at) VALUES (?,?,?,?)`, [user.id, gameType, JSON.stringify(state), now]);
      }
      await run(`UPDATE inventory SET potion = potion - 1 WHERE user_id = ?`, [user.id]);
      const updated = await getInventoryByUsername(username);
      getIO()?.emit("sync:inventory", { userId: user.id, inventory: updated });
      return res.json({ success: true, message: `💊 +20 score ajouté au jeu ${gameType} !`, newScore: state.score });
    }

    if (item === "lootbox") {
      const count = Math.min(10, Math.max(1, parseInt(req.body.count) || 1));

      const freshInv = await get(`SELECT lootbox FROM inventory WHERE user_id = ?`, [user.id]);
      if ((freshInv?.lootbox || 0) < count)
        return res.status(400).json({ error: `Pas assez de lootboxes (${freshInv?.lootbox || 0}/${count})` });

      // Load captures once, then track additions within multi-open
      const captured   = await all(`SELECT pokemon_name, is_shiny FROM captures WHERE user_id = ?`, [user.id]);
      const capturedSet = new Set(captured.map(c => `${c.pokemon_name}:${c.is_shiny}`));

      const glitchRow  = await get(`SELECT active FROM user_passives WHERE user_id = ? AND item = 'glitch'`, [user.id]);
      const glitchActive = glitchRow?.active === 1;

      // Passif Corne d'Abondance : double le taux de drop (raretés Rare+) tant qu'il
      // reste de la durabilité. Durabilité = 100, -5/lootbox, recharge chaque jour.
      const corneRow     = await get(`SELECT active, durability, durability_date FROM user_passives WHERE user_id = ? AND item = 'corneabondance'`, [user.id]);
      const today        = new Date().toISOString().slice(0, 10);
      let   corneDura    = corneRow?.durability_date === today ? (corneRow?.durability ?? 100) : 100;
      const corneOn      = corneRow?.active === 1;

      const gen34Row = await get(`SELECT claimed FROM achievements WHERE user_id = ? AND achievement_id = 'unlock-gen3-4'`, [user.id]);
      const gen34Unlocked = Number(gen34Row?.claimed) === 1;

      const prizes = [];
      for (let i = 0; i < count; i++) {
        const boost = corneOn && corneDura > 0;           // boost actif lootbox par lootbox
        const prize = rollLootPrize(capturedSet, glitchActive, gen34Unlocked, boost);
        if (boost) corneDura = Math.max(0, corneDura - 5); // -5 par lootbox boostée
        prizes.push(prize);
        if (prize.item === "pokemon") capturedSet.add(`${prize.pokemon.name}:${prize.pokemon.isShiny ? 1 : 0}`);
      }

      // Apply all changes
      await run(`UPDATE inventory SET lootbox = lootbox - ? WHERE user_id = ?`, [count, user.id]);
      // Persiste la durabilité (et la date du jour pour la recharge quotidienne).
      // Durabilité épuisée → on désactive le passif pour libérer le slot (sinon il
      // resterait actif sans effet et empêcherait d'en activer un autre).
      const depleted = corneDura <= 0;
      await run(
        `UPDATE user_passives SET durability = ?, durability_date = ?${depleted ? ", active = 0" : ""} WHERE user_id = ? AND item = 'corneabondance'`,
        [corneDura, today, user.id]
      );
      for (const p of prizes) {
        if (p.item === "pokemon") {
          await run(`INSERT OR IGNORE INTO captures (user_id, pokemon_name, is_shiny) VALUES (?,?,?)`, [user.id, p.pokemon.name, p.pokemon.isShiny ? 1 : 0]);
        } else if (p.item === "pokedollars") {
          await run(`UPDATE inventory SET pokedollars = pokedollars + ? WHERE user_id = ?`, [p.qty, user.id]);
        } else {
          if (!validItem(p.item)) continue;
          await run(`UPDATE inventory SET ${p.item} = COALESCE(${p.item},0) + ? WHERE user_id = ?`, [p.qty, user.id]);
        }
      }

      const updated = await getInventoryByUsername(username);
      getIO()?.emit("sync:inventory", { userId: user.id, inventory: updated });
      getIO()?.emit("sync:passives", { userId: user.id, item: "corneabondance", durability: corneDura });
      if (count === 1) return res.json({ success: true, prize: prizes[0], corneDurability: corneDura });
      return res.json({ success: true, prizes, corneDurability: corneDura });
    }
  } catch (err) {
    console.error("Erreur useitem:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/inventory/useitem/:username/confirm-superbonbon
router.post("/useitem/:username/confirm-superbonbon", async (req, res) => {
  const username = req.user.username;
  try {
    const user = await getUserByUsername(username);
    if (!user) return res.status(404).json({ error: "Introuvable" });

    const inv = await get(`SELECT superbonbon FROM inventory WHERE user_id = ?`, [user.id]);
    if ((inv?.superbonbon || 0) <= 0) return res.status(400).json({ error: "Plus de superbonbon disponible !" });

    await run(`UPDATE inventory SET superbonbon = superbonbon - 1 WHERE user_id = ?`, [user.id]);
    const updated = await getInventoryByUsername(username);
    getIO()?.emit("sync:inventory", { userId: user.id, inventory: updated });
    res.json({ success: true, message: "🍬 Superbonbon utilisé avec succès !" });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/inventory/safari-reward/:username  — donner un item/pokédollars comme récompense safari
// Distribution Pokédollars du Safari (miroir de la table client) — le SERVEUR
// tire le montant, le client ne le dicte plus.
const SAFARI_PD_TIERS = [
  { w: 28, min: 50,   max: 200  },
  { w: 15, min: 200,  max: 500  },
  { w: 7,  min: 500,  max: 900  },
  { w: 5,  min: 900,  max: 1500 },
  { w: 2,  min: 1500, max: 2500 },
];

router.post("/safari-reward/:username", async (req, res) => {
  const username = req.user.username;
  const { item, qty } = req.body;

  // Récompense Pokédollars : montant tiré côté serveur (anti-forge).
  if (item === "pokedollars") {
    try {
      const user = await getUserByUsername(username);
      if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });
      const total = SAFARI_PD_TIERS.reduce((s, t) => s + t.w, 0);
      let r = Math.random() * total, tier = SAFARI_PD_TIERS[0];
      for (const t of SAFARI_PD_TIERS) { if (r < t.w) { tier = t; break; } r -= t.w; }
      const amount = tier.min + Math.floor(Math.random() * (tier.max - tier.min + 1));
      await run(`UPDATE inventory SET pokedollars = COALESCE(pokedollars,0) + ? WHERE user_id = ?`, [amount, user.id]);
      const updated = await getInventoryByUsername(username);
      getIO()?.emit("sync:inventory", { userId: user.id, inventory: updated });
      return res.json({ success: true, item: "pokedollars", amount });
    } catch (err) {
      return res.status(500).json({ error: "Erreur serveur" });
    }
  }

  const ITEM_COLS = ["pokeball","superball","hyperball","masterball","resetball","superbonbon","potion","lootbox"];
  if (!item || !ITEM_COLS.includes(item) || !Number.isInteger(qty) || qty < 1 || qty > 3) {
    return res.status(400).json({ error: "Récompense invalide" });
  }
  try {
    const user = await getUserByUsername(username);
    if (!user) return res.status(404).json({ error: "Utilisateur non trouvé" });
    await run(`UPDATE inventory SET ${item} = COALESCE(${item}, 0) + ? WHERE user_id = ?`, [qty, user.id]);
    const updated = await getInventoryByUsername(username);
    getIO()?.emit("sync:inventory", { userId: user.id, inventory: updated });
    res.json({ success: true, item, qty });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/inventory/consume-armed-pokemon — appelé quand le Gold Appât a forcé
// le Pokémon d'un jeu (le front l'a utilisé pour le secret). Vide armed_pokemon.
router.post("/consume-armed-pokemon/:username", async (req, res) => {
  try {
    const user = await getUserByUsername(req.user.username);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    await run(`UPDATE inventory SET armed_pokemon = NULL WHERE user_id = ?`, [user.id]);
    getIO()?.emit("sync:armed", { userId: user.id, armedPokemon: null });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/inventory/consume-armed-shiny — appelé dès que le Charme Éclair a
// rendu chromatique le Pokémon rencontré (au moment de la révélation). Remet
// armed_shiny à 0 pour que la garantie ne s'applique qu'à CE Pokémon.
router.post("/consume-armed-shiny/:username", async (req, res) => {
  try {
    const user = await getUserByUsername(req.user.username);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    await run(`UPDATE inventory SET armed_shiny = 0 WHERE user_id = ?`, [user.id]);
    getIO()?.emit("sync:armed", { userId: user.id, armedShiny: 0 });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

export default router;
