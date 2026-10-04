<script lang="ts">
	import { resolve } from '$app/paths';
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';
	import CodeBlock from '$lib/components/guidance/CodeBlock.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import ConfirmDialog from '$lib/components/overlay/ConfirmDialog.svelte';
	import ScriptProblemDetails from '$lib/components/system/ScriptProblemDetails.svelte';
	import {
		CATEGORY_LABELS,
		FIREWALL_TEXTS,
		LAN_TEXTS,
		candidateText,
		lanRestartNeeded,
		lanUrl,
		sameAddresses,
		type FirewallAction
	} from '$lib/domain/lan';
	import type { SecurityOverview } from '$lib/domain/security';
	import { RESTART_NEEDED, restartNeeded } from '$lib/guidance/texts';
	import type { SecurityLanStore } from '$lib/stores/security-lan.svelte';

	// Access in the home network on the page "Sicherheit" (plan heimnetz, ADR-0055 addendum): the
	// warning that it goes unencrypted over HTTP, the address for other devices with "Kopieren", the
	// switch with the addresses of this computer (after a restart, which the page "System" offers),
	// the firewall rule (Windows asks for administrator rights after a confirmation here), the network
	// category of each address and how to keep the address in the FRITZ!Box. Off by default; only the
	// own instance under Windows can change it. Checks speak at the field (ADR-0009), nothing is red
	// but a real failure.
	let { overview, store }: { overview: SecurityOverview; store: SecurityLanStore | null } =
		$props();

	const uid = $props.id();
	const ids = {
		switch: `${uid}-switch`,
		switchHint: `${uid}-switch-hint`,
		addresses: `${uid}-addresses`,
		error: `${uid}-error`
	};

	const lan = $derived(overview.lan);
	const info = $derived(store?.info ?? null);
	const busy = $derived(store !== null && store.busy !== null);
	const activeUrls = $derived(lan.active ? lan.hosts.map(lanUrl) : []);
	const restart = $derived(lanRestartNeeded(lan, info));

	// What the person changed; null follows the saved setting.
	let draftEnabled = $state<boolean | null>(null);
	let draftAddresses = $state<string[] | null>(null);
	let addressError = $state('');
	const choiceInputs = $state<HTMLInputElement[]>([]);
	let confirming = $state<FirewallAction | null>(null);

	const enabled = $derived(draftEnabled ?? info?.enabled ?? false);
	const chosen = $derived(draftAddresses ?? [...(info?.addresses ?? [])]);
	const changed = $derived(
		info !== null && (enabled !== info.enabled || !sameAddresses(chosen, info.addresses))
	);
	// The addresses of this computer, then chosen ones that no adapter has right now.
	const choices = $derived.by(() => {
		if (info === null) return [];
		const list = info.candidates.map((entry) => ({
			address: entry.address,
			text: candidateText(entry)
		}));
		for (const address of info.addresses) {
			if (!list.some((entry) => entry.address === address)) {
				list.push({ address, text: 'gerade an keinem Netzwerkadapter dieses Rechners' });
			}
		}
		return list;
	});
	const message = $derived(store?.partMessage ?? null);
	const unprivate = $derived(
		info === null
			? []
			: info.states.filter((state) => state.present === true && state.category !== 'private')
	);
	const absent = $derived(
		info === null ? [] : info.states.filter((state) => state.present === false)
	);
	const offerAdd = $derived(info !== null && info.enabled && info.firewall.state !== 'present');
	const offerRemove = $derived(
		info !== null &&
			!info.enabled &&
			(info.firewall.state === 'present' || info.firewall.state === 'mismatch')
	);

	function toggleSwitch(event: Event & { currentTarget: HTMLInputElement }) {
		if (busy) {
			event.currentTarget.checked = enabled;
			return;
		}
		draftEnabled = event.currentTarget.checked;
		addressError = '';
		// Switched on without a choice: the first address of this computer is the likely one.
		const first = choices[0];
		if (draftEnabled && chosen.length === 0 && first !== undefined) {
			draftAddresses = [first.address];
		}
	}

	function toggleAddress(address: string, checked: boolean) {
		addressError = '';
		draftAddresses = checked
			? [...chosen.filter((entry) => entry !== address), address]
			: chosen.filter((entry) => entry !== address);
	}

	async function save() {
		if (store === null || busy || !changed) return;
		if (enabled && chosen.length === 0) {
			addressError = 'Bitte mindestens eine Adresse wählen.';
			choiceInputs[0]?.focus();
			return;
		}
		if (await store.save(enabled, chosen)) {
			draftEnabled = null;
			draftAddresses = null;
		}
	}

	function confirmFirewall() {
		const action = confirming;
		if (store === null || action === null) return;
		void store.firewall(action).finally(() => (confirming = null));
	}
