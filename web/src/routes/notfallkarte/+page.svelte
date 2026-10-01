<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { auth } from '$lib/auth.svelte';
	import EmergencyCard from '$lib/components/backup/EmergencyCard.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import { fetchHostPlatform } from '$lib/data/host';
	import type { HostPlatform } from '$lib/domain/host-platform';
	import { formatPointInTime } from '$lib/domain/system';
	import { pb } from '$lib/pocketbase';
	import { BackupStore, backupData, backupDenialNotice } from '$lib/stores/backup.svelte';

	// Notfallkarte (ADR-0046 §8): a page of its own, outside the header and the navigation of the app,
	// so it prints as it stands ("Drucken" and the way back stay off the paper). Signed in only (the
	// route guard of the root layout); it loads the state of the backups like the page "Sicherung",
	// on a server under Windows only, and never shows a secret.
	const store = new BackupStore(backupData(pb), auth);
	const printedAt = formatPointInTime(new Date().toISOString());
	const platformNotice = backupDenialNotice('platform');
	let platform = $state<HostPlatform | null>(null);

	$effect(() =>
		untrack(() => {
			void fetchHostPlatform(pb).then((found) => {
				platform = found;
				if (found === 'windows') void store.load();
			});
		})
	);
	$effect(() => () => store.dispose());

	// Paper is white and browsers leave backgrounds off: for the print the page uses the light tokens,
	// also in dark mode (light text on white paper would be unreadable), and afterwards the mode of
	// before. Covers "Drucken" as well as Ctrl+P.
	let printing = false;
	let themeBeforePrint: string | null = null;

	function lightForPrint() {
		if (printing) return;
		printing = true;
		themeBeforePrint = document.documentElement.getAttribute('data-theme');
		document.documentElement.setAttribute('data-theme', 'light');
	}

	function themeAfterPrint() {
		if (!printing) return;
		printing = false;
		if (themeBeforePrint === null) document.documentElement.removeAttribute('data-theme');
		else document.documentElement.setAttribute('data-theme', themeBeforePrint);
	}
</script>

<svelte:window onbeforeprint={lightForPrint} onafterprint={themeAfterPrint} />

<svelte:head>
	<title>Notfallkarte · becauseyoulovejira</title>
</svelte:head>

<main class="page">
	<nav class="tools" aria-label="Notfallkarte">
		<a href={resolve('/einstellungen/sicherung')}>← Zurück zu Einstellungen → Sicherung</a>
		{#if store.overview !== null}
			<button class="button-primary" type="button" onclick={() => window.print()}>Drucken</button>
		{/if}
	</nav>
	{#if platform !== null && platform !== 'windows'}
		<SectionMessage tone="info" title={platformNotice.title}>{platformNotice.text}</SectionMessage>
	{:else if store.overview !== null}
		<EmergencyCard overview={store.overview} address={page.url.origin} {printedAt} />
	{:else if store.message !== null}
		<SectionMessage tone={store.state === 'error' ? 'error' : 'info'} title={store.message.title}>
			{store.message.text}
		</SectionMessage>
	{:else}
		<p class="note" role="status">Notfallkarte wird geladen …</p>
	{/if}
</main>

<style>
	.page {
		display: grid;
		gap: 1rem;
		max-width: 52rem;
		padding: 1.5rem;
	}

	.tools {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		justify-content: space-between;
		font-size: var(--font-size-body);
	}

	.note {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	@media print {
		.tools {
			display: none;
		}

		.page {
			padding: 0;
		}
	}
</style>
