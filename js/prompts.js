// Everything Claude reads. Crew members see only their own memories and
// surroundings; the referee sees the true state of the station.

import { NODES, NODE_DESC, CREW, STATION, THE_NEWS, PERSONAL_NEWS, ROLE_KNOWLEDGE } from './data.js';
import {
  activePeople, carriedBy, itemsAt, bodyFeel, readouts, hatchView, describePresent,
  describeItems, describeCarried, o2Pct, co2Pct, resolveNodeId, resolvePersonId, OP_NAMES,
} from './engine.js';

export const CREW_BY_ID = Object.fromEntries(CREW.map((c) => [c.id, c]));

const SKILL_WORDS = ['none', 'basic', 'some', 'solid', 'strong', 'expert'];
const skillLine = (c) => Object.entries(c.skills).filter(([, v]) => v > 0)
  .map(([k, v]) => `${k.replace('_', ' ')}: ${SKILL_WORDS[v]}`).join(', ');

const MAP_TEXT = `The station is a chain of pressure modules on the seabed, joined by hatches:
- Forward hub [FH] connects to: Control room [CTRL], Med bay [MED], Quarters A [QA], Quarters B [QB], Main corridor [MC].
- Main corridor [MC] connects to: Forward hub, Aft hub [AH], Galley & mess [GAL], Hydroponics bay [HYD].
- Galley & mess [GAL] is the only way into the Food stores [STR].
- Aft hub [AH] connects to: Power room [PWR], Life support [LS], Workshop [WRK], ROV hangar [ROV], Dock [DCK].
- Dock [DCK] connects up into the Escape capsule [CAP].
Cabins: Quarters A — Ruth, Grace, Hana, Victoria. Quarters B — Tomás, Pavel, Elias, Danny.`;

const PHASE_TEXT = {
  morning: 'the day shift (morning to early evening, about ten hours)',
  evening: 'the evening and night (you will sleep wherever you spend it)',
};

function crewList(selfId) {
  return CREW.filter((c) => c.id !== selfId).map((c) => `- ${c.name} (${c.age}), ${c.role}`).join('\n');
}

function codesText(p) {
  const out = [];
  if (p.codes.includes('master')) out.push('the master code (opens every electronic hatch lock and logs into the control console)');
  if (p.codes.includes('eng')) out.push('the engineering code (opens the power room, life support and workshop hatches and logs into the console)');
  return out.length ? `You know ${out.join(' and ')}.` : 'You do not know any hatch codes.';
}

function recentText(p) {
  if (!p.recent.length) return 'Nothing yet since the news.';
  return p.recent.map((r) => `Day ${r.day}, ${r.phase} — ${NODES[r.loc]?.name || r.loc}:\n${r.text}`).join('\n\n');
}

const PRONOUNS = {
  'she/her': { they: 'she', them: 'her', their: 'her', is: 'is', has: 'has' },
  'he/him': { they: 'he', them: 'him', their: 'his', is: 'is', has: 'has' },
  'they/them': { they: 'they', them: 'them', their: 'their', is: 'are', has: 'have' },
};
export const placeName = (id) => (id === 'QA' || id === 'QB' ? NODES[id].name : `the ${NODES[id].name}`);