</script>

<SectionMessage tone="warning" title={LAN_TEXTS.warningTitle}>
	{LAN_TEXTS.warning}
</SectionMessage>

{#if activeUrls.length > 0}
	{#each activeUrls as url (url)}
		<CodeBlock code={url} label={LAN_TEXTS.urlLabel} />
	{/each}
	<p class="note">{LAN_TEXTS.urlHint}</p>
{/if}

{#if !lan.ready}
	<SectionMessage tone="info" title={RESTART_NEEDED.title}>
		{restartNeeded('Der Zugriff im Heimnetz ist')}
	</SectionMessage>
{:else if !lan.editable || store === null}
	<p class="note">
		Den Zugriff im Heimnetz stellt nur die App unter Windows aus ihrem Ordner app ein. Von Hand
		steht er in <code>byl-config.json</code> unter <code>network.lan</code>.
	</p>
{:else if store.state === 'idle' || store.state === 'loading'}
	<p class="note" role="status">Adressen und Firewall werden geprüft …</p>
{:else if info === null}
	{#if store.message !== null}
		<SectionMessage tone={store.state === 'error' ? 'error' : 'info'} title={store.message.title}>
			{store.message.text}
			{#snippet actions()}
				<button class="button-subtle" type="button" onclick={() => void store?.load()}>
					Erneut prüfen
				</button>
			{/snippet}
		</SectionMessage>
	{/if}
{:else}
	<div class="form" aria-busy={store.busy === 'save' ? 'true' : undefined}>
		<label class="setting" for={ids.switch}>
			<span class="setting-name">Zugriff im Heimnetz</span>
			<input
				id={ids.switch}
				type="checkbox"
				role="switch"
				checked={enabled}
				aria-describedby={ids.switchHint}
				aria-disabled={busy ? 'true' : undefined}
				onchange={toggleSwitch}
			/>
		</label>
		<p class="note" id={ids.switchHint}>
			Standard: aus. Eingeschaltet ist die App für andere Geräte im Heimnetz unter einer Adresse
			dieses Rechners erreichbar, mit demselben Port {info.port}. Gilt nach einem Neustart.
		</p>

		<fieldset class="choices" aria-describedby={addressError === '' ? undefined : ids.error}>
			<legend>Adressen dieses Rechners</legend>
			{#if choices.length === 0}
				<p class="note">
					{info.network
						? 'Keine private IPv4-Adresse gefunden. Ist der Rechner mit dem Heimnetz verbunden?'
						: 'Windows hat die Adressen nicht genannt. Bitte erneut prüfen.'}
				</p>
			{/if}
			{#each choices as choice, index (choice.address)}
				<label class="choice">
					<input
						type="checkbox"
						bind:this={choiceInputs[index]}
						checked={chosen.includes(choice.address)}
						disabled={!enabled}
						aria-describedby={`${uid}-choice-${index}`}
						onchange={(event) => toggleAddress(choice.address, event.currentTarget.checked)}
					/>
					<span class="choice-text">
						<code>{choice.address}</code>
						<span class="description" id={`${uid}-choice-${index}`}>{choice.text}</span>
					</span>
				</label>
			{/each}
			{#if addressError !== ''}
				<p class="field-error" id={ids.error}><ErrorIcon /><span>{addressError}</span></p>
			{/if}
		</fieldset>

		{#if message !== null && message.part === 'save'}
			<SectionMessage tone="error" title={message.message.title} live>
				{message.message.text}
				{#if store.invalid.length > 0}
					Abgelehnt: {store.invalid.join(', ')}.
				{/if}
			</SectionMessage>
		{/if}

		<div>
			<button
				class="button-primary"
				type="button"
				aria-disabled={busy || !changed ? 'true' : undefined}
				aria-busy={store.busy === 'save' ? 'true' : undefined}
				onclick={() => void save()}
			>
				Einstellung speichern
			</button>
		</div>
	</div>

	{#if restart}
		<SectionMessage tone="info" title={LAN_TEXTS.restartTitle} live>
			{LAN_TEXTS.restart}
			{#snippet actions()}
				<a href={resolve('/einstellungen/system')}>Zur Seite System</a>
			{/snippet}
		</SectionMessage>
	{/if}

	<h4>Windows-Firewall</h4>
	<p class="note">
		Regel „{info.firewall.rule}“: {FIREWALL_TEXTS[info.firewall.state]}
	</p>
	{#if info.firewall.blocked}
		<SectionMessage tone="warning" title={LAN_TEXTS.blockedTitle} headingLevel={4}>
			{LAN_TEXTS.blocked}
		</SectionMessage>
	{/if}
	{#if offerAdd || offerRemove}
		<div class="action" aria-busy={store.busy === 'firewall' ? 'true' : undefined}>
			<p class="note">{LAN_TEXTS.firewallRule(info.port)}</p>
			<button
				class="button-secondary"
				type="button"
				aria-haspopup="dialog"
				aria-disabled={busy ? 'true' : undefined}
				aria-busy={store.busy === 'firewall' ? 'true' : undefined}
				onclick={() => {
					if (!busy) confirming = offerAdd ? 'add' : 'remove';
				}}
			>
				{offerAdd ? 'Firewall-Regel anlegen …' : 'Firewall-Regel entfernen …'}
			</button>
		</div>
	{/if}
	{#if message !== null && message.part === 'firewall'}
		<SectionMessage tone="error" title={message.message.title} live>
			{message.message.text}
		</SectionMessage>
	{/if}
	{#if store.failed !== null && store.failed.report !== null}
		<SectionMessage tone="error" title={store.failed.report.problem} live headingLevel={4}>
			<ScriptProblemDetails report={store.failed.report} />
		</SectionMessage>
	{/if}
	{#if info.firewall.add !== ''}
		<details class="manual">
			<summary>Regel von Hand ändern (Eingabeaufforderung als Administrator)</summary>
			<CodeBlock code={info.firewall.add} label="Regel anlegen" wrap />
			<CodeBlock code={info.firewall.remove} label="Regel entfernen" wrap />
		</details>
	{/if}
	<p class="note">{LAN_TEXTS.alert}</p>

	{#each unprivate as state (state.address)}
		<SectionMessage
			tone="warning"
			title={LAN_TEXTS.profileTitle(state.address, CATEGORY_LABELS[state.category])}
			headingLevel={4}
		>
			{LAN_TEXTS.profile}
		</SectionMessage>
	{/each}
	{#each absent as state (state.address)}
		<SectionMessage tone="warning" title={LAN_TEXTS.missingTitle(state.address)} headingLevel={4}>
			{LAN_TEXTS.missing}
		</SectionMessage>
	{/each}

	<details class="manual">
		<summary>{LAN_TEXTS.fritzTitle}</summary>
		<ol class="steps">
			{#each LAN_TEXTS.fritzSteps as step, index (index)}
				<li>{step}</li>
			{/each}
		</ol>
		<p class="note">{LAN_TEXTS.fritzHint}</p>
	</details>

	{#if confirming !== null}
		<ConfirmDialog
			open
			title={confirming === 'remove'
				? LAN_TEXTS.firewallConfirmRemove
				: LAN_TEXTS.firewallConfirmAdd}
			confirmLabel={confirming === 'remove' ? 'Regel entfernen' : 'Regel anlegen'}
			busy={store.busy === 'firewall'}
			onconfirm={confirmFirewall}
			oncancel={() => (confirming = null)}
		>
			<p>{LAN_TEXTS.firewallRule(info.port)}</p>
			<p>{LAN_TEXTS.uac}</p>
		</ConfirmDialog>
	{/if}
{/if}

<style>
	.note,
	.description {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	.description {
		font-size: var(--font-size-control);
	}

	h4 {
		margin-top: 0.5rem;
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.form {
		display: grid;
		gap: 0.625rem;
		max-width: 40rem;
	}

	.setting {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		width: min(28rem, 100%);
		cursor: pointer;
	}

	.setting-name {
		font-size: var(--font-size-body);
		font-weight: 500;
	}

	.choices {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	legend {
		margin-bottom: 0.25rem;
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	.choice {
		display: flex;
		gap: 0.625rem;
		align-items: flex-start;
		cursor: pointer;
	}

	.choice-text {
		display: grid;
		gap: 0.125rem;
		min-width: 0;
		font-size: var(--font-size-body);
		overflow-wrap: anywhere;
	}

	.action {
		display: grid;
		gap: 0.375rem;
		justify-items: start;
	}

	.manual {
		display: grid;
		gap: 0.5rem;
		min-width: 0;
	}

	.manual summary {
		width: fit-content;
		font-size: var(--font-size-body);
		color: var(--color-brand-text);
		cursor: pointer;
	}

	.steps {
		display: grid;
		gap: 0.25rem;
		padding-left: 1.25rem;
		font-size: var(--font-size-body);
	}
</style>
