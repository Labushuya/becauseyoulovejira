// Errors of this session (FP-1, ADR-0071 §4): every failed action whose message shows "Details"
// (ProblemDetails records it once) and every error nobody caught (window events "error" and
// "unhandledrejection", as "Unerwarteter Fehler"). Only in sessionStorage under PROBLEM_LOG_KEY, so
// a reload of the tab keeps the list and nothing else ever sees it: no localStorage, no server. A
// ring of at most PROBLEM_LOG_MAX entries; the same problem in quick succession counts on its entry
// ("3×"). Blocked or full storage never breaks anything, the list then lasts for this page. The one
// list of the app is the module instance `problemLog`; the dialog "Fehler dieser Sitzung" opens
// through it (rendered once by the root layout). The entries of the server are never stored here.
// Since FP-3 the list belongs to the account it was recorded for: the auth flow reports every change
// of the account (`useAccount`, from lib/auth.svelte.ts), and the list goes when the account signs
// out or another one signs in, also after a reload (the account is kept next to the list under
// PROBLEM_LOG_ACCOUNT_KEY), so the next person at the same tab never reads the errors of the last.

import { SvelteSet } from 'svelte/reactivity';
import { version } from '$app/environment';
import { provideAppVersion, unexpectedProblem } from '$lib/data/errors';
import {
	PROBLEM_LOG_ACCOUNT_KEY,
	PROBLEM_LOG_KEY,
	addProblem,
	isIgnorableGlobalError,
	parseStoredProblems,
	serializeProblems,
	type ProblemEntry
} from '$lib/domain/problems';

export type ProblemStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The list shown: this tab or the log of the server (FP-2, ADR-0077; the switch of FP-3). */
export type ProblemView = 'session' | 'server';

export class ProblemLog {
	readonly #storage: ProblemStorage | null;
	/** IDs taken on this page: a message that shows again (a flag moving, a re-render) counts once. */
	readonly #taken = new SvelteSet<string>();
	#entries = $state.raw<readonly ProblemEntry[]>([]);
	#dialogOpen = $state(false);
	/** The account the list belongs to; null while nobody is signed in. */
	#account: string | null = null;

	constructor(storage: ProblemStorage | null) {
		this.#storage = storage;
		this.#entries = this.#read();
		this.#account = this.#readAccount();
	}

	/** The entries, newest first. */
	get entries(): readonly ProblemEntry[] {
		return this.#entries;
	}

	/** Number of entries ("Alle Fehler dieser Sitzung (n)"). */
	get count(): number {
		return this.#entries.length;
	}

	/** Takes an entry once; null (no failed action) is ignored. */
	record(problem: ProblemEntry | null): void {
		if (problem === null || this.#taken.has(problem.id)) return;
		this.#taken.add(problem.id);
		this.#entries = addProblem(this.#entries, problem);
		this.#write();
	}

	/** An error nobody caught. */
	recordUnexpected(error: unknown): void {
		this.record(unexpectedProblem(error));
	}

	/** "Liste leeren". */
	clear(): void {
		this.#entries = [];
		this.#write();
	}

	/**
	 * The account of the tab (FP-3), null without one: signing out or another account empties the
	 * list of the account before; the first sign-in after none keeps it (what failed while signed
	 * out, e.g. at the login, belongs to nobody), the same account again changes nothing.
	 */
	useAccount(userId: string | null): void {
		if (userId === this.#account) return;
		if (this.#account !== null) this.clear();
		this.#account = userId;
		try {
			if (userId === null) this.#storage?.removeItem(PROBLEM_LOG_ACCOUNT_KEY);
			else this.#storage?.setItem(PROBLEM_LOG_ACCOUNT_KEY, userId);
		} catch {
			// Blocked or full storage: the account counts for this page.
		}
	}

	get dialogOpen(): boolean {
		return this.#dialogOpen;
	}

	openDialog(): void {
		this.#dialogOpen = true;
	}

	closeDialog(): void {
		this.#dialogOpen = false;
	}

	#read(): ProblemEntry[] {
		try {
			return parseStoredProblems(this.#storage?.getItem(PROBLEM_LOG_KEY) ?? null);
		} catch {
			return [];
		}
	}

	#readAccount(): string | null {
		try {
			const value = this.#storage?.getItem(PROBLEM_LOG_ACCOUNT_KEY) ?? null;
			return value === null || value === '' ? null : value;
		} catch {
			return null;
		}
	}

	#write(): void {
		try {
			if (this.#entries.length === 0) this.#storage?.removeItem(PROBLEM_LOG_KEY);
			else this.#storage?.setItem(PROBLEM_LOG_KEY, serializeProblems(this.#entries));
		} catch {
			// Blocked or full storage: the list lasts for this page.
		}
	}
}

function sessionStorageOrNull(): ProblemStorage | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		return null;
	}
}

provideAppVersion(version);

/** The list of this tab. */
export const problemLog = new ProblemLog(sessionStorageOrNull());

/**
 * Records the errors nobody caught in `log`; noise (a ResizeObserver loop, "Script error." of a
 * foreign script, browser extensions) stays out. Returns the function that stops it. The app
 * calls it once at its start (`init` of hooks.client.ts), not in a component: Vitest stops
 * reporting uncaught errors while the window has a listener for them, so tests of components
 * keep failing on such an error.
 */
export function watchUnexpectedErrors(win: Window, log: ProblemLog = problemLog): () => void {
	const onError = (event: Event) => {
		const report = event as Partial<ErrorEvent>;
		const message = typeof report.message === 'string' ? report.message : '';
		const filename = typeof report.filename === 'string' ? report.filename : '';
		const error: unknown = report.error;
		const hasError = error !== undefined && error !== null;
		if (isIgnorableGlobalError({ message, filename, hasError })) return;
		log.recordUnexpected(hasError ? error : message);
	};
	const onRejection = (event: Event) => {
		log.recordUnexpected((event as Partial<PromiseRejectionEvent>).reason);
	};
	win.addEventListener('error', onError);
	win.addEventListener('unhandledrejection', onRejection);
	return () => {
		win.removeEventListener('error', onError);
		win.removeEventListener('unhandledrejection', onRejection);
	};
}
