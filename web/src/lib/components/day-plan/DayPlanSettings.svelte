<script lang="ts">
	import {
		DAY_PLAN_SOURCES,
		MODE_LABELS,
		SOURCE_LABELS,
		SOURCE_MODES,
		type DayPlanSource,
		type SourceMode
	} from '$lib/domain/day-plan';
	import type { DayPlanStore } from '$lib/stores/day-plan.svelte';
	import Field from '../form/Field.svelte';
	import Popover from '../overlay/Popover.svelte';

	// The sources of the suggestions of the area (ADR-0065 §3): each one "Aus", "Vorschlagen" or
	// "Automatisch übernehmen", in a popover of the kind "panel" next to "Vorschläge". A choice saves at
	// once and the plan of today follows; the private area belongs to the account, the household to
	// every member alike, which the text below says. Native selects in fields (UI-1, ADR-0060).
	let { store, household = false }: { store: DayPlanStore; household?: boolean } = $props();

	const uid = $props.id();
	const legendId = `${uid}-legend`;

	function choose(source: DayPlanSource, event: Event & { currentTarget: HTMLSelectElement }) {
		const value = event.currentTarget.value as SourceMode;
		if (!SOURCE_MODES.includes(value)) return;
		void store.saveSetting(source, value);
	}
</script>

{#snippet button()}
	<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
		<path d="M3 4.5h10M3 8h10M3 11.5h10" />
		<circle cx="6" cy="4.5" r="1.25" />
		<circle cx="10" cy="8" r="1.25" />
		<circle cx="6" cy="11.5" r="1.25" />
	</svg>
	Einstellen
{/snippet}

<div class="day-plan-settings">
	<Popover
		kind="panel"
		labelledby={legendId}
		placement="bottom-end"
		buttonClass="button-subtle button-small"
		{button}
	>
		<fieldset aria-busy={store.settingsSaving ? 'true' : undefined}>
			<legend id={legendId}>Quellen der Vorschläge</legend>
			<p class="hint">
				{household
					? 'Gilt für den gemeinsamen Plan des Haushalts; jedes Mitglied kann es einstellen.'
					: 'Gilt für deinen privaten Tagesplan.'}
				„Automatisch übernehmen“ setzt die Tickets beim ersten Öffnen des Tages ohne Rückfrage in den
				Plan.
			</p>
			{#each DAY_PLAN_SOURCES as source (source)}
				<Field label={SOURCE_LABELS[source]} width="auto">
					{#snippet control(field)}
						<select
							{...field}
							value={store.settings[source]}
							onchange={(event) => choose(source, event)}
						>
							{#each SOURCE_MODES as mode (mode)}
								<option value={mode}>{MODE_LABELS[mode]}</option>
							{/each}
						</select>
					{/snippet}
				</Field>
			{/each}
		</fieldset>
	</Popover>
</div>

<style>
	.day-plan-settings :global(.button-small svg) {
		width: 0.875rem;
		height: 0.875rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	fieldset {
		display: grid;
		gap: 0.625rem;
		min-width: 0;
		max-width: 22rem;
		margin: 0;
		padding: 0.25rem;
		border: none;
	}

	legend {
		margin-bottom: 0.25rem;
		font-weight: 600;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
