// Catalog of projects and tags with fake data and a fake realtime source (E3 plan, T-16 and
// package 4): loading once per session, targeted updates, older events ignored, reconciliation
// after a reconnection, cleanup of the subscriptions and reset on logout.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import type { Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import { CatalogStore, type CatalogData } from './catalog.svelte';
import type { LiveSource, RecordChange, Unsubscribe } from './realtime';

const T0 = '2026-09-24 08:00:00.000Z';
const T1 = '2026-09-24 09:00:00.000Z';
const T2 = '2026-09-24 10:00:00.000Z';

function project(overrides: Partial<Project> = {}): Project {
	return {
		id: 'proj00000000001',
		name: 'Haus',
		code: 'HAUS',
		archived: false,
		updated: T0,
		...overrides
	};
}

function tag(overrides: Partial<Tag> = {}): Tag {
	return { id: 'tag000000000001', name: 'Garten', updated: T0, ...overrides };
}

const HOUSE = project();
const CAR = project({ id: 'proj00000000002', name: 'Auto', code: 'AUTO' });
const OLD = project({ id: 'proj00000000003', name: 'Büro', code: 'BUERO', archived: true });
const GARDEN = tag();
const CALL = tag({ id: 'tag000000000002', name: 'anrufen' });

type Listener =
	| { kind: 'projects'; call: (change: RecordChange<Project>) => void }
	| { kind: 'tags'; call: (change: RecordChange<Tag>) => void }
	| { kind: 'reconnected'; call: () => void };

/** Realtime source for the catalog: records subscriptions and delivers events on demand. */
class FakeLive {
	readonly listeners: Listener[] = [];
	readonly source: LiveSource = {
		tickets: () => this.#never(),
		ticket: () => this.#never(),
		comments: () => this.#never(),
		history: () => this.#never(),
		projects: (call) => this.#add({ kind: 'projects', call }),
		tags: (call) => this.#add({ kind: 'tags', call }),
		reconnected: (call) => this.#add({ kind: 'reconnected', call })
	};

	get active(): string[] {
		return this.listeners.map((listener) => listener.kind).sort();
	}

	project(change: RecordChange<Project>): void {
		for (const listener of [...this.listeners]) {
			if (listener.kind === 'projects') listener.call(change);
		}
	}

	tag(change: RecordChange<Tag>): void {
		for (const listener of [...this.listeners]) {
			if (listener.kind === 'tags') listener.call(change);
		}
	}

	reconnect(): void {
		for (const listener of [...this.listeners]) {
			if (listener.kind === 'reconnected') listener.call();
		}
	}

	#add(listener: Listener): Promise<Unsubscribe> {
		this.listeners.push(listener);
		return Promise.resolve(async () => {
			const index = this.listeners.indexOf(listener);
			if (index !== -1) this.listeners.splice(index, 1);
		});
	}

	#never(): Promise<Unsubscribe> {
		throw new Error('The catalog must not subscribe to tickets, comments or history.');
	}
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function abortable<T>(options: RequestOptions, value: Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		options.signal?.addEventListener('abort', () => reject(new DataError('aborted')));
		value.then(resolve, reject);
	});
}

