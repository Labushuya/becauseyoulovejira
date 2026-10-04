// Page "Einstellungen → Konto" (ADR-0056 §3): the own display name and the own password through the
// Record API of users. One change at a time; field errors in German for the form, results as flags.
// A new password ends every session of the account (PocketBase renews its token key); the data
// layer signs in again with it right away, so this tab stays signed in.

import type PocketBase from 'pocketbase';
import { changeOwnPassword, saveOwnName } from '$lib/data/accounts';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	nameProblem,
	passwordChangeProblems,
	problemText,
	PASSWORD_MIN
} from '$lib/domain/accounts';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';

export interface OwnAccountData {
	saveName(id: string, name: string, options: RequestOptions): Promise<string>;
	changePassword(
		input: { id: string; email: string; current: string; next: string },
		options: RequestOptions
	): Promise<void>;
}

export function ownAccountData(pb: PocketBase): OwnAccountData {
	return {
		saveName: (id, name, options) => saveOwnName(pb, id, name, options),
		changePassword: (input, options) => changeOwnPassword(pb, input, options)
	};
}

/** The signed-in account as the page needs it. */
export interface OwnAccountSession extends SessionGuard {
	readonly userId: string | null;
	readonly email: string;
}

export type PasswordField = 'current' | 'next' | 'again';

/** Outcome for the forms: done, or errors per field and one for the whole form. */
export type FormOutcome<F extends string> =
	{ ok: true } | { ok: false; fields: Partial<Record<F, string>>; form: string };

export const OWN_ACCOUNT_TEXTS = {
	nameSaved: 'Name gespeichert.',
	passwordChanged: 'Passwort geändert.',
	passwordChangedText: 'Andere Geräte und Browser melden sich mit dem neuen Passwort neu an.',
	wrongCurrent: 'Das bisherige Passwort stimmt nicht.'
} as const;

export class OwnAccountStore {
	readonly #data: OwnAccountData;
	readonly #session: OwnAccountSession;
	readonly #flags: FlagSink;
	readonly #controller = new AbortController();
	#busy = $state<'name' | 'password' | null>(null);

	constructor(data: OwnAccountData, session: OwnAccountSession, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	/** The change that runs, or null. */
	get busy(): 'name' | 'password' | null {
		return this.#busy;
	}

	dispose(): void {
		this.#controller.abort();
	}

	/** Saves the display name (trimmed); the field error comes from the rules of the hook. */
	async saveName(name: string): Promise<FormOutcome<'name'>> {
		const problem = nameProblem(name);
		if (problem !== '') return { ok: false, fields: { name: problemText(problem) }, form: '' };
		const id = this.#session.userId;
		if (this.#busy !== null || id === null || !this.#session.ensureValid()) {
			return { ok: false, fields: {}, form: '' };
		}
		this.#busy = 'name';
		try {
			await this.#data.saveName(id, name.trim(), { signal: this.#controller.signal });
			this.#flags.show({ tone: 'success', title: OWN_ACCOUNT_TEXTS.nameSaved });
			return { ok: true };
		} catch (error) {
			return this.#failure(error, (fields) => (fields.name ? { name: fields.name } : {}));
		} finally {
			this.#busy = null;
		}
	}

	/**
	 * Changes the own password: the old one, the new one twice, at least `min` signs (PocketBase).
	 * Checks before sending; a wrong old password is an error at its field.
	 */
	async changePassword(
		input: { current: string; next: string; again: string },
		min: number = PASSWORD_MIN
	): Promise<FormOutcome<PasswordField>> {
		const problems = passwordChangeProblems(input, min);
		if (Object.keys(problems).length > 0) return { ok: false, fields: problems, form: '' };
		const id = this.#session.userId;
		if (this.#busy !== null || id === null || !this.#session.ensureValid()) {
			return { ok: false, fields: {}, form: '' };
		}
		this.#busy = 'password';
		try {
			await this.#data.changePassword(
				{ id, email: this.#session.email, current: input.current, next: input.next },
				{ signal: this.#controller.signal }
			);
			this.#flags.show({
				tone: 'success',
				title: OWN_ACCOUNT_TEXTS.passwordChanged,
				description: OWN_ACCOUNT_TEXTS.passwordChangedText
			});
			return { ok: true };
		} catch (error) {
			return this.#failure(error, (fields) => {
				const result: Partial<Record<PasswordField, string>> = {};
				if (fields.oldPassword) result.current = OWN_ACCOUNT_TEXTS.wrongCurrent;
				if (fields.password) result.next = fields.password;
				if (fields.passwordConfirm) result.again = fields.passwordConfirm;
				return result;
			});
		} finally {
			this.#busy = null;
		}
	}

	#failure<F extends string>(
		error: unknown,
		map: (fields: Record<string, string>) => Partial<Record<F, string>>
	): FormOutcome<F> {
		const failure = toDataError(error, this.#controller.signal);
		if (failure.kind === 'aborted') return { ok: false, fields: {}, form: '' };
		if (failure.kind === 'session') {
			this.#session.logout();
			return { ok: false, fields: {}, form: '' };
		}
		const messages = Object.fromEntries(
			Object.entries(failure.fields).map(([field, detail]) => [field, detail.message])
		);
		const fields = map(messages);
		return {
			ok: false,
			fields,
			form: Object.keys(fields).length > 0 ? '' : failure.message
		};
	}
}
