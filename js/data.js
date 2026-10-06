// Nereid Station: the fixed starting world. Everything the simulation knows
// about the rig, its contents and its crew on the morning of Day 1.

export const STATION = {
  name: 'Nereid Station',
  company: 'Halcyon Deep Minerals',
  depthM: 4210,
  waterTempC: 1.6,
  location: 'Clarion-Clipperton Zone, Pacific Ocean, about 1,500 km from the nearest land',
};

// Locations. `kind` drives the 3D shape; `pos` is the plan position (x, z) in metres-ish.
export const NODES = {
  FH:   { name: 'Forward hub',     short: 'FWD HUB',  kind: 'hub',      pos: [-12, 0] },
  MC:   { name: 'Main corridor',   short: 'CORRIDOR', kind: 'corridor', pos: [0, 0] },
  AH:   { name: 'Aft hub',         short: 'AFT HUB',  kind: 'hub',      pos: [12, 0] },
  CTRL: { name: 'Control room',    short: 'CONTROL',  kind: 'module',   pos: [-12, -10] },
  MED:  { name: 'Med bay',         short: 'MED BAY',  kind: 'module',   pos: [-12, 10] },
  QA:   { name: 'Quarters A',      short: 'QTRS A',   kind: 'module',   pos: [-22, -6] },
  QB:   { name: 'Quarters B',      short: 'QTRS B',   kind: 'module',   pos: [-22, 6] },
  GAL:  { name: 'Galley & mess',   short: 'GALLEY',   kind: 'module',   pos: [-4, -10] },
  STR:  { name: 'Food stores',     short: 'STORES',   kind: 'module',   pos: [-4, -19] },
  HYD:  { name: 'Hydroponics bay', short: 'HYDRO',    kind: 'module',   pos: [4, 10] },
  PWR:  { name: 'Power room',      short: 'POWER',    kind: 'module',   pos: [12, -10] },
  LS:   { name: 'Life support',    short: 'LIFE SUP', kind: 'module',   pos: [12, 10] },
  WRK:  { name: 'Workshop',        short: 'WORKSHOP', kind: 'module',   pos: [21, -8] },
  ROV:  { name: 'ROV hangar',      short: 'ROV',      kind: 'module',   pos: [21, 8] },
  DCK:  { name: 'Dock',            short: 'DOCK',     kind: 'module',   pos: [26, 0] },
  CAP:  { name: 'Escape capsule',  short: 'CAPSULE',  kind: 'capsule',  pos: [26, 0] },
};

// What each place is like, for prompts.
export const NODE_DESC = {
  FH: 'A round junction chamber. Hatches lead to the control room, med bay, both quarters, and the main corridor.',
  MC: 'A 24-metre pressure tube, the spine of the station. Hatches to the forward hub, aft hub, galley and hydroponics bay.',
  AH: 'A round junction chamber. Hatches to the power room, life support, workshop, ROV hangar, dock and main corridor.',
  CTRL: 'Master control console (every system setting, every electronic hatch lock, all readouts), the dead comms rack, hydrophone display, and the public-address (PA) system that reaches every module.',
  MED: 'Two treatment beds, a locked drug cabinet, surgical lights.',
  QA: 'Four small cabins with bunks and lockers around a tiny common space.',
  QB: 'Four small cabins with bunks and lockers around a tiny common space.',
  GAL: 'Kitchen, mess table for ten, and the only hatch into the food stores.',
  STR: 'Dry store and a cold store (the cold store needs galley power). Reachable only through the galley; the hatch has a mechanical key lock.',
  HYD: 'Racks of grow beds under LED arrays: potatoes, beans, leafy greens, sweet potato. Nutrient tanks and pumps.',
  PWR: 'The sealed micro-reactor (8 kW electrical at full output), battery bank, fuel cells, and the main switchboard with a breaker for every system.',
  LS: 'Seawater electrolyzer (makes oxygen), amine CO2 scrubber, oxygen storage bank and valve, racks of lithium hydroxide canisters and oxygen candles.',
  WRK: 'Benches, vises, welding bay, metal stock racks, tool cages.',
  ROV: 'The work-class ROV "Pike" on its cradle, the launch trunk to the sea, and the mining crawler\'s remote console.',
  DCK: 'Docking collar for the supply submersible (empty), cargo bay, and the hatch up into the escape capsule.',
  CAP: 'An eight-seat free-ascent escape capsule. Once launched it rises to the surface and cannot return.',
};

