# Paradise: Nereid Station

An observation experiment. Eight people on a deep-sea mining station, 4,210 m down in the Pacific, have been told that an asteroid ended the world above and that they may be the last humans alive. It isn't true. The world is fine; the people above abandoned them and staged the ending. Nobody is coming.

Each crew member is Claude playing that person, who believes they are human and knows only what they have seen and been told. A separate referee decides what actually happens when their choices meet the world. You watch.

## How it works

- **A day** has a day shift and an evening. In each, every conscious crew member decides where to go, what to say, and what to do. Morning turns also write a private journal entry and notes to self; evening turns choose what to eat and rate how much they trust each of the others.
- **Information is local.** Speech is heard only in the same module, unless someone uses a handheld radio or the PA in the control room. Displays with real numbers exist only in the control room, power room, life support and hydroponics bay. Everything else a person knows comes from their own memory of the last few shifts.
- **The referee** (also Claude) sees the true state and resolves every action by skill, strength, health, tools and materials at hand, time, and anyone resisting. It proposes changes as structured operations, and the engine rejects anything impossible, such as using an item that isn't there, walking through a locked hatch without the code, or changing the reactor from the control room. No outside events ever happen.
- **The engine** (`js/engine.js`) runs the physics in code:
  - power: an 8 kW reactor, not enough to run everything, plus batteries and fuel cells, with load shedding when they run out
  - air: oxygen and CO2 held to a setpoint by the electrolyzer and scrubber, plus oxygen candles, LiOH canisters and the O2 bank
  - temperature: all electrical power ends up as heat
  - hydroponic crop growth, food spoilage, hunger and weight loss, injuries, equipment wear, deaths and bodies
- **Everything is physical.** Every item aboard has a location. Weapons, barricades and tools must be found or made from real materials (`create` consumes them). Hatches can be locked with codes or keys, padlocked, barricaded, welded, or forced. There are no guns.
- **A run ends** when nobody is left aboard, or after 14 consecutive days in which nothing meaningful changes.

With every system tuned, the reactor can keep roughly five or six people alive indefinitely. The stores buy about six to nine weeks for all eight.

## Running it

The page is built to run as a claude.ai artifact. It calls Claude through the artifact `sample` capability, which uses the viewer's own Claude plan, and saves runs to the artifact's private per-user database. Press **Play day** to run one day, which takes about 18 Claude calls and a few minutes. Use **Runs** to start fresh runs with the same crew and compare them.

Opened anywhere else, the page shows the station in 3D but cannot run the crew.

## Code

| File | What it is |
|---|---|
| `index.html` | Page shell and styles |
| `js/data.js` | The station, items, crew, and what they were told |
| `js/engine.js` | World rules, physics, and validation of the referee's operations |
| `js/prompts.js` | Crew and referee prompts, and reply normalisation |
| `js/runner.js` | Plays one phase; resumable after pauses |
| `js/ai.js` | Claude via the artifact `sample` capability |
| `js/store.js` | Saving runs (artifact database, or browser storage) |
| `js/scene.js` | Low-poly three.js view of the station |
| `js/ui.js`, `js/main.js` | Panels and wiring |

Tests use Node's built-in runner and a rule-based stand-in for Claude:

```
npm test
```
