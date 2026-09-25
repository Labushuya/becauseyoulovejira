// Templates of the manual capture (E4 plan, package 5; OF-E4-1 (a), OF-E4-3): every template with
// minimal and full input, title patterns and length, checklist, validation, event date as date at
// the sender (never due, P-5), ticket and inbox drafts.

import { describe, expect, it } from 'vitest';
import { PRESET_META_KEY } from './inbox';
import {
	CAPTURE_TEMPLATES,
	DEFAULT_CAPTURE_TARGET,
	DEFAULT_CAPTURE_TEMPLATE,
	EMPTY_CAPTURE_INPUT,
	INVALID_DATE_MESSAGE,
	INVALID_TIME_MESSAGE,
	INVALID_URL_MESSAGE,
	REQUIRED_MESSAGE,
	TEMPLATE_FIELDS,
	TEMPLATE_KINDS,
	TEMPLATE_PARAM,
	TEMPLATE_VALUES,
	buildCapture,
	captureInboxDraft,
	captureTicketDraft,
	fitTitle,
	shoppingItems,
	targetOf,
	templateFrom,
	type Capture,
	type CaptureInput,
	type CaptureTemplate
} from './templates';
import { INBOX_KINDS } from './inbox';

const PROJECT = 'proj00000000001';
const TAG = 'tag000000000001';

function input(overrides: Partial<CaptureInput> = {}): CaptureInput {
	return { ...EMPTY_CAPTURE_INPUT, tagIds: [], ...overrides };
}

function built(template: CaptureTemplate, overrides: Partial<CaptureInput>): Capture {
	const outcome = buildCapture(template, input(overrides));
	if (!outcome.ok) throw new Error(`not ok: ${JSON.stringify(outcome.errors)}`);
	return outcome.capture;
}

describe('templates: value lists', () => {
	it('offers the five templates of OF-E4-1 and the web link with fixed URL values and kinds', () => {
		expect(CAPTURE_TEMPLATES).toEqual([
			'todo',
			'call',
			'shopping',
			'event',
			'project_task',
			'link'
		]);
		expect(Object.values(TEMPLATE_VALUES)).toEqual([
			'todo',
			'anruf',
			'einkauf',
			'termin',
			'projektaufgabe',
			'weblink'
		]);
		for (const template of CAPTURE_TEMPLATES) {
			expect(INBOX_KINDS).toContain(TEMPLATE_KINDS[template]);
			expect(TEMPLATE_FIELDS[template].some((field) => field.required)).toBe(true);
		}
	});

	it('creates tickets by default (OF-E4-3)', () => {
		expect(DEFAULT_CAPTURE_TARGET).toBe('ticket');
		expect(DEFAULT_CAPTURE_TEMPLATE).toBe('todo');
	});

	it('reads the template of the URL and ignores unknown or repeated values', () => {
		const read = (query: string) => templateFrom(new URLSearchParams(query));
		expect(TEMPLATE_PARAM).toBe('vorlage');
		expect(read('vorlage=anruf')).toBe('call');
		expect(read('vorlage=projektaufgabe')).toBe('project_task');
		expect(read('')).toBe('todo');
		expect(read('vorlage=Anruf')).toBe('todo');
		expect(read('vorlage=anruf&vorlage=termin')).toBe('todo');
	});
});

describe('templates: to-do', () => {
	it('takes the text as title, minimal input', () => {
		const capture = built('todo', { what: '  Milch   kaufen ' });
		expect(capture).toMatchObject({
			kind: 'todo',
			title: 'Milch kaufen',
			description: '',
			priority: 'medium',
			due: null,
			project: null,
			tagIds: [],
			tagNames: [],
			sourceDate: null
		});
	});

	it('keeps due date and priority, full input; fields of other templates are ignored', () => {
		const capture = built('todo', {
			what: 'Steuer',
			due: '2026-10-01',
			priority: 'high',
			project: PROJECT,
			who: 'Anna'
		});
		expect(capture).toMatchObject({ title: 'Steuer', due: '2026-10-01', priority: 'high' });
		expect(capture.project).toBeNull();
	});

	it('requires the text and a valid due date', () => {
		expect(buildCapture('todo', input({ what: '   ', due: '2026-02-30' }))).toEqual({
			ok: false,
			errors: { what: REQUIRED_MESSAGE, due: INVALID_DATE_MESSAGE }
		});
	});

	it('cuts titles to 200 characters with "…"', () => {
		const capture = built('todo', { what: 'x'.repeat(250) });
		expect(capture.title).toHaveLength(200);
		expect(capture.title.endsWith('…')).toBe(true);
		expect(fitTitle('y'.repeat(200))).toBe('y'.repeat(200));
	});
});

