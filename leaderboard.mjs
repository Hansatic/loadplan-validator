// Builds the leaderboard in README.md from the official r10 answers and every
// community submission in submissions/. Every answer is re-judged here by
// validate.mjs: no score is ever typed in by hand.
//
//   node leaderboard.mjs           rewrite the leaderboard section of README.md
//   node leaderboard.mjs --check   fail if a submission is malformed or README.md is out of date (CI)
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { validatePlan, summarize, VERSION } from './validate.mjs';

const here = new URL('.', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, here), 'utf8'));
const { cases } = read('data/r10/cases.json');
const { runs } = read('data/r10/answers.json');
const byCase = new Map(cases.map((c) => [c.case_id, c]));

// The pallet-position count is not in validate.mjs (see README), so the 5
// "pallets" runs can only be ranked in official rounds. The board uses the rest.
const SCORED = runs.filter((r) => r.objective !== 'pallets');
const SCORED_KEYS = new Set(SCORED.map((r) => r.key));
const ALL_KEYS = new Set(runs.map((r) => r.key));
const ENGINE = 'Hansatic engine';

/** The official r10 ranking of one run: legal first, then items placed, then the
 *  objective (ldm: shorter; interlock: higher share, then lower build; count:
 *  placed only). > 0 when a beats b. Illegal and missing answers rank equal, last. */
function compare(a, b, objective) {
	const obj = (s) => (objective === 'count' ? [] : objective === 'interlock' ? [s.interlock_pct, -s.height_mm] : [-s.ldm_mm]);
	const key = (s) => (s.legal ? [1, s.placed, ...obj(s)] : [0, 0, ...obj(s).map(() => 0)]);
	const ka = key(a), kb = key(b);
	for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
	return 0;
}

const NONE = { answered: false, legal: false, placed: 0, ldm_mm: 0, height_mm: 0, interlock_pct: 0 };
function judge(run, placements) {
	if (!Array.isArray(placements)) return NONE;
	const c = byCase.get(run.case_id);
	const r = validatePlan({ vehicle: c.vehicle, items: c.items, placements });
	return { answered: true, legal: r.legal, placed: r.placed, ldm_mm: r.ldm_mm, height_mm: r.height_mm, interlock_pct: r.interlock?.pct ?? 0, why: r.legal ? '' : summarize(r) };
}

// ── entrants ────────────────────────────────────────────────────────────────
const errors = [];
const entrants = [];

const labels = [...new Set(runs.flatMap((r) => r.answers.map((a) => a.label)))];
for (const label of labels) {
	const answers = {};
	for (const r of runs) answers[r.key] = r.answers.find((a) => a.label === label)?.placements ?? null;
	entrants.push({ name: label, source: label === ENGINE ? 'reference' : 'official', date: label === ENGINE ? '2026-11-20' : '2026-11-11', prompt: 'standard', answers });
}

const SUB = new URL('submissions/', here);
const META_FIELDS = ['model', 'submitted_by', 'date', 'prompt'];
const dirs = existsSync(SUB) ? readdirSync(SUB).filter((d) => statSync(new URL(d, SUB)).isDirectory()).sort() : [];
for (const d of dirs) {
	const at = `submissions/${d}`;
	if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(d)) { errors.push(`${at}: folder name must be lowercase letters, digits, '.', '_' or '-'`); continue; }
	let meta, ans;
	try { meta = read(`${at}/meta.json`); } catch (e) { errors.push(`${at}/meta.json: ${e.message}`); continue; }
	try { ans = read(`${at}/answers.json`); } catch (e) { errors.push(`${at}/answers.json: ${e.message}`); continue; }
	for (const f of META_FIELDS) if (typeof meta[f] !== 'string' || !meta[f].trim()) errors.push(`${at}/meta.json: "${f}" is required`);
	if (meta.date && !/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) errors.push(`${at}/meta.json: "date" must be YYYY-MM-DD`);
	if (meta.prompt && !['standard', 'modified'].includes(meta.prompt)) errors.push(`${at}/meta.json: "prompt" must be "standard" or "modified"`);
	if (meta.prompt === 'modified' && !(typeof meta.prompt_notes === 'string' && meta.prompt_notes.trim())) errors.push(`${at}/meta.json: "prompt_notes" must say how the prompt was modified`);
	const list = ans?.runs;
	if (!list || typeof list !== 'object' || Array.isArray(list)) { errors.push(`${at}/answers.json: expected { "runs": { "<run key>": { "placements": [...] } } }`); continue; }
	const answers = {};
	for (const [key, v] of Object.entries(list)) {
		if (!ALL_KEYS.has(key)) { errors.push(`${at}/answers.json: unknown run "${key}"`); continue; }
		if (v !== null && !Array.isArray(v?.placements)) { errors.push(`${at}/answers.json: run "${key}" needs "placements": [...] or null`); continue; }
		answers[key] = v?.placements ?? null;
	}
	entrants.push({ name: meta.model.trim(), source: 'community', date: meta.date, prompt: meta.prompt, by: meta.submitted_by.trim(), link: meta.link, answers, folder: d });
}

