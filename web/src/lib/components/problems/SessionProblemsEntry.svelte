<script lang="ts">
	import { PROBLEM_TEXTS } from '$lib/domain/problems';
	import { problemLog } from '$lib/stores/problem-log.svelte';

	// The lasting way to the list "Fehler dieser Sitzung" (FP-1, ADR-0071 §5) for every account, on
	// the page "Hilfe": two sentences and the button with the number. Kept small and in one place,
	// because FP-3 moves it to "Einstellungen → Protokoll".
</script>

<p>
	Hat etwas nicht geklappt? Unter „Details“ einer Fehlermeldung steht, was die App versucht hat und
	was der Server geantwortet hat. Diese Fehler und unerwartete Fehler sammelt die App für diesen
	Tab: Die Liste bleibt beim Neuladen erhalten, verschwindet mit dem Tab und verlässt den Browser
	nicht.
</p>
<p>
	<button
		class="button-secondary"
		type="button"
		aria-haspopup="dialog"
		onclick={() => problemLog.openDialog()}
	>
		{PROBLEM_TEXTS.listTitle} anzeigen ({problemLog.count})
	</button>
</p>
