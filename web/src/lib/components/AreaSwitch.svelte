<script lang="ts">
	// Area switch (CLAUDE.md section 7, E2 plan P-5): "Privat" is the only active area. "Haushalt"
	// stays focusable so screen reader and keyboard users find it and its "Demnächst" note, but it
	// does nothing (aria-disabled instead of disabled). The note is a small lozenge inside the
	// greyed "Haushalt" button, so it never reads as a third entry of the switch; the name of the
	// button stays "Haushalt", the lozenge is its description.
	const uid = $props.id();
	const hintId = `${uid}-household-hint`;
</script>

<div class="area-switch" role="group" aria-label="Bereich">
	<button class="option active" type="button" aria-pressed="true">Privat</button>
	<button
		class="option"
		type="button"
		aria-label="Haushalt"
		aria-disabled="true"
		aria-describedby={hintId}
	>
		<span>Haushalt</span>
		<span class="soon" id={hintId}>Demnächst</span>
	</button>
</div>

<style>
	.area-switch {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem;
		font-size: 0.875rem;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.option {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		padding: 0.25rem 0.625rem;
		background: none;
		border: none;
		border-radius: var(--radius-control);
	}

	.active {
		font-weight: 500;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		cursor: default;
	}

	.option[aria-disabled='true'] {
		color: var(--color-text-muted);
		cursor: not-allowed;
	}

	/* Lozenge: small, muted, outlined, no signal colour (ADR-0009, ADR-0010 section 3). */
	.soon {
		padding: 0 0.375rem;
		font-size: 0.6875rem;
		font-weight: 500;
		line-height: 1.125rem;
		color: var(--color-text-muted);
		white-space: nowrap;
		background: var(--color-bg);
		border: 1px solid var(--color-line);
		border-radius: 999px;
	}
</style>