// ── scoring ─────────────────────────────────────────────────────────────────
const engine = entrants.find((e) => e.name === ENGINE);
const engineScore = Object.fromEntries(SCORED.map((r) => [r.key, judge(r, engine.answers[r.key])]));
for (const e of entrants) {
	e.scores = {};
	e.legal = 0; e.answered = 0; e.placed = 0; e.w = 0; e.t = 0; e.l = 0;
	for (const r of SCORED) {
		const s = (e.scores[r.key] = judge(r, e.answers[r.key]));
		if (s.answered) e.answered++;
		if (s.legal) { e.legal++; e.placed += s.placed; }
		const v = Math.sign(compare(s, engineScore[r.key], r.objective));
		if (v > 0) e.w++; else if (v === 0) e.t++; else e.l++;
	}
}
const ranked = [...entrants].sort((a, b) => b.legal - a.legal || (b.w + b.t) - (a.w + a.t) || b.placed - a.placed || a.name.localeCompare(b.name));

// ── markdown ────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[|<>]/g, (ch) => ({ '|': '\\|', '<': '&lt;', '>': '&gt;' })[ch]);
const SOURCE = { reference: 'Reference', official: 'Official r10', community: 'Community' };
const N = SCORED.length;
const cell = (s, objective) => (!s.answered ? '-' : !s.legal ? 'illegal' : objective === 'count' ? `${s.placed} placed` : objective === 'interlock' ? `${s.placed} · ${s.interlock_pct} %` : `${s.placed} · ${(s.ldm_mm / 1000).toFixed(2)} m`);

const L = [];
L.push(`Scored on the ${N} r10 runs that \`validate.mjs\` can rank on its own (the ${runs.length - N} pallet-position runs need the closed counter and appear in official rounds only). Validator ${VERSION}, support 95 %. Generated by \`node leaderboard.mjs\`; do not edit by hand.`);
L.push('');
L.push('| # | Entrant | Source | Legal | Answered | vs engine (W / T / L) | Items placed in legal answers | Date | Prompt |');
L.push('|---:|---|---|---:|---:|:---:|---:|---|---|');
ranked.forEach((e, i) => {
	const name = e.link ? `[${esc(e.name)}](${encodeURI(e.link)})` : esc(e.name);
	const src = e.source === 'community' ? `Community (${esc(e.by)})` : SOURCE[e.source];
	const vs = e.source === 'reference' ? '-' : `${e.w} / ${e.t} / ${e.l}`;
	L.push(`| ${i + 1} | ${name} | ${src} | ${e.legal} / ${N} | ${e.answered} / ${N} | ${vs} | ${e.placed} | ${e.date} | ${e.prompt} |`);
});
L.push('');
L.push('**How to read it.** Ranked by legal answers, then by runs where the entrant matches or beats the engine, then by items placed. *vs engine* applies the official r10 ranking to each run: legal first, then more items placed, then the objective (shorter load; for the pallet run, higher interlock share). A missing or illegal answer loses to a legal one. Official and reference rows were run by Hansatic with the standard prompt; community rows were run by the submitter and re-judged here.');
L.push('');
L.push('<details><summary>Per run</summary>');
L.push('');
L.push(`| Run | ${ranked.map((e) => esc(e.name)).join(' | ')} |`);
L.push(`|---|${ranked.map(() => '---').join('|')}|`);
for (const r of SCORED) L.push(`| ${r.key} | ${ranked.map((e) => cell(e.scores[r.key], r.objective)).join(' | ')} |`);
L.push('');
L.push('Cells: items placed · loading metres (or interlock share), `illegal`, or `-` for no answer.');
L.push('');
L.push('</details>');
const board = L.join('\n');

const README = new URL('README.md', here);
const readme = readFileSync(README, 'utf8');
const START = '<!-- leaderboard:start -->', END = '<!-- leaderboard:end -->';
const a = readme.indexOf(START), b = readme.indexOf(END);
if (a < 0 || b < a) { console.error('README.md has no leaderboard markers'); process.exit(2); }
const next = `${readme.slice(0, a + START.length)}\n${board}\n${readme.slice(b)}`;

for (const e of entrants.filter((x) => x.source === 'community')) {
	console.log(`${e.folder}: ${e.legal}/${N} legal, ${e.answered}/${N} answered, vs engine ${e.w}/${e.t}/${e.l}`);
	for (const r of SCORED) if (e.scores[r.key].answered && !e.scores[r.key].legal) console.log(`  ${r.key}: illegal (${e.scores[r.key].why})`);
}
if (errors.length) { for (const m of errors) console.error(`ERROR ${m}`); process.exit(1); }
if (process.argv.includes('--check')) {
	if (next.replace(/\r\n/g, '\n') !== readme.replace(/\r\n/g, '\n')) { console.error('README.md leaderboard is out of date: run `node leaderboard.mjs` and commit README.md'); process.exit(1); }
	console.log(`leaderboard up to date: ${entrants.length} entrants`);
} else {
	writeFileSync(README, next);
	console.log(`leaderboard written: ${entrants.length} entrants`);
}
