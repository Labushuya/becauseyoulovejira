<script lang="ts">
	import { parseCalendarDate, type CalendarDate } from '$lib/domain/berlin-date';
	import { helpExamples } from '$lib/domain/recurrence-examples';
	import { dayLabel, joinWords, shortDate } from '$lib/domain/recurrence-text';

	// Section "Wiederholungen" of the help (plan "Wiederholungen verständlich machen", part A): what
	// the kinds, the lead time and the switch mean, three examples as timelines, special dates and
	// the rest. Every date comes from helpExamples(), which plays the scenarios with the decisions
	// of the generation; nothing is typed by hand (tests/unit/web-recurrence.test.mjs checks them
	// against the hook). The year of the examples is never shown. No table (like the whole help):
	// timelines are ordered lists, terms a description list.
	let { headingLevel = 3 }: { headingLevel?: 3 | 4 } = $props();

	const examples = helpExamples();
	const { fixed, completion, switch: each, calendar } = examples;

	/** "Mo 05.10." without the year of the example. */
	const day = (date: CalendarDate) => dayLabel(date, date);
	/** "31.01." without weekday and year. */
	const plain = (date: CalendarDate) => shortDate(date, date);
	const DAY_MS = 24 * 60 * 60 * 1000;
	const daysBetween = (from: CalendarDate, to: CalendarDate) =>
		Math.round((parseCalendarDate(to) - parseCalendarDate(from)) / DAY_MS);
	const overdue = daysBetween(fixed.leftLong.next.due, fixed.leftLong.done);
	const skippedFixed = fixed.leftLong.next.skipped?.dates.map(plain) ?? [];
	const skippedSwitch = each.doneWithout.skipped?.count ?? 0;
	const offSkipped = each.offWithout.skipped?.count ?? 0;
	const sub = $derived(`h${headingLevel + 1}`);
</script>

