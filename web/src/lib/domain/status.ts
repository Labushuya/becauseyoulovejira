// Frontend mirror of app/pb_hooks/lib/status.js (CLAUDE.md section 5).
// tests/unit/status.test.mjs verifies that both modules stay identical.

export const STATUSES = ['backlog', 'open', 'in_progress', 'waiting', 'done'] as const;
export type Status = (typeof STATUSES)[number];

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CATEGORIES = ['open', 'active', 'closed'] as const;
export type StatusCategory = (typeof CATEGORIES)[number];

export const STATUS_CATEGORY: Readonly<Record<Status, StatusCategory>> = Object.freeze({
	backlog: 'open',
	open: 'open',
	in_progress: 'active',
	waiting: 'active',
	done: 'closed'
});

export function isStatus(value: unknown): value is Status {
	return (STATUSES as readonly unknown[]).includes(value);
}

export function isPriority(value: unknown): value is Priority {
	return (PRIORITIES as readonly unknown[]).includes(value);
}

/** Category of a status, or null for unknown values. */
export function categoryOf(status: unknown): StatusCategory | null {
	return isStatus(status) ? STATUS_CATEGORY[status] : null;
}

export function isDone(status: unknown): boolean {
	return status === 'done';
}
