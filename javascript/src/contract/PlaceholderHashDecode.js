// packages/shared/src/PlaceholderHashDecode.ts
/**
* Decodes a ThumbHash to an RGBA image. RGB is not be premultiplied by A.
*
* @param hash The bytes of the ThumbHash.
* @returns The width, height, and pixels of the rendered placeholder image.
*/
function thumbHashToRGBA(hash) {
	const { PI, min, max, cos, round } = Math;
	const header24 = hash[0] | hash[1] << 8 | hash[2] << 16;
	const header16 = hash[3] | hash[4] << 8;
	const l_dc = (header24 & 63) / 63;
	const p_dc = (header24 >> 6 & 63) / 31.5 - 1;
	const q_dc = (header24 >> 12 & 63) / 31.5 - 1;
	const l_scale = (header24 >> 18 & 31) / 31;
	const hasAlpha = header24 >> 23;
	const p_scale = (header16 >> 3 & 63) / 63;
	const q_scale = (header16 >> 9 & 63) / 63;
	const isLandscape = header16 >> 15;
	const lx = max(3, isLandscape ? hasAlpha ? 5 : 7 : header16 & 7);
	const ly = max(3, isLandscape ? header16 & 7 : hasAlpha ? 5 : 7);
	const a_dc = hasAlpha ? (hash[5] & 15) / 15 : 1;
	const a_scale = (hash[5] >> 4) / 15;
	const ac_start = hasAlpha ? 6 : 5;
	let ac_index = 0;
	const decodeChannel = (nx, ny, scale) => {
		const ac = [];
		for (let cy = 0; cy < ny; cy++) for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++) ac.push(((hash[ac_start + (ac_index >> 1)] >> ((ac_index++ & 1) << 2) & 15) / 7.5 - 1) * scale);
		return ac;
	};
	const l_ac = decodeChannel(lx, ly, l_scale);
	const p_ac = decodeChannel(3, 3, p_scale * 1.25);
	const q_ac = decodeChannel(3, 3, q_scale * 1.25);
	const a_ac = hasAlpha && decodeChannel(5, 5, a_scale);
	const ratio = thumbHashToApproximateAspectRatio(hash);
	const w = round(ratio > 1 ? 32 : 32 * ratio);
	const h = round(ratio > 1 ? 32 / ratio : 32);
	const rgba = new Uint8Array(w * h * 4);
	const fx = [];
	const fy = [];
	for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
		let l = l_dc;
		let p = p_dc;
		let q = q_dc;
		let a = a_dc;
		for (let cx = 0, n = max(lx, hasAlpha ? 5 : 3); cx < n; cx++) fx[cx] = cos(PI / w * (x + .5) * cx);
		for (let cy = 0, n = max(ly, hasAlpha ? 5 : 3); cy < n; cy++) fy[cy] = cos(PI / h * (y + .5) * cy);
		for (let cy = 0, j = 0; cy < ly; cy++) for (let cx = cy ? 0 : 1, fy2 = fy[cy] * 2; cx * ly < lx * (ly - cy); cx++, j++) l += l_ac[j] * fx[cx] * fy2;
		for (let cy = 0, j = 0; cy < 3; cy++) for (let cx = cy ? 0 : 1, fy2 = fy[cy] * 2; cx < 3 - cy; cx++, j++) {
			const f = fx[cx] * fy2;
			p += p_ac[j] * f;
			q += q_ac[j] * f;
		}
		if (hasAlpha) for (let cy = 0, j = 0; cy < 5; cy++) for (let cx = cy ? 0 : 1, fy2 = fy[cy] * 2; cx < 5 - cy; cx++, j++) a += a_ac[j] * fx[cx] * fy2;
		const b = l - 2 / 3 * p;
		const r = (3 * l - b + q) / 2;
		const g = r - q;
		rgba[i] = max(0, 255 * min(1, r));
		rgba[i + 1] = max(0, 255 * min(1, g));
		rgba[i + 2] = max(0, 255 * min(1, b));
		rgba[i + 3] = max(0, 255 * min(1, a));
	}
	return {
		w,
		h,
		rgba
	};
}
/**
* Extracts the approximate aspect ratio of the original image.
*
* @param hash The bytes of the ThumbHash.
* @returns The approximate aspect ratio (i.e. width / height).
*/
function thumbHashToApproximateAspectRatio(hash) {
	const header = hash[3];
	const hasAlpha = hash[2] & 128;
	const isLandscape = hash[4] & 128;
	return (isLandscape ? hasAlpha ? 5 : 7 : header & 7) / (isLandscape ? header & 7 : hasAlpha ? 5 : 7);
}
/**
* Encodes an RGBA image to PNG bytes. RGB should not be premultiplied by
* A. This is optimized for speed and simplicity and does not optimize for size
* at all. This doesn't do any compression (all values are stored uncompressed).
*
* @param w The width of the input image. Must be ≤100px.
* @param h The height of the input image. Must be ≤100px.
* @param rgba The pixels in the input image, row-by-row. Must have w*h*4 elements.
* @returns The bytes of a PNG for the input image.
*/
function rgbaToPng(w, h, rgba) {
	const row = w * 4 + 1;
	const idat = 6 + h * (5 + row);
	const bytes = [
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10,
		0,
		0,
		0,
		13,
		73,
		72,
		68,
		82,
		0,
		0,
		w >> 8,
		w & 255,
		0,
		0,
		h >> 8,
		h & 255,
		8,
		6,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		idat >>> 24,
		idat >> 16 & 255,
		idat >> 8 & 255,
		idat & 255,
		73,
		68,
		65,
		84,
		120,
		1
	];
	const table = [
		0,
		498536548,
		997073096,
		651767980,
		1994146192,
		1802195444,
		1303535960,
		1342533948,
		-306674912,
		-267414716,
		-690576408,
		-882789492,
		-1687895376,
		-2032938284,
		-1609899400,
		-1111625188
	];
	let a = 1;
	let b = 0;
	for (let y = 0, i = 0, end = row - 1; y < h; y++, end += row - 1) {
		bytes.push(y + 1 < h ? 0 : 1, row & 255, row >> 8, ~row & 255, row >> 8 ^ 255, 0);
		for (b = (b + a) % 65521; i < end; i++) {
			const u = rgba[i] & 255;
			bytes.push(u);
			a = (a + u) % 65521;
			b = (b + a) % 65521;
		}
	}
	bytes.push(b >> 8, b & 255, a >> 8, a & 255, 0, 0, 0, 0, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130);
	for (let [start, end] of [[12, 29], [37, 41 + idat]]) {
		let c = -1;
		for (let i = start; i < end; i++) {
			c ^= bytes[i];
			c = c >>> 4 ^ table[c & 15];
			c = c >>> 4 ^ table[c & 15];
		}
		c = ~c;
		bytes[end++] = c >>> 24;
		bytes[end++] = c >> 16 & 255;
		bytes[end++] = c >> 8 & 255;
		bytes[end++] = c & 255;
	}
	return Uint8Array.from(bytes);
}
/**
* Decodes a ThumbHash to a PNG data URL. This is a convenience function that
* just calls "thumbHashToRGBA" followed by "rgbaToDataURL".
*
* @param hash The bytes of the ThumbHash.
* @returns A data URL containing a PNG for the rendered ThumbHash.
*/
const placeholderHashToBytes = (hash) => Uint8Array.from(atob(hash), (c) => c.charCodeAt(0));
/** Renders a base64 ThumbHash as a small PNG, which the browser scales to the element's size. */
function placeholderHashToPng(hash) {
	const image = thumbHashToRGBA(placeholderHashToBytes(hash));
	return rgbaToPng(image.w, image.h, image.rgba);
}
function placeholderHashToDataURL(hash) {
	return `data:image/png;base64,${btoa(String.fromCharCode(...placeholderHashToPng(hash)))}`;
}
export { placeholderHashToDataURL };
