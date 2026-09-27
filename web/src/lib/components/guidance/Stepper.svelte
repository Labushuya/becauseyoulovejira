<script lang="ts">
	import type { StepState } from '$lib/domain/channel-setup';
	import Popover from '../overlay/Popover.svelte';
	import GuidanceIcon from './GuidanceIcon.svelte';

	// Stepper of the assistant (ADS "progress tracker", ADR-0026 section 4, plan EH-5 §3.7/§3.11):
	// an ordered list in a named navigation, each step a button with its number and label and a
	// hidden state ("Schritt 2 von 6: Variable setzen, erledigt"). The current one carries
	// aria-current="step". No step is locked, so every one can be chosen. The bar above is only
	// decoration (aria-hidden); "Schritt n von m" stands visibly in the heading of the step. Below
	// 40rem the list gives way to "Schritt 2 von 6 · Variable setzen" and a menu "Alle Schritte".
	// Not an overlay.
	let {
		steps,
		current,
		onselect
	}: {
		steps: readonly { id: string; label: string; state: StepState }[];
		current: number;
		onselect: (index: number) => void;
	} = $props();

	const STATE_TEXT: Readonly<Record<StepState, string>> = {
		current: 'aktuell',
		done: 'erledigt',
		open: 'offen',
		warning: 'Prüfung offen'
	};

	const total = $derived(steps.length);
	const progress = $derived(total <= 1 ? 100 : Math.round((current / (total - 1)) * 100));
	const currentLabel = $derived(steps[current]?.label ?? '');

	function nameOf(index: number): string {
		const step = steps[index];
		if (step === undefined) return '';
		return `Schritt ${index + 1} von ${total}: ${step.label}, ${STATE_TEXT[step.state]}`;
	}
</script>

<nav class="stepper" aria-label="Schritte der Einrichtung">
	<div class="bar" aria-hidden="true"><span class="fill" style:width={`${progress}%`}></span></div>
	<ol class="steps">
		{#each steps as step, index (step.id)}
			<li>
				<button
					type="button"
					class="step"
					data-state={step.state}
					aria-current={index === current ? 'step' : undefined}
					onclick={() => onselect(index)}
				>
					<span class="mark" aria-hidden="true">
						{#if step.state === 'done'}
							<GuidanceIcon name="check" size={14} />
						{:else if step.state === 'warning'}
							!
						{:else}
							{index + 1}
						{/if}
					</span>
					<span class="text" aria-hidden="true">
						<span class="label">{step.label}</span>
						{#if step.state === 'warning'}
							<span class="note">Prüfung offen</span>
						{/if}
					</span>
					<span class="visually-hidden">{nameOf(index)}</span>
				</button>
			</li>
		{/each}
	</ol>
	<div class="compact">
		<span class="position">Schritt {current + 1} von {total} · {currentLabel}</span>
		<Popover kind="menu" label="Alle Schritte" buttonClass="button-subtle" placement="bottom-end">
			{#snippet button()}Alle Schritte{/snippet}
			{#snippet children({ close })}
				{#each steps as step, index (step.id)}
					<button
						class="item"
						type="button"
						role="menuitemradio"
						aria-checked={index === current}
						tabindex="-1"
						onclick={() => {
							close();
							onselect(index);
						}}
					>
						{nameOf(index)}
					</button>
				{/each}
			{/snippet}
		</Popover>
	</div>
</nav>

<style>
	.stepper {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
	}

	.bar {
		height: 3px;
		overflow: hidden;
		background: var(--color-line);
		border-radius: var(--radius-pill);
	}

	.fill {
		display: block;
		height: 100%;
		background: var(--color-brand);
		transition: width var(--motion-medium) var(--motion-ease);
	}

	.steps {
		display: grid;
		grid-auto-columns: minmax(0, 1fr);
		grid-auto-flow: column;
		gap: 0.25rem;
		list-style: none;
	}

	.step {
		display: flex;
		gap: 0.375rem;
		align-items: flex-start;
		width: 100%;
		padding: 0.25rem;
		font: inherit;
		font-size: 0.8125rem;
		text-align: left;
		color: var(--color-text-muted);
		background: none;
		border: none;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.step:hover {
		color: var(--color-text);
	}

	.mark {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		font-size: 0.75rem;
		font-weight: 600;
		border: 1px solid var(--color-line);
		border-radius: 50%;
	}

	.text {
		display: grid;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.note {
		font-size: 0.75rem;
	}

	/* Current: brand colour, bold, filled mark; done: check mark; warning: "!" and its note. */
	.step[aria-current='step'] {
		font-weight: 600;
		color: var(--color-brand-text);
	}

	.step[aria-current='step'] .mark {
		color: var(--color-on-brand);
		background: var(--color-brand);
		border-color: var(--color-brand);
	}

	.step[data-state='done'] .mark {
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
	}

	.step[data-state='warning'] .mark {
		color: var(--color-text);
		border-color: var(--color-text-muted);
	}

	.compact {
		display: none;
		gap: 0.5rem;
		align-items: center;
		justify-content: space-between;
		font-size: 0.8125rem;
	}

	.item {
		display: block;
		width: 100%;
		padding: 0.375rem 0.75rem;
		font: inherit;
		font-size: 0.8125rem;
		text-align: left;
		color: var(--color-text);
		background: none;
		border: none;
		cursor: pointer;
	}

	.item[aria-checked='true'] {
		font-weight: 600;
	}

	@media (max-width: 40rem) {
		.steps {
			display: none;
		}

		.compact {
			display: flex;
		}
	}
</style>
