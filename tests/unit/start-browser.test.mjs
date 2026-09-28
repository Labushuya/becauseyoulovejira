// Whether start.bat opens a browser tab (ADR-0035 sections 3, 4 and 7; plan start-fenster, SF-4):
// the side-effect-free functions of app/byl-functions.ps1 with fake answers, a fake clock and fake
// requests. The start script itself is never executed (CLAUDE.md section 11.3).

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { runPowerShellJson } from '../support/powershell.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FUNCTIONS_FILE = join(ROOT_DIR, 'app', 'byl-functions.ps1');
const NONCE = 'Ab3dEf6hIj9kLm2nOp5qRs8t';
const SENT = { nonce: NONCE, notified: 1 };

const SCRIPT = String.raw`
. $env:BYL_FUNCTIONS
Set-StrictMode -Version 2.0
$in = $env:BYL_TEST_INPUT | ConvertFrom-Json
$result = @{}

function Out-Object($Value) {
    if ($null -eq $Value) { return $null }
    $table = @{}
    foreach ($property in $Value.PSObject.Properties) { $table[$property.Name] = $property.Value }
    return $table
}

$presence = @{}
foreach ($case in $in.presence) { $presence[$case.name] = Out-Object (ConvertFrom-PresenceAnswer -StatusCode $case.status -Body $case.body) }
$result.presence = $presence

$attention = @{}
foreach ($case in $in.attention) { $attention[$case.name] = Out-Object (ConvertFrom-AttentionAnswer -StatusCode $case.status -Body $case.body) }
$result.attention = $attention

$state = @{}
foreach ($case in $in.state) { $state[$case.name] = ConvertFrom-AttentionState -StatusCode $case.status -Body $case.body }
$result.state = $state

$urls = @{}
foreach ($nonce in $in.nonces) {
    try { $urls[$nonce] = Get-AttentionUrl -Nonce $nonce } catch { $urls[$nonce] = 'threw' }
}
try { $urls['(null)'] = Get-AttentionUrl -Nonce $null } catch { $urls['(null)'] = 'threw' }
$result.urls = $urls
# In input order: the keys of a hashtable ignore case ("start" and "Start").
$result.sendUrls = @(foreach ($reason in $in.reasons) {
    try { Get-AttentionSendUrl -Reason $reason } catch { 'threw' }
})

$steps = @{}
foreach ($case in $in.steps) {
    $value = if ($null -eq $case.presence) { $null } else { [pscustomobject]@{ Tabs = $case.presence.tabs; LandingAgoMs = $case.presence.landing } }
    $steps[$case.name] = Get-BrowserStep -Presence $value -NowMs $case.now -DeadlineMs $case.deadline
}
$result.steps = $steps

# Wait-AttentionAck with the real clock: the bound only protects a slow machine.
$script:polls = 0
$acked = Wait-AttentionAck -TimeoutMs 600000 -IntervalMs 5 -Poll { $script:polls++; $script:polls -ge 3 }
$ackedPolls = $script:polls
$script:polls = 0
$watch = [Diagnostics.Stopwatch]::StartNew()
$never = Wait-AttentionAck -TimeoutMs 200 -IntervalMs 20 -Poll { $script:polls++; $false }
$neverPolls = $script:polls
$neverMs = $watch.ElapsedMilliseconds
$throws = Wait-AttentionAck -TimeoutMs 600000 -IntervalMs 5 -Poll { throw 'kaputt' }
$truthy = Wait-AttentionAck -TimeoutMs 50 -IntervalMs 5 -Poll { 'true' }
$result.wait = @{ acked = $acked; ackedPolls = $ackedPolls; never = $never; neverPolls = $neverPolls; neverMs = $neverMs; throws = $throws; truthy = $truthy }

# Resolve-BrowserAction with a fake clock: every sleep moves it on, nothing really waits.
$base = [DateTime]::new(2026, 9, 28, 12, 0, 0, [DateTimeKind]::Utc)
$resolve = @{}
foreach ($case in $in.resolve) {
    $script:ms = 0
    $script:calls = New-Object System.Collections.Generic.List[string]
    $script:queue = New-Object System.Collections.Generic.List[object]
    foreach ($item in @($case.presence)) { $script:queue.Add($item) }
    $script:acks = [int]$case.ackAfter
    $script:case = $case
    $fakes = @{
        ColdStart = [bool]$case.cold
        Now = { $base.AddMilliseconds($script:ms) }
        Sleep = { param($Milliseconds) $script:ms += $Milliseconds }
        GetPresence = {
            $script:calls.Add('presence')
            if ($script:case.presenceThrows) { throw 'no answer' }
            $item = if ($script:queue.Count -gt 1) { $script:queue[0]; $script:queue.RemoveAt(0) } else { $script:queue[0] }
            if ($null -eq $item) { return $null }
            [pscustomobject]@{ Tabs = $item.tabs; LandingAgoMs = $item.landing }
        }
        SendAttention = {
            $script:calls.Add('attention')
            if ($null -eq $script:case.sent) { return $null }
            [pscustomobject]@{ Nonce = $script:case.sent.nonce; Notified = $script:case.sent.notified }
        }
        GetAcked = {
            param($Nonce)
            $script:calls.Add("ack:$Nonce")
            if ($script:case.ackThrows) { throw 'offline' }
            $script:acks--
            $script:acks -eq 0
        }
    }
    $action = Resolve-BrowserAction @fakes
    $resolve[$case.name] = @{ action = $action; calls = @($script:calls.ToArray()); ms = $script:ms }
}
$result.resolve = $resolve

$result | ConvertTo-Json -Depth 6 -Compress
`;

