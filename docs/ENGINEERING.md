# Engineering design basis

This document explains how the stealth camper is engineered, how each system was sized, what
the interactive model checks, and which figures are verified, typical, assumed or conceptual.
Every number here comes from the source files in `src/data` and `src/sim`; the generated
[ACCEPTANCE-REPORT.md](ACCEPTANCE-REPORT.md) lists the live results.

## 1. Brief

A two-person, four-season home that lives inside an ordinary-looking Sprinter cargo van:

- heating, cooling and ventilation that work parked, without the engine, with every door
  and window closed;
- genuine indoor cooking in bad weather (all-electric, no open flame);
- a private, enclosed shower and a toilet;
- enough storage, power and water for multi-day stays without hookups;
- no change to the work-van silhouette when retracted, with expansions that are
  mechanically plausible (supports, seals, latches, interlocks);
- every component physically placed, connected, serviceable and checked for clashes.

## 2. Base vehicle and coordinate frame

**2025 Mercedes-Benz Sprinter 2500 Cargo Van, High Roof, 170" wheelbase (standard body), RWD,
2.0 L four-cylinder diesel.**

| Item | Value | Source label |
|---|---|---|
| Wheelbase | 4,325 mm (170 in) | verified |
| Overall length | 6,967 mm (274.3 in) | verified (dealer data) |
| Overall height, unladen | 2,725 mm (107.3 in) | verified (dealer data) |
| Body width without mirrors | 2,020 mm | typical |
| Load floor height | 690 mm (27.2 in) | verified |
| Cargo length at floor (L3) | 4,300 mm (4,300–4,410 quoted) | verified |
| Max load width / between arches | 1,787 / 1,350 mm | verified |
| Interior height (high roof) | 2,009 mm (79.1 in) | verified |
| GVWR | 4,105 kg (9,050 lb) | verified |
| GAWR front / rear | 1,860 kg (4,101 lb) / 2,431 kg (5,359 lb) | verified |
| Curb weight | ≈ 2,410 kg (5,313 lb) | verified (base cargo 170 RWD) |
| Unladen axle split | 1,350 / 1,060 kg | **typical** (see note) |
| Fuel tank | 92.7 L (24.5 gal) | typical |

*Note:* one dealer listing quotes an unladen split of 2,232 lb front / 3,082 lb rear. That is
implausible for an empty front-engine van and looks transposed, so the model uses a typical
56 % front split. Weigh the actual van on a certified scale before finalising the layout:
the rear axle carries most of the conversion (2,264 kg of 2,431 kg in the design case).

**Frame:** metres; `x` forward from the rear-axle centreline, `y` up from the ground, `z` toward
the passenger (curb, sliding-door) side.

**Finished interior** (assumption: 25 mm XPS + 12 mm ply + vinyl floor; Thinsulate inside the
rib depth; 6–9 mm lining): floor at 0.73 m, ceiling at 2.62 m (1.89 m standing headroom), side
walls at ±0.855 m up to 1.90 m, tumbling in to ±0.75 m at the ceiling. Wheel arches occupy
x = −0.50…0.50 m, |z| ≥ 0.665 m, up to 1.03 m.

## 3. Layout (rear to front)

| Zone | x range (m) | Contents |
|---|---|---|
| Garage + bed | −1.52 … −0.15 | Transverse bed platform at 1.50 m (0.77 m garage, 0.93 m sitting headroom). Garage: 2 × 300 Ah LiFePO4, BMS, MPPT, 2 × DC-DC, inverter, DC & AC panels (driver side); outdoor-kitchen drawer and bins (centre); 120 L fresh tank between the arches; Truma Combi D 6 E, pump, accumulator, filter, manifold and the stowed drawer toilet (passenger side). Driver-side slide-out bed pod above the electrical bay. |
| Wet bath / tower | −0.15 … 0.65 | Passenger: enclosed 0.75 × 0.755 m wet bath with moulded arch seat, bi-fold door and its own roof fan. Driver: 0.40 m pantry tower over the arch (cleaning closet, convection microwave, pantry, control centre). Aisle 0.53 m. |
| Galley / wardrobe | 0.65 … 2.10 | Driver: 1.45 m galley (130 L fridge/freezer, 4 drawers under a 2-zone induction cooktop, sink with trash/recycling pull-out, prep board, overhead cabinets and ducted hood). Passenger: wardrobe with hidden laundry, extinguisher and emergency shut-off. Aisle 0.61 m. |
| Entry / dinette | 2.10 … 2.75 | Sliding-door zone kept clear; swing-arm table on the galley end; fresh-air inlet in the ceiling. |
| Cab | 2.75 … | Swivel driver and passenger seats (dining/working seats when parked). |

