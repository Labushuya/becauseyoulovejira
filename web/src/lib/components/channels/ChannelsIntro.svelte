<script lang="ts">
	import { helpHref } from '$lib/settings-sections';
	import GuidanceIcon from '../guidance/GuidanceIcon.svelte';

	// Explanation at the top of "Kanäle" (ADR-0026 section 3, plan §3.4): the two ways into the inbox
	// side by side, with own texts after the pattern of the task board, and below one sentence on the
	// access data (Windows user variables, ADR-0018) with a link to the help. The folded guide
	// "Zugangsdaten als Windows-Variable setzen" moved into the help with EH-9.
</script>

<div class="intro">
	<!-- Two short explanations, not sections: the page has its own sections with these names below. -->
	<div class="ways">
		<div class="way">
			<span class="icon"><GuidanceIcon name="refresh" size={18} /></span>
			<p>
				<strong>Automatisch abrufen</strong>
				<span class="text">
					Google Calendar, Telegram und Postfächer liefern neue Einträge von selbst, solange die App
					läuft. Es kommt nur, was ein Stichwort trifft.
				</span>
			</p>
		</div>
		<div class="way">
			<span class="icon"><GuidanceIcon name="inbox" size={18} /></span>
			<p>
				<strong>Selbst hereinbringen</strong>
				<span class="text">
					Web-Links per Bookmarklet, Mail- und Kalenderdateien oder WhatsApp-Exporte per Drag &amp;
					Drop. Du wählst aus, was in den Eingang soll.
				</span>
			</p>
		</div>
	</div>

	<p class="variables">
		Zugangsdaten stehen nur als Windows-Variable in deinem Konto, nie in der App.
		<a href={helpHref('zugangsdaten')}>Wie funktionieren die Zugangsdaten?</a>
	</p>
</div>

<style>
	.intro {
		display: grid;
		gap: 0.75rem;
	}

	.ways {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 0.75rem;
	}

	.way {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
		padding: 0.875rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.icon {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-radius: var(--radius-control);
	}

	p {
		font-size: 0.875rem;
	}

	.way p {
		display: grid;
		gap: 0.25rem;
	}

	.way strong {
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.way .text {
		color: var(--color-text-muted);
	}

	.variables {
		color: var(--color-text-muted);
	}

	.variables a {
		color: var(--color-brand-text);
	}
</style>
