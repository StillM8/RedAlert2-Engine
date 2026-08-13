# Porting Playbook — Red Alert 2 to iPhone & iPad

The complete engineering log of bringing the Chronodivide-lineage RA2 engine to
iOS: the architecture, the decisions, and every bug hunt worth remembering. Read
the [README](../README.md) first for the shape of the project.

---

## 1. The premise: no engine to compile

The Generals port compiles EA's GPL C++ engine for ARM64. That option does not
exist for RA2 — EA's Feb 2025 C&C source release pointedly excluded it. What we
have is a *reconstruction*: Chronodivide, a deterministic TypeScript sim plus a
Three.js renderer, reverse-engineered to match RA2's `rules.ini` semantics, unit
locomotors, warheads, isometric pathfinding, and lockstep determinism.

That flips the port strategy. The engine's native platform is already the web —
JS + WebGL. iOS ships an excellent web platform (WebKit, with WebGL→ANGLE→Metal
and JIT inside the app). So instead of translating a graphics API, the job is:

1. Wrap the web engine in a real native app.
2. Get the retail assets onto the device without a server.
3. Replace mouse/keyboard with touch that feels native to an RTS.
4. Fix everything that only breaks once a human is holding it.

Nothing about the sim or renderer is rewritten. That's the whole point — the
value is in the years of reconstruction, and the risk of a rewrite is
re-inheriting every subtle sim bug that was already found and fixed.

## 2. The native shell

`ios/` is an XcodeGen project (same tooling as the Generals port) producing a
single-view Swift app whose root is a `WKWebView`.

**Serving the app offline.** A `WKURLSchemeHandler` (`BundleSchemeHandler.swift`)
answers a custom `ra2app://` scheme:

- `ra2app://app/…` → the built web app (`Resources/WebDist`)
- `ra2app://app/gameres/…` → the imported game assets (`Resources/GameRes`)

Everything is memory-mapped from the code-signed bundle. No network, no
localhost server, no CORS. The web app never learns it isn't on a real origin.

