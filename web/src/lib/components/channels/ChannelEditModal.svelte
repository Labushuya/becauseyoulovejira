<script lang="ts">
	import {
		KEYWORD_SEARCH_TEXT,
		MAIL_NEW_ONLY_HINT,
		NO_KEYWORDS_WARNING,
		type Connection
	} from '$lib/domain/connections';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import KeywordEditor from '../KeywordEditor.svelte';
	import Modal from '../overlay/Modal.svelte';

	// "‹Name› bearbeiten" (ADR-0026 section 3, plan EH-3): a modal of size M with the keywords of the
	// connection, its switch (Telegram: answer to messages without keyword; mailbox: search the start
	// of the text) and the names of its variables, read only, with the way to the setup. Every change
	// is saved at once, so the footer says "Schließen" (ADR-0025 section 3); results go out as flags.
	let {
		connection,
		message = null,
		onkeywords,
		onreply,
		onmatchbody,
		onsetup,
		onclose
	}: {
		connection: Connection;
		/** Error of the last switch (inline). */
		message?: string | null;
		onkeywords: (next: string[], announcement: string) => Promise<string | null>;
		onreply: (replyNoMatch: boolean) => void;
		onmatchbody: (matchBody: boolean) => void;
		/** Closes the modal and shows the setup of this kind. */
		onsetup: () => void;
		onclose: () => void;
	} = $props();

	const uid = $props.id();
</script>

<Modal open size="m" title={`${connection.label} bearbeiten`} onclose={() => onclose()}>
	<div class="edit">
		<KeywordEditor
			keywords={connection.keywords}
			name={connection.label}
			description={KEYWORD_SEARCH_TEXT[connection.type]}
			emptyText={NO_KEYWORDS_WARNING}
			onsave={onkeywords}
		/>
		{#if connection.type === 'telegram'}
			<label class="switch">
				<input
					type="checkbox"
					checked={connection.replyNoMatch}
					onchange={(event) => onreply(event.currentTarget.checked)}
				/>
				Auf Nachrichten ohne Stichwort antworten („Kein Stichwort erkannt – nicht gespeichert“)
			</label>
		{/if}
		{#if connection.type === 'mail'}
			<SectionMessage tone="info" compact>{MAIL_NEW_ONLY_HINT}</SectionMessage>
			<label class="switch">
				<input
					type="checkbox"
					checked={connection.matchBody}
					onchange={(event) => onmatchbody(event.currentTarget.checked)}
				/>
				Auch die ersten 500 Zeichen des Textes durchsuchen
			</label>
		{/if}
		{#if message !== null}
			<SectionMessage tone="error" compact live>{message}</SectionMessage>
		{/if}
		<section class="variables" aria-labelledby={`${uid}-variables`}>
			<h3 id={`${uid}-variables`}>Zugangsdaten</h3>
			<dl>
				<div>
					<dt>Variable</dt>
					<dd><code>{connection.secretEnv}</code></dd>
				</div>
				{#if connection.type === 'telegram'}
					<div>
						<dt>Erlaubte IDs</dt>
						<dd><code>{connection.allowlistEnv}</code></dd>
					</div>
				{/if}
			</dl>
			<p class="hint">
				Die App speichert nur die Namen der Windows-Variablen, nie ihre Werte.
				<button class="link" type="button" onclick={onsetup}>Einrichtung erneut ansehen</button>
			</p>
		</section>
	</div>

	{#snippet footer({ close })}
		<button class="button-secondary" type="button" onclick={close}>Schließen</button>
	{/snippet}
</Modal>

<style>
	.edit {
		display: grid;
		gap: 1rem;
	}

	.switch {
		display: flex;
		gap: 0.375rem;
		align-items: baseline;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.variables {
		display: grid;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-line);
	}

	h3 {
		font-size: 0.875rem;
		font-weight: 600;
	}

	dl {
		display: grid;
		gap: 0.25rem;
		font-size: 0.8125rem;
	}

	dl div {
		display: grid;
		grid-template-columns: 7rem minmax(0, 1fr);
		gap: 0.5rem;
	}

	dt {
		color: var(--color-text-muted);
	}

	dd {
		overflow-wrap: anywhere;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}

	.link {
		padding: 0;
		font-size: inherit;
		color: var(--color-brand-text);
		text-decoration: underline;
		background: none;
		border: none;
		cursor: pointer;
	}
</style>
