// Color math for the token tests (CLAUDE.md section 8, ADR-0009, ADR-0027): WCAG 2.x contrast,
// CIELAB (D65) and the CIEDE2000 color difference, plus the HSL hue. Only tests use it; the app
// itself never computes colors.

export type Lab = readonly [l: number, a: number, b: number];

/** The three channels of a #rrggbb color as 0 to 255. */
export function hexToRgb(hex: string): [number, number, number] {
	const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (!match) throw new Error(`Not a #rrggbb color: ${hex}`);
	const [r = '', g = '', b = ''] = match.slice(1);
	return [parseInt(r, 16), parseInt(g, 16), parseInt(b, 16)];
}

/** sRGB channel (0 to 255) to linear light. */
function linear(value: number): number {
	const srgb = value / 255;
	return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance (WCAG 2.x) of a #rrggbb color. */
export function luminance(hex: string): number {
	const [r, g, b] = hexToRgb(hex).map(linear) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio (WCAG 2.x) of two #rrggbb colors, 1 to 21. */
export function contrast(first: string, second: string): number {
	const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [
		number,
		number
	];
	return (lighter + 0.05) / (darker + 0.05);
}

/** CIELAB of a #rrggbb color (sRGB, reference white D65). */
export function hexToLab(hex: string): Lab {
	const [r, g, b] = hexToRgb(hex).map(linear) as [number, number, number];
	const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
	const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
	const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
	const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
	const [fx, fy, fz] = [f(x), f(y), f(z)];
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const DEG = Math.PI / 180;

function hueAngle(b: number, a: number): number {
	if (a === 0 && b === 0) return 0;
	const angle = Math.atan2(b, a) / DEG;
	return angle < 0 ? angle + 360 : angle;
}

/** CIEDE2000 color difference of two Lab colors (Sharma, Wu and Dalal 2005, kL = kC = kH = 1). */
export function deltaE2000Lab([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
	const c1 = Math.hypot(a1, b1);
	const c2 = Math.hypot(a2, b2);
	const cMean7 = ((c1 + c2) / 2) ** 7;
	const g = 0.5 * (1 - Math.sqrt(cMean7 / (cMean7 + 25 ** 7)));
	const a1p = (1 + g) * a1;
	const a2p = (1 + g) * a2;
	const c1p = Math.hypot(a1p, b1);
	const c2p = Math.hypot(a2p, b2);
	const h1p = hueAngle(b1, a1p);
	const h2p = hueAngle(b2, a2p);

	const dL = l2 - l1;
	const dC = c2p - c1p;
	let dh = 0;
	if (c1p * c2p !== 0) {
		dh = h2p - h1p;
		if (dh > 180) dh -= 360;
		else if (dh < -180) dh += 360;
	}
	const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin((dh / 2) * DEG);

	const lMean = (l1 + l2) / 2;
	const cpMean = (c1p + c2p) / 2;
	let hMean = h1p + h2p;
	if (c1p * c2p !== 0) {
		if (Math.abs(h1p - h2p) > 180) hMean += hMean < 360 ? 360 : -360;
		hMean /= 2;
	}
	const t =
		1 -
		0.17 * Math.cos((hMean - 30) * DEG) +
		0.24 * Math.cos(2 * hMean * DEG) +
		0.32 * Math.cos((3 * hMean + 6) * DEG) -
		0.2 * Math.cos((4 * hMean - 63) * DEG);
	const dTheta = 30 * Math.exp(-(((hMean - 275) / 25) ** 2));
	const rc = 2 * Math.sqrt(cpMean ** 7 / (cpMean ** 7 + 25 ** 7));
	const sl = 1 + (0.015 * (lMean - 50) ** 2) / Math.sqrt(20 + (lMean - 50) ** 2);
	const sc = 1 + 0.045 * cpMean;
	const sh = 1 + 0.015 * cpMean * t;
	const rt = -Math.sin(2 * dTheta * DEG) * rc;

	return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}

/** CIEDE2000 color difference of two #rrggbb colors. */
export function deltaE2000(first: string, second: string): number {
	return deltaE2000Lab(hexToLab(first), hexToLab(second));
}

/** Hue of a #rrggbb color in the HSL model, 0 to 360 degrees (0 for grays). */
export function hslHue(hex: string): number {
	const [r, g, b] = hexToRgb(hex).map((value) => value / 255) as [number, number, number];
	const max = Math.max(r, g, b);
	const delta = max - Math.min(r, g, b);
	if (delta === 0) return 0;
	let hue: number;
	if (max === r) hue = ((g - b) / delta) % 6;
	else if (max === g) hue = (b - r) / delta + 2;
	else hue = (r - g) / delta + 4;
	return (hue * 60 + 360) % 360;
}
