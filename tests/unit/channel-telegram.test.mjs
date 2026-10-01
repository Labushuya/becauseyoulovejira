// Telegram bot, pure part (E4 plan, packages 17 and 20): allowlist, text and captions, the order
// "save, confirm, move the offset", the hint for unknown chats, keywords with the answer for
// messages without one, both answers as switches (ADR-0016, addendum of 2026-10-01), and failures
// of saving, confirming and answering.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const telegram = loadHookLib('channel-telegram.js');
const keywords = loadHookLib('keywords.js');
const berlin = loadHookLib('berlin-time.js');

const ME = { id: 424242, is_bot: false, first_name: 'Anna', last_name: 'Beispiel', username: 'anna_b' };
const PRIVATE = { id: 424242, type: 'private', first_name: 'Anna', last_name: 'Beispiel' };
const FAMILY = { id: -100123, type: 'supergroup', title: 'Familie' };
const STRANGER = { id: 999, type: 'private', first_name: 'Fremd' };

function update(id, chat, message = {}) {
	return {
		update_id: id,
		message: {
			message_id: id * 10,
			date: 1790330400,
			chat,
			from: chat === FAMILY ? ME : chat,
			text: `Nachricht ${id}`,
			...message
		}
	};
}

function context(overrides = {}) {
	const log = [];
	return {
		log,
		ctx: {
			allowed: ['424242'],
			allowlistName: 'BYL_TELEGRAM_ALLOWED_IDS',
			berlin,
			save: (draft) => {
				log.push(['save', draft.source_ref]);
				return 'created';
			},
			replySaved: true,
			confirm: (chatId, messageId) => log.push(['confirm', chatId, messageId]),
			match: (body) => keywords.matchKeyword(['nachricht', 'todo'], [body]),
			replyNoMatch: true,
			decline: (chatId, messageId) => log.push(['decline', chatId, messageId]),
			...overrides
		}
	};
}

describe('channel-telegram.js: allowlist and drafts', () => {
	it('reads IDs separated by commas, spaces or semicolons', () => {
		expect(telegram.parseAllowlist(' 424242, -100123;7 7 abc 424242')).toEqual(['424242', '-100123', '7']);
		expect(telegram.parseAllowlist('')).toEqual([]);
	});

	it('allows a message by its chat or by its sender', () => {
		expect(telegram.isAllowed(update(1, PRIVATE).message, ['424242'])).toBe(true);
		expect(telegram.isAllowed(update(1, FAMILY).message, ['424242'])).toBe(true);
		expect(telegram.isAllowed(update(1, FAMILY).message, ['-100123'])).toBe(true);
		expect(telegram.isAllowed(update(1, STRANGER).message, ['424242'])).toBe(false);
	});

	it('takes text or caption as title and text, with chat, sender and time', () => {
		const draft = telegram.toDraft(
			update(3, FAMILY, { text: undefined, caption: '  \nZahnarzt anrufen\nwegen Termin' }).message,
			berlin
		);
		expect(draft).toEqual({
			channel: 'telegram',
			kind: 'message',
			title: 'Zahnarzt anrufen',
			body: '  \nZahnarzt anrufen\nwegen Termin',
			source_url: '',
			source_ref: '-100123:30',
			source_date: '2026-09-25 10:00:00.000Z',
			meta: { chat: 'Familie', sender: 'Anna Beispiel', chat_id: '-100123' }
		});
		expect(telegram.messageText({ photo: [{}] })).toBe('');
		expect(telegram.messageText({ text: '   ' })).toBe('');
		expect(telegram.toDraft(update(4, PRIVATE, { text: 'x'.repeat(300) }).message, berlin).title).toHaveLength(200);
		expect(telegram.toDraft(update(5, PRIVATE).message, berlin, 'todo').meta).toEqual({
			chat: 'Anna Beispiel',
			sender: 'Anna Beispiel',
			chat_id: '424242',
			keyword: 'todo'
		});
	});
});

