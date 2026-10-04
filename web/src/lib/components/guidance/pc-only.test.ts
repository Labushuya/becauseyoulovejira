// What works only at the machine of the app (KX-1, ADR-0057): PcOnly shows its content for the
// administrator there and the same hint everywhere else, nothing while the context loads; the
// replacement of a page of the administrator says why without asking the server.

import { render, screen } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import { capabilitiesOf, type AppContext } from '$lib/domain/context';
import { MEMBER_CONTEXT, PC_CONTEXT, REMOTE_CONTEXT, useContext } from '$lib/test/context';
import AdminPageNotice from '../AdminPageNotice.svelte';
import PcOnly from './PcOnly.svelte';

const COMMAND = 'neu-starten.bat im Ordner app';
const children = createRawSnippet(() => ({ render: () => `<span>${COMMAND}</span>` }));
const LINUX: AppContext = { ...PC_CONTEXT, platform: 'linux', scripts: false };

async function show(
	context: AppContext | 'pending' | 'outdated',
	props: { need?: 'pc' | 'script'; inline?: boolean; quiet?: boolean; member?: string } = {}
) {
	await useContext(context);
	const result = render(PcOnly, { props: { ...props, children } });
	await tick();
	return result;
}

describe('PcOnly', () => {
	it.each([
		['pc', PC_CONTEXT],
		['script', PC_CONTEXT],
		['pc', LINUX]
	] as const)('shows what needs %s to the administrator at the PC', async (need, context) => {
		await show(context, { need });
		expect(screen.getByText(COMMAND)).toBeTruthy();
	});

	it.each([
		[
			REMOTE_CONTEXT,
			'script',
			'Nur direkt am PC verfügbar, auf dem becauseyoulovejira läuft (dort über http://127.0.0.1:8090 öffnen).'
		],
		[MEMBER_CONTEXT, 'pc', 'Bitte den Verwalter fragen.'],
		[LINUX, 'script', 'Auf diesem Server nicht verfügbar.'],
		['outdated', 'pc', 'Nach dem nächsten Neustart verfügbar.']
	] as const)('puts the one hint instead (%j, %s)', async (context, need, hint) => {
		const { container } = await show(context, { need });
		expect(container.textContent).not.toContain(COMMAND);
		expect(screen.getByText(hint).closest('.section-message')?.getAttribute('data-tone')).toBe(
			'info'
		);
	});

	it('shows nothing while the context loads, so no command flashes', async () => {
		const { container } = await show('pending');
		expect(container.textContent?.trim()).toBe('');
	});

	it('stands inline as text, quiet as nothing, and with its own text for another account', async () => {
		const inline = await show(REMOTE_CONTEXT, { inline: true });
		expect(inline.container.querySelector('span.pc-only')?.textContent).toMatch(
			/^Nur direkt am PC/
		);
		expect(inline.container.querySelector('.section-message')).toBeNull();
		inline.unmount();

		const quiet = await show(MEMBER_CONTEXT, { quiet: true });
		expect(quiet.container.textContent?.trim()).toBe('');
		quiet.unmount();

		await show(MEMBER_CONTEXT, { member: 'Betrieb und Sicherung übernimmt der Verwalter.' });
		expect(screen.getByText('Betrieb und Sicherung übernimmt der Verwalter.')).toBeTruthy();
	});

	it('follows the context of the tab when it arrives', async () => {
		const { container } = await show('pending', { need: 'script' });
		expect(container.textContent?.trim()).toBe('');
		await useContext(PC_CONTEXT);
		await tick();
		expect(screen.getByText(COMMAND)).toBeTruthy();
	});
});

describe('AdminPageNotice', () => {
	it.each([
		[REMOTE_CONTEXT, 'Nur direkt am PC', /dort über http:\/\/127\.0\.0\.1:8090 öffnen/],
		[MEMBER_CONTEXT, 'Nur für den Verwalter', /Bitte den Verwalter fragen\./]
	] as const)('says why a page of the administrator is not shown (%j)', (context, title, text) => {
		render(AdminPageNotice, {
			props: { capabilities: capabilitiesOf({ kind: 'ready', context }) }
		});
		expect(screen.getByRole('heading', { name: new RegExp(title) })).toBeTruthy();
		expect(document.body.textContent).toMatch(text);
		expect(document.querySelector('.section-message.error')).toBeNull();
	});

	it('shows only a quiet status while the context loads', () => {
		render(AdminPageNotice, { props: { capabilities: capabilitiesOf({ kind: 'pending' }) } });
		expect(screen.getByRole('status').textContent).toBe('Wird geladen …');
	});
});
