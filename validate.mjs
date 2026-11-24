// Load-plan validator for the cargo packing benchmark (v2).
//
// One file, no dependencies. Given a vehicle, a cargo manifest and a placement
// answer, it reports every rule the answer breaks. The same function judges the
// benchmark's engine column and every model, so all of them play by one set of
// rules.
//
//   import { validatePlan } from './validate.mjs';
//   const r = validatePlan({ vehicle, items, placements }, { support: 0.95 });
//   r.legal            // no physics fault and no answer fault
//   r.legalDoctrine    // legal and no hard doctrine fault
//
// Not a load-securing certificate: it checks geometry and simple statics, not
// lashing, friction, dunnage or road law. See README.md.
//
// ── Frames ───────────────────────────────────────────────────────────────────
// Answer frame (what the prompt asks for): x from the FRONT wall toward the
// doors, y from the left wall, z up from the deck, all in mm, and (dx, dy, dz)
// the item's extent along x, y, z: a permutation of its (l, w, h).
// Internally everything runs in a door frame: X = length - x - dx, measured from
// the doors. Only the centre-of-gravity percentage and the tip-over bracing
// (the front wall braces, the doors do not) care which end is which.

export const VERSION = '2.3.0';

/** Rule constants. Changing any of them changes the benchmark. */
export const RULES = Object.freeze({
	TOL_MM: 1,                 // geometric tolerance of every contact / overlap test
	SUPPORT_DEFAULT: 0.95,     // share of an item's footprint that must rest on tops directly below
	NEAR_MM: 0.5,              // (dx, dy, dz) must match a permutation of (l, w, h) this closely
	LIGHT_WEIGHT_SHARE: 0.15,  // light load: below 15 % of payload ...
	LIGHT_VOLUME_SHARE: 0.25,  // ... and below 25 % of the cargo space ...
	LIGHT_MAX_ITEM_KG: 500,    // ... and no item of 500 kg or more: CoG and axle rules are skipped
	COG_LAT_MIN: 40, COG_LAT_MAX: 60,           // lateral CoG, % of the width
	COG_LONG_MIN: 35, COG_LONG_MAX: 65,         // container longitudinal CoG, % from the doors
	SLENDER_RATIO: 5,          // a pile on another item's top may stand at most 5x its narrowest base
	SLENDER_BASE_FACTOR: 1.5,  // an item this much wider than the one above it is a proper base
	SLENDER_OVERLAP_TOL_MM: 10,
	ISLAND_GAP_MM: 300,        // a longitudinal floor void longer than this splits the load
	ISLANDS_MAX: { truck: 1, container: 2, pallet: 1 },
	WING_LEAN_MAX: 0.15,       // ULD: a floor item may lean on a sloped side, lifted at most 15 % of its width ...
	WING_LEAN_FLOOR_SHARE: 0.6, // ... with at least 60 % of its width and its centre over the flat floor
	PALLET_OVERHANG_MM: 25,    // pallet: cargo may hang past each deck edge by at most this (the app's PALLET_EDGE_TOLERANCE_MM)
	INTERLOCK_MIN_MM: 10,     // pallet: an item ties two items below when it overlaps each by more than this both ways
	RUN_MIN_WIDTH_SHARE: 0.85, // near-full-width floor items ...
	RUN_DIM_BUCKET_MM: 10,     // ... of one footprint (10 mm buckets) ...
	RUN_Y_BUCKET_MM: 20,       // ... must share their y (20 mm buckets)
	ANCHOR_MAX_MM: 150,        // advisory: the floor block should reach an end wall
	LATERAL_GAP_MM: 60, LATERAL_GAPS_MAX: 3,    // advisory
	TIP_ACCEL: { truck: { forward: 0.8, rear: 0.5, side: 0.5 }, container: { forward: 0.8, rear: 0.5, side: 0.8 } },
	TIP_TOUCH_MM: 15, TIP_WARN_RATIO: 1.25, TIP_WARN_KG: 1000, // advisory
});

const ORIENTS = [[0, 0], [0, 90], [90, 0], [90, 90], [180, 0], [180, 90]]; // [tilt, spin]

