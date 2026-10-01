// Consistency of docs/test-manifest.html (CLAUDE.md §12: every work package updates the manifest).
// The manifest keeps its cases and work packages as JSON in <script type="application/json" id="manifest-data">,
// so this test reads them without a browser. The page computes its head (status line, open manual checks,
// package table) and its review mode (results of the user in localStorage, report, filters, stale entries) with
// the pure functions in <script id="manifest-logic">; the test runs that block in node:vm and checks the numbers
// against an independent count. One test loads the whole page in jsdom.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const MANIFEST_PATH = 'docs/test-manifest.html';
const html = readFileSync(new URL(MANIFEST_PATH, ROOT), 'utf8');

const ARTS = ['unit', 'komponente', 'integration', 'manuell'];
const STATUSES = ['bestanden', 'offen', 'geplant', 'zurückgestellt', 'nicht zutreffend'];
// Three or four digits: the numbers of E6 passed 999 (BYL-E6-1000 ff., plan speicher); a range
// compares them as numbers, never as text.
const ID_PATTERN = /^BYL-(E\d|X)-\d{3,4}$/;
const RANGE_PATTERN = /^(BYL-(?:E\d|X))-(\d{3,4})\.\.(BYL-(?:E\d|X))-(\d{3,4})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ADR_PATTERN = /^(\d{4}-[a-z0-9-]+\.md)(, .+)?$/;
const META_KEYS = ['commit', 'projekt', 'stand'];
// The head of the page once was a single paragraph of more than 10 000 characters.
const MAX_TEXT = 300;
const VOID_ELEMENTS = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'source', 'wbr', 'col', 'area', 'base', 'embed', 'track']);
// Words that only occur in the template of another project the manifest was built from.
const TEMPLATE_LEFTOVERS = [/stoqr/i, /\bGlobus\b/, /\bPenny\b/, /\bEAN\b/, /Lagerort/, /Einkaufsliste/, /Vollmilch/, /Märkte/, /Regressions-Report/];

function manifestData() {
	const match = /<script type="application\/json" id="manifest-data">([\s\S]*?)<\/script>/.exec(html);
	if (!match) throw new Error('No manifest-data block in ' + MANIFEST_PATH);
	return JSON.parse(match[1]);
}

function allItems() {
	return manifestData().blocks.flatMap((block) => block.items);
}

/** Markup outside of comments, scripts and styles. */
function markupOnly() {
	return html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '')
		.replace(/<!DOCTYPE[^>]*>/i, '');
}

/** Runs the logic block of the page in a fresh context and returns that context with its functions. */
function pageLogic() {
	const match = /<script id="manifest-logic">([\s\S]*?)<\/script>/.exec(html);
	if (!match) throw new Error('No manifest-logic block in ' + MANIFEST_PATH);
	const context = vm.createContext({});
	vm.runInContext(match[1], context);
	return context;
}

/** Values of the vm context as plain data of this realm. */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** manifestSummary of the page as plain data. */
function pageSummary(data = manifestData()) {
	return plain(pageLogic().manifestSummary(data));
}

/** jsdom of the web package (web/node_modules, a precondition of npm test like the web build); the root has no copy. */
function loadJsdom() {
	const require = createRequire(new URL('web/package.json', ROOT));
	try {
		return require('jsdom');
	} catch (error) {
		throw new Error(`jsdom is missing, run "npm --prefix web ci" first (${error.message})`);
	}
}

/** Independent expansion of the case references of a package ("BYL-E6-100" or "BYL-E6-100..BYL-E6-105"). */
function expandRefs(refs, ids) {
	return ids.filter((id) =>
		refs.some((ref) => {
			const range = RANGE_PATTERN.exec(ref);
			if (!range) return ref === id;
			const cut = id.lastIndexOf('-');
			const [prefix, number] = [id.slice(0, cut), Number(id.slice(cut + 1))];
			return prefix === range[1] && number >= Number(range[2]) && number <= Number(range[4]);
		})
	);
}

const isOpenManual = (item) => item.status === 'offen' && item.art.includes('manuell');

/**
 * Test files the manifest must cover: tests/unit, tests/integration, web/src/**\/*.test.ts, the
 * mail helper helpers/mail/src/**\/*.test.ts, the backup helper helpers/backup/src/**\/*.test.ts
 * (ADR-0046) and the browser extension extensions/whatsapp-web/src/**\/*.test.ts (ADR-0038).
 */
function testFiles() {
	const list = (dir, pattern) =>
		readdirSync(new URL(dir, ROOT), { recursive: true })
			.map((file) => `${dir}/${String(file).replaceAll('\\', '/')}`)
			.filter((file) => pattern.test(file));
	return [
		...list('tests/unit', /\.test\.(js|mjs|ts)$/),
		...list('tests/integration', /\.test\.(js|mjs|ts)$/),
		...list('web/src', /\.test\.ts$/),
		...list('helpers/mail/src', /\.test\.ts$/),
		...list('helpers/backup/src', /\.test\.ts$/),
		...list('extensions/whatsapp-web/src', /\.test\.ts$/)
	].sort();
}

/** Date, ADR files and plan of a package or a deferred topic. */
function expectReferences(entry) {
	if (entry.datum !== undefined) expect(entry.datum, entry.id).toMatch(DATE_PATTERN);
	for (const ref of entry.adr ?? []) {
		const match = ADR_PATTERN.exec(ref);
		expect(match, `${entry.id}: ${ref}`).not.toBeNull();
		expect(existsSync(new URL(`docs/adr/${match[1]}`, ROOT)), `${entry.id}: docs/adr/${match[1]}`).toBe(true);
	}
	if (entry.plan !== undefined) {
		expect(existsSync(new URL(`docs/plan/${entry.plan}`, ROOT)), `${entry.id}: docs/plan/${entry.plan}`).toBe(true);
	}
}

