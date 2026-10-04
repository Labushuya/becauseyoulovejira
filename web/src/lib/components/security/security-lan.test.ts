// Access in the home network on the page "Sicherheit" (plan heimnetz): the warning that it goes
// unencrypted, the address for other devices with "Kopieren", the switch with the addresses of this
// computer (checked at the field, saved after a click, a restart named), the firewall rule only
// after a confirmation that names the prompt of Windows, a declined change with what to do by hand,
// the network category and the address in the FRITZ!Box. Real SecurityLanStore on a fake data layer.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { parseLanInfo, type LanInfo } from '$lib/domain/lan';
import { parseSecurity, type SecurityOverview } from '$lib/domain/security';
import { RESTART_NEEDED } from '$lib/guidance/texts';
import type { FlagInput } from '$lib/stores/flags.svelte';
import { SecurityLanStore, type SecurityLanData } from '$lib/stores/security-lan.svelte';
import { danglingReferences, duplicateIds } from '$lib/test/aria-ids';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { securityAnswer } from '$lib/test/security-answer';
import SecurityLan from './SecurityLan.svelte';

useOverlayStubs();

const ADD =
	'netsh advfirewall firewall add rule name="becauseyoulovejira (Heimnetz)" dir=in action=allow protocol=TCP localport=8090 program="C:\\Apps\\app\\pocketbase.exe" profile=private';
const REMOVE =
	'netsh advfirewall firewall delete rule name="becauseyoulovejira (Heimnetz)" program="C:\\Apps\\app\\pocketbase.exe"';

function infoOf(overrides: Record<string, unknown> = {}): LanInfo {
	const parsed = parseLanInfo({
		lan: {
			port: 8090,
			enabled: false,
			addresses: [],
			max: 5,
			network: true,
			candidates: [
				{ address: '192.168.178.20', kind: 'ip', adapter: 'Ethernet', category: 'private' },
				{ address: 'tower2.fritz.box', kind: 'name', adapter: 'Ethernet', category: 'private' }
			],
			states: [],
			firewall: { state: 'missing', blocked: false, add: ADD, remove: REMOVE },
			...overrides
		}
	});
	if (parsed === null) throw new Error('not an answer');
	return parsed;
}

/** The overview with the home network `lan`; null: a server before the restart after the update. */
function overviewOf(
	lan: Record<string, unknown> | null = { active: false, hosts: [], editable: true }
): SecurityOverview {
	const answer = securityAnswer({ lan });
	if (lan === null) delete answer.lan;
	const overview = parseSecurity(answer);
	if (overview === null) throw new Error('not an overview');
	return overview;
}

async function show(
	options: {
		info?: LanInfo;
		overview?: SecurityOverview;
		data?: Partial<SecurityLanData>;
		store?: boolean;
	} = {}
) {
	let current = options.info ?? infoOf();
	const data: SecurityLanData = {
		info: vi.fn(async () => ({ kind: 'ok' as const, value: current })),
		save: vi.fn(async (setting: { enabled: boolean; addresses: readonly string[] }) => {
			current = { ...current, enabled: setting.enabled, addresses: setting.addresses };
			return { kind: 'ok' as const, value: current };
		}),
		firewall: vi.fn(async (action: 'add' | 'remove') => {
			current = {
				...current,
				firewall: {
					...current.firewall,
					state: action === 'add' ? ('present' as const) : ('missing' as const)
				}
			};
			return {
				kind: 'ok' as const,
				value: {
					result: { ok: true, action, outcome: 'done' as const, report: null },
					lan: current
				}
			};
		}),
		...options.data
	};
	const flags = { show: vi.fn((input: FlagInput) => `flag-${input.title}`), dismiss: vi.fn() };
	const store = new SecurityLanStore(data, { ensureValid: () => true, logout: vi.fn() }, flags);
	await store.load();
	render(SecurityLan, {
		props: {
			overview: options.overview ?? overviewOf(),
			store: options.store === false ? null : store
		}
	});
	await tick();
	return { store, data, flags };
}

