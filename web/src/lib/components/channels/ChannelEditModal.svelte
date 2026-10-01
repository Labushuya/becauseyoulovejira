<script lang="ts">
	import {
		KEYWORD_SEARCH_TEXT,
		MAIL_INBOX_HINT,
		NO_KEYWORDS_WARNING,
		type Connection,
		type TelegramRepliesChange
	} from '$lib/domain/connections';
	import { MAIL_MATCH_BODY_LABEL } from '$lib/domain/keywords';
	import SectionMessage from '../guidance/SectionMessage.svelte';
	import KeywordEditor from '../KeywordEditor.svelte';
	import Modal from '../overlay/Modal.svelte';
	import TelegramReplySwitches from './TelegramReplySwitches.svelte';

	// "‹Name› bearbeiten" (ADR-0026 section 3, plan EH-3): a modal of size M with the keywords of the
	// connection, its switches (Telegram: the confirmation and the answer to messages without
	// keyword, ADR-0016 addendum of 2026-10-01; mailbox: search headers and the whole text) and the
	// names of its variables, read only, with the way to the setup. Every change is saved at once,
	// so the footer says "Schließen" (ADR-0025 section 3); results go out as flags. The switches are
	// switches after Apple HIG (ADR-0029, G-5): a single emphasised setting, a row with the name
	// left and the switch right, drawn by base.css through role="switch".
	let {
		connection,
		message = null,
		onkeywords,
		onreplies,
		onmatchbody,
		onsetup,
		onclose
	}: {
		connection: Connection;
		/** Error of the last switch (inline). */
		message?: string | null;
		onkeywords: (next: string[], announcement: string) => Promise<string | null>;
		/** Telegram: a switch of the answers of the bot changed. */
		onreplies: (change: TelegramRepliesChange) => Promise<void>;
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
			<TelegramReplySwitches {connection} onchange={onreplies} />
		{/if}
		{#if connection.type === 'mail'}
			<SectionMessage tone="info" compact>{MAIL_INBOX_HINT}</SectionMessage>
			<label class="setting">
				<span>{MAIL_MATCH_BODY_LABEL}</span>
				<input
					type="checkbox"
					role="switch"
					checked={connection.matchBody}
					onchange={(event) => onmatchbody(event.currentTarget.checked)}
				/>
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

	/* A setting row: the name left, the switch right (like "Glas-Effekt" under "Darstellung"). */
	.setting {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		font-size: var(--font-size-body);
		cursor: pointer;
	}

	.setting input {
		flex: none;
	}

	.variables {
		display: grid;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--color-line);
	}

	h3 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	dl {
		display: grid;
		gap: 0.25rem;
		font-size: var(--font-size-control);
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
		font-size: var(--font-size-control);
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
