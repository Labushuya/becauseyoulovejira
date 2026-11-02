<script lang="ts">
	import type { Snippet } from 'svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import { RESTART_TEXTS } from '$lib/domain/system';
	import { RESTART_NEEDED } from '$lib/guidance/texts';
	import { appContext } from '$lib/stores/context.svelte';
	import { findRestartStore, type RestartStore } from '$lib/stores/restart.svelte';
	import RestartAction from './RestartAction.svelte';

	// The hint "restart needed" with "Jetzt neu starten" (BW-2, ADR-0072 addendum): one building
	// block for every view that waits for a restart, e.g. after an update whose migration runs only
	// then. The text names the way in the browser (RESTART_NEEDED, RESTART_WAY), never a script. Only
	// the administrator on the machine of the app under Windows (capabilities.scripts) gets the button
	// of the page System below the hint (RestartAction: the same question, route, checks, progress and
	// result; locked without a connection; the files of the folder app folded under „Notfall“). Every
	// other tab reads in the text who restarts where, so nothing stands twice. The button stands next
	// to the message, not in it: a live message stays a short status, the run has its own one.
	let {
		title = RESTART_NEEDED.title,
		text,
		place,
		restart,
		live = false,
		headingLevel = 3,
		onrestarted,
		actions
	}: {
		/** Title of the message; '' for a hint whose sentence names the area itself. */
		title?: string;
		/** The sentence, e.g. restartNeeded('Der Papierkorb ist'); RESTART_NEEDED.text by default. */
		text?: string;
		/** Where the run is started (RestartStore); unique on the page. */
		place: string;
		/** The store of the page; by default the one of the (app) layout. */
		restart?: RestartStore | null;
		live?: boolean;
		headingLevel?: 3 | 4;
		/** The server is back: load what waited for it. */
		onrestarted?: () => void;
		/** Further actions of the message, e.g. a link. */
		actions?: Snippet;
	} = $props();

	const layout = findRestartStore();
	const store = $derived(restart === undefined ? layout : restart);
</script>

<div class="restart-needed">
	<SectionMessage tone="info" {title} {live} {headingLevel} {actions}>
		{text ?? RESTART_NEEDED.text}
	</SectionMessage>
	{#if appContext.capabilities.scripts}
		<RestartAction {store} {place} hint={RESTART_TEXTS.noticeHint} {onrestarted} />
	{/if}
</div>

<style>
	.restart-needed {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}
</style>
