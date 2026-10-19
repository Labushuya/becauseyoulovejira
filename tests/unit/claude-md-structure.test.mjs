// Guard of the split of the project rules (DOC-1): CLAUDE.md is the compact core that Claude Code
// loads into every session, the rules of single topics live in docs/regeln/*.md. The checks keep
// the core below a hard size limit, every relative link and anchor of the core and the detail
// documents resolvable, every detail document listed in the index of the core and in
// docs/regeln/README.md with its head ("Wann lesen" and the link back to the core), and no file
// below docs/ named CLAUDE.md (Claude Code would load it as a nested CLAUDE.md).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CORE = 'CLAUDE.md';
const RULES = 'docs/regeln';
const INDEX_HEADING = '### Index der Detaildokumente';

// The split aimed at about 60 000 characters (roughly 15 000 tokens); the core then had about
// 50 000. The limit leaves room for new cross-cutting rules (a good half of the size again) but
// stops a creeping return to the 345 000 characters before DOC-1 long before the core gets
// expensive again.
const MAX_CORE_CHARS = 80_000;
const CARE_RULE =
	'Pflege-Regel in CLAUDE.md („Aufbau: Kern und Detaildokumente“): Der Kern bleibt kompakt, fachliche Details, Feature-Beschreibungen und Begründungen gehören in docs/regeln/<thema>.md oder die ADRs.';

const read = (path) => readFileSync(join(ROOT, path), 'utf8').replaceAll('\r\n', '\n');
const detailFiles = () =>
	readdirSync(join(ROOT, RULES))
		.filter((name) => name.endsWith('.md'))
		.sort();
const ruleDocuments = () => [CORE, ...detailFiles().map((name) => `${RULES}/${name}`)];

