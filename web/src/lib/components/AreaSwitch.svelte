<script lang="ts">
	import { resolve } from '$app/paths';
	import { AREA_TEXTS } from '$lib/domain/area';
	import { findAreaStore } from '$lib/stores/area.svelte';

	// Area switch "Privat | <Haushalt>" (E7-3, ADR-0059 §1): two toggle buttons in a group named
	// "Bereich", like a virtual desktop. The active area carries aria-pressed, the surface of the
	// brand, a line, a heavier weight and its icon, so it is clear without color as well. A click
	// changes the area at once without reloading the page (the layout loads the stores of the area
	// again); the focus stays on the button.
	//
	// Without a household there is no choice (addendum "+" of ADR-0059): the group shows "Privat" as
	// the current area (aria-current, not a button) and beside it a small "+" to Einstellungen →
	// Haushalt, for every account on every device. The "+" waits until the household store knows the
	// account has none (`known`), so a member never sees it for a moment; it comes and goes with the
	// membership without a reload. While a remembered household loads, nothing shows, as before.
	const area = findAreaStore();
	const household = $derived(area?.household ?? null);
	const active = $derived(area?.active ?? 'private');
	const offerHousehold = $derived(area?.known === true && household === null);
</script>

{#snippet personIcon()}
	<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
		<circle cx="8" cy="5.25" r="2.75" />
		<path d="M2.75 14c0-2.9 2.35-5 5.25-5s5.25 2.1 5.25 5" />
	</svg>
{/snippet}

{#if area !== null && household !== null}
	<div class="area-switch" role="group" aria-label={AREA_TEXTS.group} data-area={active}>
		<button
			class="option"
			class:active={active === 'private'}
			type="button"
			aria-pressed={active === 'private'}
			onclick={() => area.select('private')}
		>
			{@render personIcon()}
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
{:else if area !== null && active === 'private'}
	<div class="area-alone">
		<div class="area-switch" role="group" aria-label={AREA_TEXTS.group} data-area="private">
			<span class="option active current" aria-current="true">
				{@render personIcon()}
				<span>{AREA_TEXTS.private}</span>
			</span>
		</div>
		{#if offerHousehold}
			<a
				class="button-icon add"
				href={resolve('/einstellungen/haushalt')}
				aria-label={AREA_TEXTS.add}
				title={AREA_TEXTS.add}
			>
				<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
					<path d="M8 3v10M3 8h10" />
				</svg>
			</a>
		{/if}
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

	/* Without a household: "Privat" and the "+" side by side, as one place in the header. */
	.area-alone {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		min-width: 0;
	}

	/* "Privat" alone is a mark of the area, not a button. */
	.current {
		cursor: default;
	}

	/* The look of the "+" comes from .button-icon (base.css); here only its stroke. */
	.add svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linecap: round;
	}

	/* A target of 44 px on touch screens (ADR-0060 §2). */
	@media (pointer: coarse) {
		.add {
			width: var(--control-height-touch);
			height: var(--control-height-touch);
		}
	}
</style>
