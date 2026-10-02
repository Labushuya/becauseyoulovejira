<script lang="ts">
	import {
		CALENDAR_LAYERS,
		LAYER_HINTS,
		LAYER_LABELS,
		type CalendarLayer
	} from '$lib/domain/calendar';
	import Popover from '../overlay/Popover.svelte';

	// Popover "Ebenen" of the calendar (ADR-0053 §4): one checkbox per layer (open and done tickets,
	// planned dates of the rules, dated entries of the inbox), each with a line on what it shows. A
	// change applies at once and stays on this device (CalendarPrefsStore); the popover stays open,
	// so several layers can change in one go. A status filter decides over the tickets (like the list,
	// T-6): the hint says so where it overrides a layer.
	let {
		layers,
		statusFilter,
		onchange
	}: {
		layers: ReadonlySet<CalendarLayer>;
		/** The status filter of the URL; "done" shows done tickets, any other hides them. */
		statusFilter: string | null;
		onchange: (layer: CalendarLayer, shown: boolean) => void;
	} = $props();

	const uid = $props.id();
	const legendId = `${uid}-legend`;
	const count = $derived(CALENDAR_LAYERS.filter((layer) => layers.has(layer)).length);

	/** Why the status filter overrides a layer of tickets, or ''. */
	function override(layer: CalendarLayer): string {
		if (statusFilter === null) return '';
		if (layer === 'done') {
			return statusFilter === 'done'
				? 'Der Statusfilter „Erledigt“ zeigt sie trotzdem.'
				: 'Der Statusfilter blendet sie aus.';
		}
		if (layer === 'open' && statusFilter === 'done') {
			return 'Der Statusfilter „Erledigt“ blendet sie aus.';
		}
		return '';
	}
</script>

<div class="layers-popover">
	<Popover kind="panel" labelledby={legendId} placement="bottom-end" buttonClass="toggle">
		{#snippet button()}
			<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<path d="M8 2.5l5.5 3L8 8.5l-5.5-3zM2.5 8L8 11l5.5-3M2.5 10.5L8 13.5l5.5-3" />
			</svg>
			Ebenen
			<span class="count">({count} von {CALENDAR_LAYERS.length})</span>
		{/snippet}
		<fieldset>
			<legend id={legendId}>Ebenen</legend>
			{#each CALENDAR_LAYERS as layer (layer)}
				{@const note = override(layer)}
				<label class="choice">
					<input
						type="checkbox"
						checked={layers.has(layer)}
						aria-describedby={`${uid}-${layer}`}
						onchange={(event) => onchange(layer, event.currentTarget.checked)}
					/>
					<span class="text">
						<span class="label">{LAYER_LABELS[layer]}</span>
						<span class="hint" id={`${uid}-${layer}`}
							>{LAYER_HINTS[layer]}{note === '' ? '' : ` ${note}`}</span
						>
					</span>
				</label>
			{/each}
		</fieldset>
	</Popover>
</div>

<style>
	.layers-popover {
		display: inline-flex;
	}

	.layers-popover :global(.toggle) {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		padding: 0.25rem 0.625rem;
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.layers-popover :global(.toggle:hover) {
		color: var(--color-text);
	}

	svg {
		width: 0.875rem;
		height: 0.875rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.count {
		font-variant-numeric: tabular-nums;
	}

	fieldset {
		display: grid;
		gap: 0.125rem;
		width: min(20rem, calc(100vw - 2rem));
		border: none;
	}

	legend {
		padding: 0 0.375rem 0.25rem;
		font-size: var(--font-size-small);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.choice {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
		padding: 0.25rem 0.375rem;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.choice:hover {
		background: var(--color-bg);
	}

	.choice input {
		margin-top: 0.125rem;
	}

	.text {
		display: grid;
		gap: 0.125rem;
	}

	.label {
		font-size: var(--font-size-body);
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
