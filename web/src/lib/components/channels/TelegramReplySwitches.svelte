<script lang="ts">
	import { tick } from 'svelte';
	import {
		TELEGRAM_REPLIES_HINT,
		TELEGRAM_REPLY_NO_MATCH_LABEL,
		TELEGRAM_REPLY_SAVED_LABEL,
		type Connection,
		type TelegramRepliesChange
	} from '$lib/domain/connections';

	// The two answers of a Telegram bot in the chat (ADR-0016, addendum of 2026-10-01): "Bestätigung
	// senden" after a saved entry and "Hinweis bei fehlendem Stichwort senden", both on by default.
	// One building block for the details of the card, the modal "Stichwörter und Einstellungen …"
	// and the last step of the assistant. Switches after Apple HIG (ADR-0029, G-5): a single
	// emphasised setting per row, the name left and the switch right, drawn by base.css through
	// role="switch". The group says honestly that the answers are messages in the chat. Every
	// change goes to the owner at once, who saves it; afterwards each switch shows the saved value
	// again, so a refused change does not stay on the screen (the owner shows the error). In the
	// details of a card (`compact`) the group takes the size of the rows around it.
	let {
		connection,
		compact = false,
		onchange
	}: {
		connection: Pick<Connection, 'replySaved' | 'replyNoMatch'>;
		/** In the details of a card: the text size and the quiet name of the rows there. */
		compact?: boolean;
		onchange: (change: TelegramRepliesChange) => Promise<void>;
	} = $props();

	const uid = $props.id();
	const hintId = `${uid}-hint`;

	async function toggle(input: HTMLInputElement, change: TelegramRepliesChange) {
		await onchange(change);
		await tick();
		input.checked = 'replySaved' in change ? connection.replySaved : connection.replyNoMatch;
	}
</script>

<fieldset class="replies" class:compact aria-describedby={hintId}>
	<legend>Antworten im Chat</legend>
	<label class="setting">
		<span>{TELEGRAM_REPLY_SAVED_LABEL}</span>
		<input
			type="checkbox"
			role="switch"
			checked={connection.replySaved}
			onchange={(event) =>
				void toggle(event.currentTarget, { replySaved: event.currentTarget.checked })}
		/>
	</label>
	<label class="setting">
		<span>{TELEGRAM_REPLY_NO_MATCH_LABEL}</span>
		<input
			type="checkbox"
			role="switch"
			checked={connection.replyNoMatch}
			onchange={(event) =>
				void toggle(event.currentTarget, { replyNoMatch: event.currentTarget.checked })}
		/>
	</label>
	<p class="hint" id={hintId}>{TELEGRAM_REPLIES_HINT}</p>
</fieldset>

<style>
	.replies {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		font-size: var(--font-size-body);
		border: 0;
	}

	.replies.compact {
		font-size: var(--font-size-control);
	}

	legend {
		padding: 0;
		margin-bottom: 0.5rem;
		font-weight: 600;
	}

	/* Like the names of the rows in the details of a card (dt). */
	.compact legend {
		font-weight: 400;
		color: var(--color-text-muted);
	}

	/* A setting row: the name left, the switch right (like "Glas-Effekt" under "Darstellung"). */
	.setting {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		cursor: pointer;
	}

	.setting input {
		flex: none;
	}

	.hint {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}
</style>
