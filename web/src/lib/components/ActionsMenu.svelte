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
		/**
		 * A link to an outside page instead, by the rules of ExternalLink (ADR-0026 section 6): only
		 * an https address, in a new tab without opener and referrer, with the symbol "outside" and
		 * "(öffnet in neuem Tab)" in its name. An entry with another address is left out.
		 */
		external?: string;
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
	import { isHttpsUrl } from '$lib/guidance/links';
	import { OPEN_MENU_EVENT, type MenuRequest } from '$lib/overlay/context-menu';
	import Popover from './overlay/Popover.svelte';

	// The menu "•••" (ADR-0025 section 5, APG menu button): a symbol button that opens a popover of
	// the kind "menu" with further actions. The popover brings the keyboard (arrow keys with wrap,
	// Home and End, Enter and Space run an entry, Escape and Tab close) and returns the focus to the
	// button; an entry closes the menu before it runs, so a dialog it opens gives the focus back to
	// the button as well. Used by the cards of the page "Kanäle" (ADR-0026, addendum KK-2) and by the
	// actions of a ticket in its header and in the rows of the tables (plan aktionsmenues). In a row
	// (the class `row-menu` on the button) a right click or Shift+F10 opens the same menu at the
	// pointer or the focused element (AM-3): the rows ask through OPEN_MENU_EVENT on the button
	// (lib/overlay/context-menu.ts), and the focus goes back to where it was.
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

	let menu = $state<ReturnType<typeof Popover>>();

	/** The entries shown: an outside page only with an https address, like ExternalLink. */
	const shown = $derived(
		items.filter((item) => item.external === undefined || isHttpsUrl(item.external))
	);

	function run(item: MenuAction, close: () => void) {
		if (item.busy || item.locked) return;
		close();
		item.onselect?.();
	}

	// A row asks its menu to open at the pointer or the focused element (AM-3).
	$effect(() => {
		const button = trigger;
		if (!button) return;
		const onrequest = (event: Event) => {
			if (!(event instanceof CustomEvent) || menu === undefined) return;
			const request = event.detail as MenuRequest;
			event.preventDefault();
			menu.open(request.anchor, request.returnTo);
		};
		button.addEventListener(OPEN_MENU_EVENT, onrequest);
		return () => button.removeEventListener(OPEN_MENU_EVENT, onrequest);
	});
</script>

<Popover
	kind="menu"
	{label}
	{placement}
	{buttonClass}
	{buttonLabel}
	{buttonTitle}
	bind:trigger
	bind:this={menu}
>
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
		{#each shown as item (item.label)}
			{#if item.separated}
				<div role="separator"></div>
			{/if}
			{#if item.href !== undefined}
				<a role="menuitem" tabindex="-1" href={item.href} onclick={close}>{item.label}</a>
			{:else if item.external !== undefined}
				<!-- eslint-disable svelte/no-navigation-without-resolve -- an outside https page, not a route of the app -->
				<a
					role="menuitem"
					tabindex="-1"
					href={item.external}
					target="_blank"
					rel="noopener noreferrer"
					onclick={close}
					>{item.label}<svg
						class="outside"
						viewBox="0 0 16 16"
						width="12"
						height="12"
						aria-hidden="true"
						focusable="false"><path d="M9 3h4v4M13 3L7.5 8.5M11.5 9.5v3.5h-8.5v-8.5h3.5" /></svg
					> <span class="visually-hidden">(öffnet in neuem Tab)</span></a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
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

	/* The symbol "outside" of ExternalLink after the text of an entry to an outside page. */
	.outside {
		flex: none;
		margin-left: 0.375rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
