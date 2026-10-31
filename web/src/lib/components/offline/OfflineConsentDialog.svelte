<script lang="ts">
	import {
		OFFLINE_CONSENT_MARK,
		OFFLINE_CONSENT_TEXTS,
		type OfflineConsent
	} from '$lib/domain/offline-consent';
	import Modal from '../overlay/Modal.svelte';

	// The question at the first start of the phone view (package "Einschalten", ADR-0074 addendum
	// "Zustimmung je Gerät"): the modal in size S (in the phone frame a sheet, its buttons of 44 px from
	// base.css) with the question as title, the announcement that the phone view is on and what the
	// answer means as its description. "Nein" and "Ja, merken" answer; the focus starts on "Nein", the
	// answer that keeps everything as before, like "Abbrechen" of a confirmation (ADR-0025 §4). Escape,
	// × and a click on the veil close it without an answer: the next start asks again. Its text carries
	// OFFLINE_CONSENT_MARK, so the layout, which waits for every other open dialog (round 2, E-1), does
	// not count this one.
	const mark = { [OFFLINE_CONSENT_MARK]: '' };
	let {
		onanswer,
		ondismiss
	}: {
		onanswer: (consent: OfflineConsent) => void;
		ondismiss: () => void;
	} = $props();

	const uid = $props.id();
	const textId = `${uid}-text`;

	let noButton = $state<HTMLButtonElement>();
</script>

{#snippet buttons()}
	<button
		class="button-secondary"
		type="button"
		bind:this={noButton}
		onclick={() => onanswer('no')}
	>
		{OFFLINE_CONSENT_TEXTS.no}
	</button>
	<button class="button-primary" type="button" onclick={() => onanswer('yes')}>
		{OFFLINE_CONSENT_TEXTS.yes}
	</button>
{/snippet}

<Modal
	open
	size="s"
	title={OFFLINE_CONSENT_TEXTS.title}
	describedBy={textId}
	initialFocus={noButton}
	onclose={ondismiss}
	footer={buttons}
>
	<div class="text" id={textId} {...mark}>
		<p>{OFFLINE_CONSENT_TEXTS.announcement}</p>
		<p>{OFFLINE_CONSENT_TEXTS.explanation}</p>
	</div>
</Modal>

<style>
	.text {
		display: grid;
		gap: 0.5rem;
	}
</style>
