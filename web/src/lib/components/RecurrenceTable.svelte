<script lang="ts" module>
	/** The open ticket of a rule as the table shows it. */
	export interface OpenInstance {
		id: string;
		key: string;
		title: string;
	}
</script>

<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { MORE_COLUMNS_HINT } from '$lib/domain/labels';
	import {
		nextTicketDate,
		ruleParams,
		ruleStateLabel,
		type RecurrenceRule
	} from '$lib/domain/recurrence-rule';
	import { recurrenceText } from '$lib/domain/recurrence-text';
	import type { ProjectRef } from '$lib/domain/ticket';
	import Lozenge from './guidance/Lozenge.svelte';

	// Overview "Wiederholungen" (E5 plan, package 5), a table like "Aufgaben", "Eingang" and
	// "Projekte": Titel (link to the rule panel, like the title of a ticket), Rhythmus, Nächstes
	// Ticket, Offenes Ticket (key with a link to its panel), Projekt, Zustand ("Aktiv" or "Pausiert"
	// as text with an icon) and the action "Pausieren" or "Fortsetzen". The store keeps the order:
	// active rules first, then by the next ticket. The row of the rule in the panel is marked
	// (colour plus a bar at its start, aria-current on the link). The table never scrolls sideways
	// (package UI-6b): in a narrow frame container queries hide Projekt, Offenes Ticket, Nächstes
	// Ticket and Rhythmus in this order; title, state and action stay, and the caption then names
	// the panel, where the rest stands.
	let {
		rules,
		today,
		hrefOf,
		openTicketOf,
		ticketHrefOf,
		projectOf,
		activeId = null,
		busyId = null,
		ontoggle
	}: {
		/** Rules in the order to show. */
		rules: readonly RecurrenceRule[];
		today: CalendarDate;
		/** Address of the rule panel. */
		hrefOf: (rule: RecurrenceRule) => ResolvedPathname;
		/** Open ticket of a rule; null without one, undefined while the open tickets load. */
		openTicketOf: (rule: RecurrenceRule) => OpenInstance | null | undefined;
		/** Address of the panel of a ticket. */
		ticketHrefOf: (ticketId: string) => ResolvedPathname;
		/** Project of the template, null without one. */
		projectOf: (rule: RecurrenceRule) => ProjectRef | null;
		/** Rule shown in the panel; its row is marked as current. */
		activeId?: string | null;
		/** Rule whose "Pausieren" or "Fortsetzen" runs. */
		busyId?: string | null;
		/** "Pausieren" or "Fortsetzen" of a row; the view runs it and reports a refusal as a flag. */
		ontoggle: (rule: RecurrenceRule) => void;
	} = $props();

	const CAPTION = 'Wiederholungen · aktive zuerst, dann nach nächstem Ticket';

	function rhythmOf(rule: RecurrenceRule): string {
		return recurrenceText(ruleParams(rule)) || 'Kein Rhythmus';
	}
</script>

<div class="frame">
	<table>
		<caption>{CAPTION}<span class="caption-more">{MORE_COLUMNS_HINT}</span></caption>
		<thead>
			<tr>
				<th scope="col" class="title-col">Titel</th>
				<th scope="col" data-col="rhythm">Rhythmus</th>
				<th scope="col" data-col="next">Nächstes Ticket</th>
				<th scope="col" data-col="open">Offenes Ticket</th>
				<th scope="col" data-col="project">Projekt</th>
				<th scope="col">Zustand</th>
				<th scope="col"><span class="visually-hidden">Aktionen</span></th>
			</tr>
		</thead>
		<tbody>
			{#each rules as rule (rule.id)}
				{@const open = openTicketOf(rule)}
				{@const project = projectOf(rule)}
				<tr
					class="row"
					class:active={rule.id === activeId}
					class:paused={!rule.active}
					data-rule-row={rule.id}
				>
					<th class="title" scope="row">
						<a
							class="title-link"
							href={hrefOf(rule)}
							data-rule-id={rule.id}
							aria-current={rule.id === activeId ? 'page' : undefined}>{rule.title}</a
						>
					</th>
					<td class="text" data-col="rhythm">{rhythmOf(rule)}</td>
					<td class="date" data-col="next">{nextTicketDate(rule, today)}</td>
					<td class="key" data-col="open">
						{#if open === undefined}
							<span aria-hidden="true">…</span><span class="visually-hidden">wird geladen</span>
						{:else if open === null}
							<span aria-hidden="true">–</span><span class="visually-hidden">keins</span>
						{:else}
							<a class="key-link" href={ticketHrefOf(open.id)} title={open.title}>{open.key}</a>
						{/if}
					</td>
					<td class="text" data-col="project">
						{#if project === null}
							<span aria-hidden="true">–</span><span class="visually-hidden">kein Projekt</span>
						{:else}
							{project.name} <span class="code">({project.code})</span>
						{/if}
					</td>
					<td class="state">
						<Lozenge
							label={ruleStateLabel(rule)}
							icon={rule.active ? 'refresh' : 'pause'}
							tone={rule.active ? 'brand' : 'muted'}
						/>
					</td>
					<td class="actions">
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
	/* Container of the column rules; the table takes its width and never more. */
	.frame {
		container-type: inline-size;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	table {
		width: 100%;
		font-size: 0.875rem;
		border-collapse: collapse;
	}

	.caption-more {
		display: none;
		font-weight: 400;
	}

	/* Columns that give way, in this order: Projekt, Offenes Ticket, Nächstes Ticket, Rhythmus. */
	@container (max-width: 52rem) {
		.caption-more {
			display: inline;
		}
	}

	@container (max-width: 52rem) {
		.frame :global([data-col='project']) {
			display: none;
		}
	}

	@container (max-width: 44rem) {
		.frame :global([data-col='open']) {
			display: none;
		}
	}

	@container (max-width: 36rem) {
		.frame :global([data-col='next']) {
			display: none;
		}
	}

	@container (max-width: 28rem) {
		.frame :global([data-col='rhythm']) {
			display: none;
		}
	}

	caption {
		padding: 0.5rem 0.75rem;
		font-size: 0.8125rem;
		font-weight: 600;
		text-align: left;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
	}

	thead th {
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-align: left;
		white-space: nowrap;
		color: var(--color-text-muted);
		border-bottom: 1px solid var(--color-line);
	}

	.title-col {
		width: 40%;
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

	td,
	.title {
		padding: 0.375rem 0.75rem;
		text-align: left;
		vertical-align: middle;
	}

	.title {
		font-weight: 400;
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

	.text {
		font-size: 0.8125rem;
		overflow-wrap: anywhere;
	}

	.date {
		font-size: 0.8125rem;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.key {
		white-space: nowrap;
	}

	.key-link,
	.code {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
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
		width: 1%;
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