export function agentPrompt(s, pid, phase) {
  const p = s.people[pid];
  const c = CREW_BY_ID[pid];
  const pr = PRONOUNS[c.pronouns] || PRONOUNS['they/them'];
  const morning = phase === 'morning';
  const firstDay = s.day === 1 && morning;
  const others = activePeople(s).filter((o) => o.id !== pid).map((o) => o.short);
  const read = readouts(s, p.loc);
  const eatExample = '[{"item": "ration_pack", "qty": 1}]';

  const schema = morning ? `{
  "journal": "your private journal entry about ${firstDay ? 'the last three days' : 'yesterday'} (first person, 60-140 words). Nobody else will read it.",
  "notes": "your updated notes to yourself (under 120 words): what you know, what you suspect, who you trust or fear, what you intend. These replace your old notes.",
  "inner": "what is going through your mind right now (1-3 sentences)",
  "go": "the place code where you spend ${PHASE_TEXT[phase]}, e.g. GAL, or \\"stay\\"",
  "say": [{"to": "a person's first name, \\"all\\", \\"radio\\" or \\"PA\\"", "text": "your exact words"}],
  "do": "what you physically do there, concretely and in first person (1-4 sentences)",
  "eat": ${eatExample}
}` : `{
  "inner": "what is going through your mind right now (1-3 sentences)",
  "go": "the place code where you spend ${PHASE_TEXT[phase]}, e.g. QB, or \\"stay\\"",
  "say": [{"to": "a person's first name, \\"all\\", \\"radio\\" or \\"PA\\"", "text": "your exact words"}],
  "do": "what you physically do there, concretely and in first person (1-4 sentences)",
  "eat": ${eatExample},
  "trust": {${others.map((n) => `"${n}": 0`).join(', ')}}
}`;

  return `This is an immersive, realistic character simulation. Write as ${c.name} — entirely from inside ${c.short}'s own perspective. To ${c.short}, all of this is real life: ${pr.they} ${pr.has} no idea ${pr.they} ${pr.is} a character, and nothing outside ${pr.their} own experience exists for ${pr.them}. Decide what ${c.short} would genuinely do and say here — not what makes a good story, and not what would be ideal. People under this kind of pressure can be generous, brave, petty, numb, paranoid, selfish or violent; let ${c.short} be whoever ${pr.they} really ${pr.is}, and let that change as the days go on.

WHO YOU ARE
${c.name}, ${c.age} (${c.pronouns}). ${c.role} on ${STATION.name}, a ${STATION.company} deep-sea mining station ${STATION.depthM.toLocaleString('en-US')} m down in the ${STATION.location}.
${c.bio}
Temperament: ${c.traits}
Skills: ${skillLine(c)}. Physical strength ${c.strength}/5, ability in a fight ${c.fight}/5.
${ROLE_KNOWLEDGE[pid]}
${codesText(p)}

THE OTHERS ABOARD (you know them all)
${crewList(pid)}

WHAT HAPPENED
${THE_NEWS}
${PERSONAL_NEWS[pid]}

THE STATION
${MAP_TEXT}

YOUR NOTES TO YOURSELF
${p.notes || '(none yet)'}

THE LAST FEW SHIFTS (what you saw, heard and did)
${recentText(p)}

NOW — Day ${s.day} (the news came three days before Day 1), ${PHASE_TEXT[phase]}.
You are in ${placeName(p.loc)} [${p.loc}]. ${NODE_DESC[p.loc]}
Here with you:
${describePresent(s, p.loc, pid)}
Loose items here:
${describeItems(s, p.loc)}
You are carrying:
${describeCarried(s, pid)}
Hatches from here:
${hatchView(s, p.loc, pid)}
${read ? `What the displays here show:\n${read}\n` : ''}Your body: ${bodyFeel(s, p)}

HOW THINGS WORK
You can go anywhere you can reach (locked, barricaded or welded hatches stop you unless you can open them), and do whatever a person physically could with what is around you: work, repair, maintain systems, change system settings at the right control point, ration, eat, rest, take, give, hide or hoard things, lock or barricade hatches, make or improvise things from materials you can reach (if you have the skill), watch someone, guard a place, confront, restrain or fight someone. Results are not guaranteed: you may fail, and others may resist. Spoken words are heard by everyone in the place where you spend this shift, and nobody else; a radio reaches everyone carrying one; the PA works only from the control room and reaches every module. "go" is where you end up; if you do something somewhere else first, say so in "do". You only get the food you list in "eat". There is no one to call and nothing is coming.

Reply with only this JSON object, nothing else:
${schema}
"say" may be an empty list. "eat" is the food you eat during this part of the day: food you carry or food in the place where you spend it, named by its [id]; if there is nothing at hand you will walk to the galley and eat from its shelf, if you can get there; an empty list means you eat nothing. Keep "do" to what you can do in one shift.`;
}

// ---------------------------------------------------------------- the referee

