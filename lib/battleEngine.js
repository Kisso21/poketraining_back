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

// STATUS_INFLICT: type d'attaque → statut infligé (10% de chance)
const STATUS_INFLICT = { feu:"brulure", poison:"poison", electrik:"paralysie", glace:"gel" };

// Résout une attaque — retourne { dmg, eff, ko, miss, crit, statusApplied, log, newHP }
// defStatusArr: tableau des statuts du défenseur (modifié in-place si statut appliqué)
// defStatusIdx: index du défenseur dans son équipe
export function resolveAttack(attacker, atkType, useSpecial, defender, currentDefHP, defStatusArr, defStatusIdx) {
  if (Math.random() < 0.05) {
    return { dmg:0, eff:1, ko:false, miss:true, crit:false, statusApplied:null, statusLog:null, newHP:currentDefHP,
      log:`${pokeName(attacker)} rate son attaque !` };
  }
  const crit = Math.random() < 0.05;
  const baseDmg = calcDamage(attacker, atkType, defender, useSpecial);
  const dmg  = crit ? Math.max(1, Math.floor(baseDmg * 1.5)) : baseDmg;
  const eff  = getEffectiveness(atkType, defender.type1, defender.type2);
  const newHP = Math.max(0, currentDefHP - dmg);
  const stat  = useSpecial ? "Atq. Spé." : "ATQ";
  const ko    = newHP <= 0;

  // Appliquer un statut si possible
  let statusApplied = null;
  if (!ko && defStatusArr != null && defStatusIdx >= 0 && defStatusArr[defStatusIdx] == null) {
    const possible = STATUS_INFLICT[norm(atkType)];
    if (possible && Math.random() < 0.10) {
      statusApplied = possible;
      defStatusArr[defStatusIdx] = statusApplied;
    }
  }

  const critText = crit ? " Coup critique !" : "";
  const log = `${pokeName(attacker)} utilise ${atkType} (${stat})${effText(eff)} — ${dmg>0?`-${dmg} PV`:"sans effet"}${critText}${ko?` · ${pokeName(defender)} est K.O. !`:""}`;
  const statusLog = statusApplied
    ? `${pokeName(defender)} est ${statusApplied === "brulure" ? "brûlé(e)" : statusApplied === "poison" ? "empoisonné(e)" : statusApplied === "paralysie" ? "paralysé(e)" : "gelé(e)"} !`
    : null;
  return { dmg, eff, ko, miss:false, crit, statusApplied, statusLog, log, newHP };
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
    p1Status: team1.map(() => null),
    p2Status: team2.map(() => null),
    turn: 1,
    winner: null,
    waitingFor: "both",  // "both"|"p1"|"p2"|"switch_p1"|"switch_p2"
  };
}

// Vérifie si un attaquant peut attaquer selon son statut.
// Modifie statusArr in-place si dégel. Retourne { can, log }.
function checkCanAttack(statusArr, activeIdx, poke) {
  const status = statusArr?.[activeIdx];
  if (!status) return { can: true, log: null };
  if (status === "gel") {
    if (Math.random() < 0.25) {
      statusArr[activeIdx] = null;
      return { can: false, log: `${pokeName(poke)} dégèle !` };
    }
    return { can: false, log: `${pokeName(poke)} est gelé et ne peut pas attaquer !` };
  }
  if (status === "paralysie" && Math.random() < 0.125) {
    return { can: false, log: `${pokeName(poke)} est paralysé et ne peut pas attaquer !` };
  }
  return { can: true, log: null };
}

