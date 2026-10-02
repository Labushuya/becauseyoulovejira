<script lang="ts">
	import { COLOR_LABELS, PROJECT_COLORS, colorVar, type ProjectColor } from '$lib/domain/colors';
	import ErrorIcon from './ErrorIcon.svelte';

	// The choice of a color (ADR-0052): a group of radios with a swatch and the visible name of each
	// color of the palette, after the choice without an own color ("Keine", "Wie Projekt (Blau)",
	// "Wie Oberprojekt (Blau)"), whose swatch shows the color then inherited (a dashed circle without
	// one). Native radios as base.css draws them: Tab reaches the group, the arrow keys move and
	// choose, the focus ring is the one of :focus-visible. The swatches are decoration; the name says
	// everything. `labelledby` names the group with the visible label of the form; `onchoose` gets
	// the key or null for no own color. While the owner saves, the group is busy, not locked, so the
	// focus stays (a choice meanwhile is saved after it, like a select).
	let {
		value,
		inheritLabel,
		inherited = null,
		labelledby,
		describedby,
		busy = false,
		error = null,
		errorId,
		onchoose
	}: {
		/** The own color, null for none. */
		value: ProjectColor | null;
		/** Label of the choice without an own color (inheritLabel of domain/colors.ts). */
		inheritLabel: string;
		/** The color shown without an own one (of the project or parent), null for none. */
		inherited?: ProjectColor | null;
		/** ID of the visible label of the group. */
		labelledby: string;
		/** ID of a hint below the group. */
		describedby?: string;
		busy?: boolean;
		/** Field error, linked to the group. */
		error?: string | null;
		errorId: string;
		onchoose: (color: ProjectColor | null) => void;
	} = $props();

	const name = $props.id();
	const description = $derived(
		[error ? errorId : undefined, describedby].filter((id) => id !== undefined).join(' ')
	);
</script>

<div
	class="color-choice"
	role="radiogroup"
	aria-labelledby={labelledby}
	aria-describedby={description === '' ? undefined : description}
	aria-busy={busy ? 'true' : undefined}
>
	<label class="option">
		<input type="radio" {name} value="" checked={value === null} onchange={() => onchoose(null)} />
		{#if inherited === null}
			<span class="swatch none" aria-hidden="true"></span>
		{:else}
			<span class="swatch" style:--swatch={colorVar(inherited)} aria-hidden="true"></span>
		{/if}
		<span class="name">{inheritLabel}</span>
	</label>
	{#each PROJECT_COLORS as color (color)}
		<label class="option">
			<input
				type="radio"
				{name}
				value={color}
				checked={value === color}
				onchange={() => onchoose(color)}
			/>
			<span class="swatch" style:--swatch={colorVar(color)} aria-hidden="true"></span>
			<span class="name">{COLOR_LABELS[color]}</span>
		</label>
	{/each}
</div>
{#if error}
	<p class="field-error" id={errorId}><ErrorIcon /><span>{error}</span></p>
{/if}

<style>
	.color-choice {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(7rem, 100%), 1fr));
		gap: 0.25rem 0.75rem;
		min-width: 0;
	}

	/* The choice without an own color takes a whole row: its label is the longest. */
	.option:first-child {
		grid-column: 1 / -1;
	}

	.option {
		display: flex;
		gap: 0.375rem;
		align-items: center;
		min-width: 0;
		min-height: var(--control-height-s);
		font-size: var(--font-size-control);
		cursor: pointer;
	}

	.swatch {
		flex: none;
		width: 0.875rem;
		height: 0.875rem;
		background: var(--swatch);
		border: 1px solid transparent;
		border-radius: 50%;
	}

	.swatch.none {
		background: transparent;
		border: 1px dashed var(--color-text-muted);
	}

	.name {
		min-width: 0;
		overflow-wrap: anywhere;
	}
</style>
