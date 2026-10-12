<script lang="ts">
	import type { ShownColor } from '$lib/domain/colors';
	import ColorMark from '../ColorMark.svelte';

	// One choice of a cell menu (plan BI-3, ADR-0036 §6): the current value is checked, by mark and
	// weight. A project shows its color as a dot (ADR-0052); its name is the text of the choice. Taken
	// out of the row of the ticket table (UT-1) so the status menu of the sub-tasks (StatusMenu) is the
	// same; the menu rows themselves are styled by the Popover (CLAUDE.md §8).
	let {
		checked,
		text,
		onchoose,
		color = null
	}: {
		checked: boolean;
		text: string;
		onchoose: () => void;
		color?: ShownColor | null;
	} = $props();
</script>

<button
	class="item"
	class:checked
	type="button"
	role="menuitemradio"
	aria-checked={checked}
	tabindex="-1"
	onclick={onchoose}
>
	<span class="mark" aria-hidden="true">{checked ? '✓' : ''}</span>{#if color}<span
			class="choice-color"><ColorMark shown={color} named={false} /></span
		>{/if}{text}
</button>

<style>
	.mark {
		display: inline-block;
		width: 1.25em;
	}

	.choice-color {
		margin-right: 0.375rem;
	}

	.item.checked {
		font-weight: 600;
	}
</style>
