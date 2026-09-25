<script lang="ts">
	import type { FlagStore } from '$lib/stores/flags.svelte';
	import ErrorIcon from '../ErrorIcon.svelte';

	// Flags bottom left (ADR-0025 section 8; plan UI-Konsistenz, package UI-5): the newest on top,
	// each with icon, title, optional text, at most one action and the × "Benachrichtigung
	// schließen". The section follows `main` in the DOM, so the keyboard reaches it after the page.
	// Two live regions exist from the start (polite for success and info, assertive for errors), so
	// screen readers announce every new flag; the focus never moves. The clock of the store stops
	// while the pointer or the focus is on the flags, while the tab is hidden and while a modal
	// dialog is open (under a modal the flags are inert anyway).
	let { store }: { store: FlagStore } = $props();

	const uid = $props.id();
	let section = $state<HTMLElement>();

	$effect(() => {
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

	// A modal dialog is open when a <dialog> carries `open`; the observer sees it come and go.
	$effect(() => {
		const update = () => {
			if (document.querySelector('dialog[open]') !== null) store.pause('modal');
			else store.resume('modal');
		};
		update();
		const observer = new MutationObserver(update);
		observer.observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ['open']
		});
		return () => {
			observer.disconnect();
			store.resume('modal');
		};
	});

	function onfocusout(event: FocusEvent) {
		const next = event.relatedTarget;
		if (!(next instanceof Node) || !section?.contains(next)) store.resume('focus');
	}
</script>

<section
	class="flags"
	aria-label="Benachrichtigungen"
	bind:this={section}
	onpointerenter={() => store.pause('hover')}
	onpointerleave={() => store.resume('hover')}
	onfocusin={() => store.pause('focus')}
	{onfocusout}
>
	<div class="visually-hidden" role="status">
		{#key store.statusMessage?.id}<p>{store.statusMessage?.text ?? ''}</p>{/key}
	</div>
	<div class="visually-hidden" role="alert">
		{#key store.alertMessage?.id}<p>{store.alertMessage?.text ?? ''}</p>{/key}
	</div>

	{#if store.flags.length > 0}
		<ol class="list">
			{#each store.flags as flag (flag.id)}
				{@const titleId = `${uid}-${flag.id}`}
				<li class={`flag tone-${flag.tone}`} data-overlay>
					<span class="icon">
						{#if flag.tone === 'error'}
							<ErrorIcon />
						{:else if flag.tone === 'success'}
							<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
								<circle cx="8" cy="8" r="7" />
								<path d="M5 8.2l2 2 4-4.4" />
							</svg>
						{:else}
							<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
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

<style>
	.flags {
		position: fixed;
		bottom: 1rem;
		left: 1rem;
		z-index: 20;
		width: min(24rem, calc(100vw - 2rem));
		pointer-events: none;
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
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-left: 3px solid var(--color-brand);
		border-radius: var(--radius-surface);
		pointer-events: auto;
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
