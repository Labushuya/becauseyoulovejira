// toggleTask (ADR-0032 section 6, RT-2): ticking a task in the view changes exactly the character
// between the brackets of that task in the source; the index is the one of the display.

import { describe, expect, it } from 'vitest';
import { renderMarkdown, toggleTask } from './markdown';

/** Checked states of the tasks as the display shows them. */
function states(source: string): boolean[] {
	const container = document.createElement('div');
	container.innerHTML = renderMarkdown(source);
	return [...container.querySelectorAll('input')].map((input) => input.checked);
}

/** Positions where two texts of the same length differ. */
function differences(a: string, b: string): number[] {
	expect(b).toHaveLength(a.length);
	return [...a].flatMap((char, index) => (char === b[index] ? [] : [index]));
}

describe('toggleTask', () => {
	it('ticks and unticks one task of a flat list', () => {
		const source = '- [ ] Milch\n- [ ] Brot\n- [x] Äpfel\n';

		expect(toggleTask(source, 1, true)).toBe('- [ ] Milch\n- [x] Brot\n- [x] Äpfel\n');
		expect(toggleTask(source, 2, false)).toBe('- [ ] Milch\n- [ ] Brot\n- [ ] Äpfel\n');
	});

	it('unticks an upper-case X and writes a lower-case x', () => {
		expect(toggleTask('* [X] groß', 0, false)).toBe('* [ ] groß');
		expect(toggleTask('+ [ ] plus', 0, true)).toBe('+ [x] plus');
	});

	it('returns the text itself if the task already has the state', () => {
		const source = '- [x] fertig';

		expect(toggleTask(source, 0, true)).toBe(source);
	});

	it.each([
		['an index after the last task', '- [ ] eins', 1],
		['a negative index', '- [ ] eins', -1],
		['a text without tasks', 'Nur Text', 0]
	])('returns null for %s', (_name, source, index) => {
		expect(toggleTask(source, index, true)).toBeNull();
	});

	it('finds the task through nested lists, quotes, numbered containers and tabs', () => {
		const source = [
			'- [ ] Eltern',
			'  - [ ] Kind',
			'    - [ ] Enkel',
			'',
			'> - [ ] im Zitat',
			'',
			'1. - [ ] in nummerierter Liste',
			'',
			'-\t[ ] mit Tab',
			'',
			'-',
			'  [ ] auf der nächsten Zeile'
		].join('\n');

		for (let index = 0; index < 7; index++) {
			const next = toggleTask(source, index, true);

			expect(next, `task ${index}`).not.toBeNull();
			expect(differences(source, next!), `task ${index}`).toHaveLength(1);
			expect(states(next!).filter(Boolean), `task ${index}`).toHaveLength(1);
			expect(states(next!)[index], `task ${index}`).toBe(true);
		}
	});

	it('does not count lines in code, numbered lists or sentences', () => {
		const source = [
			'```',
			'- [ ] im Codeblock',
			'```',
			'',
			'    - [ ] eingerückter Code',
			'',
			'1. [ ] nummeriert',
			'',
			'Text [ ] mitten im Satz',
			'',
			'- [ ] die Aufgabe'
		].join('\n');

		const next = toggleTask(source, 0, true);

		expect(next).toBe(source.replace('- [ ] die Aufgabe', '- [x] die Aufgabe'));
	});

	it('changes only the marker, not a bracket pair later on the line', () => {
		expect(toggleTask('- [ ] a [ ] b', 0, true)).toBe('- [x] a [ ] b');
	});

	it('keeps CRLF and lone CR line breaks', () => {
		const source = '- [ ] eins\r\n- [ ] zwei\r\n\r\nText\r- [ ] drei';

		expect(toggleTask(source, 1, true)).toBe('- [ ] eins\r\n- [x] zwei\r\n\r\nText\r- [ ] drei');
		expect(toggleTask(source, 2, true)).toBe('- [ ] eins\r\n- [ ] zwei\r\n\r\nText\r- [x] drei');
	});

	it('keeps the escapes of the template "Einkauf"', () => {
		const source = '- [ ] Milch 1\\.5 %\n- [ ] Brot \\(Vollkorn\\)\n- [ ] C\\+\\+ Buch\n';

		expect(toggleTask(source, 2, true)).toBe(
			'- [ ] Milch 1\\.5 %\n- [ ] Brot \\(Vollkorn\\)\n- [x] C\\+\\+ Buch\n'
		);
	});
});
