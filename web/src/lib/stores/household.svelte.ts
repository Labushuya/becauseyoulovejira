// The household of the signed-in account (ADR-0058, E7-2; ADR-0006): loaded once per session by the
// (app) layout and read again whenever the server reports a change (topic byl/household), after a
// reconnection and after a subscription that failed first. The page "Einstellungen → Haushalt"
// takes it from the context and runs its actions through it, one at a time. A code stands only in
// the store and only until the page says it was handed on (never in a flag, the address or storage).
//
// When the membership of this tab begins or ends (joined, left, removed, also in another tab or by
// another member), the API rules show or hide the household records at once. The store then calls
// `membershipChanged` with what to say; since E7-3 (ADR-0059 §8) the layout reloads no page: the
// stores show one area only, the area follows the household (lost: "Privat"), and the notice
// stands as a flag. Founding a household changes nothing there: it is empty.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { toDataError } from '$lib/data/errors';
import {
	createHouseholdInvite,
	dissolveHousehold,
	fetchHousehold,
	foundHousehold,
	joinHousehold,
	leaveHousehold,
	removeHouseholdMember,
	renameHousehold,
	revokeHouseholdInvite,
	setHouseholdRetention,
	setHouseholdRights,
	subscribeHousehold,
	transferHousehold,
	type HouseholdAnswer,
	type HouseholdChange
} from '$lib/data/household';
import {
	DISSOLVE_TEXTS,
	moveProblemText,
	type DissolveMode,
	type DissolvePreview
} from '$lib/domain/area-move';
import type { RequestOptions } from '$lib/data/options';
import { onReconnect, type Unsubscribe } from '$lib/data/realtime';
import {
	HOUSEHOLD_TEXTS,
	memberLabel,
	nameProblem,
	problemText,
	type HouseholdInvite,
	type HouseholdMember,
	type HouseholdRight,
	type HouseholdState,
	type InviteGrant
} from '$lib/domain/household';
import { RETENTION_LABELS, type TrashRetention } from '$lib/domain/trash';
import { RESTART_NEEDED, restartNeeded } from '$lib/guidance/texts';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import { hold, type HoldOptions } from './realtime';
import type { SessionGuard } from './ticket-list.svelte';

type State = HouseholdState | null;

export interface HouseholdData {
	fetch(options: RequestOptions): Promise<HouseholdAnswer<State>>;
	found(name: string, options: RequestOptions): Promise<HouseholdAnswer<State>>;
	rename(name: string, options: RequestOptions): Promise<HouseholdAnswer<State>>;
	invite(options: RequestOptions): Promise<HouseholdAnswer<InviteGrant>>;
	revoke(id: string, options: RequestOptions): Promise<HouseholdAnswer<State>>;
	join(code: string, options: RequestOptions): Promise<HouseholdAnswer<State>>;
	setRights(
		memberId: string,
		rights: readonly HouseholdRight[],
		options: RequestOptions
	): Promise<HouseholdAnswer<State>>;
	remove(memberId: string, options: RequestOptions): Promise<HouseholdAnswer<State>>;
	transfer(memberId: string, options: RequestOptions): Promise<HouseholdAnswer<State>>;
	leave(options: RequestOptions): Promise<HouseholdAnswer<State>>;
	/** The retention of the trash of the household (E7-3; owner or right "purge"). */
	retention?(retention: TrashRetention, options: RequestOptions): Promise<HouseholdAnswer<State>>;
	/** Dissolving the household (E7-4; only the owner), also its preview. */
	dissolve?(
		body: { mode: DissolveMode; preview?: boolean; name?: string },
		options: RequestOptions
	): Promise<HouseholdAnswer<DissolvePreview>>;
}

export function householdData(pb: PocketBase): HouseholdData {
	return {
		fetch: (options) => fetchHousehold(pb, options),
		found: (name, options) => foundHousehold(pb, name, options),
		rename: (name, options) => renameHousehold(pb, name, options),
		invite: (options) => createHouseholdInvite(pb, options),
		revoke: (id, options) => revokeHouseholdInvite(pb, id, options),
		join: (code, options) => joinHousehold(pb, code, options),
		setRights: (memberId, rights, options) => setHouseholdRights(pb, memberId, rights, options),
		remove: (memberId, options) => removeHouseholdMember(pb, memberId, options),
		transfer: (memberId, options) => transferHousehold(pb, memberId, options),
		leave: (options) => leaveHousehold(pb, options),
		retention: (retention, options) => setHouseholdRetention(pb, retention, options),
		dissolve: (body, options) => dissolveHousehold(pb, body, options)
	};
}

