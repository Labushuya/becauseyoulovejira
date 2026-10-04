// Page "Einstellungen → Konten" (ADR-0056 §3; ADR-0006): the accounts of the app for its
// administrator, loaded when the page opens; one change at a time. A new or reset password stays
// in the store until the page says it was handed over (it never goes into a flag, the address or
// storage). Results go out as flags, refusals stay on the page.

import type PocketBase from 'pocketbase';
import {
	createAccount,
	deleteOrphanedHousehold,
	fetchAccounts,
	resetAccountPassword,
	setAccountAdmin,
	setAccountDisabled,
	setHouseholdOwner,
	type AccountsAnswer
} from '$lib/data/accounts';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	ACCOUNTS_TEXTS,
	accountLabel,
	denialText,
	problemText,
	type Account,
	type AccountList,
	type HouseholdDeletion,
	type OrphanHousehold,
	type OrphanMember,
	type PasswordGrant
} from '$lib/domain/accounts';
import type { HouseholdCounts } from '$lib/domain/area-move';
import type { SystemDenial } from '$lib/domain/system';
import { RESTART_NEEDED, restartNeeded } from '$lib/guidance/texts';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';

export interface AccountsData {
	list(options: RequestOptions): Promise<AccountsAnswer<AccountList>>;
	create(
		input: { email: string; name: string },
		options: RequestOptions
	): Promise<AccountsAnswer<PasswordGrant>>;
	resetPassword(id: string, options: RequestOptions): Promise<AccountsAnswer<PasswordGrant>>;
	setDisabled(
		id: string,
		disabled: boolean,
		options: RequestOptions
	): Promise<AccountsAnswer<Account>>;
	setAdmin(id: string, admin: boolean, options: RequestOptions): Promise<AccountsAnswer<Account>>;
	/** A new owner of a household without an active owner (E7-4); answers the list. */
	setHouseholdOwner?(
		householdId: string,
		memberId: string,
		options: RequestOptions
	): Promise<AccountsAnswer<AccountList>>;
	/** Deletes an orphaned household (E7-4c): its counts with `preview`, else the new list. */
	deleteHousehold?(
		householdId: string,
		input: { preview: boolean; name?: string },
		options: RequestOptions
	): Promise<AccountsAnswer<HouseholdDeletion>>;
}

export function accountsData(pb: PocketBase): AccountsData {
	return {
		list: (options) => fetchAccounts(pb, options),
		create: (input, options) => createAccount(pb, input, options),
		resetPassword: (id, options) => resetAccountPassword(pb, id, options),
		setDisabled: (id, disabled, options) => setAccountDisabled(pb, id, disabled, options),
		setAdmin: (id, admin, options) => setAccountAdmin(pb, id, admin, options),
		setHouseholdOwner: (householdId, memberId, options) =>
			setHouseholdOwner(pb, householdId, memberId, options),
		deleteHousehold: (householdId, input, options) =>
			deleteOrphanedHousehold(pb, householdId, input, options)
	};
}

export type AccountsState = 'idle' | 'loading' | 'ready' | 'denied' | 'error';

/** What runs: "create", an action at one account, a new owner or deleting of a household. */
export type AccountsBusy =
	| { kind: 'create' }
	| { kind: 'password' | 'disable' | 'admin'; accountId: string }
	| { kind: 'owner' | 'delete'; householdId: string }
	| null;

/** Outcome of the dialog "Haushalt löschen": done, or the text of the refusal ('' for none). */
export type DeleteOutcome = { ok: true } | { ok: false; message: string };

export interface AccountsMessage {
	title: string;
	text: string;
}

/** A password shown once: of a new account or after a reset. */
export interface ShownPassword {
	kind: 'created' | 'reset';
	account: Account;
	password: string;
}

/** Outcome of "Konto anlegen" for the form: done, or the field the server refused. */
export type CreateOutcome =
	{ ok: true } | { ok: false; field: 'email' | 'name' | null; message: string };

/** What the page says for a refusal; "missing" is the hint to restart after an update. */
export function accountsDenial(reason: SystemDenial): AccountsMessage {
	if (reason === 'missing') {
		return { title: RESTART_NEEDED.title, text: restartNeeded('Die Seite Konten ist') };
	}
	return denialText(reason);
}

const FIELD_OF_PROBLEM: Readonly<Record<string, 'email' | 'name'>> = {
	email: 'email',
	'email-taken': 'email',
	name: 'name',
	'name-long': 'name'
};

export class AccountsStore {
	readonly #data: AccountsData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #controller = new AbortController();

	#state = $state<AccountsState>('idle');
	#accounts = $state.raw<Account[]>([]);
	#households = $state.raw<OrphanHousehold[]>([]);
	#passwordMin = $state(8);
	#message = $state<AccountsMessage | null>(null);
	#busy = $state.raw<AccountsBusy>(null);
	#actionMessage = $state<AccountsMessage | null>(null);
	#shown = $state.raw<ShownPassword | null>(null);

