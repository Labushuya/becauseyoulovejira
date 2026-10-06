<script lang="ts">
	import { tick } from 'svelte';
	import { CREATE_TICKET_SOURCES_MAX } from '$lib/domain/ticket-create';
	import { newTicketSourceRules } from '$lib/domain/ticket-origins';
	import type { TicketSummary } from '$lib/domain/ticket';
	import type { TicketPickerSource } from '$lib/stores/ticket-picker.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import StatusPill from './StatusPill.svelte';
	import TicketPicker from './TicketPicker.svelte';

	// The tickets a new ticket stems from (ADR-0067, "Neues Ticket" NT-1): the chosen ones as a list
	// with key, title, status and a named button to remove each, below them the ticket picker of
	// "Quelle hinzufügen → Ticket" (ADR-0042) with open and done tickets. A choice joins the list and
	// the picker is empty again for the next one, with the focus in it. Tickets of another area stay
	// visible with the reason; the chosen ones are hidden. At most CREATE_TICKET_SOURCES_MAX.
	let {
		source,
		scope,
		chosen = $bindable([]),
		error = null,
		errorIndex = null
	}: {
		source: TicketPickerSource;
		/** The area the ticket is created in. */
		scope: string | null;
		chosen?: TicketSummary[];
		error?: string | null;
		/** The row the error belongs to, null for the list as a whole. */
		errorIndex?: number | null;
	} = $props();

	const uid = $props.id();
	const ids = { list: `${uid}-list`, error: `${uid}-error`, status: `${uid}-status` };

	/** Counts the choices: a new picker after each, so its text is empty again. */
	let round = $state(0);
	let picked = $state<TicketSummary | null>(null);
	let status = $state('');
	let area = $state<HTMLElement>();

	const rules = $derived(
		newTicketSourceRules(
			scope,
			chosen.map((ticket) => ticket.id)
		)
	);
	const full = $derived(chosen.length >= CREATE_TICKET_SOURCES_MAX);

	async function add(ticket: TicketSummary) {
		if (full || chosen.some((entry) => entry.id === ticket.id)) return;
		chosen = [...chosen, ticket];
		status = `${ticket.key} als Quelle gewählt.`;
		picked = null;
		round += 1;
		await tick();
		area?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus();
	}

	async function remove(ticket: TicketSummary) {
		const index = chosen.findIndex((entry) => entry.id === ticket.id);
		chosen = chosen.filter((entry) => entry.id !== ticket.id);
		status = `${ticket.key} als Quelle entfernt.`;
		await tick();
		const buttons = area?.querySelectorAll<HTMLButtonElement>('[data-remove-source]') ?? [];
		(
			buttons[Math.min(index, buttons.length - 1)] ??
			area?.querySelector<HTMLInputElement>('input[role="combobox"]')
		)?.focus();
	}
</script>

<div class="ticket-sources" bind:this={area}>
	{#if chosen.length > 0}
		<ul class="chosen" id={ids.list} aria-label="Gewählte Quell-Tickets">
			{#each chosen as ticket, index (ticket.id)}
				<li class:invalid={error !== null && errorIndex === index}>
					<span class="key">{ticket.key}</span>
					<span class="title" title={ticket.title}>{ticket.title}</span>
					<StatusPill status={ticket.status} />
					<button
						class="button-icon"
						type="button"
						data-remove-source
						aria-label={`${ticket.key} als Quelle entfernen`}
						title="Als Quelle entfernen"
						onclick={() => void remove(ticket)}
					>
						<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
							<path d="M4 4l8 8M12 4l-8 8" />
						</svg>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	{#if full}
		<p class="hint">Höchstens {CREATE_TICKET_SOURCES_MAX} Quell-Tickets beim Anlegen.</p>
	{:else}
		{#key round}
			<TicketPicker
				label="Ticket als Quelle"
				hint="Aus der Liste wählen oder tippen; offene und erledigte Tickets."
				{source}
				{rules}
				openOnly={false}
				bind:value={picked}
				onchoose={(ticket) => void add(ticket)}
			/>
		{/key}
	{/if}
	{#if error}
		<p class="field-error" id={ids.error}><ErrorIcon /><span>{error}</span></p>
	{/if}
	<p class="visually-hidden" aria-live="polite" id={ids.status}>{status}</p>
</div>

<style>
	.ticket-sources {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
	}

	.chosen {
		display: grid;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.chosen li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto auto;
		gap: 0.5rem;
		align-items: center;
		padding: 0.25rem 0;
		border-bottom: 1px solid var(--color-line);
	}

	.chosen li.invalid {
		border-bottom-color: var(--color-danger);
	}

	.key {
		font-family: var(--font-mono);
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.button-icon svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
