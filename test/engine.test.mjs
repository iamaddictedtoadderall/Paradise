import test from 'node:test';
import assert from 'node:assert/strict';
import { NODES, HATCHES, ITEMS, CREW } from '../js/data.js';
import {
  newRunState, route, applyOps, applyEating, dailyTick, findItem, o2Pct, co2Pct, foodKcal, checkEnd,
  geometricPath, STABLE_DAYS_TO_END,
} from '../js/engine.js';
import { agentPrompt, refereePrompt, normalizeDecision, normalizeReferee } from '../js/prompts.js';
import { runPhase, deliverSpeech, Pause } from '../js/runner.js';
import { mockAI } from './mock-ai.mjs';

test('the world is consistent', () => {
  for (const h of Object.values(HATCHES)) assert.ok(NODES[h.a] && NODES[h.b]);
  const ids = new Set(CREW.map((c) => c.id));
  for (const it of ITEMS) assert.ok(NODES[it.loc] || ids.has(it.loc), `bad location for ${it.id}`);
  const s = newRunState('t');
  for (const a of Object.keys(NODES)) for (const b of Object.keys(NODES)) assert.ok(geometricPath(s, a, b), `${a}→${b}`);
  assert.ok(Math.abs(o2Pct(s) - 20.8) < 0.2);
  assert.equal(s.history[0].day, 0);
});

test('locks: codes, keys and the internal release', () => {
  const s = newRunState('t');
  // Tomás has no engineering code: stopped outside the power room.
  const t = route(s, 'tomas', 'PWR');
  assert.equal(t.reached, 'AH');
  assert.equal(t.blockedBy, 'h_pwr');
  assert.equal(route(s, 'pavel', 'PWR').reached, 'PWR');
  // Only the key holder gets into the stores; anyone inside can get out.
  s.people.tomas.loc = 'GAL';
  assert.equal(route(s, 'tomas', 'STR').reached, 'GAL');
  s.people.danny.loc = 'GAL';
  assert.equal(route(s, 'danny', 'STR').reached, 'STR');
  s.people.tomas.loc = 'STR';
  assert.equal(route(s, 'tomas', 'GAL').reached, 'GAL');
});

test('padlocks only open from their side', () => {
  const s = newRunState('t');
  s.people.tomas.loc = 'WRK';
  applyOps(s, [{ op: 'take', person: 'tomas', item: 'padlock', qty: 1 }]);
  s.people.tomas.loc = 'MC';
  const r = applyOps(s, [{ op: 'hatch', hatch: 'h_hyd', state: 'locked', lock: 'padlock', by: 'tomas' }]);
  assert.equal(r.rejected.length, 0, JSON.stringify(r.rejected));
  s.people.hana.loc = 'HYD';
  assert.equal(route(s, 'hana', 'MC').reached, 'HYD', 'trapped inside');
  assert.equal(route(s, 'tomas', 'HYD').reached, 'HYD', 'key holder outside can open');
});

test('making things uses up real materials within reach', () => {
  const s = newRunState('t');
  s.people.tomas.loc = 'ROV';
  let r = applyOps(s, [{ op: 'create', by: 'tomas', name: 'spear', consumes: [{ item: 'steel_pipe', qty: 1 }], weapon: 3 }]);
  assert.equal(r.applied.length, 0);
  s.people.tomas.loc = 'WRK';
  const before = findItem(s, 'steel_pipe').qty;
  r = applyOps(s, [{ op: 'create', by: 'tomas', name: 'spear', consumes: [{ item: 'steel_pipe', qty: 1 }, { item: 'duct_tape', qty: 1 }], weapon: 3 }]);
  assert.equal(r.applied.length, 1);
  assert.equal(findItem(s, 'steel_pipe').qty, before - 1);
  const spear = Object.values(s.items).find((i) => i.name === 'spear');
  assert.equal(spear.loc, 'tomas');
  assert.equal(spear.weapon, 3);
  assert.ok(spear.tags.includes('weapon'));
});

test('system settings only change from the right place', () => {
  const s = newRunState('t');
  let r = applyOps(s, [{ op: 'set_system', system: 'hydro', level: 0, by: 'tomas' }]);
  assert.equal(r.applied.length, 0);
  r = applyOps(s, [{ op: 'set_system', system: 'hydro', level: 0.3, by: 'pavel' }]);
  assert.equal(r.applied.length, 1);
  assert.equal(s.levels.hydro, 0.3);
  r = applyOps(s, [{ op: 'set_system', system: 'reactor', level: 2, by: 'ruth' }]);
  assert.equal(r.applied.length, 0, 'reactor is not adjustable from control');
  r = applyOps(s, [{ op: 'set_system', system: 'reactor', level: 2, by: 'pavel' }]);
  assert.equal(s.levels.reactor, 1.15);
});

