<script lang="ts">
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import {
		FIRST_STEP_IDS,
		firstStepsProgress,
		progressText,
		showsFirstSteps,
		type FirstStepId
	} from '$lib/domain/first-steps';
	import { getQuickCaptureOpener } from '$lib/quick-capture-context';
	import type { FirstStepsStore } from '$lib/stores/first-steps.svelte';
	import GuidanceIcon from './guidance/GuidanceIcon.svelte';

	// "Erste Schritte" (ADR-0026 section 7, plan EH-12, user decision 3): a checklist below the empty
	// state of "Aufgaben" with its progress ("2 von 4 erledigt"), a check mark per reached step and
	// a way to each open one. The user can hide it for good (remembered on this device); it also
	// disappears once every offered step is done. "Kurze Einführung starten" is only offered where
	// the tour can be started (`onstarttour`, EH-13), so there is never a dead entry.
	let {
		store,
		onstarttour
	}: {
		store: FirstStepsStore;
		/** Starts the guided tour; without it the step is not offered. */
		onstarttour?: () => void;
	} = $props();

	const uid = $props.id();
	const ids = { heading: `${uid}-heading`, progress: `${uid}-progress` };

	const openQuickCapture = getQuickCaptureOpener();
	const available = $derived(
		FIRST_STEP_IDS.filter((id) => id !== 'tour' || onstarttour !== undefined)
	);
	const progress = $derived(firstStepsProgress(store.state, available));
	const visible = $derived(showsFirstSteps(store.state, available));

	const LINKS: Partial<Record<FirstStepId, { href: ResolvedPathname; text: string }>> = {
		ticket: { href: resolve('/tickets/neu'), text: 'Ticket anlegen' },
		channel: { href: resolve('/einstellungen/kanaele'), text: 'Kanäle öffnen' },
		project: { href: resolve('/projekte/neu'), text: 'Projekt anlegen' }
	};

	/** Hides the list; its button disappears, so the focus goes to the heading of the view. */
	async function dismiss() {
		store.dismiss();
		await tick();
		document.querySelector<HTMLElement>('[data-view-heading]')?.focus();
	}
</script>

{#if visible}
	<section class="first-steps" aria-labelledby={ids.heading}>
		<div class="head">
			<h3 id={ids.heading}>Erste Schritte</h3>
			<button
				class="button-icon"
				type="button"
				aria-label="Erste Schritte ausblenden"
				title="Erste Schritte ausblenden"
				onclick={() => void dismiss()}
			>
				<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
					<path d="M4 4l8 8M12 4l-8 8" />
				</svg>
			</button>
		</div>
		<p class="progress-text" id={ids.progress}>{progressText(progress)}</p>
		<progress max={progress.total} value={progress.done} aria-labelledby={ids.progress}></progress>
		<ol>
			{#each progress.items as item (item.id)}
				{@const link = LINKS[item.id]}
				<li class:done={item.done}>
					<span class="mark">
						<GuidanceIcon name={item.done ? 'success' : 'pending'} size={16} />
					</span>
					<span class="label">
						{item.label}<span class="visually-hidden">{item.done ? ', erledigt' : ', offen'}</span>
					</span>
					{#if !item.done}
						{#if link}
							<a class="button-subtle" href={link.href}>{link.text}</a>
						{:else if item.id === 'quick' && openQuickCapture}
							<button class="button-subtle" type="button" onclick={openQuickCapture}>
								Öffnen <kbd>c</kbd>
							</button>
						{:else if item.id === 'tour' && onstarttour}
							<button class="button-subtle" type="button" onclick={onstarttour}>Starten</button>
						{/if}
					{/if}
				</li>
			{/each}
		</ol>
	</section>
{/if}

<style>
	.first-steps {
		display: grid;
		gap: 0.5rem;
		width: 100%;
		max-width: 29rem;
		margin: 0 auto 1.5rem;
		padding: 1rem 1.125rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.head {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		justify-content: space-between;
	}

	h3 {
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.head svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	.progress-text {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	progress {
		width: 100%;
		height: 0.375rem;
		accent-color: var(--color-brand);
	}

	ol {
		display: grid;
		gap: 0.375rem;
		list-style: none;
	}

	li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
		font-size: 0.875rem;
	}

	.mark {
		display: inline-flex;
		color: var(--color-text-muted);
	}

	.label {
		flex: 1 1 10rem;
	}

	/* A reached step: check mark in the brand colour and struck through, never colour alone. */
	.done .mark {
		color: var(--color-brand-text);
	}

	.done .label {
		color: var(--color-text-muted);
		text-decoration: line-through;
	}
</style>