const tabs = (count, landing = null) => ({ tabs: count, landing });
/** Every field set, because the script runs with Set-StrictMode like byl-control.ps1. */
const resolveCase = (fields) => ({
	sent: null,
	ackAfter: 0,
	ackThrows: false,
	presenceThrows: false,
	...fields
});

let result;

beforeAll(() => {
	result = runPowerShellJson(
		SCRIPT,
		{
			presence: [
				{ name: 'tabs', status: 200, body: '{"tabs":2,"landingAgoMs":null}' },
				{ name: 'landing', status: 200, body: '{"tabs":0,"landingAgoMs":1234}' },
				{ name: 'forbidden', status: 403, body: '{"message":"x"}' },
				{ name: 'noRoute', status: 404, body: '{"message":"Not Found."}' },
				{ name: 'broken', status: 200, body: 'kein json' },
				{ name: 'array', status: 200, body: '[1]' },
				{ name: 'negative', status: 200, body: '{"tabs":-1,"landingAgoMs":null}' },
				{ name: 'text', status: 200, body: '{"tabs":"2","landingAgoMs":null}' },
				{ name: 'fraction', status: 200, body: '{"tabs":1.5,"landingAgoMs":null}' },
				{ name: 'noLanding', status: 200, body: '{"tabs":2}' },
				{ name: 'badLanding', status: 200, body: '{"tabs":0,"landingAgoMs":"jetzt"}' }
			],
			attention: [
				{ name: 'sent', status: 200, body: `{"nonce":"${NONCE}","notified":2}` },
				{ name: 'nobody', status: 200, body: `{"nonce":"${NONCE}","notified":0}` },
				{ name: 'tooSoon', status: 429, body: '{"message":"x"}' },
				{ name: 'badNonce', status: 200, body: '{"nonce":"../../api/x","notified":1}' },
				{ name: 'shortNonce', status: 200, body: '{"nonce":"abc","notified":1}' },
				{ name: 'noCount', status: 200, body: `{"nonce":"${NONCE}"}` },
				{ name: 'broken', status: 200, body: '' }
			],
			state: [
				{ name: 'acked', status: 200, body: '{"acked":true}' },
				{ name: 'waiting', status: 200, body: '{"acked":false}' },
				{ name: 'text', status: 200, body: '{"acked":"true"}' },
				{ name: 'gone', status: 404, body: '{"message":"x"}' },
				{ name: 'broken', status: 200, body: 'x' }
			],
			nonces: [NONCE, 'abc', `${NONCE}x`, '../../api/collections/users', ''],
			reasons: ['start', 'datei', 'stop', 'Start', 'x&reason=stop'],
			steps: [
				{ name: 'noAnswer', presence: null, now: 0, deadline: 3000 },
				{ name: 'landingNow', presence: tabs(2, 500), now: 0, deadline: 0 },
				{ name: 'landingOld', presence: tabs(0, 10_000), now: 0, deadline: 0 },
				{ name: 'tabs', presence: tabs(1), now: 0, deadline: 0 },
				{ name: 'waitCold', presence: tabs(0), now: 2750, deadline: 3000 },
				{ name: 'coldOver', presence: tabs(0), now: 3000, deadline: 3000 },
				{ name: 'warm', presence: tabs(0), now: 0, deadline: 0 }
			],
			resolve: [
				{ name: 'noServerAnswer', cold: false, presence: [null] },
				{ name: 'landing', cold: true, presence: [tabs(0, 800)] },
				{ name: 'ackedTab', cold: false, presence: [tabs(1)], sent: SENT, ackAfter: 3 },
				{ name: 'tooSoon', cold: false, presence: [tabs(2)] },
				{ name: 'nobodyNotified', cold: false, presence: [tabs(1)], sent: { ...SENT, notified: 0 } },
				{ name: 'noAck', cold: false, presence: [tabs(1)], sent: SENT, ackAfter: 999 },
				{ name: 'ackThrows', cold: false, presence: [tabs(1)], sent: SENT, ackThrows: true },
				{ name: 'noTabWarm', cold: false, presence: [tabs(0)] },
				{ name: 'noTabCold', cold: true, presence: [tabs(0)] },
				{
					name: 'reconnectCold',
					cold: true,
					presence: [tabs(0), tabs(0), tabs(0), tabs(1)],
					sent: SENT,
					ackAfter: 1
				},
				{ name: 'presenceThrows', cold: true, presence: [tabs(1)], presenceThrows: true }
			].map(resolveCase)
		},
		{ BYL_FUNCTIONS: FUNCTIONS_FILE }
	);
}, 60_000);