/** Extent (along length, width, height) of an item resting on one face.
 *  tilt 90 tips it forward (l <-> h), tilt 180 rolls it (w <-> h); spin 90 swaps the two floor sides. */
export function orientedDims(l, w, h, tilt, spin) {
	const tl = tilt === 90 ? h : l, tw = tilt === 180 ? h : w, th = tilt === 90 ? l : tilt === 180 ? w : h;
	return spin === 90 ? [tw, tl, th] : [tl, tw, th];
}

const near = (a, b) => Math.abs(a - b) <= RULES.NEAR_MM;

// ── answer → boxes ───────────────────────────────────────────────────────────

/** Parse placements into boxes, collecting answer faults instead of throwing. */
function readAnswer(vehicle, items, placements) {
	const L = vehicle.length_mm;
	const byId = new Map(items.map((i) => [i.id, i]));
	const seen = new Set();
	const faults = { unknownId: [], duplicateId: [], badDims: [], illegalTilt: [] };
	const boxes = [];
	for (const p of Array.isArray(placements) ? placements : []) {
		const it = byId.get(p?.id);
		if (!it) { faults.unknownId.push(String(p?.id)); continue; }
		if (seen.has(it.id)) { faults.duplicateId.push(it.id); continue; }
		seen.add(it.id);
		const nums = [p.x, p.y, p.z, p.dx, p.dy, p.dz].map(Number);
		if (nums.some((v) => !Number.isFinite(v))) { faults.badDims.push(it.id); continue; }
		const [x, y, z, dx, dy, dz] = nums;
		const o = ORIENTS.find(([t, s]) => { const d = orientedDims(it.l, it.w, it.h, t, s); return near(d[0], dx) && near(d[1], dy) && near(d[2], dz); });
		if (!o) { faults.badDims.push(it.id); continue; }
		if (it.tiltable === false && !near(dz, it.h)) faults.illegalTilt.push(it.id);
		const [eL, eW, eH] = orientedDims(it.l, it.w, it.h, o[0], o[1]);
		boxes.push({ it, x: L - x - eL, y, z, eL, eW, eH });
	}
	const missing = items.filter((i) => !seen.has(i.id)).map((i) => i.id);
	return { boxes, faults, missing };
}

// ── contour (air ULDs) ───────────────────────────────────────────────────────
// A sloped side ("wing") rises from the edge of the flat floor out to the full
// width: `overhang_mm` across, `height_mm` up. At height z it still takes
// overhang * (1 - z / height) off that side, so a box's bottom corners are the
// binding ones. A chamfer lowers the roof over a strip `inset_mm` wide on one
// side: the full cap at the strip's inner edge, down to `start_height_mm` at
// the wall (same geometry as the app's uldContour.ts).

/** [yMin, yMax] a box whose bottom is at z may span. */
export function wingYRange(wings, W, z) {
	let lo = 0, hi = W;
	for (const w of wings ?? []) {
		if (!(w.overhang_mm > 0)) continue;
		const cut = w.height_mm > 0 ? w.overhang_mm * Math.max(0, 1 - z / w.height_mm) : 0;
		if (w.side === 'y+') hi = Math.min(hi, W - cut); else lo = Math.max(lo, cut);
	}
	return [lo, hi];
}

/** Height of the slope under a box's outer bottom edge spanning y1..y2 (0 inside the flat floor). */
export function slopeRestZ(wings, W, y1, y2) {
	let z = 0;
	for (const w of wings ?? []) {
		if (!(w.overhang_mm > 0) || !(w.height_mm > 0)) continue;
		const into = w.side === 'y+' ? y2 - (W - w.overhang_mm) : w.overhang_mm - y1;
		if (into > 0) z = Math.max(z, w.height_mm * Math.min(1, into / w.overhang_mm));
	}
	return z;
}

/** Highest top allowed for a box spanning y1..y2 under a chamfered roof. */
function chamferCeiling(ch, cap, W, y1, y2) {
	if (!ch || !(ch.inset_mm > 0)) return cap;
	const rise = cap - ch.start_height_mm;
	if (rise <= 0) return cap;
	const into = ch.side === 'y+' ? Math.min(y2, W) - (W - ch.inset_mm) : ch.inset_mm - Math.max(y1, 0);
	return into <= 0 ? cap : cap - (Math.min(into, ch.inset_mm) * rise) / ch.inset_mm;
}

