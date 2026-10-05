// The rules of the world. Pure functions over a plain JSON state object so the
// whole run can be saved, restored and tested outside the browser.

import { NODES, NODE_DESC, HATCHES, ITEMS, CREW, SYSTEMS, INITIAL_LEVELS, PHYS, STATION } from './data.js';

export const clone = (o) => JSON.parse(JSON.stringify(o));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export const SYSTEM_ROOM = { reactor: 'PWR', heat: 'PWR', electrolyzer: 'LS', scrubber: 'LS', o2_valve: 'LS', hydro: 'HYD', galley: 'GAL' };
export const ENG_HATCHES = new Set(['h_pwr', 'h_ls', 'h_wrk']);
export const STABLE_DAYS_TO_END = 14;

// ---------------------------------------------------------------- creation

export function newRunState(runId) {
  const people = {};
  for (const c of CREW) {
    people[c.id] = {
      id: c.id, name: c.name, short: c.short, loc: c.start,
      alive: true, aboard: true, conscious: true, restrained: false,
      health: 100, weight: c.weightKg, weight0: c.weightKg,
      injuries: [], codes: [...c.codes], notes: '', recent: [], trust: {},
      exertion: 1, intakeToday: 0, lastIntake: 2400, diedDay: null, cause: null,
    };
  }
  const items = {};
  for (const it of ITEMS) items[it.id] = { ...it, kind: it.kind || it.id, hidden: false };
  const s = {
    v: 1, runId, created: Date.now(), day: 1, phase: 'morning',
    people, items, hatches: clone(HATCHES),
    levels: { ...INITIAL_LEVELS },
    health: { reactor: 1, heat: 1, electrolyzer: 1, scrubber: 1, hydro: 1, galley: 1 },
    air: { o2: PHYS.o2KgStart, co2: PHYS.co2KgStart, bank: PHYS.o2BankKg },
    power: { battery: PHYS.batteryStartKwh, fuel: PHYS.fuelCellKwh, supplyKw: 8, loadKw: 13.2, served: {} },
    tempC: 19.5, crop: PHYS.cropStart, hydroCarry: 0,
    pending: { candleKg: 0, liohKg: 0 },
    capsule: 'docked',
    history: [], stableStreak: 0, ended: null, seq: 1,
    pendingPhase: null,
  };
  s.history.push({ ...metrics(s), day: 0 });
  return s;
}

// ---------------------------------------------------------------- people & places

export const person = (s, id) => s.people[id];
export const isActive = (p) => p && p.alive && p.aboard;
export const canAct = (p) => isActive(p) && p.conscious;
export const activePeople = (s) => Object.values(s.people).filter(isActive);
export const actingPeople = (s) => Object.values(s.people).filter(canAct);
export const peopleAt = (s, loc) => activePeople(s).filter((p) => p.loc === loc);

export function resolvePersonId(s, ref) {
  if (!ref) return null;
  const r = String(ref).trim().toLowerCase();
  if (s.people[r]) return r;
  for (const p of Object.values(s.people)) {
    if (p.name.toLowerCase() === r || p.short.toLowerCase() === r) return p.id;
    if (p.name.toLowerCase().includes(r) && r.length > 2) return p.id;
  }
  return null;
}

export function resolveNodeId(ref) {
  if (!ref) return null;
  const r = String(ref).trim();
  const up = r.toUpperCase();
  if (NODES[up]) return up;
  const low = r.toLowerCase();
  for (const [id, n] of Object.entries(NODES)) {
    if (n.name.toLowerCase() === low || n.short.toLowerCase() === low) return id;
  }
  for (const [id, n] of Object.entries(NODES)) {
    if (low.includes(n.name.toLowerCase()) || n.name.toLowerCase().includes(low)) return id;
  }
  return null;
}

export function neighbors(s, node) {
  const out = [];
  for (const [hid, h] of Object.entries(s.hatches)) {
    if (h.a === node) out.push({ node: h.b, hatch: hid });
    else if (h.b === node) out.push({ node: h.a, hatch: hid });
  }
  return out;
}

export function hatchBetween(s, a, b) {
  for (const [hid, h] of Object.entries(s.hatches)) {
    if ((h.a === a && h.b === b) || (h.a === b && h.b === a)) return hid;
  }
  return null;
}

// Does this person hold what opens a locked hatch?
export function canUnlock(s, pid, hid) {
  const h = s.hatches[hid];
  const p = s.people[pid];
  if (!h || !p) return false;
  const lock = h.lock || 'master';
  if (lock.startsWith('key:')) {
    const keyId = lock.slice(4);
    const key = s.items[keyId];
    return !!key && key.qty > 0 && key.loc === pid;
  }
  if (p.codes.includes('master')) return true;
  if (lock === 'eng') return p.codes.includes('eng');
  return false;
}

// Module hatches have an internal release: you can always let yourself out of a
// locked room. A padlock only opens from the side it hangs on, with its key.
export function canPass(s, pid, hid, fromNode) {
  const h = s.hatches[hid];
  if (!h) return false;
  if (h.state === 'open' || h.state === 'closed' || h.state === 'forced') return true;
  if (h.state === 'locked') {
    const from = fromNode || s.people[pid]?.loc;
    if (h.padlockSide) return from === h.padlockSide && canUnlock(s, pid, hid);
    if (from === h.b && NODES[h.b].kind === 'module' || from === h.b && h.b === 'CAP') return true;
    return canUnlock(s, pid, hid);
  }
  return false; // barricaded, welded
}

// The station is a tree, so the geometric path is the only path.
export function geometricPath(s, from, to) {
  if (from === to) return [from];
  const prev = { [from]: null };
  const q = [from];
  while (q.length) {
    const n = q.shift();
    for (const { node } of neighbors(s, n)) {
      if (node in prev) continue;
      prev[node] = n;
      if (node === to) {
        const path = [to];
        let c = n;
        while (c) { path.unshift(c); c = prev[c]; }
        return path;
      }
      q.push(node);
    }
  }
  return null;
}

export function route(s, pid, to) {
  const p = s.people[pid];
  const target = resolveNodeId(to) || p.loc;
  const path = geometricPath(s, p.loc, target) || [p.loc];
  const walked = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const hid = hatchBetween(s, path[i - 1], path[i]);
    if (!canPass(s, pid, hid, path[i - 1])) {
      return { target, path: walked, reached: walked[walked.length - 1], blockedBy: hid };
    }
    walked.push(path[i]);
  }
  return { target, path: walked, reached: target, blockedBy: null };
}

// ---------------------------------------------------------------- items

