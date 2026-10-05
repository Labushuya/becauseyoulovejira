// The live notice of an assignment (E7-5, ADR-0068 §4): every notice of the server becomes an info
// flag "Anna hat dir HAUS-12 zugewiesen." with the title of the ticket and "Öffnen", which leads to
// the ticket; the cleanup ends the subscription. The topic is read strictly.

import { describe, expect, it, vi } from 'vitest';
import { ASSIGNED_TOPIC, parseAssignedNotice, subscribeAssigned } from '$lib/data/assigned';
import type PocketBase from 'pocketbase';
import { AssignedNotices, OPEN_ASSIGNED_LABEL, type AssignedLive } from './assigned-notices.svelte';
import type { FlagInput } from './flags.svelte';
import { LiveHealth } from './live-health.svelte';

const NOTICE = {
	ticket: 'ticket000000001',
	key: 'HAUS-12',
	title: 'Müll rausbringen',
	scope: 'h:house0000000001',
	by: 'bert00000000002',
	byName: 'Bert Beispiel'
};

function fakeLive() {
	let listener: ((notice: typeof NOTICE) => void) | null = null;
	const unsubscribe = vi.fn(async () => undefined);
	const live: AssignedLive = {
		notices: vi.fn(async (onNotice) => {
			listener = onNotice;
			return unsubscribe;
		})
	};
	return { live, unsubscribe, send: (notice: typeof NOTICE) => listener?.(notice) };
}

describe('AssignedNotices', () => {
	it('shows an info flag with the sentence, the title and "Öffnen", which opens the ticket', async () => {
		const shown: FlagInput[] = [];
		const flags = {
			show: vi.fn((input: FlagInput) => (shown.push(input), 'flag')),
			dismiss: vi.fn()
		};
		const open = vi.fn();
		const notices = new AssignedNotices(flags, open, { health: new LiveHealth() });
		const { live, send, unsubscribe } = fakeLive();

		const stop = notices.connect(live);
		await vi.waitFor(() => expect(live.notices).toHaveBeenCalledTimes(1));
		send(NOTICE);

		expect(shown).toHaveLength(1);
		expect(shown[0]).toMatchObject({
			tone: 'info',
			title: 'Bert Beispiel hat dir HAUS-12 zugewiesen.',
			description: 'Müll rausbringen'
		});
		expect(shown[0]?.action?.label).toBe(OPEN_ASSIGNED_LABEL);
		shown[0]?.action?.run();
		expect(open).toHaveBeenCalledExactlyOnceWith(NOTICE);

		stop();
		await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
		send(NOTICE);
		expect(shown).toHaveLength(1);
	});

	it('names "Jemand" without a name and leaves an empty title out', () => {
		const flags = { show: vi.fn<(input: FlagInput) => string>(() => 'flag'), dismiss: vi.fn() };
		new AssignedNotices(flags, vi.fn()).show({ ...NOTICE, byName: '', title: '' });
		const input = flags.show.mock.calls[0]?.[0] as FlagInput | undefined;
		expect(input?.title).toBe('Jemand hat dir HAUS-12 zugewiesen.');
		expect(input).not.toHaveProperty('description');
	});
});

describe('topic byl/assigned', () => {
	it('reads a notice of the server and nothing else', () => {
		expect(
			parseAssignedNotice({
				ticket: NOTICE.ticket,
				key: NOTICE.key,
				title: NOTICE.title,
				scope: NOTICE.scope,
				by: NOTICE.by,
				by_name: NOTICE.byName
			})
		).toEqual(NOTICE);
		expect(parseAssignedNotice({ ticket: NOTICE.ticket })).toBeNull();
		expect(parseAssignedNotice({ key: 'HAUS-12', ticket: 7 })).toBeNull();
		expect(parseAssignedNotice('HAUS-12')).toBeNull();
		expect(parseAssignedNotice(null)).toBeNull();
	});

	it('subscribes to the topic and passes on only notices', async () => {
		const listener: { send: (data: unknown) => void } = { send: () => undefined };
		const subscribe = vi.fn(async (_topic: string, callback: (data: unknown) => void) => {
			listener.send = callback;
			return async () => undefined;
		});
		const pb = { realtime: { subscribe } } as unknown as PocketBase;
		const onNotice = vi.fn();

		await subscribeAssigned(pb, onNotice);
		expect(subscribe.mock.calls[0]?.[0]).toBe(ASSIGNED_TOPIC);
		listener.send({ nonsense: true });
		listener.send({ ticket: NOTICE.ticket, key: NOTICE.key, by_name: 'Bert Beispiel' });

		expect(onNotice).toHaveBeenCalledTimes(1);
		expect(onNotice.mock.calls[0]?.[0]).toMatchObject({ key: 'HAUS-12', byName: 'Bert Beispiel' });
	});
});