describe('access in the home network', () => {
	it('warns that it goes unencrypted, offers the addresses of this computer and is off by default', async () => {
		await show();
		expect(screen.getByRole('heading', { name: /Unverschlüsselt im Heimnetz/ })).toBeTruthy();
		expect(
			screen.getByText(/Passwörter und Inhalte gehen unverschlüsselt durchs WLAN/)
		).toBeTruthy();
		const toggle = screen.getByRole('switch', { name: 'Zugriff im Heimnetz' }) as HTMLInputElement;
		expect(toggle.checked).toBe(false);
		const group = screen.getByRole('group', { name: 'Adressen dieses Rechners' });
		const boxes = within(group).getAllByRole('checkbox') as HTMLInputElement[];
		expect(boxes).toHaveLength(2);
		expect(boxes.every((box) => box.disabled && !box.checked)).toBe(true);
		expect(
			within(group).getByText('Name in der FRITZ!Box · Ethernet · Netzwerk Privat')
		).toBeTruthy();
		// No address for other devices while it is off, no red anywhere.
		expect(screen.queryByText('Adresse für andere Geräte')).toBeNull();
		expect(document.body.querySelector('[data-tone="error"]')).toBeNull();
		expect(
			screen.getByRole('button', { name: 'Einstellung speichern' }).getAttribute('aria-disabled')
		).toBe('true');
		expect(duplicateIds()).toEqual([]);
		expect(danglingReferences(document.body)).toEqual([]);
	});

	it('switches on with the first address, saves after a click and names the restart', async () => {
		const { data, flags } = await show();
		await fireEvent.click(screen.getByRole('switch', { name: 'Zugriff im Heimnetz' }));
		const group = screen.getByRole('group', { name: 'Adressen dieses Rechners' });
		const [ip, name] = within(group).getAllByRole('checkbox') as HTMLInputElement[];
		expect(ip!.checked).toBe(true);
		expect(name!.checked).toBe(false);
		await fireEvent.click(name!);
		await fireEvent.click(screen.getByRole('button', { name: 'Einstellung speichern' }));
		await vi.waitFor(() =>
			expect(data.save).toHaveBeenCalledWith(
				{ enabled: true, addresses: ['192.168.178.20', 'tower2.fritz.box'] },
				expect.anything()
			)
		);
		expect(flags.show).toHaveBeenCalledWith(
			expect.objectContaining({ tone: 'success', title: 'Zugriff im Heimnetz eingeschaltet' })
		);
		await tick();
		expect(screen.getByText('Neustart nötig')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Zur Seite System' }).getAttribute('href')).toBe(
			'/einstellungen/system'
		);
		// Now the rule is missing: the page offers it.
		expect(screen.getByRole('button', { name: 'Firewall-Regel anlegen …' })).toBeTruthy();
	});

	it('asks for an address at the field before it saves', async () => {
		const { data } = await show();
		await fireEvent.click(screen.getByRole('switch', { name: 'Zugriff im Heimnetz' }));
		const group = screen.getByRole('group', { name: 'Adressen dieses Rechners' });
		const [ip] = within(group).getAllByRole('checkbox') as HTMLInputElement[];
		await fireEvent.click(ip!);
		await fireEvent.click(screen.getByRole('button', { name: 'Einstellung speichern' }));
		expect(screen.getByText('Bitte mindestens eine Adresse wählen.')).toBeTruthy();
		expect(group.getAttribute('aria-describedby')).toBeTruthy();
		expect(document.activeElement).toBe(ip);
		expect(data.save).not.toHaveBeenCalled();
	});

	it('creates the firewall rule only after a confirmation that names the prompt of Windows', async () => {
		const { data, flags } = await show({
			info: infoOf({ enabled: true, addresses: ['192.168.178.20'] })
		});
		expect(
			screen.getByText(/Fehlt: Die Firewall lässt Geräte im Heimnetz noch nicht durch/)
		).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Firewall-Regel anlegen …' }));
		const dialog = await screen.findByRole('dialog', { name: 'Firewall-Regel anlegen?' });
		expect(
			within(dialog).getByText(/fragt gleich auf diesem Rechner nach Administratorrechten/)
		).toBeTruthy();
		expect(
			within(dialog).getByText(/nur TCP-Port 8090 und nur in privaten Netzwerken/)
		).toBeTruthy();
		expect(data.firewall).not.toHaveBeenCalled();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Regel anlegen' }));
		await vi.waitFor(() => expect(data.firewall).toHaveBeenCalledWith('add', expect.anything()));
		await vi.waitFor(() =>
			expect(flags.show).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Firewall-Regel angelegt' })
			)
		);
		await tick();
		expect(
			screen.getByText(/Vorhanden: Die Firewall lässt Geräte im Heimnetz zur App durch/)
		).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Firewall-Regel anlegen …' })).toBeNull();
	});

	it('shows a declined change with what to do by hand, and the commands to copy', async () => {
		await show({
			info: infoOf({ enabled: true, addresses: ['192.168.178.20'] }),
			data: {
				firewall: vi.fn(async () => ({
					kind: 'ok' as const,
					value: {
						result: {
							ok: false,
							action: 'add' as const,
							outcome: 'cancelled' as const,
							report: {
								code: 'lan-firewall-add-failed',
								level: 'error' as const,
								exitCode: 1,
								problem:
									'Die Firewall-Regel „becauseyoulovejira (Heimnetz)“ wurde nicht angelegt: die Anfrage nach Administratorrechten wurde abgelehnt.',
								facts: [],
								cause: 'Zum Ändern der Firewall braucht Windows Administratorrechte.',
								remedy: {
									steps: ['Erneut versuchen.', 'Oder von Hand (Befehl unten).'],
									command: ADD
								},
								log: ''
							}
						},
						lan: null
					}
				}))
			}
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Firewall-Regel anlegen …' }));
		const dialog = await screen.findByRole('dialog', { name: 'Firewall-Regel anlegen?' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Regel anlegen' }));
		expect(
			await screen.findByRole('heading', {
				name: /wurde nicht angelegt: die Anfrage nach Administratorrechten wurde abgelehnt/
			})
		).toBeTruthy();
		expect(screen.getByRole('region', { name: 'Befehl zum Kopieren' }).textContent).toBe(ADD);
		expect(screen.getByRole('region', { name: 'Regel entfernen' }).textContent).toBe(REMOVE);
	});

	it('offers to remove a rule that is left over after switching off', async () => {
		const { data } = await show({
			info: infoOf({ firewall: { state: 'present', blocked: false, add: ADD, remove: REMOVE } })
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Firewall-Regel entfernen …' }));
		const dialog = await screen.findByRole('dialog', { name: 'Firewall-Regel entfernen?' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Regel entfernen' }));
		await vi.waitFor(() => expect(data.firewall).toHaveBeenCalledWith('remove', expect.anything()));
	});

	it('names the address for other devices with "Kopieren" while the server answers under it', async () => {
		await show({
			info: infoOf({
				enabled: true,
				addresses: ['192.168.178.20'],
				firewall: { state: 'present', blocked: false, add: ADD, remove: REMOVE }
			}),
			overview: overviewOf({ active: true, hosts: ['192.168.178.20:8090'], editable: true })
		});
		expect(screen.getByRole('region', { name: 'Adresse für andere Geräte' }).textContent).toBe(
			'http://192.168.178.20:8090/'
		);
		expect(screen.getByRole('button', { name: 'Adresse für andere Geräte kopieren' })).toBeTruthy();
		expect(screen.queryByText('Neustart nötig')).toBeNull();
	});

	it('warns about a public network, an address no adapter has and a block rule, without red', async () => {
		await show({
			info: infoOf({
				enabled: true,
				addresses: ['192.168.178.20', '192.168.178.99'],
				states: [
					{ address: '192.168.178.20', present: true, adapter: 'Ethernet', category: 'public' },
					{ address: '192.168.178.99', present: false, adapter: '', category: 'unknown' }
				],
				firewall: { state: 'present', blocked: true, add: ADD, remove: REMOVE }
			})
		});
		expect(
			screen.getByRole('heading', { name: /Netzwerk von 192.168.178.20 ist „Öffentlich“/ })
		).toBeTruthy();
		expect(screen.getByText(/Netzwerkprofil „Privat“/)).toBeTruthy();
		expect(
			screen.getByRole('heading', {
				name: /192.168.178.99 gehört gerade zu keinem Netzwerkadapter/
			})
		).toBeTruthy();
		expect(
			screen.getByRole('heading', { name: /Eine Sperrregel blockiert pocketbase.exe/ })
		).toBeTruthy();
		expect(document.body.querySelector('[data-tone="error"]')).toBeNull();
		expect(
			screen.getByText(/Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen/)
		).toBeTruthy();
	});

	it('leaves the setting to byl-config.json where the app cannot change it, and waits for the restart after the update', async () => {
		await show({
			overview: overviewOf({ active: false, hosts: [], editable: false }),
			store: false
		});
		expect(
			screen.getByText(/Den Zugriff im Heimnetz stellt nur die App unter Windows/)
		).toBeTruthy();
		expect(screen.queryByRole('switch')).toBeNull();
		document.body.innerHTML = '';
		await show({ overview: overviewOf(null) });
		expect(screen.getByText(RESTART_NEEDED.title)).toBeTruthy();
		expect(screen.queryByRole('switch')).toBeNull();
	});
});
