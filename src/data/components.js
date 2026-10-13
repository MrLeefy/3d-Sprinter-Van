// Component catalogue — the single source of truth for geometry, mass, cost and
// engineering metadata. Every box is an axis-aligned envelope in world metres
// (see vehicle.js for the frame) in the STOWED / TRAVEL position.
//
// Flags
//   placement   interior | roof | underbody | through-wall | through-roof | cab | exterior
//   parent      id of a container this item lives inside (overlap allowed)
//   mountedIn   id of a surface the item is cut into (overlap allowed)
//   hollow      container — children may sit inside it
//   wrapsArch   carcass is notched / moulded around the wheel arch
//   followsWall back face is chamfered to follow the upper-wall tumble-home
//   solid:false not part of the clash test (linings, lights, flexible items)
//   status      verified | typical | assumption | conceptual
//   cert        engineering | certified | electrician  (needs licensed sign-off)

const B = (x0, x1, y0, y1, z0, z1) => ({ x: [x0, x1], y: [y0, y1], z: [z0, z1] });

export const SYSTEMS = {
  climate: { name: 'Heating & cooling', color: '#e8590c' },
  ventilation: { name: 'Ventilation & air quality', color: '#20c997' },
  kitchen: { name: 'Kitchen & cooking', color: '#f59f00' },
  water: { name: 'Water & sanitation', color: '#1c7ed6' },
  electrical: { name: 'Electrical & off-grid power', color: '#fab005' },
  living: { name: 'Living, sleeping & storage', color: '#a9744f' },
  mechanical: { name: 'Mechanisms & expansions', color: '#7950f2' },
  safety: { name: 'Safety & egress', color: '#e03131' },
  envelope: { name: 'Insulation & envelope', color: '#ff8787' },
  vehicle: { name: 'Base vehicle (OEM)', color: '#868e96' },
};

export const STATUS = {
  verified: 'Published manufacturer / dealer specification',
  typical: 'Typical value for this product class — confirm with chosen model',
  assumption: 'Engineering assumption for this concept',
  conceptual: 'Custom / conceptual design — prototype & validate',
};

export const CERT = {
  engineering: 'Requires licensed engineering review (structure / body modification)',
  certified: 'Requires certified installer (fuel-fired appliance / manufacturer warranty)',
  electrician: 'Requires qualified electrician (120 V AC, shore power, NFPA 1192 / RVIA)',
};

