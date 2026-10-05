// Plays one phase (morning or evening) of the simulation. Resumable: progress is
// kept in state.pendingPhase so a paused phase continues where it stopped.

import { NODES } from './data.js';
import {
  actingPeople, activePeople, route, peopleAt, carriedBy, applyOps, applyEating, dailyTick,
  checkEnd, neighbors, resolvePersonId, itemsAt, geometricPath, STABLE_DAYS_TO_END,
} from './engine.js';
import { agentPrompt, refereePrompt, normalizeDecision, emptyDecision, normalizeReferee, placeName } from './prompts.js';

const RECENT_KEEP = 8;

export class Pause extends Error {
  constructor(code, message, { canSkip = false } = {}) {
    super(message);
    this.code = code;
    this.canSkip = canSkip;
  }
}

async function pool(tasks, n) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try { results[i] = { ok: true, value: await tasks[i]() }; }
      catch (e) { results[i] = { ok: false, error: e }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return results;
}

function hasRadio(s, pid) {
  return carriedBy(s, pid).some((i) => i.kind === 'radio');
}

// Who hears each spoken line, given everyone's position after moving.
export function deliverSpeech(s, decisions) {
  const lines = [];
  for (const [pid, d] of Object.entries(decisions)) {
    const p = s.people[pid];
    if (!p || !p.alive || !p.aboard) continue;
    for (const l of d.say || []) {
      const to = (l.to || 'all').toLowerCase();
      let channel = 'voice';
      let hearers;
      if (to === 'radio') {
        if (!hasRadio(s, pid)) { channel = 'voice'; }
        else {
          channel = 'radio';
          hearers = activePeople(s).filter((o) => o.id !== pid && o.conscious && (hasRadio(s, o.id) || o.loc === p.loc));
        }
      } else if (to === 'pa') {
        if (p.loc === 'CTRL') {
          channel = 'PA';
          hearers = activePeople(s).filter((o) => o.id !== pid && o.conscious);
        }
      }
      if (!hearers) hearers = peopleAt(s, p.loc).filter((o) => o.id !== pid && o.conscious);
      const target = resolvePersonId(s, l.to);
      lines.push({ by: pid, loc: p.loc, channel, to: target || (channel === 'voice' ? 'all' : channel), text: l.text, heardBy: hearers.map((h) => h.id) });
    }
  }
  return lines;
}

function observationFor(s, pid, phase, pp, gm, speech, eating) {
  const p = s.people[pid];
  const out = [];
  const mv = pp.moves[pid];
  if (mv) {
    if (mv.blockedBy) {
      const h = s.hatches[mv.blockedBy];
      out.push(`You set out for ${NODES[mv.target] ? placeName(mv.target) : mv.target}, but the hatch between ${placeName(h.a)} and ${placeName(h.b)} was ${h.state}. You ended up in ${placeName(mv.reached)}.`);
    } else if (mv.from !== mv.reached) {
      out.push(`You went to ${placeName(mv.reached)}.`);
    }
  }
  const d = pp.decisions[pid];
  if (d && d.say?.length) out.push('You said: ' + d.say.map((l) => `"${l.text}"`).join(' '));
  for (const l of speech) {
    if (l.by === pid || !l.heardBy.includes(pid)) continue;
    const who = s.people[l.by].name;
    const tag = l.channel === 'radio' ? ' (on the radio)' : l.channel === 'PA' ? ' (over the PA)' : '';
    const toYou = l.to === pid ? ' to you' : l.to && s.people[l.to] ? ` to ${s.people[l.to].short}` : '';
    out.push(`${who}${tag}${toYou}: "${l.text}"`);
  }
  const r = gm.resolutions[pid];
  if (r && r.text && r.result !== 'no_action') out.push(`What came of what you did: ${r.text}`);
  for (const sc of gm.scenes) if (sc.place === p.loc || (mv && sc.place === mv.reached)) out.push(sc.text);
  for (const so of gm.sounds) {
    if (so.from === p.loc) continue;
    const near = neighbors(s, so.from).some((n) => n.node === p.loc);
    if (so.reach === 'station' || near) out.push(`From the direction of ${placeName(so.from)}: ${so.text}`);
  }
  if (eating && eating.ate.length) out.push(`You ate ${eating.ate.join(', ')} (about ${eating.kcal} kcal).`);
  if (phase === 'evening') {
    const k = Math.round(p.intakeToday);
    out.push(k > 0 ? `Altogether today you ate about ${k} kcal.` : 'You ate nothing at all today.');
  }
  const bodies = itemsAt(s, p.loc).filter((i) => i.tags?.includes('body'));
  for (const b of bodies) out.push(`The ${b.name} is here.`);
  return out.join('\n');
}

