// Page "Einstellungen → System" (ADR-0043; ADR-0006): status of the app, the checks of "Umgebung
// prüfen", the logs and the actions. Loaded when the page opens and gone with it. The restart ends
// the server this page talks to, so after starting it the store asks /api/health until the server
// was gone and answers again (or answers with a new start time), then loads the status again; this
// short polling concerns the server, not data (CLAUDE.md §7), and ends with the restart.

import type PocketBase from 'pocketbase';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	checkServerHealth,
	fetchSystemDoctor,
	fetchSystemLogs,
	fetchSystemStatus,
	runSystemAction,
	type SystemAnswer
} from '$lib/data/system';
import {
	DENIAL_TEXTS,
	RESTART_TEXTS,
	mailText,
	stateText,
	type DoctorResult,
	type SystemAction,
	type SystemDenial,
	type SystemLogs,
	type SystemNotice,
	type SystemOverview
} from '$lib/domain/system';
import { RESTART_NEEDED, restartNeeded as restartNeededText } from '$lib/guidance/texts';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';

export interface SystemData {
	status(options: RequestOptions): Promise<SystemAnswer<SystemOverview>>;
	doctor(options: RequestOptions): Promise<SystemAnswer<DoctorResult>>;
	logs(options: RequestOptions): Promise<SystemAnswer<SystemLogs>>;
	act(
		action: SystemAction,
		options: RequestOptions
	): Promise<SystemAnswer<SystemOverview | 'restarting'>>;
	health(options: RequestOptions): Promise<boolean>;
}

export function systemData(pb: PocketBase): SystemData {
	return {
		status: (options) => fetchSystemStatus(pb, options),
		doctor: (options) => fetchSystemDoctor(pb, options),
		logs: (options) => fetchSystemLogs(pb, options),
		act: (action, options) => runSystemAction(pb, action, options),
		health: (options) => checkServerHealth(pb, options)
	};
}

/** Time for the restart; tests pass a fake one. */
export interface SystemClock {
	now(): number;
	wait(ms: number, signal: AbortSignal): Promise<void>;
}

export const REAL_CLOCK: SystemClock = {
	now: () => Date.now(),
	wait: (ms, signal) =>
		new Promise((resolve) => {
			const timer = setTimeout(resolve, ms);
			signal.addEventListener(
				'abort',
				() => {
					clearTimeout(timer);
					resolve();
				},
				{ once: true }
			);
		})
};

/** How often the restart asks /api/health. */
export const RESTART_POLL_MS = 1000;
/** Without a moment of absence, the status is compared after this long (a very fast restart). */
export const RESTART_COMPARE_AFTER_MS = 5000;
/** The restart counts as failed after this long. */
export const RESTART_TIMEOUT_MS = 90_000;

export type SystemLoadState = 'idle' | 'loading' | 'ready' | 'denied' | 'error';
export type RestartPhase = 'idle' | 'stopping' | 'starting' | 'failed' | 'not-started';

/** A part of the page that is loaded on request (checks, logs). */
export interface SystemPart<T> {
	state: SystemLoadState;
	value: T | null;
	message: SystemNotice | null;
}

/** What the page says for a refusal; "missing" is the hint to restart after an update. */
export function denialNotice(reason: SystemDenial): SystemNotice {
	if (reason === 'missing') {
		return { title: RESTART_NEEDED.title, text: restartNeededText('Die Seite System ist') };
	}
	return DENIAL_TEXTS[reason];
}

const idlePart = <T>(): SystemPart<T> => ({ state: 'idle', value: null, message: null });

export class SystemStore {
	readonly #data: SystemData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #clock: SystemClock;
	readonly #controller = new AbortController();

	#state = $state<SystemLoadState>('idle');
	#overview = $state<SystemOverview | null>(null);
	#message = $state<SystemNotice | null>(null);
	#busy = $state<SystemAction | null>(null);
	#actionMessage = $state<{ tone: 'warning' | 'error'; message: SystemNotice } | null>(null);
	#restart = $state<RestartPhase>('idle');
	#doctor = $state<SystemPart<DoctorResult>>(idlePart());
	#logs = $state<SystemPart<SystemLogs>>(idlePart());

