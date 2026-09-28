<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { MORE_COLUMNS_HINT } from '$lib/domain/labels';
	import { projectChoiceLabel, projectPath } from '$lib/domain/project-tree';
	import { getColumnPrefs } from '$lib/stores/column-prefs.svelte';
	import { ColumnFit } from './table/column-fit.svelte';
	import ResizableHeader from './table/ResizableHeader.svelte';
	import {
		isWaiting,
		nextTicketDate,
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
	// Ticket, Offene Tickets (every key with a link to its panel, the number in front when there are
	// several; plan "Wiederholungen verständlich machen", recommendation 7), Projekt, Zustand
	// ("Aktiv", "Pausiert" or "Entscheidung nötig" as text with an icon) and the action "Pausieren"
	// or "Fortsetzen". The store keeps the order:
	// active rules first, then by the next ticket. The row of the rule in the panel is marked
	// (colour plus a bar at its start, aria-current on the link). The table never scrolls sideways
	// (package UI-6b): fitColumns (ADR-0030, package SP-5) fits the columns into the measured
	// frame; in a narrow frame Projekt, Offenes Ticket, Nächstes Ticket and Rhythmus give way in
	// this order; title, state and action stay, and the caption then names the panel, where the
	// rest stands. The title takes at most two lines; the view shares the column state with its
	// menu "Spalten".
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
		ontoggle
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
	} = $props();

	const CAPTION = 'Wiederholungen · aktive zuerst, dann nach nächstem Ticket';
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
</script>

<div class="frame" bind:this={frame}>
	<table>
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
							<a
								class="title-link"
								href={hrefOf(rule)}
								data-rule-id={rule.id}
								title={rule.title.length >= LONG_TITLE ? rule.title : undefined}
								aria-current={rule.id === activeId ? 'page' : undefined}>{rule.title}</a
							>
						</div>
					</th>
					{#if shown.has('rhythm')}
						<td class="text" data-col="rhythm" title={rhythmOf(rule)}>{rhythmOf(rule)}</td>
					{/if}
					{#if shown.has('next')}
						<td class="date" data-col="next">{nextTicketDate(rule, today)}</td>
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
										title={ticket.title}>{ticket.key}</a
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
					<td class="actions" data-col="actions">
						<button
							class="button-icon"
							type="button"
							aria-label={`${rule.active ? 'Pausieren' : 'Fortsetzen'}: ${rule.title}`}
							title={rule.active ? 'Pausieren' : 'Fortsetzen'}
							aria-disabled={busyId === rule.id ? 'true' : undefined}
							onclick={() => {
								if (busyId !== rule.id) ontoggle(rule);
							}}
						>
							<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
								{#if rule.active}
									<path d="M6 4v8M10 4v8" />
								{:else}
									<path d="M5.5 3.5l7 4.5-7 4.5z" />
								{/if}
							</svg>
						</button>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

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

	.actions {
		text-align: right;
	}

	.actions svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
