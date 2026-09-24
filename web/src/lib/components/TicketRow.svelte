<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import type { TicketSummary } from '$lib/domain/ticket';
	import DoneToggle from './DoneToggle.svelte';
	import DueLabel from './DueLabel.svelte';
	import PriorityIcon from './PriorityIcon.svelte';
	import StatusPill from './StatusPill.svelte';

	// One dense row of the list (CLAUDE.md section 7, E2 plan package 5): check mark, then a link
	// to the detail panel with key, title and tags, status, priority, project, due date and the
	// recurring icon. Project, tags, due date and icon appear only when the ticket has them.
	let {
		ticket,
		href,
		today,
		checked,
		pending,
		lingering,
		active = false,
		ontoggle,
		onundo
	}: {
		ticket: TicketSummary;
		href: ResolvedPathname;
		today: CalendarDate;
		checked: boolean;
		pending: boolean;
		/** Just checked: struck through, with "Rückgängig" (OF-E2-2). */
		lingering: boolean;
		/** The detail panel shows this ticket. */
		active?: boolean;
		ontoggle: (done: boolean) => void;
		onundo: () => void;
	} = $props();

	const done = $derived(ticket.status === 'done');
</script>

<li class="row" class:done class:lingering data-ticket-id={ticket.id}>
	<span class="check">
		<DoneToggle key={ticket.key} {checked} {pending} onchange={ontoggle} />
	</span>
	<a class="link" {href} aria-current={active ? 'page' : undefined}>
		<span class="key">{ticket.key}</span>
		<span class="title">
			<span class="title-text">{ticket.title}</span>
			{#each ticket.tags as tag (tag.id)}
				<span class="tag">{tag.name}</span>
			{/each}
		</span>
		<span class="status"><StatusPill status={ticket.status} /></span>
		<span class="priority"><PriorityIcon priority={ticket.priority} /></span>
		<span class="project">
			{#if ticket.project}
				<span title={ticket.project.name}>{ticket.project.code}</span>
			{/if}
		</span>
		<span class="due">
			{#if ticket.due}
				<DueLabel due={ticket.due} {today} {done} />
			{/if}
		</span>
		<span class="recurring">
			{#if ticket.recurring}
				<span class="recurring-icon" title="Wiederkehrend">
					<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
						<path
							d="M13 6.5A5.25 5.25 0 0 0 3.6 4.4M3 9.5a5.25 5.25 0 0 0 9.4 2.1"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
						/>
						<path
							d="M3.25 1.75v3h3M12.75 14.25v-3h-3"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					<span class="visually-hidden">wiederkehrend</span>
				</span>
			{/if}
		</span>
	</a>
	{#if lingering}
		<button
			class="undo"
			type="button"
			aria-label={`Rückgängig: ${ticket.key} wieder öffnen`}
			disabled={pending}
			onclick={onundo}
		>
			Rückgängig
		</button>
	{/if}
</li>

<style>
	.row {
		display: grid;
		grid-template-columns: 2rem minmax(0, 1fr) auto;
		align-items: center;
		border-bottom: 1px solid var(--color-line);
	}

	.check {
		display: flex;
		justify-content: center;
	}

	.link {
		display: grid;
		grid-template-columns: 5.5rem minmax(0, 1fr) 6.5rem 1.5rem 4rem 9.5rem 1.25rem;
		gap: 0.75rem;
		align-items: center;
		min-height: 2.5rem;
		padding: 0.375rem 0.75rem 0.375rem 0.25rem;
		color: inherit;
		text-decoration: none;
	}

	.link:hover {
		background: var(--color-bg);
	}

	.link:focus-visible {
		outline-offset: -2px;
	}

	.link[aria-current='page'] {
		background: var(--color-brand-soft-bg);
		box-shadow: inset 3px 0 0 var(--color-brand);
	}

	.key {
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.title {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		min-width: 0;
		font-size: 0.875rem;
	}

	.title-text {
		overflow-wrap: anywhere;
	}

	.tag {
		padding: 0 0.375rem;
		font-size: 0.75rem;
		line-height: 1.125rem;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: 0.25rem;
	}

	.priority,
	.recurring {
		display: flex;
		justify-content: center;
	}

	.project {
		overflow: hidden;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--color-text-muted);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.recurring-icon {
		display: inline-flex;
		color: var(--color-text-muted);
	}

	/* Done tickets step back (CLAUDE.md section 8). */
	.done .title-text,
	.done .key {
		color: var(--color-text-muted);
	}

	.lingering .title-text {
		text-decoration: line-through;
	}

	.undo {
		margin-right: 0.75rem;
		padding: 0.125rem 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-brand-text);
		background: none;
		border: 1px solid var(--color-brand);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.undo:disabled {
		cursor: progress;
		opacity: 0.6;
	}

	/* Narrow list (small window or next to the panel): the less important cells wrap. */
	@container ticket-list (max-width: 44rem) {
		.link {
			display: flex;
			flex-wrap: wrap;
			gap: 0.25rem 0.75rem;
		}

		.title {
			flex: 1 1 12rem;
		}
	}
</style>
