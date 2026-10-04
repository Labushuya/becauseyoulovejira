<script lang="ts" module>
	import {
		CHARM_ICONS,
		CHARM_SVG,
		type CharmIconName,
		type IconShape
	} from '$lib/domain/charm-icons';

	/** The shapes of a symbol, typed as the union the template tells apart. */
	export function shapesOf(icon: CharmIconName): readonly IconShape[] {
		return CHARM_ICONS[icon];
	}
</script>

<script lang="ts">
	import { charmOf, charmText } from '$lib/domain/charms';

	// A charm before a title (ADR-0062): the symbol of the catalog in currentColor (ADR-0052: the
	// color of the text around it, never a color of its own), decorative (aria-hidden). Its name comes
	// as `title` (tooltip) and, unless the place names it itself (`named` false, e.g. in the name of
	// a link of the calendar), as a hidden text "Charm: Geburtstag" for screen readers. The same size
	// and gap after it at every place (0.875rem, 0.375rem, like the symbol of the source). A value
	// the catalog does not know shows nothing.
	let {
		charm,
		named = true,
		size = 'inline'
	}: {
		/** The stored key; null, '' or an unknown key show nothing. */
		charm: string | null | undefined;
		/** Adds the hidden text "Charm: …" (default); false where the place names it. */
		named?: boolean;
		/** "inline" before a title (fixed size), "choice" in the dialog and its trigger. */
		size?: 'inline' | 'choice';
	} = $props();

	const entry = $derived(charmOf(charm));
	const text = $derived(entry === null ? '' : charmText(entry));
</script>

{#if entry !== null}
	<span
		class="charm-mark {size}"
		title={size === 'inline' ? text : undefined}
		data-charm={entry.key}
	>
		<svg
			viewBox={CHARM_SVG.viewBox}
			fill={CHARM_SVG.fill}
			stroke={CHARM_SVG.stroke}
			stroke-width={CHARM_SVG.strokeWidth}
			stroke-linecap={CHARM_SVG.strokeLinecap}
			stroke-linejoin={CHARM_SVG.strokeLinejoin}
			aria-hidden="true"
			focusable="false"
		>
			{#each shapesOf(entry.icon) as shape, index (index)}
				{#if 'd' in shape}
					<path d={shape.d} />
				{:else if 'cx' in shape}
					<circle cx={shape.cx} cy={shape.cy} r={shape.r} />
				{:else if 'points' in shape}
					<polyline points={shape.points} />
				{:else if 'x1' in shape}
					<line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} />
				{:else}
					<rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} />
				{/if}
			{/each}
		</svg>
		{#if named}<span class="visually-hidden">{text}</span>{/if}
	</span>
{/if}

<style>
	.charm-mark {
		display: inline-flex;
		flex: none;
		align-items: center;
		vertical-align: middle;
	}

	/* Before a title: one size and one gap everywhere (ADR-0062). */
	.inline {
		margin-right: 0.375rem;
	}

	.inline svg {
		width: 0.875rem;
		height: 0.875rem;
	}

	.choice svg {
		width: 1.125rem;
		height: 1.125rem;
	}
</style>