export const itemsAt = (s, loc, { hidden = true } = {}) =>
  Object.values(s.items).filter((i) => i.loc === loc && i.qty > 0 && (hidden || !i.hidden));
export const carriedBy = (s, pid) => itemsAt(s, pid);

export function findItem(s, ref, pid, { seeHidden = true } = {}) {
  if (!ref) return null;
  const r = String(ref).trim();
  const visible = (i) => seeHidden || !i.hidden || i.hiddenBy === pid;
  const p = pid ? s.people[pid] : null;
  const reach = (i) => p && (i.loc === pid || wasAt(p, i.loc));
  const exact = s.items[r] && s.items[r].qty > 0 && visible(s.items[r]) ? s.items[r] : null;
  if (exact && (!p || reach(exact))) return exact;
  // Resolve a kind or a name to the entry this person can reach.
  const low = r.toLowerCase();
  const all = Object.values(s.items).filter((i) => i.qty > 0 && visible(i));
  if (exact) {
    const same = all.find((i) => i.kind === exact.kind && i.name === exact.name && reach(i));
    return same || exact;
  }
  const matches = all.filter((i) => i.kind === r || i.id.split('#')[0] === r || i.name.toLowerCase() === low);
  const loose = matches.length ? matches : all.filter((i) => i.name.toLowerCase().includes(low) && low.length > 3);
  if (p) {
    const mine = loose.find((i) => i.loc === pid) || loose.find((i) => i.loc === p.loc) || loose.find((i) => wasAt(p, i.loc));
    if (mine) return mine;
  }
  return loose[0] || null;
}

// During a phase people move; the referee may describe things they did before
// leaving or on the way. Ops accept any place the person was in this phase.
let phaseCtx = { visited: {}, ends: {} };
export function wasAt(p, loc) {
  return p.loc === loc || !!phaseCtx.visited[p.id]?.includes(loc);
}
function together(a, b) {
  if (a.loc === b.loc) return true;
  const ea = phaseCtx.ends[a.id];
  const eb = phaseCtx.ends[b.id];
  return !!(ea && eb && ea.some((n) => eb.includes(n)));
}

export function accessible(s, pid, item) {
  const p = s.people[pid];
  return !!(item && p && item.qty > 0 && (item.loc === pid || wasAt(p, item.loc)));
}

// Move qty units of an item entry to a location or person, merging stacks by kind.
export function moveItem(s, itemId, qty, dest, { merge = true } = {}) {
  const it = s.items[itemId];
  if (!it) return null;
  const n = Math.min(it.qty, qty ?? it.qty);
  if (n <= 0) return null;
  let target = merge
    ? Object.values(s.items).find((i) => i.kind === it.kind && i.loc === dest && i.id !== it.id && i.name === it.name && !i.hidden)
    : null;
  if (n === it.qty && !target) {
    it.loc = dest;
    it.hidden = false;
    delete it.hiddenBy;
    return it;
  }
  it.qty -= n;
  if (!target) {
    const id = `${it.kind}#${s.seq++}`;
    target = s.items[id] = { ...it, id, qty: 0, loc: dest, hidden: false };
    delete target.hiddenBy;
  }
  target.qty += n;
  if (it.qty <= 0) delete s.items[itemId];
  return target;
}

export function consumeItem(s, itemId, qty) {
  const it = s.items[itemId];
  if (!it) return 0;
  const n = Math.min(it.qty, qty ?? 1);
  it.qty -= n;
  if (it.qty <= 0) delete s.items[itemId];
  return n;
}

export function foodKcal(s, filter = () => true) {
  let k = 0;
  for (const i of Object.values(s.items)) if (i.kcal && filter(i)) k += i.kcal * i.qty;
  return k;
}

// ---------------------------------------------------------------- derived readings

export const o2Pct = (s) => (s.air.o2 / PHYS.airKg) * 100 * (29 / 32);
export const co2Pct = (s) => (s.air.co2 / PHYS.airKg) * 100 * (29 / 44);

export function powerPlan(s) {
  const lv = s.levels;
  const h = s.health;
  const eff = (x) => (x >= 0.5 ? 1 : Math.max(0, x * 2));
  const reactorKw = PHYS.reactorKw * clamp(lv.reactor, 0, 1.15) * (h.reactor >= 0.6 ? 1 : Math.max(0, h.reactor / 0.6));
  // The air plant runs to a setpoint (20.9% O2, CO2 down to ~0.05%), never above its setting.
  const people = activePeople(s);
  const use = people.length * PHYS.o2PerPerson;
  const o2Target = PHYS.airKg * 0.209 * (32 / 29);
  const o2Need = clamp((o2Target - s.air.o2 + use) / PHYS.electrolyzerKgDay, 0, 1);
  const co2Need = clamp((s.air.co2 - 0.9 + people.length * PHYS.co2PerPerson) / PHYS.scrubberKgDay, 0, 1);
  const want = {
    base: SYSTEMS.base.kw,
    electrolyzer: SYSTEMS.electrolyzer.kw * Math.min(clamp(lv.electrolyzer, 0, 1), o2Need) * (h.electrolyzer > 0 ? 1 : 0),
    scrubber: SYSTEMS.scrubber.kw * Math.min(clamp(lv.scrubber, 0, 1), co2Need) * (h.scrubber > 0 ? 1 : 0),
    hydro: SYSTEMS.hydro.kw * clamp(lv.hydro, 0, 1) * (h.hydro > 0 ? 1 : 0),
    galley: SYSTEMS.galley.kw * clamp(lv.galley, 0, 1) * (h.galley > 0 ? 1 : 0),
  };
  // Heating is thermostatic: only what is needed to approach 20 °C.
  const otherKw = Object.values(want).reduce((a, b) => a + b, 0) + people.length * 0.1;
  const teqNoHeat = STATION.waterTempC + PHYS.tempPerKw * otherKw;
  const heatNeed = Math.max(0, (20 - teqNoHeat) / PHYS.tempPerKw);
  want.heat = Math.min(SYSTEMS.heat.kw * clamp(lv.heat, 0, 1) * (h.heat > 0 ? 1 : 0), heatNeed);
  const loadKw = Object.values(want).reduce((a, b) => a + b, 0);
  return { reactorKw, want, loadKw, eff };
}

// ---------------------------------------------------------------- ops (the referee's proposals)

const OPS = {};
const fail = (reason) => ({ ok: false, reason });
const okr = (summary) => ({ ok: true, summary });

