<script lang="ts">
	import { untrack } from 'svelte';
	import { flagOutlets, type FlagHost } from '$lib/overlay/flag-outlets.svelte';
	import type { FlagMessage, FlagStore } from '$lib/stores/flags.svelte';
	import ErrorIcon from '../ErrorIcon.svelte';
	import ProblemDetails from '../problems/ProblemDetails.svelte';

	// Flags bottom left (ADR-0025 section 8; plan UI-Konsistenz, package UI-5): the newest on top,
	// each with icon, title, optional text, at most one action and the × "Benachrichtigung
	// schließen"; an error of a failed action ends with its row "Details" (FP-1, ADR-0071). Two live
	// regions (polite for success and info, assertive for errors) announce every new flag; the
	// focus never moves. The clock of the store stops while the pointer or the focus is on the flags
	// and while the tab is hidden.
	// Where (addendum 18, package FL-1): the app layout renders this group after `main`, so the
	// keyboard reaches it after the page; every modal renders one as a direct child of its <dialog>,
	// after its content. Only the output that flag-outlets names shows the section: the topmost open
	// modal, otherwise the layout. So the flags stand in front of a modal and stay clickable instead
	// of lying in its inert background, they run there as everywhere, and there is always exactly
	// one pair of live regions. The flags and their clocks live in the store; moving them restarts
	// nothing, and flags taken over appear in place without the entrance again.
	let { store, host = null }: { store: FlagStore; host?: FlagHost } = $props();

	const uid = $props.id();
	let section = $state<HTMLElement>();

	/** This output shows the flags: no modal holds them (layout) or this modal is the topmost. */
	const active = $derived(flagOutlets.hostOf(store) === host);

	/**
	 * What this output took over when the flags came to it: the flags then shown appear in place
	 * without the entrance; the messages the previous output showed long enough are not repeated,
	 * so a screen reader hears each once.
	 */
	let takenOver = $state.raw<{ flags: ReadonlySet<string>; heard: readonly string[] }>({
		flags: new Set(),
		heard: []
	});

	// Before the section renders, each time this output becomes the active one.
	$effect.pre(() => {
		if (!active) return;
		takenOver = untrack(() => ({
			flags: new Set(store.flags.map((flag) => flag.id)),
			heard: [store.statusMessage, store.alertMessage]
				.filter((message) => message !== null && store.wasHeard(message))
				.map((message) => message?.id ?? '')
		}));
	});

	function forRegion(message: FlagMessage | null): FlagMessage | null {
		return active && message !== null && !takenOver.heard.includes(message.id) ? message : null;
	}

	const status = $derived(forRegion(store.statusMessage));
	const alert = $derived(forRegion(store.alertMessage));

	// A message counts as heard once it stood in a live region for a frame. An output that goes
	// away earlier (a modal that closes together with its result) leaves it to the next one.
	$effect(() => {
		const shown = [status, alert].filter((message) => message !== null);
		if (shown.length === 0) return;
		const frame = requestAnimationFrame(() => {
			for (const message of shown) store.markHeard(message.id);
		});
		return () => cancelAnimationFrame(frame);
	});

	// The layout's group watches the tab; it stays mounted while a modal holds the flags.
	$effect(() => {
		if (host !== null) return;
		const update = () => {
			if (document.hidden) store.pause('hidden');
			else store.resume('hidden');
		};
		update();
		document.addEventListener('visibilitychange', update);
		return () => {
			document.removeEventListener('visibilitychange', update);
			store.resume('hidden');
		};
	});

	// The flags move to another output while the pointer or the focus is on them: no pointerleave
	// or focusout follows here, so the clock goes on.
	$effect(() => {
		if (!active) return;
		return () => {
			store.resume('hover');
			store.resume('focus');
		};
	});

	function onfocusout(event: FocusEvent) {
		const next = event.relatedTarget;
		if (!(next instanceof Node) || !section?.contains(next)) store.resume('focus');
	}
</script>

