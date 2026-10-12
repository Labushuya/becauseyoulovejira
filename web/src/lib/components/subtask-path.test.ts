// The path of a sub-task as a building block (TP-2, ADR-0033 section 5, ADR-0065 Nachtrag TP-2):
// in the table "HAUS-7 ›" with "Unteraufgabe von HAUS-7:" for screen readers, as before; in the day
// plan a line of context "HAUS-7 › Wochenputz" with the key as a link that opens the parent, the
// title of the parent for screen readers and as tooltip, cut off on a narrow screen; an unknown
// parent without a link.

import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import SubtaskPath from './SubtaskPath.svelte';
import source from './SubtaskPath.svelte?raw';

const PARENT = { id: 'parent000000007', key: 'HAUS-7', title: 'Wochenputz' };
const HREF = '/tagesplan/tickets/parent000000007';

/** Visible text: the text nodes outside the parts only for screen readers. */
function visibleText(element: Element): string {
	const clone = element.cloneNode(true) as Element;
	for (const hidden of clone.querySelectorAll('.visually-hidden')) hidden.remove();
	return clone.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

/** The declarations of a rule of the component's style. */
function rule(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? '';
}

describe('path of a sub-task in the table', () => {
	it('shows the key with "›" and the title as tooltip, for screen readers the key', () => {
		const { container } = render(SubtaskPath, { props: { parent: PARENT } });

		const hidden = container.querySelector('.visually-hidden');
		expect(hidden?.textContent).toBe('Unteraufgabe von HAUS-7:');
		const path = container.querySelector('.path');
		expect(path?.textContent).toBe('HAUS-7 ›');
		expect(path?.getAttribute('aria-hidden')).toBe('true');
		expect(path?.getAttribute('title')).toBe('Wochenputz');
		expect(screen.queryByRole('link')).toBeNull();
		expect(container.querySelector('[data-subtask-path]')).toBeNull();
	});

	it('keeps only the text for screen readers below its parent', () => {
		const { container } = render(SubtaskPath, { props: { parent: PARENT, path: false } });

		expect(container.querySelector('.visually-hidden')?.textContent).toBe(
			'Unteraufgabe von HAUS-7:'
		);
		expect(container.querySelector('.path')).toBeNull();
		expect(visibleText(container)).toBe('');
	});
});

describe('line of context in the day plan', () => {
	it('names key and title of the parent, the key opens it', () => {
		const { container } = render(SubtaskPath, {
			props: { parent: PARENT, withTitle: true, href: HREF }
		});

		const line = container.querySelector<HTMLElement>('[data-subtask-path]')!;
		expect(line.getAttribute('data-subtask-path')).toBe(PARENT.id);
		expect(visibleText(line)).toBe('HAUS-7 › Wochenputz');
		expect(line.querySelector('.visually-hidden')?.textContent).toBe(
			'Unteraufgabe von HAUS-7 Wochenputz:'
		);
		const link = screen.getByRole('link', { name: 'HAUS-7' });
		expect(link.getAttribute('href')).toBe(HREF);
		expect(link.getAttribute('data-ticket-link')).toBe(PARENT.id);
		// The title is cut on a narrow screen; the tooltip has all of it, screen readers hear it once.
		const title = line.querySelector('.path-title');
		expect(title?.getAttribute('title')).toBe('Wochenputz');
		expect(title?.getAttribute('aria-hidden')).toBe('true');
		expect(container.querySelector('.path')).toBeNull();
	});

	it('shows the fallback of an unknown parent without a link', () => {
		const unknown = { id: PARENT.id, key: '…', title: '' };
		const { container } = render(SubtaskPath, {
			props: { parent: unknown, withTitle: true, href: HREF }
		});

		const line = container.querySelector<HTMLElement>('[data-subtask-path]')!;
		expect(visibleText(line)).toBe('… ›');
		expect(line.querySelector('.visually-hidden')?.textContent).toBe('Unteraufgabe von …:');
		expect(screen.queryByRole('link')).toBeNull();
		expect(line.querySelector('.path-title')?.hasAttribute('title')).toBe(false);
	});

	it('shows the key as text without a link to follow', () => {
		const { container } = render(SubtaskPath, { props: { parent: PARENT, withTitle: true } });

		expect(screen.queryByRole('link')).toBeNull();
		expect(container.querySelector('.path-key')?.getAttribute('aria-hidden')).toBe('true');
		expect(container.querySelector('.visually-hidden')?.textContent).toBe(
			'Unteraufgabe von HAUS-7 Wochenputz:'
		);
	});

	it('stays within its row on a narrow screen: the title gives way with an ellipsis', () => {
		// A line of its own in a wrapping row that may shrink below its content.
		expect(rule('.context')).toMatch(/flex: 1 1 100%;/);
		expect(rule('.context')).toMatch(/min-width: 0;/);
		expect(rule('.context')).toMatch(/font-size: var\(--font-size-small\);/);
		expect(rule('.context')).toMatch(/color: var\(--color-text-muted\);/);
		// The key stays whole as long as it fits, never wider than the line.
		expect(rule('.path-key')).toMatch(/max-width: 100%;/);
		expect(rule('.path-key')).toMatch(/text-overflow: ellipsis;/);
		// The title of the parent is cut first, on one line.
		for (const declaration of [
			/min-width: 0;/,
			/overflow: hidden;/,
			/text-overflow: ellipsis;/,
			/white-space: nowrap;/
		]) {
			expect(rule('.path-title')).toMatch(declaration);
		}
		// The link is big enough to hit on a touch screen.
		expect(source).toMatch(
			/@media \(pointer: coarse\)\s*\{\s*a\.path-key\s*\{\s*line-height: 1\.5rem;/
		);
	});
});