function needPerson(s, ref, { acting = false, active = true } = {}) {
  const id = resolvePersonId(s, ref);
  const p = id && s.people[id];
  if (!p) return [null, `unknown person "${ref}"`];
  if (active && !isActive(p)) return [null, `${p.short} is not present`];
  if (acting && !canAct(p)) return [null, `${p.short} cannot act`];
  return [p, null];
}

OPS.move_person = (s, op) => {
  const [p, e] = needPerson(s, op.person);
  if (e) return fail(e);
  const to = resolveNodeId(op.to);
  if (!to) return fail(`unknown place "${op.to}"`);
  if (to === p.loc) return okr(`${p.short} stays in ${NODES[to].name}`);
  if (to === 'CAP' && s.capsule !== 'docked') return fail('the capsule is gone');
  const path = geometricPath(s, p.loc, to);
  if (!path) return fail(`no way from ${NODES[p.loc].name} to ${NODES[to].name}`);
  for (let i = 1; i < path.length; i++) {
    const hid = hatchBetween(s, path[i - 1], path[i]);
    const h = s.hatches[hid];
    if (!['open', 'closed', 'forced'].includes(h.state) && !canPass(s, p.id, hid, path[i - 1])) return fail(`the ${NODES[h.a].name} / ${NODES[h.b].name} hatch is ${h.state}`);
  }
  p.loc = to;
  return okr(`${p.short} moves to ${NODES[to].name}`);
};

OPS.take = (s, op) => {
  const [p, e] = needPerson(s, op.person, { acting: true });
  if (e) return fail(e);
  const it = findItem(s, op.item, p.id);
  if (!it || typeof it.loc !== 'string' || !NODES[it.loc] || !wasAt(p, it.loc)) return fail(`${op.item} is not where ${p.short} was`);
  const n = Math.min(it.qty, Math.max(1, Math.floor(op.qty ?? it.qty)));
  moveItem(s, it.id, n, p.id);
  return okr(`${p.short} takes ${n} × ${it.name}`);
};

OPS.drop = (s, op) => {
  const [p, e] = needPerson(s, op.person);
  if (e) return fail(e);
  const it = findItem(s, op.item, p.id);
  if (!it || it.loc !== p.id) return fail(`${p.short} is not carrying ${op.item}`);
  const n = Math.min(it.qty, Math.max(1, Math.floor(op.qty ?? it.qty)));
  moveItem(s, it.id, n, p.loc);
  return okr(`${p.short} leaves ${n} × ${it.name} in ${NODES[p.loc].name}`);
};

OPS.transfer = (s, op) => {
  const [a, e1] = needPerson(s, op.from);
  if (e1) return fail(e1);
  const [b, e2] = needPerson(s, op.to);
  if (e2) return fail(e2);
  if (!together(a, b)) return fail(`${a.short} and ${b.short} are not together`);
  const it = findItem(s, op.item, a.id);
  if (!it || it.loc !== a.id) return fail(`${a.short} is not carrying ${op.item}`);
  const n = Math.min(it.qty, Math.max(1, Math.floor(op.qty ?? it.qty)));
  moveItem(s, it.id, n, b.id);
  return okr(`${n} × ${it.name} passes from ${a.short} to ${b.short}`);
};

OPS.hide = (s, op) => {
  const [p, e] = needPerson(s, op.person, { acting: true });
  if (e) return fail(e);
  const it = findItem(s, op.item, p.id);
  if (!accessible(s, p.id, it)) return fail(`${op.item} is not within reach`);
  const n = Math.min(it.qty, Math.max(1, Math.floor(op.qty ?? it.qty)));
  const placed = it.loc === p.id || n < it.qty ? moveItem(s, it.id, n, p.loc, { merge: false }) : it;
  placed.hidden = op.hidden !== false;
  if (placed.hidden) placed.hiddenBy = p.id;
  else delete placed.hiddenBy;
  return okr(`${p.short} ${op.hidden === false ? 'uncovers' : 'hides'} ${it.name} in ${NODES[p.loc].name}`);
};

OPS.consume = (s, op) => {
  let pid = null;
  if (op.by) {
    const [p, e] = needPerson(s, op.by);
    if (e) return fail(e);
    pid = p.id;
  }
  const it = findItem(s, op.item, pid);
  if (!it) return fail(`no ${op.item}`);
  if (pid && !accessible(s, pid, it)) return fail(`${op.item} is not within reach`);
  const kcal = it.kcal || 0;
  const n = consumeItem(s, it.id, Math.max(1, Math.floor(op.qty ?? 1)));
  if (pid && kcal && it.tags?.includes('food')) {
    s.people[pid].intakeToday += kcal * n;
    return okr(`${s.people[pid].short} eats ${n} × ${it.name}`);
  }
  return okr(`${n} × ${it.name} used up`);
};

OPS.create = (s, op) => {
  const [p, e] = needPerson(s, op.by, { acting: true });
  if (e) return fail(e);
  const name = String(op.name || '').trim().slice(0, 80);
  if (!name) return fail('a created item needs a name');
  const uses = Array.isArray(op.consumes) ? op.consumes : [];
  const plan = [];
  for (const u of uses) {
    const it = findItem(s, u.item, p.id);
    const n = Math.max(1, Math.floor(u.qty ?? 1));
    if (!accessible(s, p.id, it)) return fail(`${p.short} cannot reach ${u.item}`);
    if (it.qty < n) return fail(`not enough ${it.name} (${it.qty} of ${n})`);
    plan.push([it.id, n]);
  }
  if (!plan.length && !op.from_nothing) return fail('making something requires materials');
  for (const [id, n] of plan) consumeItem(s, id, n);
  const id = `made#${s.seq++}`;
  const tags = Array.isArray(op.tags) ? op.tags.map(String).slice(0, 6) : [];
  const weapon = Number(op.weapon) || 0;
  if (weapon && !tags.includes('weapon')) tags.push('weapon');
  s.items[id] = {
    id, kind: id, name, qty: Math.max(1, Math.floor(op.qty ?? 1)), loc: op.where === 'here' ? p.loc : p.id,
    tags, weapon: weapon ? clamp(weapon, 1, 4) : undefined, made: { by: p.id, day: s.day }, hidden: false,
    desc: op.desc ? String(op.desc).slice(0, 200) : undefined,
  };
  return okr(`${p.short} makes ${name}`);
};

