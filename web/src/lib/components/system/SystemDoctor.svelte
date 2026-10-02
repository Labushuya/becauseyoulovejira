<script lang="ts">
	import Lozenge from '$lib/components/guidance/Lozenge.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import type { GuidanceIconName } from '$lib/components/guidance/GuidanceIcon.svelte';
	import { DOCTOR_LEVEL_LABELS, type DoctorLevel, type DoctorResult } from '$lib/domain/system';
	import type { SystemPart } from '$lib/stores/system.svelte';
	import ScriptProblemDetails from './ScriptProblemDetails.svelte';

	// Result of "Umgebung prüfen" on the page System (ADR-0043): the checks of doctor as a list, each
	// with a lozenge for its level and the German text of the control script. Red only for a real
	// error (ADR-0009); a warning is neutral with its icon. A check that found a problem opens its
	// entry of the catalog of the scripts under "Was tun?" (ADR-0048): cause, steps and command.
	let { part }: { part: SystemPart<DoctorResult> } = $props();

	const LOOK: Readonly<
		Record<DoctorLevel, { icon: GuidanceIconName; tone: 'neutral' | 'brand' | 'danger' | 'muted' }>
	> = {
		ok: { icon: 'check', tone: 'brand' },
		warning: { icon: 'warning', tone: 'neutral' },
		error: { icon: 'error', tone: 'danger' },
		info: { icon: 'info', tone: 'muted' }
	};

	const errors = $derived(
		part.value === null ? 0 : part.value.checks.filter((check) => check.level === 'error').length
	);
	const summary = $derived(
		errors === 0
			? 'Keine Fehler gefunden.'
			: errors === 1
				? '1 Fehler gefunden.'
				: `${errors} Fehler gefunden.`
	);
</script>

<div class="doctor" role="status">
	{#if part.state === 'loading'}
		<p class="note">Wird geprüft …</p>
	{:else if part.message !== null}
		<SectionMessage tone={part.state === 'error' ? 'error' : 'warning'} title={part.message.title}>
			{part.message.text}
		</SectionMessage>
	{:else if part.value !== null}
		<p class="summary">{summary}</p>
	{/if}
</div>
{#if part.state !== 'loading' && part.value !== null}
	<ul class="checks" aria-label="Ergebnis der Prüfung">
		{#each part.value.checks as check, index (`${check.name}-${index}`)}
			<li>
				<Lozenge
					label={DOCTOR_LEVEL_LABELS[check.level]}
					icon={LOOK[check.level].icon}
					tone={LOOK[check.level].tone}
				/>
				<div class="text">
					<span>{check.text}</span>
					{#if check.report !== null}
						<details class="remedy">
							<summary>Was tun?</summary>
							<ScriptProblemDetails report={check.report} />
						</details>
					{/if}
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.note,
	.summary {
		font-size: var(--font-size-body);
	}

	.note {
		color: var(--color-text-muted);
	}

	.summary {
		font-weight: 500;
	}

	.checks {
		display: grid;
		gap: 0;
		list-style: none;
		border-top: 1px solid var(--color-line);
	}

	.checks li {
		display: grid;
		grid-template-columns: 7.5rem minmax(0, 1fr);
		gap: 0.75rem;
		align-items: baseline;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--color-line);
	}

	.text {
		display: grid;
		gap: 0.375rem;
		min-width: 0;
		font-size: var(--font-size-body);
		overflow-wrap: anywhere;
	}

	.remedy summary {
		font-size: var(--font-size-body);
		cursor: pointer;
	}

	.remedy[open] summary {
		margin-bottom: 0.5rem;
	}
</style>