describe('templates: call', () => {
	it('builds "Anrufen: <Wen>" with the tag "Anruf", minimal input', () => {
		const capture = built('call', { who: 'Zahnarzt' });
		expect(capture).toMatchObject({
			kind: 'task',
			title: 'Anrufen: Zahnarzt',
			description: '',
			tagNames: ['Anruf']
		});
	});

	it('lists number and reason, escaped, full input', () => {
		const capture = built('call', {
			who: 'Praxis Dr. Weber',
			phone: '+49 30 123-45',
			reason: 'Termin *verschieben*',
			due: '2026-09-30'
		});
		expect(capture.description).toBe(
			'- **Nummer:** \\+49 30 123\\-45\n- **Anlass:** Termin \\*verschieben\\*'
		);
		expect(capture.due).toBe('2026-09-30');
	});

	it('requires whom to call', () => {
		expect(buildCapture('call', input({ phone: '123' }))).toEqual({
			ok: false,
			errors: { who: REQUIRED_MESSAGE }
		});
	});
});

describe('templates: shopping', () => {
	it('reads one article per non-empty line', () => {
		expect(shoppingItems(' Milch \r\n\n  Brot  \nÄpfel')).toEqual(['Milch', 'Brot', 'Äpfel']);
	});

	it('titles after the first article and makes a checklist, minimal input', () => {
		expect(built('shopping', { items: 'Milch' })).toMatchObject({
			title: 'Einkauf: Milch',
			description: '- [ ] Milch',
			tagNames: ['Einkauf']
		});
		expect(built('shopping', { items: 'Milch\nBrot [2x]' })).toMatchObject({
			title: 'Einkauf: Milch …',
			description: '- [ ] Milch\n- [ ] Brot \\[2x\\]'
		});
	});

	it('titles after the store, full input', () => {
		const capture = built('shopping', { items: 'Milch\nBrot', store: 'Markt', due: '2026-09-26' });
		expect(capture).toMatchObject({ title: 'Einkauf: Markt', due: '2026-09-26' });
		expect(capture.body).toBe(capture.description);
	});

	it('requires at least one article', () => {
		expect(buildCapture('shopping', input({ items: ' \n \n', store: 'Markt' }))).toEqual({
			ok: false,
			errors: { items: REQUIRED_MESSAGE }
		});
	});
});

describe('templates: event', () => {
	it('keeps the date at the sender as whole day in Berlin, never as due date (P-5)', () => {
		const capture = built('event', { what: 'Elternabend', date: '2026-12-24' });
		expect(capture).toMatchObject({
			kind: 'event',
			title: 'Elternabend',
			due: null,
			tagNames: ['Termin'],
			sourceDate: '2026-12-23 23:00:00.000Z',
			sourceMeta: { all_day: true }
		});
		expect(capture.description).toBe('- **Termin:** 24.12.2026');
		expect(capture.body).toBe('');
	});

	it('converts time and place, full input, in summer time', () => {
		const capture = built('event', {
			what: 'Zahnarzt',
			date: '2026-07-01',
			time: '14:30',
			place: 'Praxis',
			due: '2026-06-30'
		});
		expect(capture.sourceDate).toBe('2026-07-01 12:30:00.000Z');
		expect(capture.sourceMeta).toEqual({ location: 'Praxis' });
		expect(capture.description).toBe('- **Termin:** 01.07.2026 14:30\n- **Ort:** Praxis');
		expect(capture.due).toBeNull();
	});

	it('requires what and a valid date and checks the time', () => {
		expect(buildCapture('event', input({ date: '' }))).toEqual({
			ok: false,
			errors: { what: REQUIRED_MESSAGE, date: REQUIRED_MESSAGE }
		});
		expect(buildCapture('event', input({ what: 'X', date: '2026-13-01', time: '25:00' }))).toEqual({
			ok: false,
			errors: { date: INVALID_DATE_MESSAGE, time: INVALID_TIME_MESSAGE }
		});
	});
});

