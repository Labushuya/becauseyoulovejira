// Page "Einstellungen → Sicherung" (ADR-0046; ADR-0006): the state of the backups and the changes
// of the page (target folder, generations, switch of the access data, passphrase, "Jetzt
// sichern", "Prüfen", "Wiederherstellen"). Loaded when the page opens and gone with it. A refused
// input stays at its field (ADR-0009), a refusal of the route next to the actions, results go out
// as flags. A passphrase lives only in the call that sends it, or for a restore between its check
// and its confirmation in a private field of this store. A restore stops and starts the app: the
// store follows its state file through the restart (short polling of the server, CLAUDE.md §7).

import type PocketBase from 'pocketbase';
import {
	fetchBackupOverview,
	fetchRestoreState,
	runBackupNow,
	saveBackupPassphrase,
	saveBackupSettings,
	startRestore,
	verifyBackup,
	type BackupAnswer,
	type RestoreRequest
} from '$lib/data/backup';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	exportReasonText,
	isRestoreRunning,
	PASSPHRASE_PROBLEMS,
	RESTORE_CONFIRM_WORD,
	restoreDoneText,
	restoreReasonText,
	verifyCountsText,
	verifyReasonText,
	type BackupOverview,
	type BackupSettings,
	type BackupSource,
	type CredentialMode,
	type KeepName,
	type PassphraseProblem,
	type RestoreRunningPhase,
	type RestoreState,
	type RunResult,
	type SafetyCopy,
	type VerifyResult
} from '$lib/domain/backup';
import { DENIAL_TEXTS, type SystemDenial, type SystemNotice } from '$lib/domain/system';
import { RESTART_NEEDED, restartNeeded } from '$lib/guidance/texts';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import { REAL_CLOCK, type SystemClock } from './system.svelte';
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
	verify(
		backup: { source: BackupSource; name: string; passphrase?: string },
		options: RequestOptions
	): Promise<BackupAnswer<{ overview: BackupOverview; result: VerifyResult }>>;
	restore(
		request: RestoreRequest,
		options: RequestOptions
	): Promise<BackupAnswer<{ since: string }>>;
	restoreState(
		options: RequestOptions
	): Promise<BackupAnswer<{ restore: RestoreState | null; safety: SafetyCopy[] }>>;
}

export function backupData(pb: PocketBase): BackupData {
	return {
		overview: (options) => fetchBackupOverview(pb, options),
		run: (options) => runBackupNow(pb, options),
		saveSettings: (settings, options) => saveBackupSettings(pb, settings, options),
		savePassphrase: (passphrase, confirmation, options) =>
			saveBackupPassphrase(pb, passphrase, confirmation, options),
		verify: (backup, options) => verifyBackup(pb, backup, options),
		restore: (request, options) => startRestore(pb, request, options),
		restoreState: (options) => fetchRestoreState(pb, options)
	};
}

/** How often the page asks for the state of a running restore (30 reads a minute are allowed). */
export const RESTORE_POLL_MS = 3000;
/** A restore without a result after this long counts as lost. */
export const RESTORE_TIMEOUT_MS = 15 * 60 * 1000;

export type BackupLoadState = 'idle' | 'loading' | 'ready' | 'denied' | 'error';
/** The change that runs now. */
export type BackupBusy =
	'run' | 'target' | 'keep' | 'credentials' | 'passphrase' | 'verify' | 'restore';

/** One backup of the lists: where it lies and its name. */
export interface BackupRef {
	source: BackupSource;
	name: string;
}

/** A sealed backup the stored passphrase does not open: the page asks for its passphrase. */
export interface PassphraseRequest extends BackupRef {
	/** 'no-passphrase' (none stored) or 'passphrase' (the given or stored one does not fit). */
	reason: 'no-passphrase' | 'passphrase';
	/** Set when the check prepares a restore: when the backup was made (ISO 8601). */
	restoreAt?: string;
}

/** The backup a check runs for, and whether the check prepares a restore. */
export interface VerifyingRef extends BackupRef {
	restore: boolean;
}

/** A backup that was checked and waits for the confirmation of its restore. */
export interface RestoreDraft extends BackupRef {
	/** When the backup was made (ISO 8601). */
	at: string;
	result: VerifyResult;
}

/** The phase of a running restore; 'offline' while the app is away for its restart. */
export type RestoreProgress = RestoreRunningPhase | 'offline';

export class BackupStore {
	readonly #data: BackupData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #clock: SystemClock;
	readonly #controller = new AbortController();

