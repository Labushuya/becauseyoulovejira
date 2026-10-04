// Trash for tickets (ADR-0037, plan PB-2): the only way of the SPA to tickets in the trash. The
// API rules hide them everywhere else (migration 1790202300); these routes check the visibility
// without the trash condition. Answers are read strictly: anything outside the expected shape is
// dropped (a list entry) or counts as a server error.

import type PocketBase from 'pocketbase';
import { clientArea } from './area';
import { DataError, withDataErrors } from './errors';
import type { RequestOptions } from './options';
import type { Unsubscribe } from './realtime';
import { PRIORITIES, STATUSES, type Priority, type Status } from '../domain/status';
import { optionsOf, type ResolveAction, type TrashDependency } from '../domain/trash-dependencies';
import {
	parseRetention,
	type EmptyResult,
	type RestoreOptions,
	type RestoreResult,
	type SkipReason,
	type TrashItem,
	type TrashPreview,
	type TrashProject,
	type TrashRetention
} from '../domain/trash';

const TRASH_ROUTE = '/api/byl/trash';

/** Realtime topic of the server: the trash of the signed-in account changed (no data). */
export const TRASH_TOPIC = 'byl/trash';

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function strings(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const list: string[] = [];
	for (const entry of value) {
		if (typeof entry !== 'string') return null;
		list.push(entry);
	}
	return list;
}

function invalid(): DataError {
	return new DataError('server');
}

function toProject(value: unknown): TrashProject | null | undefined {
	if (value === null) return null;
	if (!isRecord(value)) return undefined;
	const id = text(value.id);
	const code = text(value.code);
	const name = text(value.name);
	if (id === null || code === null || name === null || typeof value.exists !== 'boolean') {
		return undefined;
	}
	return { id, code, name, exists: value.exists };
}

/** One entry of the list, or null when it does not have the expected shape. */
export function toTrashItem(value: unknown): TrashItem | null {
	if (!isRecord(value)) return null;
	const project = toProject(value.project);
	const fields = ['id', 'key', 'title', 'due', 'deleted_at', 'deleted_by', 'updated'].map((name) =>
		text(value[name])
	);
	const [id, key, title, due, deletedAt, deletedBy, updated] = fields;
	const status = STATUSES.find((entry) => entry === value.status);
	const priority = PRIORITIES.find((entry) => entry === value.priority);
	const days = value.days_left;
	if (
		project === undefined ||
		fields.some((field) => field === null) ||
		status === undefined ||
		priority === undefined ||
		typeof value.recurring !== 'boolean' ||
		typeof value.children !== 'number' ||
		!(days === null || typeof days === 'number')
	) {
		return null;
	}
	return {
		id: id as string,
		key: key as string,
		title: title as string,
		status: status as Status,
		priority: priority as Priority,
		due: due as string,
		project,
		recurring: value.recurring,
		children: value.children,
		// Missing before the restart that brings the rule (ADR-0047): nothing blocks then.
		dependencies: typeof value.dependencies === 'number' ? value.dependencies : 0,
		deletedAt: deletedAt as string,
		deletedBy: deletedBy as string,
		updated: updated as string,
		daysLeft: days,
		// The area of the ticket (E7-3); a server before the restart does not name it.
		...(typeof value.scope === 'string' && value.scope !== '' && { scope: value.scope })
	};
}

/**
 * One dependency of the decision help, or null when it does not have the expected shape. The
 * options come from the rule of the SPA (the same as the hook, parity test).
 */
export function toDependency(value: unknown): TrashDependency | null {
	if (!isRecord(value)) return null;
	const ticket = text(value.ticket);
	const key = text(value.key);
	const title = text(value.title);
	if (ticket === null || key === null || title === null) return null;
	if (value.kind === 'ticket') {
		const status = STATUSES.find((entry) => entry === value.status);
		const openBlocking = typeof value.open_blocking === 'number' ? value.open_blocking : 0;
		if (status === undefined || typeof value.subtask !== 'boolean') return null;
		const base = { kind: 'ticket' as const, subtask: value.subtask, openBlocking };
		return { ...base, ticket, key, title, status, options: optionsOf(base) };
	}
	const item = text(value.item);
	const channel = text(value.channel);
	const scope = text(value.scope);
	if (
		value.kind !== 'source' ||
		item === null ||
		channel === null ||
		scope === null ||
		typeof value.primary !== 'boolean'
	) {
		return null;
	}
	const base = { kind: 'source' as const, primary: value.primary };
	return { ...base, item, ticket, key, title, channel, scope, options: optionsOf(base) };
}

