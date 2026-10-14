# Stealth Sprinter — off-grid camper engineering model

An interactive, physically checked 3D model of a four-season, self-contained camper built
inside a **2025 Mercedes-Benz Sprinter 2500 Cargo Van, High Roof, 170" wheelbase**. From the
street it stays an ordinary white work van; inside it is a small, fully serviced home with
heating, air conditioning, indoor all-electric cooking, a private wet bath, 7.7 kWh of
lithium storage, 1 kW of solar and a 2.08 m bed.

Every component is a real object with dimensions, mass, cost, operating principle, service
access and dependencies. The pipes, cables and ducts are routed in 3D. A coupled time-step
simulation models heat, humidity, CO₂, battery, water and diesel use. An acceptance suite
(76 checks) verifies that nothing clashes, every system fits and every rating is respected.

```bash
npm install
npm run dev           # interactive viewer at http://localhost:5173
npm test              # 207 node tests: engineering acceptance, world, towns, routing, drive and crash physics, traffic (node --test)
npm run report        # regenerate docs/ACCEPTANCE-REPORT.md
npm run build         # static site in dist/
npm run build:single  # one-file page: dist-single/stealth-sprinter.html (three.js 0.170.0 from jsDelivr)
```

## What you can do in the viewer

| Control | What it shows |
|---|---|
| **Master transformation slider** (bottom) | 0 % closed cargo van → 25 % doors open, systems revealed → 50 % living mode (seats swivelled, table out, lounge) → 75 % sleeping + slide-out pod + insulated covers → 100 % full camp (awning, outdoor kitchen, rear-door table & bench). Play or pause anywhere. |
| **Systems** (left) | Operate any of 25 mechanisms on their own (drawers, fridge, microwave, toilet drawer, hatches, pod, awning…). Interlocks are enforced: the outdoor kitchen needs the rear doors at 270°, and the driver rear door stops at 180° while the pod is out. |
| **View** | Normal, X-ray, Cutaway (dollhouse / side / roof) and Exploded. Option to show concealed pipes, cables and ducts. |
| **Simulation modes** | **Thermal** (heat-flux arrows per envelope element, solar rays, warm/cold air, insulation layers) · **Electrical** (current-proportional flow on every cable) · **Water** (cold, hot, drinking, grey, fill, diesel) · **Ventilation** (labelled fresh, stale, cooking, shower, AC and heater airflows) · **Mechanical** (every hinge, rail, actuator, latch, seal and support) · **Daily living** (an occupant cooks, works, showers, uses the drawer toilet, lounges and converts the van for sleep while the simulation runs) · **Resources** (24 h and multi-day charts). |
| **Environments** (top) | Hot summer sun, cold winter (−18 °C), heavy rain, humid heat, overnight off-grid, 5 days without hookups. A time-of-day slider and clock drive sun, weather and the live simulation. |
| **Inspect** | Click anything: spec, how it works, envelope dimensions, mass, cost, location, service access, dependencies and live power or level. |
| **Energy** | Switch loads (AC, induction, microwave, fridge, fans, lights…) and watch battery %, solar, alternator, shore, inverter loading, the load manager, time to 20 % and the 24 h energy budget. |
| **Climate** | Thermostat (independent day/night heat and cool setpoints), diesel / electric / heat-pump source, quiet night mode, CO₂/RH-driven ventilation, live heat balance, design heat-loss and cooling-load calculations. |
| **Water** | Tank levels, run taps and showers, refill, dump, empty the toilet, simulate a leak (pump lock-out), winterise; freeze-protection status. |
| **Resources** | Multi-day simulation with battery, temperature, water and air-quality charts, energy by use, and endurance until the first resource runs out. |
| **Engineering** | Live acceptance tests plus weight & axle loads, capacities, heating/cooling demand, space use, cost estimate, items needing licensed sign-off and labelled assumptions. |
| **Drive** (top bar) | Everything stows first (travel interlock), then drive an endless, generated Montana-flavoured world — see [Explore the world](#explore-the-world). |
| **Guided tour** (top bar) | Twelve scripted stops — stealth exterior, roof, service garage, live power, galley, wet bath, sealed ventilation, infrared, slide-out pod, full camp, daily living and honest limits. Play, pause or step. |
| **Walk inside** | First-person at eye height: drag to look, W A S D / arrows / on-screen pad to walk. Collisions come from the component catalogue, so the walk respects the real aisle. Click anything to inspect it. |
| **Infrared camera** | Every surface shaded by its estimated temperature (ironbow palette, auto-ranged scale): sol-air heating, night-sky cooling, U-value losses, stratified cabin air and live appliance heat. Hover for °C. |
| **Photo mode & graphics** | Press **H** to hide the panels. Graphics: High (ambient occlusion, bloom, 4K shadows), Medium, Low or Lite, switched live and remembered; an automatically chosen tier steps down if the frame rate drops. |

## Rendering

- Physical (Preetham) sky with procedural clouds, stars and moon; the image-based lighting is
  regenerated from that sky as the weather and time of day change.
- Post-processing: ground-truth ambient occlusion, bloom and MSAA/SMAA, with quality tiers.
- The body is a single smooth loft through cross-sections (high-roof brow, raked windshield,
  short hood, rounded nose) with exact door apertures. Windows, rubber seals, panel gaps,
  headlights and road grime are drawn by a shader patch on the paint, and the glass is cut by
  the same signed-distance functions.
- LT245/75R16 all-terrain tyres (instanced tread blocks, sidewall lettering) on 16" six-spoke
  alloys with brake discs and calipers.
- Endless world: the van stays at the scene origin and the land is streamed around it
  (floating origin), so every view mode, the walk-through and infrared work anywhere. Terrain
  is streamed as 48 m near chunks plus a 384 m far ring, roads and towns as 96 m tiles, and the
  **land itself never changes between seasons or scenarios** — spring, summer, autumn and winter
  are one shared "skin" of shader uniforms (snow line, wetness, ice, grass/forest/crop tint,
  leaf amount) applied to the same terrain, roads, lakes, trees and town surfaces.
- A warm camp light hangs under the awning after dark; town windows, signs, street lamps and
  traffic headlights light up at night.
- CC0 photographic PBR textures (wood, leather, fabric, ground) on metric UVs; glowing
  shader streams show water, current and airflow moving at their simulated rates.

## Explore the world

The drive world is generated from a seed, deterministic and infinite. Real Montana names are used
as flavour; it is not a map. Everything is pure JavaScript you can test (`src/world/`).

- **Settlements** on a jittered 2.2 km grid: cities, towns, villages, farms and ranches, lodges,
  truck stops, campgrounds and junctions. Each flattens its own plateau and lays out a street grid
  (main street east–west, a main avenue north–south) with zoned blocks — towers and offices in a
  city core, shops on main street, houses, parks, church, school, courthouse, hospital, industrial
  yards with silos, a water tower, grain elevators and RV parks. Windows, storefronts, brick,
  corrugated metal, awnings and business signs are drawn by a shader; parked cars and street trees
  fill the blocks.
- **Roads**: interstates, highways, county roads, gravel and two-track, routed by A* through the
  valleys (lakes and other towns blocked), then relaxed into wide, drivable curves (5th-percentile
  radius > 200 m on highways), graded under per-class limits and blended into the town plateaus.
  Roadside power lines, ranch fences, mile markers, "next town" and speed-limit signs and
  billboards follow every road; roadside **discoveries** (overlooks, hot springs, a giant cowboy
  boot, bison and prairie-dog statues, ghost-mine headframes, old barns, giant trees) wait off
  the shoulder.
- **Lakes** freeze in winter; shallow water can be forded, deep water stops the van.
- **Traffic and wildlife**: cars, pickups, motorhomes, coaches and semis follow the roads with
  headlights at night, keep a safe gap, pass slower traffic and honk at a stopped or tailgating van.
  They no longer stop dead at the end of a road: they drive on **through towns and junctions**,
  turning at the main street and avenue, giving way by road class and arrival order, keeping
  their lane through the crossing and queuing at the stop line. Crash into one and it leaves the
  road as a **wreck** with its hazards on (smoking if badly hurt); the others see it, slow down,
  pass it or queue behind it, and it is towed away once nobody is looking. Deer, cattle and bison
  wander, flee from the van, and deer sometimes cross ahead.
- **Services** (stop at a pump, tap, dump station, campground or shop): buy diesel, fill fresh water,
  dump the tanks, check in for shore power, restock. Purchases change the live simulation state;
  distance in the drive world is compressed, so drive fuel burns 14× faster than the real distance
  and refuelling matters. Cash is saved in the browser.
- **Map and GPS**: tap the minimap for a full-screen pannable map. Tap a town to navigate (A* over
  the settlement graph, turn-by-turn with distance and ETA, automatic re-route) or tap the ground
  for a waypoint arrow. "Nearest fuel / water" shortcuts.
- **Passport**: stamps for every settlement, roadside discoveries, 17 achievements with cash
  rewards and a trip log — all saved in the browser.

### Driving controls

| Input | Action |
|---|---|
| **W / ↑**, **S / ↓** | Go, brake (hold at a stop to back up) |
| **A D / ← →** | Steer — smoothed so taps are gentle |
| **Space** · **R** · **V**, **+ −** · **B** · **T** · **Q** | Handbrake · Drive/Reverse · cruise control · speed limiter (posted limits) · back on the nearest road · horn |
| **C** · **L** · **M** · **E** | Camera (chase, cockpit, orbit, cinematic) · lights · map · use the service you are stopped at |
| Touch | Drag anywhere on the left half to steer, hold Go or Brake; optional tilt steering |
| Gamepad | Stick steers, triggers go/brake, A handbrake, B drive/reverse, Y camera, X lights, bumpers cruise/limiter, Start back on road |

The ⚙ panel has **Easy / Standard / Pro** driving aids (Easy adds lane keeping with curve preview,
traction and stability control, soft pedals and eases off before curves that are too tight),
steering sensitivity, camera shake, mph or km/h, engine volume, vibration, graphics tier and a
**scenery season** selector (Auto follows the scenario). Dust, snow powder, flung mud, spray and
tyre smoke come off the wheels; skid marks and ruts are left on the ground.

### Power and sound

The van has a performance-tuned turbo-diesel (≈ 225 kW at the wheels in drive mode) and a
9-speed automatic that cuts torque for a moment on each upshift: 0–100 km/h in about 10 s
(16 s before), 137 km/h governed. The engine sound is a soft, muffled diesel note — a rounded
harmonic firing pulse behind low-pass filters and a cabin filter that closes further in the
cockpit view, with a faint intake whoosh and a damped clatter — instead of the old buzzy
saw-and-square synth.

### Crashes

Impacts are solved as 2-D rigid-body collisions (restitution, scuff friction, yaw spin), so *where*
and *how fast* you hit decides what happens: a head-on hit stops the van, a hit on one corner
swings the nose round into a spin-out, a glancing blow scrapes speed off along a wall, and
sliding sideways on soft ground can trip the van onto its side. Damage builds by zone (front,
rear, left, right) on the new **Damage** meter: a crushed front costs power, pulls the steering
and finally stops the engine (steam, then black smoke, from the hood); side damage adds rolling
resistance. Hits throw sparks, glass and debris and shake the camera. Easy mode forgives, Pro does not.
Press **T** after a rollover or a dead engine for a tow (stands the van up, repairs it, costs
cash); a **Repair** button at fuel stations fixes lesser damage. Other cars are knocked about by
their mass: a sedan is thrown, a loaded semi barely moves.

## Design at a glance

| System | Choice | Key figures |
|---|---|---|
| Base vehicle | Sprinter 2500 HR 170" RWD | GVWR 4,105 kg; GAWR 1,860 / 2,431 kg; 1.89 m finished headroom |
| Layout | Rear transverse bed over an insulated garage; driver-side galley opposite the sliding door; passenger-side wet bath + wardrobe; swivel cab seats + swing table | 0.53–0.61 m aisle |
| Heating & hot water | Truma Combi D 6 E (diesel, room-sealed) | 2/4/6 kW; 10 L boiler; design loss 3.0 kW at −20 °C |
| Cooling | Dometic RTX 2000 12 V rooftop AC + concealed ceiling duct | 1.7–2.0 kW cooling, 245–742 W from the battery |
| Ventilation | Filtered fresh-air inlet, main roof fan, wet-bath fan, ducted range hood, toilet vent | Night CO₂ ≈ 925 ppm sealed |
| Kitchen | 2-zone induction, 130 L fridge/freezer, convection microwave, sink with filtered tap, pull-out outdoor kitchen | Load manager keeps AC demand ≤ 2.4 kW |
| Water | 120 L fresh (inside), 95 L heated grey (underbody), drawer toilet (urine-diverting) | ≈ 3 days for two people |
| Electrical | 2 × 12.8 V 300 Ah LiFePO4, Lynx Smart BMS, MultiPlus-II 3 kVA, 1,020 Wp solar, 2 × Orion XS 50 A, 30 A shore | Worst-case DC 359 A ≤ 400 A |
| Expansion | Slide-out bed pod (250 mm), 3.4 m awning, outdoor kitchen, rear-door table & bench | Pod is conceptual and parked-only |

Full design basis, sources and assumptions: [docs/ENGINEERING.md](docs/ENGINEERING.md).
Latest acceptance results: [docs/ACCEPTANCE-REPORT.md](docs/ACCEPTANCE-REPORT.md).

## Honest limits the model shows

- **Hot-weather AC is not sustainable off-grid all day.** At 38 °C with daytime AC the van
  uses about 11 kWh/day against about 5 kWh of solar, so the battery hits the 20 % load-shed
  point after about one day. Night-only AC, a 1–2 h drive or shore power fixes it.
- **Grey water and the toilet usually run out before power** on mild multi-day trips
  (grey tank full in ≈ 2.8 days with two people and alternate-day showers).
- **Winter costs diesel and battery.** About 5.5 L of diesel per day at −18 °C, plus about
  1 kWh/day for the grey-tank heat pad.
- **Conceptual parts need prototyping and sign-off**: the slide-out pod (structural body
  cut-out), drawer toilet, outdoor kitchen and rear-door table. The diesel heater installation
  and 120 V work need certified installers.

## Code map

```
src/data/      vehicle specs, component catalogue, wiring, plumbing, HVAC, mechanisms, scenarios
src/sim/       thermal, coupled time-step model, weight, cost, space, acceptance suite; van
               powertrain, crash physics (rigid-body impacts, damage), traffic AI and junction logic
src/world/     seeded world generator (terrain, lakes, settlements, A* roads), town layouts,
               GPS routing, discoveries, names — pure JS, unit tested
src/scene/     three.js stage, lofted body, interior builders, services & streams, infrared,
               walk-through, props, overlays, modes; land, towns, buildings, roadside, effects,
               life (traffic and wildlife), drive model
src/ui/        app controller, dashboards, charts, guided tour; drive HUD, map and GPS,
               services and wallet, passport
tests/         node --test acceptance tests
scripts/       report generator, single-file build
```

All geometry is procedural (no external models). Wood, fabric, leather, tile and ground surfaces
use CC0 photographic PBR textures from Poly Haven — see [public/textures/CREDITS.md](public/textures/CREDITS.md).
