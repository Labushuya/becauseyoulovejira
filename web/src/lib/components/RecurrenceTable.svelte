<script lang="ts">
	import { goto } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import { areaMover } from '$lib/area-move-entry';
	import { isCardTap } from '$lib/card-tap';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { MORE_COLUMNS_HINT } from '$lib/domain/labels';
	import { projectChoiceLabel, projectPath } from '$lib/domain/project-tree';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
	import { rowMenus } from '$lib/overlay/context-menu';
	import { getColumnPrefs } from '$lib/stores/column-prefs.svelte';
	import ActionsMenu, { type MenuAction } from './ActionsMenu.svelte';
	import CharmIcon from './CharmIcon.svelte';
	import { ColumnFit } from './table/column-fit.svelte';
	import ResizableHeader from './table/ResizableHeader.svelte';
	import {
		isWaiting,
		nextTicketDate,
		nextTicketNote,
		nextTicketText,
		ruleParams,
		ruleStateLabel,
		type OpenInstance,
		type RecurrenceRule
	} from '$lib/domain/recurrence-rule';
	import { recurrenceText } from '$lib/domain/recurrence-text';
	import type { ProjectRef } from '$lib/domain/ticket';
	import Lozenge from './guidance/Lozenge.svelte';

	// Overview "Wiederholungen" (E5 plan, package 5), a table like "Aufgaben", "Eingang" and
	// "Projekte": Titel (link to the rule panel, like the title of a ticket), Rhythmus, Nächstes
	// Ticket (the due date and, below it, when it appears or which open ticket it waits for, the whole
	// sentence as title; recommendation 2), Offene Tickets (every key with a link to its panel, the
	// number in front when there are several; plan "Wiederholungen verständlich machen",
	// recommendation 7; the link names key and title on hover, so a key a narrow column cuts off
	// stays readable, KN-1), Projekt, Zustand ("Aktiv", "Pausiert" or "Wartet" as text with an icon)
	// and the menu "•••" of the row (plan aktionsmenues, AM-4): "Regel öffnen", the oldest open
	// ticket, "Pausieren" or "Fortsetzen" (before AM-4 a symbol of its own in the row, now only
	// here: pausing is rare, and the menu names it in words) and "Löschen …"; a right click on the
	// row or Shift+F10 open it as well (AM-3, rowMenus). The store keeps the order:
	// active rules first, then by the next ticket. The row of the rule in the panel is marked
	// (colour plus a bar at its start, aria-current on the link). The table never scrolls sideways
	// (package UI-6b): fitColumns (ADR-0030, package SP-5) fits the columns into the measured
	// frame; in a narrow frame Projekt, Offenes Ticket, Nächstes Ticket and Rhythmus give way in
	// this order; title, state and action stay, and the caption then names the panel, where the
	// rest stands. The title takes at most two lines; the view shares the column state with its
	// menu "Spalten".
	// Phone frame (MO-7b, ADR-0073 addendum MO-7b): with the switch "Handy-Ansicht (Vorschau)" on and
	// below 40rem the same component shows cards instead of the table, like the inbox (MO-6): the title
	// with its charm (up to three lines, the link to the rule), a muted line with the state, the
	// rhythm, the next ticket, the keys of the open tickets (links in the line) and the project, "•••"
	// with the menu of the row. A tap on the card opens the rule. Nothing of a column goes.
	let {
		rules,
		today,
		hrefOf,
		openTicketsOf,
		ticketHrefOf,
		projectOf,
		activeId = null,
		busyId = null,
		columnFit = new ColumnFit(getColumnPrefs('recurrences')),
		ontoggle,
		ondelete
	}: {
		/** Rules in the order to show. */
		rules: readonly RecurrenceRule[];
		today: CalendarDate;
		/** Address of the rule panel. */
		hrefOf: (rule: RecurrenceRule) => ResolvedPathname;
		/** Open tickets of a rule, oldest first; undefined while the open tickets load. */
		openTicketsOf: (rule: RecurrenceRule) => readonly OpenInstance[] | undefined;
		/** Address of the panel of a ticket. */
		ticketHrefOf: (ticketId: string) => ResolvedPathname;
		/** Project of the template, null without one. */
		projectOf: (rule: RecurrenceRule) => ProjectRef | null;
		/** Rule shown in the panel; its row is marked as current. */
		activeId?: string | null;
		/** Rule whose "Pausieren" or "Fortsetzen" runs. */
		busyId?: string | null;
		/** Column state (ADR-0030), shared with the menu "Spalten" of the view. */
		columnFit?: ColumnFit;
		/** "Pausieren" or "Fortsetzen" of a row; the view runs it and reports a refusal as a flag. */
		ontoggle: (rule: RecurrenceRule) => void;
		/** "Löschen …" of a row; the view asks first. Without it the menu has no such entry. */
		ondelete?: (rule: RecurrenceRule) => void;
	} = $props();

	const CAPTION = 'Wiederholungen · aktive zuerst, dann nach nächstem Ticket';
	const mover = areaMover();
	/** Titles from this length get a tooltip with the whole text (only they can be cut off). */
	const LONG_TITLE = 60;

	const shown = $derived(columnFit.shown);
	let frame = $state<HTMLElement>();

	$effect(() => {
		const element = frame;
		if (!element) return;
		return columnFit.observe(element);
	});

	function rhythmOf(rule: RecurrenceRule): string {
		return recurrenceText(ruleParams(rule)) || 'Kein Rhythmus';
	}

	/** The entries of the menu "•••" of a row (AM-4); a running pause locks them. */
	function menuOf(rule: RecurrenceRule, open: readonly OpenInstance[] | undefined): MenuAction[] {
		const entries: MenuAction[] = [{ label: 'Regel öffnen', href: hrefOf(rule) }];
		const oldest = open?.[0];
		if (oldest !== undefined) {
			entries.push({
				label:
					open?.length === 1
						? `Zum offenen Ticket ${oldest.key}`
						: `Zum ältesten offenen Ticket ${oldest.key}`,
				href: ticketHrefOf(oldest.id)
			});
		}
		const busy = busyId === rule.id;
		entries.push({
			label: rule.active ? 'Pausieren' : 'Fortsetzen',
			separated: true,
			busy,
			onselect: () => ontoggle(rule)
		});
		// Moving between the areas (E7-4, ADR-0061): the rule alone, its tickets stay.
		const move = mover.entry({
			kind: 'rule',
			records: [rule],
			label: `Wiederholung „${rule.title}“`
		});
		if (move !== null) entries.push({ label: move.label, dialog: true, onselect: move.run });
		if (ondelete) {
			const remove = ondelete;
			entries.push({
				label: 'Löschen …',
				dialog: true,
				separated: true,
				locked: busy,
				onselect: () => remove(rule)
			});
		}
		return entries;
	}

	/** The phone frame (MO-7b): cards instead of the table. */
	const mobileLayout = getMobileLayoutStore();
	const phone = $derived(mobileLayout.active);

	/** A tap on a card opens its rule, like the click on the title (MO-7b). */
	function tapCard(event: MouseEvent, rule: RecurrenceRule) {
		if (isCardTap(event)) void goto(hrefOf(rule));
	}