function toPreview(value: unknown): TrashPreview {
	const item = toTrashItem(value);
	if (item === null || !isRecord(value)) throw invalid();
	const description = text(value.description);
	const group = text(value.group);
	const sources = isRecord(value.sources) ? value.sources : null;
	if (description === null || group === null || sources === null) throw invalid();
	const tags = Array.isArray(value.tags) ? value.tags : null;
	const subtasks = Array.isArray(value.subtasks) ? value.subtasks : null;
	if (tags === null || subtasks === null || typeof sources.count !== 'number') throw invalid();
	return {
		...item,
		description,
		group,
		tags: tags.filter(isRecord).map((tag) => ({ id: String(tag.id), name: String(tag.name) })),
		subtasks: subtasks.filter(isRecord).flatMap((child) => {
			const status = STATUSES.find((entry) => entry === child.status);
			return status === undefined
				? []
				: [{ id: String(child.id), key: String(child.key), title: String(child.title), status }];
		}),
		sources: {
			handling: sources.handling === 'discard' ? 'discard' : 'inbox',
			count: sources.count
		},
		dependencyList: Array.isArray(value.dependency_list)
			? value.dependency_list
					.map(toDependency)
					.filter((entry): entry is TrashDependency => entry !== null)
			: []
	};
}

const SKIP_REASONS: readonly SkipReason[] = ['converted', 'discarded', 'missing'];

function toRestoreResult(value: unknown): RestoreResult {
	if (!isRecord(value)) throw invalid();
	const id = text(value.id);
	const key = text(value.key);
	const updated = text(value.updated);
	const ruleMissing = strings(value.rule_missing);
	const seriesDetached = strings(value.series_detached);
	if (
		id === null ||
		key === null ||
		updated === null ||
		ruleMissing === null ||
		seriesDetached === null ||
		typeof value.parent_detached !== 'boolean' ||
		!Array.isArray(value.tickets) ||
		!Array.isArray(value.new_keys) ||
		!Array.isArray(value.sources_skipped)
	) {
		throw invalid();
	}
	return {
		id,
		key,
		updated,
		tickets: value.tickets
			.filter(isRecord)
			.map((entry) => ({ id: String(entry.id), key: String(entry.key) })),
		newKeys: value.new_keys.filter(isRecord).map((entry) => ({
			id: String(entry.id),
			key: String(entry.key),
			previous: String(entry.previous)
		})),
		parentDetached: value.parent_detached,
		ruleMissing,
		seriesDetached,
		sourcesSkipped: value.sources_skipped.filter(isRecord).map((entry) => ({
			id: String(entry.id),
			title: String(entry.title),
			key: String(entry.key),
			reason: SKIP_REASONS.find((reason) => reason === entry.reason) ?? 'missing'
		}))
	};
}

/**
 * The trash of the signed-in account: its tickets (first of each group) and the retention; with the
 * area of the client (E7-3) only that area with its retention (of the household, else the own).
 * `ownRetention` is the setting of the account for its private trash in every area.
 */