The acceptance suite checks this geometry: no overlapping solids, everything inside the
envelope, arches respected, service zones clear, a 0.45 m egress corridor from the bed to the
sliding door, and a second exit from the bed through the rear doors (release cable at bed level).

## 4. Heating, cooling and ventilation

### Envelope

| Element | Area m² | U W/m²K |
|---|---|---|
| Side walls (Thinsulate SM600L, thermal-break tape on ribs) | 14.5 | 1.1 |
| Roof (high roof + cab) | 8.8 | 1.0 |
| Cargo floor (25 mm XPS + ply) | 7.7 | 0.9 |
| Doors (insulated cards) | 4.7 | 1.4 |
| Cab doors, pillars, cab floor | 6.6 | 2.0 |
| Glazing (OEM single glazed) | 3.5 | 5.7 → **1.6 with insulated covers** |

Envelope UA = 57 W/K with covers on (71 W/K without). Infiltration 0.4 air changes per hour on
13.4 m³ of conditioned air.

### Heating — Truma Combi D 6 E

Room-sealed diesel burner (combustion air in and exhaust out through one concentric wall cowl),
2 / 4 / 6 kW, 220–630 mL/h, 10 L stainless boiler, 900/1,800 W electric elements, FrostControl
dump valve. Fed from the vehicle tank through a standpipe that stops at ¼ tank so heating can
never strand the van.

Design heat loss at −20 °C outside / 20 °C inside, including 55 m³/h of night ventilation:
**≈ 3.0 kW**, so the 6 kW heater has 2× margin and the 4 kW night stage covers the design case.
At −18 °C the simulation uses about 5.5 L of diesel a day.

Warm air reaches the wet bath (towel drying), the bed and aisle, the galley toe-kick and the
cab footwell/windshield through 65 mm ducts; return air enters through the louvred garage
front, which also keeps the batteries and water above freezing.

**Optional electric heat pump:** a 120 V heat-pump roof unit can replace the 12 V AC
(conceptual). It is modelled with COP ≈ 2 + 0.06·T and is unusable below −5 °C; the diesel
heater stays the primary heat source.

### Cooling — Dometic RTX 2000 (12 V)

1,700–2,000 W cooling from 19–58 A at 12 V (≈ 245–742 W), 308 mm tall, 32 kg, runs directly
from the battery with no inverter and no engine idling. A ceiling distribution box returns air
through a filter and supplies a concealed 300 × 65 mm duct with slot diffusers at the wet-bath
door, galley and dinette, plus a bed louvre. Condensate drains onto the roof gutter.

Design cooling load at 38 °C, full sun, 26 °C inside, covers on, two people: **≈ 1.8 kW**
(AC 1.84 kW at that ambient). A variable-speed COP of 2.6–3.1 is modelled, and quiet night
mode caps the compressor at 55 %.

**Limitation (shown in the model):** daytime AC at 38 °C uses ≈ 7 kWh/day. With ≈ 5 kWh/day of
solar the battery reaches the 20 % load-shed point in about a day. Night-only AC (≈ 2–3 kWh),
shade, a 1–2 h drive (≈ 1.4 kW of alternator charging) or shore power make it sustainable.

### Ventilation and air quality

- Filtered fresh-air inlet (MERV-13, 12 V EC fan, 50–80 m³/h) under the roof fairing.
- Main roof fan (MaxxFan Deluxe, 1–5 A) for whole-van exhaust; it has a rain cover, so it
  can run in heavy rain.