/** A floor item leaning on a slope: its outer bottom edge on the slope, most of it over the flat floor. */
function leansOnSlope(vehicle, a) {
	const wings = vehicle.wings;
	if (!wings?.length || a.z <= 0) return false;
	const W = vehicle.width_mm, rest = slopeRestZ(wings, W, a.y, a.y + a.eW);
	if (rest <= 0 || Math.abs(a.z - rest) > RULES.TOL_MM + 0.5 || a.z > RULES.WING_LEAN_MAX * a.eW + RULES.TOL_MM) return false;
	const [lo, hi] = wingYRange(wings, W, 0), cy = a.y + a.eW / 2;
	return (Math.min(a.y + a.eW, hi) - Math.max(a.y, lo)) / a.eW >= RULES.WING_LEAN_FLOOR_SHARE && cy >= lo && cy <= hi;
}

// ── physics ──────────────────────────────────────────────────────────────────

/** Overlap, bounds, contour, height, support, crush, stacking base, payload. */
function physics(vehicle, P, support) {
	const TOL = RULES.TOL_MM;
	const out = { overlap: [], outOfBounds: [], outOfContour: [], overHeight: [], floating: [], crush: [], badBase: [], overPayload: [] };
	const adv = { floorLoad: [] };
	for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) {
		const A = P[a], B = P[b];
		if (A.x < B.x + B.eL - TOL && A.x + A.eL > B.x + TOL && A.y < B.y + B.eW - TOL && A.y + A.eW > B.y + TOL && A.z < B.z + B.eH - TOL && A.z + A.eH > B.z + TOL) out.overlap.push([A.it.id, B.it.id]);
	}
	for (const a of P) {
		const edge = TOL + (vehicle.kind === 'pallet' ? RULES.PALLET_OVERHANG_MM : 0);
		if (a.x < -edge || a.y < -edge || a.x + a.eL > vehicle.length_mm + edge || a.y + a.eW > vehicle.width_mm + edge) out.outOfBounds.push(a.it.id);
		else if (vehicle.wings?.length || vehicle.chamfer) {
			const [lo, hi] = wingYRange(vehicle.wings, vehicle.width_mm, Math.max(0, a.z));
			if (a.y < lo - TOL || a.y + a.eW > hi + TOL || a.z + a.eH > chamferCeiling(vehicle.chamfer, vehicle.height_mm, vehicle.width_mm, a.y, a.y + a.eW) + TOL) out.outOfContour.push(a.it.id);
		}
		if (a.z < -TOL || a.z + a.eH > vehicle.height_mm + TOL) out.overHeight.push(a.it.id);
		if (a.z > 0 && leansOnSlope(vehicle, a)) {
			// nothing else may be under it: it rests on the slope, not on cargo
			if (P.some((b) => b !== a && b.z < a.z - TOL && b.z + b.eH > TOL && a.x < b.x + b.eL - TOL && b.x < a.x + a.eL - TOL && a.y < b.y + b.eW - TOL && b.y < a.y + a.eW - TOL)) out.floating.push(a.it.id);
		} else if (a.z > 0) {
			let sup = 0;
			for (const b of P) {
				if (b === a || Math.abs(b.z + b.eH - a.z) >= TOL) continue;
				const ox = Math.min(a.x + a.eL, b.x + b.eL) - Math.max(a.x, b.x), oy = Math.min(a.y + a.eW, b.y + b.eW) - Math.max(a.y, b.y);
				sup += Math.max(0, ox) * Math.max(0, oy);
			}
			if (sup < support * a.eL * a.eW) out.floating.push(a.it.id);
		} else if (vehicle.max_floor_load_kg_m2) {
			const m2 = (a.eL / 1000) * (a.eW / 1000);
			if (m2 > 0 && a.it.kg / m2 > vehicle.max_floor_load_kg_m2 + 1) adv.floorLoad.push(a.it.id);
		}
		// Crush: everything at or above a's top that overlaps its footprint, against max_stack_kg.
		if (a.it.max_stack_kg != null) {
			let on = 0; const top = a.z + a.eH;
			for (const b of P) { if (b === a || b.z + TOL < top) continue; if (a.x < b.x + b.eL && a.x + a.eL > b.x && a.y < b.y + b.eW && a.y + a.eW > b.y) on += b.it.kg ?? 0; }
			if (on > a.it.max_stack_kg + TOL) out.crush.push(a.it.id);
		}
	}
	// Nothing rests on a non-stackable item, or on a fragile one without a max_stack_kg above 0.
	for (const a of P) {
		if (a.it.stackable !== false && !(a.it.fragile && !((a.it.max_stack_kg ?? 0) > 0))) continue;
		const top = a.z + a.eH;
		if (P.some((b) => b !== a && Math.abs(b.z - top) < TOL && b.x < a.x + a.eL - TOL && a.x < b.x + b.eL - TOL && b.y < a.y + a.eW - TOL && a.y < b.y + b.eW - TOL)) out.badBase.push(a.it.id);
	}
	const kg = P.reduce((s, p) => s + (p.it.kg ?? 0), 0);
	if (vehicle.max_payload_kg && kg > vehicle.max_payload_kg + TOL) out.overPayload.push(`${Math.round(kg)} kg > ${vehicle.max_payload_kg} kg`);
	return { out, adv };
}