describe('docs/test-manifest.html', () => {
	it('is a well-formed HTML document', () => {
		expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
		expect(html).toMatch(/<html lang="de">/);
		expect(html).toMatch(/<meta charset="utf-8" \/>/);
		for (const tag of ['html', 'head', 'body', 'title']) {
			expect(html.match(new RegExp(`<${tag}[\\s>]`, 'g'))?.length, `<${tag}>`).toBe(1);
		}

		// Tags outside of script and style must nest properly.
		const stack = [];
		for (const [, closing, name, selfClosing] of markupOnly().matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g)) {
			const tag = name.toLowerCase();
			if (VOID_ELEMENTS.has(tag) || selfClosing) continue;
			if (!closing) {
				stack.push(tag);
				continue;
			}
			expect(stack.pop(), `closing </${tag}>`).toBe(tag);
		}
		expect(stack).toEqual([]);
	});

	it('works offline: no external scripts, styles, fonts or images', () => {
		expect(html).not.toMatch(/\b(src|href)\s*=\s*["']?(https?:)?\/\//i);
		expect(html).not.toMatch(/@import|url\(\s*["']?(https?:)?\/\//i);
		expect(html).not.toMatch(/<link\b/i);
	});

	it('has parseable data with project, date and commit', () => {
		const { meta, blocks } = manifestData();
		expect(meta.projekt).toBe('becauseyoulovejira');
		expect(meta.stand).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(meta.commit).toMatch(/^[0-9a-f]{7,40}$/);
		expect(Object.keys(meta).sort(), 'meta holds no free text, the page computes the status').toEqual(META_KEYS);
		expect(blocks.length).toBeGreaterThan(0);
		for (const block of blocks) {
			expect(block.name, 'block name').toBeTruthy();
			expect(block.items.length, block.name).toBeGreaterThan(0);
		}
	});

	it(`keeps the head short: no free-text paragraph over ${MAX_TEXT} characters`, () => {
		const { meta, bereiche, pakete, zurueckgestellt } = manifestData();
		const fields = [
			...Object.values(meta),
			...bereiche.map((area) => area.titel),
			...[...pakete, ...zurueckgestellt].flatMap((entry) => [entry.vorhaben, entry.titel, entry.quelle, entry.vermerk])
		].filter((text) => text !== undefined);
		expect(fields.filter((text) => text.length > MAX_TEXT)).toEqual([]);

		const texts = markupOnly()
			.split(/<[^>]*>/)
			.map((text) => text.replace(/\s+/g, ' ').trim());
		expect(texts.filter((text) => text.length > MAX_TEXT)).toEqual([]);
	});

	it('has unique, well-formed IDs', () => {
		const ids = allItems().map((item) => item.id);
		expect(ids.filter((id) => !ID_PATTERN.test(id))).toEqual([]);
		expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
	});

	it('describes every case completely', () => {
		for (const item of allItems()) {
			expect(item.title, item.id).toBeTruthy();
			expect(item.pre, item.id).toBeTruthy();
			expect(item.expect, item.id).toBeTruthy();
			expect(item.steps.length, item.id).toBeGreaterThan(0);
			expect(item.art.length, item.id).toBeGreaterThan(0);
			expect(item.art.filter((art) => !ARTS.includes(art)), item.id).toEqual([]);
			expect(STATUSES, item.id).toContain(item.status);
			const automated = item.art.some((art) => art !== 'manuell');
			if (item.status === 'bestanden' && automated) {
				expect(item.tests.length, `${item.id} has no test file`).toBeGreaterThan(0);
			}
			if (item.status === 'bestanden' && !automated) {
				expect(item.bestaetigt, `${item.id} passed but neither automated nor confirmed by the user`).toBeDefined();
			}
			if (item.bestaetigt !== undefined) {
				// Results of the review mode, transferred by the agent (CLAUDE.md §12).
				expect(item.art, `${item.id}: only manual cases are confirmed`).toContain('manuell');
				expect(item.status, item.id).toBe('bestanden');
				expect(Object.keys(item.bestaetigt).sort(), item.id).toEqual(['datum', 'durch']);
				expect(item.bestaetigt.datum, item.id).toMatch(DATE_PATTERN);
				expect(item.bestaetigt.durch, item.id).toBeTruthy();
			}
			if (item.status === 'offen') {
				expect(item.art, `${item.id} is open, so it needs a manual part`).toContain('manuell');
			}
			if (item.art.length === 1 && item.art[0] === 'manuell' && item.bestaetigt === undefined) {
				expect(['offen', 'geplant', 'zurückgestellt', 'nicht zutreffend'], item.id).toContain(item.status);
			}
		}
	});

	it('references only existing test files and test names', () => {
		const missing = [];
		for (const item of allItems()) {
			for (const ref of item.tests) {
				const [file, name] = ref.split('::');
				const url = new URL(file, ROOT);
				if (!existsSync(url)) {
					missing.push(`${item.id}: ${file}`);
					continue;
				}
				if (name !== undefined && !readFileSync(url, 'utf8').includes(name)) {
					missing.push(`${item.id}: "${name}" in ${file}`);
				}
			}
		}
		expect(missing).toEqual([]);
	});

	it('covers every test file of the repository', () => {
		const referenced = new Set(allItems().flatMap((item) => item.tests.map((ref) => ref.split('::')[0])));
		expect(testFiles().filter((file) => !referenced.has(file))).toEqual([]);
	});

	it('contains nothing left over from the template', () => {
		for (const pattern of TEMPLATE_LEFTOVERS) {
			expect(html, String(pattern)).not.toMatch(pattern);
		}
	});
});

describe('work packages in docs/test-manifest.html', () => {
	it('describes every package completely', () => {
		const { bereiche, pakete } = manifestData();
		const areaIds = bereiche.map((area) => area.id);
		expect(areaIds.filter((id, index) => areaIds.indexOf(id) !== index)).toEqual([]);
		for (const area of bereiche) expect(area.titel, area.id).toBeTruthy();

		const ids = pakete.map((paket) => paket.id);
		expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
		const caseIds = new Set(allItems().map((item) => item.id));
		for (const paket of pakete) {
			expect(paket.id).toMatch(/^[A-Za-z0-9.-]+$/);
			expect(paket.vorhaben, paket.id).toBeTruthy();
			expect(paket.titel, paket.id).toBeTruthy();
			expect(areaIds, paket.id).toContain(paket.bereich);
			expectReferences(paket);
			expect(Array.isArray(paket.faelle), paket.id).toBe(true);
			for (const ref of paket.faelle) {
				const range = RANGE_PATTERN.exec(ref);
				if (!range) {
					expect(caseIds.has(ref), `${paket.id}: ${ref}`).toBe(true);
					continue;
				}
				expect(range[1], `${paket.id}: ${ref} stays within one prefix`).toBe(range[3]);
				expect(Number(range[2]) < Number(range[4]), `${paket.id}: ${ref} ascends`).toBe(true);
				expect(caseIds.has(`${range[1]}-${range[2]}`), `${paket.id}: start of ${ref}`).toBe(true);
				expect(caseIds.has(`${range[3]}-${range[4]}`), `${paket.id}: end of ${ref}`).toBe(true);
			}
		}
	});

	it('assigns every case to exactly one package', () => {
		const ids = allItems().map((item) => item.id);
		const owners = new Map(ids.map((id) => [id, []]));
		for (const paket of manifestData().pakete) {
			for (const id of expandRefs(paket.faelle, ids)) owners.get(id).push(paket.id);
		}
		const wrong = [...owners].filter(([, packages]) => packages.length !== 1).map(([id, packages]) => `${id}: ${packages.join(', ') || 'none'}`);
		expect(wrong).toEqual([]);
	});

	it('gives every package a case or a reason', () => {
		const ids = allItems().map((item) => item.id);
		const empty = manifestData().pakete.filter((paket) => expandRefs(paket.faelle, ids).length === 0 && !paket.vermerk?.trim());
		expect(empty.map((paket) => paket.id)).toEqual([]);
	});

	it('lists every deferred case under exactly one deferred topic', () => {
		const { zurueckgestellt } = manifestData();
		const listed = [];
		for (const topic of zurueckgestellt) {
			expect(topic.id).toMatch(/^[A-Za-z0-9.-]+$/);
			expect(topic.titel, topic.id).toBeTruthy();
			expect(topic.quelle, topic.id).toBeTruthy();
			expect(topic.datum, topic.id).toMatch(DATE_PATTERN);
			expectReferences(topic);
			listed.push(...topic.faelle);
		}
		const deferred = allItems().filter((item) => item.status === 'zurückgestellt').map((item) => item.id);
		expect([...listed].sort()).toEqual([...deferred].sort());
		expect(listed.filter((id, index) => listed.indexOf(id) !== index)).toEqual([]);
	});
});

describe('summary computed by docs/test-manifest.html', () => {
	it('counts all cases by status', () => {
		const items = allItems();
		const count = (status) => items.filter((item) => item.status === status).length;
		const { totals } = pageSummary();
		expect(totals).toEqual({
			cases: items.length,
			passed: count('bestanden'),
			openManual: items.filter(isOpenManual).length,
			planned: count('geplant'),
			deferred: count('zurückgestellt'),
			notApplicable: count('nicht zutreffend')
		});
		expect(totals.passed + totals.openManual + totals.planned + totals.deferred + totals.notApplicable).toBe(totals.cases);
	});

	it('counts the cases of every package', () => {
		const items = allItems();
		const ids = items.map((item) => item.id);
		const byId = new Map(items.map((item) => [item.id, item]));
		const { pakete } = manifestData();
		const { packages } = pageSummary();
		expect(packages.map((paket) => paket.id)).toEqual(pakete.map((paket) => paket.id));
		pakete.forEach((paket, index) => {
			const caseIds = expandRefs(paket.faelle, ids);
			const own = caseIds.map((id) => byId.get(id));
			const count = (status) => own.filter((item) => item.status === status).length;
			expect(packages[index], paket.id).toMatchObject({
				caseIds,
				passed: count('bestanden'),
				openManual: own.filter(isOpenManual).map((item) => item.id),
				planned: count('geplant'),
				deferred: count('zurückgestellt'),
				notApplicable: count('nicht zutreffend')
			});
		});
	});

	it('groups every open manual case by the area of its package', () => {
		const items = allItems();
		const ids = items.map((item) => item.id);
		const byId = new Map(items.map((item) => [item.id, item]));
		const { bereiche, pakete } = manifestData();
		const expected = bereiche
			.map((area) => ({
				id: area.id,
				title: area.titel,
				caseIds: pakete
					.filter((paket) => paket.bereich === area.id)
					.flatMap((paket) => expandRefs(paket.faelle, ids).filter((id) => isOpenManual(byId.get(id))))
			}))
			.filter((area) => area.caseIds.length > 0);
		const { openByArea, deferredIds } = pageSummary();
		expect(openByArea).toEqual(expected);
		expect(openByArea.flatMap((area) => area.caseIds).sort()).toEqual(items.filter(isOpenManual).map((item) => item.id).sort());
		expect(deferredIds).toEqual(items.filter((item) => item.status === 'zurückgestellt').map((item) => item.id));
	});

	it('labels ID ranges and keeps cases without a package visible', () => {
		const item = (id, status, art = ['manuell']) => ({ id, title: id, art, status, pre: '–', steps: ['–'], expect: '–', tests: [] });
		const data = {
			meta: {},
			bereiche: [{ id: 'a', titel: 'Bereich A' }],
			zurueckgestellt: [],
			pakete: [{ id: 'P', vorhaben: 'V', titel: 'T', bereich: 'a', faelle: ['BYL-E6-001..BYL-E6-005', 'BYL-X-001'] }],
			blocks: [
				{
					tag: 'E6',
					name: 'B',
					desc: '',
					items: [
						item('BYL-E6-001', 'bestanden', ['unit']),
						item('BYL-E6-002', 'offen'),
						item('BYL-E6-003', 'bestanden', ['unit']),
						item('BYL-E6-005', 'zurückgestellt'),
						item('BYL-E6-006', 'offen'),
						item('BYL-X-001', 'nicht zutreffend')
					]
				}
			]
		};
		const summary = pageSummary(data);
		expect(summary.packages[0]).toMatchObject({
			caseIds: ['BYL-E6-001', 'BYL-E6-002', 'BYL-E6-003', 'BYL-E6-005', 'BYL-X-001'],
			idRange: 'BYL-E6-001–003, 005, BYL-X-001',
			passed: 2,
			openManual: ['BYL-E6-002'],
			deferred: 1,
			notApplicable: 1
		});
		expect(summary.openByArea).toEqual([
			{ id: 'a', title: 'Bereich A', caseIds: ['BYL-E6-002'] },
			{ id: '', title: 'Ohne Paket oder Bereich', caseIds: ['BYL-E6-006'] }
		]);
		expect(summary.deferredIds).toEqual(['BYL-E6-005']);
	});

	it('takes four-digit IDs as numbers in ranges and labels', () => {
		const item = (id) => ({ id, title: id, art: ['unit'], status: 'bestanden', pre: '–', steps: ['–'], expect: '–', tests: [] });
		const ids = ['BYL-E6-998', 'BYL-E6-999', 'BYL-E6-1000', 'BYL-E6-1001', 'BYL-E6-1003', 'BYL-E6-1100'];
		const data = {
			meta: {},
			bereiche: [{ id: 'a', titel: 'Bereich A' }],
			zurueckgestellt: [],
			pakete: [{ id: 'P', vorhaben: 'V', titel: 'T', bereich: 'a', faelle: ['BYL-E6-999..BYL-E6-1003'] }],
			blocks: [{ tag: 'E6', name: 'B', desc: '', items: ids.map(item) }]
		};
		const { packages } = pageSummary(data);
		expect(packages[0].caseIds).toEqual(['BYL-E6-999', 'BYL-E6-1000', 'BYL-E6-1001', 'BYL-E6-1003']);
		expect(packages[0].idRange).toBe('BYL-E6-999–1001, 1003');
		expect(expandRefs(['BYL-E6-999..BYL-E6-1003'], ids)).toEqual(packages[0].caseIds);
		expect(ID_PATTERN.test('BYL-E6-1000')).toBe(true);
		expect(ID_PATTERN.test('BYL-E6-10000')).toBe(false);
		expect(ID_PATTERN.test('BYL-E6-99')).toBe(false);
	});
});

// Review mode: the user sets "bestanden" or "fehlgeschlagen" per open manual case; the page keeps it in localStorage only.
const AT = '2026-10-01T10:00:00+02:00';
const LATER = '2026-10-02T09:30:00+02:00';
const reviewItem = (id, status, art = ['manuell'], extra = {}) => ({
	id,
	title: `Fall ${id}`,
	art,
	status,
	pre: '–',
	steps: ['Schritt'],
	expect: 'Erwartung',
	tests: art.some((value) => value !== 'manuell') ? ['tests/unit/test-manifest.test.mjs'] : [],
	...extra
});

/** Two areas: open manual cases 001 to 003 and 005, automated 004, deferred 006, confirmed manual 007. */
function reviewData() {
	return {
		meta: { projekt: 'becauseyoulovejira', stand: '2026-10-01', commit: 'abc1234' },
		bereiche: [
			{ id: 'a', titel: 'Bereich A' },
			{ id: 'b', titel: 'Bereich B' }
		],
		zurueckgestellt: [],
		pakete: [
			{ id: 'P1', vorhaben: 'V', titel: 'T1', bereich: 'a', faelle: ['BYL-E6-001..BYL-E6-004'] },
			{ id: 'P2', vorhaben: 'V', titel: 'T2', bereich: 'b', faelle: ['BYL-E6-005..BYL-E6-007'] }
		],
		blocks: [
			{
				tag: 'E6',
				name: 'Block',
				desc: '',
				items: [
					reviewItem('BYL-E6-001', 'offen'),
					reviewItem('BYL-E6-002', 'offen'),
					reviewItem('BYL-E6-003', 'offen', ['komponente', 'manuell']),
					reviewItem('BYL-E6-004', 'bestanden', ['unit']),
					reviewItem('BYL-E6-005', 'offen'),
					reviewItem('BYL-E6-006', 'zurückgestellt'),
					reviewItem('BYL-E6-007', 'bestanden', ['manuell'], { bestaetigt: { datum: '2026-10-01', durch: 'Nutzer' } })
				]
			}
		]
	};
}

const itemOf = (data, id) => data.blocks.flatMap((block) => block.items).find((item) => item.id === id);

/** Inputs as the page records them: 001 passed, 002 failed with a note, 003 a note only, 005 passed with a note, 004 (automated) passed. */
function reviewResults(logic, data) {
	const input = (id, result, note = '') => plain(logic.changedEntry(null, itemOf(data, id), { result, note }, 'abc1234', AT));
	return {
		'BYL-E6-001': input('BYL-E6-001', 'passed'),
		'BYL-E6-002': input('BYL-E6-002', 'failed', 'Knopf fehlt\nnur im Dunkelmodus'),
		'BYL-E6-003': input('BYL-E6-003', null, 'Text unklar'),
		'BYL-E6-004': input('BYL-E6-004', 'passed'),
		'BYL-E6-005': input('BYL-E6-005', 'passed', 'ok, aber langsam')
	};
}

describe('review mode of docs/test-manifest.html', () => {
	it('migrates the v1 entries to v2 without loss', () => {
		const logic = pageLogic();
		const data = reviewData();
		const fingerprint = (id) => logic.caseFingerprint(itemOf(data, id));
		const v1 = {
			'BYL-E6-001': { done: true, note: '' },
			'BYL-E6-002': { done: false, note: 'Knopf fehlt' },
			'BYL-E6-003': { done: true, note: 'nur in Firefox geprüft' },
			'BYL-E6-005': { done: false, note: '  ' },
			'BYL-E6-099': { done: true, note: 'Fall gibt es nicht mehr' },
			'kein-fall': { done: true, note: 'x' }
		};
		const migrated = (id, result, note) => ({ result, note, commit: null, at: null, hash: fingerprint(id) });
		expect(plain(logic.readResults(null, JSON.stringify(v1), data))).toEqual({
			migrated: true,
			unreadable: false,
			results: {
				'BYL-E6-001': migrated('BYL-E6-001', 'passed', ''),
				'BYL-E6-002': migrated('BYL-E6-002', null, 'Knopf fehlt'),
				'BYL-E6-003': migrated('BYL-E6-003', 'passed', 'nur in Firefox geprüft'),
				'BYL-E6-099': { result: 'passed', note: 'Fall gibt es nicht mehr', commit: null, at: null, hash: null }
			}
		});

		// Once v2 exists, v1 no longer counts; unknown fields and values fall away.
		const v2 = {
			'BYL-E6-001': { result: 'failed', note: 'rot', commit: 'abc1234', at: AT, hash: 'deadbeef', extra: 1 },
			'BYL-E6-002': { result: 'vielleicht', note: '' },
			'kein-fall': { result: 'passed', note: '' }
		};
		expect(plain(logic.readResults(JSON.stringify(v2), JSON.stringify(v1), data))).toEqual({
			migrated: false,
			unreadable: false,
			results: { 'BYL-E6-001': { result: 'failed', note: 'rot', commit: 'abc1234', at: AT, hash: 'deadbeef' } }
		});
		expect(plain(logic.readResults('{kaputt', JSON.stringify(v1), data))).toEqual({ results: {}, migrated: false, unreadable: true });
		expect(plain(logic.readResults(null, '[1]', data))).toEqual({ results: {}, migrated: false, unreadable: true });
		expect(plain(logic.readResults(null, null, data))).toEqual({ results: {}, migrated: false, unreadable: false });
	});

	it('counts your results of the open manual cases and leaves the data alone', () => {
		const logic = pageLogic();
		const data = reviewData();
		const before = JSON.stringify(data);
		const review = plain(logic.reviewSummary(data, reviewResults(logic, data)));
		expect(review.totals).toEqual({ openManual: 4, passed: 2, failed: 1, unchecked: 1 });
		expect(review.passedIds).toEqual(['BYL-E6-001', 'BYL-E6-005']);
		expect(review.failedIds).toEqual(['BYL-E6-002']);
		expect(review.noteIds).toEqual(['BYL-E6-002', 'BYL-E6-003', 'BYL-E6-005']);
		expect(review.staleIds).toEqual(['BYL-E6-004']);
		expect(Object.keys(review.valid).sort()).toEqual(['BYL-E6-001', 'BYL-E6-002', 'BYL-E6-003', 'BYL-E6-005']);
		expect(plain(logic.manifestSummary(data)).totals).toEqual({ cases: 7, passed: 2, openManual: 4, planned: 0, deferred: 1, notApplicable: 0 });
		expect(JSON.stringify(data)).toBe(before);
	});

	it('marks entries as stale once the repo took the case over or its description changed', () => {
		const logic = pageLogic();
		const data = reviewData();
		const results = reviewResults(logic, data);
		const item = itemOf(data, 'BYL-E6-002');
		const fingerprint = logic.caseFingerprint(item);
		expect(fingerprint).toMatch(/^[0-9a-f]{8}$/);
		for (const change of [{ title: 'anders' }, { steps: ['Schritt', 'noch einer'] }, { expect: 'anders' }]) {
			expect(logic.caseFingerprint({ ...item, ...change }), JSON.stringify(change)).not.toBe(fingerprint);
		}
		for (const change of [{ pre: 'anders' }, { tests: ['x'] }, { status: 'bestanden' }]) {
			expect(logic.caseFingerprint({ ...item, ...change }), JSON.stringify(change)).toBe(fingerprint);
		}

		const later = reviewData();
		Object.assign(itemOf(later, 'BYL-E6-001'), { status: 'bestanden', bestaetigt: { datum: '2026-10-02', durch: 'Nutzer' } });
		itemOf(later, 'BYL-E6-002').steps.push('Neuer Schritt');
		itemOf(later, 'BYL-E6-003').pre = 'Andere Vorbedingung';
		itemOf(later, 'BYL-E6-005').status = 'zurückgestellt';
		const reason = (id, entry = results[id]) => logic.staleReason(entry, itemOf(later, id));
		expect(reason('BYL-E6-001')).toBe('adopted');
		expect(reason('BYL-E6-002')).toBe('changed');
		expect(reason('BYL-E6-003')).toBeNull();
		expect(reason('BYL-E6-005')).toBe('status');
		expect(logic.staleReason(results['BYL-E6-001'], undefined)).toBe('removed');
		// A note on an automated case stays valid; only results need an open manual case.
		const note = plain(logic.changedEntry(null, itemOf(later, 'BYL-E6-004'), { note: 'Test hakt manchmal' }, 'abc1234', AT));
		expect(reason('BYL-E6-004', note)).toBeNull();

		expect(logic.staleText('adopted', results['BYL-E6-001'], itemOf(later, 'BYL-E6-001'))).toBe(
			'Veraltet: Deine Eingabe (bestanden vom 2026-10-01 10:00) wird nicht mehr mitkopiert. Der Fall steht inzwischen im Repo als bestanden.'
		);
		expect(logic.staleText('changed', { ...results['BYL-E6-003'], at: null }, itemOf(later, 'BYL-E6-003'))).toBe(
			'Veraltet: Deine Eingabe (Notiz) wird nicht mehr mitkopiert. Titel, Schritte oder Erwartung haben sich seitdem geändert; bitte neu prüfen.'
		);

		// Stale entries are neither counted nor copied, and "Veraltete Einträge entfernen" takes them out.
		const review = plain(logic.reviewSummary(later, results));
		expect(review.staleIds).toEqual(['BYL-E6-001', 'BYL-E6-002', 'BYL-E6-004', 'BYL-E6-005']);
		expect(review.totals).toEqual({ openManual: 2, passed: 0, failed: 0, unchecked: 2 });
		const report = logic.resultReport(later, results, LATER);
		for (const id of review.staleIds) expect(report).not.toContain(id);
		expect(logic.fullReport(later, results, LATER)).not.toContain('Knopf fehlt');
		expect(plain(logic.withoutStale(results, later))).toEqual({
			results: { 'BYL-E6-003': results['BYL-E6-003'] },
			removedIds: ['BYL-E6-001', 'BYL-E6-002', 'BYL-E6-004', 'BYL-E6-005']
		});

		// Editing a stale entry starts over on today's description: the old result goes, the note stays until changed.
		const edited = plain(logic.changedEntry(results['BYL-E6-002'], itemOf(later, 'BYL-E6-002'), { note: 'neu geprüft' }, 'def5678', LATER));
		expect(edited).toEqual({ result: null, note: 'neu geprüft', commit: 'def5678', at: LATER, hash: logic.caseFingerprint(itemOf(later, 'BYL-E6-002')) });
		expect(reason('BYL-E6-002', edited)).toBeNull();
		const rechecked = plain(logic.changedEntry(results['BYL-E6-002'], itemOf(later, 'BYL-E6-002'), { result: 'passed' }, 'def5678', LATER));
		expect(rechecked).toMatchObject({ result: 'passed', note: 'Knopf fehlt\nnur im Dunkelmodus' });
		// A valid entry keeps its result when only the note changes; without result and note nothing is left.
		expect(plain(logic.changedEntry(results['BYL-E6-001'], itemOf(data, 'BYL-E6-001'), { note: 'gut' }, 'abc1234', LATER))).toMatchObject({ result: 'passed', note: 'gut' });
		expect(logic.changedEntry(results['BYL-E6-003'], itemOf(data, 'BYL-E6-003'), { note: '  ' }, 'abc1234', LATER)).toBeNull();
		expect(logic.changedEntry(results['BYL-E6-001'], itemOf(data, 'BYL-E6-001'), { result: null }, 'abc1234', LATER)).toBeNull();
	});

	it('builds the text of "Ergebnis kopieren" and "Alles kopieren"', () => {
		const logic = pageLogic();
		const data = reviewData();
		const results = reviewResults(logic, data);
		expect(logic.resultReport(data, results, LATER)).toBe(
			[
				'# Test-Ergebnis becauseyoulovejira',
				'Commit: abc1234 (Stand 2026-10-01)',
				'Kopiert: 2026-10-02 09:30',
				'Geprüft: 2 bestanden, 1 fehlgeschlagen, 1 offen',
				'',
				'## Fehlgeschlagen (1)',
				'- BYL-E6-002 — Fall BYL-E6-002',
				'  Geprüft: 2026-10-01 10:00, Commit abc1234',
				'  Notiz: Knopf fehlt',
				'    nur im Dunkelmodus',
				'',
				'## Bestanden (2)',
				'BYL-E6-001, BYL-E6-005',
				'',
				'## Notizen (2)',
				'- BYL-E6-003 — Fall BYL-E6-003',
				'  Notiz: Text unklar',
				'- BYL-E6-005 — Fall BYL-E6-005 (bestanden)',
				'  Notiz: ok, aber langsam',
				''
			].join('\n')
		);
		expect(logic.resultReport(data, {}, LATER)).toContain(
			'Geprüft: 0 bestanden, 0 fehlgeschlagen, 4 offen\n\n## Fehlgeschlagen (0)\nkeine\n\n## Bestanden (0)\nkeine\n\n## Notizen (0)\nkeine\n'
		);
		const failedWithoutNote = { 'BYL-E6-002': { ...results['BYL-E6-002'], note: '', commit: null, at: null } };
		expect(logic.resultReport(data, failedWithoutNote, LATER)).toContain('- BYL-E6-002 — Fall BYL-E6-002\n  Geprüft: unbekannt\n  Notiz: –\n');

		const all = logic.fullReport(data, results, LATER).split('\n');
		expect(all.slice(0, 5)).toEqual([
			'# Test-Manifest becauseyoulovejira, alle Fälle',
			'Commit: abc1234 (Stand 2026-10-01)',
			'Kopiert: 2026-10-02 09:30',
			'Geprüft: 2 bestanden, 1 fehlgeschlagen, 1 offen',
			''
		]);
		expect(all).toEqual(
			expect.arrayContaining([
				'## [E6] Block',
				'- [x] BYL-E6-001 — Fall BYL-E6-001',
				'- [!] BYL-E6-002 — Fall BYL-E6-002',
				'  Notiz: Knopf fehlt',
				'- [ ] BYL-E6-003 — Fall BYL-E6-003',
				'  Notiz: Text unklar',
				'- (bestanden) BYL-E6-004 — Fall BYL-E6-004',
				'- (zurückgestellt) BYL-E6-006 — Fall BYL-E6-006',
				'- (bestanden, manuell bestätigt am 2026-10-01) BYL-E6-007 — Fall BYL-E6-007'
			])
		);
	});

	it('filters by your input together with art and status', () => {
		const logic = pageLogic();
		const data = reviewData();
		const review = logic.reviewSummary(data, reviewResults(logic, data));
		const visible = (filters) =>
			data.blocks[0].items.filter((item) => logic.matchesFilters({ art: '', status: '', result: '', ...filters }, item, review)).map((item) => item.id);
		expect(visible({})).toHaveLength(7);
		expect(visible({ result: 'unchecked' })).toEqual(['BYL-E6-003']);
		expect(visible({ result: 'passed' })).toEqual(['BYL-E6-001', 'BYL-E6-005']);
		expect(visible({ result: 'failed' })).toEqual(['BYL-E6-002']);
		expect(visible({ result: 'note' })).toEqual(['BYL-E6-002', 'BYL-E6-003', 'BYL-E6-005']);
		expect(visible({ art: 'komponente', result: 'unchecked' })).toEqual(['BYL-E6-003']);
		expect(visible({ art: 'unit', result: 'passed' })).toEqual([]);
		expect(visible({ status: 'offen', result: 'passed' })).toEqual(['BYL-E6-001', 'BYL-E6-005']);
		expect(visible({ status: 'bestanden' })).toEqual(['BYL-E6-004', 'BYL-E6-007']);
		expect(visible({ art: 'manuell', status: 'zurückgestellt', result: 'unchecked' })).toEqual([]);
	});

	it('shows failed cases first in the overview and hides or marks checked ones', () => {
		const logic = pageLogic();
		const data = reviewData();
		const summary = logic.manifestSummary(data);
		const review = logic.reviewSummary(data, reviewResults(logic, data));
		expect(plain(logic.reviewOverview(summary, review, true))).toEqual({
			failedIds: ['BYL-E6-002'],
			areas: [{ id: 'a', title: 'Bereich A', caseIds: ['BYL-E6-003'], checked: 2 }],
			marks: {}
		});
		expect(plain(logic.reviewOverview(summary, review, false))).toEqual({
			failedIds: ['BYL-E6-002'],
			areas: [
				{ id: 'a', title: 'Bereich A', caseIds: ['BYL-E6-001', 'BYL-E6-002', 'BYL-E6-003'], checked: 2 },
				{ id: 'b', title: 'Bereich B', caseIds: ['BYL-E6-005'], checked: 1 }
			],
			marks: { 'BYL-E6-001': 'passed', 'BYL-E6-002': 'failed', 'BYL-E6-005': 'passed' }
		});
	});

	it('stamps inputs with the local time and its offset', () => {
		const logic = pageLogic();
		const date = new Date(Date.UTC(2026, 9, 1, 12, 5, 9));
		const stamp = logic.localIsoString(date);
		expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
		expect(new Date(stamp).getTime()).toBe(date.getTime());
		expect(logic.stampLabel('2026-10-01T14:05:09+02:00')).toBe('2026-10-01 14:05');
		expect(logic.stampLabel(null)).toBe('unbekannt');
	});
});

describe('docs/test-manifest.html in a browser (jsdom)', () => {
	/** Loads the page with the given localStorage; collects script errors and the copied text. */
	function openPage(storage) {
		const { JSDOM, VirtualConsole } = loadJsdom();
		const errors = [];
		const virtualConsole = new VirtualConsole();
		virtualConsole.on('jsdomError', (error) => {
			if (error.type !== 'css-parsing') errors.push(error.type === 'unhandled-exception' ? error.cause.stack : error.message);
		});
		const page = { errors, copied: null };
		const dom = new JSDOM(html, {
			url: 'https://example.com/docs/test-manifest.html',
			runScripts: 'dangerously',
			virtualConsole,
			beforeParse(window) {
				for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
				Object.defineProperty(window.navigator, 'clipboard', {
					value: { writeText: async (text) => void (page.copied = text) }
				});
				window.confirm = () => true;
			}
		});
		page.window = dom.window;
		page.document = dom.window.document;
		page.stored = () => JSON.parse(dom.window.localStorage.getItem('byl-test-manifest-v2'));
		page.keys = () => Array.from({ length: dom.window.localStorage.length }, (_, index) => dom.window.localStorage.key(index)).sort();
		page.fire = (element, type) => element.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
		page.visibleItems = () => [...page.document.querySelectorAll('.item')].filter((element) => !element.closest('[hidden]')).map((element) => element.dataset.id);
		return page;
	}

	const openIds = () => allItems().filter(isOpenManual).map((item) => item.id);

	it('migrates v1, records results and notes, filters and copies the result', async () => {
		const [first, second, third] = openIds();
		const total = openIds().length;
		const v1 = JSON.stringify({ [first]: { done: true, note: '' }, [second]: { done: false, note: 'alte Notiz' } });
		const page = openPage({ 'byl-test-manifest-v1': v1 });
		const { document } = page;
		try {
			expect(page.errors).toEqual([]);
			expect(page.stored()[first]).toMatchObject({ result: 'passed', note: '' });
			expect(page.stored()[second]).toMatchObject({ result: null, note: 'alte Notiz' });
			expect(page.window.localStorage.getItem('byl-test-manifest-v1')).toBe(v1);
			expect(document.getElementById('mine').textContent).toBe(`Von dir geprüft: 1 bestanden, 0 fehlgeschlagen, ${total - 1} offen`);
			expect(document.getElementById(`note-${second}`).value).toBe('alte Notiz');
			expect(document.querySelector('.howto').textContent).toBe(
				'So meldest du Ergebnisse: Fälle prüfen → ‚Ergebnis kopieren‘ → Text an Claude im Chat schicken.'
			);

			// Three states as a native radio group with a legend; "offen" is chosen until you decide.
			const radios = [...document.querySelectorAll(`input[type="radio"][name="result-${third}"]`)];
			expect(radios.map((radio) => [radio.value, radio.parentElement.textContent.trim()])).toEqual([
				['', 'offen'],
				['passed', 'bestanden'],
				['failed', 'fehlgeschlagen']
			]);
			expect(radios[0].checked).toBe(true);
			expect(radios[0].closest('fieldset').querySelector('legend').textContent).toBe(`Dein Ergebnis für ${third}`);
			expect(document.querySelectorAll('input[type="radio"][value="passed"]')).toHaveLength(total);

			radios[2].checked = true;
			page.fire(radios[2], 'change');
			const item = document.getElementById(`item-${third}`);
			const hint = item.querySelector('[data-role="failed-hint"]');
			expect(page.stored()[third]).toMatchObject({ result: 'failed', note: '', commit: manifestData().meta.commit });
			expect(item.classList.contains('failed')).toBe(true);
			expect(item.querySelector('[data-role="result"]').textContent).toBe('von dir: fehlgeschlagen');
			expect(hint.textContent).toBe('Bitte beschreibe in der Notiz, was abweicht (freiwillig, hilft beim Beheben).');
			expect(document.getElementById(`note-${third}`).getAttribute('aria-describedby')).toBe(hint.id);
			expect(document.querySelector('#open-lists .failed-block').textContent).toContain(third);

			const note = document.getElementById(`note-${third}`);
			note.value = 'Knopf fehlt';
			page.fire(note, 'input');
			expect(page.stored()[third].note).toBe('Knopf fehlt');
			expect(hint.textContent).toBe('');
			expect(document.getElementById('mine').textContent).toBe(`Von dir geprüft: 1 bestanden, 1 fehlgeschlagen, ${total - 2} offen`);
			expect(document.getElementById('count').textContent).toBe(`2 / ${total} manuelle Prüfungen geprüft: 1 bestanden, 1 fehlgeschlagen`);

			// The overview hides checked cases by default and marks them on request.
			const areaText = () => [...document.querySelectorAll('#open-lists details')].map((details) => details.textContent).join(' ');
			expect(areaText()).not.toContain(first);
			document.getElementById('hide-checked').click();
			expect(areaText()).toContain(first);
			expect(document.querySelector(`#open-lists details .mark-passed`)).not.toBeNull();

			const filter = document.getElementById('filter-result');
			filter.value = 'failed';
			page.fire(filter, 'change');
			expect(page.visibleItems()).toEqual([third]);
			filter.value = 'note';
			page.fire(filter, 'change');
			expect(page.visibleItems()).toEqual(openIds().filter((id) => id === second || id === third));
			const art = document.getElementById('filter-art');
			art.value = 'unit';
			page.fire(art, 'change');
			expect(page.visibleItems()).toEqual([]);

			document.getElementById('copy-result').click();
			await vi.waitFor(() => expect(page.copied).not.toBeNull());
			expect(page.copied).toContain(`## Fehlgeschlagen (1)\n- ${third} — `);
			expect(page.copied).toContain('  Notiz: Knopf fehlt\n');
			expect(page.copied).toContain(`## Bestanden (1)\n${first}\n`);
			expect(page.copied).toContain(`## Notizen (1)\n- ${second} — `);

			// Only localStorage changes, never the data of the page.
			expect(page.keys()).toEqual(['byl-test-manifest-v1', 'byl-test-manifest-v2']);
			expect(JSON.parse(document.getElementById('manifest-data').textContent)).toEqual(manifestData());
			expect(page.errors).toEqual([]);
		} finally {
			page.window.close();
		}
	}, 60_000);

	it('marks stale entries, leaves them out of the result and removes them on request', async () => {
		const [first, second] = openIds();
		const removed = 'BYL-X-999';
		expect(allItems().some((item) => item.id === removed)).toBe(false);
		const stale = { result: 'passed', note: 'alt', commit: 'abc1234', at: AT, hash: 'veraltet' };
		const page = openPage({ 'byl-test-manifest-v2': JSON.stringify({ [first]: stale, [removed]: stale }) });
		const { document } = page;
		try {
			expect(page.errors).toEqual([]);
			const item = document.getElementById(`item-${first}`);
			const staleNote = item.querySelector('[data-role="stale"]');
			expect(staleNote.hidden).toBe(false);
			expect(staleNote.textContent).toContain('Veraltet: Deine Eingabe (bestanden vom 2026-10-01 10:00) wird nicht mehr mitkopiert.');
			expect(item.querySelector('input[type="radio"][value=""]').checked).toBe(true);
			expect(document.getElementById('mine').textContent).toContain('0 bestanden, 0 fehlgeschlagen');
			expect(document.getElementById('mine').textContent).toContain('2 veraltete Eingaben (nicht mitkopiert)');

			const button = document.getElementById('drop-stale');
			expect(button.hidden).toBe(false);
			expect(button.textContent).toBe('Veraltete Einträge entfernen (2)');

			document.getElementById('copy-result').click();
			await vi.waitFor(() => expect(page.copied).not.toBeNull());
			expect(page.copied).not.toContain(first);
			expect(page.copied).not.toContain(removed);

			// A new result on a stale case counts again; the rest goes with the button.
			const passed = item.querySelector('input[type="radio"][value="passed"]');
			passed.checked = true;
			page.fire(passed, 'change');
			expect(staleNote.hidden).toBe(true);
			expect(button.textContent).toBe('Veraltete Einträge entfernen (1)');
			const note = document.getElementById(`note-${second}`);
			note.value = 'frisch';
			page.fire(note, 'input');

			button.click();
			expect(Object.keys(page.stored()).sort()).toEqual([first, second].sort());
			expect(page.stored()[first]).toMatchObject({ result: 'passed', note: 'alt' });
			expect(button.hidden).toBe(true);
			expect(document.activeElement.id).toBe('copy-result');

			document.getElementById('reset').click();
			expect(page.stored()).toEqual({});
			expect(document.getElementById(`note-${second}`).value).toBe('');
			expect(page.errors).toEqual([]);
		} finally {
			page.window.close();
		}
	}, 60_000);
});
