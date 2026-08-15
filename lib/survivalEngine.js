import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as BE from "./battleEngine.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const GEN12 = JSON.parse(readFileSync(join(__dir, "../gen1_2.json"), "utf-8"));
const GEN34_PATH = join(__dir, "../../html/data/gen3_4.json");
const GEN34 = (() => { try { return JSON.parse(readFileSync(GEN34_PATH, "utf-8")); } catch { return []; } })();
export const ALL_POKEMON = [...GEN12, ...GEN34].filter(p => p && p.name !== "MissingNo");
export const POKEMON_MAP = Object.fromEntries(ALL_POKEMON.map(p => [p.name, p]));

export const TOTAL_FIGHTS = 20;

// ─── Légendaires / Mythiques ──────────────────────────────────────────
export const LEGENDARY_SET = new Set([
  // Gen 1
  "Artikodin","Électhor","Sulfura","Mewtwo","Mew",
  // Gen 2
  "Raikou","Entei","Suicune","Lugia","Ho-Oh","Celebi",
  // Gen 3
  "Regirock","Regice","Registeel","Latias","Latios",
  "Kyogre","Groudon","Rayquaza","Jirachi","Deoxys",
  // Gen 4
  "Créhelf","Créfollet","Créfadet",
  "Dialga","Palkia","Heatran","Regigigas","Giratina","Cresselia",
  "Phione","Manaphy","Darkrai","Shaymin","Arceus",
]);
export function isLegendary(name) { return LEGENDARY_SET.has(name); }

export const SHOP_PRICES = {
  surv_potion_petite:  15,
  surv_potion_moyenne: 30,
  surv_potion_grande:  45,
  surv_rappel:         40,
};
export const POTION_HEAL = {
  surv_potion_petite:  { pct: 30,  revive: false },
  surv_potion_moyenne: { pct: 60,  revive: false },
  surv_potion_grande:  { pct: 100, revive: false },
  surv_rappel:         { pct: 50,  revive: true  },
};

// ─── Helpers ──────────────────────────────────────────────────────────
export function getBST(p) {
  return (p.hp||0)+(p.atk||0)+(p.def||0)+(p.sp_atk||0)+(p.sp_def||0)+(p.speed||0);
}
export function getTypes(p) {
  const t = [p.type1];
  if (p.type2 && p.type2 !== p.type1) t.push(p.type2);
  return t;
}
const norm = t => (t||"").toLowerCase()
  .replace(/[éèê]/g,"e").replace(/î/g,"i").replace(/ô/g,"o").trim();

function estDamage(attacker, type, defender, useSpecial) {
  const eff = BE.getEffectiveness(type, defender.type1, defender.type2);
  if (eff === 0) return 0;
  const atkStat = useSpecial ? (attacker.sp_atk||50) : (attacker.atk||50);
  const defStat = Math.max(30, useSpecial ? (defender.sp_def||50) : (defender.def||50));
  const stab = (norm(attacker.type1)===norm(type)||norm(attacker.type2||"")===norm(type)) ? 1.5 : 1;
  const base = Math.floor((22 * 65 * atkStat / defStat) / 50) + 2;
  return Math.max(1, Math.floor(base * eff * stab * 0.925));
}

function bestAttack(attacker, defender) {
  let best = { type: getTypes(attacker)[0], useSpecial: false, dmg: -1 };
  for (const t of getTypes(attacker)) {
    for (const sp of [false, true]) {
      const d = estDamage(attacker, t, defender, sp);
      if (d > best.dmg) best = { type: t, useSpecial: sp, dmg: d };
    }
  }
  return best;
}

// ─── Difficulty ───────────────────────────────────────────────────────
export function getSurvivalProfile(streak) {
  const isFinalBoss = streak === TOTAL_FIGHTS - 1;
  const t = Math.min(streak, TOTAL_FIGHTS - 1) / (TOTAL_FIGHTS - 1);
  return {
    t,
    aiLevel:  isFinalBoss ? 1.0  : 0.20 + 0.65 * t,
    teamSize: isFinalBoss ? 6    : Math.min(6, 2 + Math.floor(4 * t)),
    isFinalBoss,
  };
}