	#state = $state<BackupLoadState>('idle');
	#overview = $state<BackupOverview | null>(null);
	#message = $state<SystemNotice | null>(null);
	#busy = $state<BackupBusy | null>(null);
	#actionMessage = $state<{ tone: 'warning' | 'error'; message: SystemNotice } | null>(null);
	#targetProblem = $state<string | null>(null);
	#keepProblem = $state(false);
	#passphraseProblem = $state<PassphraseProblem | null>(null);
	#verifying = $state<VerifyingRef | null>(null);
	#passphraseRequest = $state<PassphraseRequest | null>(null);
	#restoreDraft = $state<RestoreDraft | null>(null);
	// The passphrase of the draft when the stored one did not open it; gone with the draft.
	#restorePassphrase: string | undefined = undefined;
	#restoreProblem = $state<'confirm' | 'credentials' | null>(null);
	#restoreProgress = $state<RestoreProgress | null>(null);

	constructor(
		data: BackupData,
		session: SessionGuard,
		flags: FlagSink = SILENT_FLAGS,
		clock: SystemClock = REAL_CLOCK
	) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
		this.#clock = clock;
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

	/** The backup checked right now ("Prüfen", or the check before a restore), or null. */
	get verifying(): VerifyingRef | null {
		return this.#verifying;
	}

	/** The sealed backup whose passphrase the page asks for (next to its row), or null. */
	get passphraseRequest(): PassphraseRequest | null {
		return this.#passphraseRequest;
	}

	/** The checked backup whose restore the page asks to confirm (below its row), or null. */
	get restoreDraft(): RestoreDraft | null {
		return this.#restoreDraft;
	}

	/** A refused confirmation word ('confirm') or choice ('credentials'), shown at its field. */
	get restoreProblem(): 'confirm' | 'credentials' | null {
		return this.#restoreProblem;
	}

