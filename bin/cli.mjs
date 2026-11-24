#!/usr/bin/env node
// Judge one answer: node bin/cli.mjs <case.json> <answer.json> [--support 0.95]
//   case.json:   { vehicle, items }   (one case from data/r10/cases.json has this shape)
//   answer.json: { placements: [{ id, x, y, z, dx, dy, dz }] }
// Prints the full verdict as JSON. Exit code 0 when legal, 1 when not, 2 on bad input.
import { readFileSync } from 'node:fs';
import { validatePlan } from '../validate.mjs';

const args = process.argv.slice(2);
const sIdx = args.indexOf('--support');
const support = sIdx >= 0 ? Number(args.splice(sIdx, 2)[1]) : undefined;
const [casePath, answerPath] = args;
if (!casePath || !answerPath || (support !== undefined && !(support > 0 && support <= 1))) {
	console.error('usage: node bin/cli.mjs <case.json> <answer.json> [--support 0.95]');
	process.exit(2);
}
let c, a;
try {
	c = JSON.parse(readFileSync(casePath, 'utf8'));
	a = JSON.parse(readFileSync(answerPath, 'utf8'));
} catch (e) {
	console.error(String(e.message ?? e));
	process.exit(2);
}
const r = validatePlan({ vehicle: c.vehicle, items: c.items, placements: a.placements ?? a }, { support });
console.log(JSON.stringify(r, null, 2));
process.exit(r.legal ? 0 : 1);
