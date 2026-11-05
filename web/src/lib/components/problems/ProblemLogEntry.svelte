<script lang="ts">
	import { PROBLEM_LOG_TEXTS, SERVER_PROBLEM_TEXTS } from '$lib/domain/server-problems';
	import { problemLogHref } from '$lib/settings-sections';

	// The section "Fehlerprotokoll" of the page "Hilfe" (FP-3; before it the sections "Fehler dieser
	// Sitzung", FP-1, ADR-0071 §5, and "Fehlerprotokoll des Servers", FP-2, ADR-0077 §7), for every
	// account: what the list of this tab keeps and for how long, what the server keeps, who sees what
	// and what never goes in, and the link to the page "Fehlerprotokoll" in the look of a button.
</script>

<p>
	Hat etwas nicht geklappt? Unter „Details“ einer Fehlermeldung steht, was die App versucht hat und
	was der Server geantwortet hat. Diese Fehler und unerwartete Fehler sammelt die App für diesen
	Tab: Die Liste bleibt beim Neuladen erhalten, verschwindet mit dem Tab und verlässt den Browser
	nicht. Beim Abmelden und wenn sich ein anderes Konto anmeldet, leert die App sie.
</p>
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
	zu seinem Eintrag; der Bericht unter „Kopieren“ nennt seine Server-ID. Beide Listen stehen unter
	„Einstellungen → Fehlerprotokoll“, die des Servers mit Filtern nach Quelle und Bereich.
</p>
<p>
	<a class="button-secondary" href={problemLogHref()}>{PROBLEM_LOG_TEXTS.open}</a>
</p>
