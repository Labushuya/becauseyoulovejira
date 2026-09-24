<script lang="ts">
	// Area switch (CLAUDE.md section 7, E2 plan P-5): "Privat" is the only active area. "Haushalt"
	// stays focusable so screen reader and keyboard users find it and its "Demnächst" note, but it
	// does nothing (aria-disabled instead of disabled).
	const uid = $props.id();
	const hintId = `${uid}-household-hint`;
</script>

<div class="area-switch" role="group" aria-label="Bereich">
	<button class="option active" type="button" aria-pressed="true">Privat</button>
	<button class="option" type="button" aria-disabled="true" aria-describedby={hintId}>
		Haushalt
	</button>
	<span class="hint" id={hintId}>Demnächst</span>
</div>

<style>
	.area-switch {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem;
		font-size: 0.875rem;
		border: 1px solid var(--color-line);
		border-radius: 0.5rem;
	}

	.option {
		padding: 0.25rem 0.625rem;
		background: none;
		border: none;
		border-radius: 0.375rem;
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

	.hint {
		padding-right: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
</style>
