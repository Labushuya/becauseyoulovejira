<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { NOBODY_LABEL } from '$lib/domain/assignee';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { inheritLabel, projectColorOf, type ProjectColor } from '$lib/domain/colors';
	import { berlinDateOf, formatBerlinDateTime } from '$lib/domain/format';
	import type { InboxItemSummary, TicketPrefill } from '$lib/domain/inbox';
	import type { TargetPrefill } from '$lib/domain/target-project';
	import {
		INITIAL_STATUS_REQUIRED,
		SERVER_FIELDS,
		defaultFormValues,
		formErrors,
		type RecurrenceFormField,
		type RecurrenceFormValues,
		type RepeatRequest
	} from '$lib/domain/recurrence-rule';
	import { suggestionFormValues, type RruleSuggestion } from '$lib/domain/rrule';
	import type { TemplateStatus, TemplateSubtask } from '$lib/domain/series-template';
	import { isPriority, isStatus, type Priority, type Status } from '$lib/domain/status';
	import {
		CREATE_SUBTASKS_MAX,
		moreOptionsLabel,
		moreOptionsSet,
		readMoreOpen,
		writeMoreOpen,
		type CreateField,
		type TicketExtras
	} from '$lib/domain/ticket-create';
	import { newTicketParentRules } from '$lib/domain/ticket-picker';
	import {
		DEFAULT_PRIORITY,
		DEFAULT_STATUS,
		DESCRIPTION_MAX_LENGTH,
		TITLE_MAX_LENGTH,
		type ProjectRef,
		type TagRef,
		type TicketDraft,
		type TicketSummary
	} from '$lib/domain/ticket';
	import { restartNeeded } from '$lib/guidance/texts';
	import { findAreaStore } from '$lib/stores/area.svelte';
	import { findAssignees, type AssigneeSource } from '$lib/stores/assignees.svelte';
	import type { EnsureTagResult } from '$lib/stores/catalog.svelte';
	import type { CreateResult } from '$lib/stores/ticket-detail.svelte';
	import {
		findTicketPickerSource,
		type TicketPickerSource
	} from '$lib/stores/ticket-picker.svelte';
	import BlocksParentSwitch from './BlocksParentSwitch.svelte';
	import CharmPicker from './CharmPicker.svelte';
	import ColorChoice from './ColorChoice.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import Field from './form/Field.svelte';
	import InboxEntryChoice from './InboxEntryChoice.svelte';
	import InitialStatusChoice from './InitialStatusChoice.svelte';
	import KindSwitch from './KindSwitch.svelte';
	import RichTextEditor from './RichTextEditor.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import PrioritySelect from './PrioritySelect.svelte';
	import ProjectSelect from './ProjectSelect.svelte';
	import RecurrenceForm from './RecurrenceForm.svelte';
	import StatusSelect from './StatusSelect.svelte';
	import TagPicker from './TagPicker.svelte';
	import TemplateSubtaskList from './TemplateSubtaskList.svelte';
	import TicketPicker from './TicketPicker.svelte';
	import TicketSourceChoice from './TicketSourceChoice.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';
	import Drawer from './overlay/Drawer.svelte';

	// "Neues Ticket" in the side panel (E2 plan, T-8 and package 8; E3 plan, T-13 and T-14; NT-1,
	// ADR-0069). Everything that can be set at a ticket can be set here already, except what needs an
	// existing ticket (the registry domain/ticket-options.ts names each option with its place or its
	// reason, ticket-options-parity.test.ts holds both in line).
	//
	// On top the main fields of before: title (required, focused), status "Offen", priority "Mittel",
	// due date, in a tab of the household "Zuständig" ("Niemand" or a member, "Mir" as one click,
	// ADR-0068), project, charm (ADR-0062), tags and description (the editor of ADR-0032). Title and
	// Enter create at once. Below them the area "Weitere Optionen" (a disclosure button as heading,
	// open or closed per device in localStorage `byl-new-ticket-more`) with every other option in the
	// order of the detail: "Anheften" (ADR-0064), "Zum Tagesplan" of today (ADR-0065), "Farbe"
	// (ADR-0052, "Wie Projekt" with the color of the chosen project first and chosen), "Laufendes
	// Vorhaben" (ADR-0065), the parent with "Blockiert das übergeordnete Ticket" (ADR-0033),
	// "Wiederholen" (plan OR-4), the sub-tasks (ADR-0033) and the sources: new entries of the inbox
	// (ADR-0031) and tickets it stems from (ADR-0067). Options that differ from a new ticket are
	// counted in the heading, "Weitere Optionen (2 gesetzt)". The fields are the building blocks of the
	// detail (ColorChoice, KindSwitch, BlocksParentSwitch, TicketPicker, TemplateSubtaskList,
	// InboxEntryChoice, RecurrenceForm). The route creates everything in one request (one transaction
	// of the server); a refusal stands at its field, and a field under "Weitere Optionen" opens the
	// area for it. A server before its restart after NT-1 does not know that request
	// (`extrasAvailable` false): then the area offers only color and "Wiederholen" as before and says
	// when the rest comes.
	//
	// "Anlegen" or Ctrl+Enter creates; the button is locked during the request, so a double click
	// creates one ticket. "Abbrechen" and Escape ask first through the confirmation (ADR-0025 section
	// 4) if something was entered, a name in the tag picker included. From the inbox (E4 plan, T-5)
	// title and description come filled in; the date at the sender is only a hint with "Als Fälligkeit
	// übernehmen" (P-5). An entry the user typed in brings the project, tags, priority and due date
	// chosen then; an entry from a way with a target project (ADR-0049 §4) brings that project, unless
	// it is archived or deleted, and the hint below "Projekt" says which and why.
	//
	// Repeating right away (plan OR-4): the folded section "Wiederholen" holds the fields of a rhythm
	// with the preview, starting on the due date or today; only an open section creates a rule, with the
	// ticket as its first instance. Folding keeps the values for this form; untouched default values
	// follow a changed due date. After the migration of "Status beim Anlegen" the open section asks
	// "Folgetickets starten mit" (ADR-0022 addendum 9): required, nothing chosen in advance. With
	// sub-tasks it offers to give them to every next ticket of the series as well (plan WV-3). A
	// calendar series (E5 plan, package 6; ADR-0024 section 1) shows its rhythm with "Als Wiederholung
	// übernehmen"; that click opens "Weitere Optionen" and the section with the suggested values. A
	// series the rules cannot express gets a neutral hint. Nothing is set without a click (P-5).
	let {
		projects = [],
		initialProject = null,
		prefill = null,
		target = null,
		sourceLabel = null,
		suggestion = null,
		repeat = false,
		eachAvailable = false,
		statusAvailable = false,
		subtasksAvailable = false,
		colorsAvailable = false,
		charmsAvailable = false,
		assignmentAvailable = false,
		extrasAvailable = false,
		kindAvailable = false,
		pinAvailable = false,
		dayPlanAvailable = false,
		ticketSourcesAvailable = false,
		candidates = [],
		picker = findTicketPickerSource(),
		scope = findAreaStore()?.key ?? null,
		storage = browserStorage(),
		assignees = findAssignees(),
		today = null,
		tags = [],
		oncreatetag = async () => ({ ok: false, message: null }),
		oncreate,
		oncreated,
		oncancel
	}: {
		/** Projects that can be chosen (the active ones). */
		projects?: readonly ProjectRef[];
		/** Project chosen in advance (list filter); ignored unless it is among `projects`. */
		initialProject?: string | null;
		/** Values of an inbox entry (E4 plan, T-5); read once when the form opens. */
		prefill?: TicketPrefill | null;
		/** Target project of the entry (ADR-0049 §4), from the catalog as it loads. */
		target?: TargetPrefill | null;
		/** Way the entry came in, e.g. "Mail-Datei", shown under the heading. */
		sourceLabel?: string | null;
		/** Suggestion from the RRULE of the entry (rrule.ts); null without a series. */
		suggestion?: RruleSuggestion | null;
		/** Rules are available (after the E5 migration): the section "Wiederholen" is offered. */
		repeat?: boolean;
		/** Offer "Jeden Termin einzeln anlegen" in the section (plan OR-5). */
		eachAvailable?: boolean;
		/** Ask "Folgetickets starten mit" in the section (RecurrenceStore.statusReady). */
		statusAvailable?: boolean;
		/** The sub-tasks of the template of a rule are known (plan WV-3, RecurrenceStore.subtasksReady). */
		subtasksAvailable?: boolean;
		/** Offer the own color of the ticket (ADR-0052, CatalogStore.colorsReady). */
		colorsAvailable?: boolean;
		/** Offer the charm of the ticket (ADR-0062, RecurrenceStore.charmsReady). */
		charmsAvailable?: boolean;
		/**
		 * The server knows "Zuständig" of tickets and rules (one migration, ADR-0068;
		 * RecurrenceStore.assigneesReady): offer the field of the ticket and "Zuständigkeit" of the next
		 * tickets in a household.
		 */
		assignmentAvailable?: boolean;
		/**
		 * The server creates with everything at once (NT-1): parent, sub-tasks and sources are offered;
		 * false before its restart after NT-1.
		 */
		extrasAvailable?: boolean;
		/** The server knows "Laufendes Vorhaben" (ADR-0065). */
		kindAvailable?: boolean;
		/** "Anheften" is offered (the pins of the account are loaded, ADR-0064). */
		pinAvailable?: boolean;
		/** "Zum Tagesplan" is offered (ADR-0065). */
		dayPlanAvailable?: boolean;
		/** Tickets as sources are known (ADR-0067). */
		ticketSourcesAvailable?: boolean;
		/** New entries of the inbox that may become sources (without the one converted here). */
		candidates?: readonly InboxItemSummary[];
		/** Tickets of the pickers of parent and sources; the (app) layout provides them. */
		picker?: TicketPickerSource | null;
		/** The area the ticket is created in (`u:…` or `h:…`), for the pickers. */
		scope?: string | null;
		/** Where "Weitere Optionen" is remembered (localStorage of the device). */
		storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
		/** The members and names of the household (the directory of the layout). */
		assignees?: AssigneeSource | null;
		/** Berlin date of today, for the preview of the section "Wiederholung". */
		today?: CalendarDate | null;
		/** Tags that can be chosen (the catalog). */
		tags?: readonly TagRef[];
		/** Existing or new tag for a typed name (T-14). */
		oncreatetag?: (name: string) => Promise<EnsureTagResult>;
		/**
		 * Creates the ticket; `recurrence` holds the values of the open section "Wiederholen" and the
		 * answer to "Folgetickets starten mit", `extras` what "Weitere Optionen" adds.
		 */
		oncreate: (
			draft: TicketDraft,
			recurrence: RepeatRequest | null,
			extras: TicketExtras
		) => Promise<CreateResult>;
		oncreated: (id: string) => void;
		oncancel: () => void;
	} = $props();

	/** The localStorage of the browser, null where there is none or it is blocked. */
	function browserStorage(): Storage | null {
		try {
			return typeof window === 'undefined' ? null : window.localStorage;
		} catch {
			return null;
		}
	}

	/** The question before entered data is lost; "Weiter bearbeiten" keeps it. */
	let confirmingDiscard = $state(false);

	const uid = $props.id();
	const ids = {
		form: `${uid}-form`,
		heading: `${uid}-heading`,
		title: `${uid}-title`,
		titleHint: `${uid}-title-hint`,
		titleError: `${uid}-title-error`,
		status: `${uid}-status`,
		priority: `${uid}-priority`,
		due: `${uid}-due`,
		sourceDate: `${uid}-source-date`,
		dueError: `${uid}-due-error`,
		project: `${uid}-project`,
		projectHint: `${uid}-project-hint`,
		projectError: `${uid}-project-error`,
		color: `${uid}-color`,
		colorError: `${uid}-color-error`,
		charmError: `${uid}-charm-error`,
		tags: `${uid}-tags`,
		tagsError: `${uid}-tags-error`,
		description: `${uid}-description-error`,
		more: `${uid}-more`,
		moreBody: `${uid}-more-body`,
		recurrence: `${uid}-recurrence`,
		recurrenceBody: `${uid}-recurrence-body`,
		recurrenceError: `${uid}-recurrence-error`,
		assignee: `${uid}-assignee`,
		pinHint: `${uid}-pin-hint`,
		pinError: `${uid}-pin-error`,
		dayPlanHint: `${uid}-day-plan-hint`,
		dayPlanError: `${uid}-day-plan-error`,
		kind: `${uid}-kind`,
		parent: `${uid}-parent`,
		parentError: `${uid}-parent-error`,
		subtasksError: `${uid}-subtasks-error`,
		templateSubtasks: `${uid}-template-subtasks`,
		sources: `${uid}-sources`
	};

	// The form is opened for one entry (the route keys it), so the values are read once.
	const initialTitle = untrack(() => prefill?.title ?? '');
	const initialDescription = untrack(() => prefill?.description ?? '');
	const sourceDate = untrack(() => prefill?.sourceDate ?? null);
	// Values the user chose when typing the entry in (capture form, quick entry).
	const preset = untrack(() => prefill?.preset ?? null);
	const initialPriority: Priority = preset?.priority ?? DEFAULT_PRIORITY;
	const initialDue: string = preset?.due ?? '';
	const initialTagIds: readonly string[] = preset?.tagIds ?? [];

	let title = $state(initialTitle);
	let status = $state<Status>(DEFAULT_STATUS);
	let priority = $state<Priority>(initialPriority);
	let due = $state(initialDue);
	let dueInvalid = $state(false);
	let description = $state(initialDescription);
	/** Project chosen by the user; null until then, so a late catalog still sets the default. */
	let chosenProject = $state<string | null>(null);
	/** Own color (ADR-0052); null is "wie Projekt". */
	let color = $state<ProjectColor | null>(null);
	/** Charm (ADR-0062); null is none. */
	let charm = $state<string | null>(null);
	/** "Zuständig" (ADR-0068): a member, '' for "Niemand". */
	let assignee = $state('');
	let tagIds = $state<string[]>([...initialTagIds]);
	let tagText = $state('');
	let tagError = $state<string | null>(null);
	let pending = $state(false);
	let message = $state<string | null>(null);
	let fieldErrors = $state<Partial<Record<CreateField, string>>>({});
	let titleInput = $state<HTMLInputElement>();
	let form = $state<HTMLFormElement>();

	// "Weitere Optionen" (NT-1).
	let moreOpen = $state(untrack(() => readMoreOpen(storage)));
	let pin = $state(false);
	let dayPlan = $state(false);
	let ongoing = $state(false);
	let parent = $state<TicketSummary | null>(null);
	let blocksParent = $state(true);
	let subtasks = $state<TemplateSubtask[]>([]);
	/** Rows of the sub-tasks refused for a missing title; marked until they have one. */
	let invalidSubtasks = $state<number[]>([]);
	let sources = $state<string[]>([]);
	let ticketSources = $state<TicketSummary[]>([]);
	/** The sub-tasks go into the template of the series as well (plan WV-3). */
	let templateSubtasks = $state(false);
	/** Row of a list a refusal of the server names. */
	let errorIndex = $state<Partial<Record<'subtasks' | 'ticketSources' | 'sources', number>>>({});

	/**
	 * Values of the section "Wiederholen"; null until it is opened the first time. They stay while
	 * the section is folded; only an open section creates a rule.
	 */
	let recurrence = $state<{ values: RecurrenceFormValues } | null>(null);
	let repeatOpen = $state(false);
	/** Due date the default values were made for; null once they came from a suggestion. */
	let defaultsFor: string | null = null;
	let recurrenceErrors = $state<Partial<Record<RecurrenceFormField, string>>>({});
	/** Answer to "Folgetickets starten mit"; '' while none is given. */
	let repeatStatus = $state<TemplateStatus | ''>('');
	let repeatStatusError = $state<string | null>(null);
	let recurrenceSection = $state<HTMLElement>();
	let repeatToggle = $state<HTMLButtonElement>();
	const ruleSuggestion = $derived(suggestion?.kind === 'rule' ? suggestion : null);
	const unsupported = $derived(suggestion?.kind === 'unsupported' ? suggestion : null);
	/** The section is offered with rules available (or with a suggestion) and a known date. */
	const canRepeat = $derived(today !== null && (repeat || ruleSuggestion !== null));

	// The target project of the way the entry came (ADR-0049 §4); a preset of the user wins. It
	// follows a late catalog like the default project.
	const wantedProject = $derived(preset?.project ?? target?.project ?? initialProject);
	/** Hint below "Projekt": why the target project is (not) chosen in advance, unless a preset won. */
	const projectHint = $derived(
		(preset?.project ?? null) === null ? (target?.hint ?? undefined) : undefined
	);
	const defaultProject = $derived(
		wantedProject !== null && projects.some((entry) => entry.id === wantedProject)
			? wantedProject
			: ''
	);
	const project = $derived(chosenProject ?? defaultProject);
	/** The color the ticket shows without an own one: of the chosen project or its parent. */
	const inherited = $derived(
		projectColorOf(projects.find((entry) => entry.id === project) ?? null)?.color ?? null
	);
	/** Chosen tags from the catalog; a new tag is in it before it is chosen. */
	const chosenTags = $derived(
		tagIds.flatMap((tagId) => {
			const tag = tags.find((entry) => entry.id === tagId);
			return tag === undefined ? [] : [tag];
		})
	);
	/** "Zuständig" only in a tab of the household, once the server and the members are known. */
	const assigneeShown = $derived(
		assignmentAvailable && assignees !== null && assignees.active && assignees.members.length > 0
	);
	const members = $derived(assigneeShown && assignees !== null ? assignees.members : []);
	const selfId = $derived(assignees?.context.selfId ?? null);
	const selfIsMember = $derived(members.some((member) => member.id === selfId));
	/** The assignee that is shown and sent: a current member, else nobody. */
	const chosenAssignee = $derived(members.some((member) => member.id === assignee) ? assignee : '');
	const tagsError = $derived(tagError ?? fieldErrors.tags ?? null);
	const missingTitle = $derived(title.trim() === '');

	// What "Weitere Optionen" offers.
	const pinShown = $derived(extrasAvailable && pinAvailable);
	const dayPlanShown = $derived(extrasAvailable && dayPlanAvailable);
	const kindShown = $derived(extrasAvailable && kindAvailable);
	const parentShown = $derived(extrasAvailable && picker !== null);
	const subtasksShown = $derived(extrasAvailable);
	const sourcesShown = $derived(extrasAvailable);
	const ticketSourcesShown = $derived(extrasAvailable && ticketSourcesAvailable && picker !== null);
	/** A done ticket is never pinned nor planned (ADR-0064, ADR-0065). */
	const isDone = $derived(status === 'done');
	const parentRules = $derived(newTicketParentRules(scope));
	const filledSubtasks = $derived(subtasks.filter((entry) => entry.title.trim() !== ''));
	const moreCount = $derived(
		moreOptionsSet({
			pin: pinShown && pin,
			dayPlan: dayPlanShown && dayPlan,
			color: colorsAvailable ? color : null,
			ongoing: kindShown && ongoing,
			parent: parentShown && parent !== null,
			recurrence: canRepeat && repeatOpen,
			subtasks: subtasksShown ? subtasks.length : 0,
			sources: sourcesShown ? sources.length : 0,
			ticketSources: ticketSourcesShown ? ticketSources.length : 0
		})
	);

	const dirty = $derived(
		title !== initialTitle ||
			description !== initialDescription ||
			due !== initialDue ||
			dueInvalid ||
			status !== DEFAULT_STATUS ||
			priority !== initialPriority ||
			project !== defaultProject ||
			color !== null ||
			charm !== null ||
			chosenAssignee !== '' ||
			tagIds.join(',') !== initialTagIds.join(',') ||
			tagText.trim() !== '' ||
			repeatOpen ||
			pin ||
			dayPlan ||
			ongoing ||
			parent !== null ||
			subtasks.length > 0 ||
			sources.length > 0 ||
			ticketSources.length > 0
	);
	const dueError = $derived(dueInvalid ? 'Ungültiges Datum.' : (fieldErrors.due ?? null));

	$effect(() => {
		titleInput?.focus();
	});

	/** Fields under "Weitere Optionen": an error there opens the area. */
	const MORE_FIELDS: readonly CreateField[] = [
		'pin',
		'dayPlan',
		'color',
		'kind',
		'parent',
		'blocksParent',
		'recurrence',
		'initialStatus',
		'templateSubtasks',
		'subtasks',
		'ticketSources',
		'sources'
	];
	const RECURRENCE_FIELDS = Object.keys(SERVER_FIELDS) as RecurrenceFormField[];

	/** Opens "Weitere Optionen" for this form, without remembering it (an error, a suggestion). */
	function revealMore() {
		moreOpen = true;
	}

	/** The disclosure "Weitere Optionen": the choice is remembered on this device. */
	function toggleMore() {
		moreOpen = !moreOpen;
		writeMoreOpen(storage, moreOpen);
	}

	/** Focus on the first marked field, after the DOM shows the errors. */
	async function focusInvalid(scopeElement: HTMLElement | undefined) {
		await tick();
		scopeElement?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	}

	async function submit(event?: Event) {
		event?.preventDefault();
		if (pending) return;
		if (missingTitle || dueInvalid) {
			if (missingTitle) titleInput?.focus();
			return;
		}
		const emptyRows = subtasksShown
			? subtasks.flatMap((entry, index) => (entry.title.trim() === '' ? [index] : []))
			: [];
		if (emptyRows.length > 0) {
			invalidSubtasks = emptyRows;
			revealMore();
			await focusInvalid(form);
			return;
		}
		invalidSubtasks = [];
		const rhythm = canRepeat && repeatOpen && recurrence !== null ? recurrence.values : null;
		if (rhythm !== null) {
			recurrenceErrors = formErrors(rhythm);
			repeatStatusError = statusAvailable && repeatStatus === '' ? INITIAL_STATUS_REQUIRED : null;
			if (Object.keys(recurrenceErrors).length > 0 || repeatStatusError !== null) {
				revealMore();
				await focusInvalid(recurrenceSection);
				return;
			}
		}
		pending = true;
		message = null;
		fieldErrors = {};
		errorIndex = {};
		const result = await oncreate(
			{
				title,
				description,
				status,
				priority,
				due: due === '' ? null : (due as CalendarDate),
				project: project === '' ? null : project,
				// Only tags the catalog knows: a preset may name a tag deleted since.
				tags: chosenTags.map((tag) => tag.id),
				// Only an own color goes along (ADR-0052); none is "wie Projekt".
				...(colorsAvailable && color !== null && { color }),
				// Only a chosen charm goes along (ADR-0062).
				...(charmsAvailable && charm !== null && { charm }),
				// Only a chosen member goes along (ADR-0068); "Niemand" sends no field.
				...(chosenAssignee !== '' && { assignee: chosenAssignee }),
				// "Laufendes Vorhaben" (ADR-0065); a task sends nothing.
				...(kindShown && ongoing && { kind: 'ongoing' as const }),
				// A sub-task (ADR-0033), blocking its parent unless switched off.
				...(parentShown && parent !== null && { parent: parent.id }),
				...(parentShown && parent !== null && !blocksParent && { blocksParent: false })
			},
			rhythm === null
				? null
				: {
						values: rhythm,
						initialStatus: statusAvailable && repeatStatus !== '' ? repeatStatus : null
					},
			{
				subtasks: subtasksShown
					? filledSubtasks.map((entry) => ({ title: entry.title.trim(), priority: entry.priority }))
					: [],
				ticketSources: ticketSourcesShown ? ticketSources.map((ticket) => ticket.id) : [],
				sources: sourcesShown ? [...sources] : [],
				pin: pinShown && pin && !isDone,
				dayPlan: dayPlanShown && dayPlan && !isDone,
				templateSubtasks:
					rhythm !== null && subtasksAvailable && templateSubtasks && filledSubtasks.length > 0
			}
		);
		if (result.ok) {
			oncreated(result.ticket.id);
			return;
		}
		pending = false;
		message = result.message;
		fieldErrors = result.fields;
		errorIndex = result.index ?? {};
		const ruleErrors: Partial<Record<RecurrenceFormField, string>> = {};
		for (const field of RECURRENCE_FIELDS) {
			const text = result.fields[field];
			if (text !== undefined) ruleErrors[field] = text;
		}
		recurrenceErrors = ruleErrors;
		if (result.fields.initialStatus) repeatStatusError = result.fields.initialStatus;
		if (result.fields.title) {
			titleInput?.focus();
			return;
		}
		const inMore = MORE_FIELDS.some((field) => result.fields[field] !== undefined);
		if (inMore || Object.keys(ruleErrors).length > 0) revealMore();
		await focusInvalid(form);
	}

	/** "Als Wiederholung übernehmen": opens the section with the suggested values. */
	async function takeOver() {
		if (ruleSuggestion === null) return;
		recurrence = { values: suggestionFormValues(ruleSuggestion.params) };
		defaultsFor = null;
		recurrenceErrors = {};
		repeatOpen = true;
		revealMore();
		await tick();
		repeatToggle?.focus();
	}

	function dueOrNull(value: string): CalendarDate | null {
		return value === '' ? null : (value as CalendarDate);
	}

	/** The values are still the defaults made for `defaultsFor` (nothing chosen by hand). */
	function untouchedDefaults(): boolean {
		return (
			recurrence !== null &&
			defaultsFor !== null &&
			today !== null &&
			JSON.stringify(recurrence.values) ===
				JSON.stringify(defaultFormValues(dueOrNull(defaultsFor), today))
		);
	}

	function useDefaults() {
		if (today === null) return;
		recurrence = { values: defaultFormValues(dueOrNull(due), today) };
		defaultsFor = due;
	}

	/**
	 * The disclosure "Wiederholen": opening shows the values of before, or the defaults (weekly on
	 * the weekday of the due date or of today, starting then, lead time 3); folding creates no rule.
	 */
	function toggleRepeat() {
		if (repeatOpen) {
			repeatOpen = false;
			recurrenceErrors = {};
			repeatStatusError = null;
			return;
		}
		if (recurrence === null || untouchedDefaults()) useDefaults();
		repeatOpen = true;
	}

	/** A new due date moves untouched default values along (weekday and start). */
	function dueChanged() {
		if (repeatOpen && untouchedDefaults() && !dueInvalid) useDefaults();
	}

	/** "Als Fälligkeit übernehmen": the Berlin calendar date of the date at the sender. */
	function takeSourceDate() {
		if (sourceDate === null) return;
		due = berlinDateOf(sourceDate);
		dueInvalid = false;
	}

	function addTag(tagId: string): boolean {
		if (!tagIds.includes(tagId)) tagIds = [...tagIds, tagId];
		tagError = null;
		return true;
	}

	async function createTag(name: string): Promise<boolean> {
		const result = await oncreatetag(name);
		if (!result.ok) {
			tagError = result.message;
			return false;
		}
		return addTag(result.tag.id);
	}

	function cancel() {
		if (pending) return;
		if (dirty) confirmingDiscard = true;
		else oncancel();
	}

	function onkeydown(event: KeyboardEvent) {
		if (confirmingDiscard) return;
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			void submit();
		}
	}

	/** Clears the error of a field once it changes. */
	function cleared(field: CreateField) {
		if (fieldErrors[field] === undefined) return;
		const rest = { ...fieldErrors };
		delete rest[field];
		fieldErrors = rest;
	}