function setup(projects: Project[] = [HOUSE, CAR, OLD], tags: Tag[] = [GARDEN, CALL]) {
	const data = {
		listProjects: vi.fn<CatalogData['listProjects']>(async () => projects),
		listTags: vi.fn<CatalogData['listTags']>(async () => tags),
		createTag: vi.fn<CatalogData['createTag']>(async (name) => ({
			id: 'tag000000000099',
			name,
			updated: T2
		}))
	} satisfies CatalogData;
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const store = new CatalogStore(data, session);
	return { store, data, session };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const ids = (records: readonly { id: string }[]) => records.map((record) => record.id);
const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('CatalogStore: loading', () => {
	it('loads projects and tags once per session, sorted by name', async () => {
		const { store, data } = setup();
		expect(store.state).toBe('idle');

		await store.load();
		await store.load();

		expect(store.state).toBe('ready');
		expect(data.listProjects).toHaveBeenCalledTimes(1);
		expect(data.listTags).toHaveBeenCalledTimes(1);
		expect(ids(store.projects)).toEqual([CAR.id, OLD.id, HOUSE.id]);
		expect(ids(store.activeProjects)).toEqual([CAR.id, HOUSE.id]);
		expect(ids(store.tags)).toEqual([CALL.id, GARDEN.id]);
		expect(store.projectById(OLD.id)).toEqual(OLD);
		expect(store.tagById(GARDEN.id)).toEqual(GARDEN);
		expect(store.projectById('unknown00000000')).toBeNull();
		expect(store.lookups.projects.get(OLD.id)).toEqual(OLD);
		expect(store.lookups.tags.get(CALL.id)).toEqual(CALL);
	});

	it('shows a failure and loads again after it', async () => {
		const { store, data } = setup();
		data.listTags.mockRejectedValueOnce(new DataError('network'));

		await store.load();
		expect(store.state).toBe('error');
		expect(store.error).toMatch(/Server nicht erreichbar/);
		expect(store.projects).toEqual([]);

		await store.load();
		expect(store.state).toBe('ready');
		expect(store.error).toBeNull();
		expect(store.tags).toHaveLength(2);
	});

	it('ends the session on 401 without an error and loads nothing without a session', async () => {
		const { store, data, session } = setup();
		data.listProjects.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		await store.load();
		expect(session.logout).toHaveBeenCalledOnce();
		expect(store.error).toBeNull();

		const other = setup();
		other.session.ensureValid.mockReturnValue(false);
		await other.store.load();
		expect(other.data.listProjects).not.toHaveBeenCalled();
	});

	it('starts with the layout and empties itself in the cleanup (logout)', async () => {
		const { store, data } = setup();
		const stop = store.start();
		await vi.waitFor(() => expect(store.state).toBe('ready'));

		stop();

		expect(store.state).toBe('idle');
		expect(store.projects).toEqual([]);
		expect(store.tags).toEqual([]);
		expect(store.lookups.projects.size).toBe(0);
		await store.load();
		expect(data.listProjects).toHaveBeenCalledTimes(2);
	});

	it('aborts a running load on reset', async () => {
		const { store, data } = setup();
		const answer = deferred<Project[]>();
		let signal: AbortSignal | undefined;
		data.listProjects.mockImplementationOnce((options) => {
			signal = options.signal;
			return abortable(options, answer.promise);
		});
		const loading = store.load();

		store.reset();
		answer.resolve([HOUSE]);
		await loading;

		expect(signal?.aborted).toBe(true);
		expect(store.state).toBe('idle');
		expect(store.projects).toEqual([]);
	});
});

describe('CatalogStore: updates', () => {
	it('inserts, replaces and removes single records', async () => {
		const { store } = setup();
		await store.load();

		store.upsertProject(project({ id: 'proj00000000009', name: 'Anbau', code: 'ANB' }));
		store.upsertProject({ ...HOUSE, name: 'Wohnung', updated: T1 });
		store.upsertProject({ ...CAR, archived: true, updated: T1 });
		store.removeProject(OLD.id);
		store.upsertTag({ ...GARDEN, name: 'Balkon', updated: T1 });
		store.removeTag(CALL.id);

		expect(store.projects.map((p) => p.name)).toEqual(['Anbau', 'Auto', 'Wohnung']);
		expect(store.activeProjects.map((p) => p.name)).toEqual(['Anbau', 'Wohnung']);
		expect(store.tags.map((t) => t.name)).toEqual(['Balkon']);
		expect(store.lookups.projects.has(OLD.id)).toBe(false);
	});

	it('ignores an older updated and keeps deleted records out', async () => {
		const { store } = setup();
		await store.load();

		store.upsertProject({ ...HOUSE, name: 'Neu', updated: T2 });
		store.upsertProject({ ...HOUSE, name: 'Veraltet', updated: T1 });
		store.upsertTag({ ...GARDEN, name: 'Neu', updated: T2 });
		store.upsertTag({ ...GARDEN, name: 'Veraltet', updated: T1 });
		store.removeProject(CAR.id);
		store.upsertProject({ ...CAR, updated: T2 });

		expect(store.projectById(HOUSE.id)?.name).toBe('Neu');
		expect(store.tagById(GARDEN.id)?.name).toBe('Neu');
		expect(store.projectById(CAR.id)).toBeNull();
	});

	it('keeps records that events changed while the first load ran', async () => {
		const { store, data } = setup();
		const answer = deferred<Project[]>();
		data.listProjects.mockImplementationOnce(() => answer.promise);
		const loading = store.load();

		store.upsertProject({ ...HOUSE, name: 'Während des Ladens', updated: T1 });
		const created = project({ id: 'proj00000000009', name: 'Neu', code: 'NEU', updated: T1 });
		store.upsertProject(created);
		store.removeProject(OLD.id);
		answer.resolve([HOUSE, CAR, OLD]);
		await loading;

		expect(store.projectById(HOUSE.id)?.name).toBe('Während des Ladens');
		expect(store.projectById(created.id)).toEqual(created);
		expect(store.projectById(OLD.id)).toBeNull();
		expect(store.projectById(CAR.id)).toEqual(CAR);
	});
});

describe('CatalogStore: project and tags of a ticket (E3 plan, package 5)', () => {
	const expanded = {
		projectId: HOUSE.id,
		project: { id: HOUSE.id, name: 'Expand', code: 'EXP', archived: false },
		tagIds: [CALL.id, GARDEN.id],
		tags: [
			{ id: GARDEN.id, name: 'garten (expand)' },
			{ id: CALL.id, name: 'anrufen (expand)' }
		]
	};

	it('resolves through the catalog, in stored tag order, and follows a rename', async () => {
		const { store } = setup();
		await store.load();

		expect(store.projectOf(expanded)?.name).toBe('Haus');
		expect(store.tagsOf(expanded).map((t) => t.name)).toEqual(['anrufen', 'Garten']);

		store.upsertProject({ ...HOUSE, name: 'Wohnung', updated: T1 });
		expect(store.projectOf(expanded)?.name).toBe('Wohnung');
	});

	it('falls back to the expanded records while the catalog does not know them', () => {
		const { store } = setup();

		expect(store.projectOf(expanded)?.name).toBe('Expand');
		expect(store.tagsOf(expanded).map((t) => t.name)).toEqual([
			'anrufen (expand)',
			'garten (expand)'
		]);
	});

	it('has no project without a project ID and leaves out unknown tags', async () => {
		const { store } = setup();
		await store.load();

		expect(store.projectOf({ projectId: null, project: expanded.project })).toBeNull();
		expect(store.projectOf({ projectId: 'proj00000000099', project: expanded.project })).toBeNull();
		expect(store.tagsOf({ tagIds: ['tag000000000099', GARDEN.id], tags: [] })).toEqual([GARDEN]);
	});
});

describe('CatalogStore: tag for a typed name (E3 plan, T-14 and package 8)', () => {
	it('reuses a tag in another spelling without a request', async () => {
		const { store, data } = setup();
		await store.load();

		expect(await store.ensureTag('  GARTEN ')).toEqual({ ok: true, tag: GARDEN });
		expect(data.createTag).not.toHaveBeenCalled();
	});

	it('creates a new tag with the trimmed name and adds it to the catalog', async () => {
		const { store, data } = setup();
		await store.load();

		const result = await store.ensureTag('  Steuer ');

		expect(data.createTag).toHaveBeenCalledExactlyOnceWith('Steuer');
		expect(result).toMatchObject({ ok: true, tag: { name: 'Steuer' } });
		expect(store.tags.map((t) => t.name)).toContain('Steuer');
	});

	it('shares one request between quick calls for the same name', async () => {
		const { store, data } = setup();
		await store.load();
		const answer = deferred<Tag>();
		data.createTag.mockImplementationOnce(() => answer.promise);

		const first = store.ensureTag('Steuer');
		const second = store.ensureTag('steuer ');
		answer.resolve(tag({ id: 'tag000000000009', name: 'Steuer', updated: T1 }));

		expect(await first).toEqual(await second);
		expect(data.createTag).toHaveBeenCalledOnce();
	});

	it('loads again and takes the existing tag when the server reports the name as taken', async () => {
		const { store, data } = setup();
		await store.load();
		const other = tag({ id: 'tag000000000009', name: 'steuer', updated: T1 });
		data.createTag.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: { name: { code: 'validation_not_unique', message: 'Schon vergeben.' } }
			})
		);
		data.listTags.mockResolvedValueOnce([GARDEN, CALL, other]);

		expect(await store.ensureTag('Steuer')).toEqual({ ok: true, tag: other });
		expect(data.listTags).toHaveBeenCalledTimes(2);
	});

	it('refuses an empty or too long name without a request', async () => {
		const { store, data } = setup();
		await store.load();

		expect(await store.ensureTag('   ')).toEqual({
			ok: false,
			message: 'Der Name darf nicht leer sein.'
		});
		expect(await store.ensureTag('x'.repeat(51))).toEqual({
			ok: false,
			message: 'Höchstens 50 Zeichen.'
		});
		expect(data.createTag).not.toHaveBeenCalled();
	});

	it('reports a failed request with its message', async () => {
		const { store, data } = setup();
		await store.load();
		data.createTag.mockRejectedValueOnce(new DataError('network'));

		const result = await store.ensureTag('Steuer');

		expect(result).toEqual({
			ok: false,
			message: expect.stringMatching(/Server nicht erreichbar/)
		});
		expect(store.tags.map((t) => t.name)).not.toContain('Steuer');
	});
});