describe('templates: project task', () => {
	it('sets the project, minimal input', () => {
		expect(built('project_task', { what: 'Angebot', project: PROJECT })).toMatchObject({
			kind: 'project_task',
			title: 'Angebot',
			project: PROJECT,
			tagNames: []
		});
	});

	it('keeps priority, due date and chosen tags once each, full input', () => {
		const capture = built('project_task', {
			what: 'Angebot',
			project: PROJECT,
			priority: 'urgent',
			due: '2026-10-10',
			tagIds: [TAG, TAG]
		});
		expect(capture).toMatchObject({ priority: 'urgent', due: '2026-10-10', tagIds: [TAG] });
	});

	it('requires project and text', () => {
		expect(buildCapture('project_task', input())).toEqual({
			ok: false,
			errors: { project: REQUIRED_MESSAGE, what: REQUIRED_MESSAGE }
		});
	});
});

describe('templates: drafts', () => {
	it('makes an open ticket with the tags of the form and of the template', () => {
		const capture = built('call', { who: 'Anna', due: '2026-10-02' });
		expect(captureTicketDraft(capture, ['tagcall00000001'])).toEqual({
			title: 'Anrufen: Anna',
			description: '',
			status: 'open',
			priority: 'medium',
			due: '2026-10-02',
			project: null,
			tags: ['tagcall00000001']
		});
	});

	it('makes a manual inbox entry with the kind and the ticket values as preset', () => {
		const capture = built('project_task', {
			what: 'Angebot',
			project: PROJECT,
			priority: 'high',
			due: '2026-10-10',
			tagIds: [TAG]
		});
		expect(captureInboxDraft(capture, [])).toEqual({
			channel: 'manual',
			kind: 'project_task',
			title: 'Angebot',
			body: '',
			sourceDate: null,
			sourceMeta: {
				template: 'projektaufgabe',
				[PRESET_META_KEY]: {
					project: PROJECT,
					tags: [TAG],
					priority: 'high',
					due: '2026-10-10'
				}
			}
		});
	});

	it('leaves the preset out when nothing was chosen and keeps the event date', () => {
		const capture = built('event', { what: 'Fest', date: '2026-08-01', time: '18:00' });
		expect(captureInboxDraft(capture, [])).toEqual({
			channel: 'manual',
			kind: 'event',
			title: 'Fest',
			body: '',
			sourceDate: '2026-08-01 16:00:00.000Z',
			sourceMeta: { template: 'termin' }
		});
	});
});

describe('templates: web link (E4 plan, package 7)', () => {
	it('keeps the address, the title and the excerpt as quote, and always goes into the inbox', () => {
		const capture = built('link', {
			url: ' https://example.com/a ',
			what: 'Artikel',
			excerpt: 'Erste *Zeile*\nZweite [Link](javascript:x)'
		});
		expect(capture).toMatchObject({
			kind: 'link',
			title: 'Artikel',
			sourceUrl: 'https://example.com/a',
			body: '> Erste \\*Zeile\\*\n> Zweite \\[Link\\]\\(javascript:x\\)',
			tagNames: []
		});
		expect(capture.description.startsWith('- **Link:** <https://example.com/a>\n\n> Erste')).toBe(
			true
		);
		expect(targetOf('link', 'ticket')).toBe('inbox');
		expect(targetOf('todo', 'ticket')).toBe('ticket');
		expect(captureInboxDraft(capture, [])).toEqual({
			channel: 'link',
			kind: 'link',
			title: 'Artikel',
			body: capture.body,
			sourceUrl: 'https://example.com/a',
			sourceDate: null,
			sourceMeta: { template: 'weblink' }
		});
	});

	it('requires address and title and refuses other schemes', () => {
		expect(buildCapture('link', input())).toEqual({
			ok: false,
			errors: { url: REQUIRED_MESSAGE, what: REQUIRED_MESSAGE }
		});
		for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///C:/x', 'example.com']) {
			expect(buildCapture('link', input({ url, what: 'T' }))).toEqual({
				ok: false,
				errors: { url: INVALID_URL_MESSAGE }
			});
		}
	});

	it('has no text without an excerpt', () => {
		const capture = built('link', { url: 'http://example.com', what: 'T' });
		expect(capture.body).toBe('');
		expect(capture.description).toBe('- **Link:** <http://example.com>');
	});
});
