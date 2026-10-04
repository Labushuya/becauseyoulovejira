<script lang="ts">
	import { tick } from 'svelte';
	import CodeBlock from '$lib/components/guidance/CodeBlock.svelte';
	import Lozenge from '$lib/components/guidance/Lozenge.svelte';
	import type { GuidanceIconName } from '$lib/components/guidance/GuidanceIcon.svelte';
	import {
		HOUSEHOLD_TEXTS,
		INVITE_STATUS_LABELS,
		OPEN_INVITES_MAX,
		type HouseholdInvite,
		type InviteStatus
	} from '$lib/domain/household';
	import { formatBerlinDateTime } from '$lib/domain/format';
	import type { HouseholdStore } from '$lib/stores/household.svelte';

	// Invitation codes (ADR-0058 §2), only with the right "invite": "Neuen Code erzeugen" shows the
	// code once as a code block with "Kopieren" until "Weitergegeben" removes it; afterwards the list
	// names only status and times. Open codes can be revoked at any time.
	let { store, invites }: { store: HouseholdStore; invites: readonly HouseholdInvite[] } = $props();

	const uid = $props.id();
	let codeHeading = $state<HTMLElement>();
	let createButton = $state<HTMLElement>();

	const STATUS_ICONS: Readonly<Record<InviteStatus, GuidanceIconName>> = {
		open: 'pending',
		used: 'check',
		revoked: 'pause',
		expired: 'clock'
	};
	const open = $derived(invites.filter((invite) => invite.status === 'open').length);
	const creating = $derived(store.busy?.kind === 'invite');

	function time(value: string): string {
		try {
			return formatBerlinDateTime(value);
		} catch {
			return '';
		}
	}

	function detail(invite: HouseholdInvite): string {
		switch (invite.status) {
			case 'open':
				return `gültig bis ${time(invite.expires)}`;
			case 'used':
				return `benutzt am ${time(invite.ended)}${invite.usedBy === '' ? '' : ` von ${invite.usedBy}`}`;
			case 'revoked':
				return `widerrufen am ${time(invite.ended)}`;
			default:
				return `abgelaufen am ${time(invite.ended)}`;
		}
	}

	async function create() {
		if (store.busy !== null) return;
		if (await store.createInvite()) {
			await tick();
			codeHeading?.focus();
		}
	}

	function handedOn() {
		store.dismissCode();
		createButton?.focus();
	}
</script>

<section class="part" aria-labelledby={`${uid}-title`}>
	<h3 id={`${uid}-title`}>Einladungscodes</h3>
	<p class="note">
		Mit einem Code tritt eine Person dem Haushalt bei. Ein Code gilt 7 Tage und einmal; höchstens
		{OPEN_INVITES_MAX} sind zugleich offen.
	</p>

	{#if store.shownCode !== null}
		{@const shown = store.shownCode}
		<div class="code" aria-live="polite">
			<h4 tabindex="-1" bind:this={codeHeading}>{HOUSEHOLD_TEXTS.codeTitle}</h4>
			<CodeBlock code={shown.code} label="Einladungscode" />
			{#if shown.invite !== null}
				<p class="note">Gültig bis {time(shown.invite.expires)}.</p>
			{/if}
			<p class="note">{HOUSEHOLD_TEXTS.codeOnce}</p>
			<div>
				<button class="button-secondary" type="button" onclick={handedOn}>Weitergegeben</button>
			</div>
		</div>
	{/if}

	{#if open < OPEN_INVITES_MAX}
		<div>
			<button
				class="button-primary"
				type="button"
				bind:this={createButton}
				onclick={() => void create()}
				aria-disabled={store.busy !== null ? 'true' : undefined}
				aria-busy={creating ? 'true' : undefined}
			>
				Neuen Code erzeugen
			</button>
		</div>
	{:else}
		<p class="note">{`Es sind schon ${OPEN_INVITES_MAX} Codes offen. Widerrufe zuerst einen.`}</p>
	{/if}

	{#if invites.length > 0}
		<ul class="invites">
			{#each invites as invite (invite.id)}
				{@const revoking = store.busy?.kind === 'revoke' && store.busy.inviteId === invite.id}
				<li class="invite" aria-busy={revoking ? 'true' : undefined}>
					<Lozenge
						label={INVITE_STATUS_LABELS[invite.status]}
						icon={STATUS_ICONS[invite.status]}
						tone={invite.status === 'open' ? 'brand' : 'muted'}
					/>
					<span class="detail">{detail(invite)}</span>
					<span class="created">
						erzeugt am {time(invite.created)}{invite.createdBy === ''
							? ''
							: ` von ${invite.createdBy}`}
					</span>
					{#if invite.status === 'open'}
						<button
							class="button-subtle"
							type="button"
							onclick={() => void store.revoke(invite)}
							aria-disabled={store.busy !== null ? 'true' : undefined}
							aria-busy={revoking ? 'true' : undefined}
						>
							Widerrufen
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.part {
		display: grid;
		gap: 0.625rem;
	}

	h3 {
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	h4 {
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	h4:focus {
		outline: none;
	}

	h4:focus-visible {
		outline: 2px solid var(--color-brand-text);
		outline-offset: 2px;
	}

	.note,
	.created {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	.code {
		display: grid;
		gap: 0.5rem;
		padding: 0.875rem 1rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.invites {
		display: grid;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--color-line);
	}

	.invite {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem 1rem;
		align-items: center;
		padding: 0.5rem 0;
		font-size: var(--font-size-body);
		border-bottom: 1px solid var(--color-line);
	}

	.detail {
		flex: 1 1 12rem;
		min-width: 0;
	}

	.created {
		flex: 1 1 14rem;
		min-width: 0;
	}
</style>