</script>

<Drawer labelledby={ids.heading} closeFromFields onclose={cancel} {onkeydown}>
	{#snippet context()}
		{sourceLabel !== null ? `Aus dem Eingang (${sourceLabel})` : 'Aufgaben'}
	{/snippet}
	{#snippet footer()}
		<button class="button-secondary" type="button" onclick={cancel}>Abbrechen</button>
		<button
			class="button-primary"
			type="submit"
			form={ids.form}
			aria-disabled={missingTitle || pending ? 'true' : undefined}
			aria-busy={pending ? 'true' : undefined}
			aria-describedby={missingTitle ? ids.titleHint : undefined}
		>
			{pending ? 'Wird angelegt …' : 'Anlegen'}
		</button>
	{/snippet}
	<h2 id={ids.heading}>Neues Ticket</h2>

	<div aria-live="polite">
		{#if message}
			<p class="alert-error"><ErrorIcon /><span>{message}</span></p>
		{/if}
	</div>

	<form
		id={ids.form}
		class="form"
		novalidate
		aria-busy={pending ? 'true' : undefined}
		onsubmit={submit}
		bind:this={form}
	>
		<div class="field" data-ticket-option="title">
			<label for={ids.title}>Titel</label>
			<input
				id={ids.title}
				type="text"
				required
				aria-required="true"
				maxlength={TITLE_MAX_LENGTH}
				aria-invalid={fieldErrors.title ? 'true' : undefined}
				aria-describedby={fieldErrors.title ? ids.titleError : undefined}
				bind:value={title}
				bind:this={titleInput}
			/>
			{#if fieldErrors.title}
				<p class="field-error" id={ids.titleError}><ErrorIcon /><span>{fieldErrors.title}</span></p>
			{/if}
		</div>

		<div class="row">
			<div class="field" data-ticket-option="status">
				<label for={ids.status}>Status</label>
				<StatusSelect
					id={ids.status}
					value={status}
					disabled={pending}
					error={fieldErrors.status ?? null}
					errorId={`${ids.status}-error`}
					onchoose={(value) => {
						if (isStatus(value)) status = value;
					}}
				/>
			</div>
			<div class="field" data-ticket-option="priority">
				<label for={ids.priority}>Priorität</label>
				<PrioritySelect
					id={ids.priority}
					value={priority}
					disabled={pending}
					error={fieldErrors.priority ?? null}
					errorId={`${ids.priority}-error`}
					onchoose={(value) => {
						if (isPriority(value)) priority = value;
					}}
				/>
			</div>
			<div class="field" data-ticket-option="due">
				<label for={ids.due}>Fälligkeit</label>
				<input
					id={ids.due}
					type="date"
					aria-invalid={dueError ? 'true' : undefined}
					aria-describedby={dueError ? ids.dueError : undefined}
					bind:value={due}
					oninput={(event) => (dueInvalid = event.currentTarget.validity.badInput)}
					onchange={dueChanged}
				/>
			</div>
		</div>
		{#if sourceDate !== null}
			<p class="hint source-date" id={ids.sourceDate}>
				Quelldatum: {formatBerlinDateTime(sourceDate)}
				<button class="button-secondary button-small" type="button" onclick={takeSourceDate}>
					Als Fälligkeit übernehmen
				</button>
			</p>
		{/if}
		{#if dueError}
			<p class="field-error" id={ids.dueError}><ErrorIcon /><span>{dueError}</span></p>
		{/if}
		{#if assigneeShown}
			<div data-ticket-option="assignee">
				<Field label="Zuständig" id={ids.assignee} error={fieldErrors.assignee ?? ''} width="auto">
					{#snippet control(field)}
						<div class="assignee-row">
							<select
								{...field}
								value={chosenAssignee}
								disabled={pending}
								onchange={(event) => (assignee = event.currentTarget.value)}
							>
								<option value="">{NOBODY_LABEL}</option>
								{#each members as member (member.id)}
									<option value={member.id}
										>{member.self ? `${member.name} (ich)` : member.name}</option
									>
								{/each}
							</select>
							{#if selfId !== null && selfIsMember}
								<button
									class="button-secondary button-small"
									type="button"
									aria-disabled={chosenAssignee === selfId || pending ? 'true' : undefined}
									onclick={() => {
										if (!pending && selfId !== null) assignee = selfId;
									}}>Mir <span class="visually-hidden">zuweisen</span></button
								>
							{/if}
						</div>
					{/snippet}
				</Field>
			</div>
		{/if}
		{#if ruleSuggestion !== null}
			<SectionMessage tone="info">
				Dieser Termin wiederholt sich: {ruleSuggestion.text}.
				{#each ruleSuggestion.notes as note (note)}
					{note}
				{/each}
				{#snippet actions()}
					{#if !repeatOpen}
						<button class="button-secondary" type="button" onclick={takeOver}>
							Als Wiederholung übernehmen
						</button>
					{/if}
				{/snippet}
			</SectionMessage>
		{:else if unsupported !== null}
			<SectionMessage tone="info">
				Diese Serie lässt sich nicht als Regel übernehmen ({unsupported.reasons.join('; ')}). Nach
				dem Anlegen kannst du am Ticket „Wiederholen…“ wählen.
			</SectionMessage>
		{/if}

		<div class="field" data-ticket-option="project">
			<label for={ids.project}>Projekt</label>
			<ProjectSelect
				id={ids.project}
				value={project}
				{projects}
				disabled={pending}
				error={fieldErrors.project ?? null}
				errorId={ids.projectError}
				hintId={ids.projectHint}
				hint={projectHint}
				onchoose={(value) => (chosenProject = value)}
			/>
			{#if fieldErrors.project}
				<p class="field-error" id={ids.projectError}>
					<ErrorIcon /><span>{fieldErrors.project}</span>
				</p>
			{/if}
		</div>

		{#if charmsAvailable}
			<div class="field" data-ticket-option="charm">
				<span class="label">Charm</span>
				<CharmPicker
					value={charm}
					error={fieldErrors.charm ?? null}
					errorId={ids.charmError}
					onchoose={(value) => (charm = value)}
				/>
			</div>
		{/if}

		<div class="field" data-ticket-option="tags">
			<label for={ids.tags}>Tags</label>
			<TagPicker
				id={ids.tags}
				selected={chosenTags}
				{tags}
				bind:text={tagText}
				busy={pending}
				error={tagsError}
				errorId={ids.tagsError}
				onadd={addTag}
				onremove={(tagId) => {
					tagIds = tagIds.filter((entry) => entry !== tagId);
					return true;
				}}
				oncreate={createTag}
			/>
			{#if tagsError}
				<p class="field-error" id={ids.tagsError}><ErrorIcon /><span>{tagsError}</span></p>
			{/if}
		</div>

		<div class="description" data-ticket-option="description">
			<RichTextEditor
				label="Beschreibung"
				placeholder="Beschreibung eingeben …"
				maxlength={DESCRIPTION_MAX_LENGTH}
				bind:value={description}
				invalid={fieldErrors.description !== undefined}
				describedby={fieldErrors.description ? ids.description : undefined}
			/>
			{#if fieldErrors.description}
				<p class="field-error" id={ids.description}>
					<ErrorIcon /><span>{fieldErrors.description}</span>
				</p>
			{/if}
		</div>

		<section class="more" aria-labelledby={ids.more}>
			<h3 id={ids.more}>
				<button
					class="disclosure"
					type="button"
					aria-expanded={moreOpen}
					aria-controls={ids.moreBody}
					onclick={toggleMore}
				>
					<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
						<path d={moreOpen ? 'M3 4.5l3 3 3-3' : 'M4.5 3l3 3-3 3'} />
					</svg>
					{moreOptionsLabel(moreCount)}
				</button>
			</h3>
			<div class="more-body" id={ids.moreBody} hidden={!moreOpen} data-more-options>
				{#if !extrasAvailable}
					<SectionMessage tone="info" compact>
						{restartNeeded(
							'Unteraufgaben, Quellen, Übergeordnet, Art, Anheften und „Zum Tagesplan“ beim Anlegen sind'
						)}
					</SectionMessage>
				{/if}

				{#if pinShown}
					<div class="option" data-ticket-option="pin">
						<label class="switch-row">
							<span>Anheften</span>
							<input
								type="checkbox"
								role="switch"
								checked={pin && !isDone}
								disabled={isDone}
								aria-invalid={fieldErrors.pin ? 'true' : undefined}
								aria-describedby={fieldErrors.pin ? `${ids.pinHint} ${ids.pinError}` : ids.pinHint}
								onchange={(event) => {
									pin = event.currentTarget.checked;
									cleared('pin');
								}}
							/>
						</label>
						<p class="hint" id={ids.pinHint}>
							{isDone
								? 'Erledigte Tickets lassen sich nicht anheften.'
								: 'Steht für dich oben in „Aufgaben“ unter „Angeheftet“.'}
						</p>
						{#if fieldErrors.pin}
							<p class="field-error" id={ids.pinError}>
								<ErrorIcon /><span>{fieldErrors.pin}</span>
							</p>
						{/if}
					</div>
				{/if}

				{#if dayPlanShown}
					<div class="option" data-ticket-option="dayPlan">
						<label class="switch-row">
							<span>Zum Tagesplan von heute</span>
							<input
								type="checkbox"
								role="switch"
								checked={dayPlan && !isDone}
								disabled={isDone}
								aria-invalid={fieldErrors.dayPlan ? 'true' : undefined}
								aria-describedby={fieldErrors.dayPlan
									? `${ids.dayPlanHint} ${ids.dayPlanError}`
									: ids.dayPlanHint}
								onchange={(event) => {
									dayPlan = event.currentTarget.checked;
									cleared('dayPlan');
								}}
							/>
						</label>
						<p class="hint" id={ids.dayPlanHint}>
							{isDone
								? 'Erledigte Tickets kommen nicht in den Tagesplan.'
								: 'Kommt in den Tagesplan von heute dieses Bereichs.'}
						</p>
						{#if fieldErrors.dayPlan}
							<p class="field-error" id={ids.dayPlanError}>
								<ErrorIcon /><span>{fieldErrors.dayPlan}</span>
							</p>
						{/if}
					</div>
				{/if}

				{#if colorsAvailable}
					<div class="field" data-ticket-option="color">
						<span class="label" id={ids.color}>Farbe</span>
						<ColorChoice
							value={color}
							inheritLabel={inheritLabel('ticket', inherited)}
							{inherited}
							labelledby={ids.color}
							error={fieldErrors.color ?? null}
							errorId={ids.colorError}
							onchoose={(value) => (color = value)}
						/>
					</div>
				{/if}

				{#if kindShown}
					<div class="field" data-ticket-option="kind">
						<span class="label" id={ids.kind}>Art</span>
						<KindSwitch
							{ongoing}
							error={fieldErrors.kind ?? null}
							onchange={(wanted) => {
								ongoing = wanted;
								cleared('kind');
							}}
						/>
					</div>
				{/if}

				{#if parentShown && picker !== null}
					<div class="field" data-ticket-option="parent" role="group" aria-labelledby={ids.parent}>
						<span class="label" id={ids.parent}>Übergeordnet</span>
						{#if subtasks.length > 0}
							<p class="hint">Keins – das Ticket bekommt selbst Unteraufgaben (nur eine Ebene).</p>
						{:else}
							<TicketPicker
								label="Unter ein Ticket einordnen"
								hint="Aus der Liste wählen oder tippen; Unteraufgaben kommen nicht in Frage (nur eine Ebene)."
								source={picker}
								rules={parentRules}
								bind:value={parent}
								error={fieldErrors.parent ?? null}
								onchoose={() => cleared('parent')}
							/>
							{#if parent !== null}
								<BlocksParentSwitch
									blocks={blocksParent}
									parentKey={parent.key}
									error={fieldErrors.blocksParent ?? null}
									onchange={(wanted) => {
										blocksParent = wanted;
									}}
								/>
							{/if}
						{/if}
					</div>
				{/if}

				{#if canRepeat && today !== null}
					<section
						class="recurrence"
						aria-labelledby={ids.recurrence}
						data-ticket-option="recurrence"
						bind:this={recurrenceSection}
					>
						<h4 id={ids.recurrence}>
							<button
								class="disclosure"
								type="button"
								aria-expanded={repeatOpen}
								aria-controls={ids.recurrenceBody}
								bind:this={repeatToggle}
								onclick={toggleRepeat}
							>
								<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
									<path d={repeatOpen ? 'M3 4.5l3 3 3-3' : 'M4.5 3l3 3-3 3'} />
								</svg>
								Wiederholen
							</button>
						</h4>
						<div class="recurrence-body" id={ids.recurrenceBody} hidden={!repeatOpen}>
							{#if repeatOpen && recurrence !== null}
								<p class="hint">
									Das Ticket wird das erste der Serie; Ticket und Regel entstehen zusammen.
									Zugeklappt entsteht keine Regel.
								</p>
								{#if fieldErrors.recurrence}
									<p class="field-error" id={ids.recurrenceError}>
										<ErrorIcon /><span>{fieldErrors.recurrence}</span>
									</p>
								{/if}
								<RecurrenceForm
									bind:values={recurrence.values}
									errors={recurrenceErrors}
									{today}
									withoutDue={due === ''}
									{eachAvailable}
									context={{ kind: 'ticket', due: dueOrNull(due) }}
									{assignmentAvailable}
									{assignees}
								/>
								<p class="hint">
									Künftige Tickets bekommen Titel, Beschreibung, Priorität, Projekt und Tags aus
									diesem Formular{statusAvailable ? '; den Status wählst du hier' : ''}. Ändern
									kannst du das danach am Ticket unter „Wiederholt sich“{subtasksAvailable
										? ', dort auch Unteraufgaben, die jedes künftige Ticket bekommt'
										: ''}.
								</p>
								{#if statusAvailable}
									<InitialStatusChoice
										bind:value={
											() => repeatStatus,
											(chosen) => {
												repeatStatus = chosen;
												repeatStatusError = null;
											}
										}
										ticketStatus={status}
										error={repeatStatusError}
									/>
								{/if}
								{#if subtasksAvailable && subtasksShown && filledSubtasks.length > 0}
									<label class="check-row">
										<input
											id={ids.templateSubtasks}
											type="checkbox"
											checked={templateSubtasks}
											aria-invalid={fieldErrors.templateSubtasks ? 'true' : undefined}
											onchange={(event) => (templateSubtasks = event.currentTarget.checked)}
										/>
										<span>Unteraufgaben auch jedem künftigen Ticket der Serie geben</span>
									</label>
									{#if fieldErrors.templateSubtasks}
										<p class="field-error">
											<ErrorIcon /><span>{fieldErrors.templateSubtasks}</span>
										</p>
									{/if}
								{/if}
							{/if}
						</div>
					</section>
				{/if}

				{#if subtasksShown}
					<div class="option" data-ticket-option="subtasks">
						{#if parent !== null}
							<p class="label">Unteraufgaben</p>
							<p class="hint">
								Keine – eine Unteraufgabe hat keine eigenen Unteraufgaben (nur eine Ebene).
							</p>
						{:else}
							<TemplateSubtaskList
								bind:subtasks={
									() => subtasks,
									(next) => {
										subtasks = next;
										cleared('subtasks');
									}
								}
								invalidRows={invalidSubtasks}
								error={fieldErrors.subtasks ?? null}
								errorRow={errorIndex.subtasks ?? null}
								busy={pending}
								hint={`Entstehen mit dem Ticket als offene Unteraufgaben mit seinem Projekt und seinen Tags, höchstens ${CREATE_SUBTASKS_MAX}.`}
							/>
						{/if}
					</div>
				{/if}

				{#if sourcesShown}
					<section class="sources" aria-labelledby={ids.sources}>
						<h4 id={ids.sources}>Quellen</h4>
						<div class="option" data-ticket-option="sources">
							{#if candidates.length > 0}
								<InboxEntryChoice
									{candidates}
									bind:chosen={sources}
									legend="Einträge aus dem Eingang"
									error={fieldErrors.sources ?? null}
									onchange={() => cleared('sources')}
								/>
							{:else}
								<p class="hint">
									Im Eingang wartet gerade kein Eintrag, der eine Quelle werden könnte.
								</p>
							{/if}
						</div>
						{#if ticketSourcesShown && picker !== null}
							<div class="option" data-ticket-option="ticketSources">
								<TicketSourceChoice
									source={picker}
									{scope}
									bind:chosen={ticketSources}
									error={fieldErrors.ticketSources ?? null}
									errorIndex={errorIndex.ticketSources ?? null}
								/>
							</div>
						{/if}
					</section>
				{/if}
			</div>
		</section>

		{#if missingTitle}
			<p class="hint" id={ids.titleHint}>Zum Anlegen fehlt noch ein Titel.</p>
		{/if}
		<p class="hint">Tipp: Enter im Titel oder Strg+Enter legt das Ticket an.</p>
	</form>
</Drawer>

<ConfirmDialog
	open={confirmingDiscard}
	title="Neues Ticket verwerfen?"
	confirmLabel="Verwerfen"
	cancelLabel="Weiter bearbeiten"
	onconfirm={() => {
		confirmingDiscard = false;
		oncancel();
	}}
	oncancel={() => (confirmingDiscard = false)}
>
	<p>Die Eingaben gehen verloren.</p>
</ConfirmDialog>

<style>
	h2 {
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	.form {
		display: grid;
		gap: 1rem;
	}

	.field,
	.option,
	.description {
		display: grid;
		gap: 0.375rem;
		align-content: start;
		min-width: 0;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
	}

	label,
	.label {
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	input[type='text'] {
		width: 100%;
	}

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.more,
	.recurrence,
	.sources {
		display: grid;
		gap: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-line);
	}

	.more-body,
	.recurrence-body {
		display: grid;
		gap: 1rem;
	}

	.more-body[hidden],
	.recurrence-body[hidden] {
		display: none;
	}

	h3,
	h4 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	/* The headings of "Weitere Optionen" and "Wiederholen" are their disclosure buttons. */
	.disclosure {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		padding: 0.125rem 0.25rem;
		margin-left: -0.25rem;
		font: inherit;
		color: inherit;
		background: none;
		border: none;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.disclosure:hover {
		background: var(--fill-control-hover);
	}

	.disclosure svg {
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* Name left, switch right (ADR-0029 G-5), in the text color like the switches of the detail. */
	.switch-row {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
		font-size: var(--font-size-body);
		color: var(--color-text);
		cursor: pointer;
	}

	.check-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: var(--font-size-body);
		color: var(--color-text);
		cursor: pointer;
	}

	.source-date {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
	}

	/* "Zuständig" with "Mir" beside it (ADR-0068). */
	.assignee-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		min-width: 0;
	}

	.assignee-row select {
		max-width: 100%;
	}

	/* Touch screens (ADR-0060): the disclosure buttons are targets of 44 px like the buttons. */
	@media (pointer: coarse) {
		.disclosure {
			min-height: var(--control-height-touch);
		}
	}
</style>
