<script lang="ts">
	import { bookmarkletCode } from '$lib/domain/bookmarklet';

	// Settings "Kanäle" (E4 plan, T-3 and package 7): for now the bookmarklet; connections with
	// access data follow with package 10. The link is dragged to the bookmarks bar; for the
	// keyboard the code can be copied and saved as the address of a new bookmark. A click on the
	// link here does nothing, so the page does not capture itself.
	let {
		captureUrl
	}: {
		/** Absolute address of the capture form, e.g. http://127.0.0.1:8090/eingang/neu. */
		captureUrl: string;
	} = $props();

	const uid = $props.id();
	const ids = {
		heading: `${uid}-heading`,
		bookmarklet: `${uid}-bookmarklet`,
		code: `${uid}-code`
	};

	const code = $derived(bookmarkletCode(captureUrl));
	let status = $state<string | null>(null);

	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			status = 'Code kopiert.';
		} catch {
			status = 'Kopieren nicht möglich. Bitte den Code im Feld markieren und mit Strg+C kopieren.';
		}
	}
</script>

<section class="channels" aria-labelledby={ids.heading}>
	<h2 id={ids.heading}>Kanäle</h2>

	<section class="card" aria-labelledby={ids.bookmarklet}>
		<h3 id={ids.bookmarklet}>Bookmarklet für Web-Links</h3>
		<p>
			Das Bookmarklet bringt die gerade offene Webseite in den Eingang: Es öffnet die Erfassung in
			einem neuen Tab mit Adresse, Titel und markiertem Text der Seite. Gespeichert wird erst, wenn
			du dort auf „In den Eingang“ klickst.
		</p>
		<p class="link-row">
			<!-- eslint-disable svelte/no-navigation-without-resolve -- the bookmarklet itself: a javascript: address meant for the bookmarks bar, not for navigation here -->
			<a
				class="bookmarklet"
				href={code}
				draggable="true"
				onclick={(event) => {
					event.preventDefault();
					status = 'Den Link in die Lesezeichenleiste ziehen; hier bewirkt ein Klick nichts.';
				}}
			>
				In den Eingang
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</p>
		<ol>
			<li>Lesezeichenleiste einblenden (Strg+Umschalt+B).</li>
			<li>Den Link „In den Eingang“ mit der Maus auf die Leiste ziehen.</li>
			<li>
				Auf einer Webseite das Lesezeichen anklicken, im neuen Tab prüfen und „In den Eingang“
				wählen. Ist die App nicht angemeldet, geht es nach der Anmeldung dorthin weiter.
			</li>
		</ol>
		<p class="hint">
			Ohne Maus: Code kopieren, ein neues Lesezeichen anlegen und den Code als Adresse einfügen. Nur
			http- und https-Seiten werden übernommen. Dieselbe Seite ein zweites Mal meldet, dass sie
			schon im Eingang ist.
		</p>
		<label for={ids.code}>Code des Bookmarklets</label>
		<textarea id={ids.code} rows="3" readonly value={code}></textarea>
		<p>
			<button class="secondary" type="button" onclick={copy}>Code kopieren</button>
		</p>
		<p class="hint" role="status">{status ?? ''}</p>
	</section>
</section>

<style>
	.channels {
		display: grid;
		gap: 1rem;
		max-width: 48rem;
	}

	h2 {
		font-size: 1.125rem;
		font-weight: 600;
	}

	h3 {
		font-size: 1rem;
		font-weight: 600;
	}

	.card {
		display: grid;
		gap: 0.75rem;
		padding: 1.25rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.5rem;
	}

	ol {
		display: grid;
		gap: 0.25rem;
		padding-left: 1.25rem;
	}

	.bookmarklet {
		display: inline-block;
		padding: 0.375rem 0.875rem;
		color: var(--color-brand-soft-text);
		text-decoration: none;
		background: var(--color-brand-soft-bg);
		border: 1px solid var(--color-brand);
		border-radius: 0.375rem;
		cursor: grab;
	}

	label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	textarea {
		width: 100%;
		padding: 0.375rem 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: 0.375rem;
	}

	.secondary {
		padding: 0.5rem 1rem;
		background: none;
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
	}

	.hint {
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
</style>
