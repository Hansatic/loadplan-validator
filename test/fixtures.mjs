// Synthetic fixtures for validate.mjs: each one trips exactly the rules it names
// (or none). No customer data. Run: node test/fixtures.mjs
import { validatePlan, summarize, VERSION } from '../validate.mjs';

const C20 = { kind: 'container', length_mm: 5900, width_mm: 2350, height_mm: 2390, max_payload_kg: 28000, tare_kg: 2200, max_floor_load_kg_m2: 5400 };
const TRUCK = { kind: 'truck', length_mm: 13600, width_mm: 2480, height_mm: 2700, max_payload_kg: 24000, tare_kg: 7200, max_floor_load_kg_m2: 5000,
	kingpin_from_front_mm: 1100, bogie_from_front_mm: 11500, max_kingpin_kg: 12000, max_bogie_kg: 24000 };
const AKE = { kind: 'uld', length_mm: 1500, width_mm: 1905, height_mm: 1550, max_payload_kg: 1506, tare_kg: 82,
	wings: [{ side: 'y+', overhang_mm: 445, height_mm: 610 }] };
const PAL = { kind: 'pallet', length_mm: 1200, width_mm: 1000, base_height_mm: 150, max_build_height_mm: 1400, max_weight_kg: 1500 };
const box = (id, l, w, h, kg, extra = {}) => ({ id, l, w, h, kg, stackable: true, max_stack_kg: null, fragile: false, tiltable: true, ...extra });
const at = (id, x, y, z, dx, dy, dz) => ({ id, x, y, z, dx, dy, dz });
const cubes = (n) => Array.from({ length: n }, (_, i) => box(`K${i}`, 500, 500, 500, 1));
const bags = (n) => Array.from({ length: n }, (_, i) => box(`G${i}`, 600, 400, 120, 25, { tiltable: false }));

// Two 1200x1000x1000 crates side by side at the front wall: the clean base case.
const pair = [box('A', 1200, 1000, 1000, 400), box('B', 1200, 1000, 1000, 400)];
const pairOk = [at('A', 0, 0, 0, 1200, 1000, 1000), at('B', 0, 1000, 0, 1200, 1000, 1000)];

// k columns of two 300x300x800 boxes each (Bi bottom, Ci top), placed at [x, y] on a 300 mm deck item.
const cols = (k) => Array.from({ length: k }, (_, i) => [box(`B${i}`, 300, 300, 800, 20), box(`C${i}`, 300, 300, 800, 20)]).flat();
const colsAt = (xy) => xy.flatMap(([x, y], i) => [at(`B${i}`, x, y, 300, 300, 300, 800), at(`C${i}`, x, y, 1100, 300, 300, 800)]);

