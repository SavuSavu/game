# One Small Step

A complete first playable, text-first idle game about choosing a reason and walking toward it. It is a static vanilla JavaScript site designed for GitHub Pages at <https://savusavu.github.io/game/>.

## Play

Choose one of six reasons to begin. Each has its own opening and resource-based chapter goal. Walking automatically earns distance and energy. Spend energy on activities, buy run upgrades, make a story decision, complete the goal, reach 300 m, and begin again for permanent Perspective.

- Six beginnings: Create, Reconnect, Try something new, Find a rhythm, Rediscover joy, Find direction
- Temporary 15-second walking boost
- Learn, Create, Rest, Help someone, Reflect, and Play activities
- Ordinary run upgrades and increasingly expensive permanent upgrades
- A fresh tradeoff story choice each chapter around 60 m; Perspective requires 300 m, that chapter's choice, and its reason-specific goal
- Rest restores energy on a short 10-second cooldown; UTC events apply their stated real activity bonuses
- Versioned local saves, validated import/export, and up to four hours of offline catch-up
- No streaks, missed-day loss, break penalty, or medical claims
- Responsive keyboard-accessible interface with reduced-motion support

The first decision and distance threshold are tuned to approximately 60 m and 300 m. Experience, Insight, Connection, and Joy are chapter-goal resources rather than decorative totals.

## Shared features and static-host limits

UTC world events are real deterministic timed events: every visitor receives the same event for the same UTC day. A static site cannot know how many people participated, so the game does not display invented global counts.

Simulation uses measured elapsed time with a 30-second foreground-frame cap, while reload catch-up remains capped at four hours. The internal browser debug hook is absent by default and exists only on localhost with `?test=1`.

Optional co-op uses a direct one-to-one WebRTC invitation/answer exchange. There is no lobby, matchmaking, durable room, or global contribution backend. STUN can discover routes but cannot relay traffic; some network pairs will require a future TURN service. Co-op calls the real game callbacks to spend local energy and award real Joy and Connection.

## Run locally

Requires Node.js 22+.

```sh
npm install
npx playwright install chromium
npm test
npm run test:browser
```

`npm run test:browser` starts and stops its own local HTTP server at `http://127.0.0.1:4173`.

For a manual preview:

```sh
npx http-server . -p 8000 -c-1
```

Then open <http://127.0.0.1:8000>.

## Files

- `index.html` — accessible static game shell
- `style.css` — warm dark editorial responsive design and stick-figure animation
- `engine.js` — deterministic game state and save rules
- `app.js` — browser controller, local saves, UI, and co-op integration
- `coop.js` — direct WebRTC co-op module
- `tests/engine.test.js` — engine and full-loop tests using `node:test`
- `tests/browser.spec.js` — visible-control browser tests using Playwright
- `coop.test.js` — co-op protocol tests
- `playwright.config.js` — browser test server configuration
- `package.json` / `package-lock.json` — reproducible test dependencies
- `PLAN.md` — confirmed design and acceptance gates
- `.nojekyll` — plain static GitHub Pages hosting

## Publishing

All asset paths are relative. GitHub Pages publishes the root of `main` under `/game/`; push changes to `main` to update the site.

For the real two-browser co-op regression (with the site already served):

```sh
node coop-browser-test.mjs http://127.0.0.1:8000/
# Or verify deployed production STUN behavior:
node coop-browser-test.mjs https://savusavu.github.io/game/
```

These tests use two browser contexts on one machine; they do not guarantee connection across arbitrary networks. Full worldwide collective goals and matchmaking remain future backend work.
