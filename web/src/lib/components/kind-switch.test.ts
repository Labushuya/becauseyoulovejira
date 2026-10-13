// The switch "Laufendes Vorhaben" (ADR-0065, VH-1): the hint on the check mark of the day plan, the
// hint when an ongoing project fits rather than a recurrence, and the way to the comparison in the
// help in a new tab; both hints describe the switch.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import KindSwitch from './KindSwitch.svelte';

const kindSwitch = () =>
	screen.getByRole<HTMLInputElement>('switch', { name: 'Laufendes Vorhaben' });

/** The texts of the elements that describe the switch, in order. */
function description(): string[] {
	return (kindSwitch().getAttribute('aria-describedby') ?? '')
		.split(' ')
		.map((id) => (document.getElementById(id)?.textContent ?? '').replace(/\s+/g, ' ').trim());
}

describe('switch "Laufendes Vorhaben" (VH-1)', () => {
	it('says when an ongoing project fits and links to the comparison in the help, in a new tab', () => {
		render(KindSwitch, { props: { ongoing: false, onchange: vi.fn() } });
		const link = screen.getByRole('link', {
			name: 'Vorhaben oder Wiederholung? (öffnet in neuem Tab)'
		});
		expect(link.getAttribute('href')).toBe('/einstellungen/hilfe#vorhaben-oder-wiederholung');
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link.getAttribute('rel')).toBe('noopener');
		expect(description()).toEqual([
			'Im Tagesplan erledigt der Haken dieses Ticket.',
			'Für eine Sache, an der du länger arbeitest. Musst du etwas jedes Mal einzeln erledigen, passt eine Wiederholung besser. Vorhaben oder Wiederholung? (öffnet in neuem Tab)'
		]);
	});

	it('keeps both hints for an ongoing project and adds a refusal of the owner', async () => {
		const onchange = vi.fn();
		const { rerender } = render(KindSwitch, { props: { ongoing: true, onchange } });
		expect(kindSwitch().checked).toBe(true);
		expect(description()[0]).toBe(
			'Im Tagesplan heißt der Haken „für heute erledigt“; das Ticket bleibt offen.'
		);
		await rerender({ ongoing: true, onchange, error: 'Dieser Wert ist ungültig.' });
		expect(description()).toHaveLength(3);
		expect(description()[2]).toBe('Dieser Wert ist ungültig.');
		await fireEvent.click(kindSwitch());
		expect(onchange).toHaveBeenCalledWith(false);
	});
});
