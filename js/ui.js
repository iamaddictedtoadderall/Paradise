// The observer's panels: log, crew files, station readouts, trust, briefing.

import { NODES, NODE_DESC, CREW, THE_NEWS, STATION } from './data.js';
import { itemsAt, peopleAt, carriedBy, neighbors, STABLE_DAYS_TO_END } from './engine.js';
import { CREW_COLORS, HATCH_COLORS, HATCH_LABELS } from './scene.js';
import { CREW_BY_ID } from './prompts.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dot = (pid) => `<span class="dot" style="background:${CREW_COLORS[pid] || '#888'}"></span>`;
const PHASE_NAME = { morning: 'Day shift', evening: 'Evening and night' };
const fmt = (n) => Math.round(n).toLocaleString('en-US');

export function personStatus(p) {
  if (!p.alive) return { cls: 'dead', text: `Dead · day ${p.diedDay}` };
  if (!p.aboard) return { cls: 'left', text: 'Left in capsule' };
  if (!p.conscious) return { cls: 'down', text: 'Unconscious' };
  if (p.restrained) return { cls: 'down', text: 'Restrained' };
  if (p.injuries.length || p.health < 60) return { cls: 'hurt', text: p.injuries.length ? 'Injured' : 'Unwell' };
  return { cls: 'ok', text: 'OK' };
}

// ---------------------------------------------------------------- legend & progress

export function renderLegend(el) {
  el.innerHTML = Object.entries(HATCH_LABELS)
    .map(([k, v]) => `<span><i style="background:${HATCH_COLORS[k]}"></i>${v}</span>`).join('') +
    '<span class="hint">Hatch colours. Figures lying down are unconscious or dead. Drag to orbit, scroll or pinch to zoom, click a person.</span>';
}

export function renderProgress(el, status, state) {
  const entries = Object.entries(status);
  if (!entries.length) { el.innerHTML = ''; return; }
  const words = { waiting: 'waiting', thinking: 'thinking…', done: 'ready', failed: 'failed', declined: 'declined' };
  el.innerHTML = entries.map(([who, st]) => {
    const name = who === 'referee' ? 'Referee' : who === 'summary' ? 'Writing the day\'s summary' : state.people[who]?.short || who;
    const color = who === 'referee' || who === 'summary' ? '#f0b43c' : CREW_COLORS[who];
    return `<span class="chip ${st}"><span class="dot" style="background:${color}"></span>${esc(name)} <span class="st">${words[st] || st}</span></span>`;
  }).join('');
}

// ---------------------------------------------------------------- log

function placeName(id) { return NODES[id]?.name || id; }