/** light / normal / heavy, over the WHOLE manifest (placed or not). */
export function loadProfile(vehicle, items) {
	if (!items.length) return 'light';
	let kg = 0, vol = 0, maxKg = 0;
	for (const i of items) { kg += i.kg; vol += i.l * i.w * i.h; maxKg = Math.max(maxKg, i.kg); }
	const wShare = vehicle.max_payload_kg > 0 ? kg / vehicle.max_payload_kg : 0;
	const vShare = vol / (vehicle.length_mm * vehicle.width_mm * vehicle.height_mm);
	if (wShare < RULES.LIGHT_WEIGHT_SHARE && vShare < RULES.LIGHT_VOLUME_SHARE && maxKg < RULES.LIGHT_MAX_ITEM_KG) return 'light';
	if (wShare >= 0.8 || vShare >= 0.8) return 'heavy';
	return 'normal';
}

/** CoG of cargo + tare (tare as a point mass at the floor centre). Longitudinal % from the doors. */
export function centreOfGravity(vehicle, P) {
	const tare = vehicle.tare_kg ?? 0;
	let m = tare, mx = tare * vehicle.length_mm / 2, my = tare * vehicle.width_mm / 2;
	for (const p of P) { m += p.it.kg; mx += (p.x + p.eL / 2) * p.it.kg; my += (p.y + p.eW / 2) * p.it.kg; }
	if (m === 0) return null;
	return { longitudinal_pct: (mx / m / vehicle.length_mm) * 100, lateral_pct: (my / m / vehicle.width_mm) * 100, total_kg: m };
}

/** Kingpin and bogie loads (simply supported beam), cargo + tare. */
export function axleLoads(vehicle, totalKg, cogFromFrontMm) {
	const k = vehicle.kingpin_from_front_mm, b = vehicle.bogie_from_front_mm, span = b - k;
	if (span <= 0 || totalKg === 0) return { kingpin_kg: 0, bogie_kg: 0 };
	const bogie = (totalKg * (cogFromFrontMm - k)) / span;
	return { kingpin_kg: totalKg - bogie, bogie_kg: bogie };
}