// ─── Build opponent team ──────────────────────────────────────────────
// diffT  : progression coefficient 0→1 (from getSurvivalProfile)
// playerLegendaryCount : max legendaries/mythics allowed in the opponent team
export function buildOpponentTeam(pool, teamSize, playerTeam, aiLevel, playerLegendaryCount = 0, diffT = 1.0) {
  const pteam = (playerTeam || []).filter(Boolean);

  // BST cap grows with difficulty so early waves only field weak Pokémon.
  // diffT=1 (boss) → no cap (all Pokémon eligible including legendaries).
  // diffT=0 (wave 1) → cap ≈430 (common fully-evolved Pokémon, no pseudo-legendaries)
  const bstCap = diffT >= 1.0 ? Infinity : Math.round(430 + 310 * diffT);
  let candidates = pool.filter(p => p && p.name !== "MissingNo" && getBST(p) <= bstCap);
  // Safety: if the cap left too few candidates, relax it progressively
  if (candidates.length < teamSize * 3) candidates = pool.filter(p => p && p.name !== "MissingNo");

  const maxBST = Math.max(1, ...candidates.map(getBST));

  // BST weight increases with difficulty (0.5 at start → 3.0 at boss)
  const bstWeight = 0.5 + 2.5 * diffT;
  // Noise decreases with difficulty so early waves feel varied, late waves feel deliberate
  const noise = (1 - diffT) * 20;

  const scored = candidates.map(p => {
    let off = 0, def = 0;
    for (const pp of pteam) {
      let bestEff = 0;
      for (const ty of getTypes(p)) bestEff = Math.max(bestEff, BE.getEffectiveness(ty, pp.type1, pp.type2));
      off += bestEff;
      let worstIncoming = 0;
      for (const ty of getTypes(pp)) worstIncoming = Math.max(worstIncoming, BE.getEffectiveness(ty, p.type1, p.type2));
      def += (2 - Math.min(2, worstIncoming));
    }
    const n = Math.max(1, pteam.length);
    const s = (off/n) * aiLevel * 3.0
            + (def/n) * aiLevel * 2.0
            + (getBST(p)/maxBST) * bstWeight
            + (Math.random()*2-1) * noise;
    return { p, s };
  }).sort((a, b) => b.s - a.s);

  const pick = [], used = new Set();
  let legendaryCount = 0;
  for (const { p } of scored) {
    if (pick.length >= teamSize) break;
    if (used.has(p.name)) continue;
    if (isLegendary(p.name)) {
      if (legendaryCount >= playerLegendaryCount) continue;
      legendaryCount++;
    }
    pick.push(p);
    used.add(p.name);
  }
  // Fill remaining slots with non-legendaries if legendary cap blocked some picks
  if (pick.length < teamSize) {
    for (const { p } of scored) {
      if (pick.length >= teamSize) break;
      if (!used.has(p.name) && !isLegendary(p.name)) {
        pick.push(p); used.add(p.name);
      }
    }
  }
  return pick;
}

// ─── AI decision ─────────────────────────────────────────────────────
export function chooseAiAction(battleState, playerTeam, opponentTeam, aiLevel) {
  const c2 = battleState.p2Active;
  const c1 = battleState.p1Active;
  const C = opponentTeam[c2];
  const P = playerTeam[c1];
  if (!C || !P) return { type: "attack", atkType: getTypes(opponentTeam[0])[0], useSpecial: false };

  if (Math.random() < (1 - aiLevel) * 0.30) {
    const ts = getTypes(C);
    return { type:"attack", atkType: ts[Math.floor(Math.random()*ts.length)], useSpecial: Math.random()<0.5 };
  }

  const atk = bestAttack(C, P);
  const cHP = battleState.p2HP[c2];

  if (aiLevel > 0.5) {
    const incoming = bestAttack(P, C).dmg;
    if (incoming >= cHP) {
      let bestSw = null, bestScore = -Infinity;
      for (let i = 0; i < opponentTeam.length; i++) {
        if (i === c2 || battleState.p2HP[i] <= 0) continue;
        const K = opponentTeam[i];
        const entry = bestAttack(P, K).dmg;
        if (entry >= battleState.p2HP[i]) continue;
        const score = bestAttack(K, P).dmg - entry * 0.5;
        if (score > bestScore) { bestScore = score; bestSw = i; }
      }
      if (bestSw !== null && Math.random() < aiLevel * 0.6) {
        return { type: "switch", switchIdx: bestSw };
      }
    }
  }
  return { type: "attack", atkType: atk.type, useSpecial: atk.useSpecial };
}