	constructor(data: AccountsData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	get state(): AccountsState {
		return this.#state;
	}

	get accounts(): readonly Account[] {
		return this.#accounts;
	}

	get passwordMin(): number {
		return this.#passwordMin;
	}

	/** Households whose owner is disabled or gone (E7-4, ADR-0061 §6). */
	get households(): readonly OrphanHousehold[] {
		return this.#households;
	}

	/** Why the page shows no list (refusal or failure). */
	get message(): AccountsMessage | null {
		return this.#message;
	}

	get busy(): AccountsBusy {
		return this.#busy;
	}

	/** Why the last action at an account did not run (shown at the list, not as a flag). */
	get actionMessage(): AccountsMessage | null {
		return this.#actionMessage;
	}

	/** The password shown once, until the page dismisses it. */
	get shownPassword(): ShownPassword | null {
		return this.#shown;
	}

	/** Ends the requests of the page. */
	dispose(): void {
		this.#controller.abort();
	}

	/** The password was handed over: it leaves the page. */
	dismissPassword(): void {
		this.#shown = null;
	}

	/** Loads (again); the last list stays while it runs. */
	async load(): Promise<void> {
		if (!this.#session.ensureValid()) return;
		if (this.#state !== 'ready') this.#state = 'loading';
		try {
			const answer = await this.#data.list({ signal: this.#controller.signal });
			if (answer.kind === 'ok') {
				this.#applyList(answer.value);
				this.#message = null;
				this.#state = 'ready';
			} else if (this.#state !== 'ready') {
				this.#message =
					answer.kind === 'denied'
						? accountsDenial(answer.reason)
						: { title: denialText('script').title, text: problemText(answer.problem) };
				this.#state = 'denied';
			}
		} catch (error) {
			if (this.#handled(error)) return;
			if (this.#state !== 'ready') {
				this.#message = { title: denialText('script').title, text: toDataError(error).message };
				this.#state = 'error';
			}
		}
	}

	/** "Konto anlegen": on success the start password is shown once and the list loads again. */
	async create(input: { email: string; name: string }): Promise<CreateOutcome> {
		if (this.#busy !== null || !this.#session.ensureValid()) {
			return { ok: false, field: null, message: '' };
		}
		this.#busy = { kind: 'create' };
		this.#actionMessage = null;
		try {
			const answer = await this.#data.create(input, { signal: this.#controller.signal });
			if (answer.kind === 'invalid') {
				return {
					ok: false,
					field: FIELD_OF_PROBLEM[answer.problem] ?? null,
					message: problemText(answer.problem)
				};
			}
			if (answer.kind === 'denied') {
				const message = accountsDenial(answer.reason);
				return { ok: false, field: null, message: `${message.title}. ${message.text}` };
			}
			this.#shown = {
				kind: 'created',
				account: answer.value.account,
				password: answer.value.password
			};
			this.#merge(answer.value.account);
			await this.load();
			return { ok: true };
		} catch (error) {
			if (this.#handled(error)) return { ok: false, field: null, message: '' };
			return { ok: false, field: null, message: toDataError(error).message };
		} finally {
			this.#busy = null;
		}
	}

	/** "Passwort zurücksetzen": the new password is shown once. */
	async resetPassword(account: Account): Promise<boolean> {
		const grant = await this.#run({ kind: 'password', accountId: account.id }, () =>
			this.#data.resetPassword(account.id, { signal: this.#controller.signal })
		);
		if (grant === null) return false;
		this.#shown = { kind: 'reset', account: grant.account, password: grant.password };
		this.#merge(grant.account);
		return true;
	}

	/** "Deaktivieren" or "Aktivieren". */
	async setDisabled(account: Account, disabled: boolean): Promise<boolean> {
		const changed = await this.#run({ kind: 'disable', accountId: account.id }, () =>
			this.#data.setDisabled(account.id, disabled, { signal: this.#controller.signal })
		);
		if (changed === null) return false;
		this.#merge(changed);
		const label = accountLabel(changed);
		this.#flags.show({
			tone: 'success',
			title: disabled ? ACCOUNTS_TEXTS.disabled(label) : ACCOUNTS_TEXTS.enabled(label)
		});
		return true;
	}