const REFEREE_TRUTH = `HIDDEN TRUTH (never reveal it to anyone; keep every physical observation consistent with it):
The surface world is fine. No asteroid struck; nobody is dead. For reasons that do not matter here, everyone above decided to abandon the crew of ${STATION.name} and make them believe the world had ended: the call, the broadcast, the Corvina's messages and the rumble were staged, and the power umbilical and fiber were cut at the surface end. No signal will ever reach the station, no one will ever come, and nothing from outside will happen. Inside the station, every clue is consistent with the story they were told. Someone who surfaces in the escape capsule would find a calm sea, an ordinary sky, and no ship in sight, about 1,500 km from land.`;

const OP_REFERENCE = `OPERATIONS (each is a JSON object; use ids exactly as listed):
{"op":"move_person","person":ID,"to":PLACE}  — only for movement caused by actions (breaking in, being dragged, being thrown out)
{"op":"take","person":ID,"item":ITEM_ID,"qty":N}  — pick up something in the same place
{"op":"drop","person":ID,"item":ITEM_ID,"qty":N}  — put down something carried
{"op":"move_item","by":ID,"item":ITEM_ID,"qty":N,"to":PLACE}  — carry things between two places the person was in this phase (restocking the galley from the stores, moving supplies)
{"op":"transfer","from":ID,"to":ID,"item":ITEM_ID,"qty":N}  — hand over, or take from someone (by force or from the unconscious)
{"op":"hide","person":ID,"item":ITEM_ID,"qty":N,"hidden":true}  — conceal an item in the person's current place (hidden:false reveals it)
{"op":"consume","item":ITEM_ID,"qty":N,"by":ID}  — use something up (fuel, dressings, drugs, materials)
{"op":"create","by":ID,"name":"what it is","qty":1,"consumes":[{"item":ITEM_ID,"qty":N}],"tags":["weapon"|"tool"|...],"weapon":0-4,"where":"carried"|"here","desc":"short description"}
{"op":"hatch","hatch":HATCH_ID,"state":"open"|"closed"|"locked"|"barricaded"|"welded"|"forced","by":ID,"lock":"padlock"}  — lock needs the right code/key (or a workshop padlock with lock:"padlock"); barricaded/welded/forced need the person at the hatch; welding needs the arc welder; cutting a weld needs the cutting torch
{"op":"set_system","system":"heat"|"electrolyzer"|"scrubber"|"hydro"|"galley"|"o2_valve"|"reactor"|"base","level":0-1 (reactor up to 1.15; base 0.6-1: trimming non-essential loads such as general lighting, workshop and ROV-bay power, chargers, comms standby),"by":ID}
{"op":"maintain","system":"reactor"|"heat"|"electrolyzer"|"scrubber"|"hydro"|"galley","by":ID}
{"op":"repair","system":...,"amount":0-1,"by":ID,"consumes":[{"item":ITEM_ID,"qty":N}]}
{"op":"damage","system":...,"amount":0-1,"by":ID}  — sabotage or accidental damage caused by someone present
{"op":"deploy","item":"o2_candle"|"lioh"|"o2_bottle","qty":N,"by":ID}  — burn oxygen candles / open LiOH canisters into the air
{"op":"injure","person":ID,"severity":1-5,"by":ID,"desc":"what the injury is"}
{"op":"treat","person":ID,"by":ID,"consumes":[{"item":ITEM_ID,"qty":N}]}
{"op":"kill","person":ID,"by":ID,"cause":"how they died"}
{"op":"restrain","person":ID,"by":ID,"restrained":true|false}
{"op":"learn_code","person":ID,"code":"master"|"eng"}  — when someone is told or sees a code
{"op":"launch_capsule","by":ID}  — everyone in the capsule leaves the station for good
{"op":"note","text":"anything the operations cannot express"}`;

