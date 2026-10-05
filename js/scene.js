// The 3D view: a low-poly cutaway of the station on the abyssal plain.
// Uses the global THREE (r128) loaded from cdnjs.

import { NODES, HATCHES } from './data.js';
import { geometricPath } from './engine.js';

const T = typeof window !== 'undefined' ? window.THREE : undefined;

export const CREW_COLORS = {
  ruth: '#3987e5', tomas: '#d95926', hana: '#199e70', pavel: '#c98500',
  grace: '#d55181', elias: '#2f9e2f', danny: '#9085e9', victoria: '#e66767',
};
export const HATCH_COLORS = {
  open: '#3f9a8f', closed: '#c9d3d6', locked: '#f0b43c', barricaded: '#ec835a', welded: '#d03b3b', forced: '#5d727a',
};
export const HATCH_LABELS = { open: 'Open', closed: 'Closed', locked: 'Locked', barricaded: 'Barricaded', welded: 'Welded', forced: 'Forced' };

const R = 2.3;          // module radius
const L = 7.6;          // module length
const HUB_R = 3.2;
const DECK = 0;         // floor height inside modules
const AXIS_Y = 1.25;    // module axis height
const SEABED = -1.6;

const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x, z) {
  return Math.sin(x * 0.07) * Math.cos(z * 0.06) * 1.4 + Math.sin(x * 0.19 + z * 0.13) * 0.5 + (hash(Math.round(x), Math.round(z)) - 0.5) * 0.35;
}

function v3(x, y, z) { return new T.Vector3(x, y, z); }
const P = (id) => { const [x, z] = NODES[id].pos; return v3(x, 0, z); };

function parentOf(node) {
  for (const h of Object.values(HATCHES)) if (h.b === node && NODES[node].kind === 'module') return h.a;
  return null;
}