**Lifecycle & feel.** Landscape-locked. Idle timer disabled (an RTS session
shouldn't dim mid-battle). `AVAudioSession` set to `.playback` so game audio
ignores the silent switch. `mediaTypesRequiringUserActionForPlayback = []` so
audio and the menu video can autoplay. The WebView is marked `isInspectable` in
debug builds so Safari's Web Inspector can attach to a running device.

## 3. Importing game assets on iOS

The engine normally imports assets in-browser: the user points it at their game
files, and it splits/transcodes MIX archives into origin-private storage (OPFS).
The normal iOS build does **not** bundle the developer's local game files. Users
must import their own game files through the normal resource-import flow.

**Optional QA bundle** (`scripts/build-ios.sh --bundle-local-gameres`): for
local simulator/device QA, the script can copy the gitignored
`gameres-export/` tree into the app bundle and generate its manifest. This is an
explicit local-only convenience and is not the normal packaging policy.

The export is produced by `scripts/prepare-gameres.ts`, an offline
re-implementation of the importer. It reads your retail MIXes directly, copies
the core archives, transcodes the music (`theme.mix` WAV → MP3 via ffmpeg),
keeps the original menu video (`ra2ts_l*.bik`) for the shared WebAssembly Bink
decoder, extracts the English string table (`ra2.csf` out of `language.mix`),
and renders the loading splash
(`glsl.shp` + `gls.pal` inside `ra2.mix` → PNG, with a from-scratch PNG encoder
so the script needs no browser).

Menu-video selection is platform-owned. Android exposes loose `.bik` files from
`/native-media/android/menu-video/` through its Kotlin WebView client, while
iOS exposes them from `Resources/GameRes` through
`/native-media/ios/menu-video/` in `BundleSchemeHandler.swift`. The shared GUI
tries that native source first and falls back to its OPFS/VFS extraction path
when a normal user import contains only `language*.mix`.

**First launch** (`src/shell/iosSeed.ts`): if the optional QA bundle is present,
the shell copies its tree into OPFS, then marks the import as complete. This is
deliberately **not** gated on a stored boolean — iOS can evict OPFS under disk
pressure while `localStorage` survives (or vice versa). The seeder verifies each
file's size against a manifest and re-copies only what's missing or stale. With
the normal build there is no bundled manifest, so seeding is skipped and the
user's own import flow remains available.

`?shell=1` forces shell mode in a desktop browser, and a Vite middleware serves
`/gameres/` from the exported tree — so the entire iOS boot path (seed included)
is testable on a laptop.

## 4. Touch controls — the Generals lessons, in a new engine

The upstream engine had a placeholder mobile scheme: an on-screen "L / R" toggle
you tapped to choose which mouse button your next tap sent. Functional, not fun.
It was replaced with a real gesture engine in the engine's own pointer layer
(`src/gui/PointerEvents.ts`), mapping touches to the mouse semantics the sim
already understands:

| Gesture | Meaning |
|---|---|
| One-finger tap | Left click (select / issue order) |
| One-finger drag | Selection box |
| Two-finger drag | Right-drag "map grab" — content tracks the fingers 1:1 |
| Pinch | Camera zoom |
| Two-finger tap | Right click (deselect) |
| Long-press | Force-attack (ctrl-click) |

Two hard-won details carried straight over from the Generals port:

- **Cancelled touches must never ghost-click.** Open the app switcher mid-drag
  and iOS fires `touchcancel`. The gesture engine synthesizes a `mouseup`
  flagged `cancelled`, and the world-interaction layer uses that flag to release
  all held state (selection box, pan) *without* executing the click. A cancelled
  rally-point drag doesn't order your army into the sea.
- **A two-finger gesture that starts as one finger** must retract the left-mouse
  press it already sent (again, a cancelled `mouseup`) before beginning the pan,
  or the first frame of every map-grab also box-selects.

**Pinch zoom forced real engine work.** Camera zoom was hard-locked to 1.0
outside a dev flag. Enabling it meant: a `CameraZoom` that clamps between
"viewport exactly fits the map" and 2×; **zoom-invariant panning**
(`WorldScene.updateCamera` no longer divided pan by `camera.zoom`, and pan
limits are recomputed each zoom as `viewport / zoom`); and dividing the finger
delta by zoom in the pan handler so the map tracks the fingers at any zoom. A
bonus: mouse-wheel zoom now works on desktop too.

## 5. Display scaling for phones and tablets

The engine renders to a fixed logical resolution and scales the result to the
screen. Two findings:

- **Menus vs. game want different logical sizes.** The menu art is designed for
  an 800×600 canvas and looks wrong scaled below it; the in-game HUD is happy
  smaller, where a smaller logical size means a *bigger* on-screen HUD. So the
  logical resolution is context-aware: 800×600 in menus, 800×480 in-game
  (`inGameViewportActive` flips on `GameScreen`/`ReplayScreen` enter/leave).
- **The engine never upscaled.** Display scale was capped at 1.0 — fine on a
  phone whose screen is smaller than the logical canvas, but on an iPad (logical
  canvas *smaller* than the screen) it rendered pixel-for-pixel in the middle
  with wasted margins and clipped edges. Mobile layouts now aspect-fill from the
  design base and scale past 1.0 (iPad mini: menus 1.24×, in-game 1.42×).

See §8 for the input bug this scaling exposed.

## 6. English translation

Two layers of Chinese. The in-game strings live in a CSF (compiled string file);
the retail English `ra2.csf` — pulled from your own `language.mix` — covers
4,476 of 4,477 keys (the lone miss was a translator credit), so it simply
*replaces* the fork's `general.csf`. The app-chrome strings live in a JSON locale
file (6 keys added). The remaining ~38 source files (dev tools, GUI screens, LAN
pairing, README) were translated by hand, leaving load-bearing literals intact
(e.g. `CsfFile` detects Chinese game-data by comparing a theme label to `开场` —
a data comparison, not display text).

One bug fell out of this: the download-progress string is a CSF template with a
`%d`, but the importer passed a pre-formatted `"12.3 MB"` string. `sprintf`
threw, which aborted the import with a misleading "download failed." Wrapped in a
try/catch that degrades gracefully.

## 7. The skirmish AI

The built-in bot is a port of the [Supalosa Chronodivide
bot](https://github.com/Supalosa/supalosa-chronodivide-bot) — base building,
economy, threat maps, and scouting/expansion/attack/defence/retreat missions.

**Difficulty ladder** (`botProfiles.ts`). Three profiles — Easy / Normal /
Brutal — that shape *pacing, not resources*: APM cap (reaction speed), attack
army-size multiplier, attack-cooldown multiplier, and a first-attack grace
period. No cheating. Easy reacts slowly, sends small waves, and leaves you six
minutes to breathe; Brutal is 600 APM with larger armies and half the cooldown.

**Per-match personality.** On top of difficulty, each game rolls one of four
personalities — rusher, harasser, balanced, boomer, turtle, opportunist — that further scale pacing and,
crucially, *weight the unit compositions* (a rusher favours cheap infantry
spam; a boomer stacks Apocalypse tanks and Kirovs; a turtle builds artillery
pushes). The roll uses the game's own deterministic PRNG, never `Math.random`,
so bots stay in lockstep for future LAN play. Same difficulty setting produces a
different opponent every match.

## 8. Bug archaeology

The best part. Each of these was found by playing on a real device.

### The bot that could never build (all platforms)

**Symptom:** *"the easy opponent doesn't seem to be doing much"* — the AI
deployed its MCV, built exactly one power plant, then sat there. Credits frozen
at 9,128 for 8,000+ ticks.

**Root cause:** RA2 structure queues hold one item at a time. The bot's building
mission was stateless — every tick it recomputed "what's the best structure to
build?" from the full available list. While the power plant was under
construction, "best available" evaluated to the *barracks*. The queue controller
saw an in-progress item that was no longer being requested, treated its priority
as zero, and dequeued it to start the barracks — at which point "best available"
flipped back to the power plant. An infinite queue → cancel → re-queue
oscillation. **Every difficulty, on desktop too, had never built past its first
structure.**

**Fix:** two changes. The building mission now commits to whatever is in
production until it's placed (re-emitting the same choice with its location). And
the queue controller refuses to preempt an in-progress building that has merely
lost its request for a tick. Verified live: full build order
(ConYard→power→barracks→refinery→war-factory×2→radar), harvesting, scouting, and
an attack launched around the 8-minute mark.

### Silent unit voices

**Symptom:** ordering a unit produced no "Yes sir / Moving out" acknowledgment.

**Root cause:** `SoundHandler.handleOrderPushed` switched on the strings
`'Move'` / `'Attack'` / `'Capture'`, but the order pipeline hands it a *numeric*
`OrderFeedbackType` enum. A number never equals a string; every case fell
through. Silent on every platform.

**Fix:** switch on the enum, and while there, wire up the `Enter` and
`SpecialAttack` feedback the string version never even covered. Another one the
web build wants.

### A fog of war full of dots

**Symptom:** *"if I zoom into certain levels I see the dots in the fog."*

**Root cause:** the SHP texture atlas packed sprite images edge-to-edge with zero
padding. Terrain and shroud tiles sample with nearest-neighbor filtering, and at
a *fractional* zoom the sampler reads a texel just past a tile's edge — landing
in the neighbouring atlas entry, often a transparent or wrong-coloured pixel, so
stray dots punch through the fog.

**Fix:** pack every image with a 1px gutter filled by extruding its own edge
pixels (the standard atlas-bleed fix). UVs still reference the exact image rect,
so nothing else changes — and terrain/unit seams at fractional zoom are gone too.

### A shroud that tore while scrolling

**Symptom:** *"when scrolling and panning these lines appear sometimes depending
on the frame, but if left in the right place they go away."*

**Root cause:** the two-finger pan tracks the centroid of both fingers, which
lands on half-pixels, and zoomed panning divides by the zoom factor — either way
the camera ends up at a sub-pixel position, and the shroud tiles bleed at their
seams. "Go away when left in the right place" = lands back on a whole pixel.

**Fix:** snap the applied pan to whole canvas pixels each frame
(`round(pan * zoom) / zoom`).

### Taps that missed after scaling up

**Symptom:** *"I'm tapping the MCV but it won't detect the touch... the bottom
bar seems to be working."*

**Root cause:** entering a game changes the UI scale (menus 1.24×, in-game 1.42×
on iPad). The input layer re-measures the canvas rect at that moment to build its
touch→canvas mapping — but the re-measure fired *before* the new scale was
applied to the DOM, capturing the old transform against the new canvas size.
Every world tap then went through a ~13% wrong scale, an error that grows with
distance from screen center. The bottom command bar kept working because its
buttons sit near the transform origin (tiny error) and have large hit areas.

**Fix:** apply the layout (size + scale transform) *before* announcing the
viewport change, so subscribers measure reality. This bug had been latent since
the first iPhone build — it only became felt-able once a build actually upscaled.

### The blank-screen boot hang

**Symptom:** a build shipped, then *"right now I see a blank screen."*

**Root cause:** an over-eager audio fix. To skip the audio-permission dialog in
the shell, the boot path `await`ed `AudioContext.resume()`. WebKit leaves that
promise *pending forever* until a user gesture arrives — the very gesture the
dialog used to provide. Boot blocked on audio and never drew the menu.

**Fix:** never await audio on the boot path. Kick off the resume fire-and-forget
and retry on the first touch. Worst case audio starts a beat late; the game
always boots.

### Grainy textures on a Retina display

**Symptom:** *"even the textures and stuff look grainy, I wonder if there's a
better way to render them sharply at this resolution."*

**Root cause:** the WebGL canvas rendered at the engine's *logical* resolution
(~800×524 in-game), was CSS-scaled 1.42× to fill the iPad, and the display
doubled that again (devicePixelRatio 2). Every rendered pixel smeared across
~2.8 device pixels through bilinear filtering. The game was being played
through a 2.8× blur-upscale.

**Fix:** render at true native resolution. Three.js's `setPixelRatio` keeps
the canvas CSS size logical while multiplying every viewport rect internally,
so scene code doesn't change; the backing store becomes logical ×
(displayScale × devicePixelRatio), one rendered pixel per device pixel
(capped at 3× for GPU sanity). Two knock-ons matter: anything that read
`canvas.width` for *logical* math (pointer mapping, edge-scroll zones) must
read `clientWidth` instead, and the shroud-seam pan snapping must snap to
whole *device* pixels, not logical ones — at 1.42×2 = 2.84 pixels per logical
unit, logical snapping would have brought the scrolling seams back.

### The map that was only too bright on the iPad

**Symptom:** *"the brightness thing is really bad — some screens are absolutely
unplayable."* Whole park and plaza areas nuked to near-white on the iPad;
identical build renders perfectly in Chromium, in a Mac WKWebView harness,
and in the iOS Simulator. Fogged areas looked normal — only currently-visible
terrain blew out.

**The hunt (worth recording):** every plausible theory died on real device
data, collected over a debug REPL built into the shell (the app polls the dev
Mac for JS snippets and posts results back — eval-over-LAN, because WKWebView
has no console input). In order: shader precision (device reports fp32
mediump, same as desktop), sRGB texture decode (mathematically exact on
device), depth buffer size (24-bit everywhere), lamp lights (zero registered),
stale lighting bakes (vertex buffers byte-identical across platforms). The
breakthrough was same-tile pixel sampling: for identical world tiles, Mac and
iPad showed *swapped* content — dark path pixels where the other platform had
bright pavement, in interleaved patterns. Not a lighting bug at all: a **draw
order** bug.

**Root cause:** ground sprite layers (pavement overlays, smudges, terrain
objects) render with depth testing off, so where two sprites overlap, whoever
draws later wins. Slot order inside each merged sprite batch IS draw order —
and slots were assigned in *async art-load arrival order*. Deterministic on
any one machine, different between machines. The iPad's load timing put
bright pavement sprites after the dark path sprites they should sit under.
The earlier "white patches in Yuri assets" (blamed on GL corruption after a
crash) were this same bug.

**Fix:** repack batch slots into isometric painter order (south-most sprites
draw last), debounced after load settles — matching the original engine's
row-by-row cell rendering — plus explicit distinct renderOrder for the smudge
layer instead of three.js's material-id tiebreak. Deterministic everywhere,
and verified pixel-identical Mac vs iPad afterwards.

### The invisible lamps that painted the map white

**Symptom:** after the draw-order fix, YR urban maps were *still* "way too
bright" in patches — parks and plazas washed toward white — while RA2
classic maps looked fine. The user's internet research pointed at retail
"washed-out palette" fixes (cnc-ddraw), which don't apply mechanically to a
WebGL engine but named the right symptom class: palette applied wrong.

**Root cause:** YR maps are scattered with invisible lamp buildings
(INGALITE, INYELWLAMP, NEGLAMP, ... all `Image=GALITE`,
`InvisibleInGame=yes`) whose only job is to tint nearby cells. The engine
approximated each with a giant additive glow sprite (blend: DstColor add)
spanning `LightVisibility` — ~19 cells of radius — which blew whole areas
to near-white. A scene-graph bisection (toggling `visible` per child while
pixel-sampling one blown tile) found it in minutes after every lighting
theory failed: hiding `building_INGALITE` snapped the pixel from pure white
to perfectly tinted pavement.

**Fix:** do what the original does. Draw nothing for `InvisibleInGame`
buildings, delete the glow-sprite path, and cast lamp light into the
per-tile lighting model at world build — linear falloff
`(LightVisibility − 256·d) / LightVisibility` within `LightVisibility/256`
cells, tint and intensity summed onto the map's `[Lighting]`, clamped at
zero for the negative lamps. The formula comes from the community's
retail-validated CNCMaps renderer, whose source doubles as the best
documentation of the original lighting pipeline
(`ambient − ground + level·z` scalar × per-channel tint, palettes 6-bit).
The Alamo bakes 3,519 lit tiles; the white plaza became warm cream stone.

### Teaching the engine to keep slaves (Yuri's economy)

**The goal:** Yuri's faction runs on the Slave Miner — a refinery that is
also a vehicle, staffed by five slaves who do the harvesting on foot. None
of it worked: the original engine hardcodes the whole mechanic behind two
ini keys (`Enslaves=SLAV`, `Slaved=yes`) that set no generic flags at all.

**The approach:** derive what retail implies. A slave IS a harvester; an
enslaving building IS a refinery with a dock. With those two derivations,
90% of the feature fell out of existing machinery — harvester tasks,
refinery docking, deploy logic (the mobile miner deploys exactly like an
MCV), even the free-unit spawn pattern for the workforce.

**The last 10% was infantry-shaped holes in vehicle-shaped code:** harvest
tasks rejected non-vehicles outright; the miner occupies its entire
foundation so the canonical docking tile (right edge, middle — a hardcoded
convention from the classic refineries) is inside the building, leaving
slaves eternally "looking for a refinery" three tiles from one; and the
unload sequence waits for a 270° turn that infantry, having no turn rate,
never complete. Each fix was a few lines once the wedge was visible in the
harvester status enum. The Grinder, meanwhile, cost zero engine work — a
fully implemented recycler task was already sitting in the codebase waiting
for a faction that could use it.

### The Psi Commando that defected to everyone

**Symptom:** *"I'm not sure Psi Commando is a unit the Allies have until you
have some sort of building combinations."* (Correct instinct.)

**Root cause:** YR's `[PTROOP]` ("Psi Commando") lists *every country* as
Owner at TechLevel 9 with prerequisite just BARRACKS. What keeps it out of
retail build menus is one key: `RequiresStolenThirdTech=yes` — send a spy
into a *Yuri* Battle Lab to unlock it. The engine parsed the Allied and
Soviet stolen-tech flags but not the third one, so in YR mode the Psi
Commando quietly joined every faction's barracks. A one-key leak — the same
class of bug as the `[AudioVisual]` crash: YR's rules lean on engine-side
defaults and mechanics that a reconstruction must implement, not skip.

**Fix:** parse `RequiresStolenThirdTech` and check all three stolen-tech
flags independently (the old code also ignored the Soviet flag whenever the
Allied flag was set). Stolen tech is recorded by `AIBasePlanningSide` index —
Yuri's lab is index 2. RA2 classic was never affected: its PTROOP is gated
behind stolen *Soviet* tech, which was already handled.

### The power plant with invisible ini keys (Bio Reactor)

**Symptom:** Yuri's Bio Reactor should hold 5 infantry at +100 power each,
but `rulesmd.ini` gives `[YAPOWR]` *no occupancy keys at all* — no
`CanBeOccupied`, no `MaxNumberOccupants`, no power-bonus key. Retail
hardcodes the whole mechanic in the exe.

**Approach:** mirror the exe with a by-name derivation in `TechnoRules`
(`canBeOccupied=true`, 5 occupants, `occupantsPowerBonus=100`), then ride
the existing civilian-garrison machinery — with three corrections it was
never built for: entering an own/allied building must not run the
capture path (`buildingsCaptured++` + owner change is gated to neutral
targets now), emptying a *player-built* garrisonable must not hand it to
the civilian player (gate: `techLevel === -1` means civilian), and enemy
player-owned garrisonables must refuse entry entirely. The battery accepts
any friendly infantry except slaves — `Occupier=yes` still gates urban
garrisons only. Occupancy changes feed the player power ledger through the
same health-scaled `updateFrom` used for damage.

**Lab note:** the first verification run produced ghosts — the reactor
handed to civilians on evacuate, its 650W still on my ledger, five
Initiates vanished. All of it was a *stale vite module graph* (the served
`GarrisonTrait` predated the edit), plus the enemy Yuri bot legitimately
garrison-capturing the "civilian" reactor mid-test. Rule: after editing sim
modules, reload with a cache-buster and verify the served module before
trusting any observed behavior.

### The bot that only built power plants (Yuri AI)

**Symptom:** an AI rolled onto Yuri built 16 Bio Reactors and nothing else
— no barracks, no factory, no army. 2400W of power for a base with zero
drain.

**Root cause:** the built-in bot's knowledge is a name-keyed map
(`BUILDING_NAME_TO_RULES`) plus side-keyed lists, all Allied/Soviet-only.
For Yuri, every lookup missed; the only actor left was the adapter's
fail-safe, whose "extra power always allowed" exception and bare
`available[0]` fallback both resolve to YAPOWR forever.

**Fix:** add Yuri to the `Countries` enum, give the map the Yuri roster
(YAREFN as a plain count-capped `BasicBuilding` — the harvesters-per-
refinery ratio logic can never fit a building that ships its own 5
harvesters), add initiate/lasher/disc attack compositions, a `YENGINEER`
engineer-mission case, Yuri scouts, PCV expansion, and a
`FAIL_SAFE_BUILD_ORDER_YURI`; restructure the fail-safe to walk its list
before topping up power. Verified end-to-end: the Yuri bot opened
YAPOWR→YAREFN→YABRCK→YAWEAP, ran 3 slave miners, and won its game with a
14-unit combined-arms wave.

### The bunker that borrows a gun (and the miner that couldn't move)

**Tank Bunker:** rather than teaching a limboed tank to fire, the bunker
*becomes* the gun: on entry it gets an `ArmedTrait`/`AttackTrait` pair
built from the occupant's weapon rules (`addTrait` keeps the tick cache
in sync), and on exit the weapons are nulled and the attack trait
disabled — trait *removal* doesn't exist in this engine, so disarm, don't
detach. Enemies naturally target the bunker; the tank sits in limbo and
walks out unharmed when the bunker deploys, sells, or dies.

**The dropped move order:** ordering a slave miner building to move —
the retail way to undeploy it — did nothing, in the real UI too. The
action layer groups move orders through a formation helper that only
assigns positions to *units*; building sources got no position and were
silently skipped. One fallback line (buildings head for the clicked
tile) fixed a bug that made Yuri's whole mobile-economy loop
unreachable from the sidebar. The lesson repeats: silent drops in the
order pipeline are the most expensive class of bug to find, because
everything *looks* healthy — log or assert when an order resolves to
nothing.

### The loading screens that looked 16-bit (they weren't)

**Symptom:** YR loading screens rendered as white blotches and false
colors — plausibly "16-bit color not supported."

**Root cause:** the ls800 screens are ordinary 8-bit paletted SHPs, but
YR *repainted all of them* against per-country palettes (`mplsr.pal`
Russia, `mplsu.pal` USA, … `mpyls.pal` Yuri, found by hash-probing the
mix with candidate names) while the engine kept using RA2's shared
`mpls.pal` for everything. Decoding the same pixels against the right
palette produces retail-perfect screens — proven offline with a bun
probe before touching engine code. The countries' palettes live in
`loadmd.mix`; RA2's shared one hides in `cache.mix`.

**Yuri's sidebar, demystified:** `sidec02md.mix` is not a full shell —
it's a *delta* over `sidec02.mix`, and retail YR's entire Yuri UI
amounts to the Soviet shell plus one file: `radary.shp`, the purple
radar bezel (same 33-frame 168×110 layout as `radar.shp`). Layer the
md side mix, swap one image name for Yuri players, done. When art
seems missing, measure the mix before building a reskin pipeline: the
answer was one file, not forty.

---

## 9. Retail-accurate lighting (the audit that ended the guesswork)

A 26-agent audit compared the pipeline against retail and against the CNCMaps reference. The
provenance side came back clean (seeded archives identical to Steam, VXL
parsing byte-equal to the CNCMaps reference implementation, all four voxel
normal tables exact). The lighting side did not — and every divergence was a
compounding "why does it look *slightly* off" report:

- Map `[Lighting]` **ground term was added instead of subtracted** — every
  Ground-lit map ~10 points too bright.
- Palette lighting was multiplied in **linear color space**; retail
  multiplies in gamma/display space. The fix is an exact piecewise-sRGB
  encode/decode pair inside all three palette shaders (identity at
  multiplier 1, so unlit pixels are untouched).
- Voxel shading replaced stock Phong with the retail model:
  `palette × (0.8 + 1.3·dotNL) × cell light`, diffuse-only. This killed both
  a π-division brightness cap and phantom specular highlights on tanks.
- **Invisible lamp buildings**: YR maps scatter `INGALITE`-style lamps that
  retail never draws — they only cast light. The engine drew a giant
  additive glow sprite per lamp, washing whole city blocks to white
  (the long-standing "white patches"). Now: no render, correct radial
  tile-light contribution using CNCMaps' validated falloff.
- Units re-sample their cell's light when they change tiles, so a tank
  driving from a lamp-lit street into darkness actually darkens.

The other lesson: **measure on the device**. The "iPad is brighter than the
Mac" bug that started all this was *draw order*, not lighting — ground
sprite layers rendered depth-off in async asset-arrival order, deterministic
per machine and different between machines. Same-tile pixel sampling on both
platforms (via an on-device REPL) was the decisive experiment; the fix was a
painter-order re-sort, not a shader.

## 10. Performance and thermals

The engine rendered at display-rate rAF — 120Hz on ProMotion iPads — and
walked the scene graph twice per frame. The pass that fixed it, in order of
impact: frame-rate cap decoupled from the sim (60 default / 30 battery /
uncapped, menus hard-capped at 30fps), `preserveDrawingBuffer: false` (a
per-frame framebuffer copy on iOS tile GPUs), `matrixWorldAutoUpdate = false`
with explicit updates (the renderer was re-walking a graph the scenes had
already updated — render CPU 4.0→1.8ms), octree re-slot only on tile change,
and reusable scratch objects in the cull path. Total frame CPU: 6.4→3.6ms.

Profiling gotcha worth keeping: **warm up before you measure**. Renderable
*creation* cost pollutes first-frame numbers; a "12.9ms movement cost" once
evaporated after 30 warm-up frames.

## 11. Mid-match save/load on a lockstep engine

A save is not a snapshot — it's the **action log up to the saved tick**,
stored through the replay system. Loading recreates the game with the same
RNG seeds and resimulates the log at maximum speed, then hands control back
with the recorder still appending (so re-saving carries full history).

The trap that made this real engineering: the replay format stores the game
timestamp as uint32 *seconds*, but games were created with `Date.now()`
*milliseconds* — and the timestamp seeds the RNG. Every load would have
silently diverged. Fix: second-align the creation timestamp so the seed
round-trips exactly. If you build on a deterministic engine, **anything that
touches a seed must survive its own serialization format.**

## 12. The AI campaign

The stock bot idled behind three war factories and rushed the same
conscripts every game. Five passes rebuilt it; the details are a story about
*sources* as much as code:

1. **Structural fixes + the retail database.** Army production existed only
   as attack-mission requests (≤2 assembling, decaying to cancellation) —
   hence idle factories and money piles. Background production fixed the
   economy of it; the *content* came from the retail `aimd.ini`: 132
   TaskForces / 165 AITriggerTypes parsed straight out of the shipped mix,
   with conditions, per-difficulty enables, and win/loss weight feedback.
   Each team's ScriptTypes are also parsed for **intent** — harvester
   hunters hunt harvesters, and the 34 guard/MCV teams stop being thrown
   across the map as "attacks".
2. **Superweapons + squads that fight like they mean it.** A superweapon
   officer (cluster-targeted nukes/storms/dominators, iron curtain on its
   own push, chronoshift with safe-landing checks, paradrops into fights,
   anti-superweapon Force Shield rolls) plus retreat-when-losing squads,
   artillery stand-off, and threat-aware approach waypoints.
3. **Variety as a system.** Personality (tempo) × doctrine (tools) ×
   opening book × ±40% weight jitter × a per-match trigger mask, plus
   country signatures and ~20 restored roster units with micro-roles.
   Counter-composition census closes the loop against the human.
4. **EA's own source.** RA1's `HOUSE.CPP` and Generals' skirmish AI replaced
   guesses with retail values — and the probed `rulesmd.ini` [AI] knobs
   outranked both ancestors where they disagreed. Equally important was the
   **do-not-port list**: literal retail team delays would have gutted the
   pacing; several knobs are parsed-but-dead in RA2 itself.
5. **Backports + hardening.** OpenRA-style leader squads and air discipline,
   spy infiltration (battle-lab stolen tech), BFRT boarding, the RA1
   sell-ladder and fire-sale — then a 19-agent adversarial review: 14
   confirmed findings fixed (a dead repair path, a cross-game rules-cache
   determinism leak, pure-air squads bouncing forever off AA) and the sim
   made 2.2× faster. Measured: 0.6–0.9ms/tick with **seven** AI opponents.

Two recurring disciplines made this workable on a lockstep engine: every
random choice goes through the game PRNG (never `Math.random`), and every
piece of mutable AI state lives per-bot-per-game — the one module-level
cache that violated this was a genuine cross-client desync waiting to
happen.

---

## 13. The failsafe that ate the AI (and how to never ship it again)

Three bugs shipped in sequence that made the whole AI look broken while
throwing no errors and costing no measurable performance. They are worth
naming, because they share one shape: **silent behavioural death**.

1. **A stale validator.** The lobby sanitised saved AI settings against a
   list written before Brutal existed, so every restored Brutal slot was
   demoted to Easy - and re-saved that way.
2. **A gate that could never fire.** Bot updates run on
   `(tick + phaseOffset) % tickRatio === 0`; the mission layer was gated
   *inside* that on `tick % 3 === 0`. When `tickRatio % 3 == 0` and
   `phaseOffset % 3 != 0` the two are never simultaneously true, so those
   bots never ran a single mission - no attacks, no garrisons, no
   superweapons - for the entire match.
3. **A "failsafe" competing with the real bot.** A safety net meant to
   unstick a dead bot queued buildings directly, bypassing the mission
   system. Whenever the starter build order was complete it fell through to
   "extra power is always useful" and queued another power plant - forever.
   Worse, the queue controller cancels anything it did not request, so the
   two fought in a queue/cancel loop that burned the economy. This is the
   true origin of both the twenty-bio-reactor report and the "AI does
   nothing" reports.

**The lesson:** a bot that does nothing throws nothing. Error-free soak
tests and per-tick profiling both passed while large parts of the AI were
inert. Liveness has to be asserted explicitly, so it now is:
`scripts/ai-liveness-probe.js` runs a mixed-difficulty match headlessly and
fails if any bot stops building varied structures, stops forming attack
missions, never projects force away from home, spams one structure, or
accumulates queue cancels. Run it before any device build that touches bot
scheduling, production, or difficulty.

Corollaries worth keeping: never nest a global-tick modulus inside a
phase-offset gate (use a per-bot counter); never let a fallback path write
to a queue the main system owns; and measure liveness, not just errors.

---

## 14. The audit that found the other seventy-two

Chapter 13 covers three bugs that made the AI look broken. Fixing them was
not enough, and the reason is worth writing down: **fixing what you found
tells you nothing about what you did not.** So the next pass was an
exhaustive one — 198 agents across eleven dimensions (the new code in both
languages, the difficulty matrix, a hunt for more dead gates, determinism,
the production state machine, combat missions, all three factions, memory and
performance, audio and UI, and the engine API surface), with every candidate
finding handed to independent adversarial verifiers whose job was to refute
it. 72 survived.

The most valuable dimension was "hunt for more unreachable logic", because
the dead-gate bug turned out to be a *class*, not an incident:

- `awareness.ts` had three more `tick % N === 0` gates nested inside the
  phase-offset bot update. By the Chinese remainder theorem those bodies are
  reachable only when `gcd(N, tickRatio)` divides that bot's phase offset —
  so in a seven-bot lobby exactly one bot ever computed a threat cache,
  moved its rally point, or received expansion candidates. Everything
  downstream inherited the silence: with a null threat cache every static
  defence fell into a ramp that stops at **one copy per type**, which is why
  the per-difficulty defence budgets never bound and why bases looked naked.

Other confirmed findings, each a small mechanism with a large gameplay
shadow:

- **Attack squads disbanded on their first update.** The no-target timeout
  compared against a timer that was never initialised at launch, so any wave
  aimed at an unexplored base (which is *by construction* not visible)
  dissolved the tick it launched — and the trigger database recorded that as
  a win, raising the weight of the composition that never fought.
- **Tech never entered the queue.** Battle labs and superweapons scale their
  desire by floating credits, and a healthy bot spends to zero every pass.
  The savings mechanism that should have accumulated the cash was
  NaN-poisoned (`0 + undefined` across six production queues, one of which
  never has a request), which made both the pause and the resume conditions
  permanently false. Two bugs hiding each other.
- **The war factory bought miners.** Harvesters inherited the highest weight
  in the background vehicle pool and had no cap there, so once the explicit
  economy rule was satisfied they kept winning the roll. Artillery, meanwhile,
  was excluded from that pool by a missing `instanceof`, so the personality
  and doctrine weights written specifically to field V3s were inert.
- **Difficulty was diluted by the speed slider.** Bot cadence derived from
  real-time APM against `getTickRate()`, while every pacing constant in the
  bot is expressed in raw ticks — so at the lobby's default speed every
  difficulty thought roughly six times more slowly per game tick than it did
  in the lab. This is the single best explanation for why headless numbers
  disagreed with how the game felt on a device.
- **Retail's hidden AI economy was missing.** `AIVirtualPurifiers` (brutal 4,
  normal 2) makes AI houses refine ore as though they owned extra Ore
  Purifiers — +100% and +50% at retail's `PurifierBonus`. That, not cheating
  income, is how retail's brutal AI affords its army.

