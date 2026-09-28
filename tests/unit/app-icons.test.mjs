// App icons of the installable web app (ADR-0035 section 8; plan start-fenster, SF-5): the PNG files
// in web/static/icons are square RGBA images of the right size and show exactly the pixels that
// scripts/make-app-icons.mjs draws from favicon.svg now, so a changed favicon without new icons
// fails here. Compared are the decoded pixels, not the bytes of the compression.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
	FAVICON,
	ICONS,
	ICON_DIR,
	encodePng,
	readFavicon,
	renderIcon
} from '../../scripts/make-app-icons.mjs';

/** Size, color type and RGBA pixels of a PNG with filter 0 (as the script writes it). */
function decode(png) {
	expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	let offset = 8;
	let width = 0;
	let height = 0;
	let colorType = -1;
	const data = [];
	while (offset < png.length) {
		const length = png.readUInt32BE(offset);
		const type = png.toString('ascii', offset + 4, offset + 8);
		const body = png.subarray(offset + 8, offset + 8 + length);
		if (type === 'IHDR') {
			width = body.readUInt32BE(0);
			height = body.readUInt32BE(4);
			expect(body[8]).toBe(8);
			colorType = body[9];
		} else if (type === 'IDAT') {
			data.push(body);
		}
		offset += 12 + length;
	}
	const rows = inflateSync(Buffer.concat(data));
	const pixels = Buffer.alloc(width * height * 4);
	for (let row = 0; row < height; row += 1) {
		const start = row * (width * 4 + 1);
		expect(rows[start]).toBe(0);
		rows.copy(pixels, row * width * 4, start + 1, start + 1 + width * 4);
	}
	return { width, height, colorType, pixels };
}

const favicon = readFavicon(readFileSync(FAVICON, 'utf8'));

describe('app icons from favicon.svg', () => {
	it('reads the rounded square and the check mark of the favicon', () => {
		expect(favicon.size).toBe(128);
		expect(favicon.rect).toMatchObject({ x: 12, y: 12, width: 104, height: 104, radius: 20 });
		expect(favicon.line.points).toEqual([
			[40, 64],
			[56, 80],
			[88, 48]
		]);
		expect(favicon.line.width).toBe(6);
	});

	it.each(ICONS)('$file is an RGBA PNG of $size px with the pixels of the favicon', (icon) => {
		const decoded = decode(readFileSync(join(ICON_DIR, icon.file)));
		expect(decoded.width).toBe(icon.size);
		expect(decoded.height).toBe(icon.size);
		expect(decoded.colorType).toBe(6);
		expect(decoded.pixels.equals(renderIcon(favicon, icon.size, icon.purpose))).toBe(true);
	});

	it('leaves the corners of an "any" icon transparent and fills the maskable one', () => {
		const any = renderIcon(favicon, 192, 'any');
		const maskable = renderIcon(favicon, 512, 'maskable');
		expect(any[3]).toBe(0);
		expect(maskable[3]).toBe(255);
		// The center of the maskable icon is the petrol of the favicon.
		const center = (256 * 512 + 256) * 4;
		expect([...maskable.subarray(center, center + 4)]).toEqual([...favicon.rect.color, 255]);
	});

	it('keeps the check mark of the maskable icon inside the safe zone (40 % around the center)', () => {
		const size = 512;
		const pixels = renderIcon(favicon, size, 'maskable');
		let farthest = 0;
		for (let y = 0; y < size; y += 1) {
			for (let x = 0; x < size; x += 1) {
				const offset = (y * size + x) * 4;
				if (pixels[offset] > 200) farthest = Math.max(farthest, Math.hypot(x - size / 2, y - size / 2));
			}
		}
		expect(farthest).toBeGreaterThan(0);
		expect(farthest).toBeLessThan(size * 0.4);
	});

	it('writes a PNG the decoder reads back', () => {
		const pixels = renderIcon(favicon, 16, 'any');
		expect(decode(encodePng(pixels, 16)).pixels.equals(pixels)).toBe(true);
	});
});