OPS.hatch = (s, op) => {
  const hid = op.hatch;
  const h = s.hatches[hid];
  if (!h) return fail(`unknown hatch "${hid}"`);
  const [p, e] = needPerson(s, op.by, { acting: true });
  if (e) return fail(e);
  const atHatch = wasAt(p, h.a) || wasAt(p, h.b);
  const remote = wasAt(p, 'CTRL');
  const electronic = !(h.lock || '').startsWith('key:');
  const want = op.state;
  const label = `${NODES[h.a].name} / ${NODES[h.b].name} hatch`;
  switch (want) {
    case 'open':
    case 'closed': {
      if (!atHatch && !(remote && electronic && h.state === 'locked' && want === 'closed')) return fail(`${p.short} is not at the ${label}`);
      if (h.state === 'locked' && !(atHatch ? (canPass(s, p.id, hid, h.a) && wasAt(p, h.a)) || (canPass(s, p.id, hid, h.b) && wasAt(p, h.b)) : canUnlock(s, p.id, hid))) return fail(`${p.short} cannot unlock the ${label}`);
      delete h.padlockSide;
      if (h.state === 'barricaded' && h.barricadeSide && h.barricadeSide !== p.loc) return fail(`the ${label} is barricaded from the other side`);
      if (h.state === 'welded') return fail(`the ${label} is welded shut; it must be cut open`);
      h.state = h.state === 'forced' && want === 'closed' ? 'forced' : want;
      delete h.barricadeSide;
      return okr(`${label} ${want === 'open' ? 'opened' : 'closed'} by ${p.short}`);
    }
    case 'locked': {
      if (h.state === 'forced') return fail(`the lock on the ${label} is broken`);
      if (op.lock === 'padlock') {
        if (!atHatch) return fail(`${p.short} is not at the ${label}`);
        const pad = findItem(s, 'padlock', p.id);
        if (!accessible(s, p.id, pad)) return fail(`${p.short} has no padlock`);
        consumeItem(s, pad.id, 1);
        const keyId = `padkey#${s.seq++}`;
        s.items[keyId] = { id: keyId, kind: keyId, name: `padlock key (${label})`, qty: 1, loc: p.id, tags: ['key'], hidden: false };
        h.prevLock = h.prevLock || h.lock;
        h.lock = `key:${keyId}`;
        h.padlockSide = wasAt(p, h.a) && p.loc !== h.b ? h.a : h.b;
        h.state = 'locked';
        return okr(`${p.short} padlocks the ${label} from the ${NODES[p.loc].name} side`);
      }
      if (!atHatch && !(remote && electronic)) return fail(`${p.short} is not at the ${label} or the control console`);
      if (!canUnlock(s, p.id, hid)) return fail(`${p.short} does not have the code or key for the ${label}`);
      h.state = 'locked';
      return okr(`${label} locked by ${p.short}`);
    }
    case 'barricaded': {
      if (!atHatch) return fail(`${p.short} is not at the ${label}`);
      h.state = 'barricaded';
      h.barricadeSide = p.loc === h.a || p.loc === h.b ? p.loc : (wasAt(p, h.a) ? h.a : h.b);
      return okr(`${p.short} barricades the ${label} from the ${NODES[h.barricadeSide].name} side`);
    }
    case 'welded': {
      if (!atHatch) return fail(`${p.short} is not at the ${label}`);
      const w = findItem(s, 'arc_welder', p.id);
      if (!accessible(s, p.id, w)) return fail(`${p.short} has no welder here`);
      h.state = 'welded';
      h.weldSide = p.loc === h.a || p.loc === h.b ? p.loc : (wasAt(p, h.a) ? h.a : h.b);
      return okr(`${p.short} welds the ${label} shut`);
    }
    case 'forced': {
      if (!atHatch) return fail(`${p.short} is not at the ${label}`);
      if (h.state === 'welded') {
        const t = findItem(s, 'cutting_torch', p.id);
        if (!accessible(s, p.id, t)) return fail('cutting a welded hatch needs the cutting torch');
      }
      h.state = 'forced';
      delete h.barricadeSide;
      delete h.padlockSide;
      return okr(`${p.short} forces the ${label} open`);
    }
    default:
      return fail(`unknown hatch state "${want}"`);
  }
};

function systemAccess(s, p, system) {
  const room = SYSTEM_ROOM[system];
  if (!room) return `unknown system "${system}"`;
  if (wasAt(p, room)) return null;
  if (wasAt(p, 'PWR') && system !== 'o2_valve') return null; // the switchboard
  if (wasAt(p, 'CTRL')) {
    if (system === 'reactor') return 'the reactor can only be adjusted in the power room';
    if (p.codes.includes('master') || p.codes.includes('eng')) return null;
    return `${p.short} has no console code`;
  }
  return `${p.short} is not where ${system} is controlled`;
}

OPS.set_system = (s, op) => {
  const [p, e] = needPerson(s, op.by, { acting: true });
  if (e) return fail(e);
  const sys = op.system;
  const err = systemAccess(s, p, sys);
  if (err) return fail(err);
  const max = sys === 'reactor' ? 1.15 : 1;
  const lv = clamp(Number(op.level), 0, max);
  if (!Number.isFinite(lv)) return fail('level must be a number');
  s.levels[sys] = round(lv, 2);
  return okr(`${p.short} sets ${sys} to ${Math.round(lv * 100)}%`);
};

const HEALTH_KEY = (sys) => (sys === 'o2_valve' ? null : sys);

OPS.maintain = (s, op) => {
  const [p, e] = needPerson(s, op.by, { acting: true });
  if (e) return fail(e);
  const key = HEALTH_KEY(op.system);
  if (!key || !(key in s.health)) return fail(`unknown system "${op.system}"`);
  if (!wasAt(p, SYSTEM_ROOM[key])) return fail(`${p.short} is not in the ${NODES[SYSTEM_ROOM[key]].name}`);
  if (s.health[key] <= 0.15) return fail(`${key} is too badly damaged for routine maintenance; it needs repair with parts`);
  s.health[key] = round(Math.min(1, s.health[key] + 0.25), 3);
  return okr(`${p.short} services the ${key}`);
};

OPS.damage = (s, op) => {
  const [p, e] = needPerson(s, op.by);
  if (e) return fail(e);
  const key = HEALTH_KEY(op.system);
  if (!key || !(key in s.health)) return fail(`unknown system "${op.system}"`);
  if (!wasAt(p, SYSTEM_ROOM[key])) return fail(`${p.short} is not in the ${NODES[SYSTEM_ROOM[key]].name}`);
  const amt = clamp(Number(op.amount) || 0.2, 0, 1);
  s.health[key] = round(Math.max(0, s.health[key] - amt), 3);
  return okr(`${key} damaged (${Math.round(amt * 100)}%)`);
};