- Wet-bath roof fan extracts shower steam at source; a door louvre supplies make-up air.
- Ducted 12 V range hood (≈ 200 m³/h boost) to a roof vent ≥ 1 m from the inlet.
- Toilet micro-fan vented to the roof.
- Automatic CO₂ / RH control (Cerbo GX relays).

Night with two sleepers and the van sealed: inlet fan + bath fan on low ≈ 55 m³/h →
**steady CO₂ ≈ 925 ppm**. The time-step model keeps occupied CO₂ below ≈ 1,130 ppm in every
scenario. Exhausts are kept ≥ 1 m from the inlet, and the combustion cowl is ≥ 0.3 m from
every opening and outside the 270° rear-door sweep.

## 5. Kitchen

- 2-zone front/back induction (0.30 × 0.52 m, 1.8 kW max on a dedicated 20 A circuit). No
  flame and no combustion products; ≈ 85 % efficient; usable indoors in any weather with the
  hood on.
- 130 L dual-drawer 12 V compressor fridge/freezer (≈ 430 Wh/day at 25 °C, ≈ 650 Wh/day hot).
- 0.7 cu ft convection microwave (1.5 kW) in the tower.
- Sink with a fitted cutting-board cover, pull-down mixer and a separately filtered drinking tap.
- 12 mm compact-laminate worktop (heat resistant to 180 °C) with a stainless backsplash; the
  hood is 0.55 m above the cooktop; a fire blanket sits within 1 m of the cooktop, and an
  extinguisher sits beside the main exit.
- **Load manager:** microwave on → cooktop limited to 600 W; kettle on the outlets → cooktop
  limited to 1.2 kW and microwave locked out. This keeps the AC bus within the 2.4 kW inverter
  rating.
- Pull-out outdoor kitchen through the rear doors: 0.66 × 0.70 m worktop on 227 kg locking
  slides, flip-out wing, plug-in induction plate and GFCI outlet. It is interlocked to the rear
  doors being latched at 270°.

## 6. Water, shower and toilet

| Item | Value |
|---|---|
| Fresh tank | 120 L, inside the heated garage between the arches, gravity fill hidden in the rear door jamb |
| Hot water | 10 L Combi boiler at ≤ 60 °C, thermostatic 40 °C shower mixer |
| Grey tank | 95 L under the floor, 25 mm foam jacket, 60 W thermostatic heat pad, heated dump valve |
| Pump | Shurflo Aqua King II 3.0 GPM, 55 psi, 6.5 A, accumulator, sediment + carbon filter |
| Toilet | Compact urine-diverting dry toilet on a 227 kg slide: stowed dry in the garage, pulled through a gasketed hatch into the shower when needed (6 L urine bottle, ~30 solids uses) |
| Sensing | 5 leak probes (pump lock-out via Cerbo relay), capacitive fresh gauge, ultrasonic grey gauge |
| Outdoor shower | Hot/cold quick-connect in the passenger rear jamb |

Two people, showers every other day: ≈ 39 L/day, so fresh water lasts ≈ 3.2 days. The grey
tank is 79 % of fresh capacity and fills in ≈ 2.8 days. Drains fall continuously to the grey
tank, and waterless traps hold no water to freeze. Winterising: drain at the low points, blow
out through the bypass at the manifold, and the FrostControl valve dumps the boiler.

## 7. Electrical system

| Item | Choice |
|---|---|
| Battery | 2 × 12.8 V 300 Ah LiFePO4 in parallel = 600 Ah / 7.68 kWh (6.9 kWh to the 10 % BMS cut-off; GX load-shedding at 20 %) |
| BMS & isolation | Victron Lynx Smart BMS 500 A contactor + Lynx distributor; 400 A Class-T fuse and manual battery switch; emergency stop at the sliding door |
| Inverter/charger | Victron MultiPlus-II 12/3000/120: 2,400 W continuous (25 °C), 5,500 W surge, 120 A charger, PowerAssist |
| Solar | 3 × 340 W panels in parallel (1,020 Wp) → SmartSolar MPPT 150/70; cold Voc 46 V |
| Alternator | 2 × Orion XS 12/12-50A (100 A ≈ 1.4 kW), 1/0 AWG feed, needs the heavy-duty alternator option |
| Shore | Concealed 30 A 120 V inlet, adjustable input current limit |
| Distribution | 16-way DC fuse panel; 120 V panel with 30 A main and GFCI on wet-area outlets |

