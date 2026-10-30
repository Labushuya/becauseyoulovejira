// The polite region of the repository picker (ADR-0050; MO-7a, rest of the second reading of OF-4b):
// "1 gewählt · 2 von 3" stands in a live region that stays in the tree while it is empty, only
// visually empty like `visually-hidden`, never `display: none`. A live region that appears with its
// words is often not read (the rule of OF-4b round 2, K-8, for the comment form and the charm dialog).

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { GitHubRepoChoice } from '$lib/domain/github';
import GitHubRepoPicker from './GitHubRepoPicker.svelte';
import source from './GitHubRepoPicker.svelte?raw';

function choice(repo: string): GitHubRepoChoice {
	return {
		repo,
		key: repo.toLowerCase(),
		private: false,
		archived: false,
		fork: false,
		org: false,
		own: true,
		state: ''
	};
}

const REPOS = ['anna/haus', 'anna/garten', 'anna/auto'].map(choice);

/** The CSS rule of `.count:empty` in the style of the picker, '' without one. */
function emptyRule(): string {
	const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1] ?? '';
	return /\.count:empty\s*\{([^}]*)\}/.exec(style)?.[1] ?? '';
}

describe('repository picker: the count (MO-7a)', () => {
	it('keeps the live region of the count in the tree while it is empty, only visually empty', async () => {
		render(GitHubRepoPicker, {
			props: {
				list: {
					kind: 'ready',
					list: { status: 'ok', message: '', login: 'anna', at: null, more: false, repos: REPOS }
				}
			}
		});
		const region = document.querySelector<HTMLElement>('.count[aria-live="polite"]');
		expect(region).not.toBeNull();
		expect(region?.textContent).toBe('');
		await fireEvent.click(screen.getByRole('checkbox', { name: /anna\/garten/ }));
		expect(region?.isConnected).toBe(true);
		expect(region?.textContent).toBe('1 gewählt');

		const rule = emptyRule();
		expect(rule).not.toMatch(/display:\s*none/);
		expect(rule).toMatch(/position:\s*absolute/);
		expect(rule).toMatch(/clip-path:\s*inset\(50%\)/);
	});
});
