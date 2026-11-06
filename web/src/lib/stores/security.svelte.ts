// Page "Einstellungen → Sicherheit" (ADR-0055 §8; ADR-0006): the overview, loaded when the page
// opens, and the three settings, one change at a time: level of the protection and validity of a
// sign-in (both at once), further hosts (after a restart). The store lives with the page and ends
// its requests when the page goes. Saved changes go out as flags, refusals stay at their part.
// Since FP-3b a failure (a failed request, a refusal "script", an answer of another form) carries
// its entry for "Details" (ADR-0071); a refusal of the route and a refused input stay without.

import type PocketBase from 'pocketbase';
import { detailsOf, problemDetails, scriptProblem, toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import type { ProblemEntry } from '$lib/domain/problems';
import {
	fetchSecurity,
	saveSecurityHosts,
	saveSecuritySettings,
	type SecurityAnswer
} from '$lib/data/security';
import {
	LEVEL_LABELS,
	denialText,
	invalidText,
	sameHosts,
	sessionLabel,
	type LevelChoice,
	type SecurityOverview
} from '$lib/domain/security';
import type { SystemDenial } from '$lib/domain/system';
import { RESTART_NEEDED, restartNeeded } from '$lib/guidance/texts';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';

export interface SecurityData {
	overview(options: RequestOptions): Promise<SecurityAnswer<SecurityOverview>>;
	settings(
		settings: { level?: LevelChoice; days?: number },
		options: RequestOptions
	): Promise<SecurityAnswer<SecurityOverview>>;
	hosts(
		hosts: readonly string[],
		options: RequestOptions
	): Promise<SecurityAnswer<SecurityOverview>>;
}

export function securityData(pb: PocketBase): SecurityData {
	return {
		overview: (options) => fetchSecurity(pb, options),
		settings: (settings, options) => saveSecuritySettings(pb, settings, options),
		hosts: (hosts, options) => saveSecurityHosts(pb, hosts, options)
	};
}

export type SecurityState = 'idle' | 'loading' | 'ready' | 'denied' | 'error';
export type SecurityPart = 'level' | 'session' | 'hosts';

export interface SecurityMessage {
	title: string;
	text: string;
	/** The failed action behind the message (FP-3b), for "Details"; absent for a refusal. */
	problem?: ProblemEntry | null;
}

/** What the page says for a refusal; "missing" is the hint to restart after an update. */
export function securityDenial(reason: SystemDenial): SecurityMessage {
	if (reason === 'missing') {
		return { title: RESTART_NEEDED.title, text: restartNeeded('Die Seite Sicherheit ist') };
	}
	return denialText(reason);
}

/** A refusal of the route with the entry of "script" (FP-3b); every other one stays without. */
export function securityRefusal(answer: { kind: 'denied'; reason: SystemDenial }): SecurityMessage {
	return { ...securityDenial(answer.reason), ...detailsOf(scriptProblem(answer)) };
}

/** Whether a message is shown as an error with "Details" (a failure, not a refusal). */
export function isSecurityFailure(message: SecurityMessage | null): boolean {
	return (message?.problem ?? null) !== null;
}

export class SecurityStore {
	readonly #data: SecurityData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #controller = new AbortController();

	#state = $state<SecurityState>('idle');
	#overview = $state.raw<SecurityOverview | null>(null);
	#message = $state<SecurityMessage | null>(null);
	#busy = $state<SecurityPart | null>(null);
	#partMessage = $state<{ part: SecurityPart; message: SecurityMessage } | null>(null);
	#invalidHosts = $state.raw<readonly string[]>([]);

	/** The further hosts of byl-config.json differ from those the server started with. */
	#restartNeeded = $derived(
		this.#overview !== null &&
			!sameHosts(this.#overview.hosts.configured, this.#overview.hosts.active)
	);

	constructor(data: SecurityData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	get state(): SecurityState {
		return this.#state;
	}

	get overview(): SecurityOverview | null {
		return this.#overview;
	}

	/** Why the page shows nothing (refusal or failure). */
	get message(): SecurityMessage | null {
		return this.#message;
	}

	/** The part that is being saved, or null. */
	get busy(): SecurityPart | null {
		return this.#busy;
	}

	/** Why the last change of a part did not go through (shown at that part). */
	get partMessage(): { part: SecurityPart; message: SecurityMessage } | null {
		return this.#partMessage;
	}

	/** The entries the server refused at the last save of the hosts. */
	get invalidHosts(): readonly string[] {
		return this.#invalidHosts;
	}

	get restartNeeded(): boolean {
		return this.#restartNeeded;
	}

	/** Ends the requests of the page. */
	dispose(): void {
		this.#controller.abort();
	}

	/** Loads (again); the last overview stays while it runs. */
	async load(): Promise<void> {
		if (!this.#session.ensureValid()) return;
		if (this.#overview === null) this.#state = 'loading';
		try {
			const answer = await this.#data.overview({ signal: this.#controller.signal });
			if (answer.kind === 'ok') {
				this.#overview = answer.value;
				this.#message = null;
				this.#state = 'ready';
			} else if (this.#overview === null) {
				this.#message = answer.kind === 'denied' ? securityRefusal(answer) : denialText('script');
				this.#state = 'denied';
			}
		} catch (error) {
			const failure = toDataError(error, this.#controller.signal);
			if (failure.kind === 'aborted') return;
			if (failure.kind === 'session') {
				this.#session.logout();
				return;
			}
			if (this.#overview === null) {
				this.#message = {
					title: denialText('script').title,
					text: failure.message,
					...problemDetails(failure)
				};
				this.#state = 'error';
			}
		}
	}

	/** Sets the level of the protection against guessing (applies at once). */
	setLevel(level: LevelChoice): Promise<boolean> {
		return this.#save('level', () => this.#data.settings({ level }, this.#options()), {
			title: `Schutz vor Rateversuchen: ${LEVEL_LABELS[level].label}`
		});
	}

	/** Sets how long a sign-in stays valid (for new sign-ins and renewals). */
	setSession(days: number): Promise<boolean> {
		const standard = this.#overview?.session.standard ?? 5;
		return this.#save('session', () => this.#data.settings({ days }, this.#options()), {
			title: `Anmeldung gilt ${sessionLabel(days, standard).replace(' (Standard)', '')}`
		});
	}

	/** Saves the further hosts into byl-config.json; they apply after a restart. */
	saveHosts(hosts: readonly string[]): Promise<boolean> {
		return this.#save('hosts', () => this.#data.hosts(hosts, this.#options()), {
			title: 'Zusätzliche Adressen gespeichert',
			description: 'Sie gelten nach einem Neustart der App.'
		});
	}

	#options(): RequestOptions {
		return { signal: this.#controller.signal };
	}

	async #save(
		part: SecurityPart,
		call: () => Promise<SecurityAnswer<SecurityOverview>>,
		done: { title: string; description?: string }
	): Promise<boolean> {
		if (this.#busy !== null || !this.#session.ensureValid()) return false;
		this.#busy = part;
		this.#partMessage = null;
		this.#invalidHosts = [];
		try {
			const answer = await call();
			if (answer.kind === 'denied') {
				this.#partMessage = { part, message: securityRefusal(answer) };
				return false;
			}
			if (answer.kind === 'invalid') {
				this.#invalidHosts = answer.invalid;
				this.#partMessage = {
					part,
					message: {
						title: 'Nicht gespeichert',
						text: invalidText(answer.problem)
					}
				};
				return false;
			}
			this.#overview = answer.value;
			this.#flags.show({ tone: 'success', title: done.title, description: done.description });
			return true;
		} catch (error) {
			const failure = toDataError(error, this.#controller.signal);
			if (failure.kind === 'session') this.#session.logout();
			if (failure.kind !== 'aborted' && failure.kind !== 'session') {
				this.#partMessage = {
					part,
					message: { title: 'Nicht gespeichert', text: failure.message, ...problemDetails(failure) }
				};
			}
			return false;
		} finally {
			this.#busy = null;
		}
	}
}
