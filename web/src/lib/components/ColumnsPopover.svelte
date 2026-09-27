<script lang="ts">
	import { tick } from 'svelte';
	import {
		WIDTH_STEP,
		formatRem,
		isResizable,
		optionalColumns,
		type ColumnSpec
	} from '$lib/domain/columns';
	import type { ColumnPrefsStore } from '$lib/stores/column-prefs.svelte';
	import Popover from './overlay/Popover.svelte';

	// Menu "Spalten" in the section bar (ADR-0030 section 4; ADR-0025 section 5): a panel of the
	// popover building block. One row per optional column: a checkbox with its name, "schmaler" and
	// "breiter" (1rem) and the width as text; a shared polite live region says the new width. It is
	// the keyboard way to everything the grip does with the mouse. Columns hidden for lack of space
	// stay checked and say so (aria-describedby). "Standard wiederherstellen" resets this table
	// without a question; the flag comes from the store, the focus stays in the popover.
	let {
		store,
		autoHidden = [],
		always
	}: {
		store: ColumnPrefsStore;
		/** Columns hidden for lack of space right now (fitColumns). */
		autoHidden?: readonly string[];
		/** Sentence on the columns that are always shown, e.g. "Key, Titel und Häkchen …". */
		always: string;
	} = $props();

	const uid = $props.id();
	const legendId = `${uid}-legend`;
	const hintId = (id: string) => `${uid}-auto-${id}`;

	const columns = $derived(optionalColumns(store.table.columns));
	const custom = $derived(
		columns.some((column) => store.isHidden(column.id) !== column.hiddenByDefault) ||
			Object.keys(store.prefs.widths).length > 0
	);

	let live = $state('');

	/** Says `text` in the live region, also when it is the same text as before. */
	async function announce(text: string) {
		live = '';
		await tick();
		live = text;
	}

	function toggle(column: ColumnSpec, visible: boolean) {
		store.setVisible(column.id, visible);
		void announce(`${column.label} ${visible ? 'eingeblendet' : 'ausgeblendet'}.`);
	}

	function step(column: ColumnSpec, direction: -1 | 1) {
		const before = store.widthOf(column.id);
		const target = before + direction * WIDTH_STEP;
		if (target < column.min && before <= column.min) return;
		if (target > column.max && before >= column.max) return;
		const width = store.setWidth(column.id, target);
		void announce(`${column.label}: ${formatRem(width)}`);
	}

	function reset() {
		store.reset();
		void announce('Standard wiederhergestellt.');
	}
</script>

{#snippet button()}
	<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
		<rect x="2" y="3" width="12" height="10" rx="1" />
		<path d="M6 3v10M10 3v10" />
	</svg>
	Spalten
{/snippet}

<div class="columns-popover">
	<Popover kind="panel" labelledby={legendId} placement="bottom-end" buttonClass="toggle" {button}>
		<fieldset>
			<legend id={legendId}>Sichtbare Spalten</legend>
			{#each columns as column (column.id)}
				{@const shown = !store.isHidden(column.id)}
				{@const auto = shown && autoHidden.includes(column.id)}
				{@const width = store.widthOf(column.id)}
				<div class="row">
					<label class="choice">
						<input
							type="checkbox"
							checked={shown}
							aria-describedby={auto ? hintId(column.id) : undefined}
							onchange={(event) => toggle(column, event.currentTarget.checked)}
						/>
						<span class="name">{column.label}</span>
						{#if auto}
							<span class="auto" id={hintId(column.id)}>wegen Platz ausgeblendet</span>
						{/if}
					</label>
					{#if isResizable(column)}
						<span class="width-controls">
							<button
								class="button-icon"
								type="button"
								aria-label={`Spalte ${column.label} schmaler`}
								title="Schmaler"
								aria-disabled={width <= column.min ? 'true' : undefined}
								onclick={() => step(column, -1)}
							>
								<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
									<path d="M3.5 8h9" />
								</svg>
							</button>
							<span class="width">{formatRem(width)}</span>
							<button
								class="button-icon"
								type="button"
								aria-label={`Spalte ${column.label} breiter`}
								title="Breiter"
								aria-disabled={width >= column.max ? 'true' : undefined}
								onclick={() => step(column, 1)}
							>
								<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
									<path d="M3.5 8h9M8 3.5v9" />
								</svg>
							</button>
						</span>
					{/if}
				</div>
			{/each}
		</fieldset>
		<p class="note">{always}</p>
		<p class="visually-hidden" aria-live="polite">{live}</p>
		<div class="foot">
			<button
				class="button-subtle"
				type="button"
				aria-disabled={custom ? undefined : 'true'}
				onclick={() => {
					if (custom) reset();
				}}
			>
				Standard wiederherstellen
			</button>
		</div>
	</Popover>
</div>

<style>
	.columns-popover {
		display: inline-flex;
	}

	.columns-popover :global(.toggle) {
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

	.columns-popover :global(.toggle:hover) {
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

	fieldset {
		display: grid;
		gap: 0.125rem;
		min-width: 17rem;
		border: none;
	}

	legend {
		padding: 0 0.375rem 0.25rem;
		font-size: var(--font-size-small);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		justify-content: space-between;
		padding: 0 0.375rem;
		border-radius: var(--radius-item);
	}

	.row:hover {
		background: var(--fill-control-hover);
	}

	.choice {
		display: flex;
		flex-wrap: wrap;
		gap: 0 0.5rem;
		align-items: center;
		min-height: var(--control-height-m);
		font-size: var(--font-size-body);
		cursor: pointer;
	}

	.auto {
		flex-basis: 100%;
		padding-left: 1.5rem;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.width-controls {
		display: inline-flex;
		align-items: center;
	}

	.width {
		min-width: 3.75rem;
		font-size: var(--font-size-control);
		font-variant-numeric: tabular-nums;
		text-align: center;
		color: var(--color-text-muted);
	}

	.note {
		max-width: 17rem;
		margin-top: 0.5rem;
		padding: 0 0.375rem;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.foot {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.375rem;
		padding-top: 0.375rem;
		border-top: 1px solid var(--color-separator);
	}
</style>