Two engine-level hazards from the same audit are worth carrying into any
project like this. First, **`constructor.name` does not survive minification**:
a predicate that recognised attack tasks by class name was dead in every
release build while working perfectly in dev — the fix is a `Symbol.for`
marker on the class. (The same hazard still exists in save-state keys built
from trait class names; a minifier bump would silently invalidate saves.)
Second, **dropping a CPU-side texture copy is not free**: after upload it
looks like pure profit, until a WebGL context loss makes three.js re-upload
every texture from `image.data` and every sprite in the game turns
transparent. Atlases now rebuild their pixel copies on context restore.

## 15. How to QA a game you cannot see

The uncomfortable lesson of chapters 13 and 14 is that this project's
automated tests kept passing while the game played badly. Two practices
closed that gap, and they are the ones to keep:

**Assert liveness, not absence of errors.** `scripts/ai-liveness-probe.js`
runs a mixed-difficulty match headlessly and checks that each bot is *doing
things a player would notice*: the difficulty it was given is the profile it
actually runs, its update/mission/queue loops fire at the expected cadence,
waves launch with bounded gaps, the base grows and stays varied, no structure
exceeds its cap, queue cancels stay inside a budget, and per-bot cost stays
under the device budget. All three chapter-13 regressions fail it.
`scripts/build-ios.sh` refuses `--device` unless the run is signed off with
`RA2_LIVENESS_OK=1`. Be clear about what that is: the probe is pasted into the
dev console of a running skirmish and needs a real WebGL context, so it cannot
run in CI or in the build script. The env var is an honour-system gate that you
set by hand after watching it pass, not an automated check.