const FIXTURES = [
	{ name: 'clean pair', vehicle: C20, items: pair, placements: pairOk, expect: [] },
	{ name: 'turned on the floor is fine', vehicle: C20, items: pair, placements: [at('A', 0, 0, 0, 1000, 1200, 1000), at('B', 1000, 0, 0, 1000, 1200, 1000)], expect: [] },
	{ name: 'unknown id', vehicle: C20, items: pair, placements: [...pairOk, at('Z', 2000, 0, 0, 100, 100, 100)], expect: ['unknownId'] },
	{ name: 'duplicate id', vehicle: C20, items: pair, placements: [...pairOk, at('A', 3000, 0, 0, 1200, 1000, 1000)], expect: ['duplicateId'] },
	{ name: 'dims not a permutation', vehicle: C20, items: pair, placements: [at('A', 0, 0, 0, 1200, 1000, 900), pairOk[1]], expect: ['badDims'] },
	{ name: 'upright item laid down', vehicle: C20, items: [box('A', 1200, 1000, 800, 100, { tiltable: false })], placements: [at('A', 0, 0, 0, 1200, 800, 1000)], expect: ['illegalTilt'] },
	{ name: 'overlap', vehicle: C20, items: pair, placements: [pairOk[0], at('B', 600, 500, 0, 1200, 1000, 1000)], expect: ['overlap'] },
	{ name: 'past the side wall', vehicle: C20, items: pair, placements: [pairOk[0], at('B', 0, 1400, 0, 1200, 1000, 1000)], expect: ['outOfBounds'] },
	// B stood on its 1000 x 1200 face reaches 2500 > 2390, and overhangs A (A is 1200 x 1000).
	{ name: 'through the roof', vehicle: C20, items: [box('A', 1200, 1000, 1000, 400), box('B', 1500, 1200, 1000, 400)],
		placements: [at('A', 0, 0, 0, 1200, 1000, 1000), at('B', 0, 0, 1000, 1000, 1200, 1500)], expect: ['overHeight', 'floating'] },
	{ name: 'hangs off its base (94% support)', vehicle: C20, items: [box('A', 1000, 1000, 500, 300), box('B', 1000, 1000, 500, 100)],
		placements: [at('A', 0, 0, 0, 1000, 1000, 500), at('B', 60, 0, 500, 1000, 1000, 500)], expect: ['floating'] },
	{ name: '96% support passes', vehicle: C20, items: [box('A', 1000, 1000, 500, 300), box('B', 1000, 1000, 500, 100)],
		placements: [at('A', 0, 0, 0, 1000, 1000, 500), at('B', 40, 0, 500, 1000, 1000, 500)], expect: [] },
	{ name: 'on a non-stackable item', vehicle: C20, items: [box('A', 1200, 1000, 1000, 400, { stackable: false }), box('B', 1200, 1000, 1000, 100)],
		placements: [at('A', 0, 0, 0, 1200, 1000, 1000), at('B', 0, 0, 1000, 1200, 1000, 1000)], expect: ['badBase'] },
	{ name: 'on a fragile item with no max_stack_kg', vehicle: C20, items: [box('A', 1200, 1000, 1000, 400, { fragile: true }), box('B', 1200, 1000, 1000, 100)],
		placements: [at('A', 0, 0, 0, 1200, 1000, 1000), at('B', 0, 0, 1000, 1200, 1000, 1000)], expect: ['badBase'] },
	{ name: 'crushed (max_stack_kg 50, 100 on top)', vehicle: C20, items: [box('A', 1200, 1000, 1000, 400, { max_stack_kg: 50 }), box('B', 1200, 1000, 1000, 100)],
		placements: [at('A', 0, 0, 0, 1200, 1000, 1000), at('B', 0, 0, 1000, 1200, 1000, 1000)], expect: ['crush'] },
	{ name: 'over payload', vehicle: { ...C20, max_payload_kg: 700 }, items: pair, placements: pairOk, expect: ['overPayload'] },
	{ name: 'heavy load all on one side (lateral CoG)', vehicle: C20, items: [box('A', 1200, 800, 1000, 9000), box('B', 1200, 800, 1000, 9000)],
		placements: [at('A', 0, 0, 0, 1200, 800, 1000), at('B', 1200, 0, 0, 1200, 800, 1000)], expect: ['cog'] },
	{ name: 'heavy load at the front wall (longitudinal CoG)', vehicle: C20, items: [box('A', 1200, 1000, 1000, 9000), box('B', 1200, 1000, 1000, 9000)],
		placements: [at('A', 0, 0, 0, 1200, 1000, 1000), at('B', 0, 1000, 0, 1200, 1000, 1000)], expect: ['cog'] },
	{ name: 'light load skips balance', vehicle: C20, items: [box('A', 1200, 800, 1000, 300)], placements: [at('A', 0, 0, 0, 1200, 800, 1000)], expect: [] },
	{ name: 'kingpin overload (truck)', vehicle: TRUCK, items: [box('A', 1200, 1000, 1000, 9000), box('B', 1200, 1000, 1000, 9000)],
		placements: [at('A', 0, 0, 0, 1200, 1000, 1000), at('B', 0, 1000, 0, 1200, 1000, 1000)], expect: ['axle'] }, // trucks: axle beam, no longitudinal band
	{ name: 'slender pile', vehicle: C20, items: [box('A', 1200, 1000, 300, 200), box('B', 300, 300, 800, 20), box('C', 300, 300, 800, 20)],
		placements: [at('A', 0, 0, 0, 1200, 1000, 300), at('B', 0, 0, 300, 300, 300, 800), at('C', 0, 0, 1100, 300, 300, 800)], expect: ['slenderPile'] },
	// Same columns, four of them in a 2 x 2 block: braced width 600, 1600 <= 5 x 600.
	{ name: 'braced block of columns passes', vehicle: C20, items: [box('A', 1200, 1000, 300, 200), ...cols(4)],
		placements: [at('A', 0, 0, 0, 1200, 1000, 300), ...colsAt([[0, 0], [300, 0], [0, 300], [300, 300]])], expect: [] },
	// Two columns in a row: the block is 600 x 300, braced width still 300.
	{ name: 'one row of columns is still slender', vehicle: C20, items: [box('A', 1200, 1000, 300, 200), ...cols(2)],
		placements: [at('A', 0, 0, 0, 1200, 1000, 300), ...colsAt([[0, 0], [300, 0]])], expect: ['slenderPile'] },
	// A neighbour under half the column's height does not brace it.
	{ name: 'a low neighbour does not brace', vehicle: C20, items: [box('A', 1200, 1000, 300, 200), ...cols(1), box('N', 900, 1000, 300, 20)],
		placements: [at('A', 0, 0, 0, 1200, 1000, 300), ...colsAt([[0, 0]]), at('N', 300, 0, 300, 900, 1000, 300)], expect: ['slenderPile'] },
	// AKE: flat floor y 0..1460, slope rising 610 mm over the last 445 mm to 1905.
	{ name: 'ULD: cube leaning on the slope (40 mm in, z 54) passes', vehicle: AKE, items: cubes(2),
		placements: [at('K0', 0, 1000, 54, 500, 500, 500), at('K1', 0, 1000, 554, 500, 500, 500)], expect: [] },
	{ name: 'ULD: cube on the floor cutting into the slope', vehicle: AKE, items: cubes(1), placements: [at('K0', 0, 1100, 0, 500, 500, 500)], expect: ['outOfContour'] },
	{ name: 'ULD: cube in the air beside the slope', vehicle: AKE, items: cubes(1), placements: [at('K0', 0, 1000, 200, 500, 500, 500)], expect: ['floating'] },
	// On the slope at its true height (290 mm in, z 398) but lifted far over 15 % of its width.
	{ name: 'ULD: perched far out on the slope', vehicle: AKE, items: cubes(1), placements: [at('K0', 0, 1250, 398, 500, 500, 500)], expect: ['floating'] },
	{ name: 'pallet: build over the cargo height cap', vehicle: PAL, items: [box('A', 600, 400, 1300, 25)], placements: [at('A', 0, 0, 0, 600, 400, 1300)], expect: ['overHeight'] },
	{ name: 'pallet: off the deck', vehicle: PAL, items: [box('A', 600, 400, 120, 25)], placements: [at('A', 700, 0, 0, 600, 400, 120)], expect: ['outOfBounds'] },
	{ name: 'pallet: 25 mm over the edge is tolerated', vehicle: PAL, items: [box('A', 650, 450, 120, 25)], placements: [at('A', -25, 575, 0, 650, 450, 120)], expect: [] },
	{ name: 'pallet: 30 mm over the edge', vehicle: PAL, items: [box('A', 650, 450, 120, 25)], placements: [at('A', 580, -30, 0, 650, 450, 120)], expect: ['outOfBounds'] },
];