{#if active}
	<section
		class="flags"
		class:in-modal={host !== null}
		aria-label="Benachrichtigungen"
		bind:this={section}
		onpointerenter={() => store.pause('hover')}
		onpointerleave={() => store.resume('hover')}
		onfocusin={() => store.pause('focus')}
		{onfocusout}
	>
		<div class="visually-hidden" role="status">
			{#key status?.id}<p>{status?.text ?? ''}</p>{/key}
		</div>
		<div class="visually-hidden" role="alert">
			{#key alert?.id}<p>{alert?.text ?? ''}</p>{/key}
		</div>

		{#if store.flags.length > 0}
			<ol class="list">
				{#each store.flags as flag (flag.id)}
					{@const titleId = `${uid}-${flag.id}`}
					<li
						class={`flag tone-${flag.tone}`}
						class:arrived={!takenOver.flags.has(flag.id)}
						data-overlay
					>
						<span class="icon">
							{#if flag.tone === 'error'}
								<ErrorIcon />
							{:else if flag.tone === 'success'}
								<svg
									viewBox="0 0 16 16"
									width="16"
									height="16"
									aria-hidden="true"
									focusable="false"
								>
									<circle cx="8" cy="8" r="7" />
									<path d="M5 8.2l2 2 4-4.4" />
								</svg>
							{:else}
								<svg
									viewBox="0 0 16 16"
									width="16"
									height="16"
									aria-hidden="true"
									focusable="false"
								>
									<circle cx="8" cy="8" r="7" />
									<path d="M8 7.2v4" />
									<path class="dot" d="M8 4.6v.2" />
								</svg>
							{/if}
						</span>
						<div class="text">
							<p class="title" id={titleId}>
								{#if flag.tone === 'error'}<span class="visually-hidden">Fehler:</span>{/if}
								{flag.title}
							</p>
							{#if flag.description !== ''}
								<p class="description">{flag.description}</p>
							{/if}
							{#if flag.action}
								<button
									class="button-subtle action"
									type="button"
									aria-describedby={titleId}
									onclick={() => store.act(flag.id)}
								>
									{flag.action.label}
								</button>
							{/if}
							<ProblemDetails problem={flag.problem} />
						</div>
						<button
							class="button-icon"
							type="button"
							aria-label="Benachrichtigung schließen"
							aria-describedby={titleId}
							onclick={() => store.dismiss(flag.id)}
						>
							<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
								<path d="M4 4l8 8M12 4l-8 8" />
							</svg>
						</button>
					</li>
				{/each}
			</ol>
		{/if}
	</section>
{/if}

<style>
	/*
	 * Fixed to the viewport, also inside a modal: the <dialog> has no transform, filter or
	 * backdrop-filter of its own (the glass lies on its frame), so it is no containing block here.
	 */
	.flags {
		position: fixed;
		bottom: 1rem;
		left: 1rem;
		z-index: 20;
		width: min(24rem, calc(100vw - 2rem));
		pointer-events: none;
	}

	/*
	 * Phone frame (MO-1a, ADR-0073): above the bottom bar and the system bar, never below them.
	 * While a sheet or a page is open (MO-1b), they stand at the top of the screen instead, below the
	 * status bar, so they cover neither its footer nor its buttons: in a modal (this group renders in
	 * it) and while a popover stands as a sheet (data-sheet, the flags of the layout).
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .flags {
			bottom: calc(1rem + var(--bottom-bar-height) + var(--safe-bottom));
		}

		:global(:root[data-mobile-layout='on']) .flags.in-modal,
		:global(:root[data-mobile-layout='on']:has([data-sheet]:popover-open)) .flags {
			top: calc(0.5rem + var(--safe-top));
			bottom: auto;
		}
	}

	.list {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.flag {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 0.625rem;
		align-items: start;
		padding: 0.625rem 0.5rem 0.625rem 0.75rem;
		font-size: 0.875rem;
		color: var(--color-text);
		/*
		 * Thick glass of the control layer (ADR-0029 section 1): a line on glass, the stripe on the
		 * left in the accent or the error color stays, the neutral popover shadow.
		 */
		background: var(--material-thick);
		backdrop-filter: var(--glass-filter-thick);
		border: 1px solid var(--color-separator);
		border-left: 3px solid var(--color-brand);
		border-radius: var(--radius-overlay);
		box-shadow:
			inset 0 1px 0 var(--glass-edge),
			var(--shadow-popover);
		pointer-events: auto;
	}

	/* Only a new flag comes in; one that moved here with the others stands already. */
	.arrived {
		animation: flag-in var(--motion-fast) var(--motion-ease);
	}

	.tone-error {
		border-left-color: var(--color-danger);
	}

	.icon {
		display: inline-flex;
		padding-top: 0.125rem;
		color: var(--color-brand-text);
	}

	.tone-error .icon {
		color: var(--color-danger);
	}

	.icon svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.icon .dot {
		stroke-width: 2;
	}

	.text {
		display: grid;
		gap: 0.25rem;
		justify-items: start;
		padding-top: 0.0625rem;
	}

	.title {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.description {
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.action {
		margin-left: -0.625rem;
		font-weight: 600;
		color: var(--color-brand-text);
	}

	.button-icon svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	@keyframes flag-in {
		from {
			opacity: 0;
			transform: translateY(0.5rem);
		}
	}
</style>
