// Hint while a realtime subscription failed and is tried again (ADR-0011 E6, E2 plan §8): an
// always present status region, the neutral warning (not red) with "Neu laden" only while a
// subscription is down, gone again once every subscription stands. With the real hold: a failed
// subscription shows it, the next successful attempt removes it.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveHealth } from '$lib/stores/live-health.svelte';
import { hold, RETRY_DELAYS_MS, type Unsubscribe } from '$lib/stores/realtime';
import LiveUpdateNotice from './LiveUpdateNotice.svelte';

const TEXT = 'Live-Aktualisierung unterbrochen – wird erneut versucht.';

afterEach(() => {
	vi.useRealTimers();
});

describe('LiveUpdateNotice', () => {
	it('shows nothing but the empty status region while the live updates run', () => {
		const { container } = render(LiveUpdateNotice, { props: { health: new LiveHealth() } });

		expect(screen.getByRole('status').textContent?.trim()).toBe('');
		expect(container.querySelector('.section-message')).toBeNull();
	});

	it('shows a neutral warning with "Neu laden" while a subscription is down', async () => {
		const health = new LiveHealth();
		const reload = vi.fn();
		const { container } = render(LiveUpdateNotice, { props: { health, reload } });

		health.interrupt();
		await tick();

		const status = screen.getByRole('status');
		expect(status.textContent).toContain(TEXT);
		expect(status.textContent).toContain('Achtung:');
		const message = container.querySelector('.section-message');
		expect(message?.getAttribute('data-tone')).toBe('warning');
		expect(message?.classList.contains('error')).toBe(false);
		expect(container.querySelector('[role="alert"]')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Neu laden' }));
		expect(reload).toHaveBeenCalledOnce();
	});

	it('goes away once the failed subscription stands', async () => {
		vi.useFakeTimers();
		const health = new LiveHealth();
		const { container } = render(LiveUpdateNotice, { props: { health } });
		let failures = 1;
		const stop = hold(
			(): Promise<Unsubscribe> =>
				failures-- > 0
					? Promise.reject(new Error('Failed to establish realtime connection.'))
					: Promise.resolve(async () => undefined),
			{ health }
		);

		await vi.advanceTimersByTimeAsync(0);
		await tick();
		expect(screen.getByRole('status').textContent).toContain(TEXT);

		await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] ?? 0);
		await tick();
		expect(container.querySelector('.section-message')).toBeNull();
		stop();
	});
});
