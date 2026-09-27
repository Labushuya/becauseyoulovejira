<script lang="ts">
	import { STATUS_LABELS } from '$lib/domain/labels';
	import type { Status } from '$lib/domain/status';

	// Status pill "Ton in Ton" (CLAUDE.md section 8). The label is text, so color is never the
	// only cue; "Erledigt" also carries a check icon.
	let { status }: { status: Status } = $props();
</script>

<span class="pill" data-status={status}>
	{#if status === 'done'}
		<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
			<path
				d="M3.5 8.5l3 3 6-7"
				fill="none"
				stroke="currentColor"
				stroke-width="1.75"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	{/if}
	{STATUS_LABELS[status]}
</span>

<style>
	.pill {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		padding: 0.0625rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 500;
		line-height: 1.25rem;
		white-space: nowrap;
		border: 1px solid transparent;
		border-radius: var(--radius-pill);
	}

	[data-status='backlog'] {
		color: var(--status-backlog-text);
		background: var(--status-backlog-bg);
		border-color: var(--status-backlog-border);
	}

	[data-status='open'] {
		color: var(--status-open-text);
		background: var(--status-open-bg);
		border-color: var(--status-open-border);
	}

	[data-status='in_progress'] {
		color: var(--status-in-progress-text);
		background: var(--status-in-progress-bg);
		border-color: var(--status-in-progress-border);
	}

	[data-status='waiting'] {
		color: var(--status-waiting-text);
		background: var(--status-waiting-bg);
		border-color: var(--status-waiting-border);
	}

	[data-status='done'] {
		color: var(--status-done-text);
		background: var(--status-done-bg);
		border-color: var(--status-done-border);
	}
</style>