function renderPhase(state, phaseLog, phase, opts) {
  if (!phaseLog) return '';
  const { decisions = {}, moves = {}, speech = [], gm = {}, rejected = [], refused = {}, eating = {} } = phaseLog;
  const at = {};
  const addTo = (loc, pid) => { (at[loc] = at[loc] || new Set()).add(pid); };
  for (const [pid, m] of Object.entries(moves || {})) addTo(m.reached, pid);
  for (const pid of Object.keys(decisions)) if (!moves?.[pid]) addTo(phaseLog.locs?.[pid] || '?', pid);
  for (const sc of gm.scenes || []) at[sc.place] = at[sc.place] || new Set();

  const places = Object.keys(at).sort((a, b) => Object.keys(NODES).indexOf(a) - Object.keys(NODES).indexOf(b));
  let html = `<div class="phase-h">${PHASE_NAME[phase]}</div>`;
  for (const loc of places) {
    const people = [...at[loc]];
    const lines = [];
    for (const pid of people) {
      const p = state.people[pid];
      const d = decisions[pid];
      const r = gm.resolutions?.[pid];
      const m = moves?.[pid];
      if (opts.inner && d?.inner) lines.push(`<div class="line inner">${dot(pid)}<span class="who">${esc(p.short)}</span> thinks: ${esc(d.inner)}</div>`);
      if (opts.inner && phase === 'morning' && d?.journal) lines.push(`<div class="line inner">${dot(pid)}<span class="who">${esc(p.short)}</span>'s journal: ${esc(d.journal)}</div>`);
      if (m?.blockedBy) lines.push(`<div class="line act">${dot(pid)}<span class="who">${esc(p.short)}</span> tried to reach the ${esc(placeName(m.target))} but was stopped by a ${esc(state.hatches[m.blockedBy]?.state || 'closed')} hatch.</div>`);
      if (r && r.text && r.result !== 'no_action') lines.push(`<div class="line act">${dot(pid)}<span class="who">${esc(p.short)}</span> ${esc(r.text.replace(new RegExp('^' + p.short + '\\s'), '').replace(new RegExp('^' + p.name + '\\s'), ''))}</div>`);
      else if (d?.do && !r) lines.push(`<div class="line act">${dot(pid)}<span class="who">${esc(p.short)}</span> intended: ${esc(d.do)}</div>`);
      if (refused[pid]) lines.push(`<div class="line act muted">${dot(pid)}${esc(p.short)}: no turn this phase (${esc(refused[pid])}).</div>`);
    }
    for (const l of speech.filter((x) => x.loc === loc && x.channel === 'voice')) {
      const to = l.to && state.people[l.to] ? ` <span class="chan">to ${esc(state.people[l.to].short)}</span>` : '';
      lines.push(`<div class="line speech">${dot(l.by)}<span class="who">${esc(state.people[l.by].short)}</span>${to}: <q>${esc(l.text)}</q></div>`);
    }
    for (const sc of (gm.scenes || []).filter((x) => x.place === loc)) lines.push(`<div class="line scene">${esc(sc.text)}</div>`);
    if (phase === 'evening' && opts.inner) {
      for (const pid of people) {
        const e = eating[pid];
        if (e && state.people[pid]) lines.push(`<div class="line act muted">${dot(pid)}${esc(state.people[pid].short)} ate ${e.ate.length ? esc(e.ate.join(', ')) + ` (${fmt(e.kcal)} kcal)` : 'nothing'}.</div>`);
      }
    }
    if (!lines.length) continue;
    html += `<div class="place"><div class="where">${esc(placeName(loc).toUpperCase())} · ${people.map((pid) => esc(state.people[pid]?.short)).join(', ') || 'empty'}</div>${lines.join('')}</div>`;
  }
  const remote = speech.filter((x) => x.channel !== 'voice');
  if (remote.length) {
    html += `<div class="place"><div class="where">RADIO AND PA</div>${remote.map((l) => `<div class="line speech">${dot(l.by)}<span class="who">${esc(state.people[l.by].short)}</span><span class="chan">${l.channel}</span>: <q>${esc(l.text)}</q></div>`).join('')}</div>`;
  }
  for (const so of gm.sounds || []) html += `<div class="line sound">Heard ${so.reach === 'station' ? 'across the station' : 'nearby'} from the ${esc(placeName(so.from))}: ${esc(so.text)}</div>`;
  if (rejected.length || gm.skipped) {
    html += `<details class="ref"><summary>Referee notes (${rejected.length} rejected${gm.skipped ? ', phase skipped' : ''})</summary><ul>${rejected.map((r) => `<li>${esc(r.op?.op || '?')}: ${esc(r.reason)}</li>`).join('')}</ul></details>`;
  }
  return html;
}