<div class="recurrence-help">
	<p>
		Eine Regel legt Tickets für dich an, eines nach dem anderen. Du wählst, wonach sie sich richtet.
	</p>
	<dl class="terms">
		<div class="row">
			<dt>Fester Rhythmus</dt>
			<dd>
				An welchen Kalendertagen ist es dran? Etwa Müll am Montag, Miete am 1., ein Geburtstag. Ob
				du früher oder später erledigst, ändert die Termine nicht.
			</dd>
		</div>
		<div class="row">
			<dt>Nach Erledigung</dt>
			<dd>
				Wie lange nach dem letzten Mal ist es wieder dran? Etwa Filter wechseln, Friseur, Auto
				waschen. Der nächste Termin zählt ab dem Tag, an dem du erledigst.
			</dd>
		</div>
		<div class="row">
			<dt>Vorlauf (Tage)</dt>
			<dd>
				So viele Tage vor der Fälligkeit erscheint das Ticket. 0 heißt: am Tag selbst, kurz nach
				Mitternacht.
			</dd>
		</div>
		<div class="row">
			<dt>Jeden Termin einzeln anlegen</dt>
			<dd>
				Aus (Standard): Solange ein Ticket der Serie offen ist, entsteht kein weiteres; verpasste
				Termine werden zu einem zusammengefasst. An (nur fester Rhythmus): Jeder Termin bekommt sein
				eigenes Ticket, auch wenn frühere noch offen sind.
			</dd>
		</div>
	</dl>

	<svelte:element this={sub} class="example-title">
		Beispiel 1: Fester Rhythmus, jeden Montag, Vorlauf {fixed.lead}
	</svelte:element>
	<ol class="timeline">
		<li>
			Das Ticket für {day(fixed.first.due)} erscheint am {day(fixed.first.appeared)}.
		</li>
		<li>
			Erledigt am {day(fixed.onTime.done)}: Das nächste ist {day(fixed.onTime.next.due)} fällig und erscheint
			am {day(fixed.onTime.next.appeared)}.
		</li>
		<li>
			Zu früh erledigt ({day(fixed.early.done)}): Nichts ändert sich, das Ticket für {day(
				fixed.early.next.due
			)} erscheint trotzdem am {day(fixed.early.next.appeared)}.
		</li>
		<li>
			Etwas später erledigt ({day(fixed.lateWithinLead.done)}): Auch dann erscheint das nächste wie
			geplant am {day(fixed.lateWithinLead.next.appeared)}.
		</li>
		<li>
			Erst am {day(fixed.late.done)} erledigt: Solange das Ticket offen war, entstand kein neues. Das
			Ticket für {day(fixed.late.next.due)} erscheint erst jetzt, am {day(
				fixed.late.next.appeared
			)}; fällig bleibt {day(fixed.late.next.due)}.
		</li>
		<li>
			Drei Wochen liegen gelassen, erledigt am {day(fixed.leftLong.done)}: Die verpassten Montage
			werden zusammengefasst. Es entsteht ein Ticket, fällig {day(fixed.leftLong.next.due)} (schon
			{overdue === 1 ? '1 Tag' : `${overdue} Tage`} überfällig); {joinWords(skippedFixed)} gelten als
			übersprungen, das Ticket sagt es. Danach geht es normal weiter: Das Ticket für {day(
				fixed.leftLong.after.due
			)} erscheint am {day(fixed.leftLong.after.appeared)}.
		</li>
		<li>
			Mit Vorlauf 0 erscheint das Ticket am Montag selbst ({day(fixed.leadZero.appeared)}).
		</li>
	</ol>

	<svelte:element this={sub} class="example-title">
		Beispiel 2: Nach Erledigung, alle {completion.weeks} Wochen, Vorlauf {completion.lead}
	</svelte:element>
	<ol class="timeline">
		<li>
			Erledigt am {day(completion.onTime.done)}: Das nächste ist {day(completion.onTime.next.due)} fällig
			und erscheint am {day(completion.onTime.next.appeared)}.
		</li>
		<li>
			Früher erledigt ({day(completion.early.done)}): fällig {day(completion.early.next.due)}.
		</li>
		<li>
			Später erledigt ({day(completion.late.done)}): fällig {day(completion.late.next.due)}.
			Verpasste Termine gibt es hier nicht.
		</li>
		<li>
			Vorlauf größer als der Abstand (alle {completion.leadOverInterval.days} Tage, Vorlauf {completion
				.leadOverInterval.lead}): Das nächste Ticket erscheint sofort beim Erledigen am {day(
				completion.leadOverInterval.next.appeared
			)} und ist {day(completion.leadOverInterval.next.due)} fällig.
		</li>
		<li>
			Monatlich, immer am Fälligkeitstag erledigt: {completion.monthly.map(plain).join(' → ')}. Der
			Tag wandert, weil jedes Mal ab dem Erledigen gerechnet wird. Für „immer am Monatsletzten“ nimm
			den festen Rhythmus mit „Letzter Tag“.
		</li>
	</ol>

	<svelte:element this={sub} class="example-title">
		Beispiel 3: „Jeden Termin einzeln anlegen“, täglich, Vorlauf 0
	</svelte:element>
	<ol class="timeline">
		<li>
			{each.days} Tage nichts erledigt: ohne Schalter {each.openWithout} offenes Ticket, mit Schalter
			{each.openWith}.
		</li>
		<li>
			Danach das älteste offene erledigt: ohne Schalter entsteht ein neues für heute ({day(
				each.doneWithout.due
			)}), {skippedSwitch} Termine gelten als übersprungen; mit Schalter entsteht
			{each.madeWith === 0 ? 'nichts Neues' : `${each.madeWith} neue`}, die anderen bleiben offen.
		</li>
		<li>
			App {each.offDays} Tage aus: ohne Schalter ein Ticket für heute ({offSkipped} Termine übersprungen).
			Mit Schalter fehlen mehr als {each.limit} Termine; die Regel legt deshalb nichts an und fragt dich{each.offWaiting
				? ''
				: ' nicht'}: „Alle nachholen“ legt {each.offAllFirst} sofort und {each.offAllSecond} in der nächsten
			Stunde an, „Nur ab heute“ nur das Ticket von heute ({each.offTodaySkipped}
			Termine übersprungen).
		</li>
		<li>
			Faustregel: Schalter an, wenn jeder einzelne Termin zählt (Tabletten, Rechnungen); aus, wenn
			nur „mal wieder dran“ zählt.
		</li>
	</ol>

	<svelte:element this={sub} class="example-title">Besondere Kalendertage</svelte:element>
	<ul class="list">
		<li>
			Monatlich am 31.: {calendar.day31.map(plain).join(', ')}, im Schaltjahr {plain(
				calendar.day31Leap
			)}. In kürzeren Monaten gilt der letzte Tag, danach wieder der 31.; der Tag wandert nicht.
			„Letzter Tag“ gibt es als eigene Wahl.
		</li>
		<li>
			Jährlich am 29.02.: in Schaltjahren am {plain(calendar.feb29[0] ?? '')}, sonst am {plain(
				calendar.feb29[1] ?? ''
			)}.
		</li>
		<li>
			Alle 2 Wochen am Montag und Freitag, Beginn {day(calendar.monFriStart)}: {calendar.monFri
				.map(day)
				.join(', ')}. Gezählt wird ab der Woche des Beginns.
		</li>
	</ul>

	<svelte:element this={sub} class="example-title">Gut zu wissen</svelte:element>
	<ul class="list">
		<li>Die Fälligkeit eines Tickets der Serie zu verschieben, verschiebt die Serie nicht.</li>
		<li>
			Ein Ticket der Serie zu löschen, legt es in den Papierkorb: Der Termin gilt als übersprungen,
			die Regel läuft weiter. Hat die Serie beim Wiederherstellen schon ein offenes Ticket, bietet
			der Papierkorb an, es als normales Ticket zurückzuholen (aus der Serie lösen).
		</li>
		<li>
			Wieder öffnen: Nur das zuletzt erledigte Ticket nimmt ein eben entstandenes, unberührtes
			Folgeticket zurück. Ein älteres öffnest du als normales Ticket (aus der Serie lösen).
		</li>
		<li>Pausieren holt die Pause nicht nach; es geht mit dem nächsten Termin ab heute weiter.</li>
		<li>Eine Regel zu löschen, lässt ihre Tickets als normale Tickets stehen.</li>
		<li>„Neues Ticket“ mit „Wiederholen“: Das angelegte Ticket ist das erste der Serie.</li>
		<li>
			Folgetickets bekommen Titel, Beschreibung, Projekt, Tags und Priorität aus der Vorlage der
			Regel (beim Einrichten übernommen, ändern kannst du sie im Panel der Regel unter
			„Wiederholungen“). Unteraufgaben, Kommentare und Quellen gehen nicht mit.
		</li>
		<li>
			Tickets haben keine Uhrzeit. Sie entstehen, wenn die App läuft: jede Stunde um 7 nach, der
			erste Lauf eines Tages also kurz nach Mitternacht; war die App aus, sobald sie wieder läuft.
		</li>
	</ul>
</div>

<style>
	.recurrence-help {
		display: grid;
		gap: 0.625rem;
	}

	p,
	li,
	dt,
	dd {
		font-size: var(--font-size-body);
	}

	.terms {
		display: grid;
		border-top: 1px solid var(--color-line);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		padding: 0.375rem 0;
		border-bottom: 1px solid var(--color-line);
	}

	.row dt {
		flex: 0 0 13rem;
		font-weight: 500;
	}

	.row dd {
		flex: 1 1 18rem;
		max-width: 80ch;
	}

	.example-title {
		margin-top: 0.5rem;
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	/* A timeline: numbered steps with a line on their left, no table (the help has none). */
	.timeline {
		display: grid;
		gap: 0.375rem;
		padding-left: 1.5rem;
		border-left: 2px solid var(--color-line);
		max-width: 80ch;
	}

	.list {
		display: grid;
		gap: 0.25rem;
		padding-left: 1.25rem;
		max-width: 80ch;
	}
</style>
