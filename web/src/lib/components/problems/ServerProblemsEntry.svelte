<script lang="ts">
	import { SERVER_PROBLEM_TEXTS } from '$lib/domain/server-problems';
	import { problemLog } from '$lib/stores/problem-log.svelte';

	// The way to the error log of the server (FP-2, ADR-0077) on the page "Hilfe", for every account:
	// what the server keeps, who sees what, for how long, and the button that opens the dialog of the
	// errors with the list "Server". Kept small and in one place, because FP-3 moves it to
	// "Einstellungen → Protokoll".
</script>

<p>
	Unerwartete Fehler des Servers, fehlgeschlagene Abrufe der Kanäle im Hintergrund und gescheiterte
	Aufgaben im Hintergrund hält der Server fest. Gleiche Fehler stehen in einem Eintrag mit ihrer
	Häufigkeit. Einen Eintrag deines privaten Bereichs siehst nur du, auch nicht der Verwalter; einen
	des Haushalts sehen alle Mitglieder, einen der App nur der Verwalter. {SERVER_PROBLEM_TEXTS.limits}
</p>
<p>
	Ein Eintrag enthält nur, was ihn erklärt: Absicht, Zeit, Fehlercode, eine bereinigte Meldung und
	etwa den Kanal oder den Pfad der Anfrage. Inhalte, Zugangsdaten, Tokens, E-Mail-Adressen und der
	Teil einer Adresse nach „?“ kommen nie hinein. „Details“ am letzten Fehler einer Kanal-Karte führt
	zu seinem Eintrag; der Bericht unter „Kopieren“ nennt seine Server-ID.
</p>
<p>
	<button
		class="button-secondary"
		type="button"
		aria-haspopup="dialog"
		onclick={() => problemLog.openServerLog()}
	>
		{SERVER_PROBLEM_TEXTS.open}
	</button>
</p>
