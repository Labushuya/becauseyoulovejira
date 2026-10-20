<script lang="ts">
	import { page } from '$app/state';
	import { viewOfRoute } from '$lib/domain/area';
	import { opensKeyboard, phoneBarTarget } from '$lib/domain/phone-layout';
	import { isSettingsPath } from '$lib/settings-sections';
	import { VIEW_LABELS, viewHref } from '$lib/views';
	import ViewIcon from '../ViewIcon.svelte';
	import PhoneMoreSheet from './PhoneMoreSheet.svelte';

	// Bottom bar of the phone frame (MO-1a, ADR-0073; decision of the user, addendum to ADR-0066 §1):
	// "Tagesplan · Aufgaben · ＋ · Eingang · Mehr" within reach of the thumb. The three views are links
	// with the same addresses as the navigation of the PC (lib/views.ts), the current one carries
	// aria-current="page" and is marked by a surface behind its symbol and the weight of its name, not
	// by colour alone. "＋" opens the quick entry (Enter creates a ticket, "In den Eingang" files it;
	// MO-5 refines it). "Mehr" opens a sheet with every other view, "Neues Ticket", the settings with
	// "nur am PC" and the session; it is marked while one of them is shown and says which. Every
	// target is as high as the bar and at least --phone-target; the safe area of the system bar lies
	// below it. While a text field has the focus the on-screen keyboard needs the room, so the bar
	// gives way; while a side panel covers the view it is inert, like the top bar.
	let {
		covered = false,
		inboxCount = null,
		projectsNewCount = 0,
		onquick
	}: {
		/** A side panel lies over the view; the bar is then not reachable either. */
		covered?: boolean;
		/** New inbox entries; null while not loaded (no number is shown). */
		inboxCount?: number | null;
		/** New tickets in projects, for "Projekte" under "Mehr"; 0 shows no number. */
		projectsNewCount?: number;
		/** Opens the quick entry. */
		onquick: () => void;
	} = $props();

	const view = $derived(viewOfRoute(page.route.id));
	const target = $derived(phoneBarTarget(view, isSettingsPath(page.url.pathname)));
	/** What "Mehr" stands for now: a view under it or the settings. */
	const moreLabel = $derived(
		target !== 'more' ? null : view !== null ? VIEW_LABELS[view] : 'Einstellungen'
	);
	// Its name for screen readers, beginning with the visible "Mehr". An aria-label and no hidden
	// text after the label: browsers put a space around each block-level part of a name, and both
	// the label and a visually hidden span are block-level in this flex column, which would read
	// "Mehr , aktuell: …".
	const moreName = $derived(moreLabel === null ? undefined : `Mehr, aktuell: ${moreLabel}`);

	let moreOpen = $state(false);

	// The bar gives way while the element with the focus opens the on-screen keyboard.
	let typing = $state(false);
	$effect(() => {
		const onfocusin = (event: FocusEvent) => {
			typing = opensKeyboard(event.target instanceof HTMLElement ? event.target : null);
		};
		const onfocusout = (event: FocusEvent) => {
			typing = opensKeyboard(
				event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null
			);
		};
		const active = document.activeElement;
		typing = opensKeyboard(active instanceof HTMLElement ? active : null);
		document.addEventListener('focusin', onfocusin);
		document.addEventListener('focusout', onfocusout);
		return () => {
			document.removeEventListener('focusin', onfocusin);
			document.removeEventListener('focusout', onfocusout);
		};
	});
</script>

<nav
	class="tab-bar"
	aria-label="Hauptnavigation"
	hidden={typing}
	inert={covered}
	data-phone-frame="bottom-bar"