export function listTrash(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<{ items: TrashItem[]; retention: TrashRetention; ownRetention: TrashRetention }> {
	return withDataErrors(signal, async () => {
		const scope = clientArea(pb);
		const answer: unknown = await pb.send(TRASH_ROUTE, {
			method: 'GET',
			...(scope !== null && { query: { scope } }),
			signal
		});
		if (!isRecord(answer) || !Array.isArray(answer.items)) throw invalid();
		const items = answer.items.map(toTrashItem).filter((item): item is TrashItem => item !== null);
		const retention = parseRetention(answer.retention);
		return {
			items,
			retention,
			// A server before E7-3 names only the own retention.
			ownRetention: 'own_retention' in answer ? parseRetention(answer.own_retention) : retention
		};
	});
}

/** Read-only preview of a ticket in the trash (also a sub-task of a group). */
export function getTrashPreview(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<TrashPreview> {
	return withDataErrors(signal, async () => {
		const answer: unknown = await pb.send(`${TRASH_ROUTE}/${encodeURIComponent(id)}`, {
			method: 'GET',
			signal
		});
		return toPreview(answer);
	});
}

/** "Wiederherstellen" (and "Rückgängig" with expectedUpdated) of a ticket with its group. */
export function restoreFromTrash(
	pb: PocketBase,
	id: string,
	{
		signal,
		expectedUpdated,
		project,
		detachSeries,
		detachParent
	}: RequestOptions & RestoreOptions = {}
): Promise<RestoreResult> {
	return withDataErrors(signal, async () => {
		const body: Json = {};
		if (expectedUpdated !== undefined) body.expected_updated = expectedUpdated;
		if (project !== undefined) body.project = project;
		if (detachSeries) body.detach_series = true;
		if (detachParent) body.detach_parent = true;
		const answer: unknown = await pb.send(`${TRASH_ROUTE}/${encodeURIComponent(id)}/restore`, {
			method: 'POST',
			body,
			signal
		});
		return toRestoreResult(answer);
	});
}

/** "Endgültig löschen" of a ticket of the trash with its group. */
export function purgeFromTrash(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<void> {
	return withDataErrors(signal, async () => {
		await pb.send(`${TRASH_ROUTE}/${encodeURIComponent(id)}/purge`, { method: 'POST', signal });
	});
}

/**
 * The decisions of the decision help for the dependencies of a ticket in the trash (ADR-0047), in
 * one request; the preview afterwards.
 */
export function resolveTrash(
	pb: PocketBase,
	id: string,
	actions: readonly ResolveAction[],
	{ signal }: RequestOptions = {}
): Promise<TrashPreview> {
	return withDataErrors(signal, async () => {
		const answer: unknown = await pb.send(`${TRASH_ROUTE}/${encodeURIComponent(id)}/resolve`, {
			method: 'POST',
			body: { actions },
			signal
		});
		return toPreview(answer);
	});
}

/**
 * "Papierkorb leeren": the number of tickets deleted for good and the blocked tickets that stay
 * (ADR-0047; a server before the restart names none). With the area of the client (E7-3) only the
 * trash of that area; in a household without the right "purge" the server answers 403.
 */
export function emptyTrash(pb: PocketBase, { signal }: RequestOptions = {}): Promise<EmptyResult> {
	return withDataErrors(signal, async () => {
		const scope = clientArea(pb);
		const answer: unknown = await pb.send(`${TRASH_ROUTE}/empty`, {
			method: 'POST',
			...(scope !== null && { body: { scope } }),
			signal
		});
		if (!isRecord(answer) || typeof answer.purged !== 'number') throw invalid();
		const blocked = Array.isArray(answer.blocked) ? answer.blocked.filter(isRecord) : [];
		return {
			purged: answer.purged,
			blocked: blocked.map((entry) => ({
				id: String(entry.id),
				key: String(entry.key),
				count: typeof entry.count === 'number' ? entry.count : 0
			}))
		};
	});
}

/** Saves the retention of the signed-in account (users.trash_retention). */
export function saveTrashRetention(
	pb: PocketBase,
	userId: string,
	retention: TrashRetention,
	{ signal }: RequestOptions = {}
): Promise<TrashRetention> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection('users')
			.update<{ trash_retention?: unknown }>(
				userId,
				{ trash_retention: retention },
				{ fields: 'id,trash_retention', signal }
			);
		return parseRetention(record.trash_retention);
	});
}

/** Calls `onChange` whenever the server reports a change of the own trash. */
export function subscribeTrash(pb: PocketBase, onChange: () => void): Promise<Unsubscribe> {
	return pb.realtime.subscribe(TRASH_TOPIC, () => onChange());
}