OPS.repair = (s, op) => {
  const [p, e] = needPerson(s, op.by, { acting: true });
  if (e) return fail(e);
  const key = HEALTH_KEY(op.system);
  if (!key || !(key in s.health)) return fail(`unknown system "${op.system}"`);
  if (!wasAt(p, SYSTEM_ROOM[key])) return fail(`${p.short} is not in the ${NODES[SYSTEM_ROOM[key]].name}`);
  const uses = Array.isArray(op.consumes) ? op.consumes : [];
  if (!uses.length) return fail('repairs need parts');
  for (const u of uses) {
    const it = findItem(s, u.item, p.id);
    if (!accessible(s, p.id, it)) return fail(`${p.short} cannot reach ${u.item}`);
  }
  for (const u of uses) consumeItem(s, findItem(s, u.item, p.id).id, Math.max(1, Math.floor(u.qty ?? 1)));
  const amt = clamp(Number(op.amount) || 0.4, 0, 1);
  s.health[key] = round(Math.min(1, s.health[key] + amt), 3);
  return okr(`${p.short} repairs the ${key}`);
};

OPS.deploy = (s, op) => {
  const [p, e] = needPerson(s, op.by, { acting: true });
  if (e) return fail(e);
  const it = findItem(s, op.item, p.id);
  if (!accessible(s, p.id, it)) return fail(`${p.short} cannot reach ${op.item}`);
  const n = consumeItem(s, it.id, Math.max(1, Math.floor(op.qty ?? 1)));
  if (it.kind === 'o2_candle') s.pending.candleKg += n * PHYS.candleKg;
  else if (it.kind === 'lioh') s.pending.liohKg += n * PHYS.liohKg;
  else if (it.kind === 'o2_bottle') s.pending.candleKg += n * 1.2;
  else return fail(`${it.name} is not an air supply`);
  return okr(`${p.short} uses ${n} × ${it.name}`);
};

function addBody(s, p) {
  for (const it of carriedBy(s, p.id)) moveItem(s, it.id, it.qty, p.loc);
  const id = `body#${p.id}`;
  s.items[id] = { id, kind: id, name: `body of ${p.name}`, qty: 1, loc: p.loc, tags: ['body', 'heavy'], hidden: false };
}

export function killPerson(s, p, cause) {
  if (!p.alive) return;
  p.alive = false;
  p.conscious = false;
  p.health = 0;
  p.diedDay = s.day;
  p.cause = cause;
  addBody(s, p);
}

OPS.injure = (s, op) => {
  const [p, e] = needPerson(s, op.person);
  if (e) return fail(e);
  if (op.by) {
    const [a, e2] = needPerson(s, op.by);
    if (e2) return fail(e2);
    if (!together(a, p)) return fail(`${a.short} is not with ${p.short}`);
  }
  const sev = clamp(Math.round(Number(op.severity) || 1), 1, 5);
  p.injuries.push({ sev, desc: String(op.desc || 'injury').slice(0, 120), treated: false, day: s.day, age: 0 });
  p.health = Math.max(0, p.health - sev * 8);
  if (p.health <= 0) killPerson(s, p, String(op.desc || 'injuries'));
  else p.conscious = p.health >= 15;
  return okr(`${p.short} injured (severity ${sev}): ${op.desc || ''}`);
};

OPS.treat = (s, op) => {
  const [p, e] = needPerson(s, op.person);
  if (e) return fail(e);
  const [d, e2] = needPerson(s, op.by, { acting: true });
  if (e2) return fail(e2);
  if (!together(d, p)) return fail(`${d.short} is not with ${p.short}`);
  for (const u of Array.isArray(op.consumes) ? op.consumes : []) {
    const it = findItem(s, u.item, d.id);
    if (accessible(s, d.id, it)) consumeItem(s, it.id, Math.max(1, Math.floor(u.qty ?? 1)));
  }
  for (const inj of p.injuries) inj.treated = true;
  return okr(`${d.short} treats ${p.short}`);
};

OPS.kill = (s, op) => {
  const [p, e] = needPerson(s, op.person);
  if (e) return fail(e);
  if (op.by) {
    const [a, e2] = needPerson(s, op.by);
    if (e2) return fail(e2);
    if (!together(a, p)) return fail(`${a.short} is not with ${p.short}`);
  }
  killPerson(s, p, String(op.cause || 'killed').slice(0, 120));
  return okr(`${p.short} dies: ${op.cause || ''}`);
};

OPS.restrain = (s, op) => {
  const [p, e] = needPerson(s, op.person);
  if (e) return fail(e);
  const on = op.restrained !== false;
  if (op.by) {
    const [a, e2] = needPerson(s, op.by, { acting: true });
    if (e2) return fail(e2);
    if (!together(a, p)) return fail(`${a.short} is not with ${p.short}`);
  }
  p.restrained = on;
  return okr(`${p.short} ${on ? 'restrained' : 'freed'}`);
};

OPS.learn_code = (s, op) => {
  const [p, e] = needPerson(s, op.person);
  if (e) return fail(e);
  if (!['master', 'eng'].includes(op.code)) return fail(`unknown code "${op.code}"`);
  if (!p.codes.includes(op.code)) p.codes.push(op.code);
  return okr(`${p.short} now knows the ${op.code} code`);
};

OPS.launch_capsule = (s, op) => {
  const [p, e] = needPerson(s, op.by, { acting: true });
  if (e) return fail(e);
  if (p.loc !== 'CAP') return fail(`${p.short} is not in the capsule`);
  if (s.capsule !== 'docked') return fail('the capsule is gone');
  const riders = peopleAt(s, 'CAP');
  if (riders.length > 8) return fail('the capsule seats eight');
  for (const r of riders) {
    r.aboard = false;
    r.leftDay = s.day;
    r.cause = 'left in the escape capsule';
    for (const it of carriedBy(s, r.id)) delete s.items[it.id];
  }
  for (const it of itemsAt(s, 'CAP')) delete s.items[it.id];
  s.capsule = 'launched';
  s.hatches.h_cap.state = 'closed';
  return okr(`the capsule launches with ${riders.map((r) => r.short).join(', ')}`);
};

OPS.note = (s, op) => okr(String(op.text || '').slice(0, 200));

export const OP_NAMES = Object.keys(OPS);