>
	<ul class="items">
		<li>
			<a
				class="item"
				href={viewHref('dayplan', view, page.url)}
				aria-current={target === 'dayplan' ? 'page' : undefined}
			>
				<span class="indicator"><ViewIcon view="dayplan" /></span>
				<span class="label">{VIEW_LABELS.dayplan}</span>
			</a>
		</li>
		<li>
			<a
				class="item"
				href={viewHref('tasks', view, page.url)}
				aria-current={target === 'tasks' ? 'page' : undefined}
			>
				<span class="indicator"><ViewIcon view="tasks" /></span>
				<span class="label">{VIEW_LABELS.tasks}</span>
			</a>
		</li>
		<li>
			<button class="item add" type="button" aria-haspopup="dialog" onclick={onquick}>
				<span class="indicator">
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<path d="M8 3v10M3 8h10" />
					</svg>
				</span>
				<span class="label">Erfassen</span>
			</button>
		</li>
		<li>
			<a
				class="item"
				href={viewHref('inbox', view, page.url)}
				aria-current={target === 'inbox' ? 'page' : undefined}
			>
				<span class="indicator"><ViewIcon view="inbox" /></span>
				<span class="label">{VIEW_LABELS.inbox}</span>
				{#if inboxCount !== null && inboxCount > 0}
					<span class="badge"
						><span aria-hidden="true">{inboxCount}</span><span class="visually-hidden"
							>({inboxCount} neu)</span
						></span
					>
				{/if}
			</a>
		</li>
		<li>
			<button
				class="item more"
				class:current={target === 'more'}
				type="button"
				aria-haspopup="dialog"
				aria-label={moreName}
				onclick={() => (moreOpen = true)}
			>
				<span class="indicator">
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<circle cx="3.5" cy="8" r="1.1" />
						<circle cx="8" cy="8" r="1.1" />
						<circle cx="12.5" cy="8" r="1.1" />
					</svg>
				</span>
				<span class="label">Mehr</span>
			</button>
		</li>
	</ul>
</nav>

{#if moreOpen}
	<PhoneMoreSheet current={view} {projectsNewCount} onclose={() => (moreOpen = false)} />
{/if}

<style>
	/*
	 * Glass of the control layer like the header (ADR-0029), fixed at the bottom of the window; the
	 * page scrolls below it and keeps room for it (the padding of the app layout). The sheet "Mehr"
	 * is a sibling, never a descendant: the backdrop-filter would hold it.
	 */
	.tab-bar {
		position: fixed;
		inset: auto 0 0;
		z-index: 5;
		padding-bottom: var(--safe-bottom);
		background: var(--material-regular);
		backdrop-filter: var(--glass-filter-regular);
		border-top: 1px solid var(--color-separator);
	}

	/* While a text is typed the on-screen keyboard takes the room. */
	.tab-bar[hidden] {
		display: none;
	}

	.items {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		height: var(--bottom-bar-height);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.item {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		min-height: var(--phone-target);
		padding: 0;
		font: inherit;
		font-size: var(--font-size-small);
		color: var(--color-text);
		text-decoration: none;
		background: none;
		border: none;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.item:focus-visible {
		outline-offset: -2px;
	}

	/* The surface behind the symbol (the active indicator of Material), the name below it. */
	.indicator {
		--view-icon-size: 1.25rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: var(--control-height-m);
		padding: 0 1rem;
		border-radius: var(--radius-pill);
	}

	.indicator svg {
		width: var(--view-icon-size);
		height: var(--view-icon-size);
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	.label {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* The current entry: the surface of the brand and the weight, never colour alone. */
	.item:is([aria-current='page'], .current) .indicator {
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
	}

	.item:is([aria-current='page'], .current) .label {
		font-weight: 600;
	}

	/* "＋" is the main action of the bar: the surface of the brand, like a primary button. */
	.add .indicator {
		color: var(--color-on-brand);
		background: var(--color-brand);
	}

	.add .indicator svg {
		stroke-width: 1.75;
	}

	/* "Mehr": three dots, filled. */
	.more .indicator circle {
		fill: currentColor;
		stroke: none;
	}

	/* The number of new inbox entries at the corner of its symbol, as text for screen readers. */
	.badge {
		position: absolute;
		top: 0.25rem;
		left: calc(50% + 0.5rem);
		min-width: 1.25rem;
		padding: 0 0.3125rem;
		font-size: var(--font-size-caption);
		font-weight: 600;
		line-height: 1.125rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border: 1px solid var(--color-brand);
		border-radius: var(--radius-pill);
	}
</style>
