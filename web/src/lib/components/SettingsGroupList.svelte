<script lang="ts">
	import { DEFAULT_HOST_PLATFORM } from '$lib/domain/host-platform';
	import { OPEN_SETUP_TEXTS } from '$lib/domain/open-setups';
	import { CONTEXT_TEXTS } from '$lib/guidance/texts';
	import { groupSettingsSections, visibleSettingsSections } from '$lib/settings-sections';
	import { appContext } from '$lib/stores/context.svelte';
	import { findHostStore } from '$lib/stores/host.svelte';
	import { findOpenSetupsStore } from '$lib/stores/open-setups.svelte';

	// The pages of the settings in their groups for this tab (EU-1, ADR-0078), shared by the overview
	// /einstellungen and the sheet "Mehr" of the phone frame, so both list the same pages with the
	// same marks as the navigation of the settings: the pages of the server (no "Sicherung" and
	// "System" without Windows), those of the administrator after the context of the tab (KOB-1,
	// ADR-0057: "nur am PC" once at the heading of the group and in the name of each link on another
	// device, not there at all for every other account and while the context loads) and the number
	// of the open setups at "Kanäle" (KE-1, ADR-0076). Each group is a list named by its label; the
	// rows are targets of the phone frame. The component renders the labels and lists side by side
	// without a wrapper, so they are items of the grid of the caller. For the overview the labels are
	// headings, each row adds the sentence of its page (named by the row, described by the sentence)
	// and the help stands after a line.
	let {
		current = null,
		overview = false,
		onfollow
	}: {
		/** ID of the page shown, marked with aria-current; null for none. */
		current?: string | null;
		/** The look of the overview: headings, the sentence of each page, the help after a line. */
		overview?: boolean;
		/** A link was followed (the sheet closes). */
		onfollow?: () => void;
	} = $props();

	const uid = $props.id();
	const host = findHostStore();
	const openSetups = findOpenSetupsStore();
	const openSetupCount = $derived(openSetups?.count ?? 0);
	const groups = $derived(
		groupSettingsSections(
			visibleSettingsSections(
				host?.platform ?? DEFAULT_HOST_PLATFORM,
				appContext.capabilities.adminPages
			)
		)
	);
</script>

{#each groups as group (group.id)}
	{#if group.label !== null}
		<svelte:element
			this={overview ? 'h3' : 'p'}
			class="label"
			class:heading={overview}
			id={`${uid}-${group.id}`}
		>
			{group.label}
			{#if group.pcOnly}
				<span class="mark">{CONTEXT_TEXTS.pcOnlyMark}</span>
			{/if}
		</svelte:element>
	{/if}
	<ul
		class:described={overview}
		class:after-line={overview && group.label === null}
		aria-labelledby={group.label === null ? undefined : `${uid}-${group.id}`}
	>
		{#each group.sections as section (section.id)}
			<li>
				<a
					href={section.href}
					aria-current={section.id === current ? 'page' : undefined}
					aria-labelledby={overview ? `${uid}-${section.id}-name` : undefined}
					aria-describedby={overview ? `${uid}-${section.id}-text` : undefined}
					onclick={() => onfollow?.()}
				>
					<span class="head" id={overview ? `${uid}-${section.id}-name` : undefined}>
						<span class="name">{section.label}</span>
						{#if section.pcOnly}
							<span class="visually-hidden">{CONTEXT_TEXTS.pcOnlyMark}</span>
						{/if}
						{#if section.id === 'kanaele' && openSetupCount > 0}
							<span class="count"
								><span aria-hidden="true">{openSetupCount}</span><span class="visually-hidden"
									>({OPEN_SETUP_TEXTS.count(openSetupCount)})</span
								></span
							>
						{/if}
					</span>
					{#if overview}
						<span class="description" id={`${uid}-${section.id}-text`}>{section.description}</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
{/each}

<style>
	/* The labels of the groups: quiet, like those of the settings navigation. */
	.label {
		margin-top: 0.5rem;
		font-size: var(--font-size-caption);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	/* In the overview the labels are the headings of the page, a step larger. */
	.label.heading {
		font-size: var(--font-size-control);
	}

	/* "nur am PC": quiet, after the name of the group, never instead of it. */
	.mark {
		margin-left: 0.5rem;
		font-weight: 400;
	}

	ul {
		display: grid;
		gap: 0.125rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* The help without a heading of its own, after a line (as in the navigation). */
	ul.after-line {
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-separator);
	}

	/* One row per page, as high as the target of the phone frame. */
	a {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		min-height: var(--phone-target);
		padding: 0 0.75rem;
		font-size: var(--font-size-body);
		color: var(--color-text);
		text-decoration: none;
		border-radius: var(--radius-control);
	}

	a:hover {
		background: var(--fill-control-hover);
	}

	/* The page shown: surface and weight, never colour alone. */
	a[aria-current='page'] {
		font-weight: 600;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
	}

	/* The overview: the name above its sentence; long texts wrap, nothing scrolls sideways. */
	.described a {
		flex-direction: column;
		gap: 0.125rem;
		align-items: stretch;
		justify-content: center;
		padding: 0.5rem 0.75rem;
	}

	.head {
		display: flex;
		flex: 1 1 auto;
		gap: 0.75rem;
		align-items: center;
		min-width: 0;
	}

	.described .head {
		flex: none;
	}

	.described .name {
		font-weight: 500;
	}

	.name,
	.description {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.description {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	/* The number of the open setups, like the counts of the views in "Mehr". */
	.count {
		min-width: 1.25rem;
		margin-left: auto;
		padding: 0 0.3125rem;
		font-size: var(--font-size-caption);
		font-weight: 600;
		line-height: 1.125rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border: 1px solid var(--color-brand);
		border-radius: var(--radius-pill);
	}
</style>
