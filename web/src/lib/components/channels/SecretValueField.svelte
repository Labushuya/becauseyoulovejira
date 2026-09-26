<script lang="ts">
	import { normalizeValue, setxValueError, type PlaceholderInfo } from '$lib/guidance/command';
	import CodeBlock from '../guidance/CodeBlock.svelte';
	import SectionMessage from '../guidance/SectionMessage.svelte';

	// "Wert hier einsetzen" (user decision 2, ADR-0026 sections 5 and 10, plan EH-5 §3.9/§3.13):
	// folded below a command. The typed value lives only in the local state of this component: no
	// store, no binding to the outside, no web storage, no request, no console, no flag. The preview
	// masks a secret value; "Kopieren" copies the finished command, after which the value is emptied,
	// as when the fold closes or the component goes away (step or modal closed). Secret values get a
	// password field with "Anzeigen" and attributes against spell check and password managers;
	// values that are no secret (Telegram IDs) an open text field. A compact warning names the
	// clipboard history of Windows.
	let {
		label,
		template,
		placeholders,
		name,
		fixed = {},
		normalize = 'other'
	}: {
		/** Caption of the command, e.g. "Befehl für die Eingabeaufforderung". */
		label: string;
		template: string;
		placeholders: Readonly<Record<string, PlaceholderInfo>>;
		/** Placeholder this field fills. */
		name: string;
		/** Values of the other placeholders that are no secret (e.g. the name of the variable). */
		fixed?: Readonly<Record<string, string>>;
		/** Gmail app passwords lose the spaces between the groups. */
		normalize?: 'gmail' | 'other';
	} = $props();

	const uid = $props.id();
	const ids = { field: `${uid}-field`, history: `${uid}-history`, check: `${uid}-check` };

	const info = $derived(placeholders[name] ?? { label: name, secret: true });
	const secret = $derived(info.secret);

	let open = $state(false);
	let value = $state('');
	let shown = $state(false);

	const normalized = $derived(normalizeValue(normalize, value));
	const check = $derived(normalized === '' ? null : setxValueError(normalized));
	const describedBy = $derived(
		[secret ? ids.history : null, check !== null ? ids.check : null]
			.filter((id): id is string => id !== null)
			.join(' ') || undefined
	);

	function forget() {
		value = '';
		shown = false;
	}

	function ontoggle(event: Event & { currentTarget: HTMLDetailsElement }) {
		open = event.currentTarget.open;
		if (!open) forget();
	}
</script>

<details class="value-field" {open} {ontoggle}>
	<summary>Wert hier einsetzen (bleibt in diesem Browserfenster)</summary>
	<div class="body">
		<label for={ids.field}>{info.label}</label>
		<div class="row">
			<input
				id={ids.field}
				name={`${uid}-v`}
				type={secret && !shown ? 'password' : 'text'}
				autocomplete="off"
				spellcheck="false"
				autocapitalize="off"
				data-1p-ignore
				data-lpignore="true"
				data-form-type="other"
				aria-invalid={check?.level === 'error' ? 'true' : undefined}
				aria-describedby={describedBy}
				bind:value
			/>
			{#if secret}
				<button
					class="button-secondary"
					type="button"
					aria-pressed={shown}
					onclick={() => (shown = !shown)}
				>
					Anzeigen
				</button>
			{/if}
		</div>
		{#if secret}
			<div id={ids.history}>
				<SectionMessage tone="warning" compact>
					Windows merkt sich Kopiertes im Zwischenablage-Verlauf (Win+V), falls er eingeschaltet
					ist. Dort kannst du den Eintrag danach löschen.
				</SectionMessage>
			</div>
		{/if}
		{#if check !== null}
			<div id={ids.check}>
				<SectionMessage tone={check.level === 'error' ? 'error' : 'warning'} compact live>
					{check.message}
				</SectionMessage>
			</div>
		{/if}
		{#if normalized !== '' && check?.level !== 'error'}
			<CodeBlock
				label={`${label} mit deinem Wert`}
				code={template}
				{placeholders}
				values={{ ...fixed, [name]: normalized }}
				oncopied={forget}
			/>
		{/if}
	</div>
</details>

<style>
	.value-field {
		font-size: 0.875rem;
	}

	summary {
		color: var(--color-brand-text);
		cursor: pointer;
	}

	.body {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.5rem;
		min-width: 0;
	}

	label {
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	input {
		flex: 1;
		min-width: 0;
		max-width: 100%;
		padding: 0.375rem 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.8125rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.button-secondary[aria-pressed='true'] {
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
	}
</style>
