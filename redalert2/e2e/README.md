# Browser qualification harness

These tests qualify the shared engine through the normal browser product
path. They are not a second gameplay implementation and they do not import a
test-only game format.

## Commands

From `redalert2/`:

```sh
# Type-check the harness without starting a browser.
bun run typecheck:e2e

# No game files required: boot and verify the legal user-content prompt.
bun run test:e2e

# Import a user-owned Red Alert 2 or Yuri's Revenge directory and run the
# playable qualification path.
RA2_E2E_ASSETS="/path/to/game" RA2_E2E_PROFILE=ra2 bun run test:e2e:assets

# Run the accelerated three-AI lifecycle soak.
RA2_E2E_ASSETS="/path/to/game" RA2_E2E_PROFILE=ra2 bun run test:soak
```

Use `RA2_E2E_PROFILE=yr` when the supplied directory is a Yuri's Revenge
installation. The fixture directory must be a folder containing the game
files the regular importer expects; it may contain subdirectories and `.mix`
archives. No game or mod archive belongs in this repository.

Install the Playwright browser once on a new development machine:

```sh
bunx playwright install chromium
```

## What is covered

- `boot.spec.ts`: engine boot and the legal user-content import prompt;
- `economy.spec.ts`: MCV deployment, power plant, refinery, harvester, and
  credits increasing after simulated gathering;
- `production.spec.ts`: barracks/infantry and war-factory/tank production;
- `combat.spec.ts`: a produced combat unit moves through the real attack order
  path and causes authoritative damage;
- `victory.spec.ts`: damage, destruction, game end, and score-screen routing;
- `soak.spec.ts`: 30,000 cumulative accelerated ticks with three AI players;
  if a match ends early, the harness starts another match and continues the
  cumulative budget. The result reports completed matches, total ticks, peak
  object count, longest single match, and final simulation hashes.

The harness keeps the browser-facing seams narrow. Folder import still goes
through `GameResBoxApi` and `GameResImporter`; accelerated ticks still go
through the real `GameTurnManager`; production and combat use the normal
`ActionsApi`. The only test-server addition is a read-only manifest/file
adapter for a user-selected fixture directory.

On failure, the fixture attaches `engine-diagnostics.json` containing the
profile, map, seed inputs, tick, simulation fingerprint, object IDs and
positions, player summaries, request failures, console/page errors, and the
last actions issued by the test.
