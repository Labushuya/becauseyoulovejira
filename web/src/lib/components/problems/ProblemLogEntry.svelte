<script lang="ts">
	import { PROBLEM_LOG_TEXTS } from '$lib/domain/server-problems';
	import { problemLogHref } from '$lib/settings-sections';

	// The section "Fehlerprotokoll" of the page "Hilfe" (FP-3; before it the sections "Fehler dieser
	// Sitzung", FP-1, ADR-0071 §5, and "Fehlerprotokoll des Servers", FP-2, ADR-0077 §7), for every
	// account: one paragraph with the core of the privacy of both lists (where the list of this tab
	// stays and when it goes, what the server keeps and for how long, who sees what, what never goes
	// in), then the link to the page "Fehlerprotokoll" in the look of a button.
</script>

<p>
	Die Fehler dieses Tabs bleiben im Browser: Die Liste übersteht das Neuladen und verschwindet, wenn
	du den Tab schließt, die Anmeldung endet oder sich ein anderes Konto anmeldet. Unerwartete Fehler
	des Servers sowie Fehler der Kanäle und der Aufgaben im Hintergrund behält der Server 30 Tage nach
	dem letzten Auftreten, höchstens 5000. Einen Eintrag deines privaten Bereichs siehst nur du, nicht
	einmal der Verwalter; einen des Haushalts sehen alle Mitglieder, einen der App nur der Verwalter.
	Inhalte, Zugangsdaten, Tokens, E-Mail-Adressen und der Teil einer Adresse nach „?“ kommen nie
	hinein.
</p>
<p>
	<a class="button-secondary" href={problemLogHref()}>{PROBLEM_LOG_TEXTS.open}</a>
</p>
