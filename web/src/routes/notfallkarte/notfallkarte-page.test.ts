// Notfallkarte (ADR-0046 §8): a printable page of its own, outside the header and navigation of the
// app. It asks the server only when it runs on Windows, shows where the app and the backups lie, the
// names of the access data and the steps for a new machine, never a passphrase or a value, and a
// button to print; for Linux and containers the hint of the page "Sicherung".

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMERGENCY_LOSSES, EMERGENCY_STEPS, parseOverview } from '$lib/domain/backup';
import Page from './+page.svelte';

const mocks = vi.hoisted(() => ({
	platform: 'windows' as string,
	// Who uses the tab (KOB-1, ADR-0057): the administrator here or elsewhere, or another account.
	who: 'pc' as 'pc' | 'remote' | 'member',
	contextRequests: 0,
	requests: 0,
	answer: null as unknown
}));

vi.mock('$lib/auth.svelte', () => ({ auth: { ensureValid: () => true, logout: () => undefined } }));
vi.mock('$lib/pocketbase', () => ({
	pb: { authStore: { token: 'token', record: { id: 'u0000000000000a' }, onChange: () => () => {} } }
}));
vi.mock('$lib/data/context', async (importOriginal) => ({
	...(await importOriginal<object>()),
	fetchContext: vi.fn(async () => {
		mocks.contextRequests += 1;
		const admin = mocks.who !== 'member';
		const local = mocks.who !== 'remote';
		return {
			kind: 'ready',
			context: {
				admin,
				local,
				platform: mocks.platform,
				scripts: admin && local && mocks.platform === 'windows',
				localUrl: admin ? 'http://127.0.0.1:8090' : null
			}
		};
	})
}));
vi.mock('$lib/data/backup', async (importOriginal) => ({
	...(await importOriginal<object>()),
	fetchBackupOverview: vi.fn(async () => {
		mocks.requests += 1;
		return mocks.answer;
	})
}));

const OVERVIEW = parseOverview({
	appDir: 'C:\\Apps\\app',
	settings: { target: 'E:\\Sicherung', daily: 7, weekly: 4, monthly: 6, credentials: true },
	passphrase: 'set',
	helper: true,
	variables: ['BYL_TELEGRAM_TOKEN', 'BYL_WEBDE_PASSWORD'],
	target: {
		path: 'E:\\Sicherung',
		reachable: true,
		problem: null,
		freeBytes: 1,
		sameDrive: false
	},
	local: [
		{ name: 'byl-20261001-100000.zip', at: '2026-10-01T10:00:00.000Z', bytes: 1, ours: true }
	],
	sealed: [{ name: 'byl-20261001-100000.tar.age', at: '2026-10-01T10:00:00.000Z', bytes: 1 }],
	last: { backup: null, backupError: null, export: null, exportProblem: null },
	nextBackupAt: null,
	warnings: []
});

beforeEach(() => {
	mocks.who = 'pc';
	mocks.contextRequests = 0;
	mocks.requests = 0;
	mocks.answer = { kind: 'ok', value: OVERVIEW };
	document.body.innerHTML = '';
});

describe('Notfallkarte', () => {
	it('shows where everything lies, the names of the access data and the steps, never a secret', async () => {
		mocks.platform = 'windows';
		render(Page);
		const card = await screen.findByRole('article', { name: 'Notfallkarte becauseyoulovejira' });
		const content = within(card);
		expect(content.getByText('C:\\Apps\\app')).toBeTruthy();
		expect(content.getByText('E:\\Sicherung')).toBeTruthy();
		expect(content.getByText('byl-20261001-100000.tar.age (01.10.2026 12:00)')).toBeTruthy();
		expect(
			content.getByText(/^BYL_TELEGRAM_TOKEN, BYL_WEBDE_PASSWORD \(nur die Namen/)
		).toBeTruthy();
		const items = content.getAllByRole('listitem').map((item) => item.textContent ?? '');
		for (const step of EMERGENCY_STEPS) {
			expect(
				items.some((text) => text.includes(step.text)),
				step.title
			).toBe(true);
		}
		for (const loss of EMERGENCY_LOSSES) expect(items, loss).toContain(loss);
		expect(card.textContent).toContain('nie die Passphrase selbst');
		expect(mocks.requests).toBe(1);
	});

	it('prints with a button, next to the way back to the page "Sicherung"', async () => {
		mocks.platform = 'windows';
		const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
		render(Page);
		await screen.findByRole('article');
		const tools = within(screen.getByRole('navigation', { name: 'Notfallkarte' }));
		expect(
			tools
				.getByRole('link', { name: '← Zurück zu Einstellungen → Sicherung' })
				.getAttribute('href')
		).toBe('/einstellungen/sicherung');
		await fireEvent.click(tools.getByRole('button', { name: 'Drucken' }));
		expect(print).toHaveBeenCalled();
		print.mockRestore();
	});

	it('prints with the light tokens, also in dark mode, and keeps the mode of before', async () => {
		mocks.platform = 'windows';
		const root = document.documentElement;
		render(Page);
		await screen.findByRole('article');
		root.setAttribute('data-theme', 'dark');
		window.dispatchEvent(new Event('beforeprint'));
		expect(root.getAttribute('data-theme')).toBe('light');
		window.dispatchEvent(new Event('afterprint'));
		expect(root.getAttribute('data-theme')).toBe('dark');
		root.removeAttribute('data-theme');
		window.dispatchEvent(new Event('beforeprint'));
		expect(root.getAttribute('data-theme')).toBe('light');
		window.dispatchEvent(new Event('afterprint'));
		expect(root.hasAttribute('data-theme')).toBe(false);
	});

	it('names a refusal of the server instead of the card', async () => {
		mocks.platform = 'windows';
		mocks.answer = { kind: 'denied', reason: 'owner' };
		render(Page);
		await screen.findByText('Nur für den Verwalter der App');
		expect(screen.queryByRole('article')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Drucken' })).toBeNull();
	});

	it('shows the hint for a server on Linux without asking it', async () => {
		mocks.platform = 'linux';
		render(Page);
		await screen.findByText('Nur für einen Server unter Windows');
		expect(mocks.requests).toBe(0);
	});

	it('shows the way to the machine of the app on another device, without asking for the backups (KOB-1)', async () => {
		mocks.platform = 'windows';
		mocks.who = 'remote';
		render(Page);
		await screen.findByText('Nur direkt am PC');
		expect(
			screen.getByText(
				'Nur direkt am PC verfügbar, auf dem becauseyoulovejira läuft (dort über http://127.0.0.1:8090 öffnen).'
			)
		).toBeTruthy();
		expect(mocks.contextRequests).toBe(1);
		expect(mocks.requests).toBe(0);
		expect(screen.queryByRole('button', { name: 'Drucken' })).toBeNull();
	});

	it('says "Nur für den Verwalter" to another account, without asking for the backups (KOB-1)', async () => {
		mocks.platform = 'windows';
		mocks.who = 'member';
		render(Page);
		await screen.findByText('Nur für den Verwalter');
		expect(mocks.requests).toBe(0);
		expect(document.body.textContent).not.toMatch(/\.bat/);
	});
});
