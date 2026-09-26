<script lang="ts">
	import { tick } from 'svelte';
	import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import type { FlagSink } from '$lib/stores/flags.svelte';
	import { RECURRENCE_UNAVAILABLE, type RecurrenceStore } from '$lib/stores/recurrence.svelte';
	import type { TicketListStore } from '$lib/stores/ticket-list.svelte';
	import {
		NEW_RULE_LINK_ID,
		newRecurrenceHref,
		recurrenceHref,
		ticketPath
	} from '$lib/ticket-links';
	import EmptyState from './guidance/EmptyState.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import RecurrenceTable, { type OpenInstance } from './RecurrenceTable.svelte';
	import SectionBar from './SectionBar.svelte';
	import ViewSwitch from './ViewSwitch.svelte';

	// Overview "Wiederholungen" (E5 plan, T-6 and package 5), built like the project view (UI-8):
	// the section bar with the switch at the same place as in the other views and "Neue Regel";
	// below it all rules of the store as a table, active ones first, then by the next ticket. A row
	// opens the rule panel (/wiederholungen/<id>) next to the view, "Neue Regel" the panel
	// /wiederholungen/neu. "Pausieren" and "Fortsetzen" work in the row; a refusal (an archived
	// project) comes as an error flag, like every failed row action (ADR-0025 section 8). Closing a
	// panel returns the focus to the link of its rule; after deleting, to the rule that followed it
	// (or the one before), else to the heading. Before the E5 migration a neutral hint says when
	// the rules come (restartNeeded); the empty list offers "Regel anlegen".
	let {
		store,
		tickets,
		catalog,
		flags,
		activeId = null,
		creating = false,
		inboxCount = null
	}: {
		store: RecurrenceStore;
		tickets: TicketListStore;
		catalog: CatalogStore;
		/** Error flags of the row actions. */
		flags: FlagSink;
		/** Rule shown in the panel; its row is marked as current. */
		activeId?: string | null;
		/** The panel "Neue Regel" is open. */
		creating?: boolean;
		/** New inbox entries for the switch. */
		inboxCount?: number | null;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;

	const rules = $derived(store.rules);
	const countLabel = $derived(rules.length === 1 ? '1 Regel' : `${rules.length} Regeln`);

	/** Open instance of a rule (at most one, ADR-0022 section 1); undefined while they load. */
	function openTicketOf(rule: RecurrenceRule): OpenInstance | null | undefined {
		if (tickets.openState !== 'ready') return undefined;
		const ticket = tickets.open.find((entry) => entry.recurrenceId === rule.id);
		return ticket === undefined ? null : { id: ticket.id, key: ticket.key, title: ticket.title };
	}

	let root = $state<HTMLElement>();
	let heading = $state<HTMLElement>();
	let busyId = $state<string | null>(null);

	/** "Pausieren" or "Fortsetzen" of a row; the store shows the success flag. */
	async function toggle(rule: RecurrenceRule) {
		if (busyId !== null) return;
		busyId = rule.id;
		try {
			const result = await store.setActive(rule.id, !rule.active);
			if (!result.ok) {
				const reason = result.message ?? Object.values(result.fields)[0] ?? null;
				if (reason !== null) {
					flags.show({
						tone: 'error',
						title: `„${rule.title}“ ließ sich nicht ${rule.active ? 'pausieren' : 'fortsetzen'}.`,
						description: reason
					});
				}
			}
		} finally {
			busyId = null;
		}
	}

	function focusLost(): boolean {
		const active = document.activeElement;
		return active === null || active === document.body;
	}

	function linkOf(id: string): HTMLElement | undefined {
		return [...(root?.querySelectorAll<HTMLElement>('a[data-rule-id]') ?? [])].find(
			(link) => link.dataset.ruleId === id
		);
	}

	/** Rule whose panel was shown last. */
	let shownId: string | null = null;
	/** Order of the rows while the rule of the panel still had one (for the row after it). */
	let orderWithShown: string[] = [];

	$effect(() => {
		const order = rules.map((rule) => rule.id);
		if (activeId !== null && order.includes(activeId)) orderWithShown = order;
	});

	/** The rule after `id` in the earlier order that still has a row, else the one before it. */
	function neighbourOf(id: string, order: readonly string[]): HTMLElement | undefined {
		const index = order.indexOf(id);
		if (index < 0) return undefined;
		const after = order.slice(index + 1);
		const before = order.slice(0, index).reverse();
		for (const candidate of [...after, ...before]) {
			const link = linkOf(candidate);
			if (link) return link;
		}
		return undefined;
	}

	// Closing the panel (×, Escape, blanket, browser back, deleting) returns the focus to the row
	// of its rule; a deleted rule hands it to the next row, else to the heading. Only when the focus
	// is lost, so a click elsewhere keeps its target.
	$effect(() => {
		const previous = shownId;
		shownId = activeId;
		if (previous === null || previous === activeId) return;
		const order = orderWithShown;
		void tick().then(() => {
			if (!focusLost()) return;
			(linkOf(previous) ?? neighbourOf(previous, order) ?? heading)?.focus();
		});
	});

	/** Whether the panel "Neue Regel" was open. */
	let wasCreating = false;

	// Leaving "Neue Regel" without a rule returns the focus to "Neue Regel".
	$effect(() => {
		const before = wasCreating;
		wasCreating = creating;
		if (!before || creating) return;
		void tick().then(() => {
			if (focusLost()) (document.getElementById(NEW_RULE_LINK_ID) ?? heading)?.focus();
		});
	});
</script>

<section class="recurrences-view" aria-labelledby={headingId} bind:this={root}>
	<SectionBar
		title="Wiederholungen"
		{headingId}
		count={store.state === 'ready' ? rules.length : null}
		{countLabel}
		bind:heading
	>
		{#snippet start()}
			<ViewSwitch current="recurrences" {inboxCount} projectsNewCount={tickets.newInProjects} />
		{/snippet}
		{#snippet end()}
			{#if store.state !== 'unavailable'}
				<a class="button-primary new" id={NEW_RULE_LINK_ID} href={newRecurrenceHref()}>
					<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
						<path
							d="M8 3v10M3 8h10"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
						/>
					</svg>
					Neue Regel
				</a>
			{/if}
		{/snippet}
	</SectionBar>

	{#if store.state === 'unavailable'}
		<SectionMessage tone="info" live>{RECURRENCE_UNAVAILABLE}</SectionMessage>
	{:else if store.state === 'error' && store.error}
		<SectionMessage tone="error" live>
			{store.error}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={() => void store.reload()}>
					Erneut versuchen
				</button>
			{/snippet}
		</SectionMessage>
	{:else if store.state !== 'ready'}
		<p class="loading" role="status">Wiederholungen werden geladen …</p>
	{:else if rules.length === 0}
		<EmptyState
			title="Noch keine Wiederholungen"
			description="Lege eine an oder wähle an einem Ticket „Wiederholen…“."
			icon="recurrence"
		>
			{#snippet primary()}
				<a class="button-primary" href={newRecurrenceHref()}>Regel anlegen</a>
			{/snippet}
		</EmptyState>
	{:else}
		{#if tickets.openState === 'error' && tickets.openError}
			<div class="load-error">
				<SectionMessage tone="error" live>
					{tickets.openError}
					{#snippet actions()}
						<button class="button-subtle" type="button" onclick={() => void tickets.reload()}>
							Erneut versuchen
						</button>
					{/snippet}
				</SectionMessage>
			</div>
		{/if}
		<RecurrenceTable
			{rules}
			today={tickets.today}
			{activeId}
			{busyId}
			hrefOf={(rule) => recurrenceHref(rule.id)}
			{openTicketOf}
			ticketHrefOf={ticketPath}
			projectOf={(rule) => (rule.projectId === null ? null : catalog.projectById(rule.projectId))}
			ontoggle={(rule) => void toggle(rule)}
		/>
	{/if}
</section>

<style>
	.recurrences-view {
		min-width: 0;
	}

	.new {
		padding: 0.375rem 0.875rem;
		font-size: 0.875rem;
		text-decoration: none;
	}

	.load-error {
		margin-bottom: 0.75rem;
	}

	.loading {
		color: var(--color-text-muted);
	}

	/* Only shown if loading takes noticeably long: no flash on a fast local server. */
	.loading {
		animation: reveal 0s 0.4s both;
	}

	@keyframes reveal {
		from {
			visibility: hidden;
		}

		to {
			visibility: visible;
		}
	}
</style>
