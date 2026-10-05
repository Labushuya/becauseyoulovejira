<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { PINNED_SECTION, pinnedTickets, projectPinsLabel } from '$lib/domain/pins';
	import {
		PROJECT_TICKETS_LIMIT,
		allTicketsText,
		noProjectTicketsText,
		projectTicketsLabel,
		sliceProjectTickets
	} from '$lib/domain/project-tickets';
	import { charmOf, charmText } from '$lib/domain/charms';
	import { colorText, ticketColorOf } from '$lib/domain/colors';
	import type { ProjectRef, TicketSummary } from '$lib/domain/ticket';
	import { ticketLinks } from '$lib/stores/open-mode.svelte';
	import { findPinStore, type PinStore } from '$lib/stores/pins.svelte';
	import { findTicketFollowUpStore } from '$lib/stores/ticket-follow-up.svelte';
	import type { TicketRowActionsStore } from '$lib/stores/ticket-row-actions.svelte';
	import { findTicketHost } from '$lib/ticket-host';
	import { projectTicketsHref } from '$lib/ticket-links';
	import CharmIcon from './CharmIcon.svelte';
	import ColorMark from './ColorMark.svelte';
	import DueLabel from './DueLabel.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import EmptyState from './guidance/EmptyState.svelte';
	import KindBadge from './KindBadge.svelte';
	import PinIcon from './PinIcon.svelte';
	import PriorityIcon from './PriorityIcon.svelte';
	import StatusPill from './StatusPill.svelte';
	import TicketActions from './TicketActions.svelte';
	import TicketPinToggle from './TicketPinToggle.svelte';

	// The open tickets of one project, compact (ADR-0034, addendum "Offene Tickets in Projekten";
	// plan projekte-tickets): below a row of the project list and in the project panel. A real list
	// with a name; each entry shows key and title (one link, it opens the ticket in the remembered
	// way, ADR-0036 §1), status, priority and due date. At most PROJECT_TICKETS_LIMIT entries, in
	// the order of the domain (due date, then priority); then "Alle N in Aufgaben öffnen", the list
	// filtered by the project. A ticket opens in the projects (ADR-0054, the host of the layout):
	// next to the list, or instead of the project panel, which × of the ticket brings back. A parent
	// lists only its own tickets (`ownOnly`; its sub projects list theirs), and its link to
	// "Aufgaben" leaves the sub projects out. No editing, no selection, no filters: that is what
	// "Aufgaben" is for. With `rowActions` every entry ends with the menu "•••" of the rows of
	// "Aufgaben" (plan aktionsmenues, AM-2); an entry is a menu row, so a right click or Shift+F10
	// open it where the owner attached rowMenus. The entries never scroll sideways (ADR-0030): the
	// details wrap below key and title when the line gets narrow. If the entry with the focus leaves
	// the list (done or moved to the trash elsewhere, realtime), the focus goes to the entry now at
	// its place, else to `returnFocus`. A dot before the key shows the color of the ticket (ADR-0052:
	// its own, else of the project or its parent), named after the title; so is its charm, whose
	// symbol stands before the title (ADR-0062). The own pinned tickets of the project (ADR-0064)
	// stand first in a list of their own, "Angeheftet", in the order of pinning and outside the
	// limit, and not again below; every entry has the pin toggle before its details.
	let {
		project,
		tickets,
		today,
		ownOnly = false,
		loading = false,
		error = null,
		rowActions = null,
		duplicates = false,
		headingLevel = 3,
		limit = PROJECT_TICKETS_LIMIT,
		pins = findPinStore(),
		returnFocus
	}: {
		/** The project as the catalog resolves it: its color and its parent (ADR-0052). */
		project: Pick<ProjectRef, 'id' | 'name' | 'color' | 'parent'>;
		/** The open tickets of the project, ordered (openTicketsOf, openTicketsByProject). */
		tickets: readonly TicketSummary[];
		/** Berlin date of the due labels (from the list store, so they change at midnight). */
		today: CalendarDate;
		/** A parent with sub projects: only its own tickets, the link without the sub projects. */
		ownOnly?: boolean;
		/** The open tickets are not loaded yet. */
		loading?: boolean;
		/** Loading the open tickets failed. */
		error?: string | null;
		/** The menu "•••" of every entry; without it the entries have none. */
		rowActions?: TicketRowActionsStore | null;
		/** "Duplizieren …" in that menu (ADR-0045). */
		duplicates?: boolean;
		/** Level of the heading of the empty list. */
		headingLevel?: 3 | 4;
		limit?: number;
		/** The own pins (ADR-0064); null: no section and no toggle. */
		pins?: PinStore | null;
		/** Where the focus goes when the focused entry leaves an emptied list. */
		returnFocus?: () => HTMLElement | null | undefined;
	} = $props();

	const links = ticketLinks();
	const host = findTicketHost();
	/** "Folge-Ticket anlegen …" in the menu (ADR-0067), with the store of the (app) layout. */
	const followUps = findTicketFollowUpStore();
	/** Titles from this length name themselves on hover; the line clamp may cut them (ADR-0030). */
	const LONG_TITLE = 60;

	/** The own pinned tickets of the project in the order of pinning (ADR-0064). */
	const pinned = $derived.by(() => {
		if (pins === null || !pins.available) return [];
		const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
		return pinnedTickets(pins.ticketIds, (id) => byId.get(id));
	});
	/** The other open tickets, without the pinned ones above. */
	const others = $derived.by(() => {
		if (pinned.length === 0) return tickets;
		const ids = new Set(pinned.map((ticket) => ticket.id));
		return tickets.filter((ticket) => !ids.has(ticket.id));
	});
	const slice = $derived(sliceProjectTickets(others, limit));
	/**
	 * Length of the longest shown key: its place is that many `ch` of the mono font wide (at least
	 * the former 5.5rem), so keys of every length line up and are never cut off (KN-1).
	 */
	const keyChars = $derived(
		Math.max(0, ...[...pinned, ...slice.shown].map((ticket) => ticket.key.length))
	);
	const label = $derived(projectTicketsLabel(project.name, ownOnly));
	const allHref = $derived(projectTicketsHref(project.id, !ownOnly));

	let list = $state<HTMLElement>();
	let pinnedList = $state<HTMLElement>();
	/** The focused element of an entry before the lists change, its list and the place of its entry. */
	let focused: HTMLElement | null = null;
	let focusedList: HTMLElement | null = null;
	let focusedIndex = 0;

	function focusLost(): boolean {
		const active = document.activeElement;
		return active === null || active === document.body;
	}

	$effect.pre(() => {
		void slice.shown;
		void pinned;
		const active = document.activeElement;
		const item = active instanceof HTMLElement ? active.closest('li') : null;
		const owner = item?.parentElement ?? null;
		if (item === null || owner === null || (owner !== list && owner !== pinnedList)) {
			focused = null;
			return;
		}
		focused = active as HTMLElement;
		focusedList = owner;
		focusedIndex = [...owner.children].indexOf(item);
	});

	$effect(() => {
		void slice.shown;
		void pinned;
		const lost = focused;
		focused = null;
		if (lost === null || lost.isConnected || !focusLost()) return;
		const owner = focusedList?.isConnected ? focusedList : (list ?? pinnedList);
		const entries = owner?.querySelectorAll<HTMLElement>('a[data-row-link]') ?? [];
		const next = entries[Math.min(focusedIndex, entries.length - 1)] ?? returnFocus?.();
		next?.focus();
	});

	/** After pinning or releasing the entry stands in the other list: the focus follows its toggle. */
	async function focusPinToggle(ticketId: string) {
		await tick();
		const toggle = [list, pinnedList]
			.flatMap((element) => [
				...(element?.querySelectorAll<HTMLElement>('[data-pin-toggle]') ?? [])
			])
			.find((element) => element.dataset.pinToggle === ticketId);
		toggle?.focus();
	}
