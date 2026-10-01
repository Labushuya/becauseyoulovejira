// The name of a connection (ADR-0026, addendum KK-3): its check as in the hook, the note about a
// name that is taken, the flag after renaming and the channel with the name of its connection.

import { describe, expect, it } from 'vitest';
import {
	SAME_LABEL_HINT,
	labelError,
	renamedText,
	sameLabelHint,
	withConnectionName
} from './connections';

describe('name of a connection (KK-3)', () => {
	it('needs a name after trimming and at most 100 characters', () => {
		expect(labelError('Gmail Arbeit')).toBeNull();
		expect(labelError(`  ${'a'.repeat(100)}  `)).toBeNull();
		expect(labelError('')).toBe('Bitte einen Namen eingeben.');
		expect(labelError(' \t ')).toBe('Bitte einen Namen eingeben.');
		expect(labelError('a'.repeat(101))).toBe('Höchstens 100 Zeichen.');
	});

	it('notes a name another connection has, without case and white space, but allows it', () => {
		const others = ['Gmail', 'Familienchat'];
		expect(sameLabelHint(' gmail ', others)).toBe(SAME_LABEL_HINT);
		expect(sameLabelHint('FAMILIENCHAT', others)).toBe(SAME_LABEL_HINT);
		expect(sameLabelHint('Gmail Arbeit', others)).toBeNull();
		expect(sameLabelHint('   ', others)).toBeNull();
		expect(sameLabelHint('Gmail', [])).toBeNull();
	});

	it('says old and new name in the flag', () => {
		expect(renamedText('Gmail', 'Gmail Arbeit')).toBe('„Gmail“ heißt jetzt „Gmail Arbeit“.');
	});

	it('adds the name of the connection to the channel only when it says more', () => {
		expect(withConnectionName('Mail', 'Gmail Arbeit')).toBe('Mail · Gmail Arbeit');
		expect(withConnectionName('Telegram', ' Familienchat ')).toBe('Telegram · Familienchat');
		expect(withConnectionName('Notion', 'notion')).toBe('Notion');
		expect(withConnectionName('Mail', null)).toBe('Mail');
		expect(withConnectionName('Mail', '  ')).toBe('Mail');
	});
});
