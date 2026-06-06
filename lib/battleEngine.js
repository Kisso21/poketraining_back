// Moteur de combat PokéVersus — logique pure, sans état ni I/O

export const norm = t => (t || "").toLowerCase()
  .replace(/[éèê]/g,"e").replace(/î/g,"i").replace(/ô/g,"o").trim();

export const TYPE_CHART = {
  normal:   { roche:0.5, acier:0.5, spectre:0 },
  feu:      { plante:2, glace:2, insecte:2, acier:2, feu:0.5, eau:0.5, roche:0.5, dragon:0.5 },
  eau:      { feu:2, sol:2, roche:2, eau:0.5, plante:0.5, dragon:0.5 },
  electrik: { eau:2, vol:2, plante:0.5, electrik:0.5, dragon:0.5, sol:0 },
  plante:   { eau:2, sol:2, roche:2, feu:0.5, plante:0.5, poison:0.5, vol:0.5, insecte:0.5, dragon:0.5, acier:0.5 },
  glace:    { plante:2, sol:2, vol:2, dragon:2, feu:0.5, eau:0.5, glace:0.5, acier:0.5 },
  combat:   { normal:2, glace:2, roche:2, tenebres:2, acier:2, poison:0.5, insecte:0.5, psy:0.5, vol:0.5, spectre:0 },
  poison:   { plante:2, poison:0.5, sol:0.5, roche:0.5, spectre:0.5, acier:0 },
  sol:      { feu:2, electrik:2, poison:2, roche:2, acier:2, plante:0.5, insecte:0.5, vol:0 },
  vol:      { plante:2, combat:2, insecte:2, electrik:0.5, roche:0.5, acier:0.5 },
  psy:      { combat:2, poison:2, psy:0.5, acier:0.5, tenebres:0 },
  insecte:  { plante:2, psy:2, tenebres:2, feu:0.5, combat:0.5, vol:0.5, spectre:0.5, acier:0.5 },
  roche:    { feu:2, glace:2, vol:2, insecte:2, combat:0.5, sol:0.5, acier:0.5 },
  spectre:  { psy:2, spectre:2, tenebres:0.5, acier:0.5, normal:0 },
  dragon:   { dragon:2, acier:0.5 },
  tenebres: { psy:2, spectre:2, combat:0.5, tenebres:0.5, acier:0.5 },
  acier:    { glace:2, roche:2, feu:0.5, eau:0.5, electrik:0.5, acier:0.5 },
};

const BATTLE_POWER = 65;
export const HP_SCALE = 1.5;
const MIN_DEF = 30;

export const pokeName  = p => p.nom || p.name || "?";
export const getTypes  = p => { const t=[p.type1]; if(p.type2&&p.type2!==p.type1) t.push(p.type2); return t; };
export const initHP    = team => team.map(p => Math.round((p.hp || 45) * HP_SCALE));
export const nextAlive = hpArr => hpArr.findIndex(hp => hp > 0);

function atkStat(p, special) { return special ? (p.sp_atk || 50) : (p.atk || 50); }
function defStat(p, special) { return Math.max(MIN_DEF, special ? (p.sp_def || 50) : (p.def || 50)); }

export function getEffectiveness(atkType, def1, def2) {
  const a=norm(atkType), d1=norm(def1), d2=norm(def2 || "");
  const e1 = TYPE_CHART[a]?.[d1] ?? 1;
  const e2 = d2 && d2!==d1 ? (TYPE_CHART[a]?.[d2] ?? 1) : 1;
  return e1 * e2;
}

function effText(eff) {
  if (eff===0)  return " Aucun effet !";
  if (eff>=4)   return " C'est super méga efficace !!";
  if (eff>=2)   return " C'est super efficace !";
  if (eff<1)    return " Ce n'est pas très efficace…";
  return "";
}

export function calcDamage(attacker, atkType, defender, useSpecial) {
  const atkN = norm(atkType);
  const eff  = getEffectiveness(atkType, defender.type1, defender.type2);
  if (eff===0) return 0;
  const stab = (norm(attacker.type1)===atkN || norm(attacker.type2||"")===atkN) ? 1.5 : 1;
  const rand = 0.85 + Math.random() * 0.15;
  const base = Math.floor((22 * BATTLE_POWER * atkStat(attacker,useSpecial) / defStat(defender,useSpecial)) / 50) + 2;
  return Math.max(1, Math.floor(base * eff * stab * rand));
}

// Résout une attaque — retourne { dmg, eff, ko, miss, log, newHP }
export function resolveAttack(attacker, atkType, useSpecial, defender, currentDefHP) {
  if (Math.random() < 0.05) {
    return { dmg:0, eff:1, ko:false, miss:true, newHP:currentDefHP,
      log:`${pokeName(attacker)} rate son attaque !` };
  }
  const dmg = calcDamage(attacker, atkType, defender, useSpecial);
  const eff  = getEffectiveness(atkType, defender.type1, defender.type2);
  const newHP = Math.max(0, currentDefHP - dmg);
  const stat  = useSpecial ? "Atq. Spé." : "ATQ";
  const ko    = newHP <= 0;
  const log   = `${pokeName(attacker)} utilise ${atkType} (${stat})${effText(eff)} — ${dmg>0?`-${dmg} PV`:"sans effet"}${ko?` · ${pokeName(defender)} est K.O. !`:""}`;
  return { dmg, eff, ko, miss:false, log, newHP };
}

// Initialise l'état de combat pour un match
export function initBattleState(team1, team2) {
  const p1HP = initHP(team1);
  const p2HP = initHP(team2);
  return {
    p1HP, p2HP,
    p1MaxHP: [...p1HP],
    p2MaxHP: [...p2HP],
    p1Active: 0,
    p2Active: 0,
    turn: 1,
    winner: null,
    waitingFor: "both",  // "both"|"p1"|"p2"|"switch_p1"|"switch_p2"
  };
}

