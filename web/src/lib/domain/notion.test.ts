// Pure rules of the Notion import in the SPA (ADR-0041, plan notion-import NI-2): what can be
// chosen, what is chosen at first, batches, the texts of results, limits and checks, and what a
// Notion entry of the inbox says about its origin and copy.

import { describe, expect, it } from 'vitest';
import {
	NOTION_DEFAULT_LIMITS,
	addCounts,
	batches,
	blockedReason,
	checkText,
	countsText,
	importBatchSize,
	importedSummary,
	limitsText,
	notionContentOf,
	notionOriginText,
	preselectedRefs,
	refetchText,
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

	it('cuts a selection into batches of the server limit', () => {
		expect(batches(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
		expect(batches([], 100)).toEqual([]);
		expect(batches(['a'], 0)).toEqual([['a']]);
	});

	it('takes smaller batches while the page content comes along', () => {
		expect(importBatchSize(NOTION_DEFAULT_LIMITS, false)).toBe(100);
		expect(importBatchSize(NOTION_DEFAULT_LIMITS, true)).toBe(10);
		expect(importBatchSize({ importBatch: 5 }, true)).toBe(5);
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
