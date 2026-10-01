// Pure rules of the Notion import in the SPA (ADR-0041, plan notion-import NI-2): what can be
// chosen, what is chosen at first, batches, the texts of results, limits and checks, and what a
// Notion entry of the inbox says about its origin and copy.

import { describe, expect, it } from 'vitest';
import {
	NOTION_DEFAULT_LIMITS,
	NOTION_REQUEST_TIMEOUT_MS,
	NO_COUNTS,
	addCounts,
	blockedReason,
	checkText,
	countsOf,
	countsText,
	entriesText,
	importBatchSize,
	importedSummary,
	limitsText,
	notionContentOf,
	notionInboxQuery,
	notionOriginText,
	preselectedRefs,
	progressText,
	refetchAllText,
	refetchProgressText,
	refetchText,
	runSummary,
	runningText,
	sourceResultText,
	subpagesHint,
	subpagesOverview,
	truncatedText,
	type NotionImportedSource,
	type NotionPreviewItem
} from './notion';

function item(overrides: Partial<NotionPreviewItem> = {}): NotionPreviewItem {
	return {
		ref: 'a',
		kind: 'todo',
		title: 'Milch',
		sourceDate: null,
		allDay: false,
		excerpt: '',
		section: '',
		done: false,
		url: '',
		state: '',
		message: '',
		...overrides
	};
}

function imported(overrides: Partial<NotionImportedSource> = {}): NotionImportedSource {
	return {
		id: 'x',
		type: 'page',
		title: 'Wochenplan',
		url: '',
		count: 1,
		last: null,
		dateProperty: '',
		copyContent: false,
		subpages: false,
		...overrides
	};
}

describe('choosing entries', () => {
	it('blocks what is in the inbox, and done ones only while they are skipped', () => {
		expect(blockedReason(item(), true)).toBe('');
		expect(blockedReason(item({ state: 'discarded', message: 'Schon verworfen.' }), false)).toBe(
			'Schon verworfen.'
		);
		expect(blockedReason(item({ state: 'new' }), false)).toBe('Schon im Eingang.');
		expect(blockedReason(item({ done: true }), true)).toBe('Erledigt, wird übersprungen.');
		expect(blockedReason(item({ done: true }), false)).toBe('');
	});

	it('chooses every open entry at first', () => {
		const items = [
			item({ ref: 'a' }),
			item({ ref: 'b', done: true }),
			item({ ref: 'c', state: 'converted', message: 'Schon Ticket HAUS-1.' })
		];
		expect(preselectedRefs(items, true)).toEqual(['a']);
		expect(preselectedRefs(items, false)).toEqual(['a', 'b']);
	});

	it('sends blocks of 10 per 100 entries of the source, so progress is real (fix 2026-09-30)', () => {
		expect(importBatchSize(NOTION_DEFAULT_LIMITS, false, 45)).toBe(10);
		expect(importBatchSize(NOTION_DEFAULT_LIMITS, false, 0)).toBe(10);
		expect(importBatchSize(NOTION_DEFAULT_LIMITS, false, 100)).toBe(10);
		expect(importBatchSize(NOTION_DEFAULT_LIMITS, false, 101)).toBe(20);
		expect(importBatchSize(NOTION_DEFAULT_LIMITS, false, 450)).toBe(50);
		expect(importBatchSize(NOTION_DEFAULT_LIMITS, false, 1000)).toBe(100);
		expect(importBatchSize({ importBatch: 30 }, false, 1000)).toBe(30);
	});

	it('takes blocks of 5 while the page content comes along', () => {
		expect(importBatchSize(NOTION_DEFAULT_LIMITS, true, 45)).toBe(5);
		expect(importBatchSize(NOTION_DEFAULT_LIMITS, true, 1000)).toBe(5);
		expect(importBatchSize({ importBatch: 3 }, true, 45)).toBe(3);
	});

	it('waits for the server longer than it may take, shorter than PocketBase and Firefox', () => {
		// The server ends a request after 90 s (notion-rules.js LIMITS.routeSeconds); both give up
		// after 5 minutes.
		expect(NOTION_REQUEST_TIMEOUT_MS).toBe(150_000);
		expect(NOTION_REQUEST_TIMEOUT_MS).toBeGreaterThan(90_000 + 30_000);
		expect(NOTION_REQUEST_TIMEOUT_MS).toBeLessThan(300_000);
	});
});

