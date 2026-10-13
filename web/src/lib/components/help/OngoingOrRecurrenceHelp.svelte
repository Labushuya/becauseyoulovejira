<script lang="ts">
	import { helpHref } from '$lib/settings-sections';

	// Section "Laufendes Vorhaben oder Wiederholung?" of the help (VH-1, ADR-0065 addendum VH-1):
	// both bring a matter back every day, in different ways. The comparison of the two over five
	// points and the rule of thumb; linked from the switch "Laufendes Vorhaben" (KindSwitch). Like the
	// whole help it has no table: the comparison is a description list, one row per point, each value
	// named with its side. From 48rem the rows stand in three columns below a heading row for the eye
	// (hidden from screen readers, which hear the side with every value); narrower each row stacks
	// with the side above its value, so nothing scrolls sideways.
	const SIDES = { ongoing: 'Laufendes Vorhaben', recurrence: 'Tägliche Wiederholung' } as const;

	const POINTS: readonly { point: string; ongoing: string; recurrence: string }[] = [
		{
			point: 'Tickets',
			ongoing: 'Ein Ticket bleibt offen; Notizen und Kommentare sammeln sich darin.',
			recurrence: 'Jeden Tag ein neues Ticket.'
		},
		{
			point: 'Tagesplan',
			ongoing: 'Steht jeden Tag automatisch im Plan.',
			recurrence: 'Wird vorgeschlagen, wenn das Ticket fällig ist.'
		},
		{
			point: 'Haken',
			ongoing: '„Heute daran gearbeitet“; das Ticket bleibt offen.',
			recurrence: 'Erledigt das Ticket; das nächste entsteht.'
		},
		{
			point: 'Verpasster Tag',
			ongoing: 'Nichts bleibt liegen.',
			recurrence: 'Das Ticket bleibt stehen, „überfällig seit …“.'
		},
		{
			point: 'Abschluss',
			ongoing: 'Einmal, wenn es fertig ist.',
			recurrence: 'Jedes Vorkommen für sich.'
		}
	];
</script>

<div class="kind-help">
	<p>
		Beides bringt dich jeden Tag zu einer Sache zurück, aber auf verschiedene Weise. Ein laufendes
		Vorhaben ist ein einziges Ticket, an dem du über längere Zeit arbeitest, etwa ein Sprachkurs.
		Eine tägliche Wiederholung legt für jeden Tag ein eigenes Ticket an, etwa „Pflanzen gießen“.
	</p>

	<div class="compare">
		<div class="compare-head" aria-hidden="true">
			<span></span>
			<span>{SIDES.ongoing}</span>
			<span>{SIDES.recurrence}</span>
		</div>
		<dl>
			{#each POINTS as entry (entry.point)}
				<div class="compare-row">
					<dt>{entry.point}</dt>
					<dd><span class="side">{`${SIDES.ongoing}: `}</span>{entry.ongoing}</dd>
					<dd><span class="side">{`${SIDES.recurrence}: `}</span>{entry.recurrence}</dd>
				</div>
			{/each}
		</dl>
	</div>

	<p class="rule">
		<strong>Faustregel:</strong> Musst du es jedes Mal einzeln erledigen
		<span aria-hidden="true">→</span><span class="visually-hidden">, dann</span> Wiederholung.
		Arbeitest du über längere Zeit an einer Sache und willst täglich erinnert werden
		<span aria-hidden="true">→</span><span class="visually-hidden">, dann</span> Laufendes Vorhaben.
	</p>

	<p>
		Ein Ticket wird zum Vorhaben mit dem Schalter „Laufendes Vorhaben“ unter „Art“ (im Ticket und in
		„Neues Ticket“ unter „Weitere Optionen“) oder im Menü eines Eintrags im Tagesplan. Eine
		Wiederholung legst du mit „Wiederholen…“ an (<a href={helpHref('wiederholungen')}
			>mehr zu Wiederholungen</a
		>). In „Aufgaben“ zeigt der Filter „Art“ nur Aufgaben oder nur laufende Vorhaben, und
		„Gruppieren“ bietet „Nach Art“.
	</p>
	<p>
		Ein Vorhaben schließt du ab, wo du sonst ein Ticket erledigst: mit dem Haken oder dem Status in
		„Aufgaben“, im Ticket, bei den Unteraufgaben, in der Sammelbearbeitung oder im Tagesplan mit
		„Vorhaben abschließen …“. Vorher fragt die App jedes Mal „Vorhaben abschließen?“, in der
		Sammelbearbeitung einmal mit der Zahl der Vorhaben; „Abbrechen“ ändert nichts. Danach ist es
		erledigt und erscheint nicht mehr täglich im <a href={helpHref('tagesplan')}>Tagesplan</a>.
	</p>
</div>

<style>
	.kind-help {
		display: grid;
		gap: 0.625rem;
	}

	p,
	dt,
	dd,
	.compare-head {
		font-size: var(--font-size-body);
	}

	a {
		color: var(--color-brand-text);
	}

	.compare {
		display: grid;
		max-width: 80ch;
		border-top: 1px solid var(--color-line);
	}

	/* Narrow: each point stacks, its values with their side above them. */
	.compare-head {
		display: none;
	}

	.compare-row {
		display: grid;
		gap: 0.25rem;
		padding: 0.375rem 0;
		border-bottom: 1px solid var(--color-line);
	}

	.compare-row dt {
		font-weight: 600;
	}

	.side {
		display: block;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	/* Wide: three columns below the heading row; the side of a value is only for screen readers. */
	@media (min-width: 48rem) {
		.compare-head,
		.compare-row {
			display: grid;
			grid-template-columns: minmax(0, 9rem) minmax(0, 1fr) minmax(0, 1fr);
			gap: 0.25rem 1rem;
		}

		.compare-head {
			padding: 0.375rem 0;
			font-weight: 600;
			color: var(--color-text-muted);
			border-bottom: 1px solid var(--color-line);
		}

		.side {
			position: absolute;
			width: 1px;
			height: 1px;
			margin: -1px;
			padding: 0;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
			border: 0;
		}
	}

	.rule {
		max-width: 80ch;
	}
</style>
