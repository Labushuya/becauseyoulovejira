// Catalog of projects and tags (E3 plan, T-16 and package 4; ADR-0013 section 5). One store per
// app layout: it loads all visible projects (archived ones included) and tags once per session
// and follows them live. Rows, panel, filters and the history resolve names through it, so a
// renamed project shows everywhere without ticket events. Own answers and realtime events go
// through the same idempotent upsert and remove methods; after a reconnection the store
// reconciles once (ADR-0007 section 3). The store is dropped with the layout on logout.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import { listProjects } from '$lib/data/projects';
import { createTag, listTags } from '$lib/data/tags';
import { historyLookups, type HistoryLookups } from '$lib/domain/history-format';
import { compareTitles } from '$lib/domain/ordering';
import type { Project } from '$lib/domain/project';
import { resolveParents, subProjectsOf, treeOrder } from '$lib/domain/project-tree';
import {
	findTagByName,
	normalizeTagName,
	tagNameKey,
	tagNameProblem,
	type Tag
} from '$lib/domain/tag';
import type { ProjectRef, TagRef, TicketSummary } from '$lib/domain/ticket';
import { hold, type LiveSource } from './realtime';
import type { LoadState, SessionGuard } from './ticket-list.svelte';

/** Data access of the catalog; tests pass a fake, the app binds the data layer to its client. */
export interface CatalogData {
	listProjects(options: RequestOptions): Promise<Project[]>;
	listTags(options: RequestOptions): Promise<Tag[]>;
	createTag(name: string): Promise<Tag>;
}

/** Outcome of `ensureTag`; a failure carries a message unless nothing is to be shown. */
export type EnsureTagResult = { ok: true; tag: Tag } | { ok: false; message: string | null };

export function catalogData(pb: PocketBase): CatalogData {
	return {
		listProjects: (options) => listProjects(pb, options),
		listTags: (options) => listTags(pb, options),
		createTag: (name) => createTag(pb, name)
	};
}

/** By name in German order, then code and ID, so equal names keep a fixed order. */
function byProjectName(a: Project, b: Project): number {
	return compareTitles(a.name, b.name) || compareTitles(a.code, b.code) || (a.id < b.id ? -1 : 1);
}

function byTagName(a: Tag, b: Tag): number {
	return compareTitles(a.name, b.name) || (a.id < b.id ? -1 : 1);
}

/** One kind of catalog record: its map, the IDs deleted in this session and the touched IDs. */
class Records<T extends { id: string; updated: string }> {
	readonly map = new SvelteMap<string, T>();
	/** Deleted IDs: a late event must not bring them back. Record IDs are never reused. */
	readonly deleted = new SvelteSet<string>();
	/** IDs changed while a load runs: its older snapshot must not remove them. */
	touched: Set<string> | null = null;

	/** Inserts or replaces a record; an older `updated` than the stored one is ignored. */
	upsert(record: T): void {
		if (this.deleted.has(record.id)) return;
		this.touched?.add(record.id);
		const existing = this.map.get(record.id);
		if (existing !== undefined && existing.updated > record.updated) return;
		this.map.set(record.id, record);
	}

	remove(id: string): void {
		this.deleted.add(id);
		this.touched?.add(id);
		this.map.delete(id);
	}

	/** Merges a loaded snapshot: new ones in, changed ones replaced, missing ones out. */
	merge(records: readonly T[], touched: ReadonlySet<string>): void {
		const ids = new SvelteSet(records.map((record) => record.id));
		for (const id of [...this.map.keys()]) {
			if (!ids.has(id) && !touched.has(id)) this.map.delete(id);
		}
		for (const record of records) {
			if (!touched.has(record.id)) this.upsert(record);
		}
	}

	clear(): void {
		this.map.clear();
		this.deleted.clear();
		this.touched = null;
	}
}

export class CatalogStore {
	readonly #data: CatalogData;
	readonly #session: SessionGuard;

	readonly #projects = new Records<Project>();
	readonly #tags = new Records<Tag>();
	#controller: AbortController | null = null;
	/** Running creations by name key, so a double Enter creates one tag (T-14). */
	readonly #creating = new SvelteMap<string, Promise<EnsureTagResult>>();

	#state = $state<LoadState>('idle');
	#error = $state<string | null>(null);

