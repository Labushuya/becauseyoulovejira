// GitHub on the page "Kanäle" (ADR-0050 §7, plan beobachtete-quellen GH-2): the card with its
// repositories, the details per repository (last change, open pull requests, last release, last
// run, paths as ChipList), the interval, "Repository hinzufügen …", "Einstellungen …", removing,
// "Verbindung prüfen" and a run that meets the rate limit; the assistant with the token, the first
// repository, more repositories inline and the check. Fakes instead of PocketBase (the routes:
// tests/integration/github-channel.test.mjs).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PC_CONTEXT, useContext } from '$lib/test/context';
import { DataError } from '$lib/data/errors';
import type { Connection, SecretStatus } from '$lib/domain/connections';
import {
	EMPTY_GITHUB_SETTINGS,
	GITHUB_DEFAULT_PATHS,
	type GitHubDetails,
	type GitHubRepoList,
	type GitHubRepoSettings,
	type GitHubSettings
} from '$lib/domain/github';
import type { ProjectRef } from '$lib/domain/ticket';
import { ConnectionsStore, type ConnectionsData } from '$lib/stores/connections.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import ChannelsViewHarness from '$lib/test/ChannelsViewHarness.svelte';
import {
	AUTO_OFF,
	EMPTY_DETAILS,
	EMPTY_LIST,
	OK_CHECK,
	fakeGitHubData,
	githubStoreOf
} from '$lib/test/github-fake';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

useOverlayStubs();

const ID = 'conn00000000007';
const HAUS: ProjectRef = { id: 'haus00000000001', name: 'Haus', code: 'HAUS', archived: false };

function repo(name: string, overrides: Partial<GitHubRepoSettings> = {}): GitHubRepoSettings {
	return {
		repo: name,
		paths: [...GITHUB_DEFAULT_PATHS],
		events: { files: true, pulls: true, releases: true },
		target: null,
		...overrides
	};
}

function githubConnection(
	overrides: Partial<Connection> = {},
	repos: GitHubRepoSettings[] = [repo('octo-org/roadmap')]
): Connection {
	return {
		id: ID,
		type: 'github',
		label: 'GitHub',
		enabled: true,
		secretEnv: 'BYL_GITHUB_TOKEN',
		allowlistEnv: '',
		lastRunAt: '2026-10-02 10:00:00.000Z',
		lastOkAt: '2026-10-02 10:00:00.000Z',
		lastError: '',
		lastHint: '',
		keywords: [],
		replySaved: true,
		replyNoMatch: true,
		mailProvider: '',
		mailUser: '',
		matchBody: false,
		github: { ...EMPTY_GITHUB_SETTINGS, repos },
		runningSince: null,
		created: '2026-10-02 09:00:00.000Z',
		updated: '2026-10-02 10:00:00.000Z',
		...overrides
	};
}

const DETAILS: GitHubDetails = {
	...EMPTY_DETAILS,
	rate: { limit: 5000, remaining: 4321, reset: '' },
	repos: [
		{
			repo: 'octo-org/roadmap',
			key: 'octo-org/roadmap',
			auto: false,
			url: 'https://github.com/octo-org/roadmap',
			branch: 'main',
			private: true,
			paths: [...GITHUB_DEFAULT_PATHS],
			events: { files: true, pulls: true, releases: true },
			target: null,
			files: 2,
			filesMore: 0,
			truncated: false,
			lastChange: {
				path: 'CHANGELOG.md',
				action: 'changed',
				at: '2026-10-02T08:05:00.000Z',
				url: 'https://github.com/octo-org/roadmap/compare/aaa...bbb'
			},
			openPulls: 3,
			openPullsMore: false,
			lastRelease: {
				tag: 'v1.2.0',
				name: '',
				at: '2026-10-01T08:00:00.000Z',
				url: '',
				prerelease: false
			},
			checkedAt: '2026-10-02T10:00:00.000Z',
			okAt: '2026-10-02T10:00:00.000Z',
			error: ''
		}
	]
};

function connectionsOf(
	first: Connection | null,
	status: SecretStatus = { secret: true, allowlist: null },
	flags = new FlagStore()
) {
	let current = first;
	const data = {
		list: vi.fn<ConnectionsData['list']>(async () => (current === null ? [] : [current])),
		create: vi.fn<ConnectionsData['create']>(async (draft) => {
			current = githubConnection({
				label: draft.label.trim(),
				secretEnv: draft.secretEnv,
				lastRunAt: null,
				lastOkAt: null,
				github: {
					...EMPTY_GITHUB_SETTINGS,
					repos: draft.githubRepo ? [draft.githubRepo] : [],
					auto: draft.githubAuto === true
				}
			});
			return current;
		}),
		setEnabled: vi.fn<ConnectionsData['setEnabled']>(),
		rename: vi.fn<ConnectionsData['rename']>(),
		setTarget: vi.fn<ConnectionsData['setTarget']>(),
		saveSettings: vi.fn<ConnectionsData['saveSettings']>(),
		saveGitHub: vi.fn<ConnectionsData['saveGitHub']>(async (_id, settings: GitHubSettings) => {
			current = {
				...(current as Connection),
				github: settings,
				updated: '2026-10-02 10:30:00.000Z'
			};
			return current;
		}),
		saveFolders: vi.fn<ConnectionsData['saveFolders']>(),
		remove: vi.fn<ConnectionsData['remove']>(),
		secretStatus: vi.fn<ConnectionsData['secretStatus']>(async () => status),
		run: vi.fn<ConnectionsData['run']>(async () => ({
			status: 'ok',
			created: 1,
			duplicates: 0,
			updated: 0,
			skipped: 0,
			failed: 0,
			unmatched: 0,
			error: '',
			missing: []
		})),
		get: vi.fn<ConnectionsData['get']>(async () => ({
			...(current as Connection),
			lastRunAt: '2026-10-02 10:45:00.000Z',
			updated: '2026-10-02 10:45:00.000Z'
		})),
		listMailbox: vi.fn<ConnectionsData['listMailbox']>(),
		importMailbox: vi.fn<ConnectionsData['importMailbox']>(),
		subscribe: vi.fn<ConnectionsData['subscribe']>(async () => async () => undefined),
		helperStatus: vi.fn<ConnectionsData['helperStatus']>(),
		scan: vi.fn<ConnectionsData['scan']>()
	} satisfies ConnectionsData;
	return {
		data,
		flags,
		store: new ConnectionsStore(data, { ensureValid: () => true, logout: vi.fn() }, flags)
	};
}