/** Axle overload (trucks) and CoG outside the red band. Skipped on a light load. */
function balance(vehicle, items, P) {
	const out = { axle: [], cog: [] };
	const profile = loadProfile(vehicle, items);
	const cog = P.length ? centreOfGravity(vehicle, P) : null;
	const info = { profile, cog: cog && { longitudinal_pct: +cog.longitudinal_pct.toFixed(2), lateral_pct: +cog.lateral_pct.toFixed(2) } };
	if (!cog || profile === 'light') return { out, info };
	if (vehicle.kind === 'truck') {
		const total = P.reduce((s, p) => s + p.it.kg, 0) + (vehicle.tare_kg ?? 0);
		// An axle whose limit is at least the whole weight can never be overloaded.
		const constrained = !(total <= vehicle.max_kingpin_kg && total <= vehicle.max_bogie_kg);
		const a = axleLoads(vehicle, total, (1 - cog.longitudinal_pct / 100) * vehicle.length_mm);
		info.axle = { kingpin_kg: Math.round(a.kingpin_kg), bogie_kg: Math.round(a.bogie_kg) };
		if (constrained && a.kingpin_kg > vehicle.max_kingpin_kg) out.axle.push(`kingpin ${Math.round(a.kingpin_kg)} kg > ${vehicle.max_kingpin_kg} kg`);
		if (constrained && a.bogie_kg > vehicle.max_bogie_kg) out.axle.push(`bogie ${Math.round(a.bogie_kg)} kg > ${vehicle.max_bogie_kg} kg`);
	} else if (cog.longitudinal_pct < RULES.COG_LONG_MIN || cog.longitudinal_pct > RULES.COG_LONG_MAX) {
		out.cog.push(`longitudinal ${cog.longitudinal_pct.toFixed(1)} % from the doors, outside ${RULES.COG_LONG_MIN}-${RULES.COG_LONG_MAX}`);
	}
	if (cog.lateral_pct < RULES.COG_LAT_MIN || cog.lateral_pct > RULES.COG_LAT_MAX) out.cog.push(`lateral ${cog.lateral_pct.toFixed(1)} %, outside ${RULES.COG_LAT_MIN}-${RULES.COG_LAT_MAX}`);
	return { out, info };
}

/** Braced width of an item: the narrower side of the bounding box of its block,
 *  the items standing at the same z that touch it side to side (gap at most
 *  SLENDER_OVERLAP_TOL_MM, faces overlapping by more than that), each reaching
 *  at least half its height, chained. Walls do not count. A lone item's braced
 *  width is its own narrower side. */
function bracedWidth(P, s) {
	const T = RULES.SLENDER_OVERLAP_TOL_MM;
	const touches = (a, b) => {
		const ox = Math.min(a.x + a.eL, b.x + b.eL) - Math.max(a.x, b.x), oy = Math.min(a.y + a.eW, b.y + b.eW) - Math.max(a.y, b.y);
		return (ox > T && oy > -T && oy <= T) || (oy > T && ox > -T && ox <= T);
	};
	const seen = new Set([s]), stack = [s];
	let x0 = s.x, x1 = s.x + s.eL, y0 = s.y, y1 = s.y + s.eW;
	while (stack.length) {
		const c = stack.pop();
		for (const b of P) {
			if (seen.has(b) || Math.abs(b.z - s.z) >= 1 || b.eH < c.eH / 2 || c.eH < b.eH / 2 || !touches(c, b)) continue;
			seen.add(b); stack.push(b);
			x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.eL); y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y + b.eW);
		}
	}
	return Math.min(x1 - x0, y1 - y0);
}

/** Slender piles: a run of comparable items standing on another item's top may
 *  be at most SLENDER_RATIO times its narrowest braced width tall (the block
 *  each level stands in, see bracedWidth). A run that reaches the deck, and a
 *  lone item on a proper base, are not judged. */
function slenderPiles(P) {
	const T = RULES.SLENDER_OVERLAP_TOL_MM;
	const bad = [];
	for (const s of P) {
		if (s.z <= 0) continue;
		const minDim = Math.min(s.eL, s.eW);
		let runBottom = s.z, runMin = bracedWidth(P, s);
		for (let guard = 0; guard < 64 && runBottom > 0; guard++) {
			let below = null;
			for (const p of P) {
				if (p === s || Math.abs(p.z + p.eH - runBottom) >= 1) continue;
				if (!(s.x < p.x + p.eL - T && s.x + s.eL > p.x + T && s.y < p.y + p.eW - T && s.y + s.eW > p.y + T)) continue;
				if (!below || p.eL * p.eW > below.eL * below.eW) below = p;
			}
			if (!below) break;
			const bMin = Math.min(below.eL, below.eW);
			if (bMin > minDim * RULES.SLENDER_BASE_FACTOR) break;
			runMin = Math.min(runMin, bracedWidth(P, below));
			runBottom = below.z;
		}
		if (runBottom <= 0 || runBottom === s.z) continue;
		if (s.z + s.eH - runBottom > RULES.SLENDER_RATIO * runMin) bad.push(s.it.id);
	}
	return bad;
}

