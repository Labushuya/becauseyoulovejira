<script lang="ts" module>
	import type { ResolvedPathname } from '$app/types';

	/** An entry of a menu "•••": a button that runs an action or a link. */
	export interface MenuAction {
		/** Visible text, e.g. "Link kopieren" or "In den Papierkorb …". */
		label: string;
		/** Runs the action; not called while `busy` or `locked`. */
		onselect?: () => void;
		/** A link instead of a button: another view, an assistant, the help. */
		href?: ResolvedPathname;
		/** Opens a dialog. */
		dialog?: boolean;
		/** The action runs (aria-busy); the entry waits. */
		busy?: boolean;
		/** Not possible now (aria-disabled). */
		locked?: boolean;
		/** A line before the entry, e.g. before "Löschen …". */
		separated?: boolean;
	}
</script>

<script lang="ts">
	import Popover from './overlay/Popover.svelte';

	// The menu "•••" (ADR-0025 section 5, APG menu button): a symbol button that opens a popover of
	// the kind "menu" with further actions. The popover brings the keyboard (arrow keys with wrap,
	// Home and End, Enter and Space run an entry, Escape and Tab close) and returns the focus to the
	// button; an entry closes the menu before it runs, so a dialog it opens gives the focus back to
	// the button as well. Used by the cards of the page "Kanäle" (ADR-0026, addendum KK-2) and by the
	// actions of a ticket in its header and in the rows of the table (plan aktionsmenues).
	let {
		label,
		buttonLabel,
		buttonTitle,
		buttonClass = 'button-icon',
		placement = 'bottom-end',
		items,
		trigger = $bindable()
	}: {
		/** Name of the menu, e.g. "Weitere Aktionen für HAUS-12". */
		label: string;
		/** Name of the button (its content is only the symbol). */
		buttonLabel: string;
		/** Tooltip of the button. */
		buttonTitle?: string;
		/** Classes of the button: `.button-icon`, plus one the owner sizes (a row of a table). */
		buttonClass?: string;
		placement?: 'bottom-start' | 'bottom-end';
		/** The entries, in this order. */
		items: readonly MenuAction[];
		/** The button, e.g. for the focus after an inline area it opened closes. */
		trigger?: HTMLButtonElement;
	} = $props();

	function run(item: MenuAction, close: () => void) {
		if (item.busy || item.locked) return;
		close();
		item.onselect?.();
	}
</script>

<Popover kind="menu" {label} {placement} {buttonClass} {buttonLabel} {buttonTitle} bind:trigger>
	{#snippet button()}
		<svg
			class="dots"
			viewBox="0 0 16 16"
			width="16"
			height="16"
			aria-hidden="true"
			focusable="false"
		>
			<circle cx="3.5" cy="8" r="1.1" />
			<circle cx="8" cy="8" r="1.1" />
			<circle cx="12.5" cy="8" r="1.1" />
		</svg>
	{/snippet}
	{#snippet children({ close })}
		{#each items as item (item.label)}
			{#if item.separated}
				<div role="separator"></div>
			{/if}
			{#if item.href !== undefined}
				<a role="menuitem" tabindex="-1" href={item.href} onclick={close}>{item.label}</a>
			{:else}
				<button
					type="button"
					role="menuitem"
					tabindex="-1"
					aria-haspopup={item.dialog ? 'dialog' : undefined}
					aria-disabled={item.busy || item.locked ? 'true' : undefined}
					aria-busy={item.busy ? 'true' : undefined}
					onclick={() => run(item, close)}
				>
					{item.label}
				</button>
			{/if}
		{/each}
	{/snippet}
</Popover>

<style>
	.dots {
		fill: currentColor;
	}
</style>
