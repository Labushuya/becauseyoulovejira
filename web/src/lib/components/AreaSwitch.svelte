<script lang="ts">
	import { AREA_TEXTS } from '$lib/domain/area';
	import { findAreaStore } from '$lib/stores/area.svelte';

	// Area switch "Privat | <Haushalt>" (E7-3, ADR-0059 §1): two toggle buttons in a group named
	// "Bereich", like a virtual desktop. Only for an account in a household; without one there is no
	// choice and nothing is shown. The active area carries aria-pressed, the surface of the brand, a
	// line, a heavier weight and its icon, so it is clear without color as well. A click changes the
	// area at once without reloading the page (the layout loads the stores of the area again); the
	// focus stays on the button.
	const area = findAreaStore();
	const household = $derived(area?.household ?? null);
	const active = $derived(area?.active ?? 'private');
</script>

{#if area !== null && household !== null}
	<div class="area-switch" role="group" aria-label={AREA_TEXTS.group} data-area={active}>
		<button
			class="option"
			class:active={active === 'private'}
			type="button"
			aria-pressed={active === 'private'}
			onclick={() => area.select('private')}
		>
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
				<circle cx="8" cy="5.25" r="2.75" />
				<path d="M2.75 14c0-2.9 2.35-5 5.25-5s5.25 2.1 5.25 5" />
			</svg>
			<span>{AREA_TEXTS.private}</span>
		</button>
		<button
			class="option"
			class:active={active === 'household'}
			type="button"
			aria-pressed={active === 'household'}
			title={household.name}
			onclick={() => area.select('household')}
		>
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
				<path d="M2 7.5 8 2.5l6 5" />
				<path d="M3.75 6.25V13.5h8.5V6.25" />
				<path d="M6.75 13.5V10h2.5v3.5" />
			</svg>
			<span class="name">{household.name}</span>
		</button>
	</div>
{/if}

<style>
	.area-switch {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		padding: 0.125rem;
		font-size: var(--font-size-control);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.option {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		min-width: 0;
		padding: 0.25rem 0.625rem;
		color: var(--color-text-muted);
		background: none;
		border: 1px solid transparent;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.option:hover {
		color: var(--color-text);
	}

	.option svg {
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* The active area: surface of the brand, a line and weight, never color alone. */
	.active {
		font-weight: 600;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
	}

	.active:hover {
		color: var(--color-brand-soft-text);
	}

	.name {
		max-width: 12rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