describe('answers of the routes', () => {
	it('reads tabs and the landing page of the presence', () => {
		expect(result.presence.tabs).toEqual({ Tabs: 2, LandingAgoMs: null });
		expect(result.presence.landing).toEqual({ Tabs: 0, LandingAgoMs: 1234 });
	});

	it.each(['forbidden', 'noRoute', 'broken', 'array', 'negative', 'text', 'fraction', 'noLanding', 'badLanding'])(
		'gives no presence for the answer %s',
		(name) => {
			expect(result.presence[name]).toBeNull();
		}
	);

	it('reads nonce and number of tabs of a message', () => {
		expect(result.attention.sent).toEqual({ Nonce: NONCE, Notified: 2 });
		expect(result.attention.nobody).toEqual({ Nonce: NONCE, Notified: 0 });
	});

	it.each(['tooSoon', 'badNonce', 'shortNonce', 'noCount', 'broken'])('gives no message for %s', (name) => {
		expect(result.attention[name]).toBeNull();
	});

	it('counts only a real true as confirmation', () => {
		expect(result.state).toEqual({ acked: true, waiting: false, text: false, gone: false, broken: false });
	});

	it('builds URLs only from a nonce of the server and the known reasons', () => {
		expect(result.urls[NONCE]).toBe(`http://127.0.0.1:8090/api/byl/attention/${NONCE}`);
		for (const nonce of ['abc', `${NONCE}x`, '../../api/collections/users', '', '(null)']) {
			expect(result.urls[nonce], nonce).toBe('threw');
		}
		// Reasons in the order of the input: start, datei, stop, Start, x&reason=stop.
		expect(result.sendUrls).toEqual([
			'http://127.0.0.1:8090/api/byl/attention?reason=start',
			'http://127.0.0.1:8090/api/byl/attention?reason=datei',
			'http://127.0.0.1:8090/api/byl/attention?reason=stop',
			'threw',
			'threw'
		]);
	});
});

