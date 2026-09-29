<script lang="ts">
	import { tick } from 'svelte';
	import { formatRem, isResizable, menuColumns, type ColumnSpec } from '$lib/domain/columns';
	import type { ColumnFit } from './table/column-fit.svelte';
	import Popover from './overlay/Popover.svelte';

	// Menu "Spalten" in the section bar (ADR-0030 section 4; ADR-0025 section 5): a panel of the
	// popover building block. One row per optional column: a checkbox with its name, "schmaler" and
	// "breiter" (1rem) and the width as text; a shared polite live region says the new width. It is
	// the keyboard way to everything the grip does with the mouse. Columns hidden for lack of space
	// stay checked and say so (aria-describedby). The flexible column (title, name) has a row of
	// its own without a checkbox, it is always shown (Nachtrag 3); until the user sets its width it
	// says "auto". "Standard wiederherstellen" resets this table without a question; the flag comes
	// from the store, the focus stays in the popover.
	let {
		fit,
		always
	}: {
		/** Column state of the table: preferences, fitted widths and the steps. */
		fit: ColumnFit;
		/** Sentence on the columns that are always shown, e.g. "Key, Titel und Häkchen …". */
		always: string;
	} = $props();

	const uid = $props.id();
	const legendId = `${uid}-legend`;
	const hintId = (id: string) => `${uid}-auto-${id}`;

	const store = $derived(fit.store);
	const autoHidden = $derived(fit.fit.autoHidden);
	const columns = $derived(menuColumns(store.table.columns));
	const custom = $derived(
		columns.some((column) => store.isHidden(column.id) !== column.hiddenByDefault) ||
			Object.keys(store.prefs.widths).length > 0 ||
			Object.keys(store.prefs.options ?? {}).length > 0
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
		const width = fit.step(column.id, direction);
		if (width !== null) void announce(`${column.label}: ${formatRem(width)}`);
	}

	function toggleOption(id: string, label: string, value: boolean) {
		store.setOption(id, value);
		void announce(`${label} ${value ? 'an' : 'aus'}.`);
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
				{@const width = fit.menuWidth(column.id)}
				{@const bounds = fit.menuBounds(column.id)}
				<div class="row">
					{#if column.flexible}
						<!-- Always shown: no checkbox, only its width (Nachtrag 3). -->
						<span class="choice always-shown">
							<span class="name">{column.label}</span>
						</span>
					{:else}
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
					{/if}
					{#if isResizable(column)}
						<span class="width-controls">
							<button
								class="button-icon"
								type="button"
								aria-label={`Spalte ${column.label} schmaler`}
								title="Schmaler"
								aria-disabled={width <= bounds.min ? 'true' : undefined}
								onclick={() => step(column, -1)}
							>
								<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
									<path d="M3.5 8h9" />
								</svg>
							</button>
							<span class="width"
								>{column.flexible && !store.hasWidth(column.id) ? 'auto' : formatRem(width)}</span
							>
							<button
								class="button-icon"
								type="button"
								aria-label={`Spalte ${column.label} breiter`}
								title="Breiter"
								aria-disabled={width >= bounds.max ? 'true' : undefined}
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
		{#if store.table.options.length > 0}
			<!-- Switches of the table beside its columns (ADR-0033 section 5). -->
			<fieldset class="options">
				<legend>Darstellung</legend>
				{#each store.table.options as option (option.id)}
					<div class="row">
						<label class="choice">
							<input
								type="checkbox"
								checked={store.option(option.id)}
								onchange={(event) =>
									toggleOption(option.id, option.label, event.currentTarget.checked)}
							/>
							<span class="name">{option.label}</span>
						</label>
					</div>
				{/each}
			</fieldset>
		{/if}
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

	.options {
		margin-top: 0.5rem;
		padding-top: 0.375rem;
		border-top: 1px solid var(--color-separator);
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

	/* The name of the flexible column in line with the names beside the checkboxes. */
	.always-shown {
		padding-left: 1.5rem;
		cursor: default;
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
