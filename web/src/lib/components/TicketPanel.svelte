<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import { MOVE_TEXTS } from '$lib/domain/area-move';
	import { ticketColorOf } from '$lib/domain/colors';
	import type { ParentRef, Ticket } from '$lib/domain/ticket';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import { SILENT_FLAGS, type FlagSink } from '$lib/stores/flags.svelte';
	import { findPinStore } from '$lib/stores/pins.svelte';
	import type { TicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import { ticketPathSteps } from '$lib/ticket-links';
	import Breadcrumbs from './Breadcrumbs.svelte';
	import ColorMark from './ColorMark.svelte';
	import Drawer from './overlay/Drawer.svelte';
	import EditableTitle from './EditableTitle.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import TicketActions from './TicketActions.svelte';
	import TicketDelete from './TicketDelete.svelte';
	import TicketDescription from './TicketDescription.svelte';
	import TicketFields from './TicketFields.svelte';
	import TicketMeta from './TicketMeta.svelte';
	import TicketPinToggle from './TicketPinToggle.svelte';
	import TrashNotice from './TrashNotice.svelte';

	// Detail panel (E2 plan, package 7; E3 plan, T-13 and T-14) on the side panel building block
	// (ADR-0025 section 6): header with the key, the pin toggle (ADR-0064), the menu "•••" (plan
	// aktionsmenues: "Link kopieren", "Duplizieren …", "In den Papierkorb …"), "Vollansicht" and ×; title, fields,
	// description, source and dates, comments and history. The parts (TicketFields,
	// TicketDescription, TicketMeta, TicketActions) are the same as in the full view, which only
	// arranges them differently (section 7). Escape closes the panel unless a form field has the
	// focus (the rule is the Drawer's). Comments and history (E2 plan, packages 9 and 10) come in
	// through `activity`, the series (E5 plan, package 4) through `recurrence`, the section
	// "Unteraufgaben" (ADR-0033) through `subtasks`, the question of "Duplizieren …" (ADR-0045)
	// through `duplicate`, the one of "Folge-Ticket anlegen …" (ADR-0067) through `followUp`. The
	// snippet `sources` carries the sections "Quellen" and "Folge-Tickets". A sub-task shows its path "HAUS-12 › HAUS-15" with a link to the parent
	// in the header instead of the key alone; a ticket in a sub project starts it with "Haus ›
	// Garten" (ADR-0034), linking to the list filtered by the project. A dot in front shows the
	// color of the ticket with its name (ADR-0052).
	let {
		store,
		catalog,
		listHref,
		listLabel = 'Zur Liste',
		fullViewHref = null,
		onfullview,
		onclose,
		ondeleted,
		activity,
		recurrence,
		sources,
		subtasks,
		parentField,
		duplicate,
		followUp,
		flags = SILENT_FLAGS,
		sourceCount = 0,
		subtaskCount = 0,
		parent = null,
		parentHref = null
	}: {
		store: TicketDetailStore;
		/** Projects and tags (E3 plan, T-16). */
		catalog: CatalogStore;
		/** Link back to the list with the current query. */
		listHref: ResolvedPathname;
		/** Text of that link: "Zur Liste", next to the calendar "Zum Kalender" (ADR-0053). */
		listLabel?: string;
		/** Address of the full view (UI-7). */
		fullViewHref?: ResolvedPathname | null;
		/** A click on "Vollansicht": the owner remembers the choice (plan BI-1). */
		onfullview?: () => void;
		onclose: () => void;
		/** Called after the ticket was deleted; the owner closes the panel. */
		ondeleted: () => void;
		activity?: Snippet<[Ticket]>;
		/** "Wiederholen…" or the series of the ticket (E5 plan, package 4). */
		recurrence?: Snippet<[Ticket]>;
		/** Section "Quellen" (ADR-0031 section 7), after source and dates. */
		sources?: Snippet<[Ticket]>;
		/** Number of sources, for the question of "In den Papierkorb …" (ADR-0031, addendum B). */
		sourceCount?: number;
		/** Section "Unteraufgaben" (ADR-0033 section 4), after the description. */
		subtasks?: Snippet<[Ticket]>;
		/** Row "Übergeordnet" in the fields (ADR-0033 section 4). */
		parentField?: Snippet<[Ticket]>;
		/**
		 * The question of "Duplizieren …" (ADR-0045 §2), shown after the choice in the menu; `close`
		 * drops it. Without it the menu has no "Duplizieren …".
		 */
		duplicate?: Snippet<[Ticket, () => void]>;
		/**
		 * The question of "Folge-Ticket anlegen …" (ADR-0067 §4), shown after the choice in the menu;
		 * `close` drops it. Without it the menu has no "Folge-Ticket anlegen …".
		 */
		followUp?: Snippet<[Ticket, () => void]>;
		/** "Link kopiert" of the menu (plan aktionsmenues). */
		flags?: FlagSink;
		/** Number of sub-tasks, for the question of "In den Papierkorb …". */
		subtaskCount?: number;
		/** The ticket this one is a sub-task of, null for a top-level ticket. */
		parent?: ParentRef | null;
		/** Address of the panel of that parent. */
		parentHref?: ResolvedPathname | null;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-title`;
	/** The own pins (ADR-0064): the toggle before "•••"; none outside the app layout. */
	const pins = findPinStore();

	let heading = $state<HTMLElement>();
	let messageHeading = $state<HTMLElement>();
	/** The dialog chosen in the menu "•••", for the ticket it was chosen for. */
	let dialog = $state<{ kind: 'duplicate' | 'followup' | 'delete'; ticketId: string } | null>(null);
	const chosen = $derived(dialog !== null && dialog.ticketId === store.id ? dialog.kind : null);
	/** Ticket the focus was last moved to, so it moves only once per opened ticket. */
	let focusedFor: string | null = null;

	const ticket = $derived(store.ticket);
	/** Color of the ticket: its own, else of its project or the parent of that (ADR-0052). */
	const shown = $derived(ticket === null ? null : ticketColorOf(ticket, catalog.projectOf(ticket)));
	/** "Haus › Garten › HAUS-12 › GART-3" (ADR-0033, ADR-0034); empty for a plain ticket. */
	const path = $derived(
		ticket === null
			? []
			: ticketPathSteps(
					ticket.key,
					catalog.projectOf(ticket),
					parent === null ? null : { key: parent.key, title: parent.title, href: parentHref }
				)
	);

	// Focus on opening (E2 plan, section 3): the heading of the ticket, or the message heading.
	$effect(() => {
		const target = store.state === 'ready' ? heading : messageHeading;
		const key = `${store.id}:${store.state}`;
		if (target === undefined || focusedFor === key || store.state === 'loading') return;
		focusedFor = key;
		target.focus();
	});
</script>

<Drawer
	labelledby={headingId}
	{onclose}
	fullViewHref={store.state === 'ready' ? fullViewHref : null}
	{onfullview}
>
	{#snippet context()}
		<div class="context-line">
			{#if store.state === 'ready' && shown}
				<ColorMark {shown} />
			{/if}
			{#if store.state === 'ready' && ticket && path.length > 0}
				<Breadcrumbs label="Pfad des Tickets" items={path} />
			{:else}
				<span class="key">{ticket?.key ?? ''}</span>
			{/if}
		</div>
	{/snippet}
	{#snippet actions()}
		{#if store.state === 'ready' && ticket}
			<TicketPinToggle {ticket} {pins} variant="head" />
			<TicketActions
				{ticket}
				{flags}
				onduplicate={duplicate === undefined
					? null
					: () => (dialog = { kind: 'duplicate', ticketId: ticket.id })}
				onfollowup={followUp === undefined
					? null
					: () => (dialog = { kind: 'followup', ticketId: ticket.id })}
				ondelete={() => (dialog = { kind: 'delete', ticketId: ticket.id })}
			/>
			{#if chosen === 'duplicate'}
				{@render duplicate?.(ticket, () => (dialog = null))}
			{:else if chosen === 'followup'}
				{@render followUp?.(ticket, () => (dialog = null))}
			{:else if chosen === 'delete'}
				<TicketDelete
					{ticket}
					remove={(sources) => store.deleteTicket(sources)}
					{ondeleted}
					onclose={() => (dialog = null)}
					{sourceCount}
					{subtaskCount}
				/>
			{/if}
		{/if}
	{/snippet}

	{#if store.state === 'not_found'}
		<div class="message">
			<h2 id={headingId} tabindex="-1" bind:this={messageHeading}>Ticket nicht gefunden</h2>
			<p>Das Ticket gibt es nicht, oder es ist für dich nicht sichtbar.</p>
			<TrashNotice id={store.id} />
			<a href={listHref}>{listLabel}</a>
		</div>
	{:else if store.state === 'deleted' && store.movedAway}
		<!-- Moved into an area this account does not see (E7-4, ADR-0061 §3). -->
		<div class="message">
			<h2 id={headingId} tabindex="-1" bind:this={messageHeading}>{MOVE_TEXTS.movedAway}</h2>
			<p>{MOVE_TEXTS.movedAwayText}</p>
			<a href={listHref}>{listLabel}</a>
		</div>
	{:else if store.state === 'deleted'}
		<div class="message">
			<h2 id={headingId} tabindex="-1" bind:this={messageHeading}>Dieses Ticket wurde gelöscht.</h2>
			<p>Es wurde an anderer Stelle gelöscht.</p>
			<TrashNotice id={store.id} />
			<a href={listHref}>{listLabel}</a>
		</div>
	{:else if store.state === 'error'}
		<div class="message">
			<h2 id={headingId} tabindex="-1" bind:this={messageHeading}>
				Ticket konnte nicht geladen werden
			</h2>
			<div class="alert-error">
				<ErrorIcon />
				<span class="grow">{store.error}</span>
				<button class="button-secondary button-small" type="button" onclick={() => store.reload()}
					>Erneut versuchen</button
				>
			</div>
		</div>
	{:else if store.state === 'ready' && ticket}
		<EditableTitle {store} {headingId} bind:heading />
		<TicketFields {store} {catalog} {ticket} recurrenceShown={recurrence !== undefined}>
			{#snippet parentRow()}
				{@render parentField?.(ticket)}
			{/snippet}
		</TicketFields>
		{@render recurrence?.(ticket)}
		<TicketDescription {store} {ticket} />
		{@render subtasks?.(ticket)}
		<TicketMeta {ticket} />
		{@render sources?.(ticket)}
		{@render activity?.(ticket)}
	{:else}
		<p class="loading" role="status">Ticket wird geladen …</p>
	{/if}
</Drawer>

<style>
	/* The dot of the color stands before the path or the key (ADR-0052). */
	.context-line {
		display: flex;
		gap: 0.375rem;
		align-items: center;
		min-width: 0;
	}

	.key {
		font-family: var(--font-mono);
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.message {
		display: grid;
		gap: 0.75rem;
	}

	.message h2 {
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	.message a {
		color: var(--color-brand-text);
	}

	.loading {
		font-size: var(--font-size-body);
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

	.grow {
		flex: 1;
	}
</style>