**Protection and conductors.** Every circuit is checked: protection ≥ design current and ≤
conductor ampacity (ABYC E-11, 105 °C, bundled ×0.7; NEC for 120 V). Voltage drop is ≤ 3 % on
critical circuits (AC compressor 1.9 %, inverter 0.6 %, fridge 1.3 %) and ≤ 10 % elsewhere.
Worst-case DC current (inverter at full continuous output + AC at max + all 12 V branches) is
359 A against the 400 A limit of the fuse and battery.

**Daily energy (5-day mild scenario, two remote workers):** cooking 1.6 kWh, devices and
internet 1.3 kWh, HVAC 0.6 kWh, fridge 0.36 kWh, ventilation 0.29 kWh, standby and losses
0.46 kWh: ≈ 4.6 kWh/day against ≈ 3.6 kWh/day of solar.

## 8. Storage, comfort and safety

Clothing: wardrobe and two over-bed cabinets. Food: fridge, pantry tower, drawers. Cookware:
deep drawers. Trash and recycling: twin pull-out. Hidden laundry: hamper and wash bag in the
wardrobe base, drying line in the wet bath. Cleaning: closet with a cordless vacuum in the tower.
Push-button travel latches and gas struts on every cabinet. Lighting: dimmable 2,700 K pucks,
cove and under-cabinet strips, adjustable gooseneck reading lights, all ≈ 30 W at full
brightness. USB-C PD at the bed, galley and desk. Satellite internet and a 5G router.

Safety: three ABC extinguishers (galley/door, bed, cab), fire blanket, smoke + CO alarm in
the aisle and a second CO alarm at the bed, emergency power shut-off, room-sealed combustion
only (no LPG), two exits from the bed, and occupants travel only in OEM belted seats.

## 9. Stealth exterior and expansions

Retracted, the van shows only OEM glazing, a low-profile roof rack with solar and a fairing
(the RTX 2000 is the tallest item at 3.04 m overall height), a small heater cowl above the
passenger rear wheel, and a body-colour shore flap. Water fill, outdoor shower and outdoor
kitchen are only visible with the rear doors open. A ladder on the driver rear door completes
the tradesman look.

| Expansion | Mechanism | Clearance / interlock |
|---|---|---|
| Slide-out bed pod (conceptual, needs licensed engineering) | 1.20 × 0.45 × 0.65 m box, 250 mm stroke, 2 × 1,500 N actuators, telescoping rails, bulb + wiper seals, drip rail, 4 compression latches, fold-down strut | Bed 1.83 → 2.08 m. Outer face 40 mm beyond the mirror line, so parked-only (ignition + brake interlock). The driver rear door stops at its 180° detent while the pod is out, because at 270° it would hit the pod. |
| Awning | 3.4 m roof-edge cassette, 2.5 m projection, 2 articulating arms, 2 telescoping legs | 2.25 m headroom at the front bar; clears the sliding-door travel |
| Outdoor kitchen | Locking full-extension slides, flip-out wing, legs | 0.70 m extension, worktop 1.00 m above ground, tray 120 mm above the bumper |
| Rear-door table / bench | Piano hinge + folding brace / hinge + drop legs on the door cards | Usable with the doors at 270° (table) and 180° or 270° (bench) |

## 10. Simulation model

`src/sim/model.js` integrates the van state every 60 s:

- **Heat:** single-node cabin (C = 220 kJ/K, ≈ 1 h time constant) with conduction (UA per
  element, covers and pod aware), air exchange (infiltration + fans + open doors), solar
  (sol-air on opaque surfaces, SHGC on glazing), people (60–95 W), and equipment and cooking
  (cooking heat partly captured by the hood). Heater and AC use thermostats with hysteresis,
  real capacity limits, COP vs outdoor temperature, quiet night mode, away setback and
  pre-conditioning before people return.
