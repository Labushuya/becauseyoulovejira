<script lang="ts">
	import { helpHref } from '$lib/settings-sections';
	import Modal from '../overlay/Modal.svelte';
	import ShortcutList from './ShortcutList.svelte';

	// Modal "Tastaturkürzel" (plan EH-9, §3.10): opened with `?` or from the help menu, it shows the
	// keys "Überall" and "Liste" from the one source and leads to the whole help in the footer. The
	// (app) layout owns it, so the link closes the modal itself before the settings page opens.
	let { onclose }: { onclose: () => void } = $props();

	const uid = $props.id();
</script>

<Modal open size="m" title="Tastaturkürzel" describedBy={`${uid}-intro`} {onclose}>
	<div class="shortcuts">
		<p id={`${uid}-intro`}>
			Die wichtigsten Tasten. Panel und Dialoge haben eigene; alle stehen in der Hilfe.
		</p>
		<ShortcutList contexts={['everywhere', 'list']} />
	</div>

	{#snippet footer({ close })}
		<button class="button-secondary" type="button" onclick={close}>Schließen</button>
		<a class="button-primary" href={helpHref('tastaturkuerzel')} onclick={() => onclose()}>
			Ganze Hilfe
		</a>
	{/snippet}
</Modal>

<style>
	.shortcuts {
		display: grid;
		gap: 0.75rem;
	}

	p {
		font-size: 0.875rem;
		color: var(--color-text-muted);
	}

	a {
		text-decoration: none;
	}
</style>