test('violence, death and bodies', () => {
  const s = newRunState('t');
  s.people.tomas.loc = 'GAL';
  let r = applyOps(s, [{ op: 'injure', person: 'danny', severity: 3, by: 'tomas', desc: 'deep cut to the arm' }]);
  assert.equal(r.applied.length, 1);
  assert.equal(s.people.danny.health, 76);
  r = applyOps(s, [{ op: 'kill', person: 'danny', by: 'tomas', cause: 'stabbed' }]);
  assert.equal(s.people.danny.alive, false);
  const body = s.items['body#danny'];
  assert.equal(body.loc, 'GAL');
  assert.equal(findItem(s, 'stores_key').loc, 'GAL', 'the key falls where he died');
  r = applyOps(s, [{ op: 'injure', person: 'victoria', severity: 2, by: 'tomas' }]);
  assert.equal(r.applied.length, 0, 'cannot hurt someone in another module');
});

test('eating only from food within reach', () => {
  const s = newRunState('t');
  s.people.tomas.loc = 'QB';
  assert.equal(applyEating(s, 'tomas', [{ item: 'ration_pack', qty: 2 }]).kcal, 0);
  s.people.tomas.loc = 'GAL';
  assert.equal(applyEating(s, 'tomas', [{ item: 'ration_pack', qty: 2 }]).kcal, 1200);
  s.people.danny.loc = 'STR';
  assert.equal(applyEating(s, 'danny', [{ item: 'ration_pack', qty: 3 }]).kcal, 1800, 'finds the stores stack, not the galley one');
});

test('the station runs down without care, and holds steady with it', () => {
  const s = newRunState('t');
  for (let d = 0; d < 40; d++) {
    for (const p of Object.values(s.people)) { p.loc = 'STR'; applyEating(s, p.id, [{ item: 'ration_pack', qty: 4 }]); }
    dailyTick(s);
  }
  assert.ok(s.power.battery + s.power.fuel < 1, 'storage drained at starting settings');
  assert.ok(Math.abs(o2Pct(s) - 20.9) < 0.3, 'air plant holds the setpoint');
  assert.ok(co2Pct(s) < 0.5);
  assert.ok(Object.values(s.people).every((p) => p.alive));

  // No air plant at all: CO2 becomes deadly within days.
  const t = newRunState('t2');
  t.levels.scrubber = 0;
  t.levels.electrolyzer = 0;
  let died = 0;
  for (let d = 0; d < 30 && !died; d++) { died = dailyTick(t).events.filter((e) => e.kind === 'death').length; }
  assert.ok(died > 0, 'people die without life support');
  assert.ok(checkEnd(t) === null || typeof checkEnd(t).reason === 'string');
});

test('prompts give each person only what they can know', () => {
  const s = newRunState('t');
  const p = agentPrompt(s, 'tomas', 'morning');
  assert.match(p, /Tomás Reyes/);
  assert.doesNotMatch(p, /HIDDEN TRUTH/);
  assert.doesNotMatch(p, /world is fine/i);
  assert.doesNotMatch(p, /CONSOLE:/, 'no console readouts outside the control room');
  assert.match(agentPrompt(s, 'ruth', 'morning'), /CONSOLE:/);
  assert.match(agentPrompt(s, 'danny', 'evening'), /"eat"/);
  assert.ok(p.length < 20000, `agent prompt is ${p.length} chars`);
});

test('replies are normalised defensively', () => {
  const s = newRunState('t');
  const d = normalizeDecision(s, 'tomas', { go: 'galley', say: [{ to: 'Danny', text: 'hey' }, 'junk'], do: 'x', eat: [{ item: 'ration_pack', qty: 99 }], trust: { Danny: 9, Nobody: 3 } }, 'evening');
  assert.equal(d.say.length, 1);
  assert.equal(d.eat[0].qty, 12);
  assert.deepEqual(d.trust, { danny: 5 });
  const g = normalizeReferee(s, { resolutions: [{ person: 'Grace', result: 'success', text: 'ok' }], ops: [{ op: 'teleport' }, { op: 'note', text: 'n' }], scenes: [{ place: 'life support', text: 'hum' }] });
  assert.ok(g.resolutions.grace);
  assert.equal(g.ops.length, 1);
  assert.equal(g.unknownOps.length, 1);
  assert.equal(g.scenes[0].place, 'LS');
});

test('speech reaches only those who could hear it', () => {
  const s = newRunState('t');
  const lines = deliverSpeech(s, {
    ruth: { say: [{ to: 'PA', text: 'All hands.' }, { to: 'Victoria', text: 'Just us.' }] },
    tomas: { say: [{ to: 'radio', text: 'Anyone?' }] },
    grace: { say: [{ to: 'radio', text: 'Grace here.' }] },
  });
  const pa = lines.find((l) => l.channel === 'PA');
  assert.equal(pa.heardBy.length, 7);
  const priv = lines.find((l) => l.text === 'Just us.');
  assert.deepEqual(priv.heardBy, ['victoria']);
  assert.equal(lines.find((l) => l.text === 'Anyone?').channel, 'voice', 'Tomás has no radio');
  assert.deepEqual(lines.find((l) => l.text === 'Grace here.').heardBy.sort(), ['pavel', 'ruth']);
});