- **Moisture & CO₂:** humidity-ratio balance with people, cooking and shower sources, hood/fan
  capture, ventilation, hygroscopic buffering and AC condensation (coil saturation); CO₂ mass
  balance; dew point vs glass temperature for condensation warnings.
- **Electricity:** every load at its level or thermostat-driven value; AC bus via the inverter
  (efficiency, idle and search mode, PowerAssist on shore); solar from irradiance with
  temperature derate and MPPT limit; alternator while driving; LiFePO4 voltage curve; BMS
  load-shed and cut-off.
- **Water & fuel:** activity draws, hot fraction mixing in the boiler with diesel/electric
  reheat, grey inflow, urine and solids accrual, heater diesel from the standpipe and driving
  fuel.

Scenarios (`src/data/scenarios.js`) supply daily temperature, humidity and irradiance curves.
A two-person daily routine drives occupancy, cooking, showers, work and sleep. The same routine
animates the occupant in Daily-living mode.

### Infrared camera model (visual estimate)

The Infrared view (`src/scene/infrared.js`) turns the live snapshot into steady-state surface
temperatures. It is an estimate for explanation, not a measured image:

- **Outside skin:** outdoor air + U·(T_in − T_out)/h_o (h_o = 20 W/m²K), plus sol-air heating
  α·I/h_o on sun-facing surfaces (α = 0.3 for white paint) and night-sky cooling on
  upward-facing surfaces (up to ≈ 4.5 K on a clear night). Glass uses U = 5.8 W/m²K (1.6 with
  the insulated covers), the cab metal 2.0, insulated walls 1.1.
- **Inside surfaces:** cabin air − U·(T_in − T_out)/h_i (h_i = 8 W/m²K), with vertical
  stratification of 0.5–1.8 K/m depending on whether the heater or AC is running.
- **Equipment:** boiler, heater outlet and exhaust cowl, induction zones and cookware,
  microwave, fridge, batteries (current-dependent), inverter (load-dependent), MPPT and DC-DC
  chargers, AC condenser and cold supply duct, water tanks and the heated grey tank.
- Apparent temperature drifts toward the reflected sky temperature at grazing angles (lower
  emissivity), as a real thermal camera shows on glass and gloss paint.

### Drive model (visual demonstration)

`src/scene/drive.js` runs the van on the dynamic handling model in `src/sim/vehicle.js` (below) with
longitudinal dynamics sized from the van itself:

- **Mass:** the laden mass from the weight model (≈ 3,770 kg).
- **Drive:** 125 kW at the wheels (2.0 L diesel), 9.8 kN first-gear limit, rear-wheel drive
  with ≈ 62 % of the weight on the driven axle, so traction is μ · m · g · 0.62.
- **Resistance:** rolling resistance by surface (track 0.016, grass 0.045, sand 0.07, mud
  0.06, snow 0.035, ice 0.012) plus aero drag with Cd·A = 0.37 × 4.6 m² and the grade force.
- **Grip:** the peak friction coefficient μ of the surface under the front axle (`SURFACES` in
  `land.js`): dry tarmac 1.05, county road and street 1.0, wet paved roads ×0.78 (≈ 0.82), rock 0.9,
  gravel 0.72, grass 0.70, two-track 0.68, forest floor and dry clay 0.62, shallow water 0.55,
  snowy highway 0.5, mud 0.45, packed snow 0.36, snow 0.3, lake ice 0.12. Climbing a grade steeper than
  the grip allows causes wheelspin. The van refuses water deeper than about 0.6 m.
- **Energy:** while the engine runs, the simulation charges the house bank from the two
  50 A DC-DC chargers and burns fuel at 0.9 L/h idle plus a speed term (≈ 12 L/100 km at
  70–100 km/h). Because settlements in the drive world are about 2 km apart instead of about
  60 km, the drive-mode fuel burn is scaled ×14 (`ctrl.driveFuelScale`) so that a tank lasts
  roughly half an hour of highway driving and refuelling at a pump is part of the game.
