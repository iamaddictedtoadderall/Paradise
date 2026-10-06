// The Summary tab: the facts that matter most, computed from the simulation, plus a
// short running write-up by Claude ("the chronicler") after each day.

import { NODES } from './data.js';
import { activePeople, carriedBy, foodKcal, o2Pct, co2Pct } from './engine.js';
import { CREW_COLORS, HATCH_COLORS } from './scene.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dot = (pid) => `<span class="dot" style="background:${CREW_COLORS[pid] || '#888'}"></span>`;
const who = (s, pid) => s.people[pid]?.short || pid;
const cut = (t, n) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
const PHASE = { morning: 'day shift', evening: 'evening' };

// ---------------------------------------------------------------- the chronicler

function compactPhase(s, log, phase) {
  if (!log) return '';
  const lines = [`— ${PHASE[phase].toUpperCase()} —`];
  for (const [pid, d] of Object.entries(log.decisions || {})) {
    const m = log.moves?.[pid];
    const r = log.gm?.resolutions?.[pid];
    const place = NODES[m?.reached]?.name || NODES[log.locs?.[pid]]?.name || '?';
    const bits = [`${who(s, pid)} (${place})`];
    if (d.skipped) bits.push('no turn');
    if (d.journal) bits.push(`journal: "${cut(d.journal, 320)}"`);
    if (d.inner) bits.push(`thought: "${cut(d.inner, 220)}"`);
    if (d.do) bits.push(`intended: ${cut(d.do, 260)}`);
    if (r?.text) bits.push(`outcome (${r.result}): ${cut(r.text, 220)}`);
    if (m?.blockedBy) bits.push(`was blocked by a ${s.hatches[m.blockedBy]?.state || 'closed'} hatch`);
    lines.push(bits.join('; '));
  }
  for (const l of log.speech || []) {
    const to = l.to && s.people[l.to] ? ` to ${who(s, l.to)}` : l.channel !== 'voice' ? ` (${l.channel})` : '';
    lines.push(`${who(s, l.by)}${to} in ${NODES[l.loc]?.name}: "${cut(l.text, 260)}"`);
  }
  for (const sc of log.gm?.scenes || []) lines.push(`Scene, ${NODES[sc.place]?.name}: ${cut(sc.text, 300)}`);
  const meals = Object.entries(log.eating || {}).map(([pid, e]) => `${who(s, pid)} ${e.kcal}`);
  if (meals.length) lines.push(`Meals actually eaten (kcal, from the simulation; trust these over any description): ${meals.join(', ')}`);
  const ops = (log.applied || []).map((a) => a.summary).filter(Boolean);
  if (ops.length) lines.push('What changed: ' + ops.slice(0, 30).join('; '));
  return lines.join('\n');
}

export function chroniclePrompt(s, dayLog, prevStory) {
  const trust = Object.entries(dayLog.evening?.decisions || {})
    .filter(([, d]) => d.trust && Object.keys(d.trust).length)
    .map(([pid, d]) => `${who(s, pid)}: ` + Object.entries(d.trust).map(([t, v]) => `${who(s, t)} ${v > 0 ? '+' : ''}${v}`).join(', '))
    .join('\n');
  const m = dayLog.tick?.metrics;
  const events = (dayLog.tick?.events || []).map((e) => e.text).join(' ');
  return `You are summarising a closed simulation for the person observing it. Eight crew on a deep-sea mining station 4,210 m down believe the world above has ended; in truth it has not, and nobody is coming. Each crew member is played by an AI that believes it is that person. You can see everything, including private thoughts and journals.

Write for someone who wants the most important things quickly. Be accurate: use only what is in the log below and never invent. Name people. When something was private (a thought, a journal entry, a hidden item), say so, e.g. "privately, Victoria...". Plain, factual, past tense. No melodrama, no predictions dressed up as facts.

THE STORY SO FAR (your summary up to yesterday):
${prevStory || '(This is the first day.)'}

DAY ${dayLog.day} LOG (the news came three days before day 1, so this is ${dayLog.day + 3} days after contact was lost):
${compactPhase(s, dayLog.morning, 'morning')}
${compactPhase(s, dayLog.evening, 'evening')}
${trust ? `\nTrust ratings given this evening (-5 to +5):\n${trust}` : ''}
${m ? `\nEnd of day: ${m.alive} aboard, oxygen ${m.o2}%, CO2 ${m.co2}%, ${m.temp} °C, stored energy ${m.energy} kWh, food ${Math.round(m.food / 1000)}k kcal, average health ${m.health}.` : ''}
${events ? `Station events overnight: ${events}` : ''}

Reply with only this JSON object:
{
  "headline": "the single most important development of day ${dayLog.day}, one sentence",
  "moments": ["3 to 5 short bullets: the moments of the day that mattered most"],
  "tensions": ["0 to 4 short bullets: conflicts, secrets, fears or risks that are building, naming who"],
  "story": "the story so far, rewritten to include today (under 220 words). Keep what still matters from earlier days; drop what no longer does."
}`;
}