async function open(
	item: Connection = githubConnection(),
	{
		status = { secret: true, allowlist: null },
		details = DETAILS,
		list = EMPTY_LIST
	}: { status?: SecretStatus; details?: GitHubDetails; list?: GitHubRepoList } = {}
) {
	const flags = new FlagStore();
	const connections = connectionsOf(item, status, flags);
	const data = fakeGitHubData();
	data.details.mockImplementation(async () => details);
	data.repos.mockImplementation(async () => list);
	const github = githubStoreOf(data, flags);
	await connections.store.load();
	render(ChannelsViewHarness, {
		props: { connections: connections.store, github, projects: [HAUS], onchange: vi.fn() }
	});
	await vi.waitFor(() => expect(screen.getByRole('article', { name: item.label })).toBeTruthy());
	return {
		connections,
		data,
		flags,
		card: within(screen.getByRole('article', { name: item.label }))
	};
}

/** The menu "•••" of the card; jsdom shows popovers as hidden. */
function cardMenu(card: ReturnType<typeof within>, label = 'GitHub') {
	const trigger = card.getByRole('button', { name: `Weitere Aktionen für ${label}` });
	const menu = within(document.getElementById(trigger.getAttribute('aria-controls') ?? '')!);
	const items = () =>
		menu.getAllByRole('menuitem', { hidden: true }).map((item) => item.textContent?.trim());
	return { trigger, menu, items };
}

afterEach(() => {
	document.body.innerHTML = '';
	sessionStorage.clear();
});

// The administrator on the machine of the app (KOB-1, ADR-0057): everything as before.
beforeEach(async () => {
	await useContext(PC_CONTEXT);
});