/** Loading doctrine on the floor layer. Hard: the load splits into islands, or
 *  same-footprint near-full-width items do not line up. Advisory: not anchored
 *  to an end wall, too many lateral gaps. */
function doctrine(vehicle, P) {
	const floor = P.filter((p) => p.z === 0).map((p) => ({ x0: p.x, x1: p.x + p.eL, y0: p.y, y1: p.y + p.eW, l: p.eL, w: p.eW }));
	const hard = { islands: [], misalignedRuns: [] };
	const adv = { notAnchored: [], lateralGaps: [] };
	if (!floor.length) return { hard, adv };
	const minX = Math.min(...floor.map((f) => f.x0)), maxX = Math.max(...floor.map((f) => f.x1));
	const anchorGap = Math.round(Math.min(minX, vehicle.length_mm - maxX));
	if (anchorGap > RULES.ANCHOR_MAX_MM) adv.notAnchored.push(`${anchorGap} mm from the nearest end wall`);
	let worstGaps = 0;
	for (let x = minX + 100; x < maxX; x += 200) {
		const cov = floor.filter((f) => f.x0 <= x && f.x1 > x).map((f) => [f.y0, f.y1]).sort((a, b) => a[0] - b[0]);
		if (!cov.length) continue;
		let gaps = 0, cur = 0;
		for (const [a, b] of cov) { if (a - cur > RULES.LATERAL_GAP_MM) gaps++; cur = Math.max(cur, b); }
		if (vehicle.width_mm - cur > RULES.LATERAL_GAP_MM) gaps++;
		worstGaps = Math.max(worstGaps, gaps);
	}
	if (worstGaps > RULES.LATERAL_GAPS_MAX) adv.lateralGaps.push(`${worstGaps} gaps in one cross-section`);
	const xs = floor.map((f) => [f.x0, f.x1]).sort((a, b) => a[0] - b[0]);
	let islands = 1, reach = xs[0][1];
	for (const [a, b] of xs.slice(1)) { if (a - reach > RULES.ISLAND_GAP_MM) islands++; reach = Math.max(reach, b); }
	const maxIslands = RULES.ISLANDS_MAX[vehicle.kind === 'truck' || vehicle.kind === 'pallet' ? vehicle.kind : 'container'];
	if (islands > maxIslands) hard.islands.push(`${islands} floor islands (max ${maxIslands})`);
	const runs = new Map();
	for (const f of floor) {
		if (f.w < RULES.RUN_MIN_WIDTH_SHARE * vehicle.width_mm) continue;
		const k = `${Math.round(f.l / RULES.RUN_DIM_BUCKET_MM)}x${Math.round(f.w / RULES.RUN_DIM_BUCKET_MM)}`;
		if (!runs.has(k)) runs.set(k, []);
		runs.get(k).push(f.y0);
	}
	for (const [k, ys] of runs) if (ys.length > 1 && new Set(ys.map((y) => Math.round(y / RULES.RUN_Y_BUCKET_MM))).size > 1) hard.misalignedRuns.push(`footprint ${k} (cm) at ${ys.length} items, not in line`);
	return { hard, adv };
}

/** Advisory: items that would tip under the design accelerations, standing at an
 *  open edge of their block, at least TIP_WARN_RATIO x the limit and TIP_WARN_KG heavy. */
