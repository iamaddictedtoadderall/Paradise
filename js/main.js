// Boots the page: the 3D station, the panels, saving, and the Play button.

import { newRunState } from './engine.js';
import { runPhase, Pause } from './runner.js';
import { sampleAI, ERROR_COPY } from './ai.js';
import { openStore, runMeta } from './store.js';
import { createScene } from './scene.js';
import { renderLegend, renderProgress, renderLog, renderCrew, renderStation, renderTrust, renderBrief, esc } from './ui.js';
import { renderSummary, chroniclePrompt, normalizeDigest, latestStory } from './summary.js';

const $ = (id) => document.getElementById(id);
const els = {
  play: $('playBtn'), stop: $('stopBtn'), runs: $('runsBtn'), day: $('dayLabel'), phase: $('phaseLabel'),
  view: $('view'), progress: $('progress'), banner: $('banner'), legend: $('legend'),
  dlg: $('runsDlg'), runList: $('runList'), storeNote: $('storeNote'), newRun: $('newRunBtn'), newConfirm: $('newConfirm'),
  newYes: $('newYes'), closeRuns: $('closeRuns'), tierAgents: $('tierAgents'), tierReferee: $('tierReferee'),
};

const prefs = (() => {
  const d = { tab: 'brief', inner: true, tierAgents: 'default', tierReferee: 'default' };
  try { return { ...d, ...JSON.parse(localStorage.getItem('nereid-prefs') || '{}') }; } catch { return d; }
})();
const savePrefs = () => { try { localStorage.setItem('nereid-prefs', JSON.stringify(prefs)); } catch { /* ignore */ } };

