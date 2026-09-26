// "Erste Schritte" (ADR-0026 section 7, plan EH-12, user decision 3): a short checklist in the empty
// state of "Aufgaben". What is done is remembered on this device only (localStorage), as the user
// can dismiss the list; the steps "ticket", "project" and "channel" are marked from data the app
// sees, "quick" and "tour" when the user opens them. Pure module: parsing, progress, visibility.

export type FirstStepId = 'ticket' | 'quick' | 'channel' | 'project' | 'tour';

export interface FirstStep {
	readonly id: FirstStepId;
	readonly label: string;
}

/** The steps in their order. "tour" is only offered where the tour can be started (EH-13). */
export const FIRST_STEPS: readonly FirstStep[] = [
	{ id: 'ticket', label: 'Erstes Ticket anlegen' },
	{ id: 'quick', label: 'Schnellerfassung ausprobieren' },
	{ id: 'channel', label: 'Einen Kanal einrichten' },
	{ id: 'project', label: 'Ein Projekt anlegen' },
	{ id: 'tour', label: 'Kurze Einführung starten' }
];

export const FIRST_STEP_IDS: readonly FirstStepId[] = FIRST_STEPS.map((step) => step.id);

/** localStorage key; the value is JSON {"dismissed": boolean, "reached": FirstStepId[]}. */
export const FIRST_STEPS_STORAGE_KEY = 'byl-first-steps';

export interface FirstStepsState {
	readonly dismissed: boolean;
	readonly reached: readonly FirstStepId[];
}

export const EMPTY_FIRST_STEPS: FirstStepsState = { dismissed: false, reached: [] };

function isStepId(value: unknown): value is FirstStepId {
	return typeof value === 'string' && (FIRST_STEP_IDS as readonly string[]).includes(value);
}

/**
 * Reads the stored value. Anything unexpected (no value, broken JSON, wrong types, unknown steps)
 * falls back to the empty state or drops the unknown part; the value is never trusted blindly.
 */
export function parseFirstSteps(raw: string | null | undefined): FirstStepsState {
	if (raw === null || raw === undefined || raw === '') return EMPTY_FIRST_STEPS;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return EMPTY_FIRST_STEPS;
	}
	if (typeof value !== 'object' || value === null) return EMPTY_FIRST_STEPS;
	const record = value as Record<string, unknown>;
	const reached = Array.isArray(record.reached)
		? FIRST_STEP_IDS.filter((id) => (record.reached as unknown[]).some((entry) => entry === id))
		: [];
	return { dismissed: record.dismissed === true, reached: reached.filter(isStepId) };
}

export function serializeFirstSteps(state: FirstStepsState): string {
	return JSON.stringify({ dismissed: state.dismissed, reached: [...state.reached] });
}

/** The state with `id` reached; the same object if it was reached already. */
export function reachStep(state: FirstStepsState, id: FirstStepId): FirstStepsState {
	if (state.reached.includes(id)) return state;
	return {
		...state,
		reached: FIRST_STEP_IDS.filter((step) => step === id || state.reached.includes(step))
	};
}

export interface FirstStepsProgress {
	readonly items: readonly (FirstStep & { readonly done: boolean })[];
	readonly done: number;
	readonly total: number;
	readonly complete: boolean;
}

/** Progress over the steps offered here (`available`, in the order of FIRST_STEPS). */
export function firstStepsProgress(
	state: FirstStepsState,
	available: readonly FirstStepId[]
): FirstStepsProgress {
	const items = FIRST_STEPS.filter((step) => available.includes(step.id)).map((step) => ({
		...step,
		done: state.reached.includes(step.id)
	}));
	const done = items.filter((item) => item.done).length;
	return { items, done, total: items.length, complete: items.length > 0 && done === items.length };
}

/** The list shows until the user dismisses it or every offered step is done. */
export function showsFirstSteps(
	state: FirstStepsState,
	available: readonly FirstStepId[]
): boolean {
	return !state.dismissed && !firstStepsProgress(state, available).complete;
}

/** "2 von 4 erledigt". */
export function progressText(progress: Pick<FirstStepsProgress, 'done' | 'total'>): string {
	return `${progress.done} von ${progress.total} erledigt`;
}