function tipOver(vehicle, P) {
	const mode = vehicle.kind === 'truck' ? 'truck' : 'container';
	const a = RULES.TIP_ACCEL[mode], T = RULES.TIP_TOUCH_MM;
	const W = vehicle.width_mm, L = vehicle.length_mm;
	const B = P.map((p) => ({ p, x0: p.x, x1: p.x + p.eL, y0: p.y, y1: p.y + p.eW, z0: p.z, z1: p.z + p.eH }));
	const cross = (s, b, axis) => axis === 'y'
		? Math.min(b.x1, s.x1) - Math.max(b.x0, s.x0) >= 0.5 * Math.min(b.x1 - b.x0, s.x1 - s.x0)
		: Math.min(b.y1, s.y1) - Math.max(b.y0, s.y0) >= 0.5 * Math.min(b.y1 - b.y0, s.y1 - s.y0);
	const lo = (b, axis) => (axis === 'y' ? b.y0 : b.x0), hi = (b, axis) => (axis === 'y' ? b.y1 : b.x1);
	const extent = (s, axis) => {
		const mid = s.z0 + (s.z1 - s.z0) / 2;
		const seen = new Set([s]), stack = [s];
		let mn = lo(s, axis), mx = hi(s, axis);
		while (stack.length) {
			const c = stack.pop();
			for (const b of B) {
				if (seen.has(b) || !cross(s, b, axis) || !(b.z0 <= s.z0 + T && b.z1 >= mid)) continue;
				if (Math.abs(lo(b, axis) - hi(c, axis)) > T && Math.abs(hi(b, axis) - lo(c, axis)) > T) continue;
				seen.add(b); stack.push(b); mn = Math.min(mn, lo(b, axis)); mx = Math.max(mx, hi(b, axis));
			}
		}
		return [mn, mx];
	};
	const openEdge = (s, axis) => {
		const mid = s.z0 + (s.z1 - s.z0) / 2;
		const a0 = lo(s, axis), a1 = hi(s, axis), end = axis === 'y' ? W : L;
		const nb = (b, low) => b !== s && cross(s, b, axis) && b.z0 <= s.z0 + T && b.z1 >= mid && (low ? Math.abs(hi(b, axis) - a0) <= T : Math.abs(lo(b, axis) - a1) <= T);
		return (a0 > T && !B.some((b) => nb(b, true))) || (a1 < end - T && !B.some((b) => nb(b, false)));
	};
	const out = [];
	for (const s of B) {
		const h = s.z1 - s.z0;
		if (h <= Math.min(s.x1 - s.x0, s.y1 - s.y0) / Math.max(a.side, a.forward)) continue;
		const fails = [];
		const [y0, y1] = extent(s, 'y');
		if (!(y0 <= T && y1 >= W - T) && h / (y1 - y0) > 1 / a.side) fails.push({ dir: 'side', ratio: h / (y1 - y0), limit: 1 / a.side });
		const [x0, x1] = extent(s, 'x');
		if (x1 < L - T && h / (x1 - x0) > 1 / a.forward) fails.push({ dir: 'forward', ratio: h / (x1 - x0), limit: 1 / a.forward });
		if (h / (x1 - x0) > 1 / a.rear) fails.push({ dir: 'rear', ratio: h / (x1 - x0), limit: 1 / a.rear });
		if (!fails.length) continue;
		const w = fails.reduce((p, c) => (c.ratio / c.limit > p.ratio / p.limit ? c : p));
		const ratio = Math.round(w.ratio * 100) / 100, limit = Math.round(w.limit * 100) / 100;
		if (openEdge(s, w.dir === 'side' ? 'y' : 'x') && ratio / limit >= RULES.TIP_WARN_RATIO && s.p.it.kg >= RULES.TIP_WARN_KG) out.push(`${s.p.it.id} ${w.dir} ${ratio} > ${limit}`);
	}
	return out;
}

/** Pallet pattern: share of the items above the bottom layer that rest on at
 *  least two distinct items directly below (each overlapped by more than
 *  INTERLOCK_MIN_MM both ways). A column stack scores 0, a fully interlocked
 *  build 100. Scored only on pallet cases; it never makes a plan illegal. */
