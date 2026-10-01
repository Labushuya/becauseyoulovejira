<script lang="ts" module>
	import type { CardStatus } from '$lib/domain/channel-card';
	import type { MenuAction } from '../ActionsMenu.svelte';

	/**
	 * An action of a card: its main button or an entry of the menu "•••" (`separated` only there).
	 */
	export interface CardAction extends MenuAction {
		/** The link opens an assistant in the address: keep focus and scroll, replace the entry. */
		inPlace?: boolean;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import ActionsMenu from '../ActionsMenu.svelte';
	import Lozenge from '../guidance/Lozenge.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import ChannelIcon, { type ChannelIconKind } from './ChannelIcon.svelte';

	// The one building block of every card on the page "Kanäle" (ADR-0026, addendum of 2026-09-30,
	// plan kanal-karten KK-2): a header with symbol, name, kind and the state as lozenge, exactly one
	// info line, at most one hint, exactly one main button that follows the state, all further
	// actions in the menu "•••" (popover menu, ADR-0025 section 5) and the details, which fold open
	// below (disclosure button). The kinds only configure it: ConnectionCard (calendar, Telegram,
	// mailbox), NotionCard, OwnInboxCard, WhatsAppWebCard and FilesCard. Actions that belong to one
	// entry of the details ("Widerrufen …" of a key, "Erneut abrufen" of a source) stand at that
	// entry. Every action names the card for screen readers; the state is text. The card is
	// opaque like every card (ADR-0029); only the menu is glass.
	let {
		icon,
		title,
		subtitle,
		status = null,
		info,
		progress = null,
		hint = null,
		message = null,
		busy = false,
		primary,
		menu = [],
		details,
		anchor
	}: {
		icon: ChannelIconKind;
		/** Name of the card (heading). */
		title: string;
		/** Kind of the channel below the name, e.g. "Postfach · Gmail · anna@gmail.com". */
		subtitle: string;
		/** State as lozenge; null where the app does not know it (files, WhatsApp Web). */
		status?: CardStatus | null;
		/** The one info line, e.g. "Zuletzt abgerufen vor 5 Min. · 3 neu". */
		info: string;
		/** A bar below the info line while something runs in the background (scan of an inbox). */
		progress?: { value: number; max: number } | null;
		/** At most one compact hint (channelHealth), e.g. missing variables or the last error. */
		hint?: { tone: 'info' | 'warning' | 'error'; text: string } | null;
		/** Error of the last action of this card (inline, ADR-0009). */
		message?: string | null;
		/** The card loads (aria-busy); the info line says what. */
		busy?: boolean;
		/** The one main button. */
		primary: CardAction;
		/** Further actions in the menu "•••", in this order. */
		menu?: CardAction[];
		/** Folded details. */
		details?: Snippet;
		/**
		 * ID of the card as target of a link (#verbindung-<id>); the page then focuses the card,
		 * which every card allows by script (tabindex -1), never by Tab.
		 */
		anchor?: string;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-name`;
	const detailsId = `${uid}-details`;

	let open = $state(false);

	function run(action: CardAction) {
		if (action.busy || action.locked) return;
		action.onselect?.();
	}
</script>

<article
	class="channel-card"
	id={anchor}
	tabindex="-1"
	aria-labelledby={headingId}
	aria-busy={busy ? 'true' : undefined}
>
	<header class="head">
		<ChannelIcon kind={icon} />
		<div class="names">
			<h4 id={headingId}>{title}</h4>
			<p class="kind">{subtitle}</p>
		</div>
		{#if status !== null}
			<Lozenge label={status.label} icon={status.icon} tone={status.tone} />
		{/if}
	</header>

	<p class="info-line" role={busy ? 'status' : undefined}>{info}</p>
	{#if progress !== null}
		<progress value={progress.value} max={progress.max} aria-hidden="true"></progress>
	{/if}
	{#if hint !== null}
		<SectionMessage tone={hint.tone} compact>{hint.text}</SectionMessage>
	{/if}
	{#if message !== null}
		<SectionMessage tone="error" compact live>{message}</SectionMessage>
	{/if}

	<footer class="actions">
		{#if primary.href !== undefined}
			<a
				class="button-secondary"
				href={primary.href}
				data-card-primary
				data-sveltekit-keepfocus={primary.inPlace ? '' : undefined}
				data-sveltekit-noscroll={primary.inPlace ? '' : undefined}
				data-sveltekit-replacestate={primary.inPlace ? '' : undefined}
			>
				{primary.label}<span class="visually-hidden">: {title}</span>
			</a>
		{:else}
			<button
				class="button-secondary"
				type="button"
				data-card-primary
				aria-haspopup={primary.dialog ? 'dialog' : undefined}
				aria-disabled={primary.busy || primary.locked ? 'true' : undefined}
				aria-busy={primary.busy ? 'true' : undefined}
				onclick={() => run(primary)}
			>
				{primary.label}<span class="visually-hidden">: {title}</span>
			</button>
		{/if}
		{#if details !== undefined || menu.length > 0}
			<span class="more">
				{#if details !== undefined}
					<button
						class="button-subtle toggle"
						type="button"
						aria-expanded={open}
						aria-controls={detailsId}
						onclick={() => (open = !open)}
					>
						Details<span class="visually-hidden">: {title}</span>
						<svg
							class="chevron"
							viewBox="0 0 16 16"
							width="12"
							height="12"
							aria-hidden="true"
							focusable="false"
						>
							<path d="M4 6l4 4 4-4" />
						</svg>
					</button>
				{/if}
				{#if menu.length > 0}
					<ActionsMenu
						label={`Weitere Aktionen für ${title}`}
						buttonLabel={`Weitere Aktionen für ${title}`}
						items={menu}
					/>
				{/if}
			</span>
		{/if}
	</footer>

	{#if details !== undefined}
		<div class="details" id={detailsId} hidden={!open}>
			{@render details()}
		</div>
	{/if}
</article>

<style>
	.channel-card {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
		padding: 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.head {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
	}

	.names {
		flex: 1;
		min-width: 0;
	}

	h4 {
		font-size: var(--font-size-body);
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.kind {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.info-line {
		font-size: var(--font-size-control);
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}

	/* Progress of a background run (scan of an inbox); the info line says the numbers. */
	progress {
		display: block;
		inline-size: 100%;
		block-size: 0.375rem;
		accent-color: var(--color-brand);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.more {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		margin-left: auto;
	}

	.toggle {
		font-size: var(--font-size-control);
	}

	.chevron {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: rotate var(--motion-fast) var(--motion-ease);
	}

	.toggle[aria-expanded='true'] .chevron {
		rotate: 180deg;
	}

	@media (prefers-reduced-motion: reduce) {
		.chevron {
			transition: none;
		}
	}

	/* The details of every card look alike: rows of name and value, lists, short text. */
	.details {
		display: grid;
		gap: 0.75rem;
		padding-top: 0.75rem;
		font-size: var(--font-size-control);
		border-top: 1px solid var(--color-line);
	}

	.details[hidden] {
		display: none;
	}

	.details :global(dl) {
		display: grid;
		gap: 0.25rem;
	}

	.details :global(dl > div) {
		display: grid;
		grid-template-columns: 7rem minmax(0, 1fr);
		gap: 0.5rem;
	}

	.details :global(dt) {
		color: var(--color-text-muted);
	}

	.details :global(dd) {
		overflow-wrap: anywhere;
	}
</style>
