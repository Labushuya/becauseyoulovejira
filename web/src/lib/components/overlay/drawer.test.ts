// Side panel building block (ADR-0025 section 6; plan UI-Konsistenz, package UI-6): a named
// complementary landmark with the context, the actions, "Vollansicht" only with an address and the
// × "Panel schließen", a fixed footer, and one Escape rule for all panels. The panels themselves
// use it (static check). Layout, sticky header and the slide-in are browser cases (BYL-E6-020).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import DrawerHarness from '$lib/test/DrawerHarness.svelte';
import captureForm from '../CaptureForm.svelte?raw';
import inboxPanel from '../InboxPanel.svelte?raw';
import newTicketForm from '../NewTicketForm.svelte?raw';
import ticketPanel from '../TicketPanel.svelte?raw';
import source from './Drawer.svelte?raw';

function show(props: Record<string, unknown> = {}) {
	const onclose = vi.fn();
	render(DrawerHarness, { props: { onclose, ...props } });
	const panel = screen.getByRole('complementary', { name: 'Steuer abgeben' });
	return { onclose, panel };
}

describe('side panel', () => {
	it('is a named landmark with context, actions, × and a footer', () => {
		const { panel } = show();
		const header = within(panel.querySelector('header') as HTMLElement);
		expect(header.getByText('TASK-7')).toBeTruthy();
		expect(
			header
				.getAllByRole('button')
				.map((button) => button.getAttribute('aria-label') ?? button.textContent)
		).toEqual(['Löschen …', 'Panel schließen']);
		expect(
			within(panel.querySelector('footer') as HTMLElement).getByRole('button', { name: 'Anlegen' })
		).toBeTruthy();
		expect(panel.hasAttribute('data-overlay')).toBe(true);
	});

	it('shows "Vollansicht" only with an address, as a link', () => {
		show();
		expect(screen.queryByRole('link', { name: 'Vollansicht öffnen' })).toBeNull();
		document.body.innerHTML = '';
		show({ fullViewHref: '/tickets/abc/voll' as ResolvedPathname });
		expect(screen.getByRole('link', { name: 'Vollansicht öffnen' }).getAttribute('href')).toBe(
			'/tickets/abc/voll'
		);
	});

	it('closes with × and with Escape from the panel', async () => {
		const { onclose } = show();
		await fireEvent.click(screen.getByRole('button', { name: 'Panel schließen' }));
		expect(onclose).toHaveBeenCalledOnce();
		expect(await fireEvent.keyDown(screen.getByRole('heading'), { key: 'Escape' })).toBe(false);
		expect(onclose).toHaveBeenCalledTimes(2);
		await fireEvent.keyDown(screen.getByRole('button', { name: 'Löschen …' }), { key: 'Escape' });
		expect(onclose).toHaveBeenCalledTimes(3);
	});

	it('keeps Escape in form fields of a detail panel and where a field consumed it', async () => {
		const { onclose } = show();
		await fireEvent.keyDown(screen.getByLabelText('Notiz'), { key: 'Escape' });
		await fireEvent.keyDown(screen.getByLabelText('Titel im Bearbeitungsmodus'), { key: 'Escape' });
		expect(onclose).not.toHaveBeenCalled();
	});

	it('closes from fields in a form panel, but not where a field consumed Escape', async () => {
		const { onclose } = show({ closeFromFields: true });
		await fireEvent.keyDown(screen.getByLabelText('Notiz'), { key: 'Escape' });
		expect(onclose).toHaveBeenCalledOnce();
		await fireEvent.keyDown(screen.getByLabelText('Titel im Bearbeitungsmodus'), { key: 'Escape' });
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('hands keys to the panel first (Ctrl+Enter of a form)', async () => {
		const onkeydown = vi.fn();
		show({ onkeydown });
		await fireEvent.keyDown(screen.getByLabelText('Notiz'), { key: 'Enter', ctrlKey: true });
		expect(onkeydown).toHaveBeenCalledWith(expect.objectContaining({ key: 'Enter' }));
	});

	// Since UI-6b the width comes from ViewWithPanel (column or overlay) and the panel has a line on
	// the left instead of a framed box with a radius, like the side panel of Jira.
	it('uses the tokens, a line on the left and no shadow', () => {
		expect(source).toMatch(/border-left:\s*1px solid var\(--color-line\)/);
		expect(source).not.toMatch(/border-radius/);
		expect(source).toMatch(/--motion-medium/);
		expect(source).not.toMatch(/box-shadow|gradient|backdrop-filter|danger/);
	});

	it.each([
		['TicketPanel', ticketPanel],
		['InboxPanel', inboxPanel],
		['NewTicketForm', newTicketForm],
		['CaptureForm', captureForm]
	])('%s is built on it', (_name, panel) => {
		expect(panel).toMatch(/import Drawer from '\.\/overlay\/Drawer\.svelte';/);
		expect(panel).not.toMatch(/<aside\b|side-panel/);
	});
});
