# STILLWILD: notes for Claude Code

A browser open-world survival adventure in TypeScript, Three.js r186 and
Vite. Everything is procedural: no downloaded assets, no API keys.

- **Start here:** `HANDOFF.md` is the whole project in one file (what is
  built, architecture, every file, tests, rules, next steps). `README.md`
  has the game plan, where we are and what is next.
- **Branch:** `claude/clever-hawking-4d1prc`. Commit with clear messages
  and push when a piece of work is done. No pull requests unless the owner
  asks.
- **Never touch `client-finder-run/`** (an unrelated workspace).

## Commands

```sh
npm install
npm run dev          # http://127.0.0.1:5188 (strict port)
npm run typecheck    # must be clean before committing
npm test             # vitest unit tests in tests/unit
node scripts/playtest-<name>.mjs   # browser playtests; dev server running
node scripts/playtest-all.mjs      # the whole suite, two at a time
npm run build && npm run preview   # production build on :4188
```

## Rules

- Seeded randomness only (`src/core/rng.ts`); no `Math.random` in gameplay
  or world generation.
- Bump `GEN_VERSION` in `src/world/WorldConfig.ts` whenever world
  generation output changes (layout, pads, trails, noise).
- New materials go through `lighting.setupMaterial()`; additive effects go
  on `LAYER_TRANSPARENT`.
- Persistent state goes in a save participant or a story flag
  (`quests.setFlag`).
- Systems take hook interfaces from `src/game/Game.ts` rather than reaching
  into the game.
- Set pieces are solid (`src/world/SolidField.ts`, fed by `Landmarks` and
  the story's set pieces). Anything that moves must carry
  `userData.moving`; after changing a set piece, run
  `playtest-landmarks.mjs` so no cache ends up walled in.
- Match the surrounding code's comment density, naming and idiom.
- Update `README.md`, `docs/PROGRESS.md` and `HANDOFF.md` when features
  land.
- Verify before committing: typecheck, unit tests, and the playtest that
  covers the change.

## Playtest gotchas

- Vite reloads the page when an imported `src` file changes, which breaks a
  running playtest. Don't edit game code while one runs.
- Each playtest launches a fresh browser profile, so the island is
  regenerated each time. Run at most two at once.
- Tests render on the GPU when there is one (`scripts/lib/browser.mjs`;
  `--gpu`, `--swiftshader`, `--profile <dir>` to keep the world cache).
  Keep profiles under `artifacts/` (the dev server's watcher ignores it).
- To edit while tests run, test a build: `npm run build`, `npm run
  preview`, then `--url http://127.0.0.1:4188`.
- Tests drive the game through `window.__THREE_GAME_TEST_HOOKS__` (end of
  `Game.ts`): `freeze(true)`, `renderFrames(n, dt)`, `teleport`, `aim`,
  `act`, `useStory`, `lookFrom` and many more.
