<script lang="ts">
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { helpExamples } from '$lib/domain/recurrence-examples';
	import { dayLabel, joinWords, shortDate } from '$lib/domain/recurrence-text';

	// Section "Wiederholungen" of the help (plan "Wiederholungen verständlich machen", part A): what
	// the kinds, the lead time and the switch mean, three examples as timelines, special dates and
	// the rest, since plan WV with the template (what the next tickets get, "Auch für künftige
	// Tickets übernehmen", why nothing asks when a ticket appears), since WH-1 with "only the current
	// occurrence counts" and the switch "Verpasste Termine nachholen". Every date comes from
	// helpExamples(), which plays the scenarios with the decisions of the generation; nothing is
	// typed by hand (tests/unit/web-recurrence.test.mjs checks them
	// against the hook). The year of the examples is never shown. No table (like the whole help):
	// timelines are ordered lists, terms a description list.
	let { headingLevel = 3 }: { headingLevel?: 3 | 4 } = $props();

	const examples = helpExamples();
	const { fixed, completion, switch: each, calendar } = examples;

	/** "Mo 05.10." without the year of the example. */
	const day = (date: CalendarDate) => dayLabel(date, date);
	/** "31.01." without weekday and year. */
	const plain = (date: CalendarDate) => shortDate(date, date);
	const passedFixed = fixed.leftLong.carried.passed?.dates.map(plain) ?? [];
	const passedSwitch = each.doneWithout.passed?.count ?? 0;
	const nextWithout = each.doneWithout.nextDue === '' ? '' : day(each.doneWithout.nextDue);
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
				du früher oder später erledigst, ändert die Termine nicht. Erledigst du spät, geht es mit
				dem nächsten Termin nach dem Erledigen weiter, nie mit einem in der Vergangenheit.
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
			<dt>Verpasste Termine nachholen</dt>
			<dd>
				Aus (Standard): Es zählt nur das aktuelle Ticket der Serie. Bleibt es liegen, entsteht kein
				weiteres; es zeigt „überfällig seit“ mit seinem Termin, in der Liste, im Ticket und im
				Tagesplan. Erst wenn du es erledigst, entsteht das nächste, für den nächsten Termin nach dem
				Erledigen. Die Termine dazwischen gelten als übersprungen, das Ticket sagt es. An (nur
				fester Rhythmus, etwa für Miete): Jeder Termin bekommt sein eigenes Ticket, auch wenn
				frühere noch offen sind, und jedes zählt.
			</dd>
		</div>
	</dl>

	<svelte:element this={sub} class="example-title">
		Beispiel 1: Fester Rhythmus, jeden Montag, Vorlauf {fixed.lead}
	</svelte:element>
	<ol class="timeline">
		<li>
			Das Ticket für {day(fixed.first.due)} erscheint am {day(fixed.first.appeared)}
		</li>
		<li>
			Erledigt am {day(fixed.onTime.done)}: Das nächste ist {day(fixed.onTime.next.due)} fällig und erscheint
			am {day(fixed.onTime.next.appeared)}
		</li>
		<li>
			Zu früh erledigt ({day(fixed.early.done)}): Nichts ändert sich, das Ticket für {day(
				fixed.early.next.due
			)} erscheint trotzdem am {day(fixed.early.next.appeared)}
		</li>
		<li>
			Etwas später erledigt ({day(fixed.lateWithinLead.done)}): Auch dann erscheint das nächste wie
			geplant am {day(fixed.lateWithinLead.next.appeared)}
		</li>
		<li>
			Erst am {day(fixed.late.done)} erledigt: Solange das Ticket offen war, entstand kein neues. Das
			Ticket für {day(fixed.late.next.due)} erscheint erst jetzt, am {day(
				fixed.late.next.appeared
			)}; fällig bleibt {day(fixed.late.next.due)}
		</li>
		<li>
			Drei Wochen liegen gelassen: Es bleibt bei dem einen Ticket, es zeigt „überfällig seit {plain(
				fixed.leftLong.carried.due
			)}“. Erledigt am {day(fixed.leftLong.done)}: Die Montage {joinWords(passedFixed)} gelten als übersprungen,
			das Ticket sagt es. Das nächste ist {day(fixed.leftLong.next.due)} fällig, der erste Montag nach
			dem Erledigen, und erscheint am {day(fixed.leftLong.next.appeared)}; einen Montag in der
			Vergangenheit holt die Regel nicht nach
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
			und erscheint am {day(completion.onTime.next.appeared)}
		</li>
		<li>
			Früher erledigt ({day(completion.early.done)}): fällig {day(completion.early.next.due)}
		</li>
		<li>
			Später erledigt ({day(completion.late.done)}): fällig {day(completion.late.next.due)}
			Verpasste Termine gibt es hier nicht.
		</li>
		<li>
			Vorlauf größer als der Abstand (alle {completion.leadOverInterval.days} Tage, Vorlauf {completion
				.leadOverInterval.lead}): Das nächste Ticket erscheint sofort beim Erledigen am {day(
				completion.leadOverInterval.next.appeared
			)} und ist {day(completion.leadOverInterval.next.due)} fällig.
		</li>
		<li>
			Monatlich, immer am Fälligkeitstag erledigt: {completion.monthly.map(plain).join(' → ')} Der Tag
			wandert, weil jedes Mal ab dem Erledigen gerechnet wird. Für „immer am Monatsletzten“ nimm den festen
			Rhythmus mit „Letzter Tag“.
		</li>
	</ol>

	<svelte:element this={sub} class="example-title">
		Beispiel 3: „Verpasste Termine nachholen“, täglich, Vorlauf 0
	</svelte:element>
	<ol class="timeline">
		<li>
			{each.days} Tage nichts erledigt: ohne Schalter {each.openWithout} offenes Ticket, mit Schalter
			{each.openWith}.
		</li>
		<li>
			Danach am {day(each.doneWithout.done)} das älteste offene erledigt: ohne Schalter entsteht das nächste
			erst für den Tag danach ({nextWithout}), {passedSwitch} Termine gelten als übersprungen; mit Schalter
			entsteht {each.madeWith === 0 ? 'nichts Neues' : `${each.madeWith} neue`}, die anderen bleiben
			offen und zählen weiter.
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
			Faustregel: Schalter an, wenn jeder einzelne Termin zählt (Miete, Tabletten, Rechnungen); aus,
			wenn nur „mal wieder dran“ zählt (Spülmaschine ausräumen, Müll).
		</li>
	</ol>

	<svelte:element this={sub} class="example-title">Besondere Kalendertage</svelte:element>
	<ul class="list">
		<li>
			Monatlich am 31.: {calendar.day31.map(plain).join(', ')}, im Schaltjahr {plain(
				calendar.day31Leap
			)} In kürzeren Monaten gilt der letzte Tag, danach wieder der 31.; der Tag wandert nicht. „Letzter
			Tag“ gibt es als eigene Wahl.
		</li>
		<li>
			Jährlich am 29.02.: in Schaltjahren am {plain(calendar.feb29[0] ?? '')}, sonst am {plain(
				calendar.feb29[1] ?? ''
			)}
		</li>
		<li>
			Alle 2 Wochen am Montag und Freitag, Beginn {day(calendar.monFriStart)}: {calendar.monFri
				.map(day)
				.join(', ')} Gezählt wird ab der Woche des Beginns.
		</li>
	</ul>

	<svelte:element this={sub} class="example-title">Gut zu wissen</svelte:element>
	<ul class="list">
		<li>Die Fälligkeit eines Tickets der Serie zu verschieben, verschiebt die Serie nicht.</li>
		<li>
			Ein Ticket der Serie zu löschen, legt es in den Papierkorb: Der Termin gilt als übersprungen,
			die Regel läuft weiter, ohne Schalter mit dem nächsten Termin nach heute (wie „Aus der Serie
			lösen“). Hat die Serie beim Wiederherstellen schon ein offenes Ticket, bietet der Papierkorb
			an, es als normales Ticket zurückzuholen (aus der Serie lösen).
		</li>
		<li>
			Wieder öffnen: Nur das zuletzt erledigte Ticket nimmt ein eben entstandenes, unberührtes
			Folgeticket zurück. Ein älteres öffnest du als normales Ticket (aus der Serie lösen).
		</li>
		<li>Pausieren holt die Pause nicht nach; es geht mit dem nächsten Termin ab heute weiter.</li>
		<li>Eine Regel zu löschen, lässt ihre Tickets als normale Tickets stehen.</li>
		<li>„Neues Ticket“ mit „Wiederholen“: Das angelegte Ticket ist das erste der Serie.</li>
		<li>
			Folgetickets bekommen Titel, Beschreibung, Priorität, Projekt, Tags und den „Status beim
			Anlegen“ aus der Vorlage der Regel. Die Vorlage übernimmt beim Einrichten die Werte des
			Tickets. Mit welchem Status Folgetickets starten, fragt die App beim Anlegen der Regel
			(„Folgetickets starten mit“: „Offen“, „Wie dieses Ticket“ oder ein anderer Status), ohne
			Vorauswahl; ohne Wahl lässt sich die Regel nicht anlegen. Ansehen und ändern kannst du die
			Vorlage am Ticket unter „Wiederholt sich“ („Künftige Tickets“, „Bearbeiten“) oder im Panel der
			Regel unter „Wiederholungen“. Kommentare und Quellen gehen nicht mit.
		</li>
		<li>
			Unteraufgaben legst du in der Vorlage fest (Liste „Unteraufgaben“, höchstens 20, je mit Titel
			und Priorität, sortierbar). Jedes neue Ticket der Serie bekommt sie als neue, offene
			Unteraufgaben ohne Fälligkeit, auch beim Nachholen und mit „Verpasste Termine nachholen“. Am
			Ticket füllt „Unteraufgaben dieses Tickets übernehmen“ die Liste mit seinen Unteraufgaben
			(„Ergänzen“ oder „Ersetzen“, wenn schon welche darin stehen); von selbst kommen sie nicht in
			die Vorlage. Änderungen gelten nur für künftige Tickets. Nimmt das Wiedereröffnen des zuletzt
			erledigten Tickets ein unberührtes Folgeticket zurück, gehen seine Unteraufgaben mit; hast du
			eine davon geändert, kommentiert, entfernt oder eine hinzugefügt, ist es nicht mehr unberührt.
		</li>
		<li>
			Änderst du Titel, Beschreibung, Priorität, Projekt oder Tags eines offenen Tickets der Serie,
			gilt das zuerst nur für dieses Ticket. Ein Hinweis bietet „Auch für künftige Tickets
			übernehmen“ an, auch nach einer Änderung in der Tabelle oder für mehrere Tickets. Dasselbe
			gilt, wenn du einem offenen Ticket der Serie eine Unteraufgabe hinzufügst; Entfernen oder
			Umbenennen einer Unteraufgabe änderst du dagegen direkt in der Vorlage. Status und Fälligkeit
			gehören immer nur zum einzelnen Ticket.
		</li>
		<li>
			Eine Rückfrage beim Entstehen eines Tickets gibt es nicht: Folgetickets entstehen im
			Hintergrund zur festen Zeit, auch wenn die App gerade niemand ansieht. Was sie bekommen, legst
			du deshalb vorher in der Vorlage fest; gefragt wird einmal beim Anlegen der Regel.
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