export function interlock(P) {
	const T = RULES.INTERLOCK_MIN_MM;
	let upper = 0, tied = 0;
	for (const a of P) {
		if (a.z <= 0) continue;
		upper++;
		let n = 0;
		for (const b of P) {
			if (b === a || Math.abs(b.z + b.eH - a.z) >= RULES.TOL_MM) continue;
			const ox = Math.min(a.x + a.eL, b.x + b.eL) - Math.max(a.x, b.x), oy = Math.min(a.y + a.eW, b.y + b.eW) - Math.max(a.y, b.y);
			if (ox > T && oy > T && ++n >= 2) break;
		}
		if (n >= 2) tied++;
	}
	return { upper, tied, pct: upper ? Math.round((tied / upper) * 1000) / 10 : 0 };
}

/** Pallet cases describe the deck: bounds are the deck, the height cap is the
 *  cargo height above it, the payload is the pallet's rated load. */
function normalizeVehicle(v) {
	if (v.kind !== 'pallet') return v;
	return {
		...v,
		height_mm: v.height_mm ?? v.max_build_height_mm - (v.base_height_mm ?? 0),
		max_payload_kg: v.max_payload_kg ?? v.max_weight_kg,
		tare_kg: v.tare_kg ?? 0,
	};
}

// ── entry point ──────────────────────────────────────────────────────────────

/**
 * @param {{vehicle: object, items: object[], placements: object[]}} input
 *   vehicle: { kind: 'container'|'truck'|'uld'|'pallet', length_mm, width_mm, height_mm, max_payload_kg, tare_kg,
 *              max_floor_load_kg_m2?, kingpin_from_front_mm?, bogie_from_front_mm?, max_kingpin_kg?, max_bogie_kg?,
 *              wings?: [{side:'y+'|'y-', overhang_mm, height_mm}], chamfer?: {side, inset_mm, start_height_mm},
 *              pallet: max_build_height_mm + base_height_mm (cap = difference), max_weight_kg }
 *   items:   [{ id, l, w, h, kg, stackable, max_stack_kg|null, fragile, tiltable }]
 *   placements: [{ id, x, y, z, dx, dy, dz }] in the answer frame (x from the front wall)
 * @param {{support?: number}} [opts] support share, default 0.95
 */
export function validatePlan({ vehicle: rawVehicle, items, placements }, opts = {}) {
	const vehicle = normalizeVehicle(rawVehicle);
	const support = opts.support ?? RULES.SUPPORT_DEFAULT;
	const { boxes: P, faults, missing } = readAnswer(vehicle, items, placements);
	const { out: phys, adv: physAdv } = physics(vehicle, P, support);
	const { out: bal, info } = balance(vehicle, items, P);
	const slender = slenderPiles(P);
	const doc = doctrine(vehicle, P);
	const tips = tipOver(vehicle, P);

	const violations = { ...faults, ...phys, axle: bal.axle, cog: bal.cog, slenderPile: slender };
	const doctrineHard = doc.hard;
	const advisory = { floorLoad: physAdv.floorLoad, notAnchored: doc.adv.notAnchored, lateralGaps: doc.adv.lateralGaps, tipOver: tips };
	const count = (o) => Object.values(o).reduce((s, v) => s + v.length, 0);
	const nViol = count(violations), nDoc = count(doctrineHard);

	let mn = Infinity, mx = -Infinity, top = 0;
	for (const p of P) { mn = Math.min(mn, p.x); mx = Math.max(mx, p.x + p.eL); top = Math.max(top, p.z + p.eH); }
	return {
		validator: VERSION, support,
		legal: nViol === 0,
		legalDoctrine: nViol === 0 && nDoc === 0,
		placed: P.length, n: items.length, missing,
		ldm_mm: mx > mn ? Math.round(mx - mn) : 0, // frontmost to rearmost cargo face
		height_mm: Math.round(top),
		violations, doctrine: doctrineHard, advisory, ...info,
		...(vehicle.kind === 'pallet' ? { interlock: interlock(P) } : {}),
	};
}

/** Short list of the rules an answer breaks, for logs. */
export function summarize(r) {
	const parts = [];
	for (const [k, v] of Object.entries(r.violations)) if (v.length) parts.push(`${k}=${v.length}`);
	for (const [k, v] of Object.entries(r.doctrine)) if (v.length) parts.push(`doctrine.${k}=${v.length}`);
	return parts.join(' ') || 'ok';
}