/**
 * Run (or resume) the current phase.
 * ai: { agent(prompt, opts) -> object, referee(prompt, opts) -> object }
 * hooks.progress({ who, status }) for UI; hooks.checkpoint(state) to persist mid-phase.
 * Returns { phaseLog, tick } where tick is set after the evening.
 */
export async function runPhase(s, ai, { tierAgents = 'default', tierReferee = 'default', concurrency = 2, progress = () => {}, checkpoint = async () => {}, skipReferee = false } = {}) {
  if (s.ended) throw new Pause('ended', 'This run has ended.');
  const phase = s.phase;
  let pp = s.pendingPhase;
  if (!pp || pp.day !== s.day || pp.phase !== phase) {
    pp = s.pendingPhase = { day: s.day, phase, decisions: {}, refused: {}, moves: null, speech: null, gm: null };
  }

  // 1. Decisions from everyone able to act.
  const todo = actingPeople(s).filter((p) => !(p.id in pp.decisions));
  for (const p of actingPeople(s)) progress({ who: p.id, status: p.id in pp.decisions ? 'done' : 'waiting' });
  if (todo.length) {
    const results = await pool(todo.map((p) => async () => {
      progress({ who: p.id, status: 'thinking' });
      const raw = await ai.agent(agentPrompt(s, p.id, phase), { tier: tierAgents });
      return raw;
    }), concurrency);
    let pause = null;
    results.forEach((r, i) => {
      const p = todo[i];
      if (r.ok) {
        pp.decisions[p.id] = normalizeDecision(s, p.id, r.value, phase);
        progress({ who: p.id, status: 'done' });
      } else if (r.error && r.error.kind === 'skip') {
        pp.decisions[p.id] = emptyDecision(phase, r.error.code);
        pp.refused[p.id] = r.error.code;
        progress({ who: p.id, status: 'declined' });
      } else {
        progress({ who: p.id, status: 'failed' });
        pause = pause || r.error;
      }
    });
    await checkpoint(s);
    if (pause) {
      if (pause.kind === 'fatal') throw new Pause(pause.code, pause.message || 'Claude is not available to this page.');
      throw new Pause(pause.code || 'error', pause.message || 'Some crew turns did not finish.');
    }
  }

  // 2. Movement and speech (once).
  if (!pp.moves) {
    pp.moves = {};
    for (const [pid, d] of Object.entries(pp.decisions)) {
      const p = s.people[pid];
      if (!p || !p.alive || !p.aboard || !p.conscious) continue;
      const from = p.loc;
      if (p.restrained || !d.go || /^stay$/i.test(d.go)) { pp.moves[pid] = { from, target: from, reached: from, blockedBy: null }; continue; }
      const r = route(s, pid, d.go);
      p.loc = r.reached;
      pp.moves[pid] = { from, target: r.target, reached: r.reached, blockedBy: r.blockedBy };
    }
    pp.speech = deliverSpeech(s, pp.decisions);
    // Meals happen where people spend the shift, before the referee looks at it.
    pp.eating = {};
    for (const [pid, d] of Object.entries(pp.decisions)) {
      if (d.eat?.length) pp.eating[pid] = applyEating(s, pid, d.eat);
    }
    await checkpoint(s);
  }

  // 3. The referee.
  if (!pp.gm) {
    progress({ who: 'referee', status: 'thinking' });
    if (skipReferee) {
      pp.gm = { resolutions: {}, ops: [], scenes: [], sounds: [], exertion: {}, stable: false, unknownOps: [], skipped: true };
    } else {
      try {
        pp.gm = normalizeReferee(s, await ai.referee(refereePrompt(s, phase, pp), { tier: tierReferee }));
      } catch (e) {
        progress({ who: 'referee', status: 'failed' });
        await checkpoint(s);
        if (e && e.kind === 'skip') throw new Pause(e.code, 'The referee could not resolve this phase.', { canSkip: true });
        if (e && e.kind === 'fatal') throw new Pause(e.code, e.message || 'Claude is not available to this page.');
        throw new Pause((e && e.code) || 'error', (e && e.message) || 'The referee did not finish.', { canSkip: false });
      }
    }
    progress({ who: 'referee', status: 'done' });
  }
  const gm = pp.gm;

  // 4. Apply what happened. People may have acted anywhere they were this phase.
  const visited = {};
  const ends = {};
  for (const [pid, m] of Object.entries(pp.moves)) {
    visited[pid] = [...new Set([m.from, m.reached, ...(geometricPath(s, m.from, m.reached) || [])])];
    ends[pid] = [m.from, m.reached];
  }
  const { applied, rejected } = applyOps(s, gm.ops, { visited, ends });
  for (const u of gm.unknownOps || []) rejected.push({ op: u, reason: 'not a known operation' });
  for (const [pid, ex] of Object.entries(gm.exertion)) if (s.people[pid]) s.people[pid].exertion = ex;

  const eating = pp.eating || {};
  for (const [pid, d] of Object.entries(pp.decisions)) {
    const p = s.people[pid];
    if (phase === 'morning' && !d.skipped) {
      if (d.notes) p.notes = d.notes;
      if (d.journal) p.lastJournal = { day: s.day, text: d.journal };
    }
    if (phase === 'evening' && d.trust && Object.keys(d.trust).length) p.trust = d.trust;
  }

  // 5. What each person perceived.
  const obs = {};
  for (const p of activePeople(s)) {
    if (!p.conscious && !(p.id in pp.decisions)) continue;
    const text = observationFor(s, p.id, phase, pp, gm, pp.speech, eating[p.id]);
    obs[p.id] = text;
    p.recent.push({ day: s.day, phase, loc: p.loc, text });
    if (p.recent.length > RECENT_KEEP) p.recent.splice(0, p.recent.length - RECENT_KEEP);
  }

  const phaseLog = {
    decisions: pp.decisions, refused: pp.refused, moves: pp.moves, speech: pp.speech,
    gm: { resolutions: gm.resolutions, scenes: gm.scenes, sounds: gm.sounds, exertion: gm.exertion, stable: gm.stable, skipped: gm.skipped || false },
    applied, rejected, obs, eating,
    locs: Object.fromEntries(Object.values(s.people).map((p) => [p.id, p.loc])),
  };

  // 6. Night: the station's own physics, then the next morning.
  let tick = null;
  if (phase === 'evening') {
    tick = dailyTick(s);
    const quiet = gm.stable && !tick.events.some((e) => e.kind === 'death' || e.kind === 'collapse') && applied.every((a) => ['note', 'take', 'drop', 'deploy', 'maintain', 'consume'].includes(a.op.op));
    s.stableStreak = quiet ? s.stableStreak + 1 : 0;
    tick.stableStreak = s.stableStreak;
    tick.stableNeeded = STABLE_DAYS_TO_END;
    s.ended = checkEnd(s);
    if (!s.ended) { s.day += 1; s.phase = 'morning'; }
  } else {
    s.phase = 'evening';
  }
  s.pendingPhase = null;
  return { day: pp.day, phase, phaseLog, tick };
}