const newId = () => `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

let state = newRunState(newId());
let days = [];
let store = null;
let sample;            // undefined: not known yet; null: unavailable
let running = false;
let abortCtl = null;
let selectedPerson = null;
let focusNode = null;
let progress = {};
let pause = null;
let summarizing = false;

// ---------------------------------------------------------------- rendering

function renderHeader() {
  els.day.textContent = `Day ${state.day}`;
  els.phase.textContent = state.ended ? 'Run ended' : state.phase === 'morning' ? 'Day shift next' : 'Evening next';
  const label = state.ended ? 'Run ended' : running ? 'Running…' : state.pendingPhase || pause ? `Continue day ${state.day}` : state.phase === 'evening' ? `Play evening of day ${state.day}` : `Play day ${state.day}`;
  els.play.textContent = label;
  els.play.disabled = running || summarizing || !!state.ended || sample === null;
  els.stop.hidden = !running;
}

function renderBanner() {
  const b = els.banner;
  if (pause) {
    b.className = 'banner';
    b.innerHTML = `<p>${esc(pause.message)}</p>${pause.canSkip ? '<button class="btn" id="skipPhase" type="button">Skip this phase</button>' : ''}<button class="btn primary" id="contPhase" type="button">Continue</button>`;
    b.hidden = false;
    $('contPhase').onclick = () => play();
    if (pause.canSkip) $('skipPhase').onclick = () => play({ skipReferee: true });
  } else if (sample === null) {
    b.className = 'banner info';
    b.innerHTML = '<p>The crew need Claude to think. Open this page on claude.ai to run the simulation; you can still explore the station.</p>';
    b.hidden = false;
  } else if (state.ended && !running) {
    b.className = 'banner info';
    b.innerHTML = `<p>Run ended on day ${state.ended.day}: ${esc(state.ended.reason)}</p><button class="btn" id="bannerNew" type="button">Start a new run</button>`;
    b.hidden = false;
    $('bannerNew').onclick = openRuns;
  } else b.hidden = true;
}

function renderView() {
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === prefs.tab));
  const v = els.view;
  const top = v.scrollTop;
  if (prefs.tab === 'summary') renderSummary(v, state, days, { canWrite: !!sample, busy: summarizing || running, onWrite: writeMissingSummaries });
  else if (prefs.tab === 'log') renderLog(v, state, days, { inner: prefs.inner }, (on) => { prefs.inner = on; savePrefs(); renderView(); });
  else if (prefs.tab === 'crew') renderCrew(v, state, days, selectedPerson, (pid) => { selectPerson(pid); });
  else if (prefs.tab === 'station') renderStation(v, state, focusNode, (id) => { focusNode = id; scene?.focusNode(id); renderView(); });
  else if (prefs.tab === 'trust') renderTrust(v, state);
  else renderBrief(v, { hasClaude: sample === undefined ? undefined : !!sample, storeKind: store?.kind });
  if (prefs.tab !== 'crew' || !selectedPerson) v.scrollTop = top;
}

function renderAll({ animate = false } = {}) {
  renderHeader();
  renderBanner();
  renderProgress(els.progress, running ? progress : {}, state);
  renderView();
  scene?.update(state, { animate });
}

function selectPerson(pid) {
  selectedPerson = pid;
  scene?.select(pid);
  if (pid) { prefs.tab = 'crew'; savePrefs(); }
  renderView();
  els.view.scrollTop = 0;
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  prefs.tab = t.dataset.tab;
  if (prefs.tab !== 'crew') selectedPerson = null;
  scene?.select(selectedPerson);
  savePrefs();
  renderView();
}));

// ---------------------------------------------------------------- 3D

let scene = null;
try {
  if (!window.THREE) throw new Error('3D library did not load');
  scene = createScene($('viewport'), $('labels'), {
    onPick: (hit) => {
      if (hit.type === 'person') selectPerson(hit.id);
      else { focusNode = hit.id; prefs.tab = 'station'; savePrefs(); renderView(); }
    },
  });
} catch (e) {
  $('viewport').innerHTML = `<p class="empty" style="padding:16px">The 3D view could not start (${esc(e.message)}). Everything else still works.</p>`;
}
renderLegend(els.legend);

// ---------------------------------------------------------------- persistence

function dayLog(d) {
  let rec = days.find((x) => x.day === d);
  if (!rec) { rec = { day: d }; days.push(rec); }
  return rec;
}

async function persist(rec) {
  if (!store) return;
  try {
    if (rec) await store.saveDay(state.runId, rec);
    await store.saveState(state);
  } catch (e) {
    console.warn('save failed', e);
    pause = e && e.code === 'quota_exceeded'
      ? { message: 'Saving failed: this artifact\'s storage is full. Start a new run to keep going.' }
      : { message: `Saving failed (${(e && (e.code || e.message)) || 'unknown error'}). Progress since the last save may be lost if you close the page.` };
    renderBanner();
  }
}

// ---------------------------------------------------------------- summaries

async function chronicle(rec, ai) {
  const raw = await ai.referee(chroniclePrompt(state, rec, latestStory(days, rec.day)), { tier: 'default' });
  const digest = normalizeDigest(raw);
  if (!digest) return false;
  rec.digest = digest;
  await persist(rec);
  return true;
}

async function writeMissingSummaries() {
  if (running || summarizing || !sample) return;
  summarizing = true;
  abortCtl = new AbortController();
  renderView();
  const ai = sampleAI(sample, { signal: () => abortCtl.signal });
  try {
    for (const rec of days.filter((d) => d.tick && !d.digest).sort((a, b) => a.day - b.day)) {
      if (!(await chronicle(rec, ai))) break;
      renderView();
    }
  } catch (e) {
    pause = { message: `The summary could not be written (${e?.message || e?.code || 'error'}). Try again from the Summary tab.` };
    renderBanner();
  } finally {
    summarizing = false;
    abortCtl = null;
    renderView();
  }
}

// ---------------------------------------------------------------- playing

async function play({ skipReferee = false } = {}) {
  if (running || state.ended || !sample) return;
  running = true;
  pause = null;
  abortCtl = new AbortController();
  progress = {};
  renderAll();
  const ai = sampleAI(sample, { signal: () => abortCtl.signal });
  const startDay = state.day;
  try {
    while (!state.ended && state.day === startDay) {
      const res = await runPhase(state, ai, {
        tierAgents: prefs.tierAgents,
        tierReferee: prefs.tierReferee,
        skipReferee,
        progress: ({ who, status }) => { progress[who] = status; renderProgress(els.progress, progress, state); },
        checkpoint: async () => { await persist(); },
      });
      skipReferee = false;
      const rec = dayLog(res.day);
      rec[res.phase] = res.phaseLog;
      if (res.tick) rec.tick = { events: res.tick.events, metrics: res.tick.metrics, stableStreak: res.tick.stableStreak };
      progress = {};
      await persist(rec);
      renderAll({ animate: true });
      if (res.tick) {
        // One more call: the day's summary. If it fails, the Summary tab offers to retry.
        progress = { summary: 'thinking' };
        renderProgress(els.progress, progress, state);
        try { await chronicle(rec, ai); } catch (e) { console.warn('summary failed', e); }
        progress = {};
      }
    }
    if (prefs.tab === 'brief') { prefs.tab = 'summary'; savePrefs(); }
  } catch (e) {
    if (e instanceof Pause) {
      pause = { message: e.message || ERROR_COPY[e.code] || 'Paused.', canSkip: e.canSkip, code: e.code };
      if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(e.code)) {
        pause.message = ERROR_COPY[e.code] || e.message;
      }
    } else {
      console.error(e);
      pause = { message: `Something went wrong: ${e.message || e}. Your progress is saved; try continuing.` };
    }
    await persist();
  } finally {
    running = false;
    abortCtl = null;
    progress = {};
    renderAll();
  }
}

els.play.addEventListener('click', () => play());
els.stop.addEventListener('click', () => abortCtl?.abort());

// ---------------------------------------------------------------- runs

async function openRuns() {
  els.tierAgents.value = prefs.tierAgents;
  els.tierReferee.value = prefs.tierReferee;
  els.newConfirm.hidden = true;
  els.newRun.hidden = false;
  els.storeNote.textContent = store?.kind === 'claude' ? 'Runs are saved to your Claude account, visible only to you.'
    : store?.kind === 'browser' ? 'Runs are saved in this browser.' : 'Runs are kept only while this page is open.';
  let list = [];
  try { list = store ? await store.listRuns() : []; } catch { list = []; }
  if (!list.some((r) => r.runId === state.runId)) list.unshift(runMeta(state));
  els.runList.innerHTML = list.map((r) => `<button class="runrow ${r.runId === state.runId ? 'cur' : ''}" data-id="${esc(r.runId)}" type="button">
    <div><div>Started ${esc(new Date(r.created).toLocaleString())}</div><div class="meta">Day ${r.day} · ${r.alive} of 8 aboard${r.ended ? ` · ended: ${esc(r.ended)}` : ''}</div></div></button>`).join('');
  els.runList.querySelectorAll('.runrow').forEach((b) => b.addEventListener('click', () => loadRun(b.dataset.id)));
  if (typeof els.dlg.showModal === 'function') els.dlg.showModal();
}

async function loadRun(id) {
  if (running || id === state.runId) { els.dlg.close(); return; }
  const r = store && await store.loadRun(id).catch(() => null);
  if (r) {
    state = r.state;
    days = r.days;
    pause = null;
    selectedPerson = null;
    els.dlg.close();
    renderAll();
  }
}

els.runs.addEventListener('click', openRuns);
els.closeRuns.addEventListener('click', () => els.dlg.close());
els.newRun.addEventListener('click', () => { els.newConfirm.hidden = false; els.newRun.hidden = true; });
els.newYes.addEventListener('click', async () => {
  if (running) return;
  state = newRunState(newId());
  days = [];
  pause = null;
  selectedPerson = null;
  els.dlg.close();
  await persist();
  renderAll();
});
els.tierAgents.addEventListener('change', () => { prefs.tierAgents = els.tierAgents.value; savePrefs(); });
els.tierReferee.addEventListener('change', () => { prefs.tierReferee = els.tierReferee.value; savePrefs(); });

// ---------------------------------------------------------------- boot

renderAll();

(async () => {
  const c = window.claude;
  if (c && typeof c.use === 'function') {
    try { sample = await c.use('sample'); } catch { sample = null; }
  } else sample = null;
  renderAll();
})();

(async () => {
  store = await openStore();
  try {
    const list = await store.listRuns();
    const latest = list[0];
    if (latest && !days.length && !running && state.day === 1 && state.phase === 'morning') {
      const r = await store.loadRun(latest.runId);
      if (r) { state = r.state; days = r.days; }
    }
  } catch (e) { console.warn('could not load runs', e); }
  if (days.length && prefs.tab === 'brief') prefs.tab = 'summary';
  renderAll();
})();