/** Changes of the household from the server and reconnections (ADR-0007 section 3). */
export interface HouseholdLive {
	/** `change` says whether the household was dissolved (E7-4); absent in older fakes. */
	changes(onChange: (change?: HouseholdChange) => void): Promise<Unsubscribe>;
	reconnected(callback: () => void): Promise<Unsubscribe>;
}

export function householdLive(pb: PocketBase): HouseholdLive {
	return {
		changes: (onChange) => subscribeHousehold(pb, onChange),
		reconnected: (callback) => onReconnect(pb, callback)
	};
}

/** What the layout says when the membership of the tab began or ended. */
export interface HouseholdNotice {
	title: string;
	text?: string;
}

export type HouseholdLoad = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

/** What runs; one action at a time. */
export type HouseholdBusy =
	| { kind: 'found' | 'join' | 'rename' | 'invite' | 'leave' | 'retention' | 'dissolve' }
	| { kind: 'revoke'; inviteId: string }
	| { kind: 'rights' | 'remove' | 'transfer'; memberId: string }
	| null;

export interface HouseholdMessage {
	title: string;
	text: string;
}

/** A code of this tab, shown once. */
export interface ShownCode {
	code: string;
	invite: HouseholdInvite | null;
}

/** Outcome of a form: done, or the text for its field. */
export type FieldOutcome = { ok: true } | { ok: false; message: string };

const REFUSED_TITLE = 'Nicht möglich';

export class HouseholdStore {
	readonly #data: HouseholdData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #membershipChanged: (notice: HouseholdNotice) => void;
	readonly #hold: HoldOptions;
	#controller: AbortController | null = null;
	#reloadAgain = false;
	#actions = new AbortController();

	#state = $state<HouseholdLoad>('idle');
	#current = $state.raw<State>(null);
	#busy = $state.raw<HouseholdBusy>(null);
	#message = $state.raw<HouseholdMessage | null>(null);
	#shown = $state.raw<ShownCode | null>(null);
	/** The household this tab knows since its first answer; undefined before it. */
	#known: string | null | undefined = undefined;
	/** The server said the household was dissolved (E7-4): the notice says so when it is gone. */
	#dissolved = false;

