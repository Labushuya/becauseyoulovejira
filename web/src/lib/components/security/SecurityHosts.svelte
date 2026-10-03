<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import { extraHostProblem, sameHosts, type SecurityOverview } from '$lib/domain/security';
	import type { SecurityStore } from '$lib/stores/security.svelte';

	// Further hosts of the page "Sicherheit" (ADR-0055 §3 and §8): empty by default, only for a later
	// access from other devices (e.g. Tailscale), only names with a dot and HTTPS. The list is edited
	// here and saved as a whole into byl-config.json by the control script; it applies after a
	// restart, which the page "System" offers. Checks speak inline at the field (ADR-0009).
	let { store, overview }: { store: SecurityStore; overview: SecurityOverview } = $props();

	const uid = $props.id();
	const ids = {
		input: `${uid}-input`,
		error: `${uid}-error`,
		hint: `${uid}-hint`
	};
	// The list starts with the saved hosts; what the user changes stays until it is saved.
	let draft = $state<string[]>(untrack(() => [...overview.hosts.configured]));
	let entry = $state('');
	let entryError = $state('');
	let input = $state<HTMLInputElement>();

	const busy = $derived(store.busy !== null);
	const changed = $derived(!sameHosts(draft, overview.hosts.configured));
	const message = $derived(store.partMessage?.part === 'hosts' ? store.partMessage.message : null);

	function add(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		entryError = extraHostProblem(entry, draft);
		if (entryError !== '') {
			input?.focus();
			return;
		}
		draft = [...draft, entry.trim().toLowerCase()];
		entry = '';
	}

	function remove(host: string) {
		if (busy) return;
		draft = draft.filter((name) => name !== host);
		input?.focus();
	}

	async function save() {
		if (busy || !changed) return;
		if (await store.saveHosts(draft)) draft = [...(store.overview?.hosts.configured ?? draft)];
	}
</script>

<SectionMessage tone="warning" title="Nur für einen späteren Zugriff von anderen Geräten">
	Trage hier nur Namen ein, unter denen die App später über HTTPS erreichbar sein soll, etwa über
	Tailscale (rechner.tailnet.ts.net). Ohne einen solchen Zugang bleibt die Liste leer; die App ist
	dann nur auf diesem Rechner erreichbar.
</SectionMessage>

{#if !overview.hosts.editable}
	<p class="note">
		Zusätzliche Adressen stellt nur die App unter Windows aus ihrem Ordner app ein. Von Hand stehen
		sie in <code>byl-config.json</code> unter <code>security.hosts</code>.
	</p>
{:else}
	{#if draft.length > 0}
		<ul class="hosts" aria-label="Zusätzliche Adressen">
			{#each draft as host (host)}
				<li>
					<code>{host}</code>
					<button
						class="button-icon"
						type="button"
						aria-label={`„${host}“ entfernen`}
						title="Adresse entfernen"
						aria-disabled={busy ? 'true' : undefined}
						onclick={() => remove(host)}
					>
						<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
							<path d="M4 4l8 8M12 4l-8 8" />
						</svg>
					</button>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="note">Keine zusätzlichen Adressen.</p>
	{/if}

	<form class="form" novalidate onsubmit={add}>
		<label class="label" for={ids.input}>Adresse hinzufügen</label>
		<div class="line">
			<input
				id={ids.input}
				type="text"
				spellcheck="false"
				autocomplete="off"
				placeholder="rechner.tailnet.ts.net"
				bind:this={input}
				bind:value={entry}
				oninput={() => (entryError = '')}
				aria-invalid={entryError === '' ? undefined : 'true'}
				aria-describedby={entryError === '' ? ids.hint : `${ids.error} ${ids.hint}`}
			/>
			<button class="button-secondary" type="submit" aria-disabled={busy ? 'true' : undefined}>
				Hinzufügen
			</button>
		</div>
		{#if entryError !== ''}
			<p class="field-error" id={ids.error}><ErrorIcon /><span>{entryError}</span></p>
		{/if}
		<p class="hint" id={ids.hint}>
			Ein Name mit Punkt, optional mit Port (pi.example.org:8443), ohne http:// und ohne IP-Adresse;
			höchstens {overview.hosts.max}.
		</p>
	</form>

	{#if message !== null}
		<SectionMessage tone="error" title={message.title} live>
			{message.text}
			{#if store.invalidHosts.length > 0}
				Abgelehnt: {store.invalidHosts.join(', ')}.
			{/if}
		</SectionMessage>
	{/if}

	<div>
		<button
			class="button-primary"
			type="button"
			aria-disabled={busy || !changed ? 'true' : undefined}
			aria-busy={store.busy === 'hosts' ? 'true' : undefined}
			onclick={() => void save()}
		>
			Adressen speichern
		</button>
	</div>
{/if}

{#if store.restartNeeded}
	<SectionMessage tone="info" title="Neustart nötig" live>
		Die gespeicherten Adressen gelten erst nach einem Neustart der App. Auf der Seite „System“
		startest du sie mit „Jetzt neu starten“ neu, oder mit neu-starten.bat im Ordner app.
		{#snippet actions()}
			<a href={resolve('/einstellungen/system')}>Zur Seite System</a>
		{/snippet}
	</SectionMessage>
{/if}

<style>
	.note,
	.hint {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	.hosts {
		display: grid;
		gap: 0.25rem;
		padding: 0;
		list-style: none;
	}

	.hosts li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		font-size: var(--font-size-body);
	}

	.form {
		display: grid;
		gap: 0.375rem;
		max-width: 40rem;
	}

	.label {
		font-size: var(--font-size-body);
		font-weight: 500;
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.line input {
		flex: 1 1 min(16rem, 100%);
	}
</style>
