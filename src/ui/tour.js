// Guided tour: a scripted walk through the van's systems. Each stop sets the environment, the
// master transformation, individual mechanisms, view and simulation mode, then flies the camera.
export const TOUR = [
  {
    title: 'Just a white work van',
    text: 'From the street this is a plain Sprinter 2500 high-roof cargo van: privacy glass, no badges, roof gear kept under the rack line. The AC, vents, solar and fill points are all hidden in plain sight.',
    scn: 'summer', hour: 11, master: 0, cam: { p: [9.2, 2.6, 7.4], t: [1.6, 1.35, 0] },
  },
  {
    title: 'The roof works for a living',
    text: '3 × 340 W panels (1,020 Wp) sit on a low rack beside a 12 V Dometic RTX 2000 rooftop air conditioner that runs parked, from the battery. Rain-capped fans, a filtered fresh-air inlet and the hood and toilet vents share the roof.',
    scn: 'summer', hour: 12, master: 0, cam: { p: [6.2, 7.4, 6.4], t: [0.7, 2.6, 0] },
  },
  {
    title: 'Doors open: the service garage',
    text: 'Under the bed: 7.7 kWh of LiFePO₄, a 3 kVA inverter/charger, DC-DC and solar chargers, the diesel Combi heater with its 10 L boiler and the 120 L fresh tank — all inside the heated envelope, behind hinged hatches with service clearance.',
    master: 0.25, hour: 12, cam: 'rear',
  },
  {
    title: 'Power you can watch',
    text: 'Every cable glows with its live current: solar into the MPPT, the battery bus, the inverter and the DC panel. Switch loads in the Energy tab to see realistic peaks — induction plus AC is held under 2.4 kW by the load manager.',
    master: 0.25, hour: 12, sim: 'electrical', cam: 'dollhouse',
  },
  {
    title: 'A real kitchen, all electric',
    text: 'Two-zone induction, 130 L fridge-freezer drawers, a convection microwave and a sink with filtered drinking water. The range hood is ducted straight to the roof so cooking moisture never reaches the cold walls.',
    master: 0.5, hour: 18, acts: { drawers: 1, fridgeDrawers: 0.7 }, cam: 'galley',
  },
  {
    title: 'Private wet bath',
    text: 'A sealed GRP wet bath with a hot shower and a urine-diverting drawer toilet that slides out only when needed, vented to the roof. Shower water drains to the 95 L heated grey tank under the floor.',
    master: 0.5, hour: 7.5, acts: { wetbathDoor: 1, toilet: 1 }, view: 'cutaway', cutPos: 0.45, cam: { p: [0.75, 4.1, 1.75], t: [0.25, 1.0, 0.4] },
  },
  {
    title: 'Fresh air in a sealed van',
    text: 'At −18 °C every door stays shut. A filtered fresh-air fan and the extract fans keep CO₂ under 1,000 ppm overnight; the diesel heater burns sealed-combustion with its exhaust outside, so the cabin air never mixes with flue gas.',
    scn: 'winter', hour: 21, master: 0.75, sim: 'ventilation', cam: 'dollhouse',
  },
  {
    title: 'Infrared: where the heat goes',
    text: 'The same winter night through a thermal camera. Insulated walls stay close to the outdoor temperature; glass and the partly insulated cab glow because they leak the most. Design heat loss is about 3 kW at −20 °C — inside the 6 kW heater with margin.',
    scn: 'winter', hour: 21, master: 0.75, ir: true, cam: { p: [7.8, 2.9, 7.6], t: [1.4, 1.3, 0] },
  },
  {
    title: 'Bedtime: the slide-out pod',
    text: 'The transverse bed gains 250 mm from a slide-out pod on the driver side, giving a 2.08 m sleeping length in a 2 m-wide van. Insulated covers go on every window, a CO alarm watches the bed and the heater drops to a 15 °C setback.',
    scn: 'overnight', hour: 22, master: 0.75, cam: { p: [-5.2, 3.7, -6.4], t: [-0.4, 1.6, -0.5] },
  },
  {
    title: 'Full camp',
    text: 'Awning out, the outdoor kitchen on the rear door swung to 270°, a rear-door table and bench. Interlocks stop the outdoor kitchen until the doors are fully open, and stop the driver door at 180° while the pod is out.',
    scn: 'summer', hour: 18.5, master: 1, cam: { p: [-6.6, 3.0, 8.4], t: [0.4, 1.2, 0.6] },
  },
  {
    title: 'A day in the van',
    text: 'An occupant cooks, works, showers and goes to bed while the coupled simulation runs: heat, humidity, CO₂, battery, water and diesel all respond. Watch the Energy tab — and try Walk inside to explore at eye height.',
    scn: 'multiday', sim: 'living', clock: true,
  },
  {
    title: 'Honest limits',
    text: 'All-day AC off-grid in 38 °C heat drains the battery in about a day; grey water usually runs out before power; winter costs ~5.5 L of diesel a day. The Engineering tab shows the 76 acceptance checks and every labelled assumption.',
    scn: 'summer', hour: 13, master: 0.5, tab: 'engineering', cam: { p: [9.0, 3.4, 8.2], t: [1.5, 1.3, 0] },
  },
];