describe('GitHub card', () => {
	it('shows the repositories with their details and offers "Jetzt abrufen" first', async () => {
		const { card, data } = await open();
		expect(card.getByText('GitHub · Repositorys beobachten, nur lesend')).toBeTruthy();
		expect(card.getByText('Verbunden')).toBeTruthy();
		expect(card.getByText(/^1 Repository · Zuletzt abgerufen/)).toBeTruthy();
		const main = card.getByRole('button', { name: 'Jetzt abrufen: GitHub' });
		expect(main.hasAttribute('data-card-primary')).toBe(true);
		const { menu, items } = cardMenu(card);
		expect(items()).toEqual([
			'Repository hinzufügen …',
			'Verbindung prüfen',
			'Zielprojekt …',
			'Pausieren',
			'Umbenennen …',
			'Einrichtung ansehen',
			'Hilfe',
			'Löschen …'
		]);
		expect(menu.getByRole('menuitem', { name: 'Hilfe', hidden: true }).getAttribute('href')).toBe(
			'/einstellungen/hilfe#github'
		);
		// No keywords: the choice of paths and events is the filter (ADR-0020, addendum 5).
		expect(items().some((item) => item?.startsWith('Stichwörter'))).toBe(false);
		await vi.waitFor(() => expect(data.details).toHaveBeenCalledWith(ID, expect.anything()));

		await fireEvent.click(card.getByRole('button', { name: 'Details: GitHub' }));
		expect(card.getByText('Token aus BYL_GITHUB_TOKEN, 5.000 Anfragen je Stunde')).toBeTruthy();
		expect(card.getByText('4.321 von 5.000 Anfragen übrig')).toBeTruthy();
		expect((card.getByLabelText('Abruf') as HTMLSelectElement).value).toBe('15');
		const repos = within(card.getByRole('region', { name: 'Repositorys von „GitHub“' }));
		expect(repos.getByRole('link', { name: /octo-org\/roadmap/ }).getAttribute('href')).toBe(
			'https://github.com/octo-org/roadmap'
		);
		expect(repos.getByText('Privat')).toBeTruthy();
		expect(
			repos
				.getByRole('link', { name: /CHANGELOG\.md geändert, 02\.10\.2026 10:05/ })
				.getAttribute('href')
		).toBe('https://github.com/octo-org/roadmap/compare/aaa...bbb');
		expect(repos.getByText('3')).toBeTruthy();
		expect(repos.getByText('v1.2.0, 01.10.2026 10:00')).toBeTruthy();
		expect(repos.getByText('Dateien, Pull Requests, Releases')).toBeTruthy();
		expect(repos.getByText('wie die Verbindung')).toBeTruthy();
		expect(repos.getByText('2 Dateien')).toBeTruthy();
		const paths = within(
			repos.getByRole('list', { name: 'Beobachtete Pfade von octo-org/roadmap' })
		);
		expect(paths.getAllByRole('listitem').map((chip) => chip.textContent?.trim())).toEqual([
			...GITHUB_DEFAULT_PATHS
		]);
		expect(repos.getByRole('button', { name: 'Einstellungen …: octo-org/roadmap' })).toBeTruthy();
		const remove = repos.getByRole('button', { name: 'octo-org/roadmap entfernen …' });
		expect(remove.className).toMatch(/button-icon/);
	});

	it('reads public repositories without a token: a neutral hint, no open setup', async () => {
		const { card } = await open(githubConnection(), {
			status: { secret: false, allowlist: null },
			details: { ...DETAILS, authenticated: false }
		});
		expect(card.getByText('Verbunden')).toBeTruthy();
		expect(card.queryByText('Einrichtung offen')).toBeNull();
		expect(
			card.getByText(/^Ohne Token: nur öffentliche Repositorys, 60 Anfragen je Stunde/)
		).toBeTruthy();
		expect(card.getByRole('button', { name: 'Jetzt abrufen: GitHub' })).toBeTruthy();
	});

	it('adds the first repository from the main button and runs once for the starting point', async () => {
		const { card, connections, flags } = await open(githubConnection({}, []), {
			details: EMPTY_DETAILS
		});
		expect(card.getByText('Noch kein Repository')).toBeTruthy();
		await fireEvent.click(card.getByRole('button', { name: 'Repository hinzufügen …: GitHub' }));
		const dialog = within(
			screen.getByRole('dialog', { name: 'Repository zu „GitHub“ hinzufügen' })
		);
		// The paths of the spec are set, the Markdown files below docs are not.
		expect(
			(dialog.getByLabelText('Beobachtete Pfade, ein Muster je Zeile') as HTMLTextAreaElement).value
		).toBe(GITHUB_DEFAULT_PATHS.join('\n'));
		expect(
			(dialog.getByLabelText(/Alle Markdown-Dateien unter docs/) as HTMLInputElement).checked
		).toBe(false);
		await fireEvent.click(dialog.getByRole('button', { name: 'Hinzufügen' }));
		expect(dialog.getByText(/^Bitte ein Repository als „Besitzer\/Name“/)).toBeTruthy();
		expect(connections.data.saveGitHub).not.toHaveBeenCalled();

		await fireEvent.input(dialog.getByLabelText('Repository (Pflichtfeld)'), {
			target: { value: 'https://github.com/octo-org/roadmap' }
		});
		await fireEvent.input(dialog.getByLabelText('Beobachtete Pfade, ein Muster je Zeile'), {
			target: { value: 'CHANGELOG*\n/abs' }
		});
		await fireEvent.click(dialog.getByRole('button', { name: 'Hinzufügen' }));
		expect(dialog.getByText(/^„\/abs“: Ein Muster beginnt ohne/)).toBeTruthy();

		await fireEvent.input(dialog.getByLabelText('Beobachtete Pfade, ein Muster je Zeile'), {
			target: { value: 'CHANGELOG*' }
		});
		await fireEvent.click(dialog.getByLabelText('Releases'));
		await fireEvent.change(dialog.getByLabelText('Zielprojekt dieses Repositorys'), {
			target: { value: HAUS.id }
		});
		await fireEvent.click(dialog.getByRole('button', { name: 'Hinzufügen' }));
		await vi.waitFor(() =>
			expect(connections.data.saveGitHub).toHaveBeenCalledWith(ID, {
				...EMPTY_GITHUB_SETTINGS,
				repos: [
					repo('octo-org/roadmap', {
						paths: ['CHANGELOG*'],
						events: { files: true, pulls: true, releases: false },
						target: HAUS.id
					})
				]
			})
		);
		await vi.waitFor(() =>
			expect(screen.queryByRole('dialog', { name: /hinzufügen$/ })).toBeNull()
		);
		await vi.waitFor(() => expect(connections.data.run).toHaveBeenCalledWith(ID));
		expect(flags.flags.map((flag) => flag.title)).toContain(
			'„octo-org/roadmap“ zu „GitHub“ hinzugefügt.'
		);
	});

	it('changes the settings of a repository with its name fixed, and removes it after a question', async () => {
		const { card, connections } = await open();
		await fireEvent.click(card.getByRole('button', { name: 'Details: GitHub' }));
		await fireEvent.click(card.getByRole('button', { name: 'Einstellungen …: octo-org/roadmap' }));
		const dialog = within(
			screen.getByRole('dialog', { name: 'Repository octo-org/roadmap einstellen' })
		);
		expect(dialog.queryByLabelText('Repository (Pflichtfeld)')).toBeNull();
		expect(dialog.getByText('octo-org/roadmap')).toBeTruthy();
		await fireEvent.click(dialog.getByLabelText(/Alle Markdown-Dateien unter docs/));
		await fireEvent.click(dialog.getByRole('button', { name: 'Speichern' }));
		await vi.waitFor(() =>
			expect(connections.data.saveGitHub).toHaveBeenLastCalledWith(ID, {
				...EMPTY_GITHUB_SETTINGS,
				repos: [repo('octo-org/roadmap', { paths: [...GITHUB_DEFAULT_PATHS, 'docs/**/*.md'] })]
			})
		);
		// Changing is no first run: nothing is fetched by itself.
		expect(connections.data.run).not.toHaveBeenCalled();

		await fireEvent.click(card.getByRole('button', { name: 'octo-org/roadmap entfernen …' }));
		const question = within(
			screen.getByRole('dialog', { name: 'octo-org/roadmap nicht mehr beobachten?' })
		);
		await fireEvent.click(question.getByRole('button', { name: 'Entfernen' }));
		await vi.waitFor(() =>
			expect(connections.data.saveGitHub).toHaveBeenLastCalledWith(ID, EMPTY_GITHUB_SETTINGS)
		);
	});

	it('saves another interval at once', async () => {
		const { card, connections, flags } = await open();
		await fireEvent.click(card.getByRole('button', { name: 'Details: GitHub' }));
		await fireEvent.change(card.getByLabelText('Abruf'), { target: { value: '30' } });
		await vi.waitFor(() =>
			expect(connections.data.saveGitHub).toHaveBeenCalledWith(ID, {
				...EMPTY_GITHUB_SETTINGS,
				interval: 30,
				repos: [repo('octo-org/roadmap')]
			})
		);
		expect(flags.flags[0]?.title).toBe('„GitHub“ ruft jetzt alle 30 Minuten ab.');
	});

	it('checks the connection from the menu and announces the answer', async () => {
		const { card, data, flags } = await open();
		data.check.mockImplementation(async () => ({
			...OK_CHECK,
			repos: [
				{ repo: 'octo-org/roadmap', ok: true, name: 'octo-org/roadmap', private: true, message: '' }
			]
		}));
		const { trigger, menu } = cardMenu(card);
		await fireEvent.click(trigger);
		await fireEvent.click(menu.getByRole('menuitem', { name: 'Verbindung prüfen', hidden: true }));
		await vi.waitFor(() => expect(data.check).toHaveBeenCalledWith(ID));
		await vi.waitFor(() =>
			expect(flags.flags[0]).toMatchObject({
				tone: 'success',
				title:
					'„GitHub“: GitHub nimmt den Token von @octo an, 4.990 von 5.000 Anfragen übrig. Das Repository ist erreichbar.'
			})
		);
	});

	it('says a rate limit neutrally after "Jetzt abrufen"', async () => {
		const { card, connections, flags } = await open();
		const hint = 'Anfragelimit von GitHub erreicht; der nächste Abruf folgt ab 14:00.';
		connections.data.run.mockImplementation(async () => ({
			status: 'limited',
			created: 0,
			duplicates: 0,
			updated: 0,
			skipped: 0,
			failed: 0,
			unmatched: 0,
			error: '',
			missing: [],
			hint
		}));
		await fireEvent.click(card.getByRole('button', { name: 'Jetzt abrufen: GitHub' }));
		await vi.waitFor(() =>
			expect(flags.flags[0]).toMatchObject({ tone: 'info', title: `„GitHub“: ${hint}` })
		);
		expect(card.getByText(/· Anfragelimit erreicht$/)).toBeTruthy();
	});

	it('names the restart when the server does not know the details yet', async () => {
		const flags = new FlagStore();
		const connections = connectionsOf(githubConnection(), undefined, flags);
		const data = fakeGitHubData();
		data.details.mockImplementation(async () => {
			throw new DataError('not_found', { status: 404 });
		});
		await connections.store.load();
		render(ChannelsViewHarness, {
			props: {
				connections: connections.store,
				github: githubStoreOf(data, flags),
				onchange: vi.fn()
			}
		});
		const card = within(await screen.findByRole('article', { name: 'GitHub' }));
		await fireEvent.click(card.getByRole('button', { name: 'Details: GitHub' }));
		await vi.waitFor(() =>
			expect(
				card.getByText(/^Die Details von GitHub sind nach dem nächsten Neustart verfügbar/)
			).toBeTruthy()
		);
	});
});