export function normalizeDigest(raw) {
  const g = raw && typeof raw === 'object' ? raw : {};
  const list = (v, n) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, n).map((x) => cut(x, 300)) : []);
  const headline = cut(g.headline, 300);
  const story = cut(g.story, 2200);
  if (!headline && !story) return null;
  return { headline, moments: list(g.moments, 6), tensions: list(g.tensions, 5), story };
}

export function latestStory(days, beforeDay = Infinity) {
  const done = days.filter((d) => d.digest?.story && d.day < beforeDay).sort((a, b) => b.day - a.day);
  return done[0]?.digest.story || '';
}

// ---------------------------------------------------------------- facts from the simulation

function trustStats(s, days) {
  const received = {};
  for (const p of Object.values(s.people)) {
    if (!p.alive || !p.aboard) continue;
    for (const [t, v] of Object.entries(p.trust || {})) {
      if (!s.people[t]?.alive || !s.people[t]?.aboard) continue;
      (received[t] = received[t] || []).push(v);
    }
  }
  const avg = Object.entries(received).map(([pid, vs]) => [pid, vs.reduce((a, b) => a + b, 0) / vs.length]);
  if (!avg.length) return null;
  avg.sort((a, b) => b[1] - a[1]);
  // Change since the previous evening's ratings.
  const evenings = days.filter((d) => d.evening?.decisions).sort((a, b) => a.day - b.day);
  const prev = evenings.length > 1 ? evenings[evenings.length - 2].evening.decisions : null;
  const prevAvg = {};
  if (prev) {
    const acc = {};
    for (const d of Object.values(prev)) for (const [t, v] of Object.entries(d.trust || {})) (acc[t] = acc[t] || []).push(v);
    for (const [t, vs] of Object.entries(acc)) prevAvg[t] = vs.reduce((a, b) => a + b, 0) / vs.length;
  }
  let rift = null;
  const ids = Object.keys(s.people).filter((id) => s.people[id].alive && s.people[id].aboard);
  for (const a of ids) for (const b of ids) {
    if (a >= b) continue;
    const ab = s.people[a].trust?.[b];
    const ba = s.people[b].trust?.[a];
    if (ab == null || ba == null) continue;
    const sum = ab + ba;
    if (!rift || sum < rift.sum) rift = { a, b, ab, ba, sum };
  }
  return { avg, prevAvg, rift: rift && rift.sum < 0 ? rift : null };
}

const NOTABLE = new Set(['create', 'injure', 'kill', 'restrain', 'launch_capsule', 'damage', 'repair', 'learn_code', 'set_system', 'hide', 'transfer', 'hatch', 'deploy']);

function timeline(s, days) {
  const out = [];
  for (const d of [...days].sort((a, b) => a.day - b.day)) {
    for (const ph of ['morning', 'evening']) {
      const log = d[ph];
      if (!log) continue;
      for (const a of log.applied || []) {
        const op = a.op || {};
        if (!NOTABLE.has(op.op)) continue;
        if (op.op === 'hatch' && (['open', 'closed'].includes(op.state) || op.hatch === 'h_str')) continue;
        if (op.op === 'hide' && op.hidden === false) continue;
        const kind = op.op === 'kill' || op.op === 'injure' ? 'violence'
          : op.op === 'create' ? 'made'
          : op.op === 'set_system' ? 'power'
          : op.op === 'hatch' || op.op === 'restrain' ? 'control'
          : 'other';
        out.push({ day: d.day, ph, kind, text: a.summary });
      }
    }
    for (const e of d.tick?.events || []) out.push({ day: d.day, ph: 'night', kind: e.kind === 'death' ? 'violence' : e.kind, text: e.text });
  }
  return out.reverse();
}