export function createScene(container, labelLayer, { onPick } = {}) {
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  container.appendChild(renderer.domElement);

  const scene = new T.Scene();
  const fogColor = new T.Color('#04121a');
  scene.background = fogColor;
  scene.fog = new T.FogExp2(fogColor, 0.0085);

  const camera = new T.PerspectiveCamera(40, 1, 0.5, 500);
  const view = { target: v3(3, 0, 0), radius: 66, theta: -0.62, phi: 0.92 };

  scene.add(new T.HemisphereLight('#9cc6d8', '#1a2326', 0.85));
  const sun = new T.DirectionalLight('#e6f2f6', 0.7);
  sun.position.set(-30, 80, 40);
  scene.add(sun);
  const work = new T.PointLight('#ffd9a0', 0.9, 70, 1.6);
  work.position.set(2, 14, 0);
  scene.add(work);

  // Seabed.
  const bed = new T.PlaneGeometry(320, 320, 80, 80);
  bed.rotateX(-Math.PI / 2);
  const pos = bed.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const d = Math.hypot(x - 2, z) / 40;
    const flat = Math.min(1, Math.max(0, d - 0.35));
    pos.setY(i, SEABED + noise(x, z) * (0.25 + flat * 1.8) - 0.2);
  }
  bed.computeVertexNormals();
  scene.add(new T.Mesh(bed, new T.MeshStandardMaterial({ color: '#4a4740', roughness: 1, flatShading: true })));

  // Polymetallic nodules: what the station was here to mine.
  const nodGeo = new T.IcosahedronGeometry(0.32, 0);
  const nodMat = new T.MeshStandardMaterial({ color: '#1f1c19', roughness: 0.9, flatShading: true });
  const nodules = new T.InstancedMesh(nodGeo, nodMat, 700);
  const m4 = new T.Matrix4();
  let placed = 0;
  for (let i = 0; placed < 700 && i < 5000; i++) {
    const x = (hash(i, 1.3) - 0.5) * 200;
    const z = (hash(2.7, i) - 0.5) * 200;
    if (Math.abs(x - 2) < 36 && Math.abs(z) < 26) continue;
    const sc = 0.6 + hash(i, i) * 1.2;
    m4.compose(v3(x, SEABED + noise(x, z) * 0.6 - 0.05, z), new T.Quaternion().setFromEuler(new T.Euler(hash(i, 3), hash(4, i) * 6, 0)), v3(sc, sc * 0.7, sc));
    nodules.setMatrixAt(placed++, m4);
  }
  nodules.count = placed;
  scene.add(nodules);

  // Materials.
  const hullOut = new T.MeshStandardMaterial({ color: '#f2b52a', roughness: 0.62, metalness: 0.05, flatShading: true, side: T.FrontSide });
  const hullIn = new T.MeshStandardMaterial({ color: '#56666c', roughness: 0.9, flatShading: true, side: T.BackSide });
  const steel = new T.MeshStandardMaterial({ color: '#7d8a8f', roughness: 0.6, metalness: 0.3, flatShading: true });
  const dark = new T.MeshStandardMaterial({ color: '#26333a', roughness: 0.9, flatShading: true });
  const floorMat = new T.MeshStandardMaterial({ color: '#5a6a70', roughness: 0.95, flatShading: true, emissive: new T.Color('#ffd8a8'), emissiveIntensity: 0.18 });

  const pickables = [];
  const nodeAnchor = {};   // where a node's label sits and its people stand
  const nodeAxis = {};     // { origin, dir, len } for laying out figures

  function cutawayTube(len, radius, segs = 10) {
    const gap = (2 * Math.PI) / 3;
    const g = new T.CylinderGeometry(radius, radius, len, segs, 1, true, Math.PI / 2 + gap / 2, 2 * Math.PI - gap);
    g.rotateZ(Math.PI / 2); // axis along X, opening on top
    return g;
  }

  function addModule(id) {
    const parent = parentOf(id);
    const c = P(id);
    const pp = P(parent);
    const dir = c.clone().sub(pp).normalize();
    const group = new T.Group();
    group.position.set(c.x, AXIS_Y, c.z);
    group.rotation.y = -Math.atan2(dir.z, dir.x);
    const geo = cutawayTube(L, R);
    const outer = new T.Mesh(geo, hullOut);
    const inner = new T.Mesh(geo, hullIn);
    group.add(outer, inner);
    for (const sx of [-L / 2, L / 2]) {
      const ring = new T.Mesh(new T.TorusGeometry(R, 0.16, 4, 10), steel);
      ring.rotation.y = Math.PI / 2;
      ring.position.x = sx;
      group.add(ring);
    }
    const floor = new T.Mesh(new T.BoxGeometry(L - 0.3, 0.14, R * 1.55), floorMat.clone());
    floor.position.y = DECK - AXIS_Y - 0.07;
    group.add(floor);
    // Legs to the seabed.
    for (const sx of [-L / 3, L / 3]) for (const sz of [-R * 0.6, R * 0.6]) {
      const leg = new T.Mesh(new T.CylinderGeometry(0.14, 0.2, AXIS_Y - SEABED - R * 0.4, 5), dark);
      leg.position.set(sx, -(AXIS_Y - SEABED) / 2 - R * 0.2 + 0.2, sz);
      group.add(leg);
    }
    outer.userData.node = id;
    inner.userData.node = id;
    floor.userData.node = id;
    pickables.push(outer, inner, floor);
    scene.add(group);
    nodeAnchor[id] = v3(c.x, AXIS_Y + R + 0.9, c.z);
    nodeAxis[id] = { origin: v3(c.x, DECK, c.z), dir, len: L - 1.6 };
    // Connecting tube from the parent hub or corridor.
    const pr = NODES[parent].kind === 'hub' ? HUB_R : NODES[parent].kind === 'corridor' ? 1.9 : L / 2;
    const start = pp.clone().add(dir.clone().multiplyScalar(pr));
    const end = c.clone().sub(dir.clone().multiplyScalar(L / 2));
    const len = start.distanceTo(end);
    if (len > 0.2) {
      const tube = new T.Mesh(new T.CylinderGeometry(1.15, 1.15, len, 8, 1, true), hullOut);
      tube.position.copy(start.clone().add(end).multiplyScalar(0.5)).setY(AXIS_Y - 0.2);
      tube.quaternion.setFromUnitVectors(v3(0, 1, 0), dir.clone());
      scene.add(tube);
    }
    return { group, floor, dir, c };
  }

  function addHub(id) {
    const c = P(id);
    const g = new T.Group();
    g.position.set(c.x, 0, c.z);
    const wall = new T.Mesh(new T.CylinderGeometry(HUB_R, HUB_R, 3.6, 8, 1, true), hullOut);
    wall.position.y = 1.6;
    const wallIn = new T.Mesh(wall.geometry, hullIn);
    wallIn.position.y = 1.6;
    const rim = new T.Mesh(new T.TorusGeometry(HUB_R, 0.18, 4, 8), steel);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 3.4;
    const floor = new T.Mesh(new T.CylinderGeometry(HUB_R - 0.1, HUB_R - 0.1, 0.14, 8), floorMat.clone());
    floor.position.y = -0.07;
    const base = new T.Mesh(new T.CylinderGeometry(HUB_R * 0.8, HUB_R, -SEABED, 8), dark);
    base.position.y = SEABED / 2 - 0.1;
    g.add(wall, wallIn, rim, floor, base);
    for (const m of [wall, wallIn, floor]) { m.userData.node = id; pickables.push(m); }
    scene.add(g);
    nodeAnchor[id] = v3(c.x, 4.6, c.z);
    nodeAxis[id] = { origin: v3(c.x, DECK, c.z), dir: v3(1, 0, 0), len: 3.2, ring: true };
    return { floor };
  }

  function addCorridor() {
    const a = P('FH').add(v3(HUB_R, 0, 0));
    const b = P('AH').sub(v3(HUB_R, 0, 0));
    const len = a.distanceTo(b);
    const g = new T.Group();
    g.position.set((a.x + b.x) / 2, AXIS_Y - 0.3, 0);
    const geo = cutawayTube(len, 1.9, 10);
    const o = new T.Mesh(geo, hullOut);
    const i = new T.Mesh(geo, hullIn);
    const floor = new T.Mesh(new T.BoxGeometry(len, 0.12, 2.4), floorMat.clone());
    floor.position.y = DECK - (AXIS_Y - 0.3) - 0.06;
    g.add(o, i, floor);
    for (const m of [o, i, floor]) { m.userData.node = 'MC'; pickables.push(m); }
    for (let x = -len / 2 + 2; x < len / 2; x += 5) {
      const leg = new T.Mesh(new T.CylinderGeometry(0.14, 0.2, AXIS_Y - SEABED, 5), dark);
      leg.position.set(x, -(AXIS_Y - SEABED) / 2, 0);
      g.add(leg);
    }
    scene.add(g);
    nodeAnchor.MC = v3(0, 3.8, 0);
    nodeAxis.MC = { origin: v3(0, DECK, 0), dir: v3(1, 0, 0), len: 14 };
    return { floor };
  }

  const floors = {};
  const modules = {};
  for (const id of Object.keys(NODES)) {
    const k = NODES[id].kind;
    if (k === 'module') { modules[id] = addModule(id); floors[id] = modules[id].floor; }
    else if (k === 'hub') floors[id] = addHub(id).floor;
  }
  floors.MC = addCorridor().floor;

  // Interior props.
  const glow = (color, intensity = 1) => new T.MeshStandardMaterial({ color: '#111', emissive: new T.Color(color), emissiveIntensity: intensity, flatShading: true });
  function prop(id, geo, mat, along, side, y = 0) {
    const ax = nodeAxis[id];
    const perp = v3(-ax.dir.z, 0, ax.dir.x);
    const m = new T.Mesh(geo, mat);
    m.position.copy(ax.origin).add(ax.dir.clone().multiplyScalar(along)).add(perp.multiplyScalar(side)).setY(DECK + y);
    m.rotation.y = -Math.atan2(ax.dir.z, ax.dir.x);
    scene.add(m);
    return m;
  }
  const reactorMat = glow('#4fd6ff', 1.2);
  const reactor = prop('PWR', new T.CylinderGeometry(0.8, 0.8, 2.2, 8), reactorMat, 1.8, 0, 1.1);
  prop('PWR', new T.BoxGeometry(2.4, 1.8, 0.5), steel, -1.6, -1.15, 0.9);
  const growMat = glow('#d24bd8', 0.9);
  const growRacks = [];
  for (const a of [-2.4, -0.8, 0.8, 2.4]) {
    growRacks.push(prop('HYD', new T.BoxGeometry(1.1, 0.12, 2.4), growMat, a, 0, 1.6));
    prop('HYD', new T.BoxGeometry(1.0, 0.5, 2.2), new T.MeshStandardMaterial({ color: '#2f6b33', flatShading: true }), a, 0, 0.35);
  }
  for (const a of [-2, 0, 2]) prop('LS', new T.CylinderGeometry(0.45, 0.45, 2.0, 7), steel, a, -1.0, 1.0);
  prop('LS', new T.BoxGeometry(1.8, 1.4, 0.8), dark, 0.5, 1.0, 0.7);
  prop('GAL', new T.BoxGeometry(3.2, 0.12, 1.3), new T.MeshStandardMaterial({ color: '#8a6a48', flatShading: true }), 0.6, 0, 0.85);
  prop('GAL', new T.BoxGeometry(2, 1, 0.7), steel, -2.4, -1.1, 0.5);
  for (const a of [-2.2, -0.6, 1]) for (const sd of [-0.9, 0.9]) prop('STR', new T.BoxGeometry(1.1, 1.1, 0.9), new T.MeshStandardMaterial({ color: '#6b5a3c', flatShading: true }), a, sd, 0.55);
  for (const q of ['QA', 'QB']) for (const a of [-2.4, -0.8, 0.8, 2.4]) prop(q, new T.BoxGeometry(1.2, 0.4, 2.1), new T.MeshStandardMaterial({ color: '#41525a', flatShading: true }), a, 0.95, 0.25);
  for (const a of [-1.5, 1.5]) prop('MED', new T.BoxGeometry(1.0, 0.6, 2.0), new T.MeshStandardMaterial({ color: '#c8d4d8', flatShading: true }), a, 0.8, 0.35);
  const screens = glow('#5fd1a4', 0.7);
  for (const a of [-2, 0, 2]) prop('CTRL', new T.BoxGeometry(1.3, 1, 0.6), screens, a, -1.15, 0.9);
  prop('WRK', new T.BoxGeometry(3.4, 0.9, 0.9), new T.MeshStandardMaterial({ color: '#5d4b3b', flatShading: true }), 0, -1.0, 0.45);
  const rov = prop('ROV', new T.BoxGeometry(2.2, 1.3, 1.5), new T.MeshStandardMaterial({ color: '#e46c2c', flatShading: true }), 0.8, 0.4, 0.8);
  rov.add(new T.Mesh(new T.BoxGeometry(2.3, 0.3, 1.6), dark));
  prop('DCK', new T.TorusGeometry(1.4, 0.25, 4, 10), steel, 1.5, 0, 0.1).rotation.x = Math.PI / 2;

  // Escape capsule on the dock's roof.
  const capsule = new T.Group();
  const capMat = new T.MeshStandardMaterial({ color: '#ff7a1a', roughness: 0.6, flatShading: true });
  const capBody = new T.Mesh(new T.IcosahedronGeometry(1.7, 1), capMat);
  capBody.scale.set(1, 1.15, 1);
  const capBand = new T.Mesh(new T.TorusGeometry(1.72, 0.12, 4, 10), steel);
  capBand.rotation.x = Math.PI / 2;
  capsule.add(capBody, capBand);
  const capPos = P('DCK');
  capsule.position.set(capPos.x - 1.4, AXIS_Y + R + 1.7, capPos.z);
  capBody.userData.node = 'CAP';
  pickables.push(capBody);
  scene.add(capsule);
  nodeAnchor.CAP = capsule.position.clone().add(v3(0, 2.6, 0));
  nodeAxis.CAP = { origin: capsule.position.clone().add(v3(0, -0.6, 0)), dir: v3(1, 0, 0), len: 1.6, ring: true };

  // The dead umbilical, rising into the dark.
  const umb = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    // Leaves the power room and climbs away from the default camera into the dark.
    umb.push(v3(12 - t * 40 + Math.sin(t * 3) * 3, AXIS_Y + R + 0.2 + t * t * 160, -14 + t * 10 + Math.cos(t * 4) * 2));
  }
  const umbGeo = new T.TubeGeometry(new T.CatmullRomCurve3(umb), 80, 0.16, 5, false);
  scene.add(new T.Mesh(umbGeo, new T.MeshStandardMaterial({ color: '#202a2e', roughness: 0.8, flatShading: true })));

  // The mining crawler, parked.
  const crawler = new T.Group();
  const cb = new T.Mesh(new T.BoxGeometry(6, 1.8, 3.4), new T.MeshStandardMaterial({ color: '#d7a52c', flatShading: true }));
  cb.position.y = 1.5;
  crawler.add(cb);
  for (const s of [-1.9, 1.9]) {
    const tr = new T.Mesh(new T.BoxGeometry(6.6, 1.1, 0.9), dark);
    tr.position.set(0, 0.55, s);
    crawler.add(tr);
  }
  crawler.position.set(-6, SEABED - 0.3, 26);
  crawler.rotation.y = 0.5;
  scene.add(crawler);

  // Marine snow.
  const snowN = 1600;
  const snowGeo = new T.BufferGeometry();
  const sp = new Float32Array(snowN * 3);
  for (let i = 0; i < snowN; i++) {
    sp[i * 3] = (Math.random() - 0.5) * 140 + 2;
    sp[i * 3 + 1] = Math.random() * 50 + SEABED;
    sp[i * 3 + 2] = (Math.random() - 0.5) * 110;
  }
  snowGeo.setAttribute('position', new T.BufferAttribute(sp, 3));
  const snow = new T.Points(snowGeo, new T.PointsMaterial({ color: '#a9c9d1', size: 0.14, transparent: true, opacity: 0.55, depthWrite: false }));
  scene.add(snow);

  // Hatch markers.
  const hatchMarkers = {};
  for (const [hid, h] of Object.entries(HATCHES)) {
    let p;
    let dir;
    if (hid === 'h_cap') { p = capsule.position.clone().add(v3(0, -1.8, 0)); dir = v3(0, 1, 0); }
    else if (hid === 'h_fwd') { p = P('FH').add(v3(HUB_R + 0.05, AXIS_Y - 0.3, 0)); dir = v3(1, 0, 0); }
    else if (hid === 'h_aft') { p = P('AH').sub(v3(HUB_R + 0.05, -(AXIS_Y - 0.3), 0)); dir = v3(1, 0, 0); }
    else {
      const m = modules[h.b];
      dir = m.dir.clone();
      p = m.c.clone().sub(dir.clone().multiplyScalar(L / 2 + 0.05)).setY(AXIS_Y - 0.2);
    }
    const mat = new T.MeshBasicMaterial({ color: HATCH_COLORS.open, side: T.DoubleSide });
    const disc = new T.Mesh(new T.CircleGeometry(1.0, 8), mat);
    disc.position.copy(p);
    disc.quaternion.setFromUnitVectors(v3(0, 0, 1), dir);
    const frame = new T.Mesh(new T.TorusGeometry(1.05, 0.12, 4, 8), steel);
    frame.position.copy(p);
    frame.quaternion.copy(disc.quaternion);
    scene.add(disc, frame);
    hatchMarkers[hid] = { disc, mat };
  }

  // People.
  const figures = {};
  const selRing = new T.Mesh(new T.TorusGeometry(0.7, 0.07, 4, 16), new T.MeshBasicMaterial({ color: '#ffffff' }));
  selRing.rotation.x = Math.PI / 2;
  selRing.visible = false;
  scene.add(selRing);

  function makeFigure(pid) {
    const color = new T.Color(CREW_COLORS[pid] || '#cccccc');
    const mat = new T.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true });
    const g = new T.Group();
    const body = new T.Mesh(new T.CylinderGeometry(0.28, 0.4, 1.1, 6), mat);
    body.position.y = 0.55;
    const head = new T.Mesh(new T.IcosahedronGeometry(0.26, 0), mat);
    head.position.y = 1.36;
    g.add(body, head);
    body.userData.pid = pid;
    head.userData.pid = pid;
    pickables.push(body, head);
    scene.add(g);
    return { g, mat, color, from: null, to: null, path: null, t: 1 };
  }

  function slotPosition(node, index, count) {
    const ax = nodeAxis[node];
    if (!ax) return v3(0, 0, 0);
    if (ax.ring) {
      const ang = (index / Math.max(1, count)) * Math.PI * 2 + 0.4;
      const rr = node === 'CAP' ? 0.7 : 1.7;
      return ax.origin.clone().add(v3(Math.cos(ang) * rr, 0, Math.sin(ang) * rr));
    }
    const perp = v3(-ax.dir.z, 0, ax.dir.x);
    const span = Math.min(ax.len, count * 1.3);
    const along = count > 1 ? -span / 2 + (span / (count - 1)) * index : 0;
    const side = node === 'MC' ? (index % 2 ? 0.45 : -0.45) : (index % 2 ? 0.55 : -0.55);
    return ax.origin.clone().add(ax.dir.clone().multiplyScalar(along)).add(perp.multiplyScalar(side));
  }

  let current = null;
  let selected = null;

  function update(state, { animate = false } = {}) {
    current = state;
    // Hatches.
    for (const [hid, m] of Object.entries(hatchMarkers)) {
      const h = state.hatches[hid];
      m.mat.color.set(HATCH_COLORS[h.state] || HATCH_COLORS.closed);
      m.disc.visible = !(hid === 'h_cap' && state.capsule !== 'docked');
    }
    capsule.userData.launched = state.capsule !== 'docked';
    if (!capsule.userData.launched) { capsule.visible = true; capsule.position.y = AXIS_Y + R + 1.7; }
    else if (!animate || reduceMotion) capsule.visible = false;

    // Light levels follow the power actually delivered.
    const served = state.power?.served || {};
    const base = served.base ?? 1;
    const lights = state.power.battery + state.power.fuel > 1 || base >= 0.999 ? 1 : base;
    for (const f of Object.values(floors)) f.material.emissiveIntensity = 0.06 + 0.16 * lights;
    work.intensity = 0.25 + 0.75 * lights;
    const grow = (state.levels.hydro || 0) * (served.hydro ?? 1);
    growMat.emissiveIntensity = 0.08 + 1.1 * grow;
    reactorMat.emissiveIntensity = 0.1 + 1.2 * Math.min(1.15, (state.power.supplyKw || 0) / 8);

    // People.
    const byNode = {};
    for (const p of Object.values(state.people)) {
      if (!p.aboard && p.alive) continue;
      (byNode[p.loc] = byNode[p.loc] || []).push(p.id);
    }
    for (const p of Object.values(state.people)) {
      const f = figures[p.id] || (figures[p.id] = makeFigure(p.id));
      if (p.alive && !p.aboard) { f.g.visible = false; continue; }
      f.g.visible = true;
      const list = byNode[p.loc] || [p.id];
      const target = slotPosition(p.loc, list.indexOf(p.id), list.length);
      const lying = !p.alive || !p.conscious;
      f.mat.color.copy(f.color);
      if (!p.alive) f.mat.color.lerp(new T.Color('#3a3a3a'), 0.7);
      f.lying = lying;
      const prevNode = f.node;
      f.node = p.loc;
      if (animate && !reduceMotion && prevNode && prevNode !== p.loc) {
        const path = geometricPath(state, prevNode, p.loc) || [prevNode, p.loc];
        const pts = [f.g.position.clone()];
        for (const n of path.slice(1, -1)) pts.push(nodeAxis[n].origin.clone());
        pts.push(target);
        f.path = pts;
        f.t = 0;
      } else if (animate && !reduceMotion && f.g.position.distanceTo(target) > 0.05) {
        f.path = [f.g.position.clone(), target];
        f.t = 0;
      } else {
        f.path = null;
        f.t = 1;
        f.g.position.copy(target);
      }
      f.g.rotation.z = lying ? Math.PI / 2 : 0;
      f.g.position.y = lying ? 0.3 : 0;
    }
    if (state.capsule === 'launched' && animate && !reduceMotion && capsule.visible) capsule.userData.rise = 0;
    refreshLabels();
  }

  // Labels.
  const nodeLabels = {};
  for (const id of Object.keys(NODES)) {
    if (id === 'CAP') continue;
    const el = document.createElement('div');
    el.className = 'lbl-node';
    el.textContent = NODES[id].short;
    labelLayer.appendChild(el);
    nodeLabels[id] = el;
  }
  const personLabels = {};
  function refreshLabels() {
    if (!current) return;
    for (const p of Object.values(current.people)) {
      let el = personLabels[p.id];
      if (!el) {
        el = document.createElement('div');
        el.className = 'lbl-person';
        el.innerHTML = `<span class="dot" style="background:${CREW_COLORS[p.id]}"></span><span></span>`;
        labelLayer.appendChild(el);
        personLabels[p.id] = el;
      }
      el.lastChild.textContent = p.short;
      el.classList.toggle('dead', !p.alive);
      el.classList.toggle('sel', selected === p.id);
      el.hidden = p.alive && !p.aboard;
    }
  }

  const tmp = new T.Vector3();
  function project(v, el, w, h) {
    tmp.copy(v).project(camera);
    const vis = tmp.z < 1 && tmp.x > -1.2 && tmp.x < 1.2 && tmp.y > -1.2 && tmp.y < 1.2;
    el.style.display = vis ? '' : 'none';
    if (vis) el.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px) translate(-50%, -100%)`;
  }

  function placeLabels() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    for (const [id, el] of Object.entries(nodeLabels)) project(nodeAnchor[id], el, w, h);
    // People standing together get one tidy column of name tags; walkers carry their own.
    const groups = {};
    for (const [pid, el] of Object.entries(personLabels)) {
      const f = figures[pid];
      if (!f || !f.g.visible || el.hidden) { el.style.display = 'none'; continue; }
      if (f.path) {
        tmp.copy(f.g.position).add(v3(0, 2.1, 0));
        project(tmp.clone(), el, w, h);
      } else (groups[f.node] = groups[f.node] || []).push([pid, el, f]);
    }
    for (const list of Object.values(groups)) {
      if (list.length === 1) {
        const [, el, f] = list[0];
        tmp.copy(f.g.position).add(v3(0, f.lying ? 1.0 : 2.1, 0));
        project(tmp.clone(), el, w, h);
        continue;
      }
      const c = v3(0, 0, 0);
      for (const [, , f] of list) c.add(f.g.position);
      c.multiplyScalar(1 / list.length).add(v3(0, 2.2, 0));
      tmp.copy(c).project(camera);
      const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2;
      const x = ((tmp.x + 1) / 2) * w;
      const y = ((1 - tmp.y) / 2) * h;
      list.forEach(([, el], i) => {
        el.style.display = vis ? '' : 'none';
        if (vis) el.style.transform = `translate(${x}px, ${y - (list.length - 1 - i) * 21}px) translate(-50%, -100%)`;
      });
    }
  }

  // Camera controls.
  function applyCamera() {
    const { target, radius, theta, phi } = view;
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.cos(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.sin(theta),
    );
    camera.lookAt(target);
  }
  const el = renderer.domElement;
  const pointers = new Map();
  let downAt = null;
  let pinch0 = 0;
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  el.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0) view.radius = Math.max(16, Math.min(150, view.radius * (pinch0 / d)));
      pinch0 = d;
    } else if (e.shiftKey || e.buttons === 2) {
      const s = view.radius * 0.0016;
      const right = v3(Math.sin(view.theta), 0, -Math.cos(view.theta));
      const fwd = v3(Math.cos(view.theta), 0, Math.sin(view.theta));
      view.target.add(right.multiplyScalar(dx * s)).add(fwd.multiplyScalar(dy * s));
    } else {
      view.theta += dx * 0.006;
      view.phi = Math.max(0.2, Math.min(1.45, view.phi - dy * 0.005));
    }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch0 = 0;
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6 && performance.now() - downAt.t < 500) pick(e);
    downAt = null;
  };
  el.addEventListener('pointerup', endPointer);
  el.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); downAt = null; });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.radius = Math.max(16, Math.min(150, view.radius * Math.exp(e.deltaY * 0.0012)));
  }, { passive: false });

  const ray = new T.Raycaster();
  const ndc = new T.Vector2();
  function pick(e) {
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    if (!hit) return;
    if (hit.object.userData.pid) onPick && onPick({ type: 'person', id: hit.object.userData.pid });
    else if (hit.object.userData.node) onPick && onPick({ type: 'node', id: hit.object.userData.node });
  }

  function select(pid) {
    selected = pid;
    refreshLabels();
  }

  function focusNode(id) {
    const a = nodeAxis[id];
    if (!a) return;
    view.target.copy(a.origin);
    view.radius = Math.min(view.radius, 34);
  }

  // Resize and render loop.
  let sized = false;
  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!sized && w > 1) {
      sized = true;
      if (camera.aspect < 1.1) view.radius = 66 * Math.min(1.9, 1.25 / camera.aspect);
    }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let last = performance.now();
  let running = true;
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const f of Object.values(figures)) {
      if (!f.path) continue;
      f.t = Math.min(1, f.t + dt / 2.4);
      const segs = f.path.length - 1;
      const x = f.t * segs;
      const i = Math.min(segs - 1, Math.floor(x));
      const k = x - i;
      f.g.position.lerpVectors(f.path[i], f.path[i + 1], k);
      f.g.position.y = f.lying ? 0.3 : Math.abs(Math.sin(f.t * 40)) * 0.06;
      if (f.t >= 1) f.path = null;
    }
    if (capsule.userData.launched && capsule.visible) {
      capsule.userData.rise = (capsule.userData.rise || 0) + dt;
      capsule.position.y += dt * (1 + capsule.userData.rise * 3);
      if (capsule.position.y > 80) capsule.visible = false;
    }
    if (!reduceMotion) {
      const arr = snowGeo.attributes.position.array;
      for (let i = 1; i < arr.length; i += 3) {
        arr[i] -= dt * 0.35;
        if (arr[i] < SEABED) arr[i] = SEABED + 50;
      }
      snowGeo.attributes.position.needsUpdate = true;
    }
    if (selected && figures[selected] && figures[selected].g.visible) {
      selRing.visible = true;
      selRing.position.copy(figures[selected].g.position).setY(0.05);
    } else selRing.visible = false;
    applyCamera();
    renderer.render(scene, camera);
    placeLabels();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    update, select, focusNode,
    dispose() { running = false; ro.disconnect(); renderer.dispose(); },
  };
}
