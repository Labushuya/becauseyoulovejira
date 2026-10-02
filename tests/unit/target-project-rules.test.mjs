// Pure rules of the target project of the ways into the inbox (ADR-0049, package 1): cards of the
// channels, the stored targets of a user and their check, the order in which a new entry gets its
// target, which project it keeps, which one a user may choose, and the note of a deleted target.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('target-project-rules.js');

const HAUS = 'haus00000000001';
const ARBEIT = 'arbeit000000001';

describe('cards without a connection', () => {
	it('names the card of each channel that has one', () => {
		expect(rules.CARDS).toEqual(['api', 'whatsapp-web', 'files']);
		expect(rules.cardOfChannel('api')).toBe('api');
		expect(rules.cardOfChannel('whatsapp-web')).toBe('whatsapp-web');
		for (const channel of ['eml', 'ics', 'whatsapp']) expect(rules.cardOfChannel(channel)).toBe('files');
		for (const channel of ['manual', 'quick', 'clipboard', 'link', 'mail', 'calendar', 'telegram', 'notion', '']) {
			expect(rules.cardOfChannel(channel), channel).toBe('');
		}
	});
});

describe('stored targets of a user', () => {
	it('reads every card, invalid parts as none', () => {
		expect(rules.targetsOf(null)).toEqual({ api: '', 'whatsapp-web': '', files: '' });
		expect(rules.targetsOf('')).toEqual({ api: '', 'whatsapp-web': '', files: '' });
		expect(rules.targetsOf('null')).toEqual({ api: '', 'whatsapp-web': '', files: '' });
		expect(rules.targetsOf('{kaputt')).toEqual({ api: '', 'whatsapp-web': '', files: '' });
		expect(rules.targetsOf(JSON.stringify({ files: HAUS, api: 'zu-kurz', mail: ARBEIT }))).toEqual({
			api: '',
			'whatsapp-web': '',
			files: HAUS
		});
		expect(rules.targetsOf({ 'whatsapp-web': ARBEIT })).toEqual({ api: '', 'whatsapp-web': ARBEIT, files: '' });
		expect(rules.targetsOf([HAUS])).toEqual({ api: '', 'whatsapp-web': '', files: '' });
	});

	it('accepts only the cards with an ID or empty', () => {
		for (const value of [null, undefined, '', {}, { files: '' }, { api: HAUS, 'whatsapp-web': ARBEIT, files: '' }]) {
			expect(rules.targetsViolation(value), JSON.stringify(value)).toBe('');
		}
		for (const value of [{ mail: '' }, { files: 'Haus' }, { files: null }, { api: 12 }, [HAUS], 'files', 3, true]) {
			expect(rules.targetsViolation(value), JSON.stringify(value)).toBe(rules.MESSAGES.validation_inbox_targets);
		}
	});

	it('names the cards whose target changed', () => {
		expect(rules.changedCards(null, { files: HAUS })).toEqual(['files']);
		expect(rules.changedCards(JSON.stringify({ files: HAUS }), { files: HAUS, api: '' })).toEqual([]);
		expect(rules.changedCards({ api: HAUS, files: HAUS }, { api: ARBEIT })).toEqual(['api', 'files']);
	});
});

describe('target of a new entry', () => {
	it('takes a given target first, then the connection, then the card', () => {
		const sources = { given: null, hasConnection: false, connectionTarget: '', cardTarget: HAUS };
		expect(rules.requestedTarget(sources)).toBe(HAUS);
		expect(rules.requestedTarget({ ...sources, hasConnection: true, connectionTarget: ARBEIT })).toBe(ARBEIT);
		// A connection without a target takes none, not the card of its channel.
		expect(rules.requestedTarget({ ...sources, hasConnection: true })).toBe('');
		// A target the server resolved wins, also "explicitly none" (the copy of a source without one).
		expect(rules.requestedTarget({ ...sources, given: ARBEIT, hasConnection: true, connectionTarget: HAUS })).toBe(ARBEIT);
		expect(rules.requestedTarget({ ...sources, given: '' })).toBe('');
		expect(rules.requestedTarget({ ...sources, given: undefined })).toBe(HAUS);
		expect(rules.requestedTarget({ ...sources, cardTarget: 'kein-projekt' })).toBe('');
	});

	it('keeps a project of the area of the entry, an archived one too', () => {
		expect(rules.usableTarget(HAUS, { scope: 'u:a' }, 'u:a')).toBe(HAUS);
		expect(rules.usableTarget(HAUS, { scope: 'u:a', archived: true }, 'u:a')).toBe(HAUS);
		expect(rules.usableTarget(HAUS, { scope: 'h:1' }, 'u:a')).toBe('');
		expect(rules.usableTarget(HAUS, null, 'u:a')).toBe('');
		expect(rules.usableTarget('', { scope: 'u:a' }, 'u:a')).toBe('');
	});
});

describe('choosing a target', () => {
	it('allows only an active project of the area of the way', () => {
		expect(rules.choiceViolation({ scope: 'u:a', archived: false }, 'u:a')).toBe('');
		expect(rules.choiceViolation({ scope: 'u:a', archived: true }, 'u:a')).toBe('validation_target_project_archived');
		// A project of another area reads like a missing one: foreign IDs cannot be guessed.
		expect(rules.choiceViolation({ scope: 'u:b', archived: false }, 'u:a')).toBe('validation_target_project_missing');
		expect(rules.choiceViolation(null, 'u:a')).toBe('validation_target_project_missing');
		for (const code of ['validation_target_project_missing', 'validation_target_project_archived']) {
			expect(rules.MESSAGES[code]).toMatch(/\S/);
		}
	});
});

describe('deleted target', () => {
	it('notes it in the details and keeps the rest', () => {
		expect(rules.withTargetGone({ location: 'Küche' })).toEqual({ location: 'Küche', target_gone: true });
		expect(rules.withTargetGone(null)).toEqual({ target_gone: true });
		const meta = { keyword: 'todo' };
		rules.withTargetGone(meta);
		expect(meta).toEqual({ keyword: 'todo' });
	});
});
