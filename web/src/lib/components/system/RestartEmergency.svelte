<script lang="ts">
	import type { Snippet } from 'svelte';
	import { EMERGENCY_TEXTS } from '$lib/domain/system';
	import type { RestartTask } from '$lib/guidance/texts';
	import { appContext } from '$lib/stores/context.svelte';

	// The emergency way of a restart (BW-1, ADR-0072): the files in the folder app, folded under a
	// summary that names it „Notfall“ (native details like "Mehr dazu" of the assistant), below
	// "Jetzt neu starten" and never instead of it. Only for the administrator on the machine of the
	// app under Windows, where the scripts are (KOB-1, ADR-0057); elsewhere nothing.
	let { task = 'restart', children }: { task?: RestartTask; children?: Snippet } = $props();
</script>

{#if appContext.capabilities.scripts}
	<details class="emergency">
		<summary>{EMERGENCY_TEXTS.summary}</summary>
		<div class="body">
			<p>{task === 'restart' ? EMERGENCY_TEXTS.restart : EMERGENCY_TEXTS.mail}</p>
			{@render children?.()}
			{#if task === 'restart'}
				<p>{EMERGENCY_TEXTS.restartDown}</p>
			{/if}
		</div>
	</details>
{/if}

<style>
	.emergency {
		font-size: var(--font-size-body);
	}

	summary {
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.body {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
		margin-top: 0.5rem;
	}
</style>