describe('GitHub assistant', () => {
	it('creates the connection with its first repository, adds more inline and checks', async () => {
		const flags = new FlagStore();
		const connections = connectionsOf(null, { secret: false, allowlist: null }, flags);
		const data = fakeGitHubData();
		await connections.store.load();
		const onchange = vi.fn();
		render(ChannelsViewHarness, {
			props: {
				connections: connections.store,
				github: githubStoreOf(data, flags),
				setup: { kind: 'github', connectionId: null },
				onchange
			}
		});
		const dialog = within(await screen.findByRole('dialog', { name: 'GitHub einrichten' }));
		const heading = () => dialog.getByRole('heading', { level: 3, name: /^Schritt \d von 6/ });
		expect(heading().textContent).toMatch(/Token auf GitHub anlegen \(nur lesend\)/);
		// Two equal ways for the repositories of the token, the difference said honestly.
		expect(
			dialog.getByText(
				/„All repositories“ \(einfach: .*\) oder „Only select repositories“ \(strenger/
			)
		).toBeTruthy();
		expect(dialog.getByText(/^Der Unterschied ist die Reichweite des Tokens/)).toBeTruthy();
		expect(dialog.getByText(/„Contents“ und „Pull requests“ auf „Read-only“/)).toBeTruthy();
		expect(dialog.getByRole('link', { name: /neues Token, vorbelegt/ }).getAttribute('href')).toBe(
			'https://github.com/settings/personal-access-tokens/new?name=becauseyoulovejira&expires_in=90&contents=read&pull_requests=read'
		);
		await fireEvent.click(dialog.getByRole('button', { name: 'Weiter' }));
		expect(heading().textContent).toMatch(/Token als Windows-Variable setzen/);
		expect(dialog.getAllByText(/BYL_GITHUB_TOKEN/).length).toBeGreaterThan(0);
		await fireEvent.click(dialog.getByRole('button', { name: 'Weiter' }));
		expect(heading().textContent).toMatch(/App neu starten/);
		await fireEvent.click(dialog.getByRole('button', { name: 'Weiter' }));
		expect(heading().textContent).toMatch(/Repositorys hinzufügen/);

		await fireEvent.input(dialog.getByLabelText('Bezeichnung (Pflichtfeld)'), {
			target: { value: 'Roadmaps' }
		});
		expect(
			(dialog.getByLabelText('Name der Variablen für das Token (Pflichtfeld)') as HTMLInputElement)
				.value
		).toBe('BYL_GITHUB_TOKEN');
		await fireEvent.input(dialog.getByLabelText('Repository (Pflichtfeld)'), {
			target: { value: 'octo-org/roadmap' }
		});
		await fireEvent.click(dialog.getByRole('button', { name: 'Verbindung anlegen' }));
		await vi.waitFor(() =>
			expect(connections.data.create).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'github',
					label: 'Roadmaps',
					secretEnv: 'BYL_GITHUB_TOKEN',
					githubRepo: repo('octo-org/roadmap')
				})
			)
		);
		await vi.waitFor(() =>
			expect(onchange).toHaveBeenLastCalledWith({ kind: 'github', connectionId: ID })
		);

		// The same step lists the repository and takes another one inline (no dialog from a dialog).
		const list = within(await dialog.findByRole('region', { name: 'Beobachtete Repositorys' }));
		expect(list.getByText('octo-org/roadmap')).toBeTruthy();
		await fireEvent.input(dialog.getByLabelText('Repository (Pflichtfeld)'), {
			target: { value: 'octo-org/site' }
		});
		await fireEvent.click(dialog.getByRole('button', { name: 'Repository hinzufügen' }));
		await vi.waitFor(() =>
			expect(connections.data.saveGitHub).toHaveBeenCalledWith(ID, {
				...EMPTY_GITHUB_SETTINGS,
				repos: [repo('octo-org/roadmap'), repo('octo-org/site')]
			})
		);
		await vi.waitFor(() => expect(list.getByText('octo-org/site')).toBeTruthy());
		expect(screen.getAllByRole('dialog')).toHaveLength(1);

		await fireEvent.click(dialog.getByRole('button', { name: /Prüfen/ }));
		expect(heading().textContent).toMatch(/Verbindung prüfen/);
		data.check.mockImplementation(async () => ({
			...OK_CHECK,
			authenticated: false,
			login: '',
			rate: { limit: 60, remaining: 58, reset: '' },
			repos: [
				{
					repo: 'octo-org/roadmap',
					ok: true,
					name: 'octo-org/roadmap',
					private: false,
					message: ''
				},
				{
					repo: 'octo-org/site',
					ok: false,
					name: 'octo-org/site',
					private: false,
					message: 'Repository nicht gefunden oder ohne Zugriff.'
				}
			]
		}));
		await fireEvent.click(dialog.getByRole('button', { name: 'Verbindung prüfen' }));
		await vi.waitFor(() => expect(data.check).toHaveBeenCalledWith(ID));
		await vi.waitFor(() =>
			expect(
				dialog.getByText(
					'GitHub antwortet ohne Token (nur öffentliche Repositorys), 58 von 60 Anfragen übrig. 1 Repository ist nicht erreichbar.'
				)
			).toBeTruthy()
		);
		const checked = within(dialog.getByRole('list', { name: 'Repositorys' }));
		expect(checked.getByText('octo-org/roadmap: erreichbar')).toBeTruthy();
		expect(
			checked.getByText('octo-org/site: Repository nicht gefunden oder ohne Zugriff.')
		).toBeTruthy();
		await tick();
	});

	it('creates the connection with "Alle meine Repositorys" and no first repository', async () => {
		const connections = connectionsOf(null);
		await connections.store.load();
		render(ChannelsViewHarness, {
			props: {
				connections: connections.store,
				github: githubStoreOf(),
				setup: { kind: 'github', connectionId: null },
				onchange: vi.fn()
			}
		});
		const dialog = within(await screen.findByRole('dialog', { name: 'GitHub einrichten' }));
		for (let step = 0; step < 3; step += 1) {
			await fireEvent.click(dialog.getByRole('button', { name: 'Weiter' }));
		}
		await fireEvent.input(dialog.getByLabelText('Bezeichnung (Pflichtfeld)'), {
			target: { value: 'Meine' }
		});
		await fireEvent.click(dialog.getByLabelText(/^Alle meine Repositorys beobachten/));
		// The first repository is optional now.
		expect(dialog.getByLabelText('Oder ein Repository eintippen')).toBeTruthy();
		await fireEvent.click(dialog.getByRole('button', { name: 'Verbindung anlegen' }));
		await vi.waitFor(() =>
			expect(connections.data.create).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'github', githubRepo: null, githubAuto: true })
			)
		);
		// The step offers the switch, on, and the form for more.
		const region = within(await dialog.findByRole('region', { name: 'Beobachtete Repositorys' }));
		expect(
			(
				region.getByRole('switch', {
					name: 'Alle meine Repositorys beobachten'
				}) as HTMLInputElement
			).checked
		).toBe(true);
		expect(
			region.getByText('Kein Repository eingetragen; die App beobachtet alle deine eigenen.')
		).toBeTruthy();
	});

	it('names the restart when the hooks of before refuse "Alle meine Repositorys"', async () => {
		const connections = connectionsOf(null);
		connections.data.create.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					settings: {
						code: 'validation_github_settings',
						message: 'Unbekannte Einstellung des GitHub-Kanals.'
					}
				}
			})
		);
		await connections.store.load();
		render(ChannelsViewHarness, {
			props: {
				connections: connections.store,
				github: githubStoreOf(),
				setup: { kind: 'github', connectionId: null },
				onchange: vi.fn()
			}
		});
		const dialog = within(await screen.findByRole('dialog', { name: 'GitHub einrichten' }));
		for (let step = 0; step < 3; step += 1) {
			await fireEvent.click(dialog.getByRole('button', { name: 'Weiter' }));
		}
		await fireEvent.input(dialog.getByLabelText('Bezeichnung (Pflichtfeld)'), {
			target: { value: 'Meine' }
		});
		await fireEvent.click(dialog.getByLabelText(/^Alle meine Repositorys beobachten/));
		await fireEvent.click(dialog.getByRole('button', { name: 'Verbindung anlegen' }));
		await vi.waitFor(() =>
			expect(
				dialog.getByText(
					/^„Alle meine Repositorys beobachten“ ist nach dem nächsten Neustart verfügbar/
				)
			).toBeTruthy()
		);
		expect(dialog.queryByText('Unbekannte Einstellung des GitHub-Kanals.')).toBeNull();
	});
});

