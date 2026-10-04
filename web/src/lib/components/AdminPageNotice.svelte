<script lang="ts">
	import type { Capabilities } from '$lib/domain/context';
	import { CONTEXT_TEXTS, RESTART_NEEDED, pcOnlyText } from '$lib/guidance/texts';
	import SectionMessage from './guidance/SectionMessage.svelte';

	// Instead of a page of the administrator (KOB-1, ADR-0057) when the tab may not show it: no data,
	// no actions, no request. The administrator on another device gets the way to the machine of the
	// app, every other account the friendly "Nur für den Verwalter", a server before the restart the
	// hint after an update; while the context loads only a quiet status, so nothing flashes.
	let { capabilities }: { capabilities: Capabilities } = $props();
</script>

{#if capabilities.mode === 'pending'}
	<p class="hint" role="status">{CONTEXT_TEXTS.loading}</p>
{:else if capabilities.mode === 'remote'}
	<SectionMessage tone="info" title={CONTEXT_TEXTS.pcOnlyTitle}>
		{pcOnlyText(capabilities.localUrl)}
	</SectionMessage>
{:else if capabilities.mode === 'outdated'}
	<SectionMessage tone="info" title={RESTART_NEEDED.title}>{RESTART_NEEDED.text}</SectionMessage>
{:else}
	<SectionMessage tone="info" title={CONTEXT_TEXTS.adminOnlyTitle}>
		{CONTEXT_TEXTS.adminOnly}
	</SectionMessage>
{/if}

<style>
	.hint {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}
</style>