	/** By name, sub projects with their parent resolved (ADR-0034). */
	#projectList = $derived(resolveParents([...this.#projects.map.values()].sort(byProjectName)));
	#projectsById: Readonly<Record<string, Project>> = $derived(
		Object.fromEntries(this.#projectList.map((project) => [project.id, project]))
	);
	/** Active projects in tree order: each top-level project followed by its sub projects. */
	#activeProjects = $derived(treeOrder(this.#projectList.filter((project) => !project.archived)));
	/** The server knows `projects.parent` (ADR-0034 section 5); true while no project says no. */
	#hierarchyReady = $derived(!this.#projectList.some((project) => project.withoutParentField));
	#tagList = $derived([...this.#tags.map.values()].sort(byTagName));
	#lookups = $derived(historyLookups(this.#projectList, this.#tagList));

	constructor(data: CatalogData, session: SessionGuard) {
		this.#data = data;
		this.#session = session;
	}

	/**
	 * All visible projects, archived ones included, by name; a sub project carries its parent
	 * (`parent`, ADR-0034).
	 */
	get projects(): readonly Project[] {
		return this.#projectList;
	}

	/**
	 * Projects that can be chosen for a ticket (T-11), in tree order: by name, each top-level
	 * project followed by its sub projects (ADR-0034).
	 */
	get activeProjects(): readonly Project[] {
		return this.#activeProjects;
	}

	/**
	 * Whether sub projects are available: false while the server has not run the migration of
	 * ADR-0034 yet (the panel then shows the restart hint instead of the field "Oberprojekt").
	 */
	get hierarchyReady(): boolean {
		return this.#hierarchyReady;
	}

