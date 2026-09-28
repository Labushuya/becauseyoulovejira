// Hint in an open tab (ADR-0035 section 5; plan start-fenster, SF-3): the message of the server is
// confirmed before the flag appears, "stop" needs no ack and stays until the connection is back,
// the title blinks for "start" and "datei", repeated messages show one flag. Plus the parser of
// the realtime event and the subscription through a fake source.

import { describe, expect, it, vi } from 'vitest';
import { parseAttention, type AttentionMessage } from '$lib/data/attention';
import { APP_OPENED_AGAIN, APP_STOPPED } from '$lib/guidance/texts';
import { AttentionStore, type AttentionSource } from './attention.svelte';
import type { FlagInput, FlagSink } from './flags.svelte';

const NONCE = 'Ab3dEf6hIj9kLm2nOp5qRs8t';

function setup(ack: (nonce: string) => Promise<unknown> = async () => undefined) {
	const order: string[] = [];
	const shown = new Map<string, FlagInput>();
	let count = 0;
	const flags: FlagSink = {
		show: vi.fn((input: FlagInput) => {
			order.push(`flag:${input.title}`);
			count += 1;
			const id = `flag-${count}`;
			shown.set(id, input);
			return id;
		}),
		dismiss: vi.fn((id: string) => {
			const input = shown.get(id);
			shown.delete(id);
			input?.onclose?.();
		})
	};
	const ackSpy = vi.fn((nonce: string) => {
		order.push(`ack:${nonce}`);
		return ack(nonce);
	});
	const blink = vi.fn(() => order.push('blink'));
	const store = new AttentionStore({ ack: ackSpy, flags, blink });
	return { store, flags, shown, order, ack: ackSpy, blink };
}

const message = (reason: AttentionMessage['reason']): AttentionMessage => ({
	nonce: NONCE,
	reason
});

describe('AttentionStore', () => {
	it('confirms first, then shows the flag and blinks', () => {
		const { store, order, shown } = setup();
		store.receive(message('start'));
		expect(order).toEqual([`ack:${NONCE}`, `flag:${APP_OPENED_AGAIN.title}`, 'blink']);
		const [flag] = [...shown.values()];
		expect(flag).toMatchObject({
			tone: 'info',
			title: 'Du hast becauseyoulovejira erneut geöffnet.',
			description: 'Die App ist hier schon offen.'
		});
		// 8 s like every info flag (paused while the tab is hidden).
		expect(flag?.duration).toBeUndefined();
	});

	it('shows the flag for the landing page as well, even when the ack fails', async () => {
		const { store, shown, blink } = setup(async () => {
			throw new Error('offline');
		});
		store.receive(message('datei'));
		await Promise.resolve();
		expect([...shown.values()].map((flag) => flag.title)).toEqual([APP_OPENED_AGAIN.title]);
		expect(blink).toHaveBeenCalledOnce();
	});

	it('shows one flag for repeated messages', () => {
		const { store, shown } = setup();
		store.receive(message('start'));
		store.receive(message('start'));
		expect(shown.size).toBe(1);
	});

	it('says "beendet" without ack and without blinking, and keeps it', () => {
		const { store, shown, ack, blink } = setup();
		store.receive(message('stop'));
		expect(ack).not.toHaveBeenCalled();
		expect(blink).not.toHaveBeenCalled();
		const [flag] = [...shown.values()];
		expect(flag).toMatchObject({
			tone: 'info',
			title: 'becauseyoulovejira wurde beendet (stop.bat).',
			description: 'Zum Weiterarbeiten start.bat ausführen.',
			duration: null
		});
		store.receive(message('stop'));
		expect(shown.size).toBe(1);
		expect(APP_STOPPED.title).toBe(flag?.title);
	});

	it('drops "beendet" once the connection is back or the app was opened again', () => {
		const { store, shown } = setup();
		store.receive(message('stop'));
		store.reconnected();
		expect(shown.size).toBe(0);

		store.receive(message('stop'));
		store.receive(message('start'));
		expect([...shown.values()].map((flag) => flag.title)).toEqual([APP_OPENED_AGAIN.title]);
		// A closed flag can come again.
		store.receive(message('stop'));
		expect(shown.size).toBe(2);
	});

	it('asks for the Windows notification with the flag, not for "beendet" (SF-6)', () => {
		const notify = vi.fn();
		const flags: FlagSink = { show: vi.fn(() => 'flag-1'), dismiss: vi.fn() };
		const withNotify = new AttentionStore({
			ack: async () => undefined,
			flags,
			blink: vi.fn(),
			notify
		});
		withNotify.receive(message('stop'));
		expect(notify).not.toHaveBeenCalled();
		withNotify.receive(message('start'));
		withNotify.show('datei');
		expect(notify).toHaveBeenCalledTimes(2);
	});

	it('shows the hint of another tab without ack', () => {
		const { store, ack, shown } = setup();
		store.show('start');
		expect(ack).not.toHaveBeenCalled();
		expect(shown.size).toBe(1);
	});

	it('subscribes to the messages and the reconnections and ends both', async () => {
		const { store, shown } = setup();
		let onMessage: (message: AttentionMessage) => void = () => undefined;
		let onReconnect: () => void = () => undefined;
		const stops = {
			messages: vi.fn(async () => undefined),
			reconnect: vi.fn(async () => undefined)
		};
		const source: AttentionSource = {
			attention: async (callback) => {
				onMessage = callback;
				return stops.messages;
			},
			reconnected: async (callback) => {
				onReconnect = callback;
				return stops.reconnect;
			}
		};
		const stop = store.connect(source);
		await new Promise((resolve) => setTimeout(resolve, 0));
		onMessage(message('stop'));
		expect(shown.size).toBe(1);
		onReconnect();
		expect(shown.size).toBe(0);
		stop();
		expect(stops.messages).toHaveBeenCalledOnce();
		expect(stops.reconnect).toHaveBeenCalledOnce();
	});
});

describe('parseAttention', () => {
	it('reads nonce and reason', () => {
		expect(parseAttention({ nonce: NONCE, reason: 'datei' })).toEqual({
			nonce: NONCE,
			reason: 'datei'
		});
	});

	it.each([
		null,
		'text',
		{ nonce: NONCE },
		{ nonce: NONCE, reason: 'restart' },
		{ nonce: 'kurz', reason: 'start' },
		{ nonce: '../../api/collections/users', reason: 'start' }
	])('drops %j', (data) => {
		expect(parseAttention(data)).toBeNull();
	});
});
