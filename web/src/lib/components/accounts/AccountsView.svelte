<script lang="ts">
	import { tick } from 'svelte';
	import ActionsMenu, { type MenuAction } from '$lib/components/ActionsMenu.svelte';
	import Field from '$lib/components/form/Field.svelte';
	import CodeBlock from '$lib/components/guidance/CodeBlock.svelte';
	import Lozenge from '$lib/components/guidance/Lozenge.svelte';
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import ConfirmDialog from '$lib/components/overlay/ConfirmDialog.svelte';
	import {
		ACCOUNTS_TEXTS,
		accountLabel,
		type Account,
		type OrphanHousehold,
		type OrphanMember
	} from '$lib/domain/accounts';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import { helpHref } from '$lib/settings-sections';
	import type { AccountsStore } from '$lib/stores/accounts.svelte';
	import AccountCreateForm from './AccountCreateForm.svelte';
	import HouseholdDeleteDialog from './HouseholdDeleteDialog.svelte';

	// Page "Einstellungen → Konten verwalten" (ADR-0056 §3): every account of the app with name, e-mail, the
	// right "Verwalter der App", the switch "deaktiviert" and its creation; "Konto anlegen" with a
	// start password and per account in the menu "•••" a new password, disabling or enabling and
	// giving or taking the right. Every change that ends sessions or changes the right asks first (a
	// confirmation, no red, ADR-0009); "Aktivieren" undoes a disabling and runs at once, with a flag.
	// A password stands only once on the page, in a code block with
	// "Kopieren", until "Weitergegeben" removes it. The own account has no menu: it changes its
	// password and name on "Mein Konto". No deleting of accounts (plan e7-haushalt, follow-up).
	// Since E7-4 (ADR-0061 §6) an account that owns a household says so, disabling it says what that
	// means for the household, and "Haushalte ohne aktiven Inhaber" lets the administrator make an
	// active member the owner of a household whose owner is disabled or gone. Since E7-4c a household
	// in which no member has an account any more (orphaned) offers only "Haushalt löschen …" with a
	// preview and the typed name; it never goes into an account.
	let { store }: { store: AccountsStore } = $props();

	type Question =
		| { kind: 'password' | 'disable' | 'grant' | 'revoke'; account: Account }
		| { kind: 'owner'; household: OrphanHousehold; member: OrphanMember };

	const uid = $props.id();
	const listId = `${uid}-list`;
	const orphansId = `${uid}-orphans`;
	let asking = $state<Question | null>(null);
	let listHeading = $state<HTMLElement>();
	let passwordHeading = $state<HTMLElement>();
	/** The chosen new owner per household (ID of the membership). */
	let chosen = $state<Record<string, string>>({});
	/** The orphaned household whose dialog "Haushalt löschen" is open. */
	let deleting = $state.raw<OrphanHousehold | null>(null);

	const busyId = $derived(
		store.busy !== null && 'accountId' in store.busy ? store.busy.accountId : null
	);
	const busyHousehold = $derived(
		store.busy !== null && 'householdId' in store.busy ? store.busy.householdId : null
	);

	/** The active members of a household that can become its owner. */
	function candidates(household: OrphanHousehold): OrphanMember[] {
		return household.members.filter((member) => !member.disabled);
	}

	function choiceOf(household: OrphanHousehold): OrphanMember | null {
		const options = candidates(household);
		return options.find((member) => member.id === chosen[household.id]) ?? options[0] ?? null;
	}

	const memberName = (member: OrphanMember) =>
		member.name.trim() === '' ? 'Konto ohne Namen' : member.name;

	function itemsOf(account: Account): MenuAction[] {
		const locked = store.busy !== null;
		const busy = busyId === account.id;
		return [
			{
				label: 'Passwort zurücksetzen …',
				dialog: true,
				locked: locked && !busy,
				busy: busy && store.busy?.kind === 'password',
				onselect: () => (asking = { kind: 'password', account })
			},
			account.disabled
				? {
						label: 'Aktivieren',
						locked: locked && !busy,
						busy: busy && store.busy?.kind === 'disable',
						onselect: () => void store.setDisabled(account, false)
					}
				: {
						label: 'Deaktivieren …',
						dialog: true,
						locked: locked && !busy,
						busy: busy && store.busy?.kind === 'disable',
						onselect: () => (asking = { kind: 'disable', account })
					},
			{
				label: account.admin ? 'Verwalter-Recht entziehen …' : 'Zum Verwalter machen …',
				dialog: true,
				separated: true,
				locked: locked && !busy,
				busy: busy && store.busy?.kind === 'admin',
				onselect: () => (asking = { kind: account.admin ? 'revoke' : 'grant', account })
			}
		];
	}

	const question = $derived.by(() => {
		if (asking === null) return null;
		if (asking.kind === 'owner') {
			return {
				title: ACCOUNTS_TEXTS.newOwnerQuestion(memberName(asking.member), asking.household.name),
				text: ACCOUNTS_TEXTS.newOwnerText,
				confirm: 'Zum Inhaber machen'
			};
		}
		const label = accountLabel(asking.account);
		switch (asking.kind) {
			case 'password':
				return {
					title: ACCOUNTS_TEXTS.resetQuestion(label),
					text: ACCOUNTS_TEXTS.resetText,
					confirm: 'Neues Passwort erzeugen'
				};
			case 'disable':
				return {
					title: ACCOUNTS_TEXTS.disableQuestion(label),
					text:
						asking.account.owns === undefined
							? ACCOUNTS_TEXTS.disableText
							: `${ACCOUNTS_TEXTS.disableText} ${ACCOUNTS_TEXTS.disableOwnerText(asking.account.owns.name)}`,
					confirm: 'Deaktivieren'
				};
			case 'grant':
				return {
					title: ACCOUNTS_TEXTS.grantQuestion(label),
					text: ACCOUNTS_TEXTS.grantText,
					confirm: 'Zum Verwalter machen'
				};
			default:
				return {
					title: ACCOUNTS_TEXTS.revokeQuestion(label),
					text: ACCOUNTS_TEXTS.revokeText,
					confirm: 'Recht entziehen'
				};
		}
	});

	async function confirmed() {
		const current = asking;
		asking = null;
		if (current === null) return;
		if (current.kind === 'owner') {
			await store.setHouseholdOwner(current.household, current.member);
		} else if (current.kind === 'password') {
			if (await store.resetPassword(current.account)) await showPassword();
		} else if (current.kind === 'disable') {
			await store.setDisabled(current.account, true);
		} else {
			await store.setAdmin(current.account, current.kind === 'grant');
		}
	}

	/** The password appears above the list; the focus goes to its heading so it is read out. */
	async function showPassword() {
		await tick();
		passwordHeading?.focus();
	}

	function handedOver() {
		store.dismissPassword();
		listHeading?.focus();
	}