export const COMPONENTS = [
  // ───────────────────────────── REAR: BED & GARAGE ─────────────────────────────
  {
    id: 'bed-platform', name: 'Bed platform & garage frame', system: 'living', zone: 'bed', placement: 'interior',
    box: B(-1.52, -0.15, 1.5, 1.54, -0.56, 0.855), mass: 22, cost: 650, status: 'assumption',
    spec: 'Aluminium 80/20-style frame bolted to factory D-rings, 12 mm poplar-ply deck with 3 lift-out service hatches',
    principle: 'Transverse fixed bed creates a 0.77 m tall insulated "garage" underneath for tanks, heater, batteries and gear.',
    service: 'Lift-out deck hatches give top access to the heater, water module and fresh tank inspection port.',
    access: 'Rear doors (garage), garage front hatch (aisle), deck hatches under mattress',
    depends: [],
  },
  {
    id: 'mattress', name: 'Mattress (convertible lounge)', system: 'living', zone: 'bed', placement: 'interior',
    box: B(-1.5, -0.17, 1.54, 1.69, -0.55, 0.84), mass: 20, cost: 800, status: 'assumption',
    spec: '150 mm latex/HR foam, 1.33 × 1.39 m main + 0.42 m pod section; front 0.62 m section hinges up as a lounge backrest',
    principle: 'Front mattress section is mounted on a hinged board with gas struts; raised, it forms a backrest so the bed becomes a day sofa.',
    service: 'Removable washable covers; ventilated slat deck prevents condensation under the mattress.',
    access: 'Direct', depends: ['bed-platform'], solid: false,
  },
  {
    id: 'slideout-pod', name: 'Slide-out bed extension pod', system: 'mechanical', zone: 'bed', placement: 'through-wall',
    box: B(-1.45, -0.25, 1.5, 2.15, -1.005, -0.56), mass: 65, cost: 6500, status: 'conceptual', cert: 'engineering',
    spec: '1.20 × 0.45 × 0.65 m GRP/aluminium box, 250 mm stroke, 2 × 12 V linear actuators (1500 N), 2 telescoping rails, double bulb + wiper seals, 4 compression latches',
    principle: 'Retracted, the pod outer skin sits flush with the body side and its mattress strip extends the bed to 1.83 m. Deployed 250 mm, the bed becomes 2.08 m long for tall sleepers.',
    service: 'Inspect seals every 3 months, clean & lubricate rails, check actuator end-stops and latch preload annually.',
    access: 'From bed (interior) and exterior', depends: ['bed-platform', 'dc-panel'],
    notes: 'Requires a reinforced ring frame bonded/riveted between the rear quarter pillars; parked-only (ignition interlock).',
  },
  {
    id: 'oh-bed-pass', name: 'Over-bed cabinet (passenger)', system: 'living', zone: 'bed', placement: 'interior', followsWall: true,
    box: B(-1.45, -0.2, 2.2, 2.6, 0.45, 0.74), mass: 12, cost: 500, status: 'assumption',
    spec: '3 lift-up doors, gas struts, push-button travel latches', principle: 'Clothing and bedding storage.',
    service: 'Check latch engagement before driving.', access: 'From bed', depends: [],
  },
  {
    id: 'oh-bed-drv', name: 'Over-bed cabinet (driver)', system: 'living', zone: 'bed', placement: 'interior', followsWall: true,
    box: B(-1.45, -0.25, 2.22, 2.6, -0.74, -0.45), mass: 10, cost: 450, status: 'assumption',
    spec: '2 lift-up doors above the pod, push-button latches', principle: 'Clothing and electronics storage above the pod.',
    service: 'Check latch engagement before driving.', access: 'From bed', depends: [],
  },
  {
    id: 'bed-step', name: 'Fold-down bed step', system: 'living', zone: 'bed', placement: 'interior',
    box: B(-0.15, -0.125, 0.95, 1.25, -0.4, 0.0), mass: 2, cost: 90, status: 'assumption',
    spec: 'Hinged hardwood step, 140 kg rated, magnetic catch', principle: 'Halves the 0.96 m climb to the mattress.',
    service: 'Check hinge screws.', access: 'Aisle', depends: ['bed-platform'],
  },
  {
    id: 'fresh-tank', name: 'Fresh-water tank 120 L', system: 'water', zone: 'garage', placement: 'interior',
    box: B(-0.76, -0.18, 0.735, 0.985, -0.62, 0.26), mass: 11, cost: 420, status: 'assumption',
    spec: 'Baffled food-grade HDPE, 0.58 × 0.88 × 0.25 m outer, 120 L (31.7 gal) usable ≈ 115 L; capacitive level sensor; 150 mm inspection port',
    principle: 'Stored inside the heated envelope between the wheel arches, low and just behind the rear axle for weight distribution and freeze protection.',
    service: 'Sanitise every 6 months (chlorine shock); inspection port under the garage bins; low-point drain valve.',
    access: 'Garage front hatch; bins lift out for inspection port', depends: ['fill-inlet'], capacityL: 120,
  },
  {
    id: 'garage-bins-front', name: 'Garage storage bins (front)', system: 'living', zone: 'garage', placement: 'interior', removable: true,
    box: B(-0.76, -0.18, 1.0, 1.4, -0.62, 0.26), mass: 4, cost: 120, status: 'assumption',
    spec: 'Lift-out bins: levelling blocks, hoses, tools, recovery gear', principle: 'Heavy gear stored low and central.',
    service: 'Lift out for tank inspection.', access: 'Garage front hatch', depends: [],
  },
  {
    id: 'garage-bins-rear', name: 'Garage storage bins (rear)', system: 'living', zone: 'garage', placement: 'interior', removable: true,
    box: B(-1.5, -0.8, 1.03, 1.4, -0.3, 0.36), mass: 4, cost: 120, status: 'assumption',
    spec: 'Lift-out bins above the outdoor kitchen: camp chairs, clothing overflow', principle: 'Accessible through the rear doors.',
    service: '—', access: 'Rear doors', depends: [],
  },
  {
    id: 'outdoor-kitchen', name: 'Pull-out outdoor kitchen', system: 'kitchen', zone: 'garage', placement: 'interior',
    box: B(-1.5, -0.8, 0.74, 1.0, -0.3, 0.36), mass: 25, cost: 1200, status: 'conceptual',
    spec: '0.66 × 0.70 m worktop on 227 kg-rated locking full-extension slides, flip-out side wing, plug-in 1.8 kW induction hob, GFCI outlet',
    principle: 'With the rear doors latched open, the tray slides 0.70 m out behind the van so cooking outside never blocks the indoor galley.',
    service: 'Clean and grease slides yearly; check slide lock detents.', access: 'Rear doors (open)', depends: ['inverter', 'ac-panel'],
  },
  {
    id: 'combi-heater', name: 'Diesel combi heater + water heater', system: 'climate', zone: 'garage', placement: 'interior',
    box: B(-1.13, -0.62, 0.735, 1.035, 0.39, 0.84), mass: 16.9, cost: 4500, status: 'verified', cert: 'certified',
    model: 'Truma Combi D 6 E',
    spec: 'Diesel 2/4/6 kW, electric 0.9/1.8 kW; 10 L stainless boiler; 0.51 × 0.45 × 0.30 m; 16.9 kg; 12 V 1.8–4 A; diesel 220–630 mL/h',
    principle: 'Room-sealed burner draws combustion air from outside and exhausts outside through a wall cowl. A heat exchanger warms cabin air (65 mm ducts) and the integral 10 L boiler.',
    service: 'Annual burner service by certified dealer; check cowl & ducts; FrostControl dump valve test before winter.',
    access: 'Deck hatch above (service void kept clear) + rear doors', depends: ['combi-cowl', 'heater-fuel-pump', 'dc-panel', 'water-pump'],
    serviceClearance: B(-1.11, -0.64, 1.04, 1.46, 0.4, 0.83),
  },
  {
    id: 'combi-cowl', name: 'Heater wall cowl (exhaust / air intake)', system: 'climate', zone: 'garage', placement: 'through-wall',
    box: B(-0.42, -0.28, 1.12, 1.24, 0.84, 1.04), mass: 0.6, cost: 0, status: 'verified', cert: 'certified',
    spec: 'Wall cowl above the passenger rear wheel arch: ≥ 0.3 m from every opening, outside the 270° rear-door sweep, > 2 m from the fresh-air inlet', principle: 'Separates combustion gases from cabin air completely.',
    service: 'Keep clear of snow and mud.', access: 'Exterior', depends: ['combi-heater'],
  },
  {
    id: 'water-pump', name: '12 V diaphragm water pump', system: 'water', zone: 'garage', placement: 'interior',
    box: B(-1.46, -1.26, 0.74, 0.88, 0.62, 0.82), mass: 1.8, cost: 160, status: 'verified',
    model: 'Shurflo Aqua King II Standard 3.0', spec: '3.0 GPM (11.4 L/min), 55 psi shut-off, 6.5 A max @ 12 V',
    principle: 'Pressure-switch controlled diaphragm pump with inlet strainer; runs only when a tap opens.',
    service: 'Clean strainer monthly; check pressure switch.', access: 'Deck hatch above', depends: ['fresh-tank', 'dc-panel'],
    serviceClearance: B(-1.47, -1.15, 1.01, 1.46, 0.41, 0.83),
  },
  {
    id: 'accumulator', name: 'Accumulator tank', system: 'water', zone: 'garage', placement: 'interior',
    box: B(-1.24, -1.16, 0.74, 0.94, 0.62, 0.78), mass: 1.2, cost: 70, status: 'typical',
    spec: '0.75 L pre-charged (20 psi)', principle: 'Smooths flow and reduces pump cycling (quieter at night).',
    service: 'Check pre-charge annually.', access: 'Deck hatch above', depends: ['water-pump'],
  },
  {
    id: 'water-filter', name: 'Sediment + carbon filter', system: 'water', zone: 'garage', placement: 'interior',
    box: B(-1.46, -1.34, 0.74, 0.98, 0.42, 0.56), mass: 1.5, cost: 90, status: 'typical',
    spec: '5 µm sediment + carbon block (whole-van)', principle: 'Protects the boiler and fixtures; improves taste.',
    service: 'Replace cartridge every 6 months.', access: 'Deck hatch above', depends: ['water-pump'],
  },
  {
    id: 'water-manifold', name: 'PEX manifold & winterising valves', system: 'water', zone: 'garage', placement: 'interior',
    box: B(-1.32, -1.15, 0.74, 0.82, 0.42, 0.58), mass: 1.2, cost: 160, status: 'assumption',
    spec: 'Hot/cold manifold with labelled shut-offs, bypass for antifreeze, blow-out fitting, low-point drain',
    principle: 'Every branch can be isolated; winterising = drain + blow out + optional antifreeze through the bypass.',
    service: 'Exercise valves seasonally.', access: 'Deck hatch above', depends: ['water-pump', 'combi-heater'],
  },
  {
    id: 'toilet', name: 'Concealed drawer toilet (urine-diverting)', system: 'water', zone: 'garage', placement: 'interior',
    box: B(-0.62, -0.18, 0.79, 1.25, 0.275, 0.655), mass: 9, cost: 750, status: 'typical',
    spec: 'Compact urine-diverting dry toilet (~0.38 × 0.44 × 0.42 m), 6 L urine bottle, ~30-use solids bin, 12 V vent fan (0.07 A); on a 227 kg-rated full-extension slide',
    principle: 'Stowed dry in the garage. Inside the shower you lift a gasketed hatch in the rear wall and slide the toilet 0.40 m into the stall — shower and toilet never share the same footprint.',
    service: 'Empty urine every ~2 days, solids every ~10–14 days (bagged); clean slides; check hatch gasket.',
    access: 'From inside the wet bath (rear hatch)', depends: ['toilet-vent', 'dc-panel'],
  },
  // ───────────────────────────── ELECTRICAL BAY ─────────────────────────────
  {
    id: 'battery-a', name: 'LiFePO4 house battery A', system: 'electrical', zone: 'garage', placement: 'interior',
    box: B(-1.46, -0.94, 0.735, 0.955, -0.84, -0.6), mass: 27, cost: 1200, status: 'typical',
    spec: '12.8 V 300 Ah (3.84 kWh), internal cell protection, low-temp charge cut-off, 200 A continuous',
    principle: 'Lithium-iron-phosphate: no off-gassing, 4000+ cycles, can be discharged to 10 %. Two modules in parallel = 600 Ah / 7.68 kWh.',
    service: 'Torque-check terminals annually; keep above 0 °C for charging (heated garage).',
    access: 'Rear doors', depends: ['lynx-bms'],
    serviceClearance: B(-1.52, -1.465, 0.74, 0.96, -0.84, -0.34),
  },
  {
    id: 'battery-b', name: 'LiFePO4 house battery B', system: 'electrical', zone: 'garage', placement: 'interior',
    box: B(-1.46, -0.94, 0.735, 0.955, -0.58, -0.34), mass: 27, cost: 1200, status: 'typical',
    spec: '12.8 V 300 Ah (3.84 kWh)', principle: 'Parallel bank partner of battery A (equal-length cables).',
    service: 'As battery A.', access: 'Rear doors', depends: ['lynx-bms'],
  },
  {
    id: 'main-fuse', name: 'Class-T main fuse + battery disconnect', system: 'safety', zone: 'garage', placement: 'interior',
    box: B(-0.925, -0.845, 0.75, 0.95, -0.84, -0.7), mass: 1.2, cost: 160, status: 'typical',
    spec: '400 A Class-T fuse (20 kA AIC) and 600 A manual battery switch', principle: 'Protects 4/0 AWG battery cables against a short; manual isolation for service.',
    service: 'Inspect for heat discoloration annually.', access: 'Rear doors', depends: ['battery-a', 'battery-b'],
  },
  {
    id: 'inverter', name: 'Inverter / charger', system: 'electrical', zone: 'garage', placement: 'interior',
    box: B(-0.83, -0.555, 0.75, 1.296, -0.855, -0.708), mass: 19, cost: 1500, status: 'verified', cert: 'electrician',
    model: 'Victron MultiPlus-II 12/3000/120 (120 V)',
    spec: '3000 VA, 2400 W continuous @25 °C (2200 W @40 °C), 5500 W peak, 120 A charger, 93 % max efficiency, 13 W no-load',
    principle: 'Makes 120 V AC from the battery; on shore power it passes AC through, charges at up to 120 A and can PowerAssist weak shore supplies.',
    service: 'Keep 80 mm ventilation clearance; firmware via Cerbo GX.', access: 'Garage front hatch / rear doors',
    depends: ['lynx-bms', 'main-fuse', 'ac-panel', 'shore-inlet'],
    serviceClearance: B(-0.83, -0.555, 0.75, 1.296, -0.708, -0.63),
  },
  {
    id: 'elec-backboard', name: 'Electrical backboard', system: 'electrical', zone: 'garage', placement: 'interior',
    box: B(-1.48, -0.9, 0.98, 1.44, -0.855, -0.837), mass: 3, cost: 60, status: 'assumption',
    spec: '18 mm fire-retardant ply on rivnuts', principle: 'Mounting plane for DC gear, ventilated garage bay.',
    service: '—', access: 'Rear doors', depends: [],
    serviceClearance: B(-1.47, -0.92, 1.0, 1.44, -0.737, -0.4),
  },
  {
    id: 'lynx-bms', name: 'Smart BMS / DC distributor', system: 'electrical', zone: 'garage', placement: 'interior',
    box: B(-1.47, -1.19, 1.0, 1.17, -0.837, -0.75), mass: 3, cost: 950, status: 'typical', model: 'Victron Lynx Smart BMS 500 + Lynx Distributor',
    spec: '500 A contactor, battery monitor (shunt), MEGA fuse distribution, remote on/off',
    principle: 'Supervises the cells, disconnects loads/chargers on low/high voltage or temperature, and provides the emergency-stop contactor.',
    service: 'Inspect MEGA fuses; firmware via Cerbo.', access: 'Rear doors', depends: ['battery-a', 'battery-b'],
  },
  {
    id: 'mppt', name: 'Solar charge controller', system: 'electrical', zone: 'garage', placement: 'interior',
    box: B(-1.16, -0.96, 1.0, 1.29, -0.837, -0.737), mass: 3, cost: 650, status: 'typical', model: 'Victron SmartSolar MPPT 150/70',
    spec: '150 V PV input, 70 A charge, ~98 % efficient', principle: 'Tracks the array maximum-power point and charges the bank with the correct LiFePO4 profile.',
    service: 'Check PV isolator and connections.', access: 'Rear doors', depends: ['solar-1', 'solar-2', 'solar-3', 'lynx-bms'],
  },
  {
    id: 'orion-1', name: 'DC-DC charger 1', system: 'electrical', zone: 'garage', placement: 'interior',
    box: B(-1.47, -1.33, 1.2, 1.33, -0.837, -0.78), mass: 1, cost: 300, status: 'verified', model: 'Victron Orion XS 12/12-50A',
    spec: '50 A, 98.5 % max efficiency, 700 W @40 °C, engine-run detection', principle: 'Charges the house bank from the alternator with a regulated lithium profile and protects the vehicle electrics.',
    service: 'Check input fuse at starter battery.', access: 'Rear doors', depends: ['starter-battery', 'lynx-bms'],
  },
  {
    id: 'orion-2', name: 'DC-DC charger 2', system: 'electrical', zone: 'garage', placement: 'interior',
    box: B(-1.31, -1.17, 1.2, 1.33, -0.837, -0.78), mass: 1, cost: 300, status: 'verified', model: 'Victron Orion XS 12/12-50A',
    spec: 'Paralleled with charger 1 → 100 A / ~1.4 kW total', principle: 'Second unit doubles alternator charging.',
    service: '—', access: 'Rear doors', depends: ['starter-battery', 'lynx-bms'],
  },
  {
    id: 'dc-panel', name: 'DC fuse panel', system: 'electrical', zone: 'garage', placement: 'interior',
    box: B(-1.47, -1.19, 1.35, 1.44, -0.837, -0.79), mass: 1, cost: 140, status: 'typical',
    spec: '16-way blade fuse block with negative bus, fed by 100 A MEGA fuse (4 AWG)', principle: 'Individually fused 12 V branch circuits.',
    service: 'Spare fuses clipped inside the lid.', access: 'Rear doors', depends: ['lynx-bms'],
  },
  {
    id: 'ac-panel', name: '120 V AC breaker panel', system: 'electrical', zone: 'garage', placement: 'interior',
    box: B(-1.15, -0.95, 1.31, 1.44, -0.837, -0.78), mass: 2, cost: 180, status: 'typical', cert: 'electrician',
    spec: '30 A main + 6 branch breakers, GFCI on wet-area outlets, bonded neutral handled by inverter ground relay',
    principle: 'Distributes inverter/shore AC to the cooktop, microwave and outlets.', service: 'Test GFCIs monthly.',
    access: 'Rear doors', depends: ['inverter'],
  },
  {
    id: 'shore-inlet', name: 'Concealed shore-power inlet', system: 'electrical', zone: 'garage', placement: 'through-wall',
    box: B(-0.74, -0.62, 0.8, 0.92, -1.02, -0.94), mass: 0.8, cost: 120, status: 'typical', cert: 'electrician',
    spec: '30 A 120 V inlet behind a body-colour flap styled like an OEM service flap', principle: 'Campground/house power without revealing the conversion.',
    service: 'Check flap seal.', access: 'Exterior (driver side, ahead of the rear-door sweep)', depends: ['inverter'],
  },
  {
    id: 'fill-inlet', name: 'Hidden fresh-water fill', system: 'water', zone: 'garage', placement: 'through-wall',
    box: B(-1.58, -1.52, 1.3, 1.42, 0.79, 0.87), mass: 0.4, cost: 60, status: 'assumption',
    spec: 'Lockable gravity fill + vent in the passenger-side rear door jamb (hose routed away from the electrical bay)', principle: 'Only visible with the rear doors open — no exterior water hatch.',
    service: 'Keep cap closed; sanitise with tank.', access: 'Rear doors (open)', depends: ['fresh-tank'],
  },
  {
    id: 'outdoor-shower', name: 'Outdoor shower quick-connect', system: 'water', zone: 'garage', placement: 'through-wall',
    box: B(-1.58, -1.52, 1.1, 1.22, 0.79, 0.87), mass: 0.6, cost: 140, status: 'assumption',
    spec: 'Hot/cold mixer + quick-connect in passenger-side rear jamb, 3 m hose', principle: 'Rinse off outside using the same hot water system.',
    service: 'Drain for winter.', access: 'Rear doors (open)', depends: ['water-manifold', 'combi-heater'],
  },
  // ───────────────────────────── WET BATH ─────────────────────────────
  {
    id: 'wetbath', name: 'Wet bath (enclosed shower room)', system: 'water', zone: 'wetbath', placement: 'interior', hollow: true, wrapsArch: true,
    box: B(-0.15, 0.65, 0.73, 2.62, 0.075, 0.855), mass: 43, cost: 2200, status: 'assumption', followsWall: true,
    spec: 'Interior 0.75 × 0.755 m × 1.82 m headroom; one-piece composite walls, sealed corners, bi-fold door with lip seal; moulded wheel-arch seat',
    principle: 'Fully waterproof room: walls lap into the pan upstand; the arch hump is moulded into a seat; ventilated by its own roof fan.',
    service: 'Re-seal silicone joints yearly; clean fan screen.', access: 'Aisle (bi-fold door)', depends: ['shower-pan', 'fan-bath'],
  },
  {
    id: 'shower-pan', name: 'Shower pan & drain', system: 'water', zone: 'wetbath', placement: 'interior', parent: 'wetbath', wrapsArch: true,
    box: B(-0.125, 0.625, 0.73, 0.8, 0.1, 0.855), mass: 12, cost: 650, status: 'assumption',
    spec: 'Moulded GRP pan, 50 mm upstands, 1.5 % fall to a centre drain with waterless trap (HepvO-type)', principle: 'Drains by gravity forward to the under-floor grey tank.',
    service: 'Clean hair trap weekly; leak sensor beneath.', access: 'Wet bath', depends: ['grey-tank'],
  },
  {
    id: 'shower-fixtures', name: 'Thermostatic shower mixer & handheld', system: 'water', zone: 'wetbath', placement: 'interior', parent: 'wetbath',
    box: B(-0.125, -0.095, 1.1, 2.2, 0.3, 0.5), mass: 2.5, cost: 380, status: 'typical',
    spec: 'Thermostatic mixer, 5.7 L/min (1.5 gpm) low-flow head with on/off "navy" button, slide rail', principle: 'Thermostatic valve prevents scalding from the 60 °C boiler.',
    service: 'Descale head.', access: 'Wet bath', depends: ['water-manifold', 'combi-heater'],
  },
  // ───────────────────────────── DRIVER TOWER ─────────────────────────────
  {
    id: 'tower', name: 'Pantry tower & control centre', system: 'living', zone: 'tower', placement: 'interior', hollow: true, wrapsArch: true, followsWall: true,
    box: B(-0.15, 0.65, 0.73, 2.6, -0.855, -0.455), mass: 25, cost: 1100, status: 'assumption',
    spec: '0.80 × 0.40 m tall cabinet over the driver wheel arch: cleaning closet, microwave, pantry, control centre',
    principle: 'Uses the awkward over-arch volume for tall storage; carcass is notched around the arch.',
    service: 'Lower kick panel removes for wiring access.', access: 'Aisle', depends: [],
  },
  {
    id: 'microwave', name: 'Convection microwave', system: 'kitchen', zone: 'tower', placement: 'interior', parent: 'tower',
    box: B(-0.05, 0.39, 1.32, 1.58, -0.83, -0.47), mass: 15, cost: 500, status: 'typical',
    spec: '0.7 cu ft combination microwave/convection, 1500 W input', principle: 'Reheating and baking; dedicated 15 A circuit; load manager blocks cooktop boost while running.',
    service: 'Keep side vents clear.', access: 'Aisle', depends: ['inverter', 'ac-panel'],
  },
  {
    id: 'cleaning-closet', name: 'Cleaning closet', system: 'living', zone: 'tower', placement: 'interior', parent: 'tower',
    box: B(0.05, 0.63, 0.76, 1.28, -0.66, -0.47), mass: 4, cost: 180, status: 'assumption',
    spec: 'Cordless vacuum on charging dock, dustpan & brush, microfibre, spray', principle: 'Cleaning kit right by the entry.', service: '—',
    access: 'Aisle', depends: ['dc-panel'],
  },
  {
    id: 'control-panel', name: 'Control centre', system: 'electrical', zone: 'tower', placement: 'interior', mountedIn: 'tower',
    box: B(0.25, 0.6, 1.66, 1.92, -0.47, -0.44), mass: 1.5, cost: 650, status: 'typical',
    spec: 'Victron GX Touch 50, Truma iNet X panel, thermostat, tank monitor, CO₂/RH monitor', principle: 'One place to see battery, solar, tanks, temperatures and air quality.',
    service: '—', access: 'Aisle', depends: ['cerbo-gx', 'combi-heater', 'rooftop-ac'],
  },
  {
    id: 'cerbo-gx', name: 'System controller (GX)', system: 'electrical', zone: 'tower', placement: 'interior', parent: 'tower',
    box: B(0.3, 0.45, 1.7, 1.85, -0.53, -0.47), mass: 0.4, cost: 300, status: 'typical', model: 'Victron Cerbo GX',
    spec: 'VE.Can/VE.Direct hub, tank & temperature inputs, relay outputs', principle: 'Runs load-shedding rules: e.g. AC off below 20 % SoC, CO₂-driven fan control.',
    service: 'Firmware updates.', access: 'Behind control panel', depends: ['lynx-bms', 'inverter', 'mppt'],
  },
  {
    id: 'fire-blanket', name: 'Fire blanket', system: 'safety', zone: 'galley', placement: 'interior',
    box: B(0.65, 0.7, 1.7, 1.95, -0.8, -0.62), mass: 0.8, cost: 30, status: 'typical',
    spec: '1.0 × 1.0 m', principle: 'Smothers pan fires within arm\'s reach of the cooktop.', service: 'Inspect yearly.', access: 'Galley', depends: [],
  },
  // ───────────────────────────── GALLEY ─────────────────────────────
  {
    id: 'galley-base', name: 'Galley base cabinets', system: 'kitchen', zone: 'galley', placement: 'interior', hollow: true,
    box: B(0.65, 2.1, 0.73, 1.59, -0.855, -0.255), mass: 45, cost: 1800, status: 'assumption',
    spec: '1.45 m run × 0.60 m deep, 15 mm poplar ply, soft-close full-extension runners, push-latch travel locks',
    principle: 'Opposite the sliding door so the cook faces the view; 0.61 m aisle to the wardrobe.',
    service: 'Toe-kick removes for plumbing/duct access.', access: 'Aisle', depends: [],
  },
  {
    id: 'fridge', name: 'Fridge / freezer 130 L', system: 'kitchen', zone: 'galley', placement: 'interior', parent: 'galley-base',
    box: B(0.67, 1.214, 0.8, 1.544, -0.83, -0.286), mass: 35, cost: 1800, status: 'typical',
    model: 'Isotherm Drawer 130 class (dual-drawer)',
    spec: '130 L (≈ 90 L fridge / 40 L freezer drawers), 0.544 × 0.544 × 0.744 m, 12 V compressor, ~430 Wh/day @25 °C (650 Wh/day hot)',
    principle: 'Variable-speed compressor; heat rejected into the cabin through the toe-kick and top gap.',
    service: 'Vacuum condenser grille every 3 months; check door seals.', access: 'Aisle', depends: ['dc-panel'],
  },
  {
    id: 'galley-drawers', name: 'Cookware & utensil drawers', system: 'kitchen', zone: 'galley', placement: 'interior', parent: 'galley-base',
    box: B(1.23, 1.68, 0.8, 1.5, -0.83, -0.28), mass: 6, cost: 320, status: 'assumption',
    spec: '4 drawers: utensils, knives, nesting cookware, food/pantry', principle: 'Under the cooktop — 20 mm air gap keeps the induction electronics cool.',
    service: '—', access: 'Aisle', depends: [],
  },
  {
    id: 'trash-bins', name: 'Trash & recycling pull-out', system: 'kitchen', zone: 'galley', placement: 'interior', parent: 'galley-base',
    box: B(1.7, 2.08, 0.8, 1.3, -0.7, -0.28), mass: 2, cost: 110, status: 'assumption',
    spec: 'Twin 12 L bins on a soft-close slide, odour-sealed lid', principle: 'Separated trash and recycling under the sink.', service: 'Empty daily.',
    access: 'Aisle', depends: [],
  },
  {
    id: 'drinking-filter', name: 'Drinking-water filter', system: 'water', zone: 'galley', placement: 'interior', parent: 'galley-base',
    box: B(1.75, 1.85, 0.8, 1.15, -0.84, -0.72), mass: 1, cost: 160, status: 'typical',
    spec: '0.5 µm carbon block + UV-LED for the drinking tap', principle: 'Point-of-use polishing for potable water.', service: 'Cartridge every 6 months.',
    access: 'Under sink', depends: ['water-manifold'],
  },
  {
    id: 'countertop', name: 'Worktop (heat-resistant)', system: 'kitchen', zone: 'galley', placement: 'interior',
    box: B(0.65, 2.1, 1.59, 1.63, -0.855, -0.255), mass: 17, cost: 600, status: 'assumption',
    spec: '12 mm compact laminate (heat-resistant to 180 °C), stainless backsplash; 0.87 m² prep area incl. sink cover',
    principle: 'Non-combustible surface around the cooktop; integrated drainer grooves.', service: 'Wipe; reseal sink edge yearly.',
    access: '—', depends: ['galley-base'],
  },
  {
    id: 'cooktop', name: 'Induction cooktop (2-zone)', system: 'kitchen', zone: 'galley', placement: 'interior', mountedIn: 'countertop', parent: 'galley-base',
    box: B(1.305, 1.605, 1.53, 1.636, -0.81, -0.29), mass: 6, cost: 450, status: 'typical',
    spec: '0.30 × 0.52 m front/back zones, 1800 W max total (120 V / 15 A), pan detection, child lock',
    principle: 'Heats the pan directly by eddy currents — no flame, no combustion products, ~85 % efficient; safe for indoor cooking in bad weather with the hood running.',
    service: 'Keep the 20 mm under-cooling gap clear.', access: 'Galley', depends: ['inverter', 'ac-panel', 'range-hood'],
  },
  {
    id: 'sink', name: 'Sink & mixer tap', system: 'water', zone: 'galley', placement: 'interior', mountedIn: 'countertop', parent: 'galley-base',
    box: B(1.72, 2.06, 1.41, 1.63, -0.72, -0.32), mass: 6, cost: 350, status: 'typical',
    spec: '0.34 × 0.40 × 0.18 m undermount stainless with fitted cutting-board cover; hot/cold pull-down mixer + filtered drinking tap',
    principle: 'Cover turns the sink into extra worktop when not in use.', service: 'Clean waterless trap.', access: 'Galley',
    depends: ['water-manifold', 'combi-heater', 'grey-tank', 'drinking-filter'],
  },
  {
    id: 'prep-board', name: 'Pull-out prep board', system: 'kitchen', zone: 'galley', placement: 'interior', parent: 'galley-base',
    box: B(0.7, 1.18, 1.552, 1.572, -0.8, -0.3), mass: 2, cost: 90, status: 'assumption',
    spec: '0.48 × 0.50 m board on concealed slides beneath the worktop', principle: 'Retractable extra counter over the fridge when cooking for two.',
    service: '—', access: 'Galley', depends: ['galley-base'],
  },
  {
    id: 'oh-galley-1', name: 'Galley overhead cabinet 1', system: 'kitchen', zone: 'galley', placement: 'interior', followsWall: true,
    box: B(0.65, 1.22, 2.1, 2.6, -0.74, -0.42), mass: 7, cost: 300, status: 'assumption', spec: 'Dishes, glasses (fiddle rails)',
    principle: 'Lift-up door on gas strut; push-button latch.', service: '—', access: 'Galley', depends: [],
  },
  {
    id: 'oh-galley-2', name: 'Hood cabinet', system: 'kitchen', zone: 'galley', placement: 'interior', followsWall: true, hollow: true,
    box: B(1.22, 1.69, 2.18, 2.6, -0.74, -0.42), mass: 6, cost: 300, status: 'assumption', spec: 'Spice storage around the hood duct',
    principle: 'Bottom sits 0.55 m above the cooktop.', service: '—', access: 'Galley', depends: [],
  },
  {
    id: 'range-hood', name: 'Range hood extractor (12 V)', system: 'ventilation', zone: 'galley', placement: 'interior', parent: 'oh-galley-2',
    box: B(1.24, 1.67, 2.18, 2.28, -0.74, -0.42), mass: 3, cost: 280, status: 'typical',
    spec: '12 V brushless, ~200 m³/h boost (≈ 5 A), washable grease filter, 100 mm duct to roof', principle: 'Captures steam, grease and heat at source and ducts them outside.',
    service: 'Wash grease filter monthly.', access: 'Galley', depends: ['hood-vent', 'dc-panel'],
  },
  {
    id: 'oh-galley-3', name: 'Galley overhead cabinet 3', system: 'kitchen', zone: 'galley', placement: 'interior', followsWall: true,
    box: B(1.69, 2.1, 2.1, 2.6, -0.74, -0.42), mass: 6, cost: 280, status: 'assumption', spec: 'Dry goods, router & Starlink PSU',
    principle: 'Push-button latch.', service: '—', access: 'Galley', depends: [],
  },
  {
    id: 'lagun-table', name: 'Swing-arm table (dining / desk)', system: 'living', zone: 'dinette', placement: 'interior',
    box: B(2.12, 2.52, 1.42, 1.45, -0.82, -0.12), mass: 8, cost: 320, status: 'typical',
    spec: 'Lagun-type swing mount on galley end panel, 0.40 × 0.70 m top', principle: 'Parks alongside the galley for travel, swings to the centre between the swivelled cab seats.',
    service: 'Re-tension pivot.', access: 'Dinette', depends: ['galley-base'],
  },
  // ───────────────────────────── PASSENGER WARDROBE ─────────────────────────────
  {
    id: 'wardrobe', name: 'Wardrobe & laundry', system: 'living', zone: 'wardrobe', placement: 'interior', hollow: true, followsWall: true,
    box: B(0.67, 1.4, 0.73, 2.6, 0.355, 0.855), mass: 30, cost: 1200, status: 'assumption',
    spec: 'Hanging rail, 4 shelves, base laundry compartment', principle: 'Full-height storage between the wet bath and the sliding door.',
    service: '—', access: 'Aisle', depends: [],
  },
  {
    id: 'laundry', name: 'Hidden laundry compartment', system: 'living', zone: 'wardrobe', placement: 'interior', parent: 'wardrobe',
    box: B(0.69, 1.38, 0.76, 1.1, 0.38, 0.84), mass: 4, cost: 140, status: 'assumption',
    spec: 'Pull-out hamper + collapsible wash bucket/pressure washer bag; drying line in the shower', principle: 'Hand-wash with shower water, drip-dry in the ventilated wet bath.',
    service: '—', access: 'Aisle', depends: [],
  },
  {
    id: 'extinguisher-galley', name: 'Fire extinguisher (galley/door)', system: 'safety', zone: 'wardrobe', placement: 'interior',
    box: B(1.2, 1.3, 0.95, 1.35, 0.27, 0.355), mass: 1.6, cost: 60, status: 'typical',
    spec: '2.5 lb ABC (UL 1-A:10-B:C)', principle: 'Within 1 m of the cooktop and beside the main exit.', service: 'Check gauge monthly.',
    access: 'Aisle', depends: [],
  },
  {
    id: 'emergency-stop', name: 'Emergency power shut-off', system: 'safety', zone: 'wardrobe', placement: 'interior', mountedIn: 'wardrobe',
    box: B(1.32, 1.38, 1.55, 1.61, 0.33, 0.355), mass: 0.2, cost: 40, status: 'assumption',
    spec: 'Red mushroom switch → BMS remote on/off (opens the 500 A contactor)', principle: 'Kills all house power from the doorway.',
    service: 'Test quarterly.', access: 'Aisle by sliding door', depends: ['lynx-bms'],
  },
  // ───────────────────────────── CEILING / AIR ─────────────────────────────
  {
    id: 'ac-plenum', name: 'AC air-distribution box', system: 'climate', zone: 'bed', placement: 'interior',
    box: B(-1.3, -0.56, 2.5, 2.62, -0.4, 0.4), mass: 4, cost: 0, status: 'typical',
    spec: 'Ceiling distribution box with return-air filter, adjustable louvres and a forward ducted outlet', principle: 'Returns cabin air through a filter, supplies cold air forward along the ceiling duct.',
    service: 'Wash return filter monthly in summer.', access: 'Ceiling (from bed)', depends: ['rooftop-ac'],
  },
  {
    id: 'ac-duct', name: 'Concealed ceiling supply duct', system: 'climate', zone: 'aisle', placement: 'interior',
    box: B(-0.56, 2.3, 2.555, 2.62, -0.25, 0.05), mass: 5, cost: 260, status: 'assumption',
    spec: '300 × 65 mm insulated flat duct with 3 linear slot diffusers (wet bath door, galley, dinette)', principle: 'Spreads cooled air through the living and cooking areas; slots are dampered.',
    service: '—', access: 'Ceiling', depends: ['ac-plenum'],
  },
  {
    id: 'fresh-air-inlet', name: 'Filtered fresh-air inlet', system: 'ventilation', zone: 'dinette', placement: 'through-roof',
    box: B(2.3, 2.6, 2.5, 2.8, 0.1, 0.4), mass: 2, cost: 220, status: 'assumption',
    spec: 'Forward-facing roof cowl under the fairing, MERV-13 filter, 12 V EC fan 20–60 m³/h, backdraft damper', principle: 'Supplies filtered make-up air far from the heater and vehicle exhaust; with the roof fan exhausting, gives balanced ventilation with doors & windows closed.',
    service: 'Replace filter every 3 months.', access: 'Ceiling grille', depends: ['dc-panel'],
  },
  {
    id: 'smoke-co-alarm', name: 'Smoke + CO alarm', system: 'safety', zone: 'aisle', placement: 'interior',
    box: B(1.05, 1.17, 2.585, 2.62, 0.1, 0.22), mass: 0.3, cost: 60, status: 'typical',
    spec: 'Combined photoelectric smoke + electrochemical CO, 10-year sealed battery, hard-wired interconnect', principle: 'Diesel heater is room-sealed, but CO detection is mandatory belt-and-braces.',
    service: 'Test monthly; replace at 10 years.', access: 'Ceiling', depends: [],
  },
  {
    id: 'co-alarm-bed', name: 'CO alarm (sleeping area)', system: 'safety', zone: 'bed', placement: 'interior',
    box: B(-0.8, -0.7, 2.17, 2.2, 0.5, 0.6), mass: 0.2, cost: 45, status: 'typical',
    spec: 'Electrochemical CO alarm, 10-year battery, interconnected', principle: 'Within breathing-zone distance of sleepers.',
    service: 'Test monthly.', access: 'Bed', depends: [],
  },
  {
    id: 'extinguisher-bed', name: 'Fire extinguisher (bed)', system: 'safety', zone: 'bed', placement: 'interior',
    box: B(-1.52, -1.45, 1.7, 1.98, 0.74, 0.82), mass: 1.2, cost: 50, status: 'typical',
    spec: '2 lb ABC on D-pillar trim', principle: 'Reachable from the bed and the rear exit.', service: 'Check gauge monthly.', access: 'Bed', depends: [],
  },
  // ───────────────────────────── OUTLETS & LIGHTS ─────────────────────────────
  {
    id: 'outlets-galley', name: 'Galley outlets (GFCI + USB-C)', system: 'electrical', zone: 'galley', placement: 'interior', solid: false,
    box: B(0.9, 1.02, 1.7, 1.8, -0.855, -0.835), mass: 0.3, cost: 90, status: 'typical',
    spec: '120 V GFCI duplex + 2 × USB-C PD 100 W', principle: 'Appliances & device charging at the worktop.', service: 'Test GFCI monthly.', access: 'Galley',
    depends: ['ac-panel', 'dc-panel'],
  },
  {
    id: 'outlets-bed', name: 'Bedside USB-C & reading lights', system: 'electrical', zone: 'bed', placement: 'interior', solid: false,
    box: B(-0.17, -0.15, 1.75, 1.85, 0.3, 0.42), mass: 0.3, cost: 160, status: 'typical',
    spec: '2 × USB-C PD 65 W, 2 adjustable gooseneck reading lights (3 W, 2700 K)', principle: 'Phone/laptop charging and reading in bed.', service: '—',
    access: 'Bed', depends: ['dc-panel'],
  },
  {
    id: 'outlets-dinette', name: 'Dinette / desk outlets', system: 'electrical', zone: 'dinette', placement: 'interior', solid: false,
    box: B(2.1, 2.12, 1.2, 1.3, -0.6, -0.48), mass: 0.3, cost: 90, status: 'typical',
    spec: '120 V duplex + 2 × USB-C PD 100 W on galley end panel', principle: 'Laptop and monitor power at the desk.', service: '—',
    access: 'Dinette', depends: ['ac-panel', 'dc-panel'],
  },
  {
    id: 'lighting', name: 'Interior lighting system', system: 'electrical', zone: 'aisle', placement: 'interior', solid: false,
    box: B(-1.4, 2.6, 2.6, 2.62, -0.7, 0.7), mass: 2, cost: 600, status: 'typical',
    spec: '10 dimmable 2700 K ceiling pucks, under-cabinet & cove LED strips, red night-light circuit, all on dimmers', principle: 'Layered warm lighting ~30 W total at full brightness.',
    service: '—', access: '—', depends: ['dc-panel'],
  },
  {
    id: 'window-covers', name: 'Insulated window covers & privacy screens', system: 'envelope', zone: 'cab', placement: 'interior', solid: false,
    box: B(-1.55, 4.2, 1.0, 2.5, -1.0, 1.0), mass: 5, cost: 450, status: 'typical',
    spec: '5-layer magnetic covers (reflective outer, closed-cell foam, fabric inner) for windshield, cab, sliding-door and rear windows',
    principle: 'Cut window heat loss ~70 % and solar gain ~80 %, stop condensation and give full privacy at night.', service: 'Air out to stay mildew-free.',
    access: '—', depends: [],
  },
  {
    id: 'insulation', name: 'Insulation & thermal breaks', system: 'envelope', zone: 'body', placement: 'interior', solid: false,
    box: B(-1.55, 2.75, 0.69, 2.7, -0.89, 0.89), mass: 32, cost: 2500, status: 'typical',
    spec: '3M Thinsulate SM600L in walls/roof (incl. ribs & doors), 25 mm XPS floor, thermal-break tape on ribs, cab firewall mat',
    principle: 'Effective U ≈ 1.1 W/m²K walls, 1.0 roof, 0.9 floor; non-absorbent, does not trap condensation.',
    service: '—', access: '—', depends: [],
  },
  // ───────────────────────────── CAB ─────────────────────────────
  {
    id: 'seat-driver', name: 'Driver seat on swivel base', system: 'living', zone: 'cab', placement: 'cab',
    box: B(2.85, 3.45, 0.7, 1.95, -0.72, -0.14), mass: 12, cost: 500, status: 'typical',
    spec: 'Crash-tested swivel base (+12 kg), 180° rotation', principle: 'Cab seats become the dinette/lounge seating when parked.',
    service: 'Torque-check base bolts.', access: 'Cab', depends: [],
  },
  {
    id: 'seat-passenger', name: 'Passenger seat on swivel base', system: 'living', zone: 'cab', placement: 'cab',
    box: B(2.85, 3.45, 0.7, 1.95, 0.14, 0.72), mass: 12, cost: 500, status: 'typical',
    spec: 'Crash-tested swivel base, 180° rotation', principle: 'Second dinette seat.', service: 'Torque-check base bolts.', access: 'Cab', depends: [],
  },
  {
    id: 'extinguisher-cab', name: 'Fire extinguisher (cab)', system: 'safety', zone: 'cab', placement: 'cab',
    box: B(2.76, 2.84, 0.8, 1.15, 0.7, 0.8), mass: 1.2, cost: 50, status: 'typical',
    spec: '2 lb ABC at B-pillar + first-aid kit, LED torch, seat-belt cutter/window breaker', principle: 'Third extinguisher at the front exit.', service: 'Monthly check.',
    access: 'Cab', depends: [],
  },
  // ───────────────────────────── ROOF ─────────────────────────────
  {
    id: 'roof-rack', name: 'Low-profile roof rack & fairing', system: 'mechanical', zone: 'roof', placement: 'roof', solid: false,
    box: B(-1.47, 2.76, 2.725, 2.925, -0.72, 0.72), mass: 35, cost: 1800, status: 'typical',
    spec: 'Aluminium platform 4.13 × 1.35 m on factory roof rails, front wind fairing', principle: 'Carries solar and hides the AC/fans behind a "contractor" look.',
    service: 'Check foot bolts.', access: 'Rear ladder', depends: [],
  },
  ...[0, 1, 2].map((i) => ({
    id: `solar-${i + 1}`, name: `Solar panel ${i + 1}`, system: 'electrical', zone: 'roof', placement: 'roof',
    box: B(-0.46 + i * 1.04, 0.54 + i * 1.04, 2.925, 2.965, -0.8, 0.8), mass: 18, cost: 300, status: 'typical',
    spec: '340 W mono PERC, 1.60 × 1.00 m (~21 %), Voc ≈ 41 V — 3 in parallel = 1020 Wp', principle: 'Low-profile flat mount on the rack; panels look like a work-van roof load.',
    service: 'Rinse dust; check MC4 connectors.', access: 'Rear ladder', depends: ['mppt'],
  })),
  {
    id: 'rooftop-ac', name: '12 V rooftop air conditioner', system: 'climate', zone: 'roof', placement: 'through-roof',
    box: B(-1.36, -0.56, 2.725, 3.035, -0.42, 0.42), mass: 32, cost: 3300, status: 'verified', model: 'Dometic RTX 2000 (12 V)',
    spec: '1700–2000 W cooling (≈ 6800 BTU/h), 19–58 A @ 12 V (≈ 245–740 W), 308 mm high, 32 kg, R-134a, 5–52 °C ambient, < 70 dB(A)',
    principle: 'DC-inverter compressor runs directly from the house battery (no inverter, no idling). Condenser rejects heat on the roof; condensate drains to the roof gutter.',
    service: 'Clean condenser fins each spring; wash return filter.', access: 'Roof / ceiling plenum',
    depends: ['ac-plenum', 'lynx-bms'],
  },
  {
    id: 'fan-main', name: 'Main roof fan', system: 'ventilation', zone: 'aisle', placement: 'through-roof',
    box: B(1.415, 1.985, 2.6, 2.855, 0.06, 0.48), mass: 5.5, cost: 350, status: 'typical', model: 'MaxxAir MaxxFan Deluxe 7500K',
    spec: '14 × 14 in cutout, 10 speeds, reversible, rain cover, 1–5 A @ 12 V, thermostat & remote', principle: 'Exhausts stale/moist air with the filtered inlet supplying make-up air; works in rain thanks to the fixed cover.',
    service: 'Clean screen monthly.', access: 'Ceiling', depends: ['dc-panel', 'fresh-air-inlet'],
  },
  {
    id: 'fan-bath', name: 'Wet-bath roof fan', system: 'ventilation', zone: 'wetbath', placement: 'through-roof', mountedIn: 'wetbath',
    box: B(0.015, 0.585, 2.6, 2.855, 0.26, 0.68), mass: 5.5, cost: 350, status: 'typical', model: 'MaxxAir MaxxFan Deluxe 7500K',
    spec: '14 × 14 in, auto humidity mode', principle: 'Extracts shower steam at source; door louvre provides make-up air.',
    service: 'Clean screen monthly.', access: 'Wet bath', depends: ['dc-panel'],
  },
  {
    id: 'hood-vent', name: 'Range-hood roof vent', system: 'ventilation', zone: 'roof', placement: 'through-roof',
    box: B(1.38, 1.52, 2.6, 2.82, -0.64, -0.5), mass: 0.6, cost: 60, status: 'typical', spec: '100 mm low-profile mushroom vent with backdraft flap',
    principle: 'Discharges kitchen fumes above the roof, ≥ 1 m from the fresh-air inlet.', service: 'Clear leaves.', access: 'Roof', depends: ['range-hood'],
  },
  {
    id: 'toilet-vent', name: 'Toilet vent', system: 'ventilation', zone: 'wetbath', placement: 'through-roof', mountedIn: 'wetbath',
    box: B(-0.12, -0.02, 2.6, 2.78, 0.6, 0.7), mass: 0.3, cost: 40, status: 'typical', spec: '38 mm hose with service loop to a roof mushroom vent',
    principle: 'Continuous micro-fan keeps the toilet odour-free.', service: 'Check hose loop.', access: 'Wet bath', depends: ['toilet'],
  },
  {
    id: 'starlink', name: 'Satellite internet (optional)', system: 'electrical', zone: 'roof', placement: 'roof',
    box: B(-1.2, -0.94, 2.885, 2.925, 0.46, 0.76), mass: 1.2, cost: 600, status: 'typical', model: 'Starlink Mini class',
    spec: '0.30 × 0.26 m flat dish, 25–40 W, 12 V via DC-DC; LTE/5G router in galley cabinet', principle: 'Remote-work connectivity; flat panel is invisible from the street.',
    service: '—', access: 'Roof', depends: ['dc-panel'],
  },
  {
    id: 'awning', name: 'Retractable awning', system: 'mechanical', zone: 'exterior', placement: 'exterior',
    box: B(-0.8, 2.6, 2.62, 2.74, 0.92, 1.06), mass: 22, cost: 1600, status: 'typical',
    spec: '3.4 m roof-edge cassette awning, 2.5 m projection, 2 telescoping legs, rafter tension arm, LED strip', principle: 'Shade and rain shelter over the sliding door; white cassette blends with the roof rack.',
    service: 'Dry before long storage; lube arms.', access: 'Exterior', depends: ['roof-rack'],
  },
  // ───────────────────────────── UNDERBODY ─────────────────────────────
  {
    id: 'grey-tank', name: 'Grey-water tank 95 L (heated)', system: 'water', zone: 'underbody', placement: 'underbody',
    box: B(0.72, 1.52, 0.36, 0.6, 0.2, 0.75), mass: 9, cost: 520, status: 'assumption',
    spec: 'Rotomoulded 95 L (25 gal), 25 mm foam jacket, 60 W thermostatic heat pad, heated 1.5" dump valve, external level sensor',
    principle: 'Collects sink and shower water by gravity; heat pad keeps it liquid to about -25 °C while the jacket limits losses.',
    service: 'Dump & flush every 2–3 days; check pad thermostat before winter.', access: 'Underbody', depends: ['dc-panel'], capacityL: 95,
  },
  {
    id: 'grey-dump', name: 'Grey dump valve', system: 'water', zone: 'underbody', placement: 'underbody',
    box: B(1.52, 1.62, 0.38, 0.46, 0.55, 0.65), mass: 0.8, cost: 80, status: 'typical', spec: '1.5" gate valve with heat tape and cable pull',
    principle: 'Empties the grey tank at a dump station.', service: 'Lubricate seal.', access: 'Underbody (passenger side)', depends: ['grey-tank'],
  },
  {
    id: 'fuel-tank', name: 'Vehicle fuel tank (OEM)', system: 'vehicle', zone: 'underbody', placement: 'underbody',
    box: B(0.6, 1.5, 0.35, 0.58, -0.8, -0.3), mass: 0, cost: 0, status: 'typical',
    spec: '92.7 L (24.5 gal) diesel; heater standpipe stops at ¼ tank to protect driving range', principle: 'Shared fuel for driving and heating.',
    service: 'OEM.', access: '—', depends: [],
  },
  {
    id: 'heater-fuel-pump', name: 'Heater fuel standpipe & dosing pump', system: 'climate', zone: 'underbody', placement: 'underbody',
    box: B(0.1, 0.25, 0.44, 0.53, -0.34, -0.22), mass: 0.6, cost: 0, status: 'verified', cert: 'certified',
    spec: 'Tank-sender standpipe, 2 mm fuel line, dosing pump mounted at 15–35° per Truma instructions', principle: 'Meters tiny pulses of diesel to the burner; cannot drain the tank below ¼.',
    service: 'Check fuel line clips yearly.', access: 'Underbody', depends: ['fuel-tank'],
  },
  {
    id: 'starter-battery', name: 'Starter battery & alternator (OEM)', system: 'vehicle', zone: 'cab', placement: 'underbody',
    box: B(2.9, 3.25, 0.45, 0.65, -0.7, -0.42), mass: 0, cost: 0, status: 'typical',
    spec: '12 V AGM under the driver floor; heavy-duty alternator option', principle: 'Source for the DC-DC chargers while driving.',
    service: 'OEM.', access: 'Driver floor', depends: [],
  },
  // ───────────────────────────── BODY OPENINGS & EXTERIOR FITTINGS ─────────────────────────────
  {
    id: 'sliding-door', name: 'Sliding door (main entry & egress)', system: 'mechanical', zone: 'body', placement: 'exterior', solid: false,
    box: B(1.42, 2.72, 0.45, 2.49, 0.95, 1.03), mass: 0, cost: 0, status: 'typical',
    spec: 'OEM 1.30 × 1.80 m opening, upper/centre/lower tracks, interior release always unobstructed',
    principle: 'Primary entrance and emergency exit; the 0.61 m aisle and clear door zone are kept free of fixed furniture.',
    service: 'Clean & lube tracks.', access: 'Exterior / interior', depends: [],
  },
  {
    id: 'rear-doors', name: 'Rear doors (270° hinges)', system: 'mechanical', zone: 'body', placement: 'exterior', solid: false,
    box: B(-1.62, -1.55, 0.6, 2.54, -0.85, 0.85), mass: 0, cost: 0, status: 'typical',
    spec: 'OEM barn doors with 90°/180°/270° detent hinges and magnetic hold-backs; rear-door release cable extended to bed level. Interlock: driver door stops at 180° while the slide-out pod is deployed',
    principle: 'Secondary emergency exit directly from the bed; opens fully to expose the garage and outdoor kitchen.',
    service: 'Check hold-back magnets.', access: 'Exterior / bed', depends: [],
  },
  {
    id: 'rear-door-table', name: 'Fold-down rear-door table', system: 'mechanical', zone: 'exterior', placement: 'exterior', solid: false,
    box: B(-1.62, -1.58, 1.0, 1.55, 0.25, 0.78), mass: 3, cost: 180, status: 'conceptual',
    spec: '0.52 × 0.40 m HPL panel on piano hinge with stainless folding brace, 25 kg rated', principle: 'With the passenger-side door latched at 270°, the inner door card becomes an exterior prep surface at 0.95 m.',
    service: 'Check brace pivot.', access: 'Exterior', depends: ['rear-doors'],
  },
  {
    id: 'rear-door-bench', name: 'Fold-down rear-door bench', system: 'mechanical', zone: 'exterior', placement: 'exterior', solid: false,
    box: B(-1.62, -1.58, 0.75, 1.3, -0.78, -0.25), mass: 3, cost: 180, status: 'conceptual',
    spec: '0.52 × 0.34 m seat with two drop legs, 150 kg rated', principle: 'Retractable exterior seating on the driver-side rear door — usable at the 180° stop (facing the outdoor kitchen) or at 270°.',
    service: 'Check leg latches.', access: 'Exterior', depends: ['rear-doors'],
  },
  {
    id: 'leak-sensors', name: 'Leak & level sensors', system: 'water', zone: 'garage', placement: 'interior', solid: false,
    box: B(-0.9, 1.9, 0.73, 0.76, -0.8, 0.8), mass: 0.5, cost: 220, status: 'typical',
    spec: '5 leak probes (pump, tank, shower pan, under sink, heater), fresh tank capacitive gauge, grey external ultrasonic gauge, Cerbo GX alarms',
    principle: 'Any wet probe sounds an alarm and can switch off the water pump via a Cerbo relay.', service: 'Test probes quarterly.',
    access: '—', depends: ['cerbo-gx', 'water-pump'],
  },
];

export const byId = Object.fromEntries(COMPONENTS.map((c) => [c.id, c]));

export function boxSize(b) {
  return [b.x[1] - b.x[0], b.y[1] - b.y[0], b.z[1] - b.z[0]];
}

export function boxCenter(b) {
  return [(b.x[0] + b.x[1]) / 2, (b.y[0] + b.y[1]) / 2, (b.z[0] + b.z[1]) / 2];
}

export function fmtDims(b) {
  const [l, h, w] = boxSize(b);
  return `${Math.round(l * 1000)} L × ${Math.round(w * 1000)} W × ${Math.round(h * 1000)} H mm`;
}