**Then actually watch.** Counters cannot tell you that a base looks wrong.
The routine, all through the debug REPL in the desktop lab:

1. Reveal the map for the observing player.
2. Pan the camera onto each bot's construction yard —
   `MapPanningHelper.computeCameraPanFromTile` is the only correct way to get
   from a tile to a camera position; raw world coordinates are not pan
   coordinates.
3. After stepping ticks headlessly, pump `renderer.update()` and
   `renderer.render()` before each screenshot (the render loop is suspended
   while the pane is not compositing).
4. Detect superweapon launches by polling each house's timers — a timer that
   jumps *up* has just fired — then pan to the impact.
5. Look at the screenshots as a player: is the base coherent, are there
   duplicate structures, is there a defence line, what is actually in the
   army, do waves arrive.

That loop found the duplicate battle labs (a request that outlived the
mission that made it), the war factory count (which turned out to be a
literal `maxNeeded = 3` in the original table), and the idle starting units
(they belong to no mission, so nothing ever ordered them — they now get a
Guard order at game start). None of those were visible in any metric being
collected at the time.

A closing note on tuning philosophy, learned from a playtester's correction:
caps are a poor substitute for judgement. Banning the second war factory
"fixed" duplicates and made the AI worse — the engine genuinely rewards a
second factory with +25% build speed (retail `MultipleFactory=0.8`) and
delivery overflow. The right rule was not a smaller cap but an economic
precondition: build the second factory when the bank can feed it.

