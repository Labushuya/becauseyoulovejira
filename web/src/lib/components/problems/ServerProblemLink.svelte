<script lang="ts">
	import { page } from '$app/state';
	import { SERVER_PROBLEM_TEXTS, detailsSuffix } from '$lib/domain/server-problems';
	import { channelProblems, withServerProblem, type ChannelProblemFinder } from '$lib/problem-link';

	// "Details" at the last error of a channel card in the background (FP-2, ADR-0077; ADR-0071 §6):
	// a link to the entry of the error log of the server for this connection (`?fehler=<id>` on the
	// current page, the dialog of the errors opens there). It asks for the newest entry of the
	// connection once per state of the card (`seen`, e.g. time and text of the last run), through the
	// finder of the page "Kanäle" (provideChannelProblems). It shows nothing while it asks, when there
	// is no entry (an error of before the log, a gone entry), when the question fails (e.g. without a
	// connection) and outside of that page. A small button in the row (44 px in the phone frame through
	// .button-subtle); its name tells it apart from the details of the card.
	let {
		connection,
		name,
		seen,
		find = channelProblems()
	}: {
		/** ID of the connection of the card. */
		connection: string;
		/** Name of the card. */
		name: string;
		/** The state of the last run; a new one asks again. */
		seen: string;
		/** The newest entry of the connection; by default the finder of the page. */
		find?: ChannelProblemFinder | null;
	} = $props();

	let found = $state<{ key: string; id: string } | null>(null);
	const key = $derived(`${connection}\n${seen}`);
	const id = $derived(found !== null && found.key === key ? found.id : null);

	$effect(() => {
		const asked = key;
		const target = connection;
		const finder = find;
		if (finder === null) return;
		const controller = new AbortController();
		finder(target, controller.signal).then(
			(result) => {
				if (!controller.signal.aborted) found = result === null ? null : { key: asked, id: result };
			},
			() => {
				// No link: the card shows its error as before.
			}
		);
		return () => controller.abort();
	});
</script>

{#if id !== null}
	<a
		class="button-subtle server-problem-link"
		href={withServerProblem(page.url, id)}
		data-sveltekit-keepfocus
		data-sveltekit-noscroll
		data-sveltekit-replacestate
	>
		{SERVER_PROBLEM_TEXTS.details}<span class="visually-hidden">{detailsSuffix(name)}</span>
	</a>
{/if}

<style>
	.server-problem-link {
		font-size: var(--font-size-control);
	}
</style>