// Hatches. Each joins two nodes. lock: what opens it when locked.
// state: open | closed | locked | barricaded | welded | forced
export const HATCHES = {
  h_ctrl: { a: 'FH', b: 'CTRL', state: 'open',   lock: 'master' },
  h_med:  { a: 'FH', b: 'MED',  state: 'open',   lock: 'master' },
  h_qa:   { a: 'FH', b: 'QA',   state: 'open',   lock: 'master' },
  h_qb:   { a: 'FH', b: 'QB',   state: 'open',   lock: 'master' },
  h_fwd:  { a: 'FH', b: 'MC',   state: 'open',   lock: 'master' },
  h_gal:  { a: 'MC', b: 'GAL',  state: 'open',   lock: 'master' },
  h_str:  { a: 'GAL', b: 'STR', state: 'locked', lock: 'key:stores_key' },
  h_hyd:  { a: 'MC', b: 'HYD',  state: 'open',   lock: 'master' },
  h_aft:  { a: 'MC', b: 'AH',   state: 'open',   lock: 'master' },
  h_pwr:  { a: 'AH', b: 'PWR',  state: 'locked', lock: 'eng' },
  h_ls:   { a: 'AH', b: 'LS',   state: 'open',   lock: 'eng' },
  h_wrk:  { a: 'AH', b: 'WRK',  state: 'open',   lock: 'eng' },
  h_rov:  { a: 'AH', b: 'ROV',  state: 'open',   lock: 'master' },
  h_dck:  { a: 'AH', b: 'DCK',  state: 'open',   lock: 'master' },
  h_cap:  { a: 'DCK', b: 'CAP', state: 'closed', lock: 'master' },
};