describe('repositories of the token and "Alle meine Repositorys" (addendum of 2026-10-02)', () => {
	const LIST: GitHubRepoList = {
		...EMPTY_LIST,
		login: 'anna',
		repos: [
			{
				repo: 'anna/notes',
				key: 'anna/notes',
				private: true,
				archived: false,
				fork: false,
				org: false,
				own: true,
				state: ''
			},
			{
				repo: 'anna/roadmap',
				key: 'anna/roadmap',
				private: false,
				archived: false,
				fork: false,
				org: false,
				own: true,
				state: ''
			},
			{
				repo: 'octo-org/roadmap',
				key: 'octo-org/roadmap',
				private: true,
				archived: false,
				fork: false,
				org: true,
				own: false,
				state: 'entered'
			}
		]
	};

	async function openAdd(card: ReturnType<typeof within>) {
		const { trigger, menu } = cardMenu(card);
		await fireEvent.click(trigger);
		await fireEvent.click(
			menu.getByRole('menuitem', { name: 'Repository hinzufügen …', hidden: true })
		);
		return within(screen.getByRole('dialog', { name: 'Repository zu „GitHub“ hinzufügen' }));
	}

	it('offers the repositories of the token: several at once, entered ones locked, typing stays', async () => {
		const { card, connections, data, flags } = await open(githubConnection(), { list: LIST });
		const dialog = await openAdd(card);
		await vi.waitFor(() =>
			expect(dialog.getByRole('checkbox', { name: /anna\/notes/ })).toBeTruthy()
		);
		expect(data.repos).toHaveBeenCalledWith(ID, expect.objectContaining({ refresh: false }));
		const group = within(dialog.getByRole('group', { name: 'Aus deinen Repositorys wählen' }));
		// Own repositories first; the entered one is checked and locked.
		expect(group.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent)).toEqual([
			expect.stringContaining('anna/notes'),
			expect.stringContaining('anna/roadmap'),
			expect.stringContaining('octo-org/roadmap')
		]);
		const entered = group.getByRole('checkbox', { name: /octo-org\/roadmap/ }) as HTMLInputElement;
		expect(entered.checked).toBe(true);
		expect(entered.getAttribute('aria-disabled')).toBe('true');
		expect(entered.closest('label')?.textContent).toContain(
			'schon eingetragen, privat, Organisation'
		);
		await fireEvent.click(entered);
		expect(entered.checked).toBe(true);
		// Typing is the other way, optional with a list.
		expect(dialog.getByLabelText('Oder ein Repository eintippen')).toBeTruthy();
		await fireEvent.click(dialog.getByRole('button', { name: 'Hinzufügen' }));
		expect(dialog.getByText(/^Bitte ein Repository aus der Liste wählen/)).toBeTruthy();

		await fireEvent.click(group.getByRole('checkbox', { name: /anna\/notes/ }));
		await fireEvent.click(group.getByRole('checkbox', { name: /anna\/roadmap/ }));
		await fireEvent.click(dialog.getByLabelText('Releases'));
		await fireEvent.click(dialog.getByRole('button', { name: 'Hinzufügen' }));
		const events = { files: true, pulls: true, releases: false };
		await vi.waitFor(() =>
			expect(connections.data.saveGitHub).toHaveBeenCalledWith(ID, {
				...EMPTY_GITHUB_SETTINGS,
				repos: [
					repo('octo-org/roadmap'),
					repo('anna/notes', { events }),
					repo('anna/roadmap', { events })
				]
			})
		);
		expect(flags.flags.map((flag) => flag.title)).toContain(
			'2 Repositorys zu „GitHub“ hinzugefügt.'
		);
		await vi.waitFor(() => expect(connections.data.run).toHaveBeenCalledWith(ID));
	});

	it('filters the list and reads it again on request', async () => {
		const many: GitHubRepoList = {
			...LIST,
			repos: Array.from({ length: 12 }, (_, index) => ({
				...LIST.repos[0]!,
				repo: `anna/projekt-${index}`,
				key: `anna/projekt-${index}`
			}))
		};
		const { card, data } = await open(githubConnection(), { list: many });
		const dialog = await openAdd(card);
		const filter = await vi.waitFor(() =>
			dialog.getByRole('searchbox', { name: 'Repositorys filtern' })
		);
		await fireEvent.input(filter, { target: { value: 'PROJEKT-1' } });
		const group = within(dialog.getByRole('group', { name: 'Aus deinen Repositorys wählen' }));
		expect(
			group.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent?.trim())
		).toEqual(['anna/projekt-1 privat', 'anna/projekt-10 privat', 'anna/projekt-11 privat']);
		expect(group.getByText('3 von 12')).toBeTruthy();
		// Esc empties the filter first and stays in the dialog.
		await fireEvent.keyDown(filter, { key: 'Escape' });
		expect((filter as HTMLInputElement).value).toBe('');
		expect(screen.getByRole('dialog', { name: 'Repository zu „GitHub“ hinzufügen' })).toBeTruthy();
		await fireEvent.click(dialog.getByRole('button', { name: 'Liste neu laden' }));
		await vi.waitFor(() =>
			expect(data.repos).toHaveBeenLastCalledWith(ID, expect.objectContaining({ refresh: true }))
		);
	});

	it('says why there is no list: no token, or a server before the restart', async () => {
		const { card } = await open(githubConnection(), {
			status: { secret: false, allowlist: null },
			details: { ...DETAILS, authenticated: false },
			list: {
				...EMPTY_LIST,
				status: 'no_token',
				message:
					'Ohne Token nennt GitHub keine Liste deiner Repositorys. Trag das Repository als „Besitzer/Name“ ein; öffentliche gehen auch ohne Token.'
			}
		});
		const dialog = await openAdd(card);
		await vi.waitFor(() =>
			expect(
				dialog.getByText(/^Ohne Token nennt GitHub keine Liste deiner Repositorys/)
			).toBeTruthy()
		);
		expect(dialog.getByLabelText('Repository (Pflichtfeld)')).toBeTruthy();
		expect(dialog.queryByRole('button', { name: 'Liste neu laden' })).toBeNull();
		await fireEvent.click(dialog.getByRole('button', { name: 'Hinzufügen' }));
		expect(dialog.getByText(/^Bitte ein Repository als „Besitzer\/Name“/)).toBeTruthy();
	});

	it('names the restart when the server does not know the list yet', async () => {
		const { card, data } = await open();
		data.repos.mockImplementation(async () => {
			throw new DataError('not_found', { status: 404 });
		});
		const dialog = await openAdd(card);
		await vi.waitFor(() =>
			expect(
				dialog.getByText(/^Die Liste deiner Repositorys ist nach dem nächsten Neustart verfügbar/)
			).toBeTruthy()
		);
		expect(dialog.getByLabelText('Repository (Pflichtfeld)')).toBeTruthy();
	});

	it('switches "Alle meine Repositorys" on at once and runs once', async () => {
		const { card, connections, flags } = await open();
		await fireEvent.click(card.getByRole('button', { name: 'Details: GitHub' }));
		const toggle = (await vi.waitFor(() =>
			card.getByRole('switch', { name: 'Alle meine Repositorys beobachten' })
		)) as HTMLInputElement;
		expect(toggle.checked).toBe(false);
		expect(
			card.getByText(/^Alle Repositorys deines Kontos, die das Token lesen darf/)
		).toBeTruthy();
		await fireEvent.click(toggle);
		await vi.waitFor(() =>
			expect(connections.data.saveGitHub).toHaveBeenCalledWith(ID, {
				...EMPTY_GITHUB_SETTINGS,
				repos: [repo('octo-org/roadmap')],
				auto: true
			})
		);
		expect(flags.flags.map((flag) => flag.title)).toContain(
			'„GitHub“ beobachtet jetzt alle deine Repositorys.'
		);
		await vi.waitFor(() => expect(connections.data.run).toHaveBeenCalledWith(ID));
	});

	it('locks the switch without a token and says why', async () => {
		const { card, connections } = await open(githubConnection(), {
			status: { secret: false, allowlist: null },
			details: { ...DETAILS, authenticated: false }
		});
		await fireEvent.click(card.getByRole('button', { name: 'Details: GitHub' }));
		const toggle = await vi.waitFor(() =>
			card.getByRole('switch', { name: 'Alle meine Repositorys beobachten' })
		);
		expect(toggle.getAttribute('aria-disabled')).toBe('true');
		expect(card.getByText(/^Braucht ein Token: Ohne Token nennt GitHub keine Liste/)).toBeTruthy();
		await fireEvent.click(toggle);
		expect(connections.data.saveGitHub).not.toHaveBeenCalled();
	});

	it('shows the automatic repositories with "Anpassen …", "Ausschließen …" and the excluded ones', async () => {
		const automatic = {
			...DETAILS.repos[0]!,
			repo: 'anna/notes',
			key: 'anna/notes',
			auto: true,
			url: 'https://github.com/anna/notes',
			private: false,
			paths: [...GITHUB_DEFAULT_PATHS]
		};
		const item = githubConnection({
			github: {
				...EMPTY_GITHUB_SETTINGS,
				repos: [repo('octo-org/roadmap')],
				auto: true,
				exclude: ['anna/alt']
			}
		});
		const { card, connections } = await open(item, {
			details: {
				...DETAILS,
				repos: [...DETAILS.repos, automatic],
				auto: {
					...AUTO_OFF,
					enabled: true,
					login: 'anna',
					at: '2026-10-02T08:00:00.000Z',
					count: 1,
					added: ['anna/notes'],
					removed: [{ repo: 'anna/alt', reason: 'excluded' }],
					changedAt: '2026-10-02T08:00:00.000Z',
					excluded: ['anna/alt']
				}
			}
		});
		await vi.waitFor(() =>
			expect(card.getByText(/^2 Repositorys · Zuletzt abgerufen/)).toBeTruthy()
		);
		await fireEvent.click(card.getByRole('button', { name: 'Details: GitHub' }));
		expect(card.getByText('1 Repository von @anna, Liste vom 02.10.2026 10:00')).toBeTruthy();
		expect(
			card.getByText(
				'Zuletzt geändert 02.10.2026 10:00: neu anna/notes; nicht mehr anna/alt (ausgeschlossen)'
			)
		).toBeTruthy();
		const repos = within(card.getByRole('region', { name: 'Repositorys von „GitHub“' }));
		expect(repos.getAllByText('Automatisch')).toHaveLength(1);
		expect(repos.getByRole('button', { name: 'Einstellungen …: octo-org/roadmap' })).toBeTruthy();

		// "Anpassen …" makes it an entered repository with its own settings.
		await fireEvent.click(repos.getByRole('button', { name: 'Anpassen …: anna/notes' }));
		const adjust = within(screen.getByRole('dialog', { name: 'Repository anna/notes einstellen' }));
		await fireEvent.click(adjust.getByLabelText('Releases'));
		await fireEvent.click(adjust.getByRole('button', { name: 'Speichern' }));
		await vi.waitFor(() =>
			expect(connections.data.saveGitHub).toHaveBeenLastCalledWith(ID, {
				...EMPTY_GITHUB_SETTINGS,
				repos: [
					repo('octo-org/roadmap'),
					repo('anna/notes', { events: { files: true, pulls: true, releases: false } })
				],
				auto: true,
				exclude: ['anna/alt']
			})
		);
		await vi.waitFor(() =>
			expect(screen.queryByRole('dialog', { name: 'Repository anna/notes einstellen' })).toBeNull()
		);
	});

	it('excludes an automatic repository after a question and takes an excluded one back', async () => {
		const automatic = {
			...DETAILS.repos[0]!,
			repo: 'anna/notes',
			key: 'anna/notes',
			auto: true,
			url: 'https://github.com/anna/notes'
		};
		const item = githubConnection({
			github: { ...EMPTY_GITHUB_SETTINGS, auto: true, exclude: ['anna/alt'] }
		});
		const { card, connections } = await open(item, {
			details: { ...DETAILS, repos: [automatic], auto: { ...AUTO_OFF, enabled: true } }
		});
		await fireEvent.click(card.getByRole('button', { name: 'Details: GitHub' }));
		const repos = within(card.getByRole('region', { name: 'Repositorys von „GitHub“' }));
		await fireEvent.click(await repos.findByRole('button', { name: 'anna/notes ausschließen …' }));
		const question = within(
			screen.getByRole('dialog', { name: 'anna/notes nicht mehr automatisch beobachten?' })
		);
		expect(question.getByText(/Unter „Ausgeschlossen“ holst du es zurück/)).toBeTruthy();
		await fireEvent.click(question.getByRole('button', { name: 'Ausschließen' }));
		await vi.waitFor(() =>
			expect(connections.data.saveGitHub).toHaveBeenLastCalledWith(ID, {
				...EMPTY_GITHUB_SETTINGS,
				auto: true,
				exclude: ['anna/alt', 'anna/notes']
			})
		);
		await fireEvent.click(repos.getByRole('button', { name: 'Wieder aufnehmen: anna/alt' }));
		await vi.waitFor(() =>
			expect(connections.data.saveGitHub).toHaveBeenLastCalledWith(ID, {
				...EMPTY_GITHUB_SETTINGS,
				auto: true,
				exclude: ['anna/notes']
			})
		);
		// With the option on, "Jetzt abrufen" stays the main button without an entered repository.
		expect(card.getByRole('button', { name: 'Jetzt abrufen: GitHub' })).toBeTruthy();
	});
});