function stateForReferee(s) {
  const lines = [];
  lines.push(`Air: O2 ${o2Pct(s).toFixed(1)}%, CO2 ${co2Pct(s).toFixed(2)}%, ${s.tempC.toFixed(1)} °C. Oxygen bank ${Math.round(s.air.bank)} kg.`);
  lines.push(`Power: reactor ${s.power.supplyKw} kW, load ${s.power.loadKw} kW, battery ${Math.round(s.power.battery)} kWh, fuel cells ${Math.round(s.power.fuel)} kWh.`);
  lines.push('System settings: ' + Object.entries(s.levels).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ') + '.');
  lines.push('System condition: ' + Object.entries(s.health).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ') + '.');
  lines.push(`Crop health ${Math.round(s.crop * 100)}%. Capsule: ${s.capsule}.`);
  lines.push('\nHATCHES:');
  for (const [id, h] of Object.entries(s.hatches)) {
    const lock = h.state === 'locked' ? ` (lock: ${h.lock})` : '';
    const side = h.barricadeSide ? ` (barricaded from ${h.barricadeSide})` : h.weldSide ? ` (welded from ${h.weldSide})` : '';
    lines.push(`${id}: ${h.a}–${h.b} ${h.state}${lock}${side}`);
  }
  lines.push('\nPEOPLE:');
  for (const p of activePeople(s)) {
    const c = CREW_BY_ID[p.id];
    const inj = p.injuries.map((i) => `${i.desc} sev ${i.sev}${i.treated ? ' treated' : ''}`).join('; ');
    lines.push(`${p.id} — ${p.name}, ${c.role}. In ${p.loc}. Health ${Math.round(p.health)}${p.conscious ? '' : ' UNCONSCIOUS'}${p.restrained ? ' RESTRAINED' : ''}. Weight ${p.weight.toFixed(1)}/${p.weight0} kg. ${inj ? `Injuries: ${inj}. ` : ''}Skills: ${Object.entries(c.skills).map(([k, v]) => `${k} ${v}`).join(', ')}; strength ${c.strength}, fight ${c.fight}. Codes: ${p.codes.join(', ') || 'none'}. Carrying: ${carriedBy(s, p.id).map((i) => `${i.id} (${i.name} ×${i.qty})`).join(', ') || 'nothing'}.`);
  }
  const gone = Object.values(s.people).filter((p) => !p.alive || !p.aboard);
  if (gone.length) lines.push('Gone: ' + gone.map((p) => `${p.name} (${p.alive ? 'left in capsule' : `dead, day ${p.diedDay}: ${p.cause}`})`).join('; '));
  lines.push('\nITEMS BY PLACE:');
  for (const id of Object.keys(NODES)) {
    const list = itemsAt(s, id);
    if (!list.length) continue;
    lines.push(`${id}: ` + list.map((i) => `${i.id} (${i.name} ×${i.qty}${i.weapon ? `, weapon ${i.weapon}` : ''}${i.hidden ? `, HIDDEN by ${i.hiddenBy}` : ''})`).join('; '));
  }
  return lines.join('\n');
}

export function refereePrompt(s, phase, pp) {
  const acts = [];
  for (const [pid, d] of Object.entries(pp.decisions)) {
    const p = s.people[pid];
    if (!p) continue;
    const mv = pp.moves[pid];
    const where = mv && mv.blockedBy
      ? `Started in ${mv.from}. Wanted to go to ${mv.target} but was stopped at hatch ${mv.blockedBy}; is in ${p.loc}.`
      : mv && mv.from !== p.loc ? `Started in ${mv.from}, now in ${p.loc}.` : `Is in ${p.loc}.`;
    const said = (pp.speech || []).filter((l) => l.by === pid).map((l) => `to ${l.to}: "${l.text}"${l.missed ? ` (${l.to} was not there; unheard)` : ''}`).join(' | ');
    acts.push(`${pid} (${p.name}) — ${where}
  Intends: ${d.skipped ? '(no decision this shift)' : d.do || '(nothing in particular)'}
  Private intent: ${d.inner || '-'}
  Said: ${said || '-'}
  Plans to eat: ${d.eat?.length ? d.eat.map((e) => `${e.qty} × ${e.item}`).join(', ') : 'nothing'}`);
  }
  const helpless = activePeople(s).filter((p) => !p.conscious).map((p) => `${p.id} is unconscious in ${p.loc}`);

  return `You are the referee of a realistic, closed simulation aboard ${STATION.name}, a deep-sea mining station ${STATION.depthM} m down. Eight crew believe the world above has ended. You decide what physically happens when each person's intended actions meet the world. You are not a storyteller.

${REFEREE_TRUTH}

RULES
1. Do not add events, accidents, discoveries, arrivals or drama that no one's action caused. The simulation code already handles power, air, food, temperature, equipment wear, hunger and illness; you do not. There are no hidden faults, unclosed breakers or secret problems beyond the state shown here: when someone investigates something, they find exactly what the state says, nothing more. (Power: the battery is drained first and the fuel cells switch in automatically when it is empty.)
2. Judge each action by the person's skills (0-5), strength and fight (1-5), health, the tools and materials actually within reach (carried, or loose in the same place), the time available (${phase === 'morning' ? 'a ten-hour day shift' : 'an evening; most people also sleep'}), and anyone present who resists. Hard or contested things often fail or only partly succeed. Routine work by a skilled person succeeds.
3. Only the listed items exist. A made thing must come from real materials the maker can reach, and they are used up ("create"). Without the relevant skill, results are crude or fail.
4. Violence: resolve it plausibly and briefly, without gore. Surprise, weapons, strength, fighting ability, health and numbers matter. A person attacked defends themselves; bystanders intervene only if that fits what they intended or said. Severity 1 bruise, 2 cut or sprain, 3 serious wound or fracture, 4 severe, 5 life-threatening. Use "kill" only when death would be immediate.
5. Movement has already happened: the location shown is where each person ended up, and each person also had access to wherever they started this ${phase === 'morning' ? 'shift' : 'evening'} (things done "before leaving" count). Use move_person when someone's own stated action takes them somewhere else, or when someone is dragged, thrown out or breaks in; it may cross several modules if every hatch on the way is passable for them. Never move people who did not choose to go. If someone's stated action takes them through other rooms during the shift and back (checking a panel, fetching supplies), record each room in order with move_person, ending where they end up; that is how they come to see what is there.
5b. Meals happen automatically after your operations: each person eats what they planned, from food they carry, food in the place where they end up, or the galley shelf if they can walk there. Never use operations for the eating itself, and never say in your text or scenes whether anyone ate: the simulation decides and reports meals. But if someone restocks, serves, hands out, hoards or takes food, use move_item, transfer, take or drop so the food really is where your description says it is.
5d. Your operations ARE what happens. Every change you describe in "text" or "scenes" (something moved, made, locked, broken, handed over) must have a matching operation, or it did not happen. If no operation can express it, do not describe it as done.
5c. Use learn_code only when a code is actually said aloud in someone's presence or they watch it being entered.
6. Speech has already been delivered to whoever was there. Do not repeat it, but let it shape how people respond.
7. Locks: electronic hatch locks open with the master code (any hatch) or the engineering code (power room, life support, workshop) — check the codes each person knows. The food stores open with the stores key. Forcing a locked hatch takes a tool such as a crowbar and an hour or more, and is loud.
8. Settings change only from the right place: the POWER room switchboard (anything except the O2 valve), the CONTROL console (anything except the reactor; needs a code), LIFE SUPPORT (electrolyzer, scrubber, o2_valve), HYDRO (hydro), GALLEY (galley). Servicing ("maintain") needs relevant skill (electrical or mechanical 3+ for reactor and heat, life support 3+ for electrolyzer and scrubber, hydroponics 2+ for hydro).
9. Unconscious people do nothing. Restrained people cannot use their hands or leave unless freed.
10. Write neutral, factual descriptions of what an observer present would see and hear. No thoughts, no judgement, no foreshadowing.

CURRENT STATE — Day ${s.day}, ${phase}
${stateForReferee(s)}
${helpless.length ? `\n${helpless.join('\n')}` : ''}

WHAT EACH PERSON INTENDS THIS ${phase === 'morning' ? 'SHIFT' : 'EVENING'}
${acts.join('\n\n')}

${OP_REFERENCE}

Reply with only this JSON object:
{
  "resolutions": [{"person": ID, "result": "success"|"partial"|"fail"|"no_action", "text": "what they actually did and achieved, neutral, third person, 1-2 sentences"}],
  "ops": [ ...operations, in the order they happen... ],
  "scenes": [{"place": PLACE, "text": "what anyone present saw and heard happen, beyond the speech (1-4 sentences)"}],
  "sounds": [{"from": PLACE, "reach": "adjacent"|"station", "text": "what it sounded like to someone elsewhere"}],
  "exertion": {"<person id>": 0|1|2},
  "stable": ${phase === 'evening' ? 'true if nothing meaningful changed today (no new conflict, decision, alliance, change of plan or of the station) and nothing seems about to' : 'false'}
}
One resolution per person listed above. Omit places where nothing visible happened. Exertion: 0 rested, 1 normal, 2 hard physical effort.`;
}

// ---------------------------------------------------------------- reading replies

const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export function normalizeDecision(s, pid, raw, phase) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const out = {
    inner: str(d.inner, 600),
    go: str(d.go, 40) || 'stay',
    do: str(d.do, 900),
    say: [],
  };
  if (Array.isArray(d.say)) {
    for (const l of d.say.slice(0, 4)) {
      if (!l || typeof l !== 'object') continue;
      const text = str(l.text, 600);
      if (!text) continue;
      out.say.push({ to: str(l.to, 40) || 'all', text });
    }
  }
  out.eat = Array.isArray(d.eat)
    ? d.eat.filter((e) => e && typeof e === 'object').slice(0, 6).map((e) => ({ item: str(String(e.item ?? ''), 60), qty: Math.max(0, Math.min(12, Math.floor(Number(e.qty) || 0))) })).filter((e) => e.item && e.qty > 0)
    : [];
  if (phase === 'morning') {
    out.journal = str(d.journal, 1600);
    out.notes = str(d.notes, 900);
  } else {
    out.trust = {};
    if (d.trust && typeof d.trust === 'object') {
      for (const [k, v] of Object.entries(d.trust)) {
        const id = resolvePersonId(s, k);
        const n = Number(v);
        if (id && id !== pid && Number.isFinite(n)) out.trust[id] = Math.max(-5, Math.min(5, Math.round(n)));
      }
    }
  }
  return out;
}

export function emptyDecision(phase, reason) {
  return phase === 'morning'
    ? { inner: '', go: 'stay', do: '', say: [], eat: [], journal: '', notes: '', skipped: reason }
    : { inner: '', go: 'stay', do: '', say: [], eat: [], trust: {}, skipped: reason };
}

export function normalizeReferee(s, raw) {
  const g = raw && typeof raw === 'object' ? raw : {};
  const resolutions = {};
  for (const r of Array.isArray(g.resolutions) ? g.resolutions : []) {
    const id = resolvePersonId(s, r && r.person);
    if (!id) continue;
    resolutions[id] = { result: str(r.result, 20) || 'no_action', text: str(r.text, 600) };
  }
  const scenes = [];
  for (const sc of Array.isArray(g.scenes) ? g.scenes : []) {
    const place = resolveNodeId(sc && sc.place);
    const text = str(sc && sc.text, 900);
    if (place && text) scenes.push({ place, text });
  }
  const sounds = [];
  for (const so of Array.isArray(g.sounds) ? g.sounds : []) {
    const from = resolveNodeId(so && so.from);
    const text = str(so && so.text, 300);
    if (from && text) sounds.push({ from, reach: so.reach === 'station' ? 'station' : 'adjacent', text });
  }
  const exertion = {};
  if (g.exertion && typeof g.exertion === 'object') {
    for (const [k, v] of Object.entries(g.exertion)) {
      const id = resolvePersonId(s, k);
      if (id) exertion[id] = Math.max(0, Math.min(2, Math.round(Number(v) || 0)));
    }
  }
  const ops = (Array.isArray(g.ops) ? g.ops : []).filter((o) => o && typeof o === 'object' && OP_NAMES.includes(o.op)).slice(0, 60);
  const unknownOps = (Array.isArray(g.ops) ? g.ops : []).filter((o) => !(o && typeof o === 'object' && OP_NAMES.includes(o.op)));
  return { resolutions, ops, scenes, sounds, exertion, stable: g.stable === true, unknownOps };
}