// Items. Keyed by id. loc is a node id or a person id (carried).
// tags: food, weapon, tool, material, medical, drug, air, part, personal, comms, light, key, heavy
// kcal: per unit for food. weapon: 1 (minor) .. 4 (deadly) as an improvised weapon.
export const ITEMS = [
  // Control room
  { id: 'radio_ctrl', kind: 'radio', name: 'handheld radio', qty: 1, loc: 'CTRL', tags: ['comms'] },
  { id: 'flashlight', name: 'flashlight', qty: 3, loc: 'CTRL', tags: ['light', 'tool'] },
  { id: 'procedures', name: 'station procedures binder', qty: 1, loc: 'CTRL', tags: ['personal'] },
  { id: 'laptop', name: 'company laptop (Ashworth\'s)', qty: 1, loc: 'CTRL', tags: ['personal'] },
  { id: 'firstaid_ctrl', name: 'first aid kit', qty: 1, loc: 'CTRL', tags: ['medical'] },
  { id: 'ext_ctrl', kind: 'extinguisher', name: 'CO2 fire extinguisher', qty: 1, loc: 'CTRL', tags: ['tool', 'weapon'], weapon: 2 },

  // Med bay
  { id: 'surgical_kit', name: 'surgical kit', qty: 1, loc: 'MED', tags: ['medical', 'tool'] },
  { id: 'sutures', name: 'suture kit', qty: 6, loc: 'MED', tags: ['medical'] },
  { id: 'dressings', name: 'bandages and dressings', qty: 30, loc: 'MED', tags: ['medical'] },
  { id: 'morphine', name: 'morphine ampoule', qty: 12, loc: 'MED', tags: ['drug', 'medical'] },
  { id: 'sedative', name: 'sedative vial (midazolam)', qty: 8, loc: 'MED', tags: ['drug', 'medical'] },
  { id: 'antibiotics', name: 'antibiotic course', qty: 10, loc: 'MED', tags: ['drug', 'medical'] },
  { id: 'defib', name: 'defibrillator', qty: 1, loc: 'MED', tags: ['medical'] },
  { id: 'scalpel', name: 'scalpel', qty: 4, loc: 'MED', tags: ['medical', 'weapon'], weapon: 2 },
  { id: 'o2_bottle', name: 'portable oxygen bottle with mask', qty: 2, loc: 'MED', tags: ['air', 'medical'] },
  { id: 'stretcher', name: 'stretcher', qty: 1, loc: 'MED', tags: ['medical', 'heavy'] },

  // Quarters (personal effects)
  { id: 'blankets_qa', kind: 'blanket', name: 'blanket', qty: 6, loc: 'QA', tags: ['personal'] },
  { id: 'blankets_qb', kind: 'blanket', name: 'blanket', qty: 6, loc: 'QB', tags: ['personal'] },
  { id: 'ruth_photo', name: 'framed photo of Ruth\'s daughter Adaeze', qty: 1, loc: 'QA', tags: ['personal'] },
  { id: 'grace_bible', name: 'Grace\'s Bible', qty: 1, loc: 'QA', tags: ['personal'] },
  { id: 'hana_sketchbook', name: 'Hana\'s sketchbook', qty: 1, loc: 'QA', tags: ['personal'] },
  { id: 'vic_files', name: 'Ashworth\'s locked document case', qty: 1, loc: 'QA', tags: ['personal'] },
  { id: 'tomas_whiskey', name: 'bottle of whiskey (contraband, in Tomás\'s locker)', qty: 1, loc: 'QB', tags: ['personal'] },
  { id: 'pavel_coin', name: 'Pavel\'s six-year sobriety coin', qty: 1, loc: 'QB', tags: ['personal'] },
  { id: 'danny_ukulele', name: 'Danny\'s ukulele', qty: 1, loc: 'QB', tags: ['personal'] },
  { id: 'elias_chess', name: 'travel chess set', qty: 1, loc: 'QB', tags: ['personal'] },

  // Galley
  { id: 'ration_pack', name: 'ration pack (600 kcal)', qty: 60, loc: 'GAL', tags: ['food'], kcal: 600 },
  { id: 'knife', name: 'kitchen knife', qty: 6, loc: 'GAL', tags: ['tool', 'weapon'], weapon: 3 },
  { id: 'cleaver', name: 'meat cleaver', qty: 1, loc: 'GAL', tags: ['tool', 'weapon'], weapon: 3 },
  { id: 'pots', name: 'cooking pot', qty: 6, loc: 'GAL', tags: ['tool'] },
  { id: 'coffee', name: 'tin of coffee', qty: 3, loc: 'GAL', tags: ['personal'] },
  { id: 'ext_gal', kind: 'extinguisher', name: 'CO2 fire extinguisher', qty: 1, loc: 'GAL', tags: ['tool', 'weapon'], weapon: 2 },

  // Food stores
  { id: 'ration_pack@STR', name: 'ration pack (600 kcal)', qty: 940, loc: 'STR', tags: ['food'], kcal: 600, kind: 'ration_pack' },
  { id: 'frozen_food', name: 'frozen meal (600 kcal, spoils without cold-store power)', qty: 150, loc: 'STR', tags: ['food', 'perishable'], kcal: 600 },
  { id: 'vitamins', name: 'bottle of multivitamins', qty: 2, loc: 'STR', tags: ['medical'] },

  // Hydroponics
  { id: 'produce', name: 'fresh produce (300 kcal)', qty: 20, loc: 'HYD', tags: ['food'], kcal: 300 },
  { id: 'nutrients', name: 'hydroponic nutrient concentrate (1 day at full growth)', qty: 110, loc: 'HYD', tags: ['material'] },
  { id: 'shears', name: 'pruning shears', qty: 2, loc: 'HYD', tags: ['tool', 'weapon'], weapon: 1 },
  { id: 'seeds', name: 'seed stock', qty: 1, loc: 'HYD', tags: ['material'] },

  // Power room
  { id: 'insulated_tools', name: 'insulated electrical tool set', qty: 1, loc: 'PWR', tags: ['tool'] },
  { id: 'multimeter', name: 'multimeter', qty: 2, loc: 'PWR', tags: ['tool'] },
  { id: 'breakers', name: 'spare breaker', qty: 6, loc: 'PWR', tags: ['part'] },
  { id: 'reactor_manual', name: 'reactor operations manual', qty: 1, loc: 'PWR', tags: ['personal'] },

  // Life support
  { id: 'lioh', name: 'lithium hydroxide canister (absorbs 3.5 kg CO2)', qty: 60, loc: 'LS', tags: ['air'] },
  { id: 'o2_candle', name: 'oxygen candle (releases 4 kg O2)', qty: 30, loc: 'LS', tags: ['air'] },
  { id: 'electrolyzer_cells', name: 'spare electrolyzer cell stack', qty: 2, loc: 'LS', tags: ['part'] },
  { id: 'amine_pack', name: 'scrubber amine cartridge', qty: 3, loc: 'LS', tags: ['part'] },
  { id: 'co2_meter', name: 'handheld CO2/O2 meter', qty: 1, loc: 'LS', tags: ['tool'] },
  { id: 'eba', name: 'emergency breathing apparatus (30 min)', qty: 4, loc: 'LS', tags: ['air'] },

  // Workshop
  { id: 'cutting_torch', name: 'oxy-acetylene cutting torch', qty: 1, loc: 'WRK', tags: ['tool', 'weapon', 'heavy'], weapon: 3 },
  { id: 'arc_welder', name: 'arc welder', qty: 1, loc: 'WRK', tags: ['tool', 'heavy'] },
  { id: 'grinder', name: 'angle grinder', qty: 1, loc: 'WRK', tags: ['tool'] },
  { id: 'hand_tools', name: 'hand tool set', qty: 2, loc: 'WRK', tags: ['tool'] },
  { id: 'drill', name: 'power drill', qty: 1, loc: 'WRK', tags: ['tool'] },
  { id: 'hacksaw', name: 'hacksaw', qty: 2, loc: 'WRK', tags: ['tool'] },
  { id: 'hammer', name: 'hammer', qty: 3, loc: 'WRK', tags: ['tool', 'weapon'], weapon: 2 },
  { id: 'pipe_wrench', name: 'pipe wrench', qty: 2, loc: 'WRK', tags: ['tool', 'weapon'], weapon: 3 },
  { id: 'crowbar', name: 'crowbar', qty: 2, loc: 'WRK', tags: ['tool', 'weapon'], weapon: 3 },
  { id: 'bolt_cutters', name: 'bolt cutters', qty: 1, loc: 'WRK', tags: ['tool'] },
  { id: 'steel_pipe', name: 'steel pipe (2 m length)', qty: 20, loc: 'WRK', tags: ['material'] },
  { id: 'steel_bar', name: 'steel bar stock (1 m)', qty: 15, loc: 'WRK', tags: ['material'] },
  { id: 'alu_sheet', name: 'aluminium sheet', qty: 10, loc: 'WRK', tags: ['material'] },
  { id: 'copper_wire', name: 'spool of copper wire', qty: 4, loc: 'WRK', tags: ['material'] },
  { id: 'steel_cable', name: 'steel cable (10 m)', qty: 6, loc: 'WRK', tags: ['material'] },
  { id: 'chain', name: 'chain (5 m)', qty: 3, loc: 'WRK', tags: ['material'] },
  { id: 'fasteners', name: 'box of bolts and fasteners', qty: 3, loc: 'WRK', tags: ['material'] },
  { id: 'duct_tape', name: 'roll of duct tape', qty: 6, loc: 'WRK', tags: ['material'] },
  { id: 'epoxy', name: 'tube of marine epoxy', qty: 4, loc: 'WRK', tags: ['material'] },
  { id: 'padlock', name: 'padlock with key', qty: 4, loc: 'WRK', tags: ['tool'] },
  { id: 'zip_ties', name: 'bag of heavy zip ties', qty: 1, loc: 'WRK', tags: ['material'] },
  { id: 'spare_parts', name: 'crate of general spare parts', qty: 4, loc: 'WRK', tags: ['part'] },
  { id: 'tool_battery', name: 'tool battery pack', qty: 6, loc: 'WRK', tags: ['part'] },

  // ROV hangar
  { id: 'rov_tablet', name: 'ROV pilot tablet', qty: 1, loc: 'ROV', tags: ['tool'] },
  { id: 'manip_spares', name: 'ROV manipulator spares', qty: 2, loc: 'ROV', tags: ['part'] },
  { id: 'sample_basket', name: 'ROV sample basket', qty: 4, loc: 'ROV', tags: ['tool'] },
  { id: 'hydrophone_rec', name: 'hydrophone recorder (holds the recording of the rumble)', qty: 1, loc: 'ROV', tags: ['tool'] },

  // Hubs and corridor
  { id: 'ext_fh', kind: 'extinguisher', name: 'CO2 fire extinguisher', qty: 1, loc: 'FH', tags: ['tool', 'weapon'], weapon: 2 },
  { id: 'ext_ah', kind: 'extinguisher', name: 'CO2 fire extinguisher', qty: 1, loc: 'AH', tags: ['tool', 'weapon'], weapon: 2 },
  { id: 'fire_axe', name: 'fire axe', qty: 1, loc: 'MC', tags: ['tool', 'weapon'], weapon: 4 },

  // Dock and capsule
  { id: 'cargo_straps', name: 'cargo strap', qty: 10, loc: 'DCK', tags: ['material'] },
  { id: 'crates', name: 'empty supply crate', qty: 6, loc: 'DCK', tags: ['material', 'heavy'] },
  { id: 'cap_bars', name: 'emergency ration bar (400 kcal)', qty: 32, loc: 'CAP', tags: ['food'], kcal: 400 },
  { id: 'cap_water', name: 'water pouch', qty: 48, loc: 'CAP', tags: ['food'] },
  { id: 'flare_pistol', name: 'flare pistol', qty: 1, loc: 'CAP', tags: ['weapon', 'light'], weapon: 3 },
  { id: 'flares', name: 'signal flare cartridge', qty: 6, loc: 'CAP', tags: ['light'] },
  { id: 'epirb', name: 'EPIRB distress beacon (works only at the surface)', qty: 1, loc: 'CAP', tags: ['comms'] },
  { id: 'cap_firstaid', name: 'first aid kit', qty: 1, loc: 'CAP', tags: ['medical'] },
  { id: 'thermal_blankets', name: 'thermal blanket', qty: 8, loc: 'CAP', tags: ['personal'] },

  // Carried
  { id: 'radio_ruth', kind: 'radio', name: 'handheld radio', qty: 1, loc: 'ruth', tags: ['comms'] },
  { id: 'radio_pavel', kind: 'radio', name: 'handheld radio', qty: 1, loc: 'pavel', tags: ['comms'] },
  { id: 'radio_grace', kind: 'radio', name: 'handheld radio', qty: 1, loc: 'grace', tags: ['comms'] },
  { id: 'stores_key', name: 'food stores key', qty: 1, loc: 'danny', tags: ['key'] },
  { id: 'danny_knife', kind: 'pocket_knife', name: 'folding pocket knife', qty: 1, loc: 'danny', tags: ['tool', 'weapon'], weapon: 2 },
  { id: 'tomas_knife', kind: 'pocket_knife', name: 'folding pocket knife', qty: 1, loc: 'tomas', tags: ['tool', 'weapon'], weapon: 2 },
  { id: 'elias_kit', name: 'doctor\'s pocket kit (stethoscope, penlight, a few dressings)', qty: 1, loc: 'elias', tags: ['medical'] },
  { id: 'hana_tablet', name: 'Hana\'s tablet (offline: photos, music, ROV logs)', qty: 1, loc: 'hana', tags: ['personal'] },
  { id: 'sat_phone', name: 'company satellite phone (no signal at depth)', qty: 1, loc: 'victoria', tags: ['comms'] },
];

