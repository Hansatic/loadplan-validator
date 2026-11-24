// Re-judges every published r10 answer with validate.mjs and checks the result
// against the published verdict: legal or not, and the LDM of each legal plan.
// Run: node verify-r10.mjs        (add --verbose to print every answer)
import { readFileSync } from 'node:fs';
import { validatePlan, summarize, VERSION } from './validate.mjs';

const here = new URL('.', import.meta.url);
const { cases } = JSON.parse(readFileSync(new URL('data/r10/cases.json', here), 'utf8'));
const { runs } = JSON.parse(readFileSync(new URL('data/r10/answers.json', here), 'utf8'));
const byId = new Map(cases.map((c) => [c.case_id, c]));
const verbose = process.argv.includes('--verbose');

let judged = 0, agree = 0, noAnswer = 0;
for (const run of runs) {
	const c = byId.get(run.case_id);
	for (const a of run.answers) {
		if (!a.placements) { noAnswer++; continue; }
		judged++;
		const r = validatePlan({ vehicle: c.vehicle, items: c.items, placements: a.placements });
		const published = a.status === 'legal';
		const same = r.legal === published && (!published || r.ldm_mm === a.ldm_mm);
		if (same) agree++;
		if (verbose || !same) {
			console.log(`${same ? 'ok  ' : 'DIFF'} ${run.key.padEnd(16)} ${a.label.padEnd(20)} published ${a.status}${published ? ` ${a.ldm_mm} mm` : ''}, now ${r.legal ? `legal ${r.ldm_mm} mm` : summarize(r)}`);
		}
	}
}
console.log(`validator ${VERSION}: ${agree}/${judged} published verdicts reproduced (${noAnswer} entries had no parseable answer)`);
process.exit(agree === judged ? 0 : 1);