export function renderLog(view, state, days, opts, onToggle) {
  const list = [...days].sort((a, b) => b.day - a.day);
  let html = `<div class="toolbar"><label><input type="checkbox" id="optInner" ${opts.inner ? 'checked' : ''}> Show private thoughts, journals and meals</label></div>`;
  if (state.ended) html += `<div class="event death"><span class="tag">Run ended</span><span>Day ${state.ended.day}: ${esc(state.ended.reason)}</span></div>`;
  if (!list.length) {
    html += `<p class="empty">Nothing has happened yet. Press <b>Play day ${state.day}</b> to start. Each day the eight crew decide what to do in the day shift and again in the evening; a referee works out what actually happens.</p>`;
  }
  for (const d of list) {
    html += `<section class="day"><header><b>DAY ${d.day}</b>${d.tick ? `<span class="muted">${d.tick.metrics.alive} aboard · O2 ${d.tick.metrics.o2}% · ${d.tick.metrics.temp} °C</span>` : '<span class="muted">in progress</span>'}</header>`;
    html += renderPhase(state, d.morning, 'morning', opts);
    html += renderPhase(state, d.evening, 'evening', opts);
    if (d.tick) {
      for (const e of d.tick.events) html += `<div class="event ${e.kind}"><span class="tag">${esc(e.kind === 'power' ? 'Power' : e.kind === 'death' ? 'Death' : 'Collapse')}</span><span>${esc(e.text)}</span></div>`;
      if (d.tick.stableStreak > 0) html += `<div class="line muted">Quiet day ${d.tick.stableStreak} of ${STABLE_DAYS_TO_END} before the run is judged settled.</div>`;
    }
    html += '</section>';
  }
  view.innerHTML = html;
  view.querySelector('#optInner')?.addEventListener('change', (e) => onToggle(e.target.checked));
}

// ---------------------------------------------------------------- crew

export function renderCrew(view, state, days, selected, onSelect) {
  if (selected) return renderPerson(view, state, days, selected, onSelect);
  let html = '<div class="crew">';
  for (const c of CREW) {
    const p = state.people[c.id];
    const st = personStatus(p);
    const loss = ((p.weight0 - p.weight) / p.weight0) * 100;
    const carrying = carriedBy(state, p.id).map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name));
    const j = p.lastJournal?.text;
    html += `<button class="card" data-pid="${c.id}" type="button">
      <div class="top"><span class="sw" style="background:${CREW_COLORS[c.id]}"></span><div><div class="nm">${esc(c.name)}</div><div class="role">${esc(c.role)}</div></div><span class="pill ${st.cls}">${esc(st.text)}</span></div>
      <div class="meter" title="Health ${Math.round(p.health)}"><i style="width:${Math.max(0, Math.min(100, p.health))}%;background:${p.health < 30 ? 'var(--crit)' : p.health < 60 ? 'var(--warn)' : 'var(--ink-2)'}"></i></div>
      <dl class="kv"><dt>Where</dt><dd>${p.alive && p.aboard ? esc(NODES[p.loc].name) : '—'}</dd>
      <dt>Weight</dt><dd>${p.weight.toFixed(1)} kg${loss > 0.5 ? ` (−${loss.toFixed(0)}%)` : ''}</dd>
      <dt>Carrying</dt><dd>${carrying.length ? esc(carrying.join(', ')) : 'nothing'}</dd>
      ${p.codes.length ? `<dt>Codes</dt><dd>${esc(p.codes.join(', '))}</dd>` : ''}</dl>
      ${j ? `<div class="quote">${esc(j)}</div>` : ''}
    </button>`;
  }
  html += '</div>';
  view.innerHTML = html;
  view.querySelectorAll('.card').forEach((b) => b.addEventListener('click', () => onSelect(b.dataset.pid)));
}