	constructor(
		data: SystemData,
		session: SessionGuard,
		flags: FlagSink = SILENT_FLAGS,
		clock: SystemClock = REAL_CLOCK
	) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
		this.#clock = clock;
	}

	get state(): SystemLoadState {
		return this.#state;
	}

	get overview(): SystemOverview | null {
		return this.#overview;
	}

	/** What the page says instead of its content: a refusal or a failed load. */
	get message(): SystemNotice | null {
		return this.#message;
	}

	/** The action that runs now, or null. */
	get busy(): SystemAction | null {
		return this.#busy;
	}

	/** A refused or failed action, shown next to the actions. */
	get actionMessage(): { tone: 'warning' | 'error'; message: SystemNotice } | null {
		return this.#actionMessage;
	}

	get restartPhase(): RestartPhase {
		return this.#restart;
	}

	get doctor(): SystemPart<DoctorResult> {
		return this.#doctor;
	}

	get logs(): SystemPart<SystemLogs> {
		return this.#logs;
	}

	get #signal(): AbortSignal {
		return this.#controller.signal;
	}

	/**
	 * Runs `call` and turns a DataError into a message; ends the session on "session" and answers
	 * null when there is nothing to show (aborted, signed out).
	 */
	async #guarded<T>(
		call: () => Promise<T>
	): Promise<{ value: T } | { failure: SystemNotice } | null> {
		if (!this.#session.ensureValid()) return null;
		try {
			return { value: await call() };
		} catch (error) {
			const failure = toDataError(error, this.#signal);
			if (failure.kind === 'aborted') return null;
			if (failure.kind === 'session') {
				this.#session.logout();
				return null;
			}
			return { failure: { title: 'Nicht geladen', text: failure.message } };
		}
	}

	/** Loads the status of the app. */
	async load(): Promise<void> {
		if (this.#state !== 'ready') this.#state = 'loading';
		const result = await this.#guarded(() => this.#data.status({ signal: this.#signal }));
		if (result === null) return;
		if ('failure' in result) {
			this.#state = 'error';
			this.#message = result.failure;
			return;
		}
		const answer = result.value;
		if (answer.kind === 'denied') {
			this.#state = 'denied';
			this.#message = denialNotice(answer.reason);
			return;
		}
		this.#overview = answer.value;
		this.#message = null;
		this.#state = 'ready';
	}

	async #loadPart<T>(
		read: (options: RequestOptions) => Promise<SystemAnswer<T>>,
		set: (part: SystemPart<T>) => void,
		current: SystemPart<T>
	): Promise<void> {
		set({ ...current, state: 'loading', message: null });
		const result = await this.#guarded(() => read({ signal: this.#signal }));
		if (result === null) {
			set({ ...current, state: current.value === null ? 'idle' : 'ready' });
			return;
		}
		if ('failure' in result) {
			set({ state: 'error', value: current.value, message: result.failure });
			return;
		}
		const answer = result.value;
		if (answer.kind === 'denied') {
			set({ state: 'denied', value: current.value, message: denialNotice(answer.reason) });
			return;
		}
		set({ state: 'ready', value: answer.value, message: null });
	}

	/** "Umgebung prüfen". */
	runDoctor(): Promise<void> {
		return this.#loadPart(
			(options) => this.#data.doctor(options),
			(part) => (this.#doctor = part),
			this.#doctor
		);
	}

	/** "Logs ansehen" and "Aktualisieren". */
	loadLogs(): Promise<void> {
		return this.#loadPart(
			(options) => this.#data.logs(options),
			(part) => (this.#logs = part),
			this.#logs
		);
	}

	#refuse(reason: SystemDenial): void {
		this.#actionMessage = {
			tone: reason === 'script' ? 'error' : 'warning',
			message: denialNotice(reason)
		};
	}

	/** Runs an action that answers with the status (mail helper, autostart); the status or null. */
	async #act(action: Exclude<SystemAction, 'restart'>): Promise<SystemOverview | null> {
		if (this.#busy !== null) return null;
		this.#busy = action;
		this.#actionMessage = null;
		try {
			const result = await this.#guarded(() => this.#data.act(action, { signal: this.#signal }));
			if (result === null) return null;
			if ('failure' in result) {
				this.#actionMessage = { tone: 'error', message: result.failure };
				return null;
			}
			const answer = result.value;
			if (answer.kind === 'denied') {
				this.#refuse(answer.reason);
				return null;
			}
			if (answer.value === 'restarting') return null;
			this.#overview = answer.value;
			return answer.value;
		} finally {
			this.#busy = null;
		}
	}

	/** "Mail-Helfer neu starten". */
	async restartMail(): Promise<void> {
		const overview = await this.#act('mail-restart');
		if (overview === null) return;
		const { label, hint } = mailText(overview);
		this.#flags.show(
			overview.mail.running
				? { tone: 'success', title: 'Mail-Helfer neu gestartet.' }
				: { tone: 'info', title: `Mail-Helfer: ${label}.`, description: hint }
		);
	}

	/** Autostart on or off. */
	async setAutostart(on: boolean): Promise<void> {
		const overview = await this.#act(on ? 'autostart-on' : 'autostart-off');
		if (overview === null) return;
		this.#flags.show({
			tone: 'success',
			title:
				overview.status.autostart === 'on' ? 'Autostart eingeschaltet.' : 'Autostart ausgeschaltet.'
		});
	}

	/**
	 * "Jetzt neu starten": starts the detached restart, then waits for the server to go and come
	 * back and loads the status again.
	 */
	async restart(): Promise<void> {
		if (this.#busy !== null || this.#overview === null) return;
		const before = this.#overview.status;
		this.#busy = 'restart';
		this.#actionMessage = null;
		this.#restart = 'idle';
		try {
			const result = await this.#guarded(() => this.#data.act('restart', { signal: this.#signal }));
			if (result === null) return;
			if ('failure' in result) {
				this.#actionMessage = { tone: 'error', message: result.failure };
				return;
			}
			if (result.value.kind === 'denied') {
				this.#refuse(result.value.reason);
				return;
			}
			this.#restart = 'stopping';
			await this.#followRestart(before.pid, before.startedUtc);
		} finally {
			this.#busy = null;
		}
	}

	async #followRestart(pid: number | null, startedUtc: string | null): Promise<void> {
		const started = this.#clock.now();
		let gone = false;
		for (;;) {
			if (this.#signal.aborted) return;
			const up = await this.#data.health({ signal: this.#signal });
			if (this.#signal.aborted) return;
			const elapsed = this.#clock.now() - started;
			if (!up) {
				gone = true;
				this.#restart = 'starting';
			} else if (gone || elapsed >= RESTART_COMPARE_AFTER_MS) {
				const answer = await this.#data.status({ signal: this.#signal }).catch(() => null);
				if (this.#signal.aborted) return;
				const status = answer?.kind === 'ok' ? answer.value : null;
				const changed =
					status !== null && (status.status.pid !== pid || status.status.startedUtc !== startedUtc);
				if (gone || changed) {
					if (status !== null) {
						this.#overview = status;
						this.#state = 'ready';
						this.#message = null;
					} else if (answer?.kind === 'denied') {
						this.#state = 'denied';
						this.#message = denialNotice(answer.reason);
					}
					this.#restart = 'idle';
					this.#flags.show({
						tone: 'success',
						title: RESTART_TEXTS.done,
						...(status === null ? {} : { description: `${stateText(status.status)}.` })
					});
					return;
				}
			}
			if (elapsed >= RESTART_TIMEOUT_MS) {
				this.#restart = gone ? 'failed' : 'not-started';
				return;
			}
			await this.#clock.wait(RESTART_POLL_MS, this.#signal);
		}
	}

	/** Ends every request of the page (the page goes). */
	dispose(): void {
		this.#controller.abort();
	}
}