// ─── Mutation pool ────────────────────────────────────────────────────
const MUT_CAT_COLORS = {
  offensive:   "#E74C3C",
  defensive:   "#3498DB",
  economie:    "#F39C12",
  risque:      "#8E44AD",
  strategique: "#27AE60",
};

// requiresTarget: true  → l'effet s'applique à un seul Pokémon (idx fourni par le client)
// targetFainted: true   → le Pokémon ciblé peut être K.O. (ex: pré-buff avant ranimation)
export const MUTATION_POOL = [
  { id:"atk_plus10",          label:"Rage offensive",      desc:"Ce Pokémon inflige +10% de dégâts.",                                          category:"offensive",   requiresTarget:true,  targetFainted:true  },
  { id:"atk_plus20",          label:"Frappe avec force",   desc:"Ce Pokémon inflige +20% de dégâts.",                                          category:"offensive",   requiresTarget:true,  targetFainted:true  },
  { id:"first_send_atk",      label:"Élan du champion",    desc:"Ce Pokémon gagne +25% ATK/Atq.Spé. pendant 3 tours s'il est envoyé en premier.",category:"offensive",  requiresTarget:true,  targetFainted:true  },
  { id:"hp_team_plus15",      label:"Corps d'acier",       desc:"Ce Pokémon gagne +15% PV max (appliqué immédiatement).",                      category:"defensive",   requiresTarget:true,  targetFainted:false },
  { id:"dmg_reduction_8",     label:"Armure naturelle",    desc:"Ce Pokémon subit 8% de dégâts en moins.",                                     category:"defensive",   requiresTarget:true,  targetFainted:true  },
  { id:"switch_heal_10",      label:"Souffle de repli",    desc:"Ce Pokémon récupère 10% de ses PV max à chaque fois qu'il entre en combat.",   category:"defensive",   requiresTarget:true,  targetFainted:true  },
  { id:"revive_bonus_25",     label:"Seconde vie",         desc:"Ce Pokémon revient avec 25% de PV en plus lors d'une ranimation.",             category:"defensive",   requiresTarget:true,  targetFainted:true  },
  { id:"currency_plus50",     label:"Fortune de guerre",   desc:"+50% de Jetons de Survie gagnés après chaque victoire (cumulable).",           category:"economie",    requiresTarget:false, targetFainted:false },
  { id:"potions_discount",    label:"Commerce équitable",  desc:"Les potions coûtent 25% moins cher en boutique (cumulable).",                  category:"economie",    requiresTarget:false, targetFainted:false },
  { id:"free_potion_every5",  label:"Ravitaillement",      desc:"Une Potion Petite est offerte tous les 5 combats gagnés.",                     category:"economie",    requiresTarget:false, targetFainted:false },
  { id:"butin_double",        label:"Main leste",          desc:"Le choix Butin rapporte le double de Jetons (cumulable).",                     category:"economie",    requiresTarget:false, targetFainted:false },
  { id:"atk_def_tradeoff",    label:"Berserker",           desc:"Ce Pokémon gagne +25% ATK/Atq.Spé. mais perd -20% Déf/Déf.Spé.",             category:"risque",      requiresTarget:true,  targetFainted:true  },
  { id:"low_hp_atk_boost",    label:"Dernier recours",     desc:"Ce Pokémon gagne +40% ATK/Atq.Spé. quand il est sous 30% de PV.",             category:"risque",      requiresTarget:true,  targetFainted:true  },
  { id:"harder_more_currency",label:"Mode difficile",      desc:"Les combats sont plus durs mais rapportent +50% de Jetons (cumulable).",       category:"risque",      requiresTarget:false, targetFainted:false },
  { id:"auto_heal_victory",   label:"Camp de récupération",desc:"Ce Pokémon récupère automatiquement 15% de ses PV max après chaque victoire.", category:"strategique", requiresTarget:true,  targetFainted:false },
  { id:"first_ko_revival",    label:"Volonté de fer",      desc:"Ce Pokémon revient avec 20% de ses PV s'il est le premier K.O. du combat.",   category:"strategique", requiresTarget:true,  targetFainted:true  },
];