</script>

{#if store.state === 'idle' || store.state === 'loading'}
	<p class="note" role="status">Konten werden geladen …</p>
{:else if store.state !== 'ready'}
	{#if store.message !== null}
		<SectionMessage tone={store.state === 'error' ? 'error' : 'info'} title={store.message.title}>
			{store.message.text}
		</SectionMessage>
	{/if}
{:else}
	<p class="intro">
		Jede Person meldet sich mit einem eigenen Konto an. Neue Konten legst du hier an; die Person
		ändert ihr Startpasswort danach unter „Einstellungen → Mein Konto“.
		<a href={helpHref('konten')}>Mehr zu Konten und Verwaltern</a>
	</p>

	{#if store.shownPassword !== null}
		{@const shown = store.shownPassword}
		{@const label = accountLabel(shown.account)}
		<div class="password" aria-live="polite">
			<h3 tabindex="-1" bind:this={passwordHeading}>
				{shown.kind === 'created'
					? ACCOUNTS_TEXTS.createdTitle(label)
					: ACCOUNTS_TEXTS.resetTitle(label)}
			</h3>
			<p>Anmelden mit <strong>{shown.account.email}</strong> und diesem Passwort:</p>
			<CodeBlock code={shown.password} label={ACCOUNTS_TEXTS.passwordLabel(label)} />
			<p class="note">{ACCOUNTS_TEXTS.passwordOnce}</p>
			<div>
				<button class="button-secondary" type="button" onclick={handedOver}>Weitergegeben</button>
			</div>
		</div>
	{/if}

	<section class="part" aria-labelledby={listId}>
		<h3 id={listId} tabindex="-1" bind:this={listHeading}>Konten</h3>
		{#if store.actionMessage !== null}
			<SectionMessage tone="error" title={store.actionMessage.title} live>
				{store.actionMessage.text}
			</SectionMessage>
		{/if}
		<ul class="accounts">
			{#each store.accounts as account (account.id)}
				{@const label = accountLabel(account)}
				<li class="account" aria-busy={busyId === account.id ? 'true' : undefined}>
					<div class="who">
						<span class="name">{label}</span>
						{#if account.self}<span class="self">(du)</span>{/if}
						{#if account.name.trim() !== ''}<span class="email">{account.email}</span>{/if}
					</div>
					<div class="facts">
						{#if account.admin}
							<Lozenge label="Verwalter der App" icon="check" tone="brand" />
						{/if}
						{#if account.disabled}
							<Lozenge label="Deaktiviert" icon="pause" tone="muted" />
						{/if}
						{#if account.owns}
							<span class="created">{ACCOUNTS_TEXTS.ownerOf(account.owns.name)}</span>
						{/if}
						{#if account.created !== ''}
							<span class="created">angelegt am {formatBerlinDateTime(account.created)}</span>
						{/if}
					</div>
					<div class="actions">
						{#if account.self}
							<span class="note">Dein Konto änderst du unter „Mein Konto“.</span>
						{:else}
							<ActionsMenu
								label={`Aktionen für ${label}`}
								buttonLabel={`Weitere Aktionen für ${label}`}
								items={itemsOf(account)}
							/>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</section>

	{#if store.households.length > 0}
		<section class="part" aria-labelledby={orphansId}>
			<h3 id={orphansId}>{ACCOUNTS_TEXTS.orphansTitle}</h3>
			<p class="note">{ACCOUNTS_TEXTS.orphansText}</p>
			<ul class="accounts">
				{#each store.households as household (household.id)}
					{@const options = candidates(household)}
					{@const choice = choiceOf(household)}
					<li class="account" aria-busy={busyHousehold === household.id ? 'true' : undefined}>
						<div class="who">
							<span class="name">{household.name}</span>
							<span class="email">{ACCOUNTS_TEXTS.orphanOwner(household.owner?.name ?? null)}</span>
						</div>
						{#if household.orphaned}
							<p class="note">{ACCOUNTS_TEXTS.orphanedNote}</p>
							<div class="actions">
								<button
									class="button-secondary"
									type="button"
									aria-haspopup="dialog"
									aria-disabled={store.busy !== null}
									aria-busy={busyHousehold === household.id ? 'true' : undefined}
									onclick={() => {
										if (store.busy !== null) return;
										deleting = household;
									}}
								>
									{ACCOUNTS_TEXTS.deleteButton}
								</button>
							</div>
						{:else if options.length === 0}
							<p class="note">{ACCOUNTS_TEXTS.noMembers}</p>
						{:else}
							<div class="owner-choice">
								<Field label={ACCOUNTS_TEXTS.newOwnerLabel} width="auto">
									{#snippet control(field)}
										<select
											{...field}
											value={choice?.id ?? ''}
											onchange={(event) =>
												(chosen = { ...chosen, [household.id]: event.currentTarget.value })}
										>
											{#each options as member (member.id)}
												<option value={member.id}>{memberName(member)}</option>
											{/each}
										</select>
									{/snippet}
								</Field>
								<button
									class="button-secondary"
									type="button"
									aria-haspopup="dialog"
									aria-disabled={store.busy !== null}
									aria-busy={busyHousehold === household.id ? 'true' : undefined}
									onclick={() => {
										if (store.busy !== null || choice === null) return;
										asking = { kind: 'owner', household, member: choice };
									}}
								>
									{ACCOUNTS_TEXTS.newOwnerButton}
								</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="part" aria-labelledby={`${uid}-create`}>
		<h3 id={`${uid}-create`}>Konto anlegen</h3>
		<AccountCreateForm {store} oncreated={showPassword} />
	</section>
{/if}

{#if deleting !== null}
	<HouseholdDeleteDialog {store} household={deleting} onclose={() => (deleting = null)} />
{/if}

<ConfirmDialog
	open={asking !== null}
	title={question?.title ?? ''}
	confirmLabel={question?.confirm ?? ''}
	onconfirm={() => void confirmed()}
	oncancel={() => (asking = null)}
>
	<p>{question?.text ?? ''}</p>
</ConfirmDialog>

<style>
	.intro,
	.note {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	.part {
		display: grid;
		gap: 0.625rem;
		margin-top: 1rem;
	}

	h3 {
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	h3:focus {
		outline: none;
	}

	h3:focus-visible {
		outline: 2px solid var(--color-brand-text);
		outline-offset: 2px;
	}

	.password {
		display: grid;
		gap: 0.5rem;
		padding: 0.875rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.password p {
		font-size: var(--font-size-body);
	}

	.accounts {
		display: grid;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--color-line);
	}

	.account {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem 1rem;
		align-items: center;
		padding: 0.5rem 0;
		font-size: var(--font-size-body);
		border-bottom: 1px solid var(--color-line);
	}

	.who {
		display: flex;
		flex: 1 1 16rem;
		flex-wrap: wrap;
		gap: 0.125rem 0.5rem;
		align-items: baseline;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.name {
		font-weight: 600;
	}

	.self,
	.email,
	.created {
		color: var(--color-text-muted);
	}

	.facts {
		display: flex;
		flex: 1 1 14rem;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: center;
	}

	.actions {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
	}

	/* The field with its label above, the button beside the select. */
	.owner-choice {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem 0.5rem;
		align-items: end;
	}
</style>