describe('Get-BrowserStep', () => {
	it.each([
		['noAnswer', 'Open'],
		['landingNow', 'Skip'],
		['landingOld', 'Open'],
		['tabs', 'Attention'],
		['waitCold', 'Wait'],
		['coldOver', 'Open'],
		['warm', 'Open']
	])('%s -> %s', (name, step) => {
		expect(result.steps[name]).toBe(step);
	});
});

describe('Wait-AttentionAck', () => {
	it('returns as soon as a tab confirmed', () => {
		expect(result.wait.acked).toBe(true);
		expect(result.wait.ackedPolls).toBe(3);
	});

	it('gives up after the time and never waits much longer', () => {
		expect(result.wait.never).toBe(false);
		expect(result.wait.neverPolls).toBeGreaterThan(1);
		expect(result.wait.neverMs).toBeLessThan(3000);
	});

	it('counts a failing request and anything but $true as "no confirmation"', () => {
		expect(result.wait.throws).toBe(false);
		expect(result.wait.truthy).toBe(false);
	});
});

describe('Resolve-BrowserAction (fail-open)', () => {
	it('opens the tab without an answer of the server', () => {
		expect(result.resolve.noServerAnswer).toEqual({ action: 'Open', calls: ['presence'], ms: 0 });
	});

	it('leaves it to a landing page that reported just now', () => {
		expect(result.resolve.landing).toEqual({ action: 'Skip', calls: ['presence'], ms: 0 });
	});

	it('opens nothing when an open tab confirms the message', () => {
		expect(result.resolve.ackedTab.action).toBe('Skip');
		expect(result.resolve.ackedTab.calls).toEqual(['presence', 'attention', `ack:${NONCE}`, `ack:${NONCE}`, `ack:${NONCE}`]);
		expect(result.resolve.ackedTab.ms).toBe(500);
	});

	it.each(['tooSoon', 'nobodyNotified'])('opens the tab when the message does not go out (%s)', (name) => {
		expect(result.resolve[name]).toEqual({ action: 'Open', calls: ['presence', 'attention'], ms: 0 });
	});

	it('opens the tab when no tab confirms within 2 s', () => {
		expect(result.resolve.noAck.action).toBe('Open');
		expect(result.resolve.noAck.ms).toBe(2000);
		expect(result.resolve.noAck.calls.filter((call) => call.startsWith('ack:'))).toHaveLength(9);
	});

	it('opens the tab when asking for the confirmation fails', () => {
		expect(result.resolve.ackThrows).toEqual({
			action: 'Open',
			calls: ['presence', 'attention', `ack:${NONCE}`],
			ms: 0
		});
	});

	it('opens at once without a tab when the app ran already', () => {
		expect(result.resolve.noTabWarm).toEqual({ action: 'Open', calls: ['presence'], ms: 0 });
	});

	it('waits up to 3 s for tabs after a cold start before it opens one', () => {
		expect(result.resolve.noTabCold.action).toBe('Open');
		expect(result.resolve.noTabCold.ms).toBe(3000);
		expect(result.resolve.noTabCold.calls).toEqual(Array(13).fill('presence'));
	});

	it('finds a tab that reconnects during the wait of a cold start', () => {
		expect(result.resolve.reconnectCold).toEqual({
			action: 'Skip',
			calls: ['presence', 'presence', 'presence', 'presence', 'attention', `ack:${NONCE}`],
			ms: 750
		});
	});

	it('opens the tab when the question itself fails', () => {
		expect(result.resolve.presenceThrows.action).toBe('Open');
	});
});
