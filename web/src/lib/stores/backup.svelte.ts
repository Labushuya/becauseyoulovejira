// Page "Einstellungen → Sicherung" (ADR-0046; ADR-0006): the state of the backups and the changes
// of the page (target folder, generations, switch of the access data, passphrase, "Jetzt
// sichern"). Loaded when the page opens and gone with it. A refused input stays at its field
// (ADR-0009), a refusal of the route next to the actions, results go out as flags. The passphrase
// lives only in the call that sends it.

import type PocketBase from 'pocketbase';
import {
	fetchBackupOverview,
	runBackupNow,
	saveBackupPassphrase,
	saveBackupSettings,
	type BackupAnswer
} from '$lib/data/backup';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	exportReasonText,
	PASSPHRASE_PROBLEMS,
	type BackupOverview,
	type BackupSettings,
	type KeepName,
	type PassphraseProblem,
	type RunResult
} from '$lib/domain/backup';
import { DENIAL_TEXTS, type SystemDenial, type SystemNotice } from '$lib/domain/system';
import { RESTART_NEEDED, restartNeeded } from '$lib/guidance/texts';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';

/** What the page says for a refusal; "missing" is the hint to restart after an update. */
export function backupDenialNotice(reason: SystemDenial): SystemNotice {
	if (reason === 'missing') {
		return { title: RESTART_NEEDED.title, text: restartNeeded('Die Seite Sicherung ist') };
	}
	if (reason === 'platform') {
		return {
			title: DENIAL_TEXTS.platform.title,
			text: 'Die Sicherung in ein Zielverzeichnis und ihre Einstellungen brauchen die Skripte im Ordner app unter Windows. Dein Server läuft unter Linux oder in einem Container; der Ausbau für diese Systeme ist zurückgestellt.'
		};
	}
	return DENIAL_TEXTS[reason];
}

type SettingsInput = Omit<BackupSettings, 'target'> & { target: string };

export interface BackupData {
	overview(options: RequestOptions): Promise<BackupAnswer<BackupOverview>>;
	run(
		options: RequestOptions
	): Promise<BackupAnswer<{ overview: BackupOverview; result: RunResult }>>;
	saveSettings(
		settings: SettingsInput,
		options: RequestOptions
	): Promise<BackupAnswer<BackupOverview>>;
	savePassphrase(
		passphrase: string,
		confirmation: string,
		options: RequestOptions
	): Promise<BackupAnswer<BackupOverview>>;
}

export function backupData(pb: PocketBase): BackupData {
	return {
		overview: (options) => fetchBackupOverview(pb, options),
		run: (options) => runBackupNow(pb, options),
		saveSettings: (settings, options) => saveBackupSettings(pb, settings, options),
		savePassphrase: (passphrase, confirmation, options) =>
			saveBackupPassphrase(pb, passphrase, confirmation, options)
	};
}

export type BackupLoadState = 'idle' | 'loading' | 'ready' | 'denied' | 'error';
/** The change that runs now. */
export type BackupBusy = 'run' | 'target' | 'keep' | 'credentials' | 'passphrase';

export class BackupStore {
	readonly #data: BackupData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #controller = new AbortController();

	#state = $state<BackupLoadState>('idle');
	#overview = $state<BackupOverview | null>(null);
	#message = $state<SystemNotice | null>(null);
	#busy = $state<BackupBusy | null>(null);
	#actionMessage = $state<{ tone: 'warning' | 'error'; message: SystemNotice } | null>(null);
	#targetProblem = $state<string | null>(null);
	#keepProblem = $state(false);
	#passphraseProblem = $state<PassphraseProblem | null>(null);

	constructor(data: BackupData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	get state(): BackupLoadState {
		return this.#state;
	}

	get overview(): BackupOverview | null {
		return this.#overview;
	}

	/** What the page says instead of its content: a refusal or a failed load. */
	get message(): SystemNotice | null {
		return this.#message;
	}

	get busy(): BackupBusy | null {
		return this.#busy;
	}

	/** A refused or failed change, shown next to the actions. */
	get actionMessage(): { tone: 'warning' | 'error'; message: SystemNotice } | null {
		return this.#actionMessage;
	}

	/** Why the control script refused the target folder (TARGET_PROBLEM_TEXTS), or null. */
	get targetProblem(): string | null {
		return this.#targetProblem;
	}

	get keepProblem(): boolean {
		return this.#keepProblem;
	}

	get passphraseProblem(): PassphraseProblem | null {
		return this.#passphraseProblem;
	}

	get #signal(): AbortSignal {
		return this.#controller.signal;
	}

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

