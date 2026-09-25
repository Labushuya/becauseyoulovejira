// WhatsApp chat export (E4 plan, package 16) against the invented fixtures in
// tests/fixtures/whatsapp: Android and iOS in German and English settings, multi-line messages,
// system lines, left-out media, Berlin wall-clock times on both clock changes.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_CHAT_NAME,
	FORMAT_NOT_RECOGNISED,
	NO_MESSAGE_FILTER,
	chatNameOf,
	matchesMessageFilter,
	messageDraft,
	messageTitle,
	parseWhatsAppExport,
	sendersOf,
	type ChatMessage
} from './whatsapp-export';

const FIXTURES = join(import.meta.dirname, '../../../../tests/fixtures/whatsapp');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

function parsed(name: string) {
	const result = parseWhatsAppExport(fixture(name));
	if (!result.ok) throw new Error(result.message);
	return result;
}

const iso = (message: ChatMessage | undefined) => new Date(message?.sentAt ?? NaN).toISOString();

describe('parseWhatsAppExport: Android, German', () => {
	const result = parsed('WhatsApp Chat mit Familie Beispiel.txt');

	it('offers the messages and leaves out system lines, media and deleted ones', () => {
		expect(result.format).toBe('android');
		expect(result.messages.map((message) => [message.sender, message.text])).toEqual([
			['Anna Beispiel', 'Wer holt am Samstag die Getränke?'],
			['Ben Muster', 'Ich! Liste bitte:\n- Wasser\n- Apfelschorle\n\nDanke 😀'],
			['Ben Muster', 'Uhr umgestellt?'],
			['Carla Test', 'Frohes neues Jahr: bis gleich!']
		]);
		expect(result.leftOut).toBe(4);
		expect(result.messages.map((message) => message.index)).toEqual([0, 1, 2, 3]);
	});

	it('reads the times as Berlin wall-clock times on both clock changes', () => {
		const [before, after, autumn, newYear] = result.messages;
		expect(iso(before)).toBe('2026-03-29T00:59:00.000Z');
		expect(iso(after)).toBe('2026-03-29T01:05:00.000Z');
		expect(iso(autumn)).toBe('2026-10-25T00:30:00.000Z');
		expect(iso(newYear)).toBe('2026-12-31T22:59:00.000Z');
		expect(newYear).toMatchObject({ date: '2026-12-31', time: '23:59' });
	});
});

describe('parseWhatsAppExport: Android, English (US)', () => {
	const result = parsed('WhatsApp Chat with Sam Example.txt');

	it('reads month first with a 12-hour clock', () => {
		expect(result.messages.map((message) => [message.date, message.time, message.text])).toEqual([
			['2026-09-25', '14:03', 'Can you call the landlord?'],
			['2026-09-25', '00:10', 'Midnight test'],
			['2026-10-01', '09:00', 'Sure,\nwill do tomorrow.']
		]);
		expect(result.leftOut).toBe(3);
	});
});

describe('parseWhatsAppExport: iOS', () => {
	it('reads the German export with seconds, CRLF and marks before system lines', () => {
		const result = parsed('_chat.txt');
		expect(result.format).toBe('ios');
		expect(result.messages.map((message) => [message.sender, message.text])).toEqual([
			['Anna Beispiel', 'Zahnarzttermin für Ben ausmachen'],
			['Ben Muster', 'Mache ich morgen.\nOder übermorgen.']
		]);
		expect(result.leftOut).toBe(4);
		expect(iso(result.messages[0])).toBe('2026-09-25T12:04:30.000Z');
	});

	it('reads the English export with day first and a four-digit year', () => {
		const result = parsed('ios-en.txt');
		expect(result.messages.map((message) => [message.date, message.time, message.text])).toEqual([
			['2026-09-25', '18:30', 'Book the table for Friday'],
			['2026-10-13', '08:00', 'Reminder: bins']
		]);
		expect(result.leftOut).toBe(2);
	});
});

describe('parseWhatsAppExport: other input', () => {
	it('refuses text that is no export', () => {
		expect(parseWhatsAppExport(fixture('no-export.txt'))).toEqual({
			ok: false,
			message: FORMAT_NOT_RECOGNISED
		});
		expect(parseWhatsAppExport('')).toEqual({ ok: false, message: FORMAT_NOT_RECOGNISED });
	});

	it('takes a BOM and skips impossible dates', () => {
		const result = parseWhatsAppExport(
			'\uFEFF31.02.26, 10:00 - Anna: Falsch\n01.03.26, 10:00 - Anna: Richtig\n'
		);
		expect(result).toMatchObject({ ok: true, leftOut: 1, messages: [{ text: 'Richtig' }] });
	});

	it('reads slash dates day first when a day is over 12', () => {
		const result = parseWhatsAppExport(
			'03/04/2026, 10:00 - A: eins\n25/04/2026, 10:00 - A: zwei\n'
		);
		expect(result).toMatchObject({
			ok: true,
			messages: [{ date: '2026-04-03' }, { date: '2026-04-25' }]
		});
	});
});

describe('helpers', () => {
	it('takes the chat name from the file name', () => {
		expect(chatNameOf('WhatsApp Chat mit Familie Beispiel.txt')).toBe('Familie Beispiel');
		expect(chatNameOf('WhatsApp Chat with Sam Example.zip')).toBe('Sam Example');
		expect(chatNameOf('WhatsApp Chat - Anna.zip')).toBe('Anna');
		expect(chatNameOf('_chat.txt')).toBe(DEFAULT_CHAT_NAME);
		expect(chatNameOf('Urlaub.txt')).toBe('Urlaub');
	});

	it('lists senders and filters by sender and period', () => {
		const { messages } = parsed('WhatsApp Chat mit Familie Beispiel.txt');
		expect(sendersOf(messages)).toEqual(['Anna Beispiel', 'Ben Muster', 'Carla Test']);
		const pick = (filter: typeof NO_MESSAGE_FILTER) =>
			messages.filter((message) => matchesMessageFilter(message, filter)).map((m) => m.index);
		expect(pick(NO_MESSAGE_FILTER)).toEqual([0, 1, 2, 3]);
		expect(pick({ sender: 'Ben Muster', from: '', to: '' })).toEqual([1, 2]);
		expect(pick({ sender: '', from: '2026-10-01', to: '2026-10-31' })).toEqual([2]);
		expect(pick({ sender: '', from: '2026-12-31', to: '' })).toEqual([3]);
	});

	it('titles a message with its first line, cut to 200 characters', () => {
		expect(messageTitle('\n  Erste   Zeile \nZweite')).toBe('Erste Zeile');
		expect(messageTitle('x'.repeat(250))).toHaveLength(200);
		expect(messageTitle('x'.repeat(250)).endsWith('…')).toBe(true);
	});

	it('builds the draft of a message with chat, sender and Berlin time as UTC', () => {
		const [, list] = parsed('WhatsApp Chat mit Familie Beispiel.txt').messages;
		expect(messageDraft(list as ChatMessage, 'Familie Beispiel')).toEqual({
			channel: 'whatsapp',
			kind: 'message',
			title: 'Ich! Liste bitte:',
			body: 'Ich! Liste bitte:\n- Wasser\n- Apfelschorle\n\nDanke 😀',
			sourceDate: '2026-03-29 01:05:00.000Z',
			sourceMeta: { chat: 'Familie Beispiel', sender: 'Ben Muster' }
		});
	});
});
