// Saves runs. In claude.ai the artifact's private per-viewer database keeps them
// across visits; elsewhere they live in this browser (or only in memory).

const LS_KEY = 'nereid-runs-v1';

function memoryStore(persist) {
  let data = { runs: {} };
  if (persist) {
    try { data = JSON.parse(localStorage.getItem(LS_KEY)) || data; } catch { /* storage unavailable */ }
  }
  const save = () => {
    if (!persist) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch { /* full or blocked */ }
  };
  return {
    kind: persist ? 'browser' : 'memory',
    async listRuns() {
      return Object.values(data.runs).map((r) => r.meta).sort((a, b) => b.updated - a.updated);
    },
    async loadRun(id) {
      const r = data.runs[id];
      return r ? { state: JSON.parse(r.state), days: Object.values(r.days).map((d) => JSON.parse(d)) } : null;
    },
    async saveState(state) {
      const r = data.runs[state.runId] || (data.runs[state.runId] = { days: {} });
      r.meta = runMeta(state);
      r.state = JSON.stringify(state);
      save();
    },
    async saveDay(runId, dayLog) {
      const r = data.runs[runId] || (data.runs[runId] = { days: {} });
      r.days[dayLog.day] = JSON.stringify(dayLog);
      save();
    },
  };
}

export function runMeta(state) {
  const aboard = Object.values(state.people).filter((p) => p.alive && p.aboard).length;
  return {
    runId: state.runId, created: state.created, updated: Date.now(),
    day: state.day, phase: state.phase, alive: aboard, ended: state.ended ? state.ended.reason : null,
  };
}

// Split for the artifact database's 256 KiB-per-document limit: each person's recent
// memories live in their own document, and each day is stored as a small header plus
// one document per phase. Older single-document runs still load.
export function splitState(state) {
  const core = { ...state, people: {} };
  const memories = {};
  for (const [id, p] of Object.entries(state.people)) {
    const { recent, ...rest } = p;
    core.people[id] = rest;
    memories[id] = recent || [];
  }
  return { core, memories };
}

export function joinState(core, memories) {
  const state = { ...core, people: {} };
  for (const [id, p] of Object.entries(core.people)) state.people[id] = { ...p, recent: memories[id] ?? p.recent ?? [] };
  return state;
}

export function splitDay(rec) {
  const { morning, evening, ...head } = rec;
  return { head: { ...head, split: true }, morning, evening };
}

export function joinDays(docs) {
  const byDay = {};
  for (const { id, body } of docs) {
    const m = /^d(\d+)(?:-(morning|evening))?$/.exec(id);
    if (!m) continue;
    const day = Number(m[1]);
    const rec = (byDay[day] = byDay[day] || { day });
    if (m[2]) rec[m[2]] = body;
    else Object.assign(rec, body);
    delete rec.split;
  }
  return Object.values(byDay).sort((a, b) => a.day - b.day);
}

export function dbStore(db, uid) {
  const runs = db.doc(`data/users/${uid}/paradise`).collection('runs');
  // One write at a time per document, and only when its content changed.
  const queue = new Map();
  const lastWritten = new Map();
  const write = (ref, json) => {
    if (lastWritten.get(ref.path) === json) return Promise.resolve();
    const prev = queue.get(ref.path) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => ref.set({ json })).then(() => { lastWritten.set(ref.path, json); });
    queue.set(ref.path, next);
    return next;
  };
  return {
    kind: 'claude',
    async listRuns() {
      const snap = await runs.orderBy('updated', 'desc').limit(30).get();
      return snap.docs.map((d) => d.data());
    },
    async loadRun(id) {
      const blob = await runs.doc(id).collection('blob').limit(100).get();
      const docs = Object.fromEntries(blob.docs.map((d) => [d.id, JSON.parse(d.data().json)]));
      if (!docs.state) return null;
      const memories = {};
      for (const [k, v] of Object.entries(docs)) if (k.startsWith('mem-')) memories[k.slice(4)] = v;
      const days = await runs.doc(id).collection('days').limit(1000).get();
      return {
        state: joinState(docs.state, memories),
        days: joinDays(days.docs.map((d) => ({ id: d.id, body: JSON.parse(d.data().json) }))),
      };
    },
    async saveState(state) {
      const { core, memories } = splitState(state);
      const blob = runs.doc(state.runId).collection('blob');
      for (const [pid, mem] of Object.entries(memories)) await write(blob.doc(`mem-${pid}`), JSON.stringify(mem));
      await write(blob.doc('state'), JSON.stringify(core));
      await runs.doc(state.runId).set(runMeta(state));
    },
    async saveDay(runId, rec) {
      const { head, morning, evening } = splitDay(rec);
      const days = runs.doc(runId).collection('days');
      if (morning) await write(days.doc(`d${rec.day}-morning`), JSON.stringify(morning));
      if (evening) await write(days.doc(`d${rec.day}-evening`), JSON.stringify(evening));
      await write(days.doc(`d${rec.day}`), JSON.stringify(head));
    },
  };
}

export async function openStore() {
  const c = typeof window !== 'undefined' ? window.claude : null;
  if (c && typeof c.use === 'function') {
    try {
      const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
      const uid = user ? await user.id() : null;
      if (db && uid) return dbStore(db, uid);
    } catch { /* fall through */ }
  }
  let ok = false;
  try { localStorage.setItem('nereid-probe', '1'); localStorage.removeItem('nereid-probe'); ok = true; } catch { ok = false; }
  return memoryStore(ok);
}