	/** The phase of a running restore, or null. */
	get restoreProgress(): RestoreProgress | null {
		return this.#restoreProgress;
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
		// A restore that runs (the page opened again during it): follow it to its result.
		const restore = answer.value.restore;
		if (this.#busy === null && restore !== null && restore.running) void this.#follow(restore.at);
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

	/**
	 * "Prüfen" / "Jetzt prüfen": checks one backup (ADR-0046 §6, takes a while). `passphrase` only
	 * for a sealed backup the stored passphrase does not open; it is sent once and not kept. When
	 * the passphrase is missing or does not fit, the page asks for it next to the backup instead of
	 * a flag.
	 */
	async verify(backup: BackupRef, passphrase?: string): Promise<void> {
		await this.#check({ source: backup.source, name: backup.name }, passphrase, null);
	}

	/**
	 * "Wiederherstellen …": checks the backup first, like "Prüfen"; when it is in order, the page asks
	 * for the confirmation right below it (restoreDraft). `at` is when the backup was made.
	 */
	async prepareRestore(backup: BackupRef & { at: string }, passphrase?: string): Promise<void> {
		await this.#check({ source: backup.source, name: backup.name }, passphrase, backup.at);
	}

	/** The passphrase typed below a sealed backup: checks again, for "Prüfen" or a restore. */
	async answerPassphrase(passphrase: string): Promise<void> {
		const request = this.#passphraseRequest;
		if (request === null) return;
		await this.#check(
			{ source: request.source, name: request.name },
			passphrase,
			request.restoreAt ?? null
		);
	}

	/** Closes the question for a passphrase without checking. */
	cancelPassphraseRequest(): void {
		this.#passphraseRequest = null;
	}

	/** The check of "Prüfen" (restoreAt null) or of a restore that follows it. */
	async #check(backup: BackupRef, passphrase: string | undefined, restoreAt: string | null) {
		if (this.#busy !== null) return;
		this.#verifying = { ...backup, restore: restoreAt !== null };
		let answer: { overview: BackupOverview; result: VerifyResult } | null;
		try {
			answer = await this.#change(
				'verify',
				(options) =>
					this.#data.verify(passphrase === undefined ? backup : { ...backup, passphrase }, options),
				() =>
					(this.#actionMessage = {
						tone: 'error',
						message: { title: 'Nicht geprüft', text: verifyReasonText('name') }
					})
			);
		} finally {
			this.#verifying = null;
		}
		if (answer === null) return;
		this.#accept(answer.overview);
		const { result } = answer;
		if (
			backup.source === 'target' &&
			(result.reason === 'passphrase' || result.reason === 'no-passphrase')
		) {
			this.#passphraseRequest = {
				...backup,
				reason: result.reason,
				...(restoreAt === null ? {} : { restoreAt })
			};
			return;
		}
		this.#passphraseRequest = null;
		if (restoreAt !== null) {
			if (result.ok) {
				this.#restoreDraft = { ...backup, at: restoreAt, result };
				this.#restorePassphrase = passphrase;
				this.#restoreProblem = null;
				return;
			}
			this.#flags.show({
				tone: 'error',
				title: 'Diese Sicherung lässt sich nicht wiederherstellen.',
				description: verifyReasonText(result.reason)
			});
			return;
		}
		const counts = verifyCountsText(result);
		if (result.ok) {
			this.#flags.show({
				tone: 'success',
				title: 'Sicherung geprüft: in Ordnung.',
				...(counts === '' ? {} : { description: `${counts}.` })
			});
			return;
		}
		this.#flags.show({
			tone: 'error',
			title: 'Die Prüfung der Sicherung ist gescheitert.',
			description: verifyReasonText(result.reason)
		});
	}

	/** Closes the confirmation of a restore without restoring. */
	cancelRestore(): void {
		this.#restoreDraft = null;
		this.#restorePassphrase = undefined;
		this.#restoreProblem = null;
	}

	/**
	 * "Wiederherstellen" in the confirmation: starts the restore (detached, ADR-0046 §7) with the
	 * choice for the access data and the word, then follows it through the restart of the app.
	 */
	async restore(mode: CredentialMode, confirm: string): Promise<void> {
		const draft = this.#restoreDraft;
		if (draft === null || this.#busy !== null) return;
		if (confirm.trim() !== RESTORE_CONFIRM_WORD) {
			this.#restoreProblem = 'confirm';
			return;
		}
		this.#restoreProblem = null;
		const passphrase = this.#restorePassphrase;
		const started = await this.#change(
			'restore',
			(options) =>
				this.#data.restore(
					{
						source: draft.source,
						name: draft.name,
						credentials: mode,
						confirm: RESTORE_CONFIRM_WORD,
						...(passphrase === undefined ? {} : { passphrase })
					},
					options
				),
			(problem) => {
				if (problem === 'confirm' || problem === 'credentials') {
					this.#restoreProblem = problem;
					return;
				}
				this.#actionMessage = {
					tone: 'error',
					message: {
						title: 'Wiederherstellung nicht möglich',
						text: restoreReasonText({ phase: 'failed', reason: problem })
					}
				};
			}
		);
		if (started === null) return;
		this.cancelRestore();
		await this.#follow(started.since);
	}

	/**
	 * Follows a running restore from the time `since` of a state of it to its result: asks its state
	 * every RESTORE_POLL_MS, also while the app is away for its restart.
	 */
	async #follow(since: string): Promise<void> {
		this.#busy = 'restore';
		this.#restoreProgress = 'started';
		const begun = this.#clock.now();
		try {
			for (;;) {
				if (this.#signal.aborted) return;
				let state: RestoreState | null = null;
				try {
					const answer = await this.#data.restoreState({ signal: this.#signal });
					if (
						answer.kind === 'ok' &&
						answer.value.restore !== null &&
						answer.value.restore.at >= since
					) {
						state = answer.value.restore;
					}
				} catch (error) {
					const failure = toDataError(error, this.#signal);
					if (failure.kind === 'aborted') return;
					if (failure.kind === 'session') {
						this.#session.logout();
						return;
					}
					this.#restoreProgress = 'offline';
				}
				if (state !== null) {
					if (!state.running) {
						await this.#finish(state);
						return;
					}
					if (isRestoreRunning(state.phase)) this.#restoreProgress = state.phase;
				}
				if (this.#clock.now() - begun >= RESTORE_TIMEOUT_MS) {
					this.#actionMessage = {
						tone: 'error',
						message: {
							title: 'Kein Ergebnis der Wiederherstellung',
							text: 'Nach 15 Minuten kam kein Ergebnis. status.bat zeigt, ob die App läuft; logs\\byl-control.log nennt den Ablauf.'
						}
					};
					return;
				}
				await this.#clock.wait(RESTORE_POLL_MS, this.#signal);
			}
		} finally {
			this.#busy = null;
			this.#restoreProgress = null;
		}
	}

	async #finish(state: RestoreState): Promise<void> {
		this.#busy = null;
		this.#restoreProgress = null;
		await this.load();
		if (state.phase === 'done') {
			this.#flags.show({
				tone: 'success',
				title: 'Wiederhergestellt.',
				description: restoreDoneText(state)
			});
			return;
		}
		this.#actionMessage = {
			tone: 'error',
			message: {
				title:
					state.phase === 'rolled-back'
						? 'Wiederherstellung zurückgenommen'
						: 'Wiederherstellung nicht möglich',
				text: restoreReasonText(state)
			}
		};
	}

	/** Ends every request of the page (the page goes). */
	dispose(): void {
		this.#controller.abort();
	}
}
