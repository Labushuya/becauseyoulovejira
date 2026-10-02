<script lang="ts">
	import { colorText, colorVar, type ShownColor } from '$lib/domain/colors';

	// A color of a project or ticket as a mark (ADR-0052): a dot or a stripe, never a filled
	// surface. The color is never the only sign: the mark names it ("Farbe Blau, vom Projekt „Haus“")
	// as title and, with `named`, as text for screen readers; where the owner says it in its own text
	// (an option of a list), `named` is false and the mark is hidden from them. The palette reaches
	// 3 : 1 on every surface (project-colors.test.ts); in forced colors the transparent border shows
	// the shape in the color of the system.
	let {
		shown,
		kind = 'dot',
		named = true
	}: {
		shown: ShownColor;
		/** dot: a small circle next to a name; stripe: a bar at the start of a row or tile. */
		kind?: 'dot' | 'stripe';
		/** The name as text for screen readers; false when the owner says it itself. */
		named?: boolean;
	} = $props();

	const text = $derived(colorText(shown));
</script>

<span
	class="color-mark {kind}"
	style:--mark={colorVar(shown.color)}
	title={text}
	aria-hidden={named ? undefined : 'true'}
	data-color={shown.color}
	>{#if named}<span class="visually-hidden">{text}</span>{/if}</span
>

<style>
	.color-mark {
		display: inline-block;
		flex: none;
		background: var(--mark);
		border: 1px solid transparent;
	}

	.dot {
		width: 0.625rem;
		height: 0.625rem;
		vertical-align: middle;
		border-radius: 50%;
	}

	.stripe {
		width: 0.25rem;
		border-radius: var(--radius-pill);
	}
</style>
