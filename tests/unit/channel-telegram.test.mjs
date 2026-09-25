// Telegram bot, pure part (E4 plan, package 17): allowlist, text and captions, the order "save,
// confirm, move the offset", the hint for unknown chats, and failures of saving and confirming.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const telegram = loadHookLib('channel-telegram.js');
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
			confirm: (chatId, messageId) => log.push(['confirm', chatId, messageId]),
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
			'Nachricht aus einem nicht freigegebenen Chat (Chat-ID 999 („Fremd“)), nicht gespeichert. Zum Freigeben die ID in BYL_TELEGRAM_ALLOWED_IDS aufnehmen (setx), dann stop.bat und start.bat.'
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