export function applyOps(s, ops, { visited = {}, ends = {} } = {}) {
  phaseCtx = { visited, ends };
  const applied = [];
  const rejected = [];
  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op || typeof op !== 'object' || !OPS[op.op]) {
      rejected.push({ op, reason: `unknown operation "${op && op.op}"` });
      continue;
    }
    let r;
    try {
      r = OPS[op.op](s, op);
    } catch (err) {
      r = fail(`error: ${err.message}`);
    }
    if (r.ok) applied.push({ op, summary: r.summary });
    else rejected.push({ op, reason: r.reason });
  }
  phaseCtx = { visited: {}, ends: {} };
  return { applied, rejected };
}

// ---------------------------------------------------------------- eating

// People name food loosely ("ration", "ration_pack#3", "GAL"). The intent to eat is
// clear, so match generously, but only ever to food that is actually within reach.
function matchFood(s, pid, ref) {
  const exact = findItem(s, ref, pid, { seeHidden: false });
  if (exact && exact.tags?.includes('food') && accessible(s, pid, exact)) return exact;
  const foods = Object.values(s.items).filter((i) => i.qty > 0 && i.kcal && i.tags?.includes('food') && accessible(s, pid, i) && (!i.hidden || i.hiddenBy === pid));
  if (!foods.length) return null;
  const base = String(ref || '').toLowerCase().replace(/[#@].*$/, '');
  const byKind = foods.find((i) => i.kind === base);
  if (byKind) return byKind;
  const words = base.split(/[^a-z]+/).filter((w) => w.length > 2);
  const byWord = foods.find((i) => words.some((w) => i.name.toLowerCase().includes(w)));
  if (byWord) return byWord;
  const rank = (i) => (i.loc === pid ? 0 : 2) + (i.kind === 'ration_pack' ? 0 : 1);
  return foods.sort((a, b) => rank(a) - rank(b) || b.qty - a.qty)[0];
}

export function applyEating(s, pid, list) {
  const p = s.people[pid];
  if (!canAct(p) || !Array.isArray(list)) return { kcal: 0, ate: [] };
  const ate = [];
  let kcal = 0;
  for (const e of list.slice(0, 6)) {
    const it = matchFood(s, pid, e && e.item);
    if (!it) continue;
    const want = clamp(Math.floor(Number(e.qty) || 1), 1, 12);
    const n = consumeItem(s, it.id, want);
    kcal += (it.kcal || 0) * n;
    ate.push(`${n} × ${it.name}`);
  }
  p.intakeToday += kcal;
  return { kcal, ate };
}

// ---------------------------------------------------------------- the daily tick

export function dailyTick(s) {
  const events = [];
  const people = activePeople(s);
  const lv = s.levels;
  const plan = powerPlan(s);
  const { eff } = plan;

  // Power balance over the day.
  const supplyKwh = plan.reactorKw * 24;
  const demandKwh = plan.loadKw * 24;
  let deficit = demandKwh - supplyKwh;
  if (deficit <= 0) {
    s.power.battery = Math.min(PHYS.batteryKwh, s.power.battery - deficit);
    deficit = 0;
  } else {
    const fromBat = Math.min(s.power.battery, deficit);
    s.power.battery -= fromBat;
    deficit -= fromBat;
    const fromFuel = Math.min(s.power.fuel, deficit);
    s.power.fuel -= fromFuel;
    deficit -= fromFuel;
  }
  // Shed load in breaker priority if storage ran dry.
  const served = {};
  for (const k of Object.keys(plan.want)) served[k] = plan.want[k] > 0 ? 1 : 0;
  if (deficit > 0.01) {
    let remaining = deficit / 24; // kW short
    for (const k of ['hydro', 'galley', 'heat', 'electrolyzer', 'scrubber', 'base']) {
      if (remaining <= 0) break;
      const kw = plan.want[k];
      if (kw <= 0) continue;
      const cut = Math.min(kw, remaining);
      served[k] = (kw - cut) / kw;
      remaining -= cut;
    }
  }
  const shedNow = Object.entries(served).filter(([k, v]) => plan.want[k] > 0 && v < 0.999).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ');
  if (shedNow !== (s.power.shedText || '')) {
    events.push({ kind: 'power', text: shedNow ? `Batteries and fuel cells are empty. Breakers tripped: ${shedNow}.` : 'Power is back in balance; nothing is being shed.' });
    s.power.shedText = shedNow;
  }
  s.power.supplyKw = round(plan.reactorKw, 2);
  s.power.loadKw = round(plan.loadKw, 2);
  s.power.served = served;

  // Wear.
  const overdrive = Math.max(0, lv.reactor - 1) / 0.15;
  s.health.reactor = Math.max(0, s.health.reactor - 0.003 * (1 + 4 * overdrive) * (lv.reactor > 0 ? 1 : 0));
  s.health.electrolyzer = Math.max(0, s.health.electrolyzer - 0.007 * lv.electrolyzer);
  s.health.scrubber = Math.max(0, s.health.scrubber - 0.007 * lv.scrubber);
  s.health.hydro = Math.max(0, s.health.hydro - 0.005 * lv.hydro);
  s.health.galley = Math.max(0, s.health.galley - 0.002 * lv.galley);
  s.health.heat = Math.max(0, s.health.heat - 0.002);

  // Air.
  const actFactor = (p) => (!p.conscious ? 0.7 : [0.75, 1, 1.35][clamp(p.exertion ?? 1, 0, 2)]);
  const o2Use = people.reduce((a, p) => a + PHYS.o2PerPerson * actFactor(p), 0);
  const co2Make = people.reduce((a, p) => a + PHYS.co2PerPerson * actFactor(p), 0);
  const elecFrac = served.electrolyzer * (plan.want.electrolyzer / SYSTEMS.electrolyzer.kw) * eff(s.health.electrolyzer);
  const o2Elec = PHYS.electrolyzerKgDay * elecFrac;
  const valve = Math.min(s.air.bank, PHYS.o2ValveKgDay * clamp(lv.o2_valve, 0, 1));
  s.air.bank -= valve;
  s.air.o2 = Math.max(0, s.air.o2 - o2Use + o2Elec + valve + s.pending.candleKg);
  const scrubFrac = served.scrubber * (plan.want.scrubber / SYSTEMS.scrubber.kw) * eff(s.health.scrubber);
  s.air.co2 = Math.max(0.6, s.air.co2 + co2Make - PHYS.scrubberKgDay * scrubFrac - s.pending.liohKg);
  s.pending = { candleKg: 0, liohKg: 0 };

  // Temperature: every watt used inside ends up as heat.
  const dissipated = Object.entries(plan.want).reduce((a, [k, kw]) => a + kw * served[k], 0) + people.length * 0.1;
  const teq = STATION.waterTempC + PHYS.tempPerKw * dissipated;
  s.tempC = round(s.tempC + 0.5 * (teq - s.tempC), 2);

  // Hydroponics.
  const light = served.hydro * (plan.want.hydro / SYSTEMS.hydro.kw) * eff(s.health.hydro);
  const nutr = findItem(s, 'nutrients');
  const nutrNeed = light;
  let fed = true;
  if (light > 0) {
    if (nutr && nutr.loc === 'HYD' && nutr.qty >= 1) {
      s.nutrientCarry = (s.nutrientCarry || 0) + nutrNeed;
      const whole = Math.floor(s.nutrientCarry);
      if (whole > 0) { consumeItem(s, nutr.id, whole); s.nutrientCarry -= whole; }
    } else fed = false;
  }
  s.crop = clamp(s.crop + 0.03 * (light - 0.3) - (fed ? 0 : 0.04), 0, 1);
  const kcal = PHYS.hydroKcalDay * s.crop * light * (fed ? 1 : 0.5);
  s.hydroCarry += kcal / 300;
  const units = Math.floor(s.hydroCarry);
  if (units > 0) {
    s.hydroCarry -= units;
    const pile = Object.values(s.items).find((i) => i.kind === 'produce' && i.loc === 'HYD');
    if (pile) pile.qty += units;
    else {
      const id = `produce#${s.seq++}`;
      s.items[id] = { id, kind: 'produce', name: 'fresh produce (300 kcal)', qty: units, loc: 'HYD', tags: ['food'], kcal: 300, hidden: false };
    }
  }

  // Spoilage.
  for (const it of Object.values(s.items)) {
    if (!it.tags?.includes('perishable')) continue;
    const cold = it.loc === 'STR' && served.galley * eff(s.health.galley) > 0.5;
    if (!cold && it.qty > 0) {
      const lost = Math.max(1, Math.ceil(it.qty * 0.12));
      consumeItem(s, it.id, lost);
    }
  }
  for (const it of Object.values(s.items)) if (it.kind === 'produce' && it.qty > 0) {
    if (it.qty > 60) consumeItem(s, it.id, Math.ceil((it.qty - 60) * 0.1));
  }

  // Bodies.
  const o2 = o2Pct(s);
  const co2 = co2Pct(s);
  const T = s.tempC;
  for (const p of people) {
    const intake = p.intakeToday;
    const lossFrac = Math.max(0, (p.weight0 - p.weight) / p.weight0);
    const adapt = 1 - 1.2 * lossFrac;
    const need = (31 * p.weight * adapt) + [-200, 0, 400][clamp(p.exertion ?? 1, 0, 2)] + (T < 15 ? (15 - T) * 40 : 0);
    p.weight = round(p.weight + Math.min(0.15, (intake - need) / PHYS.kcalPerKg), 3);
    p.lastIntake = intake;
    p.intakeToday = 0;
    const loss = Math.max(0, (p.weight0 - p.weight) / p.weight0);
    const hits = [];
    if (loss > 0.15) hits.push(['starvation', (loss - 0.15) * 25]);
    if (o2 < 16.5) hits.push(['lack of oxygen', (16.5 - o2) * 2 + (o2 < 11 ? 20 : 0) + (o2 < 8 ? 60 : 0)]);
    if (co2 > 3) hits.push(['CO2 poisoning', (co2 - 3) * 4 + (co2 > 6 ? 25 : 0) + (co2 > 8 ? 60 : 0)]);
    if (T < 10) hits.push(['hypothermia', (10 - T) * 1.2]);
    for (const inj of p.injuries) {
      inj.age = (inj.age || 0) + 1;
      if (!inj.treated && inj.sev >= 3) hits.push([inj.desc || 'untreated injuries', (inj.sev - 2) * 2]);
      const healEvery = inj.treated ? 4 : 7;
      if (inj.age % healEvery === 0 && (inj.treated || inj.sev <= 2)) inj.sev -= 1;
    }
    p.injuries = p.injuries.filter((i) => i.sev > 0);
    const dmg = hits.reduce((a, [, v]) => a + v, 0);
    if (dmg > 0) p.health -= dmg;
    else if (intake >= 1500 && loss < 0.15) p.health += 3;
    p.health = round(clamp(p.health, 0, 100), 1);
    if (p.health <= 0) {
      const cause = hits.sort((a, b) => b[1] - a[1])[0]?.[0] || 'their condition';
      killPerson(s, p, cause);
      events.push({ kind: 'death', who: p.id, text: `${p.name} died (${cause}).` });
    } else {
      const was = p.conscious;
      p.conscious = p.health >= 15;
      if (was && !p.conscious) events.push({ kind: 'collapse', who: p.id, text: `${p.name} lost consciousness.` });
    }
  }

  const rec = metrics(s);
  s.history.push(rec);
  return { events, metrics: rec };
}

export function metrics(s) {
  const act = activePeople(s);
  return {
    day: s.day,
    o2: round(o2Pct(s), 2),
    co2: round(co2Pct(s), 2),
    temp: round(s.tempC, 1),
    energy: Math.round(s.power.battery + s.power.fuel),
    food: Math.round(foodKcal(s, (i) => !String(i.loc).startsWith('CAP'))),
    crop: round(s.crop * 100, 0),
    alive: act.length,
    health: act.length ? round(act.reduce((a, p) => a + p.health, 0) / act.length, 0) : 0,
    supply: round(s.power.supplyKw, 1),
    load: round(s.power.loadKw, 1),
  };
}

// ---------------------------------------------------------------- what a person perceives

export function hungerWords(p) {
  const loss = Math.max(0, (p.weight0 - p.weight) / p.weight0);
  const parts = [];
  if (p.lastIntake < 600) parts.push('You are painfully hungry');
  else if (p.lastIntake < 1500) parts.push('You are hungry');
  if (loss > 0.25) parts.push('your body is wasting; your clothes hang off you and you are weak');
  else if (loss > 0.12) parts.push('you have lost a lot of weight and tire easily');
  else if (loss > 0.05) parts.push('you have lost some weight');
  return parts.join('; ');
}

export function bodyFeel(s, p) {
  const out = [];
  const h = p.health;
  if (h < 25) out.push('You are critically weak; standing is hard.');
  else if (h < 50) out.push('You feel ill and weak.');
  else if (h < 75) out.push('You feel run down.');
  const hw = hungerWords(p);
  if (hw) out.push(hw + '.');
  const o2 = o2Pct(s);
  const co2 = co2Pct(s);
  if (o2 < 12) out.push('You are gasping; your lips and fingers are blue and thinking is like wading through mud.');
  else if (o2 < 15) out.push('The air feels thin. You are breathless after a few steps and have a pounding headache.');
  else if (o2 < 17) out.push('You get winded more easily than you should.');
  if (co2 > 5) out.push('Your head is splitting, your heart races and you feel confused and panicky.');
  else if (co2 > 3) out.push('You have a heavy headache and feel short of breath and sluggish.');
  else if (co2 > 1.5) out.push('The air feels stuffy and you have a dull headache.');
  if (s.tempC < 8) out.push('It is bitterly cold; you shiver constantly and your hands are clumsy.');
  else if (s.tempC < 13) out.push('It is cold in the station; you are wearing every layer you have.');
  else if (s.tempC < 17) out.push('It is chilly.');
  for (const inj of p.injuries) out.push(`Injury: ${inj.desc} (${['', 'minor', 'painful', 'serious', 'severe', 'life-threatening'][inj.sev]}${inj.treated ? ', treated' : ', untreated'}).`);
  if (p.restrained) out.push('You are restrained and cannot move freely or use your hands.');
  return out.length ? out.join(' ') : 'You are physically all right.';
}

export function readouts(s, loc) {
  const lines = [];
  const lvl = (k) => `${Math.round((s.levels[k] ?? 0) * 100)}%`;
  const hp = (k) => `${Math.round(s.health[k] * 100)}% condition`;
  const pw = () => [
    `Reactor output ${s.power.supplyKw.toFixed(1)} kW (set ${lvl('reactor')}, ${hp('reactor')}); total load ${s.power.loadKw.toFixed(1)} kW.`,
    `Battery ${Math.round(s.power.battery)} of ${PHYS.batteryKwh} kWh; fuel cells ${Math.round(s.power.fuel)} of ${PHYS.fuelCellKwh} kWh.`,
    `Settings: heating ${lvl('heat')}, electrolyzer ${lvl('electrolyzer')}, scrubber ${lvl('scrubber')}, hydroponics lights ${lvl('hydro')}, galley/cold store ${lvl('galley')}, oxygen bank valve ${lvl('o2_valve')}.`,
  ];
  const air = () => [
    `Oxygen ${o2Pct(s).toFixed(1)}% (normal 20.9). CO2 ${co2Pct(s).toFixed(2)}% (normal under 0.5; dangerous above 3). Temperature ${s.tempC.toFixed(1)} °C.`,
    `Oxygen bank ${Math.round(s.air.bank)} kg. Electrolyzer ${hp('electrolyzer')}, scrubber ${hp('scrubber')}.`,
  ];
  if (loc === 'CTRL') {
    lines.push('CONSOLE:', ...air(), ...pw());
    lines.push(`Hydroponics crop health ${Math.round(s.crop * 100)}%. Food in all stores about ${Math.round(foodKcal(s, (i) => ['GAL', 'STR', 'HYD'].includes(i.loc)) / 1000)} thousand kcal.`);
    lines.push('Hatch states: ' + Object.entries(s.hatches).map(([id, h]) => `${NODES[h.a].short}-${NODES[h.b].short} ${h.state}`).join(', ') + '.');
    lines.push('Comms: no carrier on any channel. Hydrophones: ambient sea noise only.');
  } else if (loc === 'PWR') {
    lines.push('SWITCHBOARD:', ...pw());
  } else if (loc === 'LS') {
    lines.push('LIFE-SUPPORT PANEL:', ...air());
  } else if (loc === 'HYD') {
    lines.push(`Crop health ${Math.round(s.crop * 100)}%. Grow lights at ${lvl('hydro')}. Grow system ${hp('hydro')}.`);
  }
  return lines.join('\n');
}

export function hatchView(s, loc, pid) {
  return neighbors(s, loc).map(({ node, hatch }) => {
    const h = s.hatches[hatch];
    let st = h.state;
    if (st === 'locked') st = `locked (${(h.lock || '').startsWith('key:') ? 'needs a key' : h.lock === 'eng' ? 'engineering code' : 'master code'})${canUnlock(s, pid, hatch) ? ' - you can open it' : ''}`;
    if (st === 'barricaded') st = `barricaded from the ${h.barricadeSide === loc ? 'this' : 'other'} side`;
    if (st === 'welded') st = 'welded shut';
    if (st === 'forced') st = 'forced open (lock broken)';
    if (hatch === 'h_cap' && s.capsule !== 'docked') st = 'sealed; the capsule is gone';
    return `${hatch} to ${NODES[node].name} [${node}]: ${st}`;
  }).join('\n');
}

export function describePresent(s, loc, selfId) {
  const others = peopleAt(s, loc).filter((p) => p.id !== selfId);
  if (!others.length) return 'Nobody else is here.';
  return others.map((p) => {
    const bits = [];
    if (!p.conscious) bits.push('unconscious');
    if (p.restrained) bits.push('restrained');
    if (p.injuries.some((i) => i.sev >= 3)) bits.push('visibly badly hurt');
    else if (p.injuries.length) bits.push('hurt');
    const loss = (p.weight0 - p.weight) / p.weight0;
    if (loss > 0.2) bits.push('gaunt');
    if (p.health < 40 && p.conscious) bits.push('looks very ill');
    const weapons = carriedBy(s, p.id).filter((i) => (i.weapon || 0) >= 2 && !i.hidden).map((i) => i.name);
    if (weapons.length) bits.push(`carrying ${weapons.join(', ')}`);
    return `${p.name}${bits.length ? ` (${bits.join('; ')})` : ''}`;
  }).join('\n');
}

export function describeItems(s, loc) {
  const list = itemsAt(s, loc, { hidden: false });
  if (!list.length) return 'Nothing loose of note.';
  return list.map((i) => `${i.name} ×${i.qty} [${i.id}]`).join('\n');
}

export function describeCarried(s, pid) {
  const list = carriedBy(s, pid);
  if (!list.length) return 'Nothing.';
  return list.map((i) => `${i.name} ×${i.qty} [${i.id}]`).join('\n');
}

// ---------------------------------------------------------------- end conditions

export function checkEnd(s) {
  const act = activePeople(s);
  if (!act.length) {
    const left = Object.values(s.people).filter((p) => p.alive && !p.aboard).length;
    return { reason: left ? 'Nobody is left aboard.' : 'Everyone aboard has died.', day: s.day };
  }
  if (s.stableStreak >= STABLE_DAYS_TO_END) return { reason: `Nothing meaningful changed for ${STABLE_DAYS_TO_END} days.`, day: s.day };
  return null;
}