export const MUTATION_IDS = new Set(MUTATION_POOL.map(m => m.id));

// ─── Wheel sectors — poids identique pour chaque secteur ─────────────
export const WHEEL_SECTORS = [
  { id:"heal_full",       label:"Soin complet",        desc:"Soigne entièrement un Pokémon au choix.",                                      weight:1, requiresTarget:true,  requiresStat:false, color:"#27AE60" },
  { id:"heal_team",       label:"Soin d'équipe",        desc:"+25% des PV max restaurés sur un Pokémon au choix.",                          weight:1, requiresTarget:true,  requiresStat:false, color:"#2ECC71" },
  { id:"ranimation",      label:"Ranimation",           desc:"Ranime un Pokémon K.O. à 50% de ses PV max.",                                 weight:1, requiresTarget:true,  requiresStat:false, koOnly:true,    color:"#1ABC9C" },
  { id:"stat_boost",      label:"Entraînement ciblé",   desc:"+10% à une stat au choix sur un Pokémon (plafond +30% par stat).",             weight:1, requiresTarget:true,  requiresStat:true,  color:"#3498DB" },
  { id:"stat_general",    label:"Polyvalence",          desc:"+5% à toutes les stats offensives/défensives sur un Pokémon.",                 weight:1, requiresTarget:true,  requiresStat:false, color:"#5DADE2" },
  { id:"fortification",   label:"Fortification",        desc:"+15% de PV max permanent sur un Pokémon au choix.",                           weight:1, requiresTarget:true,  requiresStat:false, color:"#2980B9" },
  { id:"reperage",        label:"Repérage",             desc:"Révèle la composition complète du prochain dresseur.",                        weight:1, requiresTarget:false, requiresStat:false, color:"#9B59B6" },
  { id:"butin",           label:"Butin",                desc:"Gagnez entre 15 et 25 Jetons de Survie.",                                     weight:1, requiresTarget:false, requiresStat:false, color:"#F39C12" },
  { id:"pari_risque",     label:"Pari risqué",          desc:"50% : soin complet d'un Pokémon au choix. 50% : -20% de ses PV courants.",    weight:1, requiresTarget:true,  requiresStat:false, color:"#E67E22" },
  { id:"shop",            label:"Boutique",             desc:"Accédez à la boutique de potions exclusives.",                                weight:1, requiresTarget:false, requiresStat:false, color:"#E74C3C" },
  { id:"jackpot",         label:"Jackpot !",            desc:"+50 Jetons de Survie + un Pokémon au choix récupère 20% de ses PV max.",      weight:1, requiresTarget:true,  requiresStat:false, color:"#F1C40F" },
  { id:"malediction",     label:"Malédiction",          desc:"+1 Relance accordée, mais un Pokémon perd 15% de ses PV courants.",           weight:1, requiresTarget:true,  requiresStat:false, color:"#636e72" },
  { id:"extra_choice",    label:"+1 Choix",             desc:"Ajoute définitivement +1 proposition à chaque tirage pour ce run.",           weight:1, requiresTarget:false, requiresStat:false, color:"#00CEC9" },
  { id:"extra_legendary", label:"+1 Légendaire",        desc:"Ajoutez un légendaire/mythique à votre équipe en remplacement d'un Pokémon.", weight:1, requiresTarget:false, requiresStat:false, color:"#E8C94A" },
  // Mutations — directement dans la roue, cumulables à l'infini
  ...MUTATION_POOL.map(m => ({
    id: m.id, label: m.label, desc: m.desc,
    weight: 1, requiresTarget: m.requiresTarget, requiresStat: false,
    targetFainted: m.targetFainted || false,
    color: MUT_CAT_COLORS[m.category] || "#8E44AD",
    isMutation: true,
  })),
];