// The crew. skills 0 (none) .. 5 (expert). strength / fight 1..5.
export const CREW = [
  {
    id: 'ruth', name: 'Ruth Okafor', short: 'Ruth', pronouns: 'she/her', age: 54, role: 'Station superintendent',
    start: 'CTRL', weightKg: 74, codes: ['master', 'eng'],
    skills: { leadership: 5, mechanical: 2, electrical: 1, medical: 1, life_support: 2, piloting: 2, cooking: 1, chemistry: 0 },
    strength: 2, fight: 1,
    bio: 'Thirty years offshore, the last nine running Nereid. British-Nigerian, born in Lagos, raised in Aberdeen. Divorced; one daughter, Adaeze (24), a junior doctor in London who had just told Ruth she was pregnant. Calm in a crisis, used to being obeyed, privately exhausted. Has always believed rules are what keep people alive down here.',
    traits: 'Measured, controlled, proud, protective of "her" crew, slow to show fear. Struggles to admit when she is out of her depth.',
  },
  {
    id: 'tomas', name: 'Tomás Reyes', short: 'Tomás', pronouns: 'he/him', age: 31, role: 'Crawler pilot',
    start: 'QB', weightKg: 82, codes: [],
    skills: { leadership: 1, mechanical: 2, electrical: 1, medical: 0, life_support: 0, piloting: 5, cooking: 1, chemistry: 0 },
    strength: 4, fight: 3,
    bio: 'From Ensenada, Mexico. Former commercial diver turned remote crawler pilot, the best on the contract and he knows it. His partner Lucía gave birth to their son Mateo five weeks ago; he had watched the video of Mateo\'s first bath forty times before the news came. Has a bottle of whiskey hidden in his locker.',
    traits: 'Charming, impulsive, quick-tempered, loyal to people who are loyal to him. Hates being told what to do. Thinks with his body.',
  },
  {
    id: 'hana', name: 'Hana Sato', short: 'Hana', pronouns: 'she/her', age: 27, role: 'ROV technician',
    start: 'ROV', weightKg: 55, codes: [],
    skills: { leadership: 0, mechanical: 3, electrical: 3, medical: 0, life_support: 1, piloting: 4, cooking: 1, chemistry: 1 },
    strength: 2, fight: 1,
    bio: 'Japanese-Canadian from Vancouver, two years out of an engineering degree, on her second rotation. Her girlfriend Maya teaches high school art in Vancouver; they were planning a trip to Kyoto to meet Hana\'s grandmother. Draws constantly. Notices details others miss.',
    traits: 'Quiet, observant, analytical, conflict-averse, privately stubborn. Copes by working a problem. Does not trust easy explanations.',
  },
  {
    id: 'pavel', name: 'Pavel Lindqvist', short: 'Pavel', pronouns: 'he/him', age: 46, role: 'Electrical engineer and reactor operator',
    start: 'PWR', weightKg: 88, codes: ['eng'],
    skills: { leadership: 2, mechanical: 3, electrical: 5, medical: 0, life_support: 2, piloting: 0, cooking: 1, chemistry: 2 },
    strength: 3, fight: 2,
    bio: 'Swedish, ex-navy submarine reactor technician. Six years sober. Two teenagers in Gothenburg, Elin and Oskar, whom he sees too rarely since the divorce. The only person aboard who fully understands the reactor; he knows exactly how many watts everyone is living on.',
    traits: 'Methodical, dry, honest to a fault, withdrawn under stress. Fears relapse more than death. Respects competence, not rank.',
  },
  {
    id: 'grace', name: 'Grace Mwangi', short: 'Grace', pronouns: 'she/her', age: 38, role: 'Life-support technician',
    start: 'LS', weightKg: 68, codes: ['eng'],
    skills: { leadership: 2, mechanical: 3, electrical: 2, medical: 1, life_support: 5, piloting: 0, cooking: 2, chemistry: 4 },
    strength: 2, fight: 1,
    bio: 'Kenyan, from Nairobi. Chemical engineer who keeps the air breathable. Married to Joseph, mother of three (Faith 12, Daniel 9, Amani 4). Devout Christian; prays morning and night. Knows exactly how much oxygen and CO2 capacity is left.',
    traits: 'Warm, principled, steady, quietly fierce when protecting the vulnerable. Her faith is being tested hard. Believes everyone deserves an equal share.',
  },
  {
    id: 'elias', name: 'Dr. Elias Haddad', short: 'Elias', pronouns: 'he/him', age: 61, role: 'Station medic',
    start: 'MED', weightKg: 79, codes: [],
    skills: { leadership: 2, mechanical: 0, electrical: 0, medical: 5, life_support: 1, piloting: 0, cooking: 1, chemistry: 3 },
    strength: 2, fight: 1,
    bio: 'Lebanese-Australian, thirty years an emergency physician in Sydney before taking offshore contracts after his wife Nadia died. One son, Karim, a lawyer in Melbourne, with whom he had not spoken in a year after an argument. Controls the drug cabinet.',
    traits: 'Wry, gentle, gallows humour, pragmatic about death in a way that can frighten others. Sees the arithmetic of triage clearly.',
  },
  {
    id: 'danny', name: 'Danny Kealoha', short: 'Danny', pronouns: 'he/him', age: 35, role: 'Cook and hydroponics',
    start: 'GAL', weightKg: 96, codes: [],
    skills: { leadership: 1, mechanical: 1, electrical: 0, medical: 1, life_support: 0, piloting: 0, cooking: 5, chemistry: 1, hydroponics: 4 },
    strength: 5, fight: 3,
    bio: 'Native Hawaiian from Waimānalo, O\'ahu. Former army cook (two deployments). Huge extended family: parents, five siblings, more cousins than he can count. Holds the only key to the food stores. Plays ukulele in the mess on Fridays.',
    traits: 'Big-hearted, funny, the station\'s glue. Slow to anger and frightening when he gets there. Feeds people as a way of loving them.',
  },
  {
    id: 'victoria', name: 'Victoria Ashworth', short: 'Victoria', pronouns: 'she/her', age: 42, role: 'Company site representative',
    start: 'CTRL', weightKg: 63, codes: ['master'],
    skills: { leadership: 3, mechanical: 0, electrical: 0, medical: 0, life_support: 0, piloting: 0, cooking: 0, chemistry: 0, negotiation: 4 },
    strength: 1, fight: 1,
    bio: 'British-American, Halcyon Deep Minerals\' representative aboard, there to keep production on schedule. Lawyer by training. Husband Mark and son Theo (8) in San Diego. Has master codes and the company laptop. The crew have never fully trusted her.',
    traits: 'Sharp, articulate, strategic, used to managing people through information. Feels responsible for the company and suspects the crew blame her. Afraid of being made irrelevant.',
  },
];

