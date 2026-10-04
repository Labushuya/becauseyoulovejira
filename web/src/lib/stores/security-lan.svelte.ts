// Access in the home network on the page "Einstellungen → Sicherheit" (plan heimnetz, ADR-0055
// addendum; ADR-0006): the setting, the addresses of the computer, the network and the firewall
// rule, loaded when the page opens and only for the own instance under Windows (the control script
// answers). One change at a time: the setting (after a restart) or the firewall rule (Windows asks
// for administrator rights on the machine of the app). Saved changes go out as flags; refusals and
// a change of the rule that did not happen stay at the part with what to do by hand.

import type PocketBase from 'pocketbase';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	changeSecurityFirewall,
	fetchSecurityLan,
	saveSecurityLan,
	type SecurityAnswer
} from '$lib/data/security';
import {
	firewallDoneTitle,
	lanInvalidText,
	savedTitle,
	type FirewallAction,
	type FirewallResult,
	type LanInfo
} from '$lib/domain/lan';
import { denialText } from '$lib/domain/security';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import { securityDenial, type SecurityMessage } from './security.svelte';
import type { SessionGuard } from './ticket-list.svelte';

export interface SecurityLanData {
	info(options: RequestOptions): Promise<SecurityAnswer<LanInfo>>;
	save(
		setting: { enabled: boolean; addresses: readonly string[] },
		options: RequestOptions
	): Promise<SecurityAnswer<LanInfo>>;
	firewall(
		action: FirewallAction,
		options: RequestOptions
	): Promise<SecurityAnswer<{ result: FirewallResult; lan: LanInfo | null }>>;
}

export function securityLanData(pb: PocketBase): SecurityLanData {
	return {
		info: (options) => fetchSecurityLan(pb, options),
		save: (setting, options) => saveSecurityLan(pb, setting, options),
		firewall: (action, options) => changeSecurityFirewall(pb, action, options)
	};
}

export type SecurityLanState = 'idle' | 'loading' | 'ready' | 'denied' | 'error';
export type SecurityLanPart = 'save' | 'firewall';

export class SecurityLanStore {
	readonly #data: SecurityLanData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #controller = new AbortController();

	#state = $state<SecurityLanState>('idle');
	#info = $state.raw<LanInfo | null>(null);
	#message = $state<SecurityMessage | null>(null);
	#busy = $state<SecurityLanPart | null>(null);
	#partMessage = $state<{ part: SecurityLanPart; message: SecurityMessage } | null>(null);
	#invalid = $state.raw<readonly string[]>([]);
	#failed = $state.raw<FirewallResult | null>(null);

	constructor(data: SecurityLanData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	get state(): SecurityLanState {
		return this.#state;
	}

	get info(): LanInfo | null {
		return this.#info;
	}

	/** Why the part shows nothing (refusal or failure). */
	get message(): SecurityMessage | null {
		return this.#message;
	}

	/** The change that runs, or null. */
	get busy(): SecurityLanPart | null {
		return this.#busy;
	}

	/** Why the last change did not go through (shown at its part). */
	get partMessage(): { part: SecurityLanPart; message: SecurityMessage } | null {
		return this.#partMessage;
	}

	/** The addresses the server refused at the last save. */
	get invalid(): readonly string[] {
		return this.#invalid;
	}

	/** The last change of the firewall rule that did not happen, with its entry of the catalog. */
	get failed(): FirewallResult | null {
		return this.#failed;
	}

	/** Ends the requests of the page. */
	dispose(): void {
		this.#controller.abort();
	}

	/** Loads (again); the last state stays while it runs. */
	async load(): Promise<void> {
		if (!this.#session.ensureValid()) return;
		if (this.#info === null) this.#state = 'loading';
		try {
			const answer = await this.#data.info(this.#options());
			if (answer.kind === 'ok') {
				this.#info = answer.value;
				this.#message = null;
				this.#state = 'ready';
			} else if (this.#info === null) {
				this.#message =
					answer.kind === 'denied' ? securityDenial(answer.reason) : denialText('script');
				this.#state = 'denied';
			}
		} catch (error) {
			const failure = toDataError(error, this.#controller.signal);
			if (failure.kind === 'aborted') return;
			if (failure.kind === 'session') {
				this.#session.logout();
				return;
			}
			if (this.#info === null) {
				this.#message = { title: denialText('script').title, text: failure.message };
				this.#state = 'error';
			}
		}
	}

	/** Saves the setting into byl-config.json; it applies after a restart. */
	async save(enabled: boolean, addresses: readonly string[]): Promise<boolean> {
		if (!this.#begin('save')) return false;
		try {
			const answer = await this.#data.save({ enabled, addresses }, this.#options());
			if (answer.kind === 'denied') {
				this.#partMessage = { part: 'save', message: securityDenial(answer.reason) };
				return false;
			}
			if (answer.kind === 'invalid') {
				this.#invalid = answer.invalid;
				this.#partMessage = {
					part: 'save',
					message: { title: 'Nicht gespeichert', text: lanInvalidText(answer.problem) }
				};
				return false;
			}
			this.#info = answer.value;
			this.#flags.show({
				tone: 'success',
				title: savedTitle(answer.value.enabled),
				description: 'Gilt nach einem Neustart der App.'
			});
			return true;
		} catch (error) {
			this.#fail('save', error, 'Nicht gespeichert');
			return false;
		} finally {
			this.#busy = null;
		}
	}

	/**
	 * Creates or removes the firewall rule. Windows asks for administrator rights on the machine of
	 * the app; a declined or failed change stays with its entry of the catalog.
	 */
	async firewall(action: FirewallAction): Promise<boolean> {
		if (!this.#begin('firewall')) return false;
		this.#failed = null;
		try {
			const answer = await this.#data.firewall(action, this.#options());
			if (answer.kind === 'denied') {
				this.#partMessage = { part: 'firewall', message: securityDenial(answer.reason) };
				return false;
			}
			if (answer.kind === 'invalid') {
				this.#partMessage = {
					part: 'firewall',
					message: { title: 'Nicht geändert', text: lanInvalidText(answer.problem) }
				};
				return false;
			}
			if (answer.value.lan !== null) this.#info = answer.value.lan;
			if (!answer.value.result.ok) {
				this.#failed = answer.value.result;
				return false;
			}
			this.#flags.show({ tone: 'success', title: firewallDoneTitle(action) });
			return true;
		} catch (error) {
			this.#fail('firewall', error, 'Nicht geändert');
			return false;
		} finally {
			this.#busy = null;
		}
	}

	#options(): RequestOptions {
		return { signal: this.#controller.signal };
	}

	#begin(part: SecurityLanPart): boolean {
		if (this.#busy !== null || !this.#session.ensureValid()) return false;
		this.#busy = part;
		this.#partMessage = null;
		this.#invalid = [];
		return true;
	}

	#fail(part: SecurityLanPart, error: unknown, title: string): void {
		const failure = toDataError(error, this.#controller.signal);
		if (failure.kind === 'session') this.#session.logout();
		if (failure.kind !== 'aborted' && failure.kind !== 'session') {
			this.#partMessage = { part, message: { title, text: failure.message } };
		}
	}
}
