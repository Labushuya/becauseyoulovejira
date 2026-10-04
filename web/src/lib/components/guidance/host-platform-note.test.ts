// Note above the Windows guides (ADR-0028, plan plattformen S0-3): nothing on Windows or outside
// the (app) layout, a section message with title for a server on Linux or in a container, updated
// once the store has loaded the platform. The store drops the answer of an aborted request.

import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { PC_CONTEXT, useContext } from '$lib/test/context';
import type { HostPlatform } from '$lib/domain/host-platform';
import { HostStore } from '$lib/stores/host.svelte';
import HostPlatformHarness from '$lib/test/HostPlatformNoteHarness.svelte';
import HostPlatformNote from './HostPlatformNote.svelte';

const storeFor = (platform: HostPlatform) => new HostStore(async () => platform);

// The administrator on the machine of the app (KOB-1, ADR-0057): everything as before.
beforeEach(async () => {
	await useContext(PC_CONTEXT);
});

describe('HostPlatformNote', () => {
	it('renders nothing outside the (app) layout', () => {
		const { container } = render(HostPlatformNote);
		expect(container.querySelector('.section-message')).toBeNull();
	});

	it('renders nothing for a server on Windows', async () => {
		const store = storeFor('windows');
		const { container } = render(HostPlatformHarness, { props: { store } });
		await store.load(new AbortController().signal);
		await tick();
		expect(container.querySelector('.section-message')).toBeNull();
	});

	it.each([
		['linux', 'Dein Server läuft unter Linux'],
		['container', 'Dein Server läuft in einem Container']
	] as [HostPlatform, string][])('shows the note for %s after loading', async (platform, title) => {
		const store = storeFor(platform);
		const { container } = render(HostPlatformHarness, { props: { store } });
		expect(container.querySelector('.section-message')).toBeNull();
		await store.load(new AbortController().signal);
		await tick();
		const heading = screen.getByRole('heading', { level: 3 });
		expect(heading.textContent).toContain(title);
		expect(heading.textContent).toContain('Hinweis:');
		expect(container.querySelector('.section-message')?.getAttribute('data-tone')).toBe('info');
		expect(container.querySelector('.section-message')?.getAttribute('role')).toBeNull();
	});
});

describe('HostStore', () => {
	it('starts on Windows and drops the answer of an aborted request', async () => {
		const store = storeFor('linux');
		expect(store.platform).toBe('windows');
		const controller = new AbortController();
		const loading = store.load(controller.signal);
		controller.abort();
		await loading;
		expect(store.platform).toBe('windows');
		await store.load(new AbortController().signal);
		expect(store.platform).toBe('linux');
	});
});