/** Lines outside fenced code blocks, with their numbers. */
function proseLines(text) {
	const result = [];
	let fence = false;
	text.split('\n').forEach((line, index) => {
		if (/^\s*```/.test(line)) {
			fence = !fence;
			return;
		}
		if (!fence) result.push({ line, number: index + 1 });
	});
	return result;
}

/** Inline links [text](target) of a line outside code spans. */
function linkTargets(line) {
	const prose = line.replace(/(`+)[^`][\s\S]*?\1(?!`)/g, '');
	return [...prose.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
}

/** Slug of a heading as GitHub builds it (lower case, punctuation removed, spaces to hyphens). */
function slug(heading) {
	return heading
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[`*]/g, '')
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\p{M}\p{Pc}\- ]/gu, '')
		.replaceAll(' ', '-');
}

/** Anchors of the headings of a Markdown file, duplicates numbered like GitHub does. */
function anchors(path) {
	const seen = new Map();
	const result = new Set();
	for (const { line } of proseLines(read(path))) {
		const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
		if (!heading) continue;
		const base = slug(heading[1]);
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		result.add(count === 0 ? base : `${base}-${count}`);
	}
	return result;
}

/** Relative links of a file: { target, file (repo path), anchor, number }. */
function relativeLinks(path) {
	const dir = posix.dirname(path);
	const links = [];
	for (const { line, number } of proseLines(read(path))) {
		for (const target of linkTargets(line)) {
			// Other schemes and absolute paths of the app (such as /tickets/<id>) are no files of the repo.
			if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue;
			const hash = target.indexOf('#');
			const file = hash === 0 ? path : posix.normalize(posix.join(dir, hash === -1 ? target : target.slice(0, hash)));
			links.push({ target, file: file.replace(/\/$/, ''), anchor: hash === -1 ? '' : target.slice(hash + 1), number });
		}
	}
	return links;
}

function exists(path) {
	try {
		statSync(join(ROOT, path));
		return true;
	} catch {
		return false;
	}
}

/** Repo paths of the Markdown files a part of a document links to. */
const linkedFiles = (path, text) =>
	new Set(
		text
			.split('\n')
			.flatMap(linkTargets)
			.filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('/') && !target.startsWith('#'))
			.map((target) => posix.normalize(posix.join(posix.dirname(path), target.split('#')[0])))
	);

describe('CLAUDE.md core and docs/regeln (DOC-1)', () => {
	it('keeps the core below its hard size limit', () => {
		const length = read(CORE).length;
		expect(length, `CLAUDE.md hat ${length} Zeichen, erlaubt sind weniger als ${MAX_CORE_CHARS}. ${CARE_RULE}`).toBeLessThan(MAX_CORE_CHARS);
	});

	it('resolves every relative link and anchor of the core and the detail documents', () => {
		const documents = ruleDocuments();
		expect(documents.length, 'docs/regeln holds detail documents').toBeGreaterThan(5);
		const broken = [];
		let checked = 0;
		for (const path of documents) {
			for (const link of relativeLinks(path)) {
				checked++;
				if (!exists(link.file)) {
					broken.push(`${path}:${link.number}: ${link.target} (Datei fehlt: ${link.file})`);
					continue;
				}
				if (link.anchor && link.file.endsWith('.md') && !anchors(link.file).has(decodeURIComponent(link.anchor))) {
					broken.push(`${path}:${link.number}: ${link.target} (Anker fehlt in ${link.file})`);
				}
			}
		}
		expect(checked, 'relative links found').toBeGreaterThan(300);
		expect(broken, 'Links in CLAUDE.md und docs/regeln müssen auf vorhandene Dateien und Überschriften zeigen').toEqual([]);
	});

	it('lists every detail document in the index of the core and in docs/regeln/README.md', () => {
		const core = read(CORE);
		const start = core.indexOf(`\n${INDEX_HEADING}\n`);
		expect(start, `CLAUDE.md hat die Überschrift „${INDEX_HEADING}“`).toBeGreaterThan(-1);
		const rest = core.slice(start + INDEX_HEADING.length + 2);
		const end = rest.search(/^#{1,3} /m);
		const index = linkedFiles(CORE, end === -1 ? rest : rest.slice(0, end));
		const readme = linkedFiles(`${RULES}/README.md`, read(`${RULES}/README.md`));

		const files = detailFiles().map((name) => `${RULES}/${name}`);
		expect(files, 'docs/regeln/README.md exists').toContain(`${RULES}/README.md`);
		const notInIndex = files.filter((file) => !index.has(file));
		const notInReadme = files.filter((file) => file !== `${RULES}/README.md` && !readme.has(file));
		expect(notInIndex, `nicht im Index von CLAUDE.md verlinkt. ${CARE_RULE}`).toEqual([]);
		expect(notInReadme, 'nicht in der Übersicht von docs/regeln/README.md verlinkt').toEqual([]);
	});

	it('starts every detail document with "Wann lesen" and a link back to the core', () => {
		const wrong = [];
		for (const name of detailFiles()) {
			const path = `${RULES}/${name}`;
			const lines = read(path).split('\n');
			const firstSection = lines.findIndex((line, index) => index > 0 && /^## /.test(line));
			const head = lines.slice(0, firstSection === -1 ? lines.length : firstSection);
			const paragraphs = head.filter((line) => line.trim() !== '');
			if (!/^# \S/.test(paragraphs[0] ?? '')) wrong.push(`${path}: erste Zeile ist keine Überschrift „# …“`);
			if (!/^\*\*Wann lesen:\*\* \S/.test(paragraphs[1] ?? '')) wrong.push(`${path}: zweiter Absatz beginnt nicht mit „**Wann lesen:**“`);
			const backLink = head.some((line) => linkTargets(line).some((target) => posix.normalize(posix.join(RULES, target)) === CORE));
			if (!backLink) wrong.push(`${path}: kein Link auf ../../CLAUDE.md vor dem ersten Abschnitt`);
		}
		expect(wrong).toEqual([]);
	});

	it('has no file named CLAUDE.md below docs/', () => {
		const nested = readdirSync(join(ROOT, 'docs'), { recursive: true, withFileTypes: true })
			.filter((entry) => entry.name.toLowerCase() === 'claude.md')
			.map((entry) => relative(ROOT, join(entry.parentPath, entry.name)).replaceAll('\\', '/'));
		expect(nested, 'Claude Code lädt jede CLAUDE.md unter docs/ als verschachtelte Projektregeln; Detaildokumente heißen docs/regeln/<thema>.md').toEqual([]);
	});
});