describe('a run of the import (fix 2026-09-30)', () => {
	it('counts the results and names the run in German', () => {
		expect(
			countsOf([
				{ ref: 'a', status: 'created', message: '' },
				{ ref: 'b', status: 'duplicate', message: 'Schon im Eingang.' },
				{ ref: 'c', status: 'skipped', message: 'Erledigt, übersprungen.' },
				{ ref: 'd', status: 'failed', message: 'x' },
				{ ref: 'e', status: 'created', message: '' }
			])
		).toEqual({ created: 2, duplicates: 1, skipped: 1, failed: 1 });
		expect(countsOf([])).toEqual(NO_COUNTS);
		expect(entriesText(1)).toBe('1 Eintrag');
		expect(entriesText(1200)).toBe('1.200 Einträge');
		expect(runningText(45)).toBe('45 Einträge werden übernommen …');
		expect(runningText(1)).toBe('1 Eintrag wird übernommen …');
		expect(progressText(20, 45)).toBe('20 von 45 bearbeitet …');
	});

	it('leads to the Notion entries of the inbox, all of them when none is new', () => {
		expect(notionInboxQuery({ ...NO_COUNTS, created: 3 })).toBe('?quelle=notion');
		expect(notionInboxQuery({ ...NO_COUNTS, duplicates: 3 })).toBe('?quelle=notion&zustand=alle');
	});

	it('sums up a run: success, nothing new, entries with errors, an error, a stop', () => {
		const done = { counts: { ...NO_COUNTS, created: 45 }, error: null, stopped: false, open: 0 };
		expect(runSummary(done)).toEqual({
			tone: 'success',
			title: 'In den Eingang übernommen',
			text: '45 angelegt.'
		});
		expect(runSummary({ ...done, counts: { ...NO_COUNTS, duplicates: 2 } })).toMatchObject({
			tone: 'info',
			text: '0 angelegt, 2 schon vorhanden.'
		});
		expect(runSummary({ ...done, counts: { ...NO_COUNTS, created: 3, failed: 1 } })).toEqual({
			tone: 'success',
			title: 'In den Eingang übernommen',
			text: '3 angelegt, 1 mit Fehler. Einträge mit Fehler bleiben ausgewählt; der Grund steht darunter.'
		});
		expect(runSummary({ ...done, counts: { ...NO_COUNTS, failed: 2 } }).tone).toBe('error');
		expect(
			runSummary({
				counts: { ...NO_COUNTS, created: 10 },
				error: 'Notion bremst gerade die Anfragen (429). Bitte in einer Minute erneut versuchen.',
				stopped: false,
				open: 35
			})
		).toEqual({
			tone: 'error',
			title: 'Übernahme unterbrochen',
			text: '10 angelegt. Notion bremst gerade die Anfragen (429). Bitte in einer Minute erneut versuchen. 35 Einträge noch nicht übernommen; sie bleiben ausgewählt, ein neuer Versuch erkennt Übernommenes als „schon vorhanden“.'
		});
		expect(
			runSummary({ counts: { ...NO_COUNTS, created: 10 }, error: null, stopped: true, open: 35 })
		).toEqual({
			tone: 'info',
			title: 'Angehalten',
			text: '10 angelegt. 35 Einträge noch nicht übernommen; sie bleiben ausgewählt, ein neuer Versuch erkennt Übernommenes als „schon vorhanden“.'
		});
	});
});

