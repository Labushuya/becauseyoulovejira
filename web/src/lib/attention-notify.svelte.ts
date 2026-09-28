// Windows notification for "opened again" (ADR-0035 section 5; plan start-fenster, SF-6): an
// opt-in, off by default. The switch under "Einstellungen → Darstellung" asks the browser for the
// permission only when it is switched on (a click), never on its own. With the choice on and the
// permission granted, a hidden tab shows "becauseyoulovejira ist schon offen" when start.bat or the
// landing page opens the app again; a click on it is a user activation, so window.focus() brings
// the tab to the front. The choice lives in localStorage under NOTIFY_STORAGE_KEY on this device;
// only "on" is stored, off removes the key. Other tabs follow through the storage event.

import { APP_OPENED_NOTIFICATION } from './guidance/texts';

export const NOTIFY_STORAGE_KEY = 'byl-attention-notify';
export const NOTIFY_ON = 'on';
/** One notification at a time: a new one replaces the last. */
export const NOTIFY_TAG = 'byl-attention';

export type NotifyPermission = NotificationPermission | 'unsupported';

/** What the store needs of the Notification API (a stub in the tests). */
export interface NotificationApi {
	readonly permission: NotificationPermission;
	requestPermission(): Promise<NotificationPermission>;
	new (title: string, options?: NotificationOptions): Notification;
}

type NotifyWindow = Pick<
	Window,
	'localStorage' | 'addEventListener' | 'removeEventListener' | 'focus'
> & {
	Notification?: NotificationApi;
	document: Pick<Document, 'visibilityState'>;
};

/** Only "on" counts; anything else (missing, unknown, a blocked storage) means off. */
export function readNotify(storage: Pick<Storage, 'getItem'> | null): boolean {
	try {
		return storage?.getItem(NOTIFY_STORAGE_KEY) === NOTIFY_ON;
	} catch {
		return false;
	}
}

/** Stores the choice; false if the storage refused it (the choice then lasts for this page). */
export function writeNotify(
	storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
	on: boolean
): boolean {
	if (storage === null) return false;
	try {
		if (on) storage.setItem(NOTIFY_STORAGE_KEY, NOTIFY_ON);
		else storage.removeItem(NOTIFY_STORAGE_KEY);
		return true;
	} catch {
		return false;
	}
}

function storageOf(win: NotifyWindow): Storage | null {
	try {
		return win.localStorage;
	} catch {
		return null;
	}
}

export class NotifyStore {
	/** The stored choice of this device. */
	enabled = $state(false);
	/** The permission of the browser as last seen; "unsupported" without the API. */
	permission = $state<NotifyPermission>('default');
	/** The browser is asking for the permission. */
	busy = $state(false);

	readonly #win: NotifyWindow;

	constructor(win: NotifyWindow) {
		this.#win = win;
		this.enabled = readNotify(storageOf(win));
		this.permission = this.#currentPermission();
	}

	get supported(): boolean {
		return this.#api() !== null;
	}

	/** On and allowed: a notification can appear. */
	get active(): boolean {
		return this.enabled && this.#currentPermission() === 'granted';
	}

	#api(): NotificationApi | null {
		const api = this.#win.Notification;
		return typeof api === 'function' ? api : null;
	}

	#currentPermission(): NotifyPermission {
		return this.#api()?.permission ?? 'unsupported';
	}

	/** Switches on: asks for the permission (only here, on a click); stays off without it. */
	async enable(): Promise<boolean> {
		const api = this.#api();
		if (api === null) {
			this.permission = 'unsupported';
			return false;
		}
		this.busy = true;
		let permission: NotificationPermission;
		try {
			permission = api.permission === 'granted' ? 'granted' : await api.requestPermission();
		} catch {
			permission = 'default';
		} finally {
			this.busy = false;
		}
		this.permission = permission;
		this.enabled = permission === 'granted';
		writeNotify(storageOf(this.#win), this.enabled);
		return this.enabled;
	}

	disable(): void {
		this.enabled = false;
		this.permission = this.#currentPermission();
		writeNotify(storageOf(this.#win), false);
	}

	/**
	 * Shows the notification if it is on and allowed and the tab is hidden (a visible tab has the
	 * flag); a click brings the tab to the front. True if one was shown.
	 */
	notify(): boolean {
		const api = this.#api();
		const hidden = this.#win.document.visibilityState === 'hidden';
		if (api === null || !this.active || !hidden) return false;
		try {
			const notification = new api(APP_OPENED_NOTIFICATION.title, {
				body: APP_OPENED_NOTIFICATION.body,
				tag: NOTIFY_TAG,
				icon: '/icons/icon-192.png'
			});
			notification.onclick = () => {
				this.#win.focus();
				notification.close();
			};
			return true;
		} catch {
			return false;
		}
	}

	/** Follows the choice of other tabs; returns the unsubscribe. */
	connect(): () => void {
		const onstorage = (event: StorageEvent) => {
			if (event.key !== null && event.key !== NOTIFY_STORAGE_KEY) return;
			this.enabled = event.key !== null && event.newValue === NOTIFY_ON;
			this.permission = this.#currentPermission();
		};
		this.#win.addEventListener('storage', onstorage);
		return () => this.#win.removeEventListener('storage', onstorage);
	}
}

let shared: NotifyStore | undefined;

/** The store of the app, created on first use. */
export function getNotifyStore(): NotifyStore {
	shared ??= new NotifyStore(window);
	return shared;
}