- **Driver aids** (`ASSISTS`): *Easy* adds lane keeping (heading, lane-offset and a 1.3 s
  curvature preview converted to a road-wheel angle through the inverse steady-state response),
  ABS, traction control, stability control (a corrective yaw moment), the roll-over guard, soft pedal
  ramps and a curve-speed advisory: it scans the next 170 m of road and eases off so that the tightest
  bend (a = 0.3·μ·g) can be reached braking at 0.22·μ·g; *Standard* has ABS, partial traction and
  stability control, a light roll-over guard and a steering lock that lets a hard swerve at motorway speed
  roll the van; *Pro* has none of them (locking brakes, a handbrake that locks the rear wheels).
  Cruise control is a PI loop with light braking on long descents; the limiter holds the
  posted limit (interstate 80 mph, highway 65, county 55, gravel 35, track 20, streets 25).
- **Powertrain** (`src/sim/powertrain.js`): a drive-mode tune of 225 kW at the wheels (the stock
  2.0 L makes about 125 kW there) and 15.5 kN of traction-limited force in first gear: constant
  force up to 52 km/h, constant power beyond. The 9-speed automatic cuts the torque to 30 % for
  0.28 s on each upshift. Flat-road full-throttle: 0–50 km/h in 4.0 s, 0–100 in 9.8 s, governed
  137 km/h after about 18 s (the stock engine needed 16.3 s to 100 km/h).
- **Collisions** (`src/sim/crash.js`): the van is a rounded box of twelve circles (six rows, two
  columns) against axis-aligned building footprints, tree and boulder circles, roadside poles and
  props, traffic footprints and animals. Each contact is an impulse
  j = −(1 + e)·vₙ / (1/mₐ + 1/m_b + (rₐ×n)²/Iₐ + (r_b×n)²/I_b) at the contact point, followed by Coulomb
  friction along the surface, so an off-centre hit also gives yaw. The model tracks the rear axle
  but resolves impacts about the centre of mass (1.73 m ahead). The impact leaves the van with a new
  speed, sideways speed and yaw rate and the handling model takes over: the body turns under its
  momentum and the tyres pull the slide out (or not, on ice). A hard shove from the side also gives the
  roof a roll impulse (`kickRoll`).
  Absorbed energy ½(1 − e²)vₙ²/(…) becomes zone damage (520 kJ wrecks a zone; a 50 km/h wall hit is
  ≈ 360 kJ). Front damage ≥ 0.25 starts to cost power (up to −65 %), ≥ 0.97 stops the engine;
  front-corner hits bend the steering (up to 0.07 rad of pull); side damage adds rolling resistance;
  repair cost is $1,100 / $650 / $800 / $800 per full front / rear / left / right zone. Surfaces add
  shake: 0.75 m corrugations on gravel, ruts on tracks, tussocks on grass.