	/** Sub projects of a project by name, archived ones included (ADR-0034). */
	subProjectsOf(id: string): readonly Project[] {
		return subProjectsOf(this.#projectList, id);
	}

	/** All visible tags, by name. */
	get tags(): readonly Tag[] {
		return this.#tagList;
	}

	/** Projects and tags by ID for the history (E2 plan, T-10); unknown IDs are deleted ones. */
	get lookups(): HistoryLookups {
		return this.#lookups;
	}

	get state(): LoadState {
		return this.#state;
	}

	get error(): string | null {
		return this.#error;
	}

	/** Project of the catalog; a sub project carries its parent (`parent`, ADR-0034). */
	projectById(id: string): Project | null {
		return Object.hasOwn(this.#projectsById, id) ? (this.#projectsById[id] ?? null) : null;
	}

	tagById(id: string): Tag | null {
		return this.#tags.map.get(id) ?? null;
	}

	/**
	 * Project of a ticket as rows and panel show it (T-16): from the catalog, so a rename shows
	 * without a ticket event; the expanded project only while the catalog does not know the ID.
	 */
	projectOf(ticket: Pick<TicketSummary, 'projectId' | 'project'>): ProjectRef | null {
		if (ticket.projectId === null) return null;
		const expanded = ticket.project?.id === ticket.projectId ? ticket.project : null;
		return this.projectById(ticket.projectId) ?? expanded;
	}

	/** Tags of a ticket in stored order, resolved like `projectOf`; unknown IDs are left out. */
	tagsOf(ticket: Pick<TicketSummary, 'tagIds' | 'tags'>): TagRef[] {
		return ticket.tagIds.flatMap((id) => {
			const tag = this.tagById(id) ?? ticket.tags.find((expanded) => expanded.id === id);
			return tag === undefined ? [] : [tag];
		});
	}

	/** Loads the catalog once per session; a failed load is loaded again. */
	async load(): Promise<void> {
		if (this.#state === 'idle' || this.#state === 'error') await this.#load(false);
	}

	/** Loads the catalog again ("Erneut versuchen"). */
	async reload(): Promise<void> {
		await this.#load(false);
	}

	/**
	 * Loads the catalog for the app layout and returns the cleanup, which empties it (logout,
	 * session end).
	 */
	start(): () => void {
		void this.load();
		return () => this.reset();
	}

	upsertProject(project: Project): void {
		this.#projects.upsert(project);
	}

	removeProject(id: string): void {
		this.#projects.remove(id);
	}

	/**
	 * Tag for a name typed in the tag picker (T-14): an existing one in any spelling, else a new
	 * one. Concurrent calls for the same name share one request. If the server still reports the
	 * name as taken (a tag from another tab that has not arrived yet), the catalog loads again and
	 * the existing tag is used.
	 */
	ensureTag(name: string): Promise<EnsureTagResult> {
		const problem = tagNameProblem(name);
		if (problem !== null) return Promise.resolve({ ok: false, message: problem });
		const existing = findTagByName(this.tags, name);
		if (existing !== null) return Promise.resolve({ ok: true, tag: existing });
		const key = tagNameKey(name);
		const running = this.#creating.get(key);
		if (running !== undefined) return running;
		const created = this.#createTag(normalizeTagName(name)).finally(() => {
			this.#creating.delete(key);
		});
		this.#creating.set(key, created);
		return created;
	}

	upsertTag(tag: Tag): void {
		this.#tags.upsert(tag);
	}

	removeTag(id: string): void {
		this.#tags.remove(id);
	}

	/**
	 * Keeps the catalog live (ADR-0007 sections 2 and 3): changes go through upsert and remove,
	 * and after a reconnection or a subscription that came only after failed attempts the store
	 * reconciles once. Returns the cleanup, which ends every subscription and a running
	 * reconciliation.
	 */
	connect(live: LiveSource): () => void {
		const reconcile = () => void this.reconcile();
		const stops = [
			hold(
				(guard) =>
					live.projects(
						guard((change) => {
							if (change.action === 'delete') this.removeProject(change.id);
							else this.upsertProject(change.record);
						})
					),
				{ recovered: reconcile }
			),
			hold(
				(guard) =>
					live.tags(
						guard((change) => {
							if (change.action === 'delete') this.removeTag(change.id);
							else this.upsertTag(change.record);
						})
					),
				{ recovered: reconcile }
			),
			hold((guard) => live.reconnected(guard(reconcile)), { recovered: reconcile })
		];
		return () => {
			for (const stop of stops) stop();
			if (this.#state === 'ready') this.#abort();
		};
	}

	/**
	 * Reconciles after events may have been lost (ADR-0007 section 3): loads both lists again
	 * and merges them without a loading state. A second call aborts a running one; a catalog
	 * that failed to load is simply loaded again.
	 */
	async reconcile(): Promise<void> {
		if (this.#state === 'error') {
			await this.reload();
			return;
		}
		if (this.#state === 'ready') await this.#load(true);
	}

	/** Aborts a running request and empties the store. */
	reset(): void {
		this.#abort();
		this.#projects.clear();
		this.#tags.clear();
		this.#creating.clear();
		this.#state = 'idle';
		this.#error = null;
	}

	async #createTag(name: string): Promise<EnsureTagResult> {
		if (!this.#session.ensureValid()) return { ok: false, message: null };
		try {
			const tag = await this.#data.createTag(name);
			this.upsertTag(tag);
			return { ok: true, tag };
		} catch (error) {
			const failure = toDataError(error);
			if (failure.fields.name?.code === 'validation_not_unique') {
				await this.#load(true);
				const existing = findTagByName(this.tags, name);
				if (existing !== null) return { ok: true, tag: existing };
			}
			const fieldMessage = failure.fields.name?.message;
			return { ok: false, message: fieldMessage ?? this.#failureMessage(error) };
		}
	}

	#abort(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#projects.touched = null;
		this.#tags.touched = null;
	}

	/**
	 * Loads projects and tags together and merges them into the maps. Records changed by events
	 * meanwhile keep their newer state. `quiet` (reconciliation) keeps state and error as they are.
	 */
	async #load(quiet: boolean): Promise<void> {
		this.#abort();
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		const touchedProjects = new SvelteSet<string>();
		const touchedTags = new SvelteSet<string>();
		this.#projects.touched = touchedProjects;
		this.#tags.touched = touchedTags;
		if (!quiet) {
			this.#state = 'loading';
			this.#error = null;
		}
		const options = { signal: controller.signal };
		try {
			const [projects, tags] = await Promise.all([
				this.#data.listProjects(options),
				this.#data.listTags(options)
			]);
			if (controller.signal.aborted) return;
			this.#projects.touched = null;
			this.#tags.touched = null;
			this.#projects.merge(projects, touchedProjects);
			this.#tags.merge(tags, touchedTags);
			this.#state = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			const message = this.#failureMessage(error);
			if (message === null || quiet) return;
			this.#error = message;
			this.#state = 'error';
		} finally {
			if (this.#controller === controller) {
				this.#controller = null;
				this.#projects.touched = null;
				this.#tags.touched = null;
			}
		}
	}

	/**
	 * German message of a failed request, or null if nothing is to be shown: an aborted request
	 * is no error, and an ended session leads to the login (ADR-0006 section 4).
	 */
	#failureMessage(error: unknown): string | null {
		const failure = toDataError(error);
		if (failure.kind === 'aborted') return null;
		if (failure.kind === 'session') {
			this.#session.logout();
			return null;
		}
		return failure.message;
	}
}

const [getCatalogStore, setCatalogStore] = createContext<CatalogStore>();

/** Catalog of projects and tags, set by the app layout. */
export { getCatalogStore, setCatalogStore };
