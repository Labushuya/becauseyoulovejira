// Windows notification for "opened again" (ADR-0035 section 5; plan start-fenster, SF-6): off by
// default, the permission is asked only on enable(), granted switches on, denied or dismissed stays
// off, a notification appears only when on, allowed and hidden, and its click brings the tab
// forward. Other tabs follow; a browser without the API leaves the switch disabled.

import { describe, expect, it, vi } from 'vitest';
import {
	NOTIFY_STORAGE_KEY,
	NOTIFY_TAG,
	NotifyStore,
	readNotify,
	writeNotify,
	type NotificationApi
} from './attention-notify.svelte';

/** Notification API of a browser with the given permission and answer to the request. */
function notificationApi(
	permission: NotificationPermission,
	answer: NotificationPermission = permission
) {
	const shown: { title: string; options?: NotificationOptions; instance: FakeNotification }[] = [];
	class FakeNotification {
		static permission: NotificationPermission = permission;
		static requestPermission = vi.fn(async () => {
			FakeNotification.permission = answer;
			return answer;
		});
		onclick: (() => void) | null = null;
		close = vi.fn();
		constructor(title: string, options?: NotificationOptions) {
			shown.push({ title, options, instance: this });
		}
	}
	return { api: FakeNotification as unknown as NotificationApi & typeof FakeNotification, shown };
}

function fakeWindow(api: unknown, entries: Record<string, string> = {}) {
	const data = new Map(Object.entries(entries));
	const listeners = new Set<(event: StorageEvent) => void>();
	return {
		Notification: api,
		document: { visibilityState: 'hidden' as DocumentVisibilityState },
		focus: vi.fn(),
		localStorage: {
			getItem: (key: string) => data.get(key) ?? null,
			setItem: (key: string, value: string) => void data.set(key, value),
			removeItem: (key: string) => void data.delete(key)
		},
		addEventListener: (_type: string, listener: (event: StorageEvent) => void) =>
			listeners.add(listener),
		removeEventListener: (_type: string, listener: (event: StorageEvent) => void) =>
			listeners.delete(listener),
		data,
		listeners
	};
}

const store = (win: ReturnType<typeof fakeWindow>) => new NotifyStore(win as unknown as Window);

describe('NotifyStore', () => {
	it('is off by default and never asks on its own', () => {
		const { api } = notificationApi('default');
		const notify = store(fakeWindow(api));
		expect(notify.enabled).toBe(false);
		expect(notify.active).toBe(false);
		expect(notify.supported).toBe(true);
		expect(notify.notify()).toBe(false);
		expect(api.requestPermission).not.toHaveBeenCalled();
	});

	it('asks for the permission on enable and switches on when it is granted', async () => {
		const { api } = notificationApi('default', 'granted');
		const win = fakeWindow(api);
		const notify = store(win);
		await expect(notify.enable()).resolves.toBe(true);
		expect(api.requestPermission).toHaveBeenCalledOnce();
		expect(notify.enabled).toBe(true);
		expect(notify.permission).toBe('granted');
		expect(win.data.get(NOTIFY_STORAGE_KEY)).toBe('on');
	});

	it.each(['denied', 'default'] as const)('stays off when the permission is %s', async (answer) => {
		const { api } = notificationApi('default', answer);
		const win = fakeWindow(api);
		const notify = store(win);
		await expect(notify.enable()).resolves.toBe(false);
		expect(notify.enabled).toBe(false);
		expect(notify.permission).toBe(answer);
		expect(win.data.has(NOTIFY_STORAGE_KEY)).toBe(false);
	});

	it('does not ask again when the permission is granted already', async () => {
		const { api } = notificationApi('granted');
		const notify = store(fakeWindow(api));
		await notify.enable();
		expect(api.requestPermission).not.toHaveBeenCalled();
		expect(notify.active).toBe(true);
	});

	it('shows the notification only in a hidden tab and brings the tab forward on a click', async () => {
		const { api, shown } = notificationApi('granted');
		const win = fakeWindow(api, { [NOTIFY_STORAGE_KEY]: 'on' });
		const notify = store(win);

		win.document.visibilityState = 'visible';
		expect(notify.notify()).toBe(false);
		win.document.visibilityState = 'hidden';
		expect(notify.notify()).toBe(true);
		expect(shown).toHaveLength(1);
		expect(shown[0]?.title).toBe('becauseyoulovejira ist schon offen');
		expect(shown[0]?.options).toMatchObject({
			body: 'Klicken, um dorthin zu wechseln.',
			tag: NOTIFY_TAG
		});

		shown[0]?.instance.onclick?.();
		expect(win.focus).toHaveBeenCalledOnce();
		expect(shown[0]?.instance.close).toHaveBeenCalledOnce();
	});

	it('shows nothing once the permission was taken back in the browser', () => {
		const { api } = notificationApi('granted');
		const notify = store(fakeWindow(api, { [NOTIFY_STORAGE_KEY]: 'on' }));
		(api as { permission: NotificationPermission }).permission = 'denied';
		expect(notify.active).toBe(false);
		expect(notify.notify()).toBe(false);
	});

	it('switches off and forgets the choice', async () => {
		const { api } = notificationApi('granted');
		const win = fakeWindow(api);
		const notify = store(win);
		await notify.enable();
		notify.disable();
		expect(notify.enabled).toBe(false);
		expect(win.data.has(NOTIFY_STORAGE_KEY)).toBe(false);
		expect(notify.notify()).toBe(false);
	});

	it('follows the choice of another tab', () => {
		const { api } = notificationApi('granted');
		const win = fakeWindow(api);
		const notify = store(win);
		const stop = notify.connect();
		for (const listener of win.listeners) {
			listener({ key: NOTIFY_STORAGE_KEY, newValue: 'on' } as StorageEvent);
		}
		expect(notify.enabled).toBe(true);
		for (const listener of win.listeners) listener({ key: null, newValue: null } as StorageEvent);
		expect(notify.enabled).toBe(false);
		stop();
		expect(win.listeners.size).toBe(0);
	});

	it('does nothing without the Notification API', async () => {
		const notify = store(fakeWindow(undefined, { [NOTIFY_STORAGE_KEY]: 'on' }));
		expect(notify.supported).toBe(false);
		expect(notify.active).toBe(false);
		await expect(notify.enable()).resolves.toBe(false);
		expect(notify.notify()).toBe(false);
	});
});

describe('stored choice', () => {
	it('reads only "on" and survives a blocked storage', () => {
		expect(readNotify({ getItem: () => 'on' })).toBe(true);
		expect(readNotify({ getItem: () => 'true' })).toBe(false);
		expect(readNotify(null)).toBe(false);
		expect(
			readNotify({
				getItem: () => {
					throw new Error('SecurityError');
				}
			})
		).toBe(false);
	});

	it('reports a refused write', () => {
		const refusing = {
			setItem: () => {
				throw new Error('QuotaExceededError');
			},
			removeItem: () => undefined
		};
		expect(writeNotify(refusing, true)).toBe(false);
		expect(writeNotify(null, true)).toBe(false);
	});
});