	constructor(
		data: HouseholdData,
		session: SessionGuard,
		flags: FlagSink = SILENT_FLAGS,
		membershipChanged: (notice: HouseholdNotice) => void = () => undefined,
		holdOptions: HoldOptions = {}
	) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
		this.#membershipChanged = membershipChanged;
		this.#hold = holdOptions;
	}

	get state(): HouseholdLoad {
		return this.#state;
	}

	/** The household of the account, null without one (meaningful once `state` is "ready"). */
	get household(): State {
		return this.#current;
	}

	get busy(): HouseholdBusy {
		return this.#busy;
	}

	/** Why the last action did not run or why the page shows no household (refusal, restart). */
	get message(): HouseholdMessage | null {
		return this.#message;
	}

	/** The code shown once, until the page dismisses it. */
	get shownCode(): ShownCode | null {
		return this.#shown;
	}

	/** Loads once per session; the cleanup ends the requests and empties the store. */
	start(): () => void {
		void this.load();
		return () => {
			this.#controller?.abort();
			this.#controller = null;
			this.#actions.abort();
			this.#actions = new AbortController();
			this.#current = null;
			this.#shown = null;
			this.#known = undefined;
			this.#state = 'idle';
		};
	}

	/** Reads the household again after every change the server reports and after a reconnection. */
	connect(live: HouseholdLive): () => void {
		const reload = () => void this.load();
		const changed = (change?: HouseholdChange) => {
			// The own "Haushalt auflösen" says what happened itself, once its answer is there.
			if (this.#busy?.kind === 'dissolve') return;
			if (change?.dissolved === true) this.#dissolved = true;
			reload();
		};
		const stops = [
			hold((guard) => live.changes(guard(changed)), { ...this.#hold, recovered: reload }),
			hold((guard) => live.reconnected(guard(reload)), { ...this.#hold, recovered: reload })
		];
		return () => {
			for (const stop of stops) stop();
		};
	}

	/** Loads; a second call while one runs loads once more after it, so no change is lost. */
	async load(): Promise<void> {
		if (this.#controller !== null) {
			this.#reloadAgain = true;
			return;
		}
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		if (this.#state !== 'ready') this.#state = 'loading';
		try {
			const answer = await this.#data.fetch({ signal: controller.signal });
			if (answer.kind === 'ok') {
				this.#apply(answer.value, null);
			} else if (this.#state !== 'ready') {
				this.#message =
					answer.kind === 'missing'
						? { title: RESTART_NEEDED.title, text: restartNeeded('Der Haushalt ist') }
						: {
								title: REFUSED_TITLE,
								text: answer.kind === 'invalid' ? problemText(answer.problem) : ''
							};
				this.#state = answer.kind === 'missing' ? 'missing' : 'error';
			}
		} catch (error) {
			const failure = toDataError(error, controller.signal);
			if (failure.kind === 'session') this.#session.logout();
			else if (failure.kind !== 'aborted' && this.#state !== 'ready') {
				this.#message = { title: 'Haushalt nicht geladen', text: failure.message };
				this.#state = 'error';
			}
		} finally {
			if (this.#controller === controller) this.#controller = null;
			if (this.#reloadAgain && this.#controller === null && !controller.signal.aborted) {
				this.#reloadAgain = false;
				void this.load();
			}
		}
	}

	/** The code was handed on: it leaves the page. */
	dismissCode(): void {
		this.#shown = null;
	}

	/** "Haushalt gründen": the account becomes the owner; no reload, the household is empty. */
	async found(name: string): Promise<FieldOutcome> {
		const problem = nameProblem(name);
		if (problem !== '') return { ok: false, message: problemText(problem) };
		const answer = await this.#run({ kind: 'found' }, () =>
			this.#data.found(name.trim(), this.#options())
		);
		if (answer.kind !== 'ok') return this.#fieldFailure(answer);
		const founded = answer.value;
		this.#known = founded?.household.id ?? null;
		this.#apply(founded, null);
		if (founded)
			this.#flags.show({ tone: 'success', title: HOUSEHOLD_TEXTS.founded(founded.household.name) });
		return { ok: true };
	}

	/** "Mit Code beitreten": one neutral text for every unknown or ended code. */
	async join(code: string): Promise<FieldOutcome> {
		if (code.trim() === '') return { ok: false, message: problemText('code') };
		const answer = await this.#run({ kind: 'join' }, () => this.#data.join(code, this.#options()));
		if (answer.kind !== 'ok') return this.#fieldFailure(answer);
		const joined = answer.value;
		this.#apply(joined, joined ? { title: HOUSEHOLD_TEXTS.joined(joined.household.name) } : null);
		return { ok: true };
	}

	/** "Umbenennen" (right "rename"). */
	async rename(name: string): Promise<FieldOutcome> {
		const problem = nameProblem(name);
		if (problem !== '') return { ok: false, message: problemText(problem) };
		const answer = await this.#run({ kind: 'rename' }, () =>
			this.#data.rename(name.trim(), this.#options())
		);
		if (answer.kind !== 'ok') return this.#fieldFailure(answer);
		this.#apply(answer.value, null);
		if (answer.value) {
			this.#flags.show({
				tone: 'success',
				title: HOUSEHOLD_TEXTS.renamed(answer.value.household.name)
			});
		}
		return { ok: true };
	}

	/** "Neuen Code erzeugen" (right "invite"): the code stands on the page once. */
	async createInvite(): Promise<boolean> {
		const answer = await this.#run({ kind: 'invite' }, () => this.#data.invite(this.#options()));
		if (answer.kind !== 'ok') return this.#refused(answer);
		const grant = answer.value;
		this.#apply(grant.state, null);
		this.#shown = {
			code: grant.code,
			invite: grant.state.invites?.find((invite) => invite.id === grant.invite) ?? null
		};
		return true;
	}

	/** "Widerrufen" of an open code. */
	async revoke(invite: HouseholdInvite): Promise<boolean> {
		const answer = await this.#run({ kind: 'revoke', inviteId: invite.id }, () =>
			this.#data.revoke(invite.id, this.#options())
		);
		if (answer.kind !== 'ok') return this.#refused(answer);
		this.#apply(answer.value, null);
		if (this.#shown?.invite?.id === invite.id) this.#shown = null;
		this.#flags.show({ tone: 'success', title: HOUSEHOLD_TEXTS.revoked });
		return true;
	}

	/** New rights of a member (right "delegate"). */
	async setRights(member: HouseholdMember, rights: readonly HouseholdRight[]): Promise<boolean> {
		const answer = await this.#run({ kind: 'rights', memberId: member.id }, () =>
			this.#data.setRights(member.id, rights, this.#options())
		);
		if (answer.kind !== 'ok') return this.#refused(answer);
		this.#apply(answer.value, null);
		this.#flags.show({ tone: 'success', title: HOUSEHOLD_TEXTS.rightsSaved(memberLabel(member)) });
		return true;
	}

	/** Removes a member (right "remove"). */
	async remove(member: HouseholdMember): Promise<boolean> {
		const answer = await this.#run({ kind: 'remove', memberId: member.id }, () =>
			this.#data.remove(member.id, this.#options())
		);
		if (answer.kind !== 'ok') return this.#refused(answer);
		this.#apply(answer.value, null);
		this.#flags.show({ tone: 'success', title: HOUSEHOLD_TEXTS.removed(memberLabel(member)) });
		return true;
	}

	/** Hands the household to another member (only the owner). */
	async transfer(member: HouseholdMember): Promise<boolean> {
		const answer = await this.#run({ kind: 'transfer', memberId: member.id }, () =>
			this.#data.transfer(member.id, this.#options())
		);
		if (answer.kind !== 'ok') return this.#refused(answer);
		this.#apply(answer.value, null);
		this.#flags.show({ tone: 'success', title: HOUSEHOLD_TEXTS.transferred(memberLabel(member)) });
		return true;
	}

	/**
	 * "Papierkorb im Haushalt" (E7-3, ADR-0059 §6): the retention of the trash of the household, for
	 * the owner and members with "purge"; the server decides.
	 */
	async setRetention(retention: TrashRetention): Promise<boolean> {
		const save = this.#data.retention;
		if (save === undefined) return false;
		const answer = await this.#run({ kind: 'retention' }, () => save(retention, this.#options()));
		if (answer.kind !== 'ok') return this.#refused(answer);
		this.#apply(answer.value, null);
		this.#flags.show({
			tone: 'success',
			title: HOUSEHOLD_TEXTS.retentionSaved(RETENTION_LABELS[retention])
		});
		return true;
	}

	/** "Austreten": every member but the owner; the area of the tab becomes "Privat". */
	async leave(): Promise<boolean> {
		const name = this.#current?.household.name ?? '';
		const answer = await this.#run({ kind: 'leave' }, () => this.#data.leave(this.#options()));
		if (answer.kind !== 'ok') return this.#refused(answer);
		this.#apply(answer.value, {
			title: HOUSEHOLD_TEXTS.left(name),
			text: HOUSEHOLD_TEXTS.leftText
		});
		return true;
	}

	/**
	 * The preview of "Haushalt auflösen" (E7-4, ADR-0061 §5): what the household holds, its members
	 * and, for `adopt`, the codes that get a suffix. Changes nothing.
	 */
	async dissolvePreview(
		mode: DissolveMode,
		signal?: AbortSignal
	): Promise<{ ok: true; preview: DissolvePreview } | { ok: false; message: string }> {
		const dissolve = this.#data.dissolve;
		if (dissolve === undefined || !this.#session.ensureValid()) return { ok: false, message: '' };
		try {
			const answer = await dissolve({ mode, preview: true }, { signal });
			if (answer.kind === 'ok') return { ok: true, preview: answer.value };
			return { ok: false, message: this.#dissolveText(answer) };
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
	 * "Haushalt auflösen" (only the owner): everything into the private area (`adopt`) or deleted for
	 * good (`delete`, with the typed name). Afterwards the household is gone; the area becomes
	 * "Privat" and the notice says what happened.
	 */
	async dissolve(mode: DissolveMode, name: string): Promise<FieldOutcome> {
		const dissolve = this.#data.dissolve;
		if (dissolve === undefined) return { ok: false, message: '' };
		const answer = await this.#run({ kind: 'dissolve' }, () =>
			dissolve({ mode, ...(mode === 'delete' && { name }) }, this.#options())
		);
		if (answer.kind !== 'ok') return { ok: false, message: this.#dissolveText(answer) };
		this.#apply(null, {
			title: DISSOLVE_TEXTS.done(answer.value.household.name),
			text: mode === 'adopt' ? DISSOLVE_TEXTS.doneAdopt : DISSOLVE_TEXTS.doneDelete
		});
		return { ok: true };
	}

	#dissolveText(
		answer: Exclude<HouseholdAnswer<unknown>, { kind: 'ok' }> | { kind: 'failed'; message: string }
	): string {
		return answer.kind === 'invalid' ? moveProblemText(answer.problem) : this.#textOf(answer);
	}

	/**
	 * Takes a new state. When the household of this tab changes against the one it knew, the layout
	 * loads anew with `notice`, or with the text for a change elsewhere.
	 */
	#apply(next: State, notice: HouseholdNotice | null): void {
		const before = this.#current;
		const known = this.#known;
		const dissolved = this.#dissolved;
		this.#dissolved = false;
		this.#current = next;
		// A message of loading goes; the refusal of an action stays until the next action.
		if (this.#state !== 'ready') this.#message = null;
		this.#state = 'ready';
		const id = next?.household.id ?? null;
		this.#known = id;
		if (known === undefined || known === id) return;
		this.#shown = null;
		this.#membershipChanged(notice ?? this.#lostNotice(id, before, dissolved));
	}

	/** What a tab says when the household changed elsewhere: lost, dissolved (E7-4) or changed. */
	#lostNotice(id: string | null, before: State, dissolved: boolean): HouseholdNotice {
		if (id !== null || before === null) return { title: HOUSEHOLD_TEXTS.changed };
		return {
			title: dissolved
				? DISSOLVE_TEXTS.dissolved(before.household.name)
				: HOUSEHOLD_TEXTS.lost(before.household.name)
		};
	}

	#options(): RequestOptions {
		return { signal: this.#actions.signal };
	}

	/** One action at a time; a lost session signs out, other failures count as refusals. */
	async #run<T>(
		busy: Exclude<HouseholdBusy, null>,
		call: () => Promise<HouseholdAnswer<T>>
	): Promise<HouseholdAnswer<T> | { kind: 'failed'; message: string }> {
		if (this.#busy !== null || !this.#session.ensureValid()) return { kind: 'failed', message: '' };
		this.#busy = busy;
		this.#message = null;
		try {
			return await call();
		} catch (error) {
			const failure = toDataError(error, this.#actions.signal);
			if (failure.kind === 'session') this.#session.logout();
			return {
				kind: 'failed',
				message: failure.kind === 'aborted' || failure.kind === 'session' ? '' : failure.message
			};
		} finally {
			this.#busy = null;
		}
	}

	#textOf(
		answer: Exclude<HouseholdAnswer<unknown>, { kind: 'ok' }> | { kind: 'failed'; message: string }
	): string {
		switch (answer.kind) {
			case 'invalid':
				return problemText(answer.problem);
			case 'rate':
				return HOUSEHOLD_TEXTS.rate;
			case 'missing':
				return restartNeeded('Der Haushalt ist');
			default:
				return answer.message;
		}
	}

	#fieldFailure(
		answer: Exclude<HouseholdAnswer<unknown>, { kind: 'ok' }> | { kind: 'failed'; message: string }
	): FieldOutcome {
		return { ok: false, message: this.#textOf(answer) };
	}

	#refused(
		answer: Exclude<HouseholdAnswer<unknown>, { kind: 'ok' }> | { kind: 'failed'; message: string }
	): false {
		const text = this.#textOf(answer);
		if (text !== '') this.#message = { title: REFUSED_TITLE, text };
		// A refusal says the page knew too much: read the household again.
		if (answer.kind === 'invalid') void this.load();
		return false;
	}
}

const [getHouseholdStore, setHouseholdStore, hasHouseholdStore] = createContext<HouseholdStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findHouseholdStore(): HouseholdStore | null {
	return hasHouseholdStore() ? getHouseholdStore() : null;
}

export { getHouseholdStore, setHouseholdStore };