</script>

{#if phone}
	<!-- Cards instead of the table (MO-7b): the same order, menus and links. -->
	<ol class="rule-cards" aria-label="Regeln" {@attach rowMenus}>
		{#each rules as rule (rule.id)}
			{@const open = openTicketsOf(rule)}
			{@const project = projectOf(rule)}
			{@const waiting = isWaiting(rule)}
			<!-- The title link is the keyboard target of the card; the tap on the card is a shortcut for it. -->
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
			<li
				class="rule-card"
				class:active={rule.id === activeId}
				class:paused={!rule.active}
				data-rule-row={rule.id}
				data-menu-row
				aria-busy={busyId === rule.id ? 'true' : undefined}
				onclick={(event) => tapCard(event, rule)}
			>
				<div class="card-body">
					<!-- Up to three lines, cut off only visually; screen readers read the whole title. -->
					<p class="card-title">
						<CharmIcon charm={rule.charm} /><a
							class="title-link"
							href={hrefOf(rule)}
							data-rule-id={rule.id}
							data-row-link
							title={rule.title.length >= LONG_TITLE ? rule.title : undefined}
							aria-current={rule.id === activeId ? 'page' : undefined}>{rule.title}</a
						>
					</p>
					<p class="card-meta">
						<Lozenge
							label={ruleStateLabel(rule)}
							icon={waiting ? 'warning' : rule.active ? 'refresh' : 'pause'}
							tone={waiting ? 'neutral' : rule.active ? 'brand' : 'muted'}
						/>
						<span>{rhythmOf(rule)}</span>
						{#if rule.active}
							<span
								>{nextTicketText(
									rule,
									today,
									(open ?? []).map((ticket) => ticket.key)
								)}</span
							>
						{/if}
						{#if open !== undefined && open.length > 0}
							<span
								>{open.length === 1 ? 'Offen:' : `${open.length} offen:`}
								{#each open as ticket, index (ticket.id)}{#if index > 0},
									{/if}<a
										class="key-link"
										href={ticketHrefOf(ticket.id)}
										data-ticket-link={ticket.id}
										title={`${ticket.key} · ${ticket.title}`}>{ticket.key}</a
									>{/each}</span
							>
						{/if}
						{#if project !== null}
							<span>{projectPath(project)} <span class="code">({project.code})</span></span>
						{/if}
					</p>
				</div>
				<div class="card-end">
					<ActionsMenu
						label={`Weitere Aktionen für „${rule.title}“`}
						buttonLabel={`Weitere Aktionen für „${rule.title}“`}
						buttonTitle="Weitere Aktionen"
						buttonClass="button-icon row-menu"
						items={menuOf(rule, open)}
					/>
				</div>
			</li>
		{/each}
	</ol>
{:else}
	<div class="frame" bind:this={frame}>
		<table {@attach rowMenus}>
			<caption
				>{CAPTION}{#if columnFit.fit.autoHidden.length > 0}<span class="caption-more"
						>{MORE_COLUMNS_HINT}</span
					>{/if}</caption
			>
			<colgroup>
				{#each columnFit.shownColumns as column (column.id)}
					<col
						data-column={column.id}
						style:width={column.flexible ? undefined : `${columnFit.widthOf(column.id)}px`}
					/>
				{/each}
			</colgroup>
			<thead>
				<tr>
					{#each columnFit.shownColumns as column (column.id)}
						<ResizableHeader {column} fit={columnFit}>
							{#if column.id === 'actions'}
								<span class="visually-hidden">{column.label}</span>
							{:else}
								{column.label}
							{/if}
						</ResizableHeader>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each rules as rule (rule.id)}
					{@const open = openTicketsOf(rule)}
					{@const project = projectOf(rule)}
					{@const waiting = isWaiting(rule)}
					<tr
						class="row"
						class:active={rule.id === activeId}
						class:paused={!rule.active}
						data-rule-row={rule.id}
					>
						<th class="title" scope="row" data-col="title">
							<!-- At most two lines, cut off only visually (ADR-0030 section 6). -->
							<div class="title-clamp">
								<!-- The charm of the template (ADR-0062), as before the title of a ticket. -->
								<CharmIcon charm={rule.charm} />
								<a
									class="title-link"
									href={hrefOf(rule)}
									data-rule-id={rule.id}
									data-row-link
									title={rule.title.length >= LONG_TITLE ? rule.title : undefined}
									aria-current={rule.id === activeId ? 'page' : undefined}>{rule.title}</a
								>
							</div>
						</th>
						{#if shown.has('rhythm')}
							<td class="text" data-col="rhythm" title={rhythmOf(rule)}>{rhythmOf(rule)}</td>
						{/if}
						{#if shown.has('next')}
							{@const keys = (open ?? []).map((ticket) => ticket.key)}
							{@const note = nextTicketNote(rule, today, keys)}
							<td class="date" data-col="next" title={nextTicketText(rule, today, keys)}>
								{nextTicketDate(rule, today, keys)}
								{#if note !== ''}<span class="note">{note}</span>{/if}
							</td>
						{/if}
						{#if shown.has('open')}
							<td
								class="key"
								data-col="open"
								title={open !== undefined && open.length > 1
									? open.map((ticket) => ticket.key).join(', ')
									: undefined}
							>
								{#if open === undefined}
									<span aria-hidden="true">…</span><span class="visually-hidden">wird geladen</span>
								{:else if open.length === 0}
									<span aria-hidden="true">–</span><span class="visually-hidden">keins</span>
								{:else}
									{#if open.length > 1}
										<span class="count"
											>{open.length}<span class="visually-hidden">&nbsp;offene Tickets</span>:</span
										>
									{/if}
									{#each open as ticket, index (ticket.id)}
										{#if index > 0}<span aria-hidden="true">,&nbsp;</span>{/if}<a
											class="key-link"
											href={ticketHrefOf(ticket.id)}
											data-ticket-link={ticket.id}
											title={`${ticket.key} · ${ticket.title}`}>{ticket.key}</a
										>
									{/each}
								{/if}
							</td>
						{/if}
						{#if shown.has('project')}
							<td
								class="text"
								data-col="project"
								title={project === null ? undefined : projectChoiceLabel(project)}
							>
								{#if project === null}
									<span aria-hidden="true">–</span><span class="visually-hidden">kein Projekt</span>
								{:else}
									<!-- A sub project with its path, "Haus › Garten" (ADR-0034). -->
									{projectPath(project)} <span class="code">({project.code})</span>
								{/if}
							</td>
						{/if}
						<td
							class="state"
							data-col="state"
							title={waiting ? 'Wartet auf deine Entscheidung (im Panel der Regel)' : undefined}
						>
							<Lozenge
								label={ruleStateLabel(rule)}
								icon={waiting ? 'warning' : rule.active ? 'refresh' : 'pause'}
								tone={waiting ? 'neutral' : rule.active ? 'brand' : 'muted'}
							/>
						</td>
						<td
							class="actions"
							data-col="actions"
							aria-busy={busyId === rule.id ? 'true' : undefined}
						>
							<ActionsMenu
								label={`Weitere Aktionen für „${rule.title}“`}
								buttonLabel={`Weitere Aktionen für „${rule.title}“`}
								buttonTitle="Weitere Aktionen"
								buttonClass="button-icon row-menu"
								items={menuOf(rule, open)}
							/>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	/* The measured frame of fitColumns (ADR-0030); the table takes its width and never more. */
	.frame {
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	/* Fixed layout: the widths come from the colgroup, the title takes the rest. */
	table {
		width: 100%;
		table-layout: fixed;
		font-size: var(--font-size-body);
		border-collapse: collapse;
	}

	.caption-more {
		font-weight: 400;
	}

	caption {
		padding: 0.5rem 0.75rem;
		font-size: var(--font-size-control);
		font-weight: 600;
		text-align: left;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
	}

	thead :global(th) {
		padding: 0.375rem 0.75rem;
		font-size: var(--font-size-small);
		font-weight: 600;
		text-align: left;
		white-space: nowrap;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
	}

	.row {
		border-bottom: 1px solid var(--color-line);
	}

	.row:last-child {
		border-bottom: none;
	}

	.row.active {
		background: var(--color-brand-soft-bg);
	}

	/* Second, non-colour mark of the open row: a bar at its start. */
	.row.active > :first-child {
		box-shadow: inset 3px 0 0 var(--color-brand);
	}

	/* Fixed widths: what does not fit is cut off inside its cell, never beside it. */
	td,
	.title {
		padding: 0.375rem 0.75rem;
		overflow: hidden;
		text-align: left;
		text-overflow: ellipsis;
		vertical-align: middle;
	}

	.title {
		font-weight: 400;
	}

	/* Two lines at most (ADR-0030 section 6); the clamp is visual only. */
	.title-clamp {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.title-link {
		color: inherit;
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	.title-link:hover {
		text-decoration: underline;
	}

	/* A paused rule steps back, like a done ticket; its state also stands as text. */
	.paused .title-link,
	.paused .text,
	.paused .date {
		color: var(--color-text-muted);
	}

	/* One line with an ellipsis; the whole text is the title of the cell. */
	.text {
		font-size: var(--font-size-control);
		white-space: nowrap;
	}

	.date {
		font-size: var(--font-size-control);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	/* Second line of "Nächstes Ticket": when it appears or what it waits for (recommendation 2). */
	.date .note {
		display: block;
		overflow: hidden;
		font-size: var(--font-size-small);
		text-overflow: ellipsis;
		color: var(--color-text-muted);
	}

	.key {
		white-space: nowrap;
	}

	.count {
		margin-right: 0.25rem;
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.key-link,
	.code {
		font-family: var(--font-mono);
		font-size: var(--font-size-control);
		color: var(--color-brand-text);
	}

	.key-link {
		text-decoration: none;
	}

	.key-link:hover {
		text-decoration: underline;
	}

	.state {
		white-space: nowrap;
	}

	/* The menu "•••" of the row (AM-4) in 3.5rem, at the small control height of base.css. */
	.actions {
		text-align: right;
	}

	/*
	 * Phone frame (MO-7b, ADR-0073 addendum MO-7b): the cards in a framed list like the table, each
	 * the body and "•••"; the title in up to three lines, long words wrap, the line of the state, the
	 * rhythm and the next ticket wraps. Off, or from 40rem, the table stays as it was.
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .rule-cards {
			min-width: 0;
			margin: 0;
			padding: 0;
			overflow: hidden;
			list-style: none;
			background: var(--color-surface);
			border: 1px solid var(--color-line);
			border-radius: var(--radius-surface);
		}

		:global(:root[data-mobile-layout='on']) .rule-card {
			display: flex;
			gap: 0.25rem;
			align-items: flex-start;
			padding: 0.5rem 0.25rem 0.75rem 0.75rem;
			border-top: 1px solid var(--color-line);
			cursor: pointer;
		}

		:global(:root[data-mobile-layout='on']) .rule-card:first-child {
			border-top: none;
		}

		:global(:root[data-mobile-layout='on']) .rule-card.active {
			background: var(--color-brand-soft-bg);
			box-shadow: inset 3px 0 0 var(--color-brand);
		}

		:global(:root[data-mobile-layout='on']) .card-body {
			display: grid;
			flex: 1 1 auto;
			gap: 0.375rem;
			min-width: 0;
			padding-top: 0.625rem;
		}

		/* Up to three lines; the clamp is visual only, screen readers read the whole title. */
		:global(:root[data-mobile-layout='on']) .card-title {
			display: -webkit-box;
			margin: 0;
			overflow: hidden;
			font-size: var(--font-size-body);
			overflow-wrap: anywhere;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 3;
			line-clamp: 3;
		}

		:global(:root[data-mobile-layout='on']) .card-meta {
			display: flex;
			flex-wrap: wrap;
			gap: 0.25rem 0.75rem;
			align-items: center;
			min-width: 0;
			margin: 0;
			font-size: var(--font-size-control);
			color: var(--color-text-muted);
			overflow-wrap: anywhere;
		}

		:global(:root[data-mobile-layout='on']) .card-meta > span {
			min-width: 0;
		}

		:global(:root[data-mobile-layout='on']) .card-end {
			flex: none;
		}
	}
</style>