describe('channel-telegram.js: processing', () => {
	it('saves and confirms allowed messages and moves the offset after each', () => {
		const { ctx, log } = context();
		const result = telegram.processUpdates(
			[update(12, PRIVATE), update(11, FAMILY), update(13, STRANGER), update(14, PRIVATE, { text: undefined, photo: [{}] })],
			10,
			ctx
		);
		expect(log).toEqual([
			['save', '-100123:110'],
			['confirm', -100123, 110],
			['save', '424242:120'],
			['confirm', 424242, 120]
		]);
		expect(result).toMatchObject({ cursor: 14, created: 2, duplicates: 0, skipped: 2, error: '' });
		expect(result.hint).toBe(
			'Nachricht aus einem nicht freigegebenen Chat (Chat-ID 999 („Fremd“)), nicht gespeichert. Zum Freigeben die ID in BYL_TELEGRAM_ALLOWED_IDS aufnehmen (setx), dann neu-starten.bat.'
		);
		expect(result.hint).not.toContain('Nachricht 13');
	});

	it('does not confirm duplicates and skips updates up to the offset', () => {
		const { ctx, log } = context({ save: (draft) => (log.push(['save', draft.source_ref]), 'duplicate') });
		const result = telegram.processUpdates([update(9, PRIVATE), update(12, PRIVATE)], 10, ctx);
		expect(log).toEqual([['save', '424242:120']]);
		expect(result).toMatchObject({ cursor: 12, created: 0, duplicates: 1, hint: undefined });
	});

	it('keeps the offset before a message that could not be saved and stops', () => {
		let calls = 0;
		const { ctx, log } = context({
			save: (draft) => {
				calls += 1;
				if (calls === 2) throw new Error('database is locked');
				log.push(['save', draft.source_ref]);
				return 'created';
			}
		});
		const result = telegram.processUpdates([update(11, PRIVATE), update(12, PRIVATE), update(13, PRIVATE)], 10, ctx);
		expect(result.cursor).toBe(11);
		expect(result.created).toBe(1);
		expect(result.error).toBe(
			'Nachricht 12 ließ sich nicht speichern und wird beim nächsten Abruf erneut versucht: database is locked'
		);
		expect(log).toEqual([
			['save', '424242:110'],
			['confirm', 424242, 110]
		]);
	});

	it('keeps the entry when the confirmation fails and reports it', () => {
		const { ctx } = context({
			confirm: () => {
				throw new Error('Telegram antwortet auf sendMessage mit HTTP 500');
			}
		});
		const result = telegram.processUpdates([update(11, PRIVATE), update(12, PRIVATE)], 10, ctx);
		expect(result).toMatchObject({ cursor: 12, created: 2 });
		expect(result.error).toBe(
			'Gespeichert, aber die Bestätigung „Im Eingang gespeichert“ ging nicht raus (2×): Telegram antwortet auf sendMessage mit HTTP 500'
		);
	});

	it('saves only messages with a keyword and answers the others (ADR-0020)', () => {
		const saved = [];
		const { ctx, log } = context({
			save: (draft) => {
				saved.push(draft);
				log.push(['save', draft.source_ref]);
				return 'created';
			}
		});
		const result = telegram.processUpdates(
			[update(11, PRIVATE, { text: 'Hallo' }), update(12, PRIVATE, { text: 'TODO: Müll' }), update(13, STRANGER, { text: 'todo' })],
			10,
			ctx
		);
		expect(log).toEqual([
			['decline', 424242, 110],
			['save', '424242:120'],
			['confirm', 424242, 120]
		]);
		expect(saved[0].meta.keyword).toBe('todo');
		expect(result).toMatchObject({ cursor: 13, created: 1, unmatched: 1, skipped: 1, error: '' });
		expect(telegram.NO_MATCH).toBe('Kein Stichwort erkannt – nicht gespeichert');
	});

	it('stays silent without keyword when the answer is switched off, and with an empty list', () => {
		const quiet = context({ replyNoMatch: false });
		expect(telegram.processUpdates([update(11, PRIVATE, { text: 'Hallo' })], 10, quiet.ctx)).toMatchObject({
			cursor: 11,
			created: 0,
			unmatched: 1
		});
		expect(quiet.log).toEqual([]);
		const empty = context({ match: (body) => keywords.matchKeyword([], [body]) });
		expect(telegram.processUpdates([update(11, PRIVATE)], 10, empty.ctx)).toMatchObject({ created: 0, unmatched: 1 });
		expect(empty.log).toEqual([['decline', 424242, 110]]);
	});

	it('saves without a confirmation when it is switched off, and still answers without keyword', () => {
		const { ctx, log } = context({ replySaved: false });
		const result = telegram.processUpdates(
			[update(11, PRIVATE, { text: 'todo Milch' }), update(12, PRIVATE, { text: 'Hallo' }), update(13, FAMILY, { text: 'todo Brot' })],
			10,
			ctx
		);
		expect(log).toEqual([
			['save', '424242:110'],
			['decline', 424242, 120],
			['save', '-100123:130']
		]);
		expect(result).toMatchObject({ cursor: 13, created: 2, unmatched: 1, error: '' });
	});

	it('stays silent with both answers switched off, and never answers a duplicate or a stranger', () => {
		const quiet = context({ replySaved: false, replyNoMatch: false });
		const result = telegram.processUpdates(
			[update(11, PRIVATE, { text: 'todo Milch' }), update(12, PRIVATE, { text: 'Hallo' }), update(13, STRANGER, { text: 'todo' })],
			10,
			quiet.ctx
		);
		expect(quiet.log).toEqual([['save', '424242:110']]);
		expect(result).toMatchObject({ cursor: 13, created: 1, unmatched: 1, skipped: 1, error: '' });
		expect(result.hint).toMatch(/Chat-ID 999/);

		// With both on, a duplicate and a message of a chat that is not allowed get no answer either.
		const loud = context({ save: (draft) => (loud.log.push(['save', draft.source_ref]), 'duplicate') });
		const again = telegram.processUpdates([update(11, PRIVATE, { text: 'todo Milch' }), update(12, STRANGER, { text: 'Hallo' })], 10, loud.ctx);
		expect(loud.log).toEqual([['save', '424242:110']]);
		expect(again).toMatchObject({ cursor: 12, created: 0, duplicates: 1, unmatched: 0, skipped: 1, error: '' });
	});

	it('moves on when the answer fails and reports it with a failed confirmation', () => {
		const { ctx } = context({
			decline: () => {
				throw new Error('HTTP 403');
			},
			confirm: () => {
				throw new Error('HTTP 500');
			}
		});
		const result = telegram.processUpdates([update(11, PRIVATE, { text: 'Hallo' }), update(12, PRIVATE)], 10, ctx);
		expect(result).toMatchObject({ cursor: 12, created: 1, unmatched: 1 });
		expect(result.error).toBe(
			'Gespeichert, aber die Bestätigung „Im Eingang gespeichert“ ging nicht raus (1×): HTTP 500 Die Antwort „Kein Stichwort erkannt – nicht gespeichert“ ging nicht raus (1×): HTTP 403'
		);
	});

	it('moves past updates without a message', () => {
		const { ctx } = context();
		expect(telegram.processUpdates([{ update_id: 11, edited_message: {} }], 10, ctx)).toMatchObject({
			cursor: 11,
			skipped: 1
		});
		expect(telegram.processUpdates([], 10, ctx)).toMatchObject({ cursor: 10, created: 0 });
		expect(telegram.processUpdates(null, 10, ctx)).toMatchObject({ cursor: 10 });
	});
});