</script>

<!-- One open ticket: key and title as one link, status, priority, due date, pin and "•••". -->
{#snippet entry(ticket: TicketSummary)}
	{@const color = ticketColorOf(ticket, project)}
	{@const charm = charmOf(ticket.charm)}
	<li
		class="ticket"
		data-menu-row={rowActions ? '' : undefined}
		data-pin-row={pins?.available ? '' : undefined}
	>
		<a
			class="link"
			href={links.href(ticket.id, page.url)}
			data-row-link
			data-ticket-link={ticket.id}
			title={ticket.title.length >= LONG_TITLE ? ticket.title : undefined}
		>
			{#if color}<ColorMark shown={color} named={false} />{/if}
			<span class="key">{ticket.key}</span>
			<span class="title"><CharmIcon charm={charm?.key} named={false} />{ticket.title}</span>
			{#if color}<span class="visually-hidden">, {colorText(color)}</span>{/if}
			{#if charm}<span class="visually-hidden">, {charmText(charm)}</span>{/if}
		</a>
		<span class="details">
			<KindBadge kind={ticket.kind} />
			<span class="status-cell"
				><span class="visually-hidden">Status:&nbsp;</span><StatusPill
					status={ticket.status}
				/></span
			>
			<span class="priority-cell"><PriorityIcon priority={ticket.priority} /></span>
			<span class="due-cell"
				>{#if ticket.due !== null}<span class="visually-hidden">Fällig:&nbsp;</span>{/if}<DueLabel
					due={ticket.due}
					{today}
				/></span
			>
			{#if pins?.available}
				<span class="pin">
					<TicketPinToggle {ticket} {pins} onchanged={(id) => void focusPinToggle(id)} />
				</span>
			{/if}
			{#if rowActions}
				{@const actions = rowActions}
				<span class="menu" aria-busy={actions.isPreparing(ticket.id) ? 'true' : undefined}>
					<TicketActions
						{ticket}
						flags={actions.flags}
						open={{
							panel: host.panel(ticket.id, page.url),
							full: host.full(ticket.id, page.url)
						}}
						buttonLabel={`Weitere Aktionen für ${ticket.key}`}
						buttonClass="button-icon row-menu"
						onduplicate={duplicates ? () => void actions.choose('duplicate', ticket) : null}
						onfollowup={followUps !== null ? () => void actions.choose('followup', ticket) : null}
						ondelete={() => void actions.choose('delete', ticket)}
					/>
				</span>
			{/if}
		</span>
	</li>
{/snippet}

{#if error !== null}
	<p class="alert-error"><ErrorIcon /><span>{error}</span></p>
{:else if loading}
	<p class="loading" role="status">Offene Tickets werden geladen …</p>
{:else if tickets.length === 0}
	<EmptyState size="compact" title={noProjectTicketsText(project.name, ownOnly)} {headingLevel} />
{:else}
	{#if pinned.length > 0}
		<!-- The pins of the project (ADR-0064); the list names itself, the label is for the eye. -->
		<p class="pinned-label" aria-hidden="true"><PinIcon />{PINNED_SECTION}</p>
		<ul
			class="tickets pinned"
			aria-label={projectPinsLabel(project.name)}
			style:--key-chars={keyChars}
			bind:this={pinnedList}
		>
			{#each pinned as ticket (ticket.id)}
				{@render entry(ticket)}
			{/each}
		</ul>
	{/if}
	{#if slice.shown.length > 0}
		<ul class="tickets" aria-label={label} style:--key-chars={keyChars} bind:this={list}>
			{#each slice.shown as ticket (ticket.id)}
				{@render entry(ticket)}
			{/each}
		</ul>
	{/if}
	{#if slice.more}
		<a class="all" href={allHref}>{allTicketsText(tickets.length)}</a>
	{/if}
{/if}

<style>
	.loading {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.tickets {
		display: grid;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* Key and title first; the details stand beside them, or below them when the line is narrow. */
	.ticket {
		display: flex;
		flex-wrap: wrap;
		gap: 0.125rem 0.75rem;
		align-items: center;
		min-width: 0;
		padding: 0.25rem 0;
		border-top: 1px solid var(--color-line);
	}

	.ticket:first-child {
		border-top: none;
	}

	.link {
		display: flex;
		flex: 1 1 14rem;
		gap: 0.5rem;
		align-items: baseline;
		min-width: 0;
		color: inherit;
		text-decoration: none;
	}

	.link:hover .title {
		text-decoration: underline;
	}

	/*
	 * As wide as the longest shown key in `ch` of the mono font (--key-chars), at least 5.5rem: the
	 * keys line up like a column and grow with their number instead of being cut off (KN-1).
	 */
	.key {
		flex: none;
		min-width: max(5.5rem, calc(var(--key-chars, 0) * 1ch));
		font-family: var(--font-mono);
		font-size: var(--font-size-control);
		white-space: nowrap;
		color: var(--color-text-muted);
	}

	/* Two lines at most, like the titles of the tables (ADR-0030 section 6). */
	.title {
		display: -webkit-box;
		min-width: 0;
		overflow: hidden;
		font-size: var(--font-size-body);
		overflow-wrap: anywhere;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	/* Fixed places, so the details line up like columns; they wrap as a block, never sideways. */
	.details {
		display: flex;
		flex: none;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: center;
		max-width: 100%;
		margin-left: auto;
	}

	.status-cell {
		width: 6.5rem;
	}

	.priority-cell {
		display: inline-flex;
		width: 1rem;
	}

	.due-cell {
		width: 7.5rem;
	}

	.all {
		display: inline-block;
		margin-top: 0.25rem;
		font-size: var(--font-size-control);
		color: var(--color-brand-text);
	}

	/* The pins of the project (ADR-0064) above the other tickets. */
	.pinned-label {
		display: flex;
		gap: 0.375rem;
		align-items: center;
		margin: 0;
		font-size: var(--font-size-control);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.tickets.pinned {
		margin-bottom: 0.5rem;
		padding-bottom: 0.25rem;
		border-bottom: 1px solid var(--color-line);
	}

	.pin {
		display: inline-flex;
	}
</style>
