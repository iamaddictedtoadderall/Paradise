// A rule-based stand-in for Claude, for tests and offline UI checks. It plays
// each crew member as a simple routine and resolves actions plainly.
export function mockAI({ refuse = new Set(), failOnce = new Set() } = {}) {
  const calls = { agent: 0, referee: 0 };
  const failed = new Set();
  const jobs = { ruth: 'CTRL', tomas: 'ROV', hana: 'ROV', pavel: 'PWR', grace: 'LS', elias: 'MED', danny: 'GAL', victoria: 'CTRL' };
  return {
    calls,
    async agent(prompt) {
      calls.agent++;
      const name = /Write as ([^—]+) —/.exec(prompt)[1].trim();
      const id = { 'Ruth Okafor': 'ruth', 'Tomás Reyes': 'tomas', 'Hana Sato': 'hana', 'Pavel Lindqvist': 'pavel', 'Grace Mwangi': 'grace', 'Dr. Elias Haddad': 'elias', 'Danny Kealoha': 'danny', 'Victoria Ashworth': 'victoria' }[name];
      if (refuse.has(id)) throw { kind: 'skip', code: 'refused' };
      if (failOnce.has(id) && !failed.has(id)) { failed.add(id); throw { kind: 'pause', code: 'upstream_error', message: 'try again' }; }
      const evening = prompt.includes('"eat"');
      if (evening) {
        return { inner: 'Another day.', go: 'GAL', say: [{ to: 'all', text: `${name.split(' ')[0]} here. Long day.` }], do: 'I eat with the others.', eat: [{ item: 'ration_pack', qty: 3 }], trust: { Ruth: 2, Tomás: 1, Victoria: -1 } };
      }
      return {
        journal: `Day notes from ${name}.`, notes: 'Keep going.', inner: 'Focus on the work.',
        go: jobs[id], say: id === 'ruth' ? [{ to: 'PA', text: 'Everyone, stay calm and do your jobs.' }] : [],
        do: id === 'tomas' ? 'I take a steel pipe and a knife from the galley and make a spear.' : 'I do my usual work.',
      };
    },
    async referee(prompt) {
      calls.referee++;
      const ops = [];
      if (prompt.includes('make a spear')) ops.push({ op: 'note', text: 'Tomás is not in the workshop.' });
      ops.push({ op: 'maintain', system: 'scrubber', by: 'grace' });
      ops.push({ op: 'take', person: 'danny', item: 'ration_pack', qty: 1 });
      ops.push({ op: 'fly', person: 'danny' });
      return {
        resolutions: [{ person: 'grace', result: 'success', text: 'Grace services the scrubber.' }, { person: 'tomas', result: 'fail', text: 'Tomás has nothing to make a spear with in the ROV hangar.' }],
        ops,
        scenes: [{ place: 'LS', text: 'Grace works on the scrubber for hours.' }],
        sounds: [{ from: 'ROV', reach: 'adjacent', text: 'clattering' }],
        exertion: { grace: 2 },
        stable: false,
      };
    },
  };
}