// Résout un tour complet avec les deux actions simultanées
// actions: { p1: { type:"attack"|"switch", atkType?, useSpecial?, switchIdx? },
//            p2: { type:"attack"|"switch", atkType?, useSpecial?, switchIdx? } }
// Retourne { newState, logs }
export function resolveTurn(state, team1, team2, actions, names = {}) {
  const n1   = names.p1 || "Joueur 1";
  const n2   = names.p2 || "Joueur 2";
  const s    = JSON.parse(JSON.stringify(state)); // deep clone
  const logs = [];

  // ── Switches d'abord ──────────────────────────────────────────
  if (actions.p1?.type === "switch") {
    const idx = actions.p1.switchIdx;
    if (idx >= 0 && idx < team1.length && s.p1HP[idx] > 0 && idx !== s.p1Active) {
      s.p1Active = idx;
      logs.push(`${n1} envoie ${pokeName(team1[idx])} !`);
    }
  }
  if (actions.p2?.type === "switch") {
    const idx = actions.p2.switchIdx;
    if (idx >= 0 && idx < team2.length && s.p2HP[idx] > 0 && idx !== s.p2Active) {
      s.p2Active = idx;
      logs.push(`${n2} envoie ${pokeName(team2[idx])} !`);
    }
  }

  // ── Attaques (priorité à la vitesse) ─────────────────────────
  const atk1 = actions.p1?.type === "attack" ? actions.p1 : null;
  const atk2 = actions.p2?.type === "attack" ? actions.p2 : null;

  if (!atk1 && !atk2) {
    s.waitingFor = "both";
    s.turn++;
    return { newState: s, logs, secondKoedByFirst: false, p1First: false };
  }

  const sp1 = team1[s.p1Active]?.speed || 0;
  const sp2 = team2[s.p2Active]?.speed || 0;
  const p1First = atk1 && (!atk2 || sp1 > sp2 || (sp1 === sp2 && Math.random() >= 0.5));

  const doAtk = (attacker, atkType, useSpecial, defenderPoke, defHP, hpArr, activeIdx) => {
    const res = resolveAttack(attacker, atkType, useSpecial, defenderPoke, defHP);
    hpArr[activeIdx] = res.newHP;
    logs.push(res.log);
    return res.ko;
  };

  // secondKoedByFirst : le pokemon du second attaquant a été KO avant qu'il puisse agir
  let secondKoedByFirst = false;

  // Premier attaquant
  if (p1First && atk1) {
    const ko = doAtk(team1[s.p1Active], atk1.atkType, atk1.useSpecial,
                     team2[s.p2Active], s.p2HP[s.p2Active], s.p2HP, s.p2Active);
    if (ko) {
      secondKoedByFirst = true; // p2's pokemon mourut avant d'attaquer
      const next = nextAlive(s.p2HP);
      if (next === -1) { s.winner = "p1"; s.waitingFor = "none"; s.turn++; return { newState: s, logs, secondKoedByFirst: true, p1First }; }
      s.p2Active = next;
      logs.push(`${n2} envoie ${pokeName(team2[next])} !`);
    }
  } else if (!p1First && atk2) {
    const ko = doAtk(team2[s.p2Active], atk2.atkType, atk2.useSpecial,
                     team1[s.p1Active], s.p1HP[s.p1Active], s.p1HP, s.p1Active);
    if (ko) {
      secondKoedByFirst = true; // p1's pokemon mourut avant d'attaquer
      const next = nextAlive(s.p1HP);
      if (next === -1) { s.winner = "p2"; s.waitingFor = "none"; s.turn++; return { newState: s, logs, secondKoedByFirst: true, p1First }; }
      s.p1Active = next;
      logs.push(`${n1} envoie ${pokeName(team1[next])} !`);
    }
  }

  if (s.winner) return { newState: s, logs, secondKoedByFirst, p1First };

  // Deuxième attaquant — seulement si son pokemon n'a pas été KO au premier tour
  if (p1First && atk2 && !secondKoedByFirst) {
    const ko = doAtk(team2[s.p2Active], atk2.atkType, atk2.useSpecial,
                     team1[s.p1Active], s.p1HP[s.p1Active], s.p1HP, s.p1Active);
    if (ko) {
      const next = nextAlive(s.p1HP);
      if (next === -1) { s.winner = "p2"; s.waitingFor = "none"; s.turn++; return { newState: s, logs, secondKoedByFirst: false }; }
      s.p1Active = next;
      logs.push(`${n1} envoie ${pokeName(team1[next])} !`);
    }
  } else if (!p1First && atk1 && !secondKoedByFirst) {
    const ko = doAtk(team1[s.p1Active], atk1.atkType, atk1.useSpecial,
                     team2[s.p2Active], s.p2HP[s.p2Active], s.p2HP, s.p2Active);
    if (ko) {
      const next = nextAlive(s.p2HP);
      if (next === -1) { s.winner = "p1"; s.waitingFor = "none"; s.turn++; return { newState: s, logs, secondKoedByFirst: false }; }
      s.p2Active = next;
      logs.push(`${n2} envoie ${pokeName(team2[next])} !`);
    }
  }

  s.turn++;
  s.waitingFor = s.winner ? "none" : "both";
  return { newState: s, logs, secondKoedByFirst, p1First };
}

// Auto-action pour un joueur AFK (première attaque possible)
export function autoAction(pokemon) {
  const types = getTypes(pokemon);
  return { type: "attack", atkType: types[0], useSpecial: false };
}
