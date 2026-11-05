<script lang="ts">
	import { SERVER_PROBLEM_TEXTS } from '$lib/domain/server-problems';
	import { problemLog, type ProblemView } from '$lib/stores/problem-log.svelte';

	// The switch above the lists of the errors (FP-2, ADR-0077 §7; since FP-3 also on the page
	// "Fehlerprotokoll"): "Diese Sitzung (n)" with the number of the list of this tab and "Server", as
	// segments with aria-pressed. The owner keeps the choice.
	let {
		current,
		onchoose
	}: {
		current: ProblemView;
		onchoose: (view: ProblemView) => void;
	} = $props();
</script>

<div class="segmented" role="group" aria-label={SERVER_PROBLEM_TEXTS.views}>
	<button type="button" aria-pressed={current === 'session'} onclick={() => onchoose('session')}>
		{SERVER_PROBLEM_TEXTS.session} ({problemLog.count})
	</button>
	<button type="button" aria-pressed={current === 'server'} onclick={() => onchoose('server')}>
		{SERVER_PROBLEM_TEXTS.server}
	</button>
</div>

<style>
	.segmented {
		justify-self: start;
	}
</style>