describe('texts', () => {
	it('counts results in German', () => {
		const counts = addCounts(
			{ created: 2, duplicates: 1, skipped: 0, failed: 0 },
			{ created: 1, duplicates: 0, skipped: 2, failed: 1 }
		);
		expect(counts).toEqual({ created: 3, duplicates: 1, skipped: 2, failed: 1 });
		expect(countsText(counts)).toBe('3 angelegt, 1 schon vorhanden, 2 übersprungen, 1 mit Fehler');
		expect(countsText({ created: 1200, duplicates: 0, skipped: 0, failed: 0 })).toBe(
			'1.200 angelegt'
		);
	});

	it('says after "Erneut abrufen" what is new; an error only when nothing came and entries failed', () => {
		expect(refetchText('Plan', { created: 2, duplicates: 5, skipped: 1, failed: 0 })).toEqual({
			text: '„Plan“: 2 angelegt, 5 schon vorhanden, 1 übersprungen.',
			tone: 'success'
		});
		expect(refetchText('Plan', { created: 0, duplicates: 5, skipped: 0, failed: 0 })).toEqual({
			text: '„Plan“: keine neuen Einträge.',
			tone: 'info'
		});
		expect(refetchText('Plan', { created: 0, duplicates: 0, skipped: 0, failed: 2 }).tone).toBe(
			'error'
		);
		expect(refetchText('Plan', { created: 1, duplicates: 0, skipped: 0, failed: 2 }).tone).toBe(
			'success'
		);
	});

	it('names the limits and why a preview is cut', () => {
		expect(limitsText(NOTION_DEFAULT_LIMITS)).toBe(
			'Seiteninhalt höchstens 500 Blöcke und 50.000 Zeichen je Seite, sonst gekürzt mit Hinweis; höchstens 1.000 Zeilen je Datenbank.'
		);
		expect(truncatedText(NOTION_DEFAULT_LIMITS, 'data_source')).toMatch(
			/1\.000 Zeilen je Datenbank/
		);
		expect(truncatedText(NOTION_DEFAULT_LIMITS, 'page')).toMatch(/5\.000 Blöcke je Seite/);
	});

	it('sums up the imported sources and the check', () => {
		expect(importedSummary([])).toBe('noch nichts');
		expect(importedSummary([imported()])).toBe('1 Eintrag aus 1 Quelle');
		expect(importedSummary([imported({ count: 12 }), imported({ id: 'y', count: 3 })])).toBe(
			'15 Einträge aus 2 Quellen'
		);
		expect(checkText({ workspace: 'Privat', bot: 'byl', shared: true })).toBe(
			'Verbunden mit dem Arbeitsbereich „Privat“ als „byl“. Die Integration sieht freigegebene Seiten.'
		);
		expect(checkText({ workspace: '', bot: '', shared: false })).toMatch(
			/^Verbunden mit Notion\. Sie sieht aber noch keine Seite/
		);
	});
});

describe('Notion entries of the inbox', () => {
	const meta = (notion: unknown) => ({ channel: 'notion' as const, sourceMeta: { notion } });

	it('name their page or database and the section', () => {
		expect(
			notionOriginText(
				meta({ source_title: 'Wochenplan', source_type: 'page', section: 'Einkauf' })
			)
		).toBe('Wochenplan (Seite), Abschnitt „Einkauf“');
		expect(notionOriginText(meta({ source_title: 'Aufgaben', source_type: 'data_source' }))).toBe(
			'Aufgaben (Datenbank)'
		);
		expect(notionOriginText(meta(null))).toBe('');
		expect(
			notionOriginText({ channel: 'telegram', sourceMeta: { notion: { source_title: 'x' } } })
		).toBe('');
	});

	it('say what their copy holds', () => {
		expect(notionContentOf(meta({ content: 'properties' }))).toBe('properties');
		expect(notionContentOf(meta({ content: 'truncated' }))).toBe('truncated');
		expect(notionContentOf(meta({ content: 'anders' }))).toBeNull();
		expect(notionContentOf({ channel: 'link', sourceMeta: {} })).toBeNull();
	});
});