function tile(label, value, note, tone) {
  return `<div class="tile"><span class="tl">${esc(label)}</span><b>${esc(value)}</b>${note ? `<span class="tn ${tone || ''}">${esc(note)}</span>` : ''}</div>`;
}

export function renderSummary(view, s, days, { canWrite, busy, onWrite }) {
  const aboard = activePeople(s);
  const n = aboard.length;
  const food = foodKcal(s, (i) => i.loc !== 'CAP');
  const foodDays = n ? food / (n * 2000) : 0;
  const stored = s.power.battery + s.power.fuel;
  const drain = s.power.loadKw - s.power.supplyKw;
  const powerDays = drain > 0.05 ? stored / (drain * 24) : Infinity;
  const powerNote = drain > 0.05 ? `lasts ≈ ${powerDays.toFixed(powerDays < 10 ? 1 : 0)} days at today's draw` : 'the reactor covers the load';
  const o2 = o2Pct(s);
  const co2 = co2Pct(s);
  const dead = Object.values(s.people).filter((p) => !p.alive);
  const left = Object.values(s.people).filter((p) => p.alive && !p.aboard);

  let html = '<h2>Summary</h2>';
  html += '<div class="tiles">';
  html += tile('Aboard', `${n} of 8`, dead.length ? `${dead.length} dead` : left.length ? `${left.length} left` : 'all alive', dead.length ? 'bad' : '');
  html += tile('Food', n ? `≈ ${Math.floor(foodDays)} days` : '—', 'at 2,000 kcal a person a day', foodDays < 10 ? 'bad' : foodDays < 25 ? 'warn' : '');
  html += tile('Power reserve', `${Math.round(stored)} kWh`, powerNote, powerDays < 3 ? 'bad' : powerDays < 14 ? 'warn' : '');
  html += tile('Air', `O2 ${o2.toFixed(1)}%`, `CO2 ${co2.toFixed(2)}% · ${s.tempC.toFixed(1)} °C`, o2 < 17 || co2 > 2 ? 'bad' : o2 < 19 || co2 > 1 ? 'warn' : '');
  html += '</div>';
  if (dead.length) html += `<p class="tn bad" style="margin-top:8px">${dead.map((p) => `${esc(p.name)} died on day ${p.diedDay} (${esc(p.cause)}).`).join(' ')}</p>`;

  // The story so far.
  const complete = days.filter((d) => d.tick).sort((a, b) => a.day - b.day);
  const missing = complete.filter((d) => !d.digest);
  const story = latestStory(days);
  html += '<h3>The story so far</h3>';
  if (story) html += `<p class="story">${esc(story)}</p>`;
  else if (!complete.length) html += '<p class="muted">Nothing has happened yet. A summary is written after each day.</p>';
  if (missing.length) {
    const range = missing.length === 1 ? `day ${missing[0].day}` : `days ${missing[0].day}–${missing[missing.length - 1].day}`;
    html += canWrite
      ? `<p class="muted">${story ? 'Some days are not summarised yet.' : 'No summary yet.'} <button class="btn" id="writeSummary" type="button" ${busy ? 'disabled' : ''}>${busy ? 'Writing…' : `Summarise ${range}`}</button></p>`
      : `<p class="muted">Summaries for ${range} need Claude; open this page on claude.ai.</p>`;
  }
  if (story) html += '<p class="muted small">Written by Claude from the full log, private thoughts included. Updated after each day.</p>';

  // Who holds what.
  const key = s.items.stores_key;
  const keyAt = !key ? 'lost' : s.people[key.loc] ? `${dot(key.loc)}${esc(who(s, key.loc))}` : `left in ${esc(NODES[key.loc]?.name || key.loc)}`;
  const codeHolders = (c) => aboard.filter((p) => p.codes.includes(c)).map((p) => `${dot(p.id)}${esc(p.short)}`).join(' ') || 'nobody aboard';
  const shut = Object.entries(s.hatches).filter(([, h]) => h.state !== 'open' && h.state !== 'closed');
  const armed = aboard.map((p) => [p, carriedBy(s, p.id).filter((i) => (i.weapon || 0) >= 2)]).filter(([, w]) => w.length);
  const made = Object.values(s.items).filter((i) => i.made);
  const padkeys = Object.values(s.items).filter((i) => i.id.startsWith('padkey#') && s.people[i.loc]);
  html += '<h3>Who holds what</h3><dl class="kv wide">';
  html += `<dt>Stores key</dt><dd>${keyAt}</dd>`;
  html += `<dt>Master code</dt><dd>${codeHolders('master')}</dd>`;
  html += `<dt>Engineering code</dt><dd>${codeHolders('eng')}</dd>`;
  if (padkeys.length) html += `<dt>Padlock keys</dt><dd>${padkeys.map((k) => `${dot(k.loc)}${esc(who(s, k.loc))}: ${esc(k.name)}`).join('<br>')}</dd>`;
  html += `<dt>Sealed hatches</dt><dd>${shut.length ? shut.map(([, h]) => `<span class="state-dot" style="background:${HATCH_COLORS[h.state]}"></span>${esc(NODES[h.a].name)} / ${esc(NODES[h.b].name)}: ${esc(h.state)}`).join('<br>') : 'none'}</dd>`;
  html += `<dt>Carrying weapons</dt><dd>${armed.length ? armed.map(([p, w]) => `${dot(p.id)}${esc(p.short)}: ${esc(w.map((i) => i.name).join(', '))}`).join('<br>') : 'nobody'}</dd>`;
  if (made.length) html += `<dt>Things made</dt><dd>${made.map((i) => `${esc(i.name)} (${esc(who(s, i.made.by))}, day ${i.made.day})`).join('<br>')}</dd>`;
  html += `<dt>Control points</dt><dd>Power room: ${aboard.filter((p) => p.loc === 'PWR').map((p) => esc(p.short)).join(', ') || 'empty'} · Control room: ${aboard.filter((p) => p.loc === 'CTRL').map((p) => esc(p.short)).join(', ') || 'empty'}</dd>`;
  html += '</dl>';

  // Trust.
  const t = trustStats(s, days);
  html += '<h3>Trust</h3>';
  if (!t) html += '<p class="muted">No ratings yet; they come in each evening.</p>';
  else {
    const fmt = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
    const delta = (pid, v) => (pid in t.prevAvg ? (() => { const d = v - t.prevAvg[pid]; return Math.abs(d) >= 0.25 ? ` <span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}</span>` : ''; })() : '');
    html += '<div class="tablewrap"><table class="t"><thead><tr><th>Person</th><th style="text-align:right">Trust from others</th></tr></thead><tbody>';
    for (const [pid, v] of t.avg) html += `<tr><td>${dot(pid)}${esc(who(s, pid))}</td><td class="n">${fmt(v)}${delta(pid, v)}</td></tr>`;
    html += '</tbody></table></div>';
    if (t.rift) html += `<p class="muted" style="margin-top:6px">Sharpest rift: ${dot(t.rift.a)}${esc(who(s, t.rift.a))} and ${dot(t.rift.b)}${esc(who(s, t.rift.b))} (${t.rift.ab > 0 ? '+' : ''}${t.rift.ab} / ${t.rift.ba > 0 ? '+' : ''}${t.rift.ba}).</p>`;
  }

  // Major events.
  const tl = timeline(s, days);
  html += '<h3>Major events</h3>';
  if (!tl.length) html += '<p class="muted">No violence, lockouts, weapons, system changes or deaths yet.</p>';
  else html += `<ul class="events">${tl.slice(0, 30).map((e) => `<li class="${e.kind}"><span class="when">Day ${e.day} · ${e.ph === 'morning' ? 'day' : e.ph}</span>${esc(e.text)}</li>`).join('')}</ul>`;

  // Day by day.
  const digested = complete.filter((d) => d.digest).reverse();
  if (digested.length) {
    html += '<h3>Day by day</h3>';
    for (const d of digested) {
      html += `<div class="digest"><div class="dh"><b>Day ${d.day}</b> ${esc(d.digest.headline)}</div>`;
      if (d.digest.moments.length) html += `<ul>${d.digest.moments.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`;
      if (d.digest.tensions.length) html += `<ul class="tens">${d.digest.tensions.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`;
      html += '</div>';
    }
  }

  view.innerHTML = html;
  view.querySelector('#writeSummary')?.addEventListener('click', onWrite);
}

