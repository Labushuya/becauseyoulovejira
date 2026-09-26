<script lang="ts">
	import { resolve } from '$app/paths';
	import { PROTON_LINK, PROTON_STEPS } from '$lib/domain/channel-setup';
	import ExternalLink from '../guidance/ExternalLink.svelte';
	import Modal from '../overlay/Modal.svelte';

	// "Proton-Mails übernehmen" (ADR-0026 section 4, plan EH-7 §3.7): Proton Mail has no automatic
	// fetch in the free plan, so its three short steps need no stepper (ADS: a tracker only from
	// three steps with views of their own). A modal M with a numbered list, the link to Proton, and
	// in the footer "Zum Eingang" (primary) and the keywords of the mail files. Opened through
	// ?einrichten=proton like the assistant.
	let { onclose }: { onclose: () => void } = $props();

	const uid = $props.id();
</script>

<Modal open size="m" title="Proton-Mails übernehmen" describedBy={`${uid}-intro`} {onclose}>
	<div class="guide">
		<p id={`${uid}-intro`}>
			Proton Mail hat im Free-Tarif keinen automatischen Abruf (Proton Mail Bridge setzt einen
			bezahlten Tarif voraus). Mails aus Proton kommen deshalb als Datei in den Eingang.
		</p>
		<p><ExternalLink href={PROTON_LINK.href}>{PROTON_LINK.text}</ExternalLink></p>
		<ol>
			{#each PROTON_STEPS as step (step)}
				<li>{step}</li>
			{/each}
		</ol>
	</div>

	{#snippet footer({ close })}
		<button class="button-subtle later" type="button" onclick={close}>Schließen</button>
		<a class="button-secondary" href={resolve('/einstellungen/datei-importe')}
			>Stichwörter für Mail-Dateien</a
		>
		<a class="button-primary" href={resolve('/eingang')}>Zum Eingang</a>
	{/snippet}
</Modal>

<style>
	.guide {
		display: grid;
		gap: 0.75rem;
	}

	p,
	li {
		font-size: 0.875rem;
	}

	ol {
		display: grid;
		gap: 0.25rem;
		padding-left: 1.25rem;
	}

	a {
		text-decoration: none;
	}

	.later {
		margin-right: auto;
	}
</style>