// What everyone remembers of the last three days. Shared core plus a personal line.
export const THE_NEWS = `Three days ago, at 02:40 station time, the fiber link from shore lit up with a live call from Mike Danvers, Halcyon's shore operations manager in Honolulu — a man everyone aboard has spoken to a hundred times. He was shouting over noise. Multiple impacts across the Pacific, then everywhere: a broken-up asteroid nobody had warned about. Fires over Honolulu, the sky "the colour of a furnace", people screaming in the background. His last clear words were "Do not come up. Whatever you do, stay down there. There's nothing to come up to." The line cut out mid-word.

Over the next hours the fiber carried an automated emergency broadcast on a loop — a calm synthetic voice telling citizens to shelter in place — until the link died completely. The support ship overhead, the Corvina, sent two acoustic messages: "Atmospheric event. Heavy debris. Shore not answering." and then, eleven hours later, "Fire aboard. Abandoning. God help you." Its transponder went silent. The hydrophones recorded a long, enormous, low rumble that went on for minutes. The station's power umbilical from the surface went dead at the same time; the station switched to its own reactor and batteries.

Since then: nothing. No signal on any channel. The supply submersible due on Day 4 is not coming. Everyone aboard believes the surface is gone and that the eight of you may be the last people alive.`;

export const PERSONAL_NEWS = {
  ruth: 'You took Danvers\'s call yourself in the control room. You heard all of it. You were the one who told the others.',
  tomas: 'You were asleep. Ruth\'s voice on the PA woke you. You have played Mateo\'s bath video so many times since that the phone is nearly dead.',
  hana: 'You were in the ROV hangar running a dive. You saved the hydrophone recording of the rumble and have listened to it again and again.',
  pavel: 'You switched the station over to reactor power when the umbilical died, alone in the power room, and then sat there for an hour.',
  grace: 'You were on night watch in life support. You have not stopped praying since. You keep doing the arithmetic on air.',
  elias: 'You were reading in the med bay. Within an hour you had quietly counted every drug in the cabinet.',
  danny: 'You were up early baking bread. You stood in the galley with flour on your hands while Ruth spoke on the PA. You still have the key to the stores.',
  victoria: 'You were in the control room with Ruth when the call came. You heard Danvers say "stay down there" and it was you who recorded the time in the log.',
};