describe('several sources, "Alle erneut abrufen" and sub-pages (addendum of 2026-10-01)', () => {
	const result = (
		id: string,
		counts: Partial<typeof NO_COUNTS>,
		error: string | null = null,
		open = 0
	) => ({ id, title: `Liste ${id}`, counts: { ...NO_COUNTS, ...counts }, error, open });

	it('names the result of one source with what is left and its error', () => {
		expect(sourceResultText(result('a', { created: 3, duplicates: 1 }))).toBe(
			'3 angelegt, 1 schon vorhanden.'
		);
		expect(sourceResultText(result('a', { created: 2 }, null, 4))).toBe(
			'2 angelegt, 4 Einträge noch nicht übernommen.'
		);
		expect(
			sourceResultText(result('a', {}, 'Diese Quelle ist nicht freigegeben oder gelöscht (404).'))
		).toBe('Diese Quelle ist nicht freigegeben oder gelöscht (404).');
		expect(sourceResultText(result('a', { created: 1 }, 'Notion bremst gerade.', 2))).toBe(
			'1 angelegt, 2 Einträge noch nicht übernommen. Notion bremst gerade.'
		);
	});

	it('sums up a run over several sources: an error of one source is neither a stop nor silent', () => {
		expect(
			runSummary({ counts: { ...NO_COUNTS, created: 5 }, error: null, stopped: false, open: 2, failedSources: 1 })
		).toEqual({
			tone: 'info',
			title: 'In den Eingang übernommen',
			text: '5 angelegt. Eine Quelle mit Fehler; der Grund steht bei der Quelle. 2 Einträge noch nicht übernommen; sie bleiben ausgewählt, ein neuer Versuch erkennt Übernommenes als „schon vorhanden“.'
		});
		expect(
			runSummary({ counts: { ...NO_COUNTS }, error: null, stopped: false, open: 3, failedSources: 2 }).tone
		).toBe('error');
		expect(
			runSummary({ counts: { ...NO_COUNTS, created: 1 }, error: null, stopped: false, open: 0 }).tone
		).toBe('success');
	});

	it('says which source "Alle erneut abrufen" reads and sums it up in one flag', () => {
		expect(refetchProgressText(2, 5, 'Wochenplan')).toBe(
			'Erneut abrufen: Quelle 2 von 5 („Wochenplan“) …'
		);
		expect(
			refetchAllText([result('a', { created: 3, duplicates: 2 }), result('b', { created: 2 })], false)
		).toEqual({ text: '2 Quellen erneut abgerufen: 5 angelegt, 2 schon vorhanden.', tone: 'success' });
		expect(refetchAllText([result('a', { duplicates: 4 })], false)).toEqual({
			text: '1 Quelle erneut abgerufen: 0 angelegt, 4 schon vorhanden.',
			tone: 'info'
		});
		expect(refetchAllText([result('a', {}, 'Notion bremst gerade.'), result('b', {})], true)).toEqual({
			text: '2 Quellen erneut abgerufen: 0 angelegt; 1 Quelle mit Fehler; angehalten.',
			tone: 'error'
		});
	});

	it('explains sub-pages with their limits and names what a preview read', () => {
		expect(subpagesHint(NOTION_DEFAULT_LIMITS)).toBe(
			'Liest bei Seiten auch ihre Unterseiten, soweit die Integration sie sieht: höchstens 50 Unterseiten, bis 3 Ebenen tief. Ihre Punkte stehen unter „Unterseite › Abschnitt“.'
		);
		expect(subpagesOverview({ subpages: 0, hiddenSubpages: 0 })).toBe('');
		expect(subpagesOverview({ subpages: 1, hiddenSubpages: 0 })).toBe('1 Unterseite gelesen.');
		expect(subpagesOverview({ subpages: 4, hiddenSubpages: 1 })).toBe(
			'4 Unterseiten gelesen, 1 Unterseite nicht sichtbar.'
		);
		expect(subpagesOverview({ subpages: 0, hiddenSubpages: 2 })).toBe(
			'2 Unterseiten nicht sichtbar.'
		);
	});
});
