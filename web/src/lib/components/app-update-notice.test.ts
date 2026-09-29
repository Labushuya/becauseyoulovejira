// Hint after a new build while the tab is open (ADR-0040): an always present status region, the
// neutral information (not red, not a warning) with "Neu laden" once SvelteKit reports a new
// version, the sentence about unsaved input, and the next click on a link as a full page load,
// but not while something would be lost.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAppUpdate } from '$lib/test/app-update-fake.svelte';
import AppUpdateNotice from './AppUpdateNotice.svelte';

type Navigation = {
	type: string;
	willUnload: boolean;
	to: { url: URL } | null;
};

const mocks = vi.hoisted(() => ({
	onNavigate: [] as ((navigation: Navigation) => unknown)[]
}));

vi.mock('$app/navigation', () => ({
	onNavigate: (callback: (navigation: Navigation) => unknown) => {
		mocks.onNavigate.push(callback);
	}
}));
vi.mock('$app/state', () => ({ updated: { current: false } }));

const TEXT = 'Eine neue Version von becauseyoulovejira ist da.';
const UNSAVED = 'Speichere zuerst deine Eingaben, beim Neuladen gehen sie verloren.';

function setup(options: { unsaved?: boolean; pending?: boolean } = {}) {
	const state = new FakeAppUpdate();
	const flags = state;
	flags.unsaved = options.unsaved ?? false;
	flags.pending = options.pending ?? false;
	const reload = vi.fn();
	const loadFully = vi.fn<(href: string) => void>();
	const view = render(AppUpdateNotice, {
		props: {
			state,
			reload,
			loadFully,
			unsaved: () => flags.unsaved,
			pending: () => flags.pending
		}
	});
	const navigate = (navigation: Partial<Navigation> = {}) =>
		mocks.onNavigate.at(-1)?.({
			type: 'link',
			willUnload: false,
			to: { url: new URL('http://127.0.0.1:8090/projekte') },
			...navigation
		});
	return { ...view, state, flags, reload, loadFully, navigate };
}

beforeEach(() => {
	mocks.onNavigate.length = 0;
});

describe('AppUpdateNotice', () => {
	it('shows nothing but the empty status region while the version is current', () => {
		const { container } = setup();

		expect(screen.getByRole('status').textContent?.trim()).toBe('');
		expect(container.querySelector('.section-message')).toBeNull();
	});

	it('shows neutral information with "Neu laden" once a new version is there', async () => {
		const { container, state, reload } = setup();

		state.current = true;
		await tick();

		const status = screen.getByRole('status');
		expect(status.textContent).toContain(TEXT);
		expect(status.textContent).toContain('Hinweis:');
		expect(status.textContent).not.toContain(UNSAVED);
		const message = container.querySelector('.section-message');
		expect(message?.getAttribute('data-tone')).toBe('info');
		expect(container.querySelector('[role="alert"]')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Neu laden' }));
		expect(reload).toHaveBeenCalledOnce();
	});

	it('says that unsaved input would be lost', async () => {
		const { state, flags } = setup({ unsaved: true });
		state.current = true;
		await tick();
		expect(screen.getByRole('status').textContent).toContain(UNSAVED);

		flags.unsaved = false;
		await tick();
		expect(screen.getByRole('status').textContent).not.toContain(UNSAVED);
	});

	it('loads the target of the next link as a new document after an update', async () => {
		const { state, loadFully, navigate } = setup();

		expect(navigate()).toBeUndefined();
		expect(loadFully).not.toHaveBeenCalled();

		state.current = true;
		const held = navigate();
		expect(loadFully).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:8090/projekte');
		expect(held).toBeInstanceOf(Promise);
	});

	it('keeps navigating inside the app while input, a bulk action or "Rückgängig" would be lost', () => {
		const { state, flags, loadFully, navigate } = setup({ unsaved: true });
		state.current = true;

		expect(navigate()).toBeUndefined();
		flags.unsaved = false;
		flags.pending = true;
		expect(navigate()).toBeUndefined();
		flags.pending = false;
		expect(navigate({ type: 'goto' })).toBeUndefined();
		expect(navigate({ type: 'popstate' })).toBeUndefined();
		expect(navigate({ willUnload: true })).toBeUndefined();
		expect(navigate({ to: null })).toBeUndefined();
		expect(loadFully).not.toHaveBeenCalled();
	});
});