- **Handling model** (`src/sim/vehicle.js`, pure, ~300 lines, `tests/vehicle.test.js`): a dynamic
  single-track ("bicycle") model with forward speed, sideways speed and yaw rate of the centre of mass,
  advanced at 100–200 Hz.
  - *Chassis:* 3,770 kg, wheelbase 4.325 m, centre of mass 1.73 m ahead of the rear axle (this build is
    rear-heavy: 40 % of the weight on the front axle) and 1.18 m high (roof boxes and a full fridge),
    track 1.72 m, yaw inertia 3.3·m (radius of gyration 1.8 m).
  - *Tyres:* one brush-model tyre per axle: lateral force F = μFz(3z − 3z² + z³) with
    z = Cα·tan α / (3μFz), falling to 0.9 of the peak when sliding, sharing the friction circle with
    braking and driving. Cornering stiffness is 12 (front) and 15 (rear) per unit static axle load, so
    the van understeers (gradient 0.0017 rad per m/s², about 0.1° per 0.1 g), and the front also gives up
    first when braking and steering together (front friction factor 0.94, brake-force distribution that
    keeps the rear below the front). Soft surfaces change the stiffness, slide share and "dig": soil
    piling up against a tyre ploughing sideways at over 1.5 m/s adds up to 60 % more lateral force,
    which is what trips a van that slides on grass or sand.
  - *Load transfer:* longitudinal from the measured acceleration (axle loads, braking and traction
    limits), lateral as λ = (m·ay·h + roll moment)/(m·g·t/2); the grip falls by 12 %·λ² as the inner
    wheels unload. The sprung mass rolls on 260 kN·m/rad springs and 19 kN·m·s/rad dampers up to a bump
    stop (about 4° at 0.7 g).
  - *Tipping:* a rigid van starts to tip at ay = g·(t/2)/h = 7.15 m/s² (0.73 g). Once λ ≥ 1 the inner
    wheels leave the ground and the van rotates about its outer wheels; it falls back if the lateral
    force lets go in time and rolls onto its side past atan((t/2)/h) = 36°. That takes either a long
    enough hard turn, a quick left-right sequence that rocks it, or a sideways slide that digs in.
  - *Steering lock* (`steerLock`): the wheels turn at up to 1.7 rad/s and the lock is 0.5 rad at parking
    speeds, then narrows so that full stick asks for a fixed share of the tipping acceleration:
    0.8·7.15 m/s² (0.58 g) up to 61 km/h and, opening up between 61 and 100 km/h, a cap of 0.85 (Easy,
    never tips), 1.4 (Standard) or 2.2 (Pro) times it. So full stick at 108 km/h is 0.04 / 0.065 / 0.10 rad (Easy / Standard / Pro).
    Keyboard steering ramps in at 2.4/s and back at 5.5/s.
  - *Aids:* ABS (the slip held at 0.93 of the peak, less when also cornering), traction control,
    stability control (a yaw moment against the difference between steered and actual yaw rate) and the
    roll-over guard (brakes and cuts torque as the inner wheels unload). Without ABS the tyres lock
    (friction at 0.9 of the sliding value).
  - *Measured:* 100 km/h to a stop in 43 m on dry tarmac with ABS (47 m locked), 55 m wet, 61 m on
    gravel, 131 m on snow; steady turns to 0.7 g without sliding; holding full lock for 1.5 s or more
    at over 100 km/h with Standard (or over 90 km/h with Pro), or a 1.2 s left-right zig-zag at 108 km/h
    with Pro, rolls the van; Easy never does. On wet tarmac, snow and ice the grip goes first and the
    van slides instead.
- **Traffic collisions**: AI vehicles on their lane follow the road polyline; one that is hit
  with a closing speed over 4.5 m/s, a sideways shove over 2.4 m/s, or a spin over 0.45 rad/s
  (or that is badly damaged) becomes a free body that slides under anisotropic tyre friction (grip
  across, 4 m/s² drag along) to a stop. Two path followers never collide with each other (the driving logic
  keeps them apart; overlaps are counted as *ghosts* in `Traffic.stats`). Wrecks publish their place
  on the road (`obs`) so the others brake, pass or queue; they are removed 75 s later when out of view.

### World generation (drive demonstration)

`src/world/` is pure and deterministic from the seed (`new World(7)`). Settlement nodes sit on
a 2.2 km grid with ±550 m jitter and a kind chosen from the region; each node flattens a
plateau. Roads between neighbouring nodes are routed on a 26 m grid by A* (cost grows with
slope², lakes and other towns blocked), smoothed with Chaikin, **relaxed with a Gaussian of
σ = 95 / 62 / 34 / 18 / 8 m for interstate / highway / county / gravel / track** (rejected for a
lighter pass if it would enter a lake or another town), resampled at 8 m and given a smoothed
height profile with class grade limits (5.5 %, 7 %, 8.5 %, 11 %, 15 %) blended into the plateaus.
`heightAt` composes base terrain, lakes, plateaus and road cut-and-fill; `roadAt` is a 64 m
spatial hash. Seasons never touch this: the renderer applies a shared uniform "skin" only.

GPS (`src/world/route.js`) runs A* over the settlement graph with planning speeds per class,
joins the van to the nearest built road edge, and turns the node path into a polyline with
manoeuvres (through a settlement: port → centre → port). `src/world/poi.js` places up to three
roadside discoveries per road edge by hashing the edge id.