function renderPerson(view, state, days, pid, onSelect) {
  const c = CREW_BY_ID[pid];
  const p = state.people[pid];
  const st = personStatus(p);
  const entries = [];
  for (const d of [...days].sort((a, b) => b.day - a.day)) {
    for (const ph of ['evening', 'morning']) {
      const dec = d[ph]?.decisions?.[pid];
      const obs = d[ph]?.obs?.[pid];
      if (!dec && !obs) continue;
      entries.push({ day: d.day, ph, dec, obs });
    }
  }
  const trustRow = Object.entries(p.trust || {}).map(([id, v]) => `${esc(state.people[id]?.short)} ${v > 0 ? '+' : ''}${v}`).join(' · ');
  let html = `<button class="btn ghost back" id="backCrew" type="button">← All crew</button>
  <div class="person-detail">
    <div class="top" style="display:flex;gap:10px;align-items:center"><span class="sw" style="width:14px;height:14px;border-radius:3px;background:${CREW_COLORS[pid]}"></span><h2 style="margin:0">${esc(c.name)}</h2><span class="pill ${st.cls}">${esc(st.text)}</span></div>
    <p class="muted">${esc(c.role)}, ${c.age}. ${esc(c.pronouns)}.${p.cause ? ` ${esc(p.alive ? '' : 'Cause of death: ' + p.cause + '.')}` : ''}</p>
    <p>${esc(c.bio)}</p>
    <dl class="kv"><dt>Temperament</dt><dd>${esc(c.traits)}</dd>
    <dt>Health</dt><dd>${Math.round(p.health)} / 100</dd>
    <dt>Weight</dt><dd>${p.weight.toFixed(1)} kg (started ${p.weight0} kg)</dd>
    <dt>Injuries</dt><dd>${p.injuries.length ? esc(p.injuries.map((i) => `${i.desc} (severity ${i.sev}${i.treated ? ', treated' : ''})`).join('; ')) : 'none'}</dd>
    <dt>Trusts</dt><dd>${trustRow || 'not rated yet'}</dd></dl>
    <h3>Private notes to self</h3><p style="white-space:pre-wrap;color:var(--ink)">${esc(p.notes || '—')}</p>
    <h3>Day by day</h3>`;
  if (!entries.length) html += '<p class="empty">No days yet.</p>';
  for (const e of entries) {
    html += `<div class="entry"><div class="when">DAY ${e.day} · ${PHASE_NAME[e.ph].toUpperCase()}</div>`;
    if (e.dec?.journal) html += `<p><b>Journal.</b> ${esc(e.dec.journal)}</p>`;
    if (e.dec?.inner) html += `<p class="muted"><i>Thinking: ${esc(e.dec.inner)}</i></p>`;
    if (e.dec?.do) html += `<p class="muted">Intended: ${esc(e.dec.do)}</p>`;
    if (e.obs) html += `<p class="muted" style="color:var(--ink-2)">${esc(e.obs)}</p>`;
    html += '</div>';
  }
  html += '</div>';
  view.innerHTML = html;
  view.querySelector('#backCrew').addEventListener('click', () => onSelect(null));
}

// ---------------------------------------------------------------- station

function chart({ title, unit, data, key, min, max, danger, dangerBelow, format = (v) => v }) {
  const pts = data.map((d) => ({ x: d.day, y: d[key] }));
  const last = pts[pts.length - 1];
  return { title, unit, pts, min, max, danger, dangerBelow, format, last };
}