// Résout un tour complet avec les deux actions simultanées
// actions: { p1: { type:"attack"|"switch", atkType?, useSpecial?, switchIdx? },
//            p2: { type:"attack"|"switch", atkType?, useSpecial?, switchIdx? } }
// opts.playerChoosesSwitch: si true, ne substitue pas p1 automatiquement sur KO (laisse le joueur choisir)
// Retourne { newState, logs }
export function resolveTurn(state, team1, team2, actions, names = {}, opts = {}) {
  const n1   = names.p1 || "Joueur 1";
  const n2   = names.p2 || "Joueur 2";
  const s    = JSON.parse(JSON.stringify(state)); // deep clone
  const logs = [];

  // Initialiser les tableaux de statuts s'ils sont absents (rétrocompatibilité)
  if (!s.p1Status) s.p1Status = team1.map(() => null);
  if (!s.p2Status) s.p2Status = team2.map(() => null);

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

  // ── Attaques (priorité à la vitesse, paralysie réduit la vitesse de moitié) ──
  const atk1 = actions.p1?.type === "attack" ? actions.p1 : null;
  const atk2 = actions.p2?.type === "attack" ? actions.p2 : null;

  if (!atk1 && !atk2) {
    s.waitingFor = "both";
    s.turn++;
    return { newState: s, logs, secondKoedByFirst: false, p1First: false };
  }

  const p1Par = s.p1Status[s.p1Active] === "paralysie";
  const p2Par = s.p2Status[s.p2Active] === "paralysie";
  const sp1 = (team1[s.p1Active]?.speed || 0) * (p1Par ? 0.5 : 1);
  const sp2 = (team2[s.p2Active]?.speed || 0) * (p2Par ? 0.5 : 1);
  const p1First = atk1 && (!atk2 || sp1 > sp2 || (sp1 === sp2 && Math.random() >= 0.5));

  const doAtk = (attacker, atkType, useSpecial, defenderPoke, defHP, hpArr, activeIdx,
                 atkStatusArr, atkIdx, defStatusArr, defStatusIdx) => {
    const { can, log: blockLog } = checkCanAttack(atkStatusArr, atkIdx, attacker);
    if (!can) { if (blockLog) logs.push(blockLog); return false; }
    const res = resolveAttack(attacker, atkType, useSpecial, defenderPoke, defHP, defStatusArr, defStatusIdx);
    hpArr[activeIdx] = res.newHP;
    logs.push(res.log);
    if (res.statusLog) logs.push(res.statusLog);
    return res.ko;
  };

  // secondKoedByFirst : le pokemon du second attaquant a été KO avant qu'il puisse agir
  let secondKoedByFirst = false;

  // Premier attaquant
  if (p1First && atk1) {
    const ko = doAtk(team1[s.p1Active], atk1.atkType, atk1.useSpecial,
                     team2[s.p2Active], s.p2HP[s.p2Active], s.p2HP, s.p2Active,
                     s.p1Status, s.p1Active, s.p2Status, s.p2Active);
    if (ko) {
      secondKoedByFirst = true;
      const next = nextAlive(s.p2HP);
      if (next === -1) { s.winner = "p1"; s.waitingFor = "none"; s.turn++; return { newState: s, logs, secondKoedByFirst: true, p1First }; }
      s.p2Active = next;
      logs.push(`${n2} envoie ${pokeName(team2[next])} !`);
    }
  } else if (!p1First && atk2) {
    const ko = doAtk(team2[s.p2Active], atk2.atkType, atk2.useSpecial,
                     team1[s.p1Active], s.p1HP[s.p1Active], s.p1HP, s.p1Active,
                     s.p2Status, s.p2Active, s.p1Status, s.p1Active);
    if (ko) {
      secondKoedByFirst = true;
      const next = nextAlive(s.p1HP);
      if (next === -1) { s.winner = "p2"; s.waitingFor = "none"; s.turn++; return { newState: s, logs, secondKoedByFirst: true, p1First }; }
      if (opts.playerChoosesSwitch) {
        s.waitingFor = "switch_p1"; s.turn++;
        return { newState: s, logs, secondKoedByFirst: true, p1First };
      }
      s.p1Active = next;
      logs.push(`${n1} envoie ${pokeName(team1[next])} !`);
    }
  }

  if (s.winner) return { newState: s, logs, secondKoedByFirst, p1First };

  // Deuxième attaquant — seulement si son pokemon n'a pas été KO au premier tour
  if (p1First && atk2 && !secondKoedByFirst) {
    const ko = doAtk(team2[s.p2Active], atk2.atkType, atk2.useSpecial,
                     team1[s.p1Active], s.p1HP[s.p1Active], s.p1HP, s.p1Active,
                     s.p2Status, s.p2Active, s.p1Status, s.p1Active);
    if (ko) {
      const next = nextAlive(s.p1HP);
      if (next === -1) { s.winner = "p2"; s.waitingFor = "none"; s.turn++; return { newState: s, logs, secondKoedByFirst: false }; }
      if (opts.playerChoosesSwitch) {
        s.waitingFor = "switch_p1"; s.turn++;
        return { newState: s, logs, secondKoedByFirst: false, p1First };
      }
      s.p1Active = next;
      logs.push(`${n1} envoie ${pokeName(team1[next])} !`);
    }
  } else if (!p1First && atk1 && !secondKoedByFirst) {
    const ko = doAtk(team1[s.p1Active], atk1.atkType, atk1.useSpecial,
                     team2[s.p2Active], s.p2HP[s.p2Active], s.p2HP, s.p2Active,
                     s.p1Status, s.p1Active, s.p2Status, s.p2Active);
    if (ko) {
      const next = nextAlive(s.p2HP);
      if (next === -1) { s.winner = "p1"; s.waitingFor = "none"; s.turn++; return { newState: s, logs, secondKoedByFirst: false }; }
      s.p2Active = next;
      logs.push(`${n2} envoie ${pokeName(team2[next])} !`);
    }
  }

  // ── Dégâts de fin de tour (brûlure / poison) ─────────────────────────
  if (!s.winner) {
    for (const [side, hpArr, maxHPArr, statusArr, teamArr, label, oppWin] of [
      ["p1", s.p1HP, s.p1MaxHP, s.p1Status, team1, n1, "p2"],
      ["p2", s.p2HP, s.p2MaxHP, s.p2Status, team2, n2, "p1"],
    ]) {
      const active = side === "p1" ? s.p1Active : s.p2Active;
      const status = statusArr[active];
      if ((status === "brulure" || status === "poison") && hpArr[active] > 0) {
        const tick = Math.max(1, Math.floor(maxHPArr[active] * 0.125));
        hpArr[active] = Math.max(0, hpArr[active] - tick);
        const label2 = status === "brulure" ? "brûlure" : "poison";
        logs.push(`${pokeName(teamArr[active])} souffre de ${label2} (−${tick} PV).`);
        if (hpArr[active] <= 0) {
          logs.push(`${pokeName(teamArr[active])} est K.O. !`);
          const next = nextAlive(hpArr);
          if (next === -1) {
            s.winner = oppWin;
          } else if (side === "p1" && opts.playerChoosesSwitch) {
            s.waitingFor = "switch_p1";
            s.turn++;
            return { newState: s, logs, secondKoedByFirst, p1First };
          } else {
            if (side === "p1") s.p1Active = next; else s.p2Active = next;
            logs.push(`${label} envoie ${pokeName(teamArr[next])} !`);
          }
        }
      }
      if (s.winner) break;
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