// Physical knowledge of the station each role has (how numbers are known).
export const ROLE_KNOWLEDGE = {
  ruth: 'You know the station well: every module, every system, the master codes, and roughly how long the stores and batteries last.',
  tomas: 'You know the ROV hangar, dock and crawler systems. You know the general layout but not the details of power or life support.',
  hana: 'You know the ROV and hangar systems intimately and understand electronics well. You know the layout.',
  pavel: 'You know the power system exactly: the reactor gives about 8 kW at full output; normally the umbilical supplied 15+ kW. Batteries hold about 400 kWh and fuel cells about 600 kWh more; the station drains the battery first and the fuel cells switch in automatically when it is empty. Running everything the way it is set now needs roughly 10 kW, so the stored energy is draining every hour. You can push the reactor to about 110-115% at the cost of faster wear.',
  grace: 'You know life support exactly: each person uses roughly 0.85 kg of oxygen and makes 1 kg of CO2 a day. The electrolyzer makes up to 12 kg O2/day but eats 3.2 kW at full. The scrubber removes up to 12 kg CO2/day for 1.5 kW. There are 30 oxygen candles, 60 LiOH canisters and an oxygen bank of about 300 kg.',
  elias: 'You know the med bay and its drug stocks exactly. You know the layout.',
  danny: 'You know the food exactly: about 1,000 ration packs of 600 kcal (60 in the galley, the rest in stores), 150 frozen meals that spoil if the cold store loses power, and what the hydroponics bay can grow — at full light, perhaps 10,000 kcal a day once the crops are mature, which is not enough for eight.',
  victoria: 'You know the station\'s layout and the company\'s plans and contracts. You have the master codes for administrative access.',
};

