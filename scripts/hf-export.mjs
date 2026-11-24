// Builds the Hugging Face dataset (hansatic/loadbench-r10) from data/r10.
//   node scripts/hf-export.mjs   writes dist/hf-dataset/
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { validatePlan, summarize, VERSION } from '../validate.mjs';

const root = new URL('../', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const { cases, date } = read('data/r10/cases.json');
const { runs } = read('data/r10/answers.json');
const prompts = read('data/r10/prompts.json').runs;
const byCase = new Map(cases.map((c) => [c.case_id, c]));

const out = new URL('dist/hf-dataset/', root);
mkdirSync(new URL('data/', out), { recursive: true });
const jsonl = (name, rows) => writeFileSync(new URL(`data/${name}.jsonl`, out), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

// Vehicles differ by kind (container, truck, ULD contour, pallet), so the
// vehicle travels as a JSON string to keep one schema across rows.
jsonl('cases', cases.map((c) => ({ case_id: c.case_id, type: c.type, vehicle_kind: c.vehicle.kind, vehicle: JSON.stringify(c.vehicle), n_items: c.items.length, items: c.items })));

jsonl('prompts', prompts.map((p) => ({ run: p.key, case_id: p.case_id, objective: p.objective, system: p.system, user: p.user })));

const answers = [];
for (const r of runs) {
	const c = byCase.get(r.case_id);
	for (const a of r.answers) {
		const has = Array.isArray(a.placements) && a.placements.length > 0;
		const v = has ? validatePlan({ vehicle: c.vehicle, items: c.items, placements: a.placements }) : null;
		answers.push({
			run: r.key, case_id: r.case_id, objective: r.objective,
			entrant: a.label, is_engine: !!a.engine, status: a.status,
			placed: a.placed, ldm_mm: a.ldm_mm, height_mm: a.height_mm, pallets: a.pallets,
			validator_summary: v ? summarize(v) : null,
			placements: has ? a.placements : [],
		});
	}
}
jsonl('answers', answers);

copyFileSync(new URL('LICENSE.md', root), new URL('LICENSE.md', out));
writeFileSync(new URL('README.md', out), readFileSync(new URL('scripts/hf-dataset-card.md', root), 'utf8').replace(/\{\{VERSION\}\}/g, VERSION).replace(/\{\{DATE\}\}/g, date));
console.log(`dist/hf-dataset: ${cases.length} cases, ${prompts.length} prompts, ${answers.length} answers`);
