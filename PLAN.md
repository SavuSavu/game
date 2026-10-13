# First playable build: One Small Step

## Confirmed design
- Text-first life-themed idle/clicker/incremental game with an animated walking stickman.
- Six selectable starting reasons: create, reconnect, try something new, find a rhythm, rediscover joy, find direction.
- Walking accumulates distance and generates energy. Clicking gives a temporary speed boost, never permanent base speed.
- Energy/second buffs and ordinary upgrades provide idle energy.
- Activities: Learn, Create, Rest, Help someone, Reflect, Play. Rewards include Experience, Insight, Connection, Joy. Rest has a net benefit.
- Milestones unlock decision mini-games and story progress. Choices are trade-offs rather than moral scores.
- Prestige at milestone resets every run resource and ordinary upgrade, preserving character identity/story history, unspent Perspective, and permanent Perspective upgrades. Permanent upgrades have increasing costs.
- Single-player journey with shared timed world events and cooperative contribution goals.
- No missed-day penalties, guilt streaks, compulsory productivity, or medical-treatment claims.

## Architecture and scope
1. Pure deterministic game engine and tests: tick, boost, activities, purchases, milestones, decisions, prestige, save validation, offline catch-up.
2. Accessible responsive browser UI: six-reason onboarding, walking scene, dashboard, actions, story, upgrades, prestige, save export/import, settings.
3. Static hosting: relative assets, no build required; localStorage saves with versioned validation and backup export.
4. Real shared timed events calculated from UTC and identical for everyone. No invented global contribution counts.
5. Invite-based co-op prototype only if transport can be exercised: direct WebRTC with manual signaling; otherwise clearly marked unfinished, not simulated multiplayer. Durable global goals require a future backend.
6. Automated engine and browser regression tests; local HTTP testing; push main; verify exact public assets and public first-time-user path, mobile layout and console.

## First-play pacing
Early activities should be reachable in seconds, an ordinary upgrade within a minute, decisions within a few minutes, first prestige within an approximately 10–20 minute active session. Numbers are provisional playtest tuning, not a claim of final balance.

## Acceptance gates
- All six beginnings playable; brief boosts expire; rest and play useful.
- Invalid/insufficient purchases cannot mutate state; costs increase.
- Decision choices and chapter changes actually update state.
- Prestige resets all run mechanics, preserves permanent upgrades/points/story identity.
- Reload and offline gains work; invalid imports cannot corrupt a valid save.
- Visible controls verified, desktop/mobile responsive, no uncaught console errors.
- Exact deployed assets verified against committed source. Shared limitations documented honestly.