---

## 16. Cooling the iPad: the heat was in the bytes, not the frames

The complaint was concrete: the iPad mini got hot in long games, while the
Generals port — a far more modern, more demanding game — barely warmed it.

The instinct is to blame JavaScript. That instinct is wrong, and worth
dismantling because it sends you on a months-long rewrite. Inside WKWebView,
JavaScriptCore JIT-compiles the engine to native ARM64, and ANGLE translates
WebGL to Metal — structurally the same layer DXVK/MoltenVK provides for
Generals. Going native removes JS dynamic-typing overhead and per-call WebGL
validation; it does not unlock a missing translation layer. And a native
renderer that reproduced this renderer's mistakes would run exactly as hot.

**Heat is sustained average power, and on a tile-based GPU the dominant term
is memory bandwidth — which CPU timings cannot see.** That is the trap. An
on-device profile said the app was CPU-bound: rendering at one-eighth the
pixels saved only 5% of CPU time. The honest reading of that experiment is
not "fill rate does not matter"; it is "CPU milliseconds are the wrong
instrument." The GPU does its work asynchronously, so the bytes it drags
through DRAM never appear in a `performance.now()` delta.

So measure bytes. Four findings, all verified in a live match on real iOS:

**The sprite batches drew ten thousand slots each, every frame.**
`BatchShpBuilder` preallocates a 10,000-sprite geometry and never called
`setDrawRange`. Empty slots were hidden by writing 0 into an alpha lane and
letting `alphaTest` discard — which kills the pixels but not the index fetch
or the vertex shading. Measured occupancy in a real match: **2.4%**. Five
meshes were pulling 600,000 indices and 400,000 vertices per frame to draw
about 14,000 indices' worth of trees and ore. 16 MB/frame → 0.4 MB/frame.

