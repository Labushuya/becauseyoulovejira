// Words of the decision help (ADR-0047) and of blocked tickets in the trash: summaries, the labels
// of the options with their object, the preview of the collective ways, the flag after a
// decision, the column "Endgültig gelöscht" and the questions before deleting for good. The rule
// itself is checked against the hook in tests/unit/web-trash.test.mjs.

import { describe, expect, it } from 'vitest';
import {
	blockedRetentionText,
	blockedReason,
	chosenBlockedText,
	emptyText,
	purgeText
} from './trash';
import {
	blockedLabel,
	blockedName,
	collectivePreview,
	dependencySummary,
	optionLabel,
	optionsOf,
	resolvedText,
	type SourceDependency,
	type TicketDependency
} from './trash-dependencies';

const root: TicketDependency = {
	kind: 'ticket',
	ticket: 'r',
	key: 'HAUS-1',
	title: 'Dach',
	status: 'open',
	subtask: false,
	openBlocking: 2,
	options: optionsOf({ kind: 'ticket', subtask: false, openBlocking: 2 })
};
const child: TicketDependency = {
	...root,
	ticket: 'c',
	key: 'HAUS-2',
	subtask: true,
	openBlocking: 0,
	options: optionsOf({ kind: 'ticket', subtask: true, openBlocking: 0 })
};
const mail: SourceDependency = {
	kind: 'source',
	item: 's',
	ticket: 'r',
	key: 'HAUS-1',
	title: '',
	channel: 'mail',
	scope: 'u:a',
	primary: false,
	options: optionsOf({ kind: 'source', primary: false })
};

describe('words of the decision help', () => {
	it('sums up and labels blocked tickets', () => {
		expect(dependencySummary({ tickets: 1, sources: 0 })).toBe('1 offenes Ticket');
		expect(dependencySummary({ tickets: 2, sources: 1 })).toBe('2 offene Tickets und 1 Quelle');
		expect(dependencySummary({ tickets: 0, sources: 3 })).toBe('3 Quellen');
		expect(blockedLabel(3)).toBe('Blockiert (3)');
		expect(blockedName(1)).toBe('Blockiert: 1 Abhängigkeit');
	});

	it('names the object of every option', () => {
		expect(optionLabel('complete_children', root, 'HAUS-1')).toEqual({
			text: 'Mit 2 Unteraufgaben als erledigt markieren',
			name: 'HAUS-1 mit 2 Unteraufgaben als erledigt markieren'
		});
		expect(optionLabel('restore', child, 'HAUS-1')).toEqual({
			text: 'Mit HAUS-1 wiederherstellen',
			name: 'HAUS-2 mit HAUS-1 wiederherstellen'
		});
		expect(optionLabel('complete', child, 'HAUS-1').name).toBe('HAUS-2 als erledigt markieren');
		expect(optionLabel('move', mail, 'HAUS-1')).toEqual({
			text: 'Anderem Ticket zuordnen …',
			name: '„Ohne Titel“ anderem Ticket zuordnen …'
		});
	});

	it('previews the collective ways and words the flag', () => {
		expect(collectivePreview([root, child, mail], 'complete')).toBe(
			'Betrifft 2 Tickets: HAUS-2, HAUS-1. Sie bekommen den Status „Erledigt“.'
		);
		expect(collectivePreview([root, mail], 'inbox')).toMatch(
			/^Betrifft 1 Quelle: „Ohne Titel“\. Sie stehen danach wieder als neu im Eingang/
		);
		expect(resolvedText([{ action: 'inbox', item: 's' }], 'HAUS-1')).toBe(
			'Quelle zurück in den Eingang gelegt.'
		);
		expect(
			resolvedText(
				[
					{ action: 'discard', item: 's' },
					{ action: 'complete', ticket: 'r' }
				],
				'HAUS-1'
			)
		).toBe('2 Entscheidungen für HAUS-1 übernommen.');
	});

	it('words the retention and the questions for blocked tickets', () => {
		expect(purgeText(30, 2)).toBe('nicht, solange blockiert');
		expect(purgeText(null, 2)).toBe('nie');
		expect(purgeText(1, 0)).toBe('in 1 Tag');
		expect(blockedRetentionText(12)).toBe(
			'nicht automatisch, solange es blockiert ist (sonst in 12 Tagen)'
		);
		expect(blockedRetentionText(null)).toBe('nie (Aufbewahrung „Nie automatisch“)');
		expect(blockedReason(1)).toBe('Es hat noch 1 Abhängigkeit. Bitte in der Vorschau entscheiden.');
		expect(emptyText(3, 0)).toMatch(/^Alle 3 Tickets im Papierkorb werden/);
		expect(emptyText(3, 2)).toBe(
			'1 Ticket ohne offene Abhängigkeiten wird mit Unteraufgaben, Kommentaren und dem Verlauf gelöscht. 2 blockierte Tickets bleiben, bis du in der Vorschau über die Abhängigkeiten entscheidest.'
		);
		expect(chosenBlockedText(2)).toBe('2 davon haben offene Abhängigkeiten und bleiben.');
	});
});