// Picks n distinct sectors (active mutations excluded via the exclude param)
export function spinWheelMultiple(n, exclude = []) {
  const result = [], used = new Set(exclude);
  for (let i = 0; i < n; i++) {
    const avail = WHEEL_SECTORS.filter(s => !used.has(s.id));
    const total = avail.reduce((s, sec) => s + sec.weight, 0);
    if (!total) break;
    let r = Math.random() * total;
    let chosen = avail[avail.length - 1];
    for (const sec of avail) { r -= sec.weight; if (r <= 0) { chosen = sec; break; } }
    result.push(chosen);
    used.add(chosen.id);
  }
  return result;
}

// ─── Choice pool (backward compat pour anciens runs) ──────────────────
export const CHOICE_POOL = WHEEL_SECTORS.filter(s =>
  !["jackpot","malediction","extra_choice","extra_legendary"].includes(s.id) && !s.isMutation
);

export function pickWeightedChoices(n) {
  return spinWheelMultiple(n);
}

export function pickMutationOptions(activeMutations, n = 3) {
  const avail = MUTATION_POOL.filter(m => !activeMutations.includes(m.id));
  const result = [], used = new Set();
  const cats = ["offensive","defensive","economie","risque","strategique"];
  for (const cat of cats) {
    if (result.length >= n) break;
    const catMuts = avail.filter(m => m.category === cat && !used.has(m.id));
    if (catMuts.length) {
      const m = catMuts[Math.floor(Math.random()*catMuts.length)];
      result.push(m); used.add(m.id);
    }
  }
  const remaining = avail.filter(m => !used.has(m.id));
  while (result.length < n && remaining.length) {
    const idx = Math.floor(Math.random()*remaining.length);
    result.push(remaining[idx]); used.add(remaining[idx].id);
    remaining.splice(idx, 1);
  }
  return result.slice(0, n);
}

// ─── Apply mutation immediately (state mutation) ──────────────────────
// targetIdx: required for requiresTarget mutations, ignored for global ones
export function applyMutationToState(state, mutId, targetIdx) {
  const meta = MUTATION_POOL.find(m => m.id === mutId);
  if (!meta) return;
  if (meta.requiresTarget) {
    if (!state.pokemonMutations) state.pokemonMutations = [];
    state.pokemonMutations.push({ id: mutId, targetIdx });
    // hp_team_plus15 ciblé : appliqué immédiatement sur ce slot
    if (mutId === "hp_team_plus15") {
      const slot = state.team[targetIdx];
      if (slot && slot.curHP > 0) {
        const prev = slot.maxHP;
        slot.maxHP = Math.round(prev * 1.15);
        slot.curHP = Math.min(slot.maxHP, slot.curHP + (slot.maxHP - prev));
      }
    }
  } else {
    if (!state.mutations) state.mutations = [];
    state.mutations.push(mutId); // duplicates allowed = stacking
  }
}