**The shadow box covered 233 tiles for a 31-tile view.** A fixed ortho box
centred on the map meant roughly 1% of the depth texels landed where the
player was looking, and a 2048² depth target was re-rasterised every frame —
32 MB/frame of render-target traffic, more than twice the colour buffer.
Fitting the box to the visible rect made the texels 3.7× finer, which bought
the room to halve the map to 1024². The result is *sharper* shadows for a
quarter of the bandwidth.

The mandatory detail: a shadow box that follows the camera must have its
origin snapped to whole shadow texels, or every shadow edge crawls while you
pan. Snapping in world X/Z is not enough — the shadow camera's axes are not
the world's. Project the centre onto the shadow camera's own basis vectors,
round *those* to texel multiples, and rebuild. Verified by panning in
sub-texel steps and asserting the light target only ever moves in exact texel
increments.

**Every sprite atlas was RGBA8 carrying one payload byte.** The shader reads a
palette index; R, G and B were hard zero. Switching to R8 cut resident atlas
memory from 89 MB to 22 MB. Two traps: set `unpackAlignment = 1` or GL's
default 4-byte row padding shreds any atlas whose width is not a multiple of
four; and read `.r` unconditionally rather than behind a `#define`, because
`THREE.Material.copy()` does not copy `defines` and would silently drop the
flag on exactly the batched meshes that matter most.

