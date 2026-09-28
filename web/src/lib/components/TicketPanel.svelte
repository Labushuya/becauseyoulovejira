<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import type { ParentRef, Ticket } from '$lib/domain/ticket';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import type { TicketDetailStore } from '$lib/stores/ticket-detail.svelte';
	import Breadcrumbs from './Breadcrumbs.svelte';
	import Drawer from './overlay/Drawer.svelte';
	import EditableTitle from './EditableTitle.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import TicketDelete from './TicketDelete.svelte';
	import TicketDescription from './TicketDescription.svelte';
	import TicketFields from './TicketFields.svelte';
	import TicketMeta from './TicketMeta.svelte';

	// Detail panel (E2 plan, package 7; E3 plan, T-13 and T-14) on the side panel building block
	// (ADR-0025 section 6): header with the key, "Löschen …", "Vollansicht" and ×; title, fields,
	// description, source and dates, comments and history. The parts (TicketFields,
	// TicketDescription, TicketMeta, TicketDelete) are the same as in the full view, which only
	// arranges them differently (section 7). Escape closes the panel unless a form field has the
	// focus (the rule is the Drawer's). Comments and history (E2 plan, packages 9 and 10) come in
	// through `activity`, the series (E5 plan, package 4) through `recurrence`, the section
	// "Unteraufgaben" (ADR-0033) through `subtasks`. A sub-task shows its path "HAUS-12 › HAUS-15"
	// with a link to the parent in the header instead of the key alone.
	let {
		store,
		catalog,
		listHref,
		fullViewHref = null,
		onclose,
		ondeleted,
		activity,
		recurrence,
		sources,
		subtasks,
		parentField,
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
		/** Address of the full view (UI-7). */
		fullViewHref?: ResolvedPathname | null;
		onclose: () => void;
		/** Called after the ticket was deleted; the owner closes the panel. */
		ondeleted: () => void;
		activity?: Snippet<[Ticket]>;
		/** "Wiederholen…" or the series of the ticket (E5 plan, package 4). */
		recurrence?: Snippet<[Ticket]>;
		/** Section "Quellen" (ADR-0031 section 7), after source and dates. */
		sources?: Snippet<[Ticket]>;
		/** Number of sources, for the question of "Löschen …" (ADR-0031, addendum B). */
		sourceCount?: number;
		/** Section "Unteraufgaben" (ADR-0033 section 4), after the description. */
		subtasks?: Snippet<[Ticket]>;
		/** Row "Übergeordnet" in the fields (ADR-0033 section 4). */
		parentField?: Snippet<[Ticket]>;
		/** Number of sub-tasks, for the question of "Löschen …". */
		subtaskCount?: number;
		/** The ticket this one is a sub-task of, null for a top-level ticket. */
		parent?: ParentRef | null;
		/** Address of the panel of that parent. */
		parentHref?: ResolvedPathname | null;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-title`;

	let heading = $state<HTMLElement>();
	let messageHeading = $state<HTMLElement>();
	/** Ticket the focus was last moved to, so it moves only once per opened ticket. */
	let focusedFor: string | null = null;

	const ticket = $derived(store.ticket);

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
>
	{#snippet context()}
		{#if store.state === 'ready' && ticket && parent}
			<Breadcrumbs
				label="Pfad des Tickets"
				mono
				items={[
					{ label: parent.key, href: parentHref ?? undefined, title: parent.title },
					{ label: ticket.key }
				]}
			/>
		{:else}
			<span class="key">{ticket?.key ?? ''}</span>
		{/if}
	{/snippet}
	{#snippet actions()}
		{#if store.state === 'ready' && ticket}
			<TicketDelete {store} {ondeleted} {sourceCount} {subtaskCount} />
		{/if}
	{/snippet}

	{#if store.state === 'not_found'}
		<div class="message">
			<h2 id={headingId} tabindex="-1" bind:this={messageHeading}>Ticket nicht gefunden</h2>
			<p>Das Ticket gibt es nicht, oder es ist für dich nicht sichtbar.</p>
			<a href={listHref}>Zur Liste</a>
		</div>
	{:else if store.state === 'deleted'}
		<div class="message">
			<h2 id={headingId} tabindex="-1" bind:this={messageHeading}>Dieses Ticket wurde gelöscht.</h2>
			<p>Es wurde an anderer Stelle gelöscht, samt Kommentaren und Verlauf.</p>
			<a href={listHref}>Zur Liste</a>
		</div>
	{:else if store.state === 'error'}
		<div class="message">
			<h2 id={headingId} tabindex="-1" bind:this={messageHeading}>
				Ticket konnte nicht geladen werden
			</h2>
			<div class="alert-error">
				<ErrorIcon />
				<span class="grow">{store.error}</span>
				<button class="small" type="button" onclick={() => store.reload()}>Erneut versuchen</button>
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

	.small {
		padding: 0.125rem 0.625rem;
		font-size: var(--font-size-control);
		background: none;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: pointer;
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
