// Consistency of docs/test-manifest.html (CLAUDE.md §12: every work package updates the manifest).
// The manifest keeps its cases and work packages as JSON in <script type="application/json" id="manifest-data">,
// so this test reads them without a browser. The page computes its head (status line, open manual checks,
// package table) with the pure functions in <script id="manifest-logic">; the test runs that block in node:vm
// and checks the numbers against an independent count.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const MANIFEST_PATH = 'docs/test-manifest.html';
const html = readFileSync(new URL(MANIFEST_PATH, ROOT), 'utf8');

const ARTS = ['unit', 'komponente', 'integration', 'manuell'];
const STATUSES = ['bestanden', 'offen', 'geplant', 'zurückgestellt', 'nicht zutreffend'];
const ID_PATTERN = /^BYL-(E\d|X)-\d{3}$/;
const RANGE_PATTERN = /^(BYL-(?:E\d|X))-(\d{3})\.\.(BYL-(?:E\d|X))-(\d{3})$/;
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

/** Runs the logic block of the page in a fresh context; returns its manifestSummary as plain data. */
function pageSummary(data = manifestData()) {
	const match = /<script id="manifest-logic">([\s\S]*?)<\/script>/.exec(html);
	if (!match) throw new Error('No manifest-logic block in ' + MANIFEST_PATH);
	const context = vm.createContext({});
	vm.runInContext(match[1], context);
	return JSON.parse(JSON.stringify(context.manifestSummary(data)));
}

/** Independent expansion of the case references of a package ("BYL-E6-100" or "BYL-E6-100..BYL-E6-105"). */
function expandRefs(refs, ids) {
	return ids.filter((id) =>
		refs.some((ref) => {
			const range = RANGE_PATTERN.exec(ref);
			if (!range) return ref === id;
			const cut = id.lastIndexOf('-');
			const [prefix, number] = [id.slice(0, cut), id.slice(cut + 1)];
			return prefix === range[1] && number >= range[2] && number <= range[4];
		})
	);
}

const isOpenManual = (item) => item.status === 'offen' && item.art.includes('manuell');

/**
 * Test files the manifest must cover: tests/unit, tests/integration, web/src/**\/*.test.ts, the
 * mail helper helpers/mail/src/**\/*.test.ts and the browser extension
 * extensions/whatsapp-web/src/**\/*.test.ts (ADR-0038).
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
			if (item.status === 'bestanden') {
				expect(automated, `${item.id} passed but not automated`).toBe(true);
				expect(item.tests.length, `${item.id} has no test file`).toBeGreaterThan(0);
			}
			if (item.status === 'offen') {
				expect(item.art, `${item.id} is open, so it needs a manual part`).toContain('manuell');
			}
			if (item.art.length === 1 && item.art[0] === 'manuell') {
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
				expect(range[2] < range[4], `${paket.id}: ${ref} ascends`).toBe(true);
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
});
