// Settings "Kanäle" with the bookmarklet (E4 plan, package 7): draggable link with the code for the
// address of the app, no effect on click, the code to copy for keyboard users.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bookmarkletCode } from '$lib/domain/bookmarklet';
import { ConnectionsStore } from '$lib/stores/connections.svelte';
import ChannelsView from './ChannelsView.svelte';

const CAPTURE = 'http://127.0.0.1:8090/eingang/neu';

/** Connections that were not loaded: the section shows neither list nor form. */
function idleConnections() {
	const never = () => Promise.reject(new Error('not used'));
	return new ConnectionsStore(
		{
			list: never,
			create: never,
			setEnabled: never,
			saveSettings: never,
			remove: never,
			secretStatus: never,
			run: never,
			get: never
		},
		{ ensureValid: () => true, logout: () => undefined }
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('channels view', () => {
	it('offers the bookmarklet as draggable link for the address of the app', () => {
		render(ChannelsView, { props: { captureUrl: CAPTURE, connections: idleConnections() } });
		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Kanäle');
		const link = screen.getByRole('link', { name: 'In den Eingang' });
		expect(link.getAttribute('href')).toBe(bookmarkletCode(CAPTURE));
		expect(link.getAttribute('draggable')).toBe('true');
		expect(screen.getByText(/Gespeichert wird erst, wenn du dort auf/)).toBeTruthy();
	});

	it('does nothing on a click in the app and says why', async () => {
		render(ChannelsView, { props: { captureUrl: CAPTURE, connections: idleConnections() } });
		const link = screen.getByRole('link', { name: 'In den Eingang' });
		const click = new MouseEvent('click', { bubbles: true, cancelable: true });
		link.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(true);
		expect((await screen.findByRole('status')).textContent).toMatch(/Lesezeichenleiste ziehen/);
	});

	it('shows the code and copies it for the keyboard', async () => {
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		render(ChannelsView, { props: { captureUrl: CAPTURE, connections: idleConnections() } });
		const area = screen.getByLabelText<HTMLTextAreaElement>('Code des Bookmarklets');
		expect(area.readOnly).toBe(true);
		expect(area.value).toBe(bookmarkletCode(CAPTURE));
		await fireEvent.click(screen.getByRole('button', { name: 'Code kopieren' }));
		expect(writeText).toHaveBeenCalledWith(bookmarkletCode(CAPTURE));
		expect(screen.getByRole('status').textContent).toBe('Code kopiert.');
	});

	it('explains how to copy by hand when the browser refuses', async () => {
		vi.stubGlobal('navigator', {
			clipboard: {
				writeText: async () => {
					throw new Error('denied');
				}
			}
		});
		render(ChannelsView, { props: { captureUrl: CAPTURE, connections: idleConnections() } });
		await fireEvent.click(screen.getByRole('button', { name: 'Code kopieren' }));
		expect(screen.getByRole('status').textContent).toMatch(/Strg\+C/);
	});
});
