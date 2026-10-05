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

function dbStore(db, uid) {
  const runs = db.doc(`data/users/${uid}/paradise`).collection('runs');
  // One write at a time per document.
  const queue = new Map();
  const write = (ref, body) => {
    const prev = queue.get(ref.path) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => ref.set(body));
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
      const st = await runs.doc(id).collection('blob').doc('state').get();
      if (!st.exists) return null;
      const days = await runs.doc(id).collection('days').limit(1000).get();
      return {
        state: JSON.parse(st.data().json),
        days: days.docs.map((d) => JSON.parse(d.data().json)),
      };
    },
    async saveState(state) {
      await write(runs.doc(state.runId).collection('blob').doc('state'), { json: JSON.stringify(state) });
      await write(runs.doc(state.runId), runMeta(state));
    },
    async saveDay(runId, dayLog) {
      await write(runs.doc(runId).collection('days').doc(`d${dayLog.day}`), { json: JSON.stringify(dayLog) });
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
