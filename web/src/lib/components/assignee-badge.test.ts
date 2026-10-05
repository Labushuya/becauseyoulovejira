// The initials of the assignee (E7-5, ADR-0068 §2): "AB" in a round mark, the full name as tooltip
// and as text for screen readers, a ring in the stable color of the account (the palette of the
// projects, ADR-0052) and the initials in the text color on the surface, so both keep their contrast
// in every theme. Nothing without an assignee.

import { render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { assigneeColor, type AssigneeContext } from '$lib/domain/assignee';
import { PROJECT_COLORS } from '$lib/domain/colors';
import { contrast } from '$lib/test/color-math';
import {
	MODES,
	MODE_SELECTORS,
	TOKENS_SOURCE,
	customProperties,
	parseBlocks
} from '$lib/test/tokens-css';
import AssigneeBadge from './AssigneeBadge.svelte';
import source from './AssigneeBadge.svelte?raw';

const SELF = 'anna00000000001';
const BERT = 'bert00000000002';
const CONTEXT: AssigneeContext = {
	selfId: SELF,
	selfName: 'Anna Beispiel',
	names: { nameOf: (id) => (id === BERT ? 'Bert Beispiel' : null) }
};

afterEach(() => {
	document.body.innerHTML = '';
});

function badge(assignee: string | null, context = CONTEXT) {
	const { container } = render(AssigneeBadge, { props: { assignee, context } });
	return container.querySelector<HTMLElement>('.assignee-badge');
}

describe('AssigneeBadge', () => {
	it('shows the initials with the full name as tooltip and as text for screen readers', () => {
		const mark = badge(BERT);
		expect(mark?.getAttribute('title')).toBe('Zuständig: Bert Beispiel');
		const initials = mark?.querySelector('.initials');
		expect(initials?.textContent).toBe('BB');
		expect(initials?.getAttribute('aria-hidden')).toBe('true');
		expect(mark?.querySelector('.visually-hidden')?.textContent).toBe('Zuständig: Bert Beispiel');
		expect(mark?.textContent).toBe('BBZuständig: Bert Beispiel');
		// Not interactive: no role, no tab stop.
		expect(mark?.hasAttribute('tabindex')).toBe(false);
		expect(mark?.hasAttribute('role')).toBe(false);
	});

	it('names the own account with its name and an unknown one neutrally', () => {
		expect(badge(SELF)?.getAttribute('title')).toBe('Zuständig: Anna Beispiel');
		document.body.innerHTML = '';
		const unknown = badge('gone00000000009');
		expect(unknown?.getAttribute('title')).toBe('Zuständig: Anderes Konto');
		expect(unknown?.querySelector('.initials')?.textContent).toBe('AK');
	});

	it('has a ring in the stable color of the account', () => {
		const first = badge(BERT)?.style.getPropertyValue('--assignee-ring');
		document.body.innerHTML = '';
		const again = badge(BERT)?.style.getPropertyValue('--assignee-ring');
		expect(first).toBe(`var(--project-color-${assigneeColor(BERT)})`);
		expect(again).toBe(first);
	});

	it('shows nothing without an assignee', () => {
		expect(badge(null)).toBeNull();
		expect(badge('')).toBeNull();
	});

	it('keeps the contrast: initials in the text color on the surface, the ring of the palette', () => {
		const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1] ?? '';
		expect(style).toMatch(/color: var\(--color-text\);/);
		expect(style).toMatch(/background: var\(--color-surface\);/);
		expect(style).toMatch(/border: 2px solid var\(--assignee-ring\);/);
		const blocks = parseBlocks(TOKENS_SOURCE);
		const root = customProperties(blocks.get(MODE_SELECTORS.light) ?? new Map());
		for (const mode of MODES) {
			const own = customProperties(blocks.get(MODE_SELECTORS[mode]) ?? new Map());
			const value = (name: string) => own.get(name) ?? root.get(name) ?? '';
			const surface = value('--color-surface');
			expect(contrast(value('--color-text'), surface), mode).toBeGreaterThanOrEqual(4.5);
			for (const color of PROJECT_COLORS) {
				expect(
					contrast(value(`--project-color-${color}`), surface),
					`${mode} ${color}`
				).toBeGreaterThanOrEqual(3);
			}
		}
	});
});