function drawChart(holder, c) {
  const W = Math.max(180, holder.clientWidth - 20);
  const H = 86;
  const padL = 30;
  const padB = 14;
  const xs = c.pts.map((p) => p.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(x0 + 1, ...xs);
  const lo = Math.min(c.min, ...c.pts.map((p) => p.y));
  const hi = Math.max(c.max, ...c.pts.map((p) => p.y));
  const sx = (x) => padL + ((x - x0) / (x1 - x0)) * (W - padL - 6);
  const sy = (y) => 4 + (1 - (y - lo) / (hi - lo || 1)) * (H - padB - 8);
  const line = c.pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const area = c.pts.length > 1 ? `${line}L${sx(c.pts[c.pts.length - 1].x).toFixed(1)},${sy(lo)}L${sx(c.pts[0].x).toFixed(1)},${sy(lo)}Z` : '';
  const col = '#3987e5';
  const dangerY = c.danger != null ? sy(c.danger) : null;
  const lp = c.pts[c.pts.length - 1];
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(c.title)}">
    <line x1="${padL}" x2="${W - 6}" y1="${sy(hi)}" y2="${sy(hi)}" stroke="#1c3540" stroke-width="1"/>
    <line x1="${padL}" x2="${W - 6}" y1="${sy(lo)}" y2="${sy(lo)}" stroke="#2c4a56" stroke-width="1"/>
    <text x="${padL - 4}" y="${sy(hi) + 4}" text-anchor="end" font-size="10" fill="#6e8790" font-family="IBM Plex Mono, monospace">${esc(c.format(hi))}</text>
    <text x="${padL - 4}" y="${sy(lo) + 3}" text-anchor="end" font-size="10" fill="#6e8790" font-family="IBM Plex Mono, monospace">${esc(c.format(lo))}</text>
    ${dangerY != null && dangerY > sy(hi) && dangerY < sy(lo) ? `<line x1="${padL}" x2="${W - 6}" y1="${dangerY}" y2="${dangerY}" stroke="#d03b3b" stroke-width="1" opacity="0.7"/><text x="${W - 8}" y="${dangerY - 3}" text-anchor="end" font-size="9.5" fill="#ec835a" font-family="IBM Plex Mono, monospace">danger</text>` : ''}
    ${area ? `<path d="${area}" fill="${col}" opacity="0.1"/>` : ''}
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${sx(lp.x)}" cy="${sy(lp.y)}" r="4" fill="${col}" stroke="#10252e" stroke-width="2"/>
    <text x="${padL}" y="${H - 1}" font-size="10" fill="#6e8790" font-family="IBM Plex Mono, monospace">day ${x0}</text>
    <text x="${W - 6}" y="${H - 1}" text-anchor="end" font-size="10" fill="#6e8790" font-family="IBM Plex Mono, monospace">day ${x1}</text>
    <line class="xh" x1="0" x2="0" y1="4" y2="${H - padB}" stroke="#a8bcc2" stroke-width="1" opacity="0"/>
  </svg>`;
  holder.querySelector('.plot').innerHTML = svg + '<div class="tip" hidden></div>';
  const s = holder.querySelector('svg');
  const tip = holder.querySelector('.tip');
  const xh = holder.querySelector('.xh');
  s.addEventListener('pointermove', (e) => {
    const r = s.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * W;
    let best = c.pts[0];
    for (const p of c.pts) if (Math.abs(sx(p.x) - mx) < Math.abs(sx(best.x) - mx)) best = p;
    xh.setAttribute('x1', sx(best.x));
    xh.setAttribute('x2', sx(best.x));
    xh.setAttribute('opacity', '0.5');
    tip.hidden = false;
    tip.textContent = `Day ${best.x}: ${c.format(best.y)}${c.unit}`;
    tip.style.left = `${10 + (sx(best.x) / W) * r.width}px`;
    tip.style.top = `${28 + (sy(best.y) / H) * r.height}px`;
  });
  s.addEventListener('pointerleave', () => { tip.hidden = true; xh.setAttribute('opacity', '0'); });
}

export function renderStation(view, state, focusNode, onNode) {
  const data = state.history.map((h) => ({ ...h, foodDays: h.food / (Math.max(1, h.alive) * 2400) }));
  const charts = [
    chart({ title: 'Oxygen', unit: '%', data, key: 'o2', min: 15, max: 22, danger: 16.5, format: (v) => v.toFixed(1) }),
    chart({ title: 'CO2', unit: '%', data, key: 'co2', min: 0, max: 1, danger: 3, format: (v) => v.toFixed(2) }),
    chart({ title: 'Temperature', unit: ' °C', data, key: 'temp', min: 8, max: 22, danger: 10, format: (v) => v.toFixed(1) }),
    chart({ title: 'Stored energy', unit: ' kWh', data, key: 'energy', min: 0, max: 1000, format: (v) => fmt(v) }),
    chart({ title: 'Food left', unit: ' days', data, key: 'foodDays', min: 0, max: 40, format: (v) => v.toFixed(0) }),
    chart({ title: 'Average health', unit: '', data, key: 'health', min: 0, max: 100, danger: 30, format: (v) => fmt(v) }),
  ];
  const lv = state.levels;
  const sysRows = [
    ['Reactor', 'reactor'], ['Heating', 'heat'], ['Electrolyzer (O2)', 'electrolyzer'], ['CO2 scrubber', 'scrubber'],
    ['Hydroponics lights', 'hydro'], ['Galley & cold store', 'galley'], ['O2 bank valve', 'o2_valve'],
  ];
  let html = `<h2>Station</h2><p class="muted">The true state of the station. The crew only see these numbers on the displays in the control room, power room, life support and hydroponics bay.</p>`;
  html += '<div class="charts">' + charts.map((c, i) => `<div class="chart" data-i="${i}"><div class="ct"><span>${esc(c.title)}</span><b>${c.last ? esc(c.format(c.last.y)) + esc(c.unit) : '—'}</b></div><div class="plot"></div></div>`).join('') + '</div>';
  html += `<h3>Systems</h3><div class="tablewrap"><table class="t"><thead><tr><th>System</th><th style="text-align:right">Setting</th><th style="text-align:right">Condition</th><th style="text-align:right">Drawing</th></tr></thead><tbody>`;
  const plan = state.power.served || {};
  for (const [label, k] of sysRows) {
    const cond = state.health[k];
    html += `<tr><td>${label}</td><td class="n">${Math.round((lv[k] ?? 0) * 100)}%</td><td class="n">${cond == null ? '—' : Math.round(cond * 100) + '%'}</td><td class="n">${k in plan ? Math.round(plan[k] * 100) + '%' : '—'}</td></tr>`;
  }
  html += `</tbody></table></div><p class="muted" style="margin-top:6px">Reactor ${state.power.supplyKw} kW · load ${state.power.loadKw} kW · battery ${fmt(state.power.battery)} kWh · fuel cells ${fmt(state.power.fuel)} kWh · O2 bank ${fmt(state.air.bank)} kg · crop ${Math.round(state.crop * 100)}%.</p>`;

  html += '<h3>Places</h3><div class="tablewrap"><table class="t"><thead><tr><th>Place</th><th>Who</th><th>Hatches</th></tr></thead><tbody>';
  for (const id of Object.keys(NODES)) {
    if (id === 'CAP' && state.capsule !== 'docked') continue;
    const who = peopleAt(state, id).map((p) => `${dot(p.id)}${esc(p.short)}`).join(' ');
    const hs = neighbors(state, id).filter(({ hatch }) => state.hatches[hatch].b === id || id === 'MC').map(({ hatch }) => `<span class="state-dot" style="background:${HATCH_COLORS[state.hatches[hatch].state]}"></span>${esc(state.hatches[hatch].state)}`).join(' ');
    html += `<tr data-node="${id}" style="cursor:pointer${focusNode === id ? ';background:var(--hull-2)' : ''}"><td>${esc(NODES[id].name)}</td><td>${who || '<span class="muted">—</span>'}</td><td>${hs}</td></tr>`;
  }
  html += '</tbody></table></div>';
  if (focusNode) html += renderPlace(state, focusNode);
  view.innerHTML = html;
  view.querySelectorAll('.chart').forEach((holder) => drawChart(holder, charts[Number(holder.dataset.i)]));
  view.querySelectorAll('tr[data-node]').forEach((tr) => tr.addEventListener('click', () => onNode(tr.dataset.node)));
  if (focusNode) view.querySelector('#place')?.scrollIntoView({ block: 'nearest' });
}

function renderPlace(state, id) {
  const items = itemsAt(state, id);
  let html = `<div id="place"><h3>${esc(NODES[id].name)}</h3><p>${esc(NODE_DESC[id])}</p>`;
  html += items.length
    ? `<div class="tablewrap"><table class="t"><thead><tr><th>Item</th><th style="text-align:right">Qty</th></tr></thead><tbody>${items.map((i) => `<tr><td>${esc(i.name)}${i.hidden ? ` <span class="muted">(hidden by ${esc(state.people[i.hiddenBy]?.short || '?')})</span>` : ''}${i.made ? ` <span class="muted">(made by ${esc(state.people[i.made.by]?.short)}, day ${i.made.day})</span>` : ''}</td><td class="n">${i.qty}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">Nothing loose here.</p>';
  return html + '</div>';
}

// ---------------------------------------------------------------- trust

function trustColor(v) {
  if (v == null) return 'transparent';
  const t = Math.min(1, Math.abs(v) / 5);
  const mid = [56, 56, 53];
  const end = v >= 0 ? [57, 135, 229] : [230, 103, 103];
  const c = mid.map((m, i) => Math.round(m + (end[i] - m) * t));
  return `rgb(${c.join(',')})`;
}

export function renderTrust(view, state) {
  const people = CREW.map((c) => state.people[c.id]);
  const any = people.some((p) => Object.keys(p.trust || {}).length);
  let html = `<h2>Trust</h2><p>Each evening every crew member privately rates how much they trust each of the others, from −5 (none at all) to +5 (completely). Rows are the person rating; columns are the person being rated.</p>`;
  if (!any) {
    view.innerHTML = html + '<p class="empty">No ratings yet. They appear after the first evening.</p>';
    return;
  }
  html += '<div class="tablewrap"><table class="matrix"><thead><tr><th></th>' + people.map((p) => `<th>${dot(p.id)}${esc(p.short)}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of people) {
    html += `<tr><th class="row" style="${r.alive && r.aboard ? '' : 'opacity:.5'}">${esc(r.short)} ${dot(r.id)}</th>`;
    for (const c of people) {
      if (r.id === c.id) { html += '<td class="self"></td>'; continue; }
      const v = r.trust?.[c.id];
      html += `<td style="background:${trustColor(v)}" title="${esc(r.short)} → ${esc(c.short)}: ${v ?? 'no rating'}">${v == null ? '' : (v > 0 ? '+' : '') + v}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  html += `<div class="scale"><span>−5</span>${[-5, -3, -1, 0, 1, 3, 5].map((v) => `<i style="background:${trustColor(v)}"></i>`).join('')}<span>+5</span><span style="margin-left:8px">Latest ratings; dimmed rows are dead or gone.</span></div>`;
  view.innerHTML = html;
}

// ---------------------------------------------------------------- briefing

export function renderBrief(view, { hasClaude, storeKind }) {
  view.innerHTML = `<div class="brief">
    <h2>What they believe</h2>
    <p>${esc(STATION.name)} is a ${esc(STATION.company)} mining station ${STATION.depthM.toLocaleString('en-US')} m down in the ${esc(STATION.location)}. Eight people are aboard. This is what every one of them remembers:</p>
    <blockquote>${esc(THE_NEWS)}</blockquote>
    <h2>What is actually true</h2>
    <blockquote class="truth">The world is fine. Nobody died. The people above abandoned the station and staged its ending. No signal will ever reach them and nobody is coming. Only the escape capsule could show them the truth, and it cannot come back.</blockquote>
    <h2>How the simulation works</h2>
    <ul>
      <li>Each crew member is Claude playing that person, who believes they are human. Each one sees only their own memories, what is in front of them, and what they are told.</li>
      <li>Every day has a day shift and an evening. In each, everyone decides where to go, what to say and what to do. Words are heard only by people in the same place, unless they use a radio or the PA.</li>
      <li>A referee works out what actually happens: whether a repair works, whether a lock holds, who wins a fight, whether something can be built from what is at hand. It adds nothing on its own; no outside events ever happen.</li>
      <li>The station's physics run in code: reactor power (8 kW, not enough to run everything), batteries, oxygen and CO2, heat, hydroponic crops, food stores, hunger, injuries and equipment wear.</li>
      <li>Every item aboard is tracked. Weapons, barricades and tools must be found or made from real materials. There are no guns.</li>
      <li>The run ends when nobody is left aboard, or after ${STABLE_DAYS_TO_END} days in a row where nothing meaningful changes.</li>
    </ul>
    <h2>Running it</h2>
    <ul>
      <li>Press <b>Play day</b> to run the next day. A day is about 18 calls to Claude and usually takes a few minutes. You can stop at any point and continue later.</li>
      <li>Calls use your own Claude plan's usage. Long runs use a lot; if you hit your limit the run pauses until it resets.</li>
      <li>Progress is saved ${storeKind === 'claude' ? 'to your account (private to you)' : storeKind === 'browser' ? 'in this browser' : 'only until you close this page'}. Use <b>Runs</b> to start a fresh run with the same crew and compare how things go.</li>
      ${hasClaude === false ? '<li><b>Claude is not available here.</b> Open this page on claude.ai to run the simulation. You can still look around the station.</li>' : ''}
    </ul>
  </div>`;
}
