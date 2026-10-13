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
npm test              # 85 engineering acceptance tests (node --test)
npm run report        # regenerate docs/ACCEPTANCE-REPORT.md
npm run build         # static site in dist/
npm run build:single  # one self-contained HTML file: dist/stealth-sprinter.html
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
src/sim/       thermal, coupled time-step model, weight, cost, space, acceptance suite
src/scene/     three.js body, interior builders, routed services, flows, overlays, modes
src/ui/        app controller, dashboards, charts
tests/         node --test acceptance tests
scripts/       report generator, single-file build
```

All geometry is procedural: there are no external models, textures or images.
