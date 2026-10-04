// "In den Haushalt verschieben …" and "Ins Private verschieben …" (E7-4, ADR-0060): one store in the
// (app) layout for every menu (ticket, project, rule, entry of the inbox) and the bulk action of the
// table "Aufgaben". Opening a move loads the preview of the server (nothing changes yet); the dialog
// shows what moves and asks the choices the preview needs; "Mitnehmen" of dependencies loads the
// preview again, because more tickets come along. The move itself is one request; a success goes out
// as a flag, and the layout follows it (`moved`): the moved tickets leave the list at once, and a tab
// that shows a moved record follows it into its area. One move at a time.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { moveRecords, type MoveAnswer } from '$lib/data/area-move';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	MOVE_TEXTS,
	choiceErrors,
	initialChoices,
	moveBody,
	moveProblemText,
	type DependencyChoice,
	type MoveChoices,
	type MoveDirection,
	type MoveKind,
	type MovePreview
} from '$lib/domain/area-move';
import { restartNeeded } from '$lib/guidance/texts';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';

export interface AreaMoveData {
	move(body: Record<string, unknown>, options: RequestOptions): Promise<MoveAnswer<MovePreview>>;
}

export function areaMoveData(pb: PocketBase): AreaMoveData {
	return { move: (body, options) => moveRecords(pb, body, options) };
}

/** What a menu or the bulk action asks to move. */
export interface MoveRequest {
	kind: MoveKind;
	ids: readonly string[];
	to: MoveDirection;
	/** How the dialog and the flag name it: "HAUS-12", "Projekt „Haus“", "3 Tickets". */
	label: string;
	/** Inside a modal (the full view) the owner shows the dialog inline (ADR-0025 addendum 16). */
	inline?: boolean;
}

export type MoveState = 'idle' | 'loading' | 'ready' | 'running';

type Dependencies = MovePreview['conflicts']['dependencies'];

export class AreaMoveStore {
	readonly #data: AreaMoveData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #moved: (result: MovePreview, request: MoveRequest) => void;
	#controller: AbortController | null = null;

	#request = $state.raw<MoveRequest | null>(null);
	#preview = $state.raw<MovePreview | null>(null);
	#choices = $state.raw<MoveChoices>({ project: null, dependencies: null, codes: {} });
	#state = $state<MoveState>('idle');
	#message = $state<string | null>(null);
	/** The dependencies across the border of the first preview: the choice stays after "Mitnehmen". */
	#dependencies = $state.raw<Dependencies>([]);

	constructor(
		data: AreaMoveData,
		session: SessionGuard,
		flags: FlagSink = SILENT_FLAGS,
		moved: (result: MovePreview, request: MoveRequest) => void = () => undefined
	) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
		this.#moved = moved;
	}

	get request(): MoveRequest | null {
		return this.#request;
	}

	get preview(): MovePreview | null {
		return this.#preview;
	}

	get choices(): MoveChoices {
		return this.#choices;
	}

	get state(): MoveState {
		return this.#state;
	}

	/** Why the preview or the move did not work; null while all is fine. */
	get message(): string | null {
		return this.#message;
	}

	/** Dependencies with tickets that stay behind (ADR-0060 §2), as the first preview named them. */
	get dependencies(): Dependencies {
		return this.#dependencies;
	}

	/** What the choices still lack, by field; empty when the move may run. */
	get errors(): Record<string, string> {
		const preview = this.#preview;
		return preview === null
			? {}
			: choiceErrors(preview, this.#choices, this.#dependencies.length > 0);
	}

	/** Opens the dialog of a move and loads its preview. */
	open(request: MoveRequest): void {
		this.close();
		this.#request = request;
		void this.#load(true);
	}

	/** Closes the dialog; a running preview is dropped (a running move finishes on the server). */
	close(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#request = null;
		this.#preview = null;
		this.#choices = { project: null, dependencies: null, codes: {} };
		this.#dependencies = [];
		this.#message = null;
		this.#state = 'idle';
	}

	chooseProject(project: string): void {
		this.#choices = { ...this.#choices, project };
	}

	/** "Mitnehmen" or "Verknüpfung lösen": the preview follows, with the tickets that come along. */
	chooseDependencies(choice: DependencyChoice): void {
		this.#choices = { ...this.#choices, dependencies: choice };
		void this.#load(false);
	}

	setCode(projectId: string, code: string): void {
		this.#choices = { ...this.#choices, codes: { ...this.#choices.codes, [projectId]: code } };
	}

	/** The move; true when it ran (the dialog closes then). */
	async run(): Promise<boolean> {
		const request = this.#request;
		if (request === null || this.#state !== 'ready' || Object.keys(this.errors).length > 0) {
			return false;
		}
		const answer = await this.#ask(request, false);
		if (answer === null) return false;
		const label = request.label;
		const single = answer.moved?.tickets.length === 1 ? answer.moved.tickets[0] : undefined;
		this.#flags.show({
			tone: 'success',
			title: MOVE_TEXTS.done(label, request.to),
			...(request.kind === 'ticket' &&
				single !== undefined && { description: MOVE_TEXTS.newKey(single.key) })
		});
		this.close();
		this.#moved(answer, request);
		return true;
	}

	async #load(first: boolean): Promise<void> {
		const request = this.#request;
		if (request === null) return;
		const answer = await this.#ask(request, true);
		if (answer === null || this.#request !== request) return;
		this.#preview = answer;
		if (first) {
			this.#choices = { ...initialChoices(answer), dependencies: null };
			this.#dependencies = answer.conflicts.dependencies;
		}
	}

	/** One request at a time; the answer, or null with the reason as message. */
	async #ask(request: MoveRequest, preview: boolean): Promise<MovePreview | null> {
		if (!this.#session.ensureValid()) return null;
		this.#controller?.abort();
		const controller = new AbortController();
		this.#controller = controller;
		this.#state = preview ? 'loading' : 'running';
		this.#message = null;
		try {
			const answer = await this.#data.move(moveBody(request, this.#choices, preview), {
				signal: controller.signal
			});
			if (controller.signal.aborted) return null;
			if (answer.kind === 'ok') return answer.value;
			this.#message =
				answer.kind === 'missing'
					? restartNeeded('Das Verschieben ist')
					: moveProblemText(answer.problem);
			return null;
		} catch (error) {
			const failure = toDataError(error, controller.signal);
			if (failure.kind === 'session') this.#session.logout();
			else if (failure.kind !== 'aborted') this.#message = failure.message;
			return null;
		} finally {
			if (this.#controller === controller) {
				this.#controller = null;
				this.#state = this.#request === null ? 'idle' : 'ready';
			}
		}
	}
}

const [getAreaMoveStore, setAreaMoveStore, hasAreaMoveStore] = createContext<AreaMoveStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findAreaMoveStore(): AreaMoveStore | null {
	return hasAreaMoveStore() ? getAreaMoveStore() : null;
}

export { getAreaMoveStore, setAreaMoveStore };
