<script lang="ts">
	import {
		SOURCE_FAMILY_LABELS,
		SOURCE_FAMILY_SYMBOL_TEXT,
		sourceFamily
	} from '$lib/domain/source';
	import type { InboxChannel } from '$lib/domain/inbox';

	// Symbol of the source family in the title cell (ADR-0019 section 4): a small icon with a
	// tooltip and a hidden text ("aus Mail") for screen readers, like the icon "wiederkehrend".
	// Tickets typed in by hand (and those before E4) show none; colour never carries the meaning.
	let { source }: { source: InboxChannel | null } = $props();

	const family = $derived(sourceFamily(source));
</script>

{#if family !== 'manual'}
	<span class="source-icon" title={`Quelle: ${SOURCE_FAMILY_LABELS[family]}`} data-family={family}>
		<svg
			viewBox="0 0 16 16"
			width="14"
			height="14"
			aria-hidden="true"
			focusable="false"
			fill="none"
			stroke="currentColor"
			stroke-width="1.4"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			{#if family === 'link'}
				<path d="M6.75 9.25l2.5-2.5" />
				<path d="M7.5 4.75l1-1a2.5 2.5 0 0 1 3.54 3.54l-1 1" />
				<path d="M8.5 11.25l-1 1a2.5 2.5 0 0 1-3.54-3.54l1-1" />
			{:else if family === 'mail'}
				<rect x="2" y="3.5" width="12" height="9" rx="1.25" />
				<path d="M2.5 4.5L8 8.75l5.5-4.25" />
			{:else if family === 'calendar'}
				<rect x="2.25" y="3.25" width="11.5" height="10.5" rx="1.25" />
				<path d="M2.25 6.5h11.5M5.5 1.75v3M10.5 1.75v3" />
			{:else if family === 'chat'}
				<path d="M2.5 3.5h11v7h-6.5l-3 2.5v-2.5h-1.5z" />
			{:else}
				<path d="M4 2h5.5l2.5 2.5V14H4z" />
				<path d="M9.5 2v2.5H12" />
			{/if}
		</svg>
		<span class="visually-hidden">{SOURCE_FAMILY_SYMBOL_TEXT[family]}</span>
	</span>
{/if}

<style>
	.source-icon {
		display: inline-flex;
		margin-right: 0.375rem;
		vertical-align: middle;
		color: var(--color-text-muted);
	}
</style>