## 11. Acceptance tests

`npm test` runs 207 node tests (the acceptance suite plus world generation, town layout, routing, discovery, drive/crash physics and traffic tests). Of the 76 engineering checks, 73 pass, 3 warn and 0 fail. They
cover component data, geometry (clashes, envelope, arches, service clearances, aisles, egress,
ground clearance), moving assemblies and expansion clearances, weight and axle loads, electrical
protection, voltage drop, peak current, inverter loading and PV limits, heating/cooling
capacity, CO₂, exhaust separation, freeze protection, water autonomy, drain fall, water/electrics
separation, safety equipment, stealth, and all six four-season simulations.

The three warnings are deliberate, honest limits: the pod is parked-only, back-to-back showers
need a short reheat, and daytime AC in extreme heat needs charging every day.

## 12. Assumptions and sign-off

- Interior finishes, the axle split and weather curves are assumptions (labelled in the viewer).
- Equipment marked **typical** uses class-typical dimensions or figures: confirm with the
  chosen model before cutting.
- **Conceptual:** slide-out pod, outdoor kitchen, rear-door table and bench. Each needs
  prototypes and load tests.
- **Licensed sign-off:** body cut-outs and the pod frame (structural engineer, following the
  Mercedes-Benz body-builder guidelines); diesel heater, standpipe and cowl (certified
  installer); 120 V AC, the inverter's ground/neutral bonding and the shore inlet (qualified
  electrician, NFPA 1192 / NEC). DC work follows ABYC E-11.
- Roadworthiness: the conversion stays within GVWR and both GAWRs with the stated loadout. The
  pod must be retracted and latched to drive. Overall height rises to 3.04 m; check clearances.

## Sources

- Sprinter load dimensions (L3/H2: 1,787 mm load width, 1,350 mm between arches, 4,300–4,410 mm length): <https://www.vansdirect.co.uk/load-sizing-guide/mercedes-benz-sprinter-dimensions/>
- 2025 Sprinter 2500 HR 170 dealer specifications (length, height, interior height, load floor, GVWR): <https://www.comvoy.com/work-van/little-silver-nj/new-2025-mercedes-benz-sprinter-2500-high-roof-empty-cargo-van-18036049>, <https://www.kbb.com/mercedes-benz/sprinter-2500-cargo/2025/high-roof-w-170-wb>
- GAWR, curb weight and payload: <https://www.germaincars.com/inventory/new-2025-mercedes-benz-sprinter-2500-cargo-170-wb-rwd-3d-cargo-van-w1y4nchy0st213767/>
- Truma Combi D 6 E: <https://www.justkampers.com/33516-78-truma-d6e-combi-heater-diesel-or-electric.html>, <https://www.berger-camping.com/item/truma-combi-d-425395>
- Dometic RTX 2000 12 V: <https://www.dometic.com/en/professional/product/dometic-coolair-rtx-2000-12v-9620001310>, <https://www.campervan-hq.com/collections/dometic/products/dometic-rtx2000-12v-rv-air-conditioner-6800-btu>
- Victron MultiPlus-II 12/3000/120: <https://www.mygenerator.com.au/victron-multiplus-ii-inverter-charger-12-3000-120-32>
- Victron Orion XS 12/12-50A: <https://www.currentconnected.com/product/victron-orion-xs-12v-12v-50a-battery-charger/>
- MaxxAir MaxxFan Deluxe 7500K: <https://vancafe.com/maxxair-7500k-fan>
- Isotherm Drawer 130: <https://defender.com/en_us/isotherm-drawer-130-inox-refrigerator-freezer-d130dngia71113aa>
- Shurflo Aqua King II 3.0: <https://nomadicsupply.com/shurflo-aqua-king-ii-12v-3gpm-fresh-water-pump/>
- Composting-toilet fan current and urine capacity (reference for the dry toilet): <https://natureshead.net/>
- Eberspächer Airtronic D2 (alternative heater considered): <https://www.caravansplus.com.au/eberspacher-d2l-airtronic-s3-2-2kw-diesel-air-heater-kit-12v-single-outlet-p-19069.html>