describe('CatalogStore: realtime', () => {
	it('follows create, rename, archive and delete events of projects and tags', async () => {
		const { store } = setup();
		const live = new FakeLive();
		cleanups.push(store.connect(live.source));
		await store.load();
		await flush();
		expect(live.active).toEqual(['projects', 'reconnected', 'tags']);

		const added = project({ id: 'proj00000000009', name: 'Keller', code: 'KEL', updated: T1 });
		live.project({ action: 'create', record: added });
		live.project({ action: 'update', record: { ...HOUSE, name: 'Wohnung', updated: T1 } });
		live.project({ action: 'update', record: { ...CAR, archived: true, updated: T1 } });
		live.project({ action: 'delete', id: OLD.id });
		live.tag({
			action: 'create',
			record: tag({ id: 'tag000000000009', name: 'Amt', updated: T1 })
		});
		live.tag({ action: 'update', record: { ...GARDEN, name: 'Balkon', updated: T1 } });
		live.tag({ action: 'delete', id: CALL.id });

		expect(store.projects.map((p) => p.name)).toEqual(['Auto', 'Keller', 'Wohnung']);
		expect(ids(store.activeProjects)).toEqual([added.id, HOUSE.id]);
		expect(store.tags.map((t) => t.name)).toEqual(['Amt', 'Balkon']);
	});

	it('ignores a late older event', async () => {
		const { store } = setup();
		const live = new FakeLive();
		cleanups.push(store.connect(live.source));
		await store.load();
		await flush();

		store.upsertProject({ ...HOUSE, name: 'Antwort', updated: T2 });
		live.project({ action: 'update', record: { ...HOUSE, name: 'Event', updated: T1 } });

		expect(store.projectById(HOUSE.id)?.name).toBe('Antwort');
	});

	it('reconciles after a reconnection without a loading state', async () => {
		const { store, data } = setup();
		const live = new FakeLive();
		cleanups.push(store.connect(live.source));
		await store.load();
		await flush();

		const renamed = { ...HOUSE, name: 'Wohnung', updated: T1 };
		const created = project({ id: 'proj00000000009', name: 'Keller', code: 'KEL', updated: T1 });
		const answer = deferred<Project[]>();
		data.listProjects.mockImplementationOnce(() => answer.promise);
		data.listTags.mockResolvedValueOnce([GARDEN]);
		live.reconnect();
		expect(store.state).toBe('ready');
		answer.resolve([renamed, CAR, created]);
		await vi.waitFor(() => expect(store.projectById(created.id)).toEqual(created));

		expect(store.projectById(HOUSE.id)?.name).toBe('Wohnung');
		expect(store.projectById(OLD.id)).toBeNull();
		expect(ids(store.tags)).toEqual([GARDEN.id]);
		expect(store.state).toBe('ready');
	});

	it('aborts a running reconciliation on a second reconnection', async () => {
		const { store, data } = setup();
		const live = new FakeLive();
		cleanups.push(store.connect(live.source));
		await store.load();
		await flush();

		let firstSignal: AbortSignal | undefined;
		const stale = deferred<Project[]>();
		data.listProjects.mockImplementationOnce((options) => {
			firstSignal = options.signal;
			return abortable(options, stale.promise);
		});
		live.reconnect();
		data.listProjects.mockResolvedValueOnce([HOUSE]);
		live.reconnect();
		await vi.waitFor(() => expect(ids(store.projects)).toEqual([HOUSE.id]));
		stale.resolve([HOUSE, CAR, OLD]);
		await flush();

		expect(firstSignal?.aborted).toBe(true);
		expect(ids(store.projects)).toEqual([HOUSE.id]);
	});

	it('keeps the catalog and its state when a reconciliation fails', async () => {
		const { store, data } = setup();
		const live = new FakeLive();
		cleanups.push(store.connect(live.source));
		await store.load();
		await flush();

		data.listProjects.mockRejectedValueOnce(new DataError('network'));
		live.reconnect();
		await flush();

		expect(store.state).toBe('ready');
		expect(store.error).toBeNull();
		expect(store.projects).toHaveLength(3);
	});

	it('loads a failed catalog again after a reconnection', async () => {
		const { store, data } = setup();
		const live = new FakeLive();
		cleanups.push(store.connect(live.source));
		data.listProjects.mockRejectedValueOnce(new DataError('network'));
		await store.load();
		expect(store.state).toBe('error');

		live.reconnect();
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		expect(store.projects).toHaveLength(3);
	});

	it('ends every subscription in the cleanup, also before they are set up', async () => {
		const { store } = setup();
		const live = new FakeLive();
		const disconnect = store.connect(live.source);
		disconnect();
		await flush();
		expect(live.active).toEqual([]);

		const again = store.connect(live.source);
		await flush();
		expect(live.active).toHaveLength(3);
		again();
		await flush();
		expect(live.active).toEqual([]);
	});
});
