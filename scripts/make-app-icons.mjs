// App icons of the installable web app (ADR-0035 section 8; plan start-fenster, SF-5), derived from
// web/src/lib/assets/favicon.svg: its rounded square and its check mark are drawn again at 192 and
// 512 px ("any", transparent corners like the favicon) and as a maskable icon of 512 px (full
// bleed, the check mark inside the safe zone). No new dependency: the favicon has only a rounded
// rectangle and a polyline with round caps and joins, which this script rasterizes itself with 4x4
// supersampling and writes as PNG with node:zlib.
//
// Run once after a change of the favicon, from the root of the repo:
//   node scripts/make-app-icons.mjs
// tests/unit/app-icons.test.mjs checks that the committed files show exactly these pixels.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const FAVICON = join(ROOT, 'web', 'src', 'lib', 'assets', 'favicon.svg');
export const ICON_DIR = join(ROOT, 'web', 'static', 'icons');

/** The icons of the manifest: file name, size and kind. */
export const ICONS = [
	{ file: 'icon-192.png', size: 192, purpose: 'any' },
	{ file: 'icon-512.png', size: 512, purpose: 'any' },
	{ file: 'icon-maskable-512.png', size: 512, purpose: 'maskable' }
];

const SAMPLES = 4;

function attribute(tag, name) {
	const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
	if (!match) throw new Error(`favicon.svg: attribute ${name} missing in ${tag}`);
	return match[1];
}

function hexColor(value) {
	const match = /^#([0-9a-f]{6})$/i.exec(value);
	if (!match) throw new Error(`favicon.svg: color ${value} is not #rrggbb`);
	const number = Number.parseInt(match[1], 16);
	return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

/** Rounded square and check mark of the favicon, in its own coordinates. */
export function readFavicon(svg) {
	const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
	const rect = /<rect\b[^>]*\/>/.exec(svg)?.[0];
	const path = /<path\b[^>]*\/>/.exec(svg)?.[0];
	if (!viewBox || viewBox[1] !== viewBox[2] || !rect || !path) {
		throw new Error('favicon.svg: expected a square viewBox, one rect and one path');
	}
	if (attribute(path, 'stroke-linecap') !== 'round' || attribute(path, 'stroke-linejoin') !== 'round') {
		throw new Error('favicon.svg: the check mark must have round caps and joins');
	}
	const points = [...attribute(path, 'd').matchAll(/[ML]\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g)].map((match) => [
		Number(match[1]),
		Number(match[2])
	]);
	if (points.length < 2) throw new Error('favicon.svg: the path needs at least two points');
	return {
		size: Number(viewBox[1]),
		rect: {
			x: Number(attribute(rect, 'x')),
			y: Number(attribute(rect, 'y')),
			width: Number(attribute(rect, 'width')),
			height: Number(attribute(rect, 'height')),
			radius: Number(attribute(rect, 'rx')),
			color: hexColor(attribute(rect, 'fill'))
		},
		line: {
			points,
			width: Number(attribute(path, 'stroke-width')),
			color: hexColor(attribute(path, 'stroke'))
		}
	};
}

function insideRoundedRect(x, y, rect) {
	const halfWidth = rect.width / 2;
	const halfHeight = rect.height / 2;
	const dx = Math.max(Math.abs(x - (rect.x + halfWidth)) - (halfWidth - rect.radius), 0);
	const dy = Math.max(Math.abs(y - (rect.y + halfHeight)) - (halfHeight - rect.radius), 0);
	return dx * dx + dy * dy <= rect.radius * rect.radius;
}

function distanceToSegment(x, y, [ax, ay], [bx, by]) {
	const vx = bx - ax;
	const vy = by - ay;
	const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
	return Math.hypot(x - (ax + t * vx), y - (ay + t * vy));
}

/** Round caps and joins: a point belongs to the line if it is near any of its segments. */
function onLine(x, y, line) {
	for (let index = 1; index < line.points.length; index += 1) {
		if (distanceToSegment(x, y, line.points[index - 1], line.points[index]) <= line.width / 2) return true;
	}
	return false;
}

/**
 * RGBA pixels of one icon. "any": the favicon scaled to the icon. "maskable": the square fills the
 * whole icon (the launcher cuts its own shape) and the check mark keeps its place relative to the
 * square, which leaves it well inside the safe zone (a circle of 40 % of the size).
 */
export function renderIcon(favicon, size, purpose) {
	const { rect, line } = favicon;
	const maskable = purpose === 'maskable';
	const scale = maskable ? rect.width / size : favicon.size / size;
	const offsetX = maskable ? rect.x : 0;
	const offsetY = maskable ? rect.y : 0;
	const pixels = Buffer.alloc(size * size * 4);
	for (let py = 0; py < size; py += 1) {
		for (let px = 0; px < size; px += 1) {
			let inRect = 0;
			let inLine = 0;
			for (let sy = 0; sy < SAMPLES; sy += 1) {
				for (let sx = 0; sx < SAMPLES; sx += 1) {
					const x = offsetX + (px + (sx + 0.5) / SAMPLES) * scale;
					const y = offsetY + (py + (sy + 0.5) / SAMPLES) * scale;
					if (maskable || insideRoundedRect(x, y, rect)) inRect += 1;
					if (onLine(x, y, line)) inLine += 1;
				}
			}
			const total = SAMPLES * SAMPLES;
			const lineShare = inLine / total;
			const offset = (py * size + px) * 4;
			for (let channel = 0; channel < 3; channel += 1) {
				pixels[offset + channel] = Math.round(
					rect.color[channel] * (1 - lineShare) + line.color[channel] * lineShare
				);
			}
			pixels[offset + 3] = Math.round((inRect / total) * 255);
		}
	}
	return pixels;
}

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, checksum]);
}

/** PNG (8-bit RGBA, no filter) of square RGBA pixels. */
export function encodePng(pixels, size) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0);
	header.writeUInt32BE(size, 4);
	header.writeUInt8(8, 8);
	header.writeUInt8(6, 9);
	const rows = Buffer.alloc(size * (size * 4 + 1));
	for (let row = 0; row < size; row += 1) {
		pixels.copy(rows, row * (size * 4 + 1) + 1, row * size * 4, (row + 1) * size * 4);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(rows, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const favicon = readFavicon(readFileSync(FAVICON, 'utf8'));
	for (const icon of ICONS) {
		const target = join(ICON_DIR, icon.file);
		writeFileSync(target, encodePng(renderIcon(favicon, icon.size, icon.purpose), icon.size));
		console.log(`wrote ${target}`);
	}
}