// ─── Build effective teams for combat ────────────────────────────────
export function buildEffectivePlayerTeam(state) {
  const globalMuts = state.mutations || [];
  const pokeMuts   = state.pokemonMutations || [];
  return state.team.map((slot, i) => {
    const base = POKEMON_MAP[slot.name] || {};
    const mods = slot.statMods || {};
    let p = {
      ...base,
      name: slot.name,
      isShiny: slot.isShiny,
      atk:    Math.round((base.atk||50)    * (1 + (mods.atk||0)/100)),
      def:    Math.round((base.def||50)    * (1 + (mods.def||0)/100)),
      sp_atk: Math.round((base.sp_atk||50) * (1 + (mods.sp_atk||0)/100)),
      sp_def: Math.round((base.sp_def||50) * (1 + (mods.sp_def||0)/100)),
      speed:  Math.round((base.speed||50)  * (1 + (mods.speed||0)/100)),
      hp:     Math.round((base.hp||45)     * (1 + (mods.hp||0)/100)),
    };
    // Mutations par Pokémon (cumulables — chaque occurrence s'applique)
    const myMuts = pokeMuts.filter(m => m.targetIdx === i).map(m => m.id);
    for (const mutId of myMuts) {
      if (mutId === "atk_plus10")       { p.atk = Math.round(p.atk*1.10); p.sp_atk = Math.round(p.sp_atk*1.10); }
      if (mutId === "atk_plus20")       { p.atk = Math.round(p.atk*1.20); p.sp_atk = Math.round(p.sp_atk*1.20); }
      if (mutId === "atk_def_tradeoff") { p.atk = Math.round(p.atk*1.25); p.sp_atk = Math.round(p.sp_atk*1.25); p.def = Math.round(p.def*0.80); p.sp_def = Math.round(p.sp_def*0.80); }
      if (mutId === "low_hp_atk_boost") {
        const ratio = slot.maxHP > 0 ? slot.curHP / slot.maxHP : 1;
        if (ratio < 0.30) { p.atk = Math.round(p.atk*1.40); p.sp_atk = Math.round(p.sp_atk*1.40); }
      }
      // dmg_reduction_8: simulated as ~8.7% def/sp_def buff (≈ -8% damage received)
      if (mutId === "dmg_reduction_8")  { p.def = Math.round(p.def / 0.92); p.sp_def = Math.round(p.sp_def / 0.92); }
    }
    // Buffs temporaires (first_send_atk etc.)
    for (const buff of (state.tempBuffs || [])) {
      if (buff.targetIdx === i && buff.turnsLeft > 0) {
        p.atk    = Math.round(p.atk    * (1 + buff.pct/100));
        p.sp_atk = Math.round(p.sp_atk * (1 + buff.pct/100));
      }
    }
    return p;
  });
}

export function buildEffectiveOpponentTeam(opponentTeam, activeMutations) {
  // activeMutations = state.mutations (global only)
  const harderCount = activeMutations.filter(m => m === "harder_more_currency").length;
  return opponentTeam.map(p => {
    const op = { ...p };
    if (harderCount > 0) {
      const atkBoost  = Math.pow(1.15, harderCount);
      const defBoost  = Math.pow(1.10, harderCount);
      op.atk    = Math.round(op.atk    * atkBoost);
      op.sp_atk = Math.round(op.sp_atk * atkBoost);
      op.def    = Math.round(op.def    * defBoost);
      op.sp_def = Math.round(op.sp_def * defBoost);
    }
    return op;
  });
}

// ─── Currency & Rewards ───────────────────────────────────────────────
export function computeCurrencyGain(streak, activeMutations) {
  let base = 5 + streak * 2;
  const currencyStacks = activeMutations.filter(m => m === "currency_plus50").length;
  const harderStacks   = activeMutations.filter(m => m === "harder_more_currency").length;
  if (currencyStacks > 0) base = Math.round(base * Math.pow(1.5, currencyStacks));
  if (harderStacks   > 0) base = Math.round(base * Math.pow(1.5, harderStacks));
  return base;
}

export function computeRunReward(streak, outcome) {
  const base    = Math.min(20000, 200*streak + 15*streak*streak);
  const superball = streak >= 10 ? Math.floor(streak/10) : 0;
  const lootbox   = streak >= 15 ? 1 : 0;
  if (outcome === "victory") {
    return { pokedollars: base + 5000, superball: superball + 2, lootbox: 2 };
  }
  const factor = outcome === "quit" ? 0.8 : 1.0;
  return { pokedollars: Math.round(base * factor), superball, lootbox: outcome === "defeat" ? lootbox : 0 };
}