	/** "Zum Verwalter machen" or "Verwalter-Recht entziehen". */
	async setAdmin(account: Account, admin: boolean): Promise<boolean> {
		const changed = await this.#run({ kind: 'admin', accountId: account.id }, () =>
			this.#data.setAdmin(account.id, admin, { signal: this.#controller.signal })
		);
		if (changed === null) return false;
		this.#merge(changed);
		const label = accountLabel(changed);
		this.#flags.show({
			tone: 'success',
			title: admin ? ACCOUNTS_TEXTS.granted(label) : ACCOUNTS_TEXTS.revoked(label)
		});
		return true;
	}

	/**
	 * "Zum Inhaber machen" of a household without an active owner (E7-4, ADR-0061 §6): an active
	 * member becomes its owner; the answer is the new list.
	 */
	async setHouseholdOwner(household: OrphanHousehold, member: OrphanMember): Promise<boolean> {
		const save = this.#data.setHouseholdOwner;
		if (save === undefined) return false;
		const list = await this.#run({ kind: 'owner', householdId: household.id }, () =>
			save(household.id, member.id, { signal: this.#controller.signal })
		);
		if (list === null) {
			// The page knew too much (a member left, the owner is back): read the list again.
			void this.load();
			return false;
		}
		this.#applyList(list);
		this.#flags.show({
			tone: 'success',
			title: ACCOUNTS_TEXTS.newOwnerDone(member.name || 'Konto ohne Namen', household.name)
		});
		return true;
	}

	/**
	 * The preview of "Haushalt löschen" for an orphaned household (E7-4c): what it holds. Changes
	 * nothing; a refusal comes back as its text for the dialog.
	 */
	async householdDeletePreview(
		household: OrphanHousehold,
		signal?: AbortSignal
	): Promise<{ ok: true; counts: HouseholdCounts } | { ok: false; message: string }> {
		const remove = this.#data.deleteHousehold;
		if (remove === undefined || !this.#session.ensureValid()) return { ok: false, message: '' };
		try {
			const answer = await remove(household.id, { preview: true }, { signal });
			if (answer.kind === 'ok') return { ok: true, counts: answer.value.counts };
			return { ok: false, message: this.#refusalText(answer) };
		} catch (error) {
			const failure = toDataError(error, signal);
			if (failure.kind === 'session') this.#session.logout();
			return {
				ok: false,
				message: failure.kind === 'aborted' || failure.kind === 'session' ? '' : failure.message
			};
		}
	}

	/**
	 * "Haushalt löschen" (E7-4c): deletes an orphaned household for good with its typed name. The
	 * answer is the new list, a flag says it; a refusal stays in the dialog, and one that says the
	 * page knew too much (gone, not orphaned) reads the list again.
	 */
	async deleteHousehold(household: OrphanHousehold, name: string): Promise<DeleteOutcome> {
		const remove = this.#data.deleteHousehold;
		if (remove === undefined || this.#busy !== null || !this.#session.ensureValid()) {
			return { ok: false, message: '' };
		}
		this.#busy = { kind: 'delete', householdId: household.id };
		this.#actionMessage = null;
		try {
			const answer = await remove(
				household.id,
				{ preview: false, name },
				{ signal: this.#controller.signal }
			);
			if (answer.kind !== 'ok') {
				if (answer.kind === 'invalid' && answer.problem !== 'household-name') void this.load();
				return { ok: false, message: this.#refusalText(answer) };
			}
			if (answer.value.list !== null) this.#applyList(answer.value.list);
			this.#flags.show({ tone: 'success', title: ACCOUNTS_TEXTS.deleteDone(household.name) });
			return { ok: true };
		} catch (error) {
			if (this.#handled(error)) return { ok: false, message: '' };
			return { ok: false, message: toDataError(error).message };
		} finally {
			this.#busy = null;
		}
	}

	#refusalText(answer: Exclude<AccountsAnswer<unknown>, { kind: 'ok' }>): string {
		if (answer.kind === 'invalid') return problemText(answer.problem);
		const message = accountsDenial(answer.reason);
		return `${message.title}. ${message.text}`;
	}

	#applyList(list: AccountList): void {
		this.#accounts = list.accounts;
		this.#households = list.households ?? [];
		this.#passwordMin = list.passwordMin;
	}

	/** One change at a time; a refusal stays on the page. */
	async #run<T>(
		busy: Exclude<AccountsBusy, null>,
		call: () => Promise<AccountsAnswer<T>>
	): Promise<T | null> {
		if (this.#busy !== null || !this.#session.ensureValid()) return null;
		this.#busy = busy;
		this.#actionMessage = null;
		try {
			const answer = await call();
			if (answer.kind === 'ok') return answer.value;
			this.#actionMessage =
				answer.kind === 'denied'
					? accountsDenial(answer.reason)
					: { title: 'Nicht möglich', text: problemText(answer.problem) };
			return null;
		} catch (error) {
			if (!this.#handled(error)) {
				this.#actionMessage = { title: 'Nicht möglich', text: toDataError(error).message };
			}
			return null;
		} finally {
			this.#busy = null;
		}
	}

	/** Aborted or a lost session: nothing more to say on the page. */
	#handled(error: unknown): boolean {
		const failure = toDataError(error, this.#controller.signal);
		if (failure.kind === 'aborted') return true;
		if (failure.kind === 'session') {
			this.#session.logout();
			return true;
		}
		return false;
	}

	#merge(account: Account): void {
		const known = this.#accounts.some((entry) => entry.id === account.id);
		this.#accounts = known
			? this.#accounts.map((entry) => (entry.id === account.id ? account : entry))
			: [...this.#accounts, account];
	}
}