	/** Loads the state of the backups. */
	async load(): Promise<void> {
		if (this.#state !== 'ready') this.#state = 'loading';
		const result = await this.#guarded(() => this.#data.overview({ signal: this.#signal }));
		if (result === null) return;
		if ('failure' in result) {
			this.#state = 'error';
			this.#message = result.failure;
			return;
		}
		const answer = result.value;
		if (answer.kind !== 'ok') {
			this.#state = 'denied';
			this.#message = backupDenialNotice(answer.kind === 'denied' ? answer.reason : 'script');
			return;
		}
		this.#overview = answer.value;
		this.#message = null;
		this.#state = 'ready';
	}

	#refuse(reason: SystemDenial): void {
		this.#actionMessage = {
			tone: reason === 'script' ? 'error' : 'warning',
			message: backupDenialNotice(reason)
		};
	}

	/**
	 * Runs a change: one at a time; the answer of an accepted change, or null after a refusal (shown)
	 * or a refused input (handed to `invalid`).
	 */
	async #change<T>(
		busy: BackupBusy,
		call: (options: RequestOptions) => Promise<BackupAnswer<T>>,
		invalid: (problem: string) => void
	): Promise<T | null> {
		if (this.#busy !== null) return null;
		this.#busy = busy;
		this.#actionMessage = null;
		try {
			const result = await this.#guarded(() => call({ signal: this.#signal }));
			if (result === null) return null;
			if ('failure' in result) {
				this.#actionMessage = {
					tone: 'error',
					message: { title: 'Nicht gespeichert', text: result.failure.text }
				};
				return null;
			}
			const answer = result.value;
			if (answer.kind === 'denied') {
				this.#refuse(answer.reason);
				return null;
			}
			if (answer.kind === 'invalid') {
				invalid(answer.problem);
				return null;
			}
			return answer.value;
		} finally {
			this.#busy = null;
		}
	}

	#settings(overrides: Partial<SettingsInput>): SettingsInput {
		const current = this.#overview?.settings;
		return {
			target: current?.target ?? '',
			daily: current?.daily ?? 7,
			weekly: current?.weekly ?? 4,
			monthly: current?.monthly ?? 6,
			credentials: current?.credentials ?? true,
			...overrides
		};
	}

	#accept(overview: BackupOverview): void {
		this.#overview = overview;
		this.#state = 'ready';
		this.#message = null;
	}

	/** "Zielverzeichnis speichern": '' removes it. True when it was saved. */
	async saveTarget(target: string): Promise<boolean> {
		this.#targetProblem = null;
		const overview = await this.#change(
			'target',
			(options) => this.#data.saveSettings(this.#settings({ target: target.trim() }), options),
			(problem) => (this.#targetProblem = problem === '' ? 'format' : problem)
		);
		if (overview === null) return false;
		this.#accept(overview);
		this.#flags.show({
			tone: 'success',
			title:
				overview.settings.target === null
					? 'Kein Zielverzeichnis mehr.'
					: 'Zielverzeichnis gespeichert.'
		});
		return true;
	}

	/** "Aufbewahrung speichern". */
	async saveKeep(values: Record<KeepName, number>): Promise<boolean> {
		this.#keepProblem = false;
		const overview = await this.#change(
			'keep',
			(options) => this.#data.saveSettings(this.#settings(values), options),
			() => (this.#keepProblem = true)
		);
		if (overview === null) return false;
		this.#accept(overview);
		this.#flags.show({ tone: 'success', title: 'Aufbewahrung gespeichert.' });
		return true;
	}

	/** Switch "Zugangsdaten mitsichern" (takes effect at once). */
	async setCredentials(on: boolean): Promise<void> {
		const overview = await this.#change(
			'credentials',
			(options) => this.#data.saveSettings(this.#settings({ credentials: on }), options),
			() =>
				(this.#actionMessage = {
					tone: 'error',
					message: { title: 'Nicht gespeichert', text: 'Die Einstellung wurde abgelehnt.' }
				})
		);
		if (overview === null) return;
		this.#accept(overview);
		this.#flags.show({
			tone: 'success',
			title: overview.settings.credentials
				? 'Zugangsdaten werden mitgesichert.'
				: 'Zugangsdaten werden nicht mehr mitgesichert.'
		});
	}

	/** "Passphrase speichern"; true when it was kept (the form empties its fields then). */
	async savePassphrase(passphrase: string, confirmation: string): Promise<boolean> {
		this.#passphraseProblem = null;
		const changed = this.#overview?.passphrase === 'set';
		const overview = await this.#change(
			'passphrase',
			(options) => this.#data.savePassphrase(passphrase, confirmation, options),
			(problem) => {
				this.#passphraseProblem = (PASSPHRASE_PROBLEMS as readonly string[]).includes(problem)
					? (problem as PassphraseProblem)
					: 'too-short';
			}
		);
		if (overview === null) return false;
		this.#accept(overview);
		this.#flags.show({
			tone: 'success',
			title: changed ? 'Passphrase geändert.' : 'Passphrase gespeichert.',
			...(changed
				? { description: 'Neue Sicherungen nutzen sie; ältere bleiben mit der bisherigen lesbar.' }
				: {})
		});
		return true;
	}

	/** Marks a problem of the passphrase found before sending (the form checks first). */
	markPassphrase(problem: PassphraseProblem | null): void {
		this.#passphraseProblem = problem;
	}

	/** "Jetzt sichern". */
	async runNow(): Promise<void> {
		const answer = await this.#change(
			'run',
			(options) => this.#data.run(options),
			() => undefined
		);
		if (answer === null) return;
		this.#accept(answer.overview);
		const { result } = answer;
		if (result.backup === '') {
			this.#flags.show({
				tone: 'error',
				title: 'Die Sicherung ist gescheitert.',
				description: result.backupError
			});
			return;
		}
		if (result.export === null || result.export.ok) {
			this.#flags.show({
				tone: 'success',
				title: 'Gesichert.',
				...(result.export?.ok ? { description: 'Auch verschlüsselt im Zielverzeichnis.' } : {})
			});
			return;
		}
		this.#flags.show({
			tone: 'info',
			title: 'Gesichert, aber nicht im Zielverzeichnis.',
			description: exportReasonText(result.export.reason)
		});
	}

	/** Ends every request of the page (the page goes). */
	dispose(): void {
		this.#controller.abort();
	}
}