**The palette shader computed the identity function nine times per fragment.**
The palette texture was tagged sRGB, so the texture unit decoded it;
`ra2ToPaletteSpace` immediately re-encoded it; after lighting,
`ra2FromPaletteSpace` decoded again and three's `<colorspace_fragment>`
re-encoded. Two cancelling pairs, four stages, nine `pow()` per palette-shaded
pixel across roughly 3× screen overdraw. Untag the texture, drop the output
encode, and the pixels are not merely unchanged but slightly *more* accurate —
the removed round trip was losing low bits on dark palette entries.

Those two bandwidth items alone go from **2.81 GB/s to 0.25 GB/s**, and that
is before the 30 fps touch default halves everything on the render path again.

Two process notes worth more than any individual fix:

**Ship-mode gating is a power feature, not just hygiene.** The debug REPL was
live in the build being played: a 0.5 Hz `fetch()` to a hardcoded LAN IP,
forever, plus `eval()` of whatever came back. A radio that never reaches its
low-power state is tens of milliwatts of sustained draw. Gate debug channels
on a build-mode constant that folds to `false`, so the bundler deletes the
bodies and grepping `dist/` is a meaningful check — not on an ambient
environment variable that any build command can forget.

**Give the game the one fact only the OS knows.** JavaScript cannot tell SoC
throttling from a heavy frame. Twelve lines of Swift observing
`ProcessInfo.thermalState` (push-based; no polling, no new wakeup source) let
the renderer cap itself at 20 fps under `serious` and 15 under `critical`.
Cap rendering only — never the simulation tick rate — and the adjustment is
safe mid-match on a lockstep engine.

Finally: verify touch-only code paths on a touch target. The `pointer: coarse`
defaults — 30 fps, the 1024 shadow clamp — are invisible on a desktop browser
by construction. The iOS Simulator runs the same WebKit and the same
ANGLE-to-Metal path, boots unattended, and is drivable end to end over the
same debug REPL. It is where those branches were actually confirmed to fire.

---

## Appendix: reproducing an asset build

```sh
./scripts/setup.sh "/path/to/your/ra2/install"   # deps + verify + import
./scripts/build-ios.sh                           # normal: no local game files bundled
./scripts/build-ios.sh --bundle-local-gameres     # optional QA-only local bundle
./scripts/build-ios.sh --device                  # needs RA2_TEAM_ID for signing
```

`prepare-gameres.ts` is the source of truth for the optional QA bundle and how
it's derived from retail files. Nothing it produces is committed to the repo.
