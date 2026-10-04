// Settings "System" (ADR-0043): the page asks the server only while it counts as Windows (until
// the answer of the host route it does), shows the hint for Linux and containers without a
// request, and ends its requests when it goes.

import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

const mocks = vi.hoisted(() => ({
	platform: 'windows' as string,
	signals: [] as AbortSignal[],
	status: null as unknown
}));

vi.mock('$lib/auth.svelte', () => ({ auth: { ensureValid: () => true, logout: () => undefined } }));
vi.mock('$lib/pocketbase', () => ({ pb: {} }));
vi.mock('$lib/stores/flags.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getFlagStore: () => ({ show: () => '', dismiss: () => undefined })
}));
vi.mock('$lib/stores/host.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	findHostStore: () => ({ platform: mocks.platform })
}));
vi.mock('$lib/data/system', async (importOriginal) => ({
	...(await importOriginal<object>()),
	fetchSystemStatus: vi.fn(async (_pb: unknown, options: { signal: AbortSignal }) => {
		mocks.signals.push(options.signal);
		return mocks.status;
	})
}));

beforeEach(() => {
	mocks.signals.length = 0;
	mocks.status = { kind: 'denied', reason: 'owner' };
	document.body.innerHTML = '';
});

describe('settings "System"', () => {
	it('loads the status for a server on Windows', async () => {
		mocks.platform = 'windows';
		render(Page);
		await vi.waitFor(() => expect(screen.getByText('Nur für den Verwalter der App')).toBeTruthy());
		expect(mocks.signals).toHaveLength(1);
	});

	it('shows the hint for a server on Linux without asking it', async () => {
		mocks.platform = 'linux';
		render(Page);
		await tick();
		expect(screen.getByText('Nur für einen Server unter Windows')).toBeTruthy();
		expect(mocks.signals).toHaveLength(0);
	});

	it('ends its requests when it goes', async () => {
		mocks.platform = 'windows';
		mocks.status = new Promise(() => undefined);
		const view = render(Page);
		await vi.waitFor(() => expect(mocks.signals).toHaveLength(1));
		expect(mocks.signals[0]?.aborted).toBe(false);
		view.unmount();
		expect(mocks.signals[0]?.aborted).toBe(true);
	});
});