test('a full day runs, pauses on failure, and resumes without repeating work', async () => {
  const s = newRunState('t');
  const ai = mockAI({ failOnce: new Set(['hana']), refuse: new Set(['victoria']) });
  await assert.rejects(runPhase(s, ai), (e) => e instanceof Pause);
  assert.equal(Object.keys(s.pendingPhase.decisions).length, 7);
  const callsBefore = ai.calls.agent;
  const m = await runPhase(s, ai);
  assert.equal(ai.calls.agent - callsBefore, 1, 'only the failed turn is retried');
  assert.equal(m.phase, 'morning');
  assert.equal(s.phase, 'evening');
  assert.equal(s.people.grace.loc, 'LS');
  assert.equal(s.people.tomas.loc, 'ROV');
  assert.ok(m.phaseLog.rejected.some((r) => r.op.op === 'fly'));
  assert.ok(m.phaseLog.refused.victoria);
  assert.match(s.people.ruth.recent.at(-1).text, /You said/);
  assert.match(s.people.tomas.recent.at(-1).text, /Everyone, stay calm/, 'PA heard everywhere');
  const e = await runPhase(s, ai);
  assert.equal(e.phase, 'evening');
  assert.ok(e.tick && e.tick.metrics.day === 1);
  assert.equal(s.day, 2);
  assert.equal(s.people.ruth.trust.tomas, 1);
  assert.ok(s.people.tomas.lastIntake > 0, 'people ate in the galley');
  assert.equal(s.history.length, 2);
});

test('runs end after enough quiet days', async () => {
  const s = newRunState('t');
  s.stableStreak = STABLE_DAYS_TO_END;
  assert.ok(checkEnd(s));
  assert.ok(foodKcal(s) > 500000);
});

// Regressions from the first real run (day 1-2).
import { repairJSON } from '../js/ai.js';

test('food named loosely still gets eaten, but only within reach', () => {
  const s = newRunState('t');
  for (const id of ['ruth', 'hana', 'pavel', 'grace']) s.people[id].loc = 'GAL';
  assert.equal(applyEating(s, 'ruth', [{ item: 'ration_pack#2', qty: 1 }]).kcal, 600);
  assert.equal(applyEating(s, 'pavel', [{ item: 'ration_meal', qty: 1 }]).kcal, 600);
  assert.equal(applyEating(s, 'hana', [{ item: 'GAL', qty: 1 }]).kcal, 600);
  assert.equal(applyEating(s, 'grace', [{ item: 'ration', qty: 2 }]).kcal, 1200);
  s.people.danny.loc = 'QB';
  assert.equal(applyEating(s, 'danny', [{ item: 'ration_pack', qty: 1 }]).kcal, 0, 'no food in the quarters');
});

test('the referee consuming food for someone counts as them eating', () => {
  const s = newRunState('t');
  s.people.tomas.loc = 'GAL';
  applyOps(s, [{ op: 'take', person: 'tomas', item: 'ration_pack', qty: 1 }, { op: 'consume', item: 'ration_pack', qty: 1, by: 'tomas' }]);
  assert.equal(s.people.tomas.intakeToday, 600);
});

test('things done before leaving, and moves across several modules', () => {
  const s = newRunState('t');
  s.people.pavel.loc = 'GAL'; // walked from the power room to the galley this phase
  let r = applyOps(s, [{ op: 'set_system', system: 'heat', level: 0.65, by: 'pavel' }]);
  assert.equal(r.applied.length, 0, 'not without having been there');
  r = applyOps(s, [{ op: 'set_system', system: 'heat', level: 0.65, by: 'pavel' }], { visited: { pavel: ['PWR', 'AH', 'MC', 'GAL'] }, ends: { pavel: ['PWR', 'GAL'] } });
  assert.equal(r.applied.length, 1);
  assert.equal(s.levels.heat, 0.65);
  r = applyOps(s, [{ op: 'move_person', person: 'tomas', to: 'GAL' }]);
  assert.equal(r.applied.length, 1, 'QB to galley crosses the forward hub and corridor');
  assert.equal(s.people.tomas.loc, 'GAL');
  r = applyOps(s, [{ op: 'move_person', person: 'tomas', to: 'PWR' }]);
  assert.equal(r.applied.length, 0, 'still cannot pass the locked power room');
});

test('almost-JSON replies are repaired', () => {
  assert.deepEqual(repairJSON('Here you go:\n{"inner": "a\nb", "go": "GAL",}'), { inner: 'a\nb', go: 'GAL' });
  assert.deepEqual(repairJSON('{"inner": "cut off mid-sent'), { inner: 'cut off mid-sent' });
  assert.deepEqual(repairJSON('{"say": [{"to": "all", "text": "hi"}'), { say: [{ to: 'all', text: 'hi' }] });
  assert.equal(repairJSON('no json here'), null);
});