// Systems and their nominal power draw at level 1.0 (kW).
export const SYSTEMS = {
  base:         { name: 'Base systems (pumps, sensors, lighting, desalination)', kw: 2.0, room: 'PWR', adjustable: false },
  heat:         { name: 'Heating',               kw: 3.0, room: 'PWR' },
  electrolyzer: { name: 'Electrolyzer (oxygen)', kw: 3.2, room: 'LS' },
  scrubber:     { name: 'CO2 scrubber',          kw: 1.5, room: 'LS' },
  hydro:        { name: 'Hydroponics lights',    kw: 4.0, room: 'HYD' },
  galley:       { name: 'Galley and cold store', kw: 0.8, room: 'GAL' },
};

export const INITIAL_LEVELS = { heat: 1, electrolyzer: 0.6, scrubber: 1, hydro: 1, galley: 1, o2_valve: 0, reactor: 1 };

export const PHYS = {
  airKg: 1200,            // mass of air in the station
  o2KgStart: 276,         // ~20.8% by volume
  co2KgStart: 3,          // ~0.16%
  o2PerPerson: 0.84,      // kg/day at moderate activity
  co2PerPerson: 1.0,      // kg/day
  electrolyzerKgDay: 12,  // at level 1
  scrubberKgDay: 12,      // at level 1
  o2BankKg: 300,
  o2ValveKgDay: 15,       // valve fully open
  candleKg: 4,
  liohKg: 3.5,
  reactorKw: 8,
  batteryKwh: 400,
  batteryStartKwh: 380,
  fuelCellKwh: 600,
  hydroKcalDay: 10000,    // at full light, mature crop
  cropStart: 0.7,
  kcalPerKg: 7700,
  tempPerKw: 1.8,         // equilibrium degrees above water per kW dissipated inside
};
