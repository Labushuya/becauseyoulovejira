// Unit tests for the input of a list of words in one field (keyword editor and tag picker): the
// separators, splitting with and without finishing, the meaning of a key press and the caret.

import { describe, expect, it } from 'vitest';
import { hasListSeparator, listInputAction, splitAtCaret, splitListInput } from './list-input';

function key(
	key: string,
	extra: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'repeat'>> = {}
) {
	return { key, ctrlKey: false, metaKey: false, repeat: false, ...extra };
}

describe('list input', () => {
	it('splits at commas and line breaks and keeps the rest unless finished', () => {
		expect(splitListInput('todo', false)).toEqual({ parts: [], rest: 'todo' });
		expect(splitListInput('todo', true)).toEqual({ parts: ['todo'], rest: '' });
		expect(splitListInput('a, b ,, c', false)).toEqual({ parts: ['a', 'b'], rest: ' c' });
		expect(splitListInput('a\r\nb\nc,', true)).toEqual({ parts: ['a', 'b', 'c'], rest: '' });
		expect(splitListInput(' , ', true)).toEqual({ parts: [], rest: '' });
		expect(hasListSeparator('zu erledigen')).toBe(false);
		expect(hasListSeparator('a,b')).toBe(true);
		expect(hasListSeparator('a\nb')).toBe(true);
	});

	it('reads Enter and the comma as taking, Ctrl+Enter and Cmd+Enter as the form', () => {
		expect(listInputAction(key('Enter'), 'Haus', true)).toBe('finish');
		expect(listInputAction(key('Enter'), '', false)).toBe('finish');
		expect(listInputAction(key('Enter', { ctrlKey: true }), 'Haus', true)).toBeNull();
		expect(listInputAction(key('Enter', { metaKey: true }), 'Haus', true)).toBeNull();
		expect(listInputAction(key(','), 'Haus', true)).toBe('separate');
		expect(listInputAction(key('a'), 'Haus', true)).toBeNull();
	});

	it('takes the last entry back only with Backspace in the empty field, once per press', () => {
		expect(listInputAction(key('Backspace'), '', true)).toBe('take-back');
		expect(listInputAction(key('Backspace', { repeat: true }), '', true)).toBe('hold');
		// With text, or without entries, Backspace deletes as usual.
		expect(listInputAction(key('Backspace'), 'H', true)).toBeNull();
		expect(listInputAction(key('Backspace'), '', false)).toBeNull();
	});

	it('splits the field at the caret or the selection', () => {
		expect(splitAtCaret('Haus, Garten', 4, 4)).toEqual({ before: 'Haus', after: ', Garten' });
		expect(splitAtCaret('Haus Garten', 4, 11)).toEqual({ before: 'Haus', after: '' });
		expect(splitAtCaret('Haus', null, null)).toEqual({ before: 'Haus', after: '' });
	});
});