const INTERLOCK = [
	{ name: 'column stack ties nothing', want: 0, vehicle: PAL, items: bags(2), placements: [at('G0', 0, 0, 0, 600, 400, 120), at('G1', 0, 0, 120, 600, 400, 120)] },
	{ name: 'turned bag across four ties', want: 100, vehicle: PAL, items: bags(5),
		placements: [at('G0', 0, 0, 0, 600, 400, 120), at('G1', 600, 0, 0, 600, 400, 120), at('G2', 0, 400, 0, 600, 400, 120), at('G3', 600, 400, 0, 600, 400, 120), at('G4', 400, 100, 120, 400, 600, 120)] },
];

const DOCTRINE = [
	{ name: 'two floor islands in a truck', vehicle: TRUCK, items: pair, placements: [pairOk[0], at('B', 3000, 0, 0, 1200, 1000, 1000)], expect: ['islands'] },
	{ name: 'two islands allowed in a container', vehicle: C20, items: pair, placements: [pairOk[0], at('B', 3000, 0, 0, 1200, 1000, 1000)], expect: [] },
	{ name: 'full-width items not in line', vehicle: C20, items: [box('A', 1000, 2100, 500, 100), box('B', 1000, 2100, 500, 100)],
		placements: [at('A', 0, 0, 0, 1000, 2100, 500), at('B', 1000, 200, 0, 1000, 2100, 500)], expect: ['misalignedRuns'] },
];

let fail = 0;
const check = (f, got) => {
	const want = [...f.expect].sort().join(','), have = got.sort().join(',');
	if (want !== have) { fail++; console.log(`FAIL ${f.name}: want [${want}] got [${have}]`); }
	else console.log(`ok   ${f.name}`);
};
for (const f of FIXTURES) {
	const r = validatePlan(f);
	check(f, Object.entries(r.violations).filter(([, v]) => v.length).map(([k]) => k));
	if (!f.expect.length && !r.legal) console.log('     ', summarize(r));
}
for (const f of DOCTRINE) {
	const r = validatePlan(f);
	if (!r.legal) { fail++; console.log(`FAIL ${f.name}: not legal: ${summarize(r)}`); continue; }
	check(f, Object.entries(r.doctrine).filter(([, v]) => v.length).map(([k]) => k));
}
for (const f of INTERLOCK) {
	const r = validatePlan(f);
	if (!r.legal || r.interlock?.pct !== f.want) { fail++; console.log(`FAIL ${f.name}: legal ${r.legal} (${summarize(r)}) interlock ${r.interlock?.pct} want ${f.want}`); }
	else console.log(`ok   ${f.name}`);
}
const total = FIXTURES.length + DOCTRINE.length + INTERLOCK.length;
console.log(`validator ${VERSION}: ${total - fail}/${total} fixtures pass`);
process.exit(fail ? 1 : 0);
