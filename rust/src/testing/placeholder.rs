//! Renders a ThumbHash as the small PNG the CDN serves for an image's `placeholder` resource
//! (packages/shared/src/PlaceholderHashDecode.ts).
use base64::Engine;
use std::f64::consts::PI;

/// The PNG for a base64 ThumbHash, or `None` when it does not decode.
pub(super) fn placeholder_png(thumbhash: &str) -> Option<Vec<u8>> {
    let hash = base64::engine::general_purpose::STANDARD
        .decode(thumbhash)
        .ok()?;
    if hash.len() < 6 {
        return None;
    }
    let (width, height, rgba) = thumbhash_to_rgba(&hash)?;
    Some(rgba_to_png(width, height, &rgba))
}

/// Decodes a ThumbHash to RGBA pixels, not premultiplied by alpha. The loops index the DCT
/// factors exactly as the reference decoder does.
#[allow(clippy::needless_range_loop)]
fn thumbhash_to_rgba(hash: &[u8]) -> Option<(usize, usize, Vec<u8>)> {
    let byte = |index: usize| u32::from(hash.get(index).copied().unwrap_or(0));
    let header24 = byte(0) | (byte(1) << 8) | (byte(2) << 16);
    let header16 = byte(3) | (byte(4) << 8);
    let l_dc = f64::from(header24 & 63) / 63.0;
    let p_dc = f64::from((header24 >> 6) & 63) / 31.5 - 1.0;
    let q_dc = f64::from((header24 >> 12) & 63) / 31.5 - 1.0;
    let l_scale = f64::from((header24 >> 18) & 31) / 31.0;
    let has_alpha = header24 >> 23 != 0;
    let p_scale = f64::from((header16 >> 3) & 63) / 63.0;
    let q_scale = f64::from((header16 >> 9) & 63) / 63.0;
    let is_landscape = header16 >> 15 != 0;
    let lx = 3.max(if is_landscape {
        if has_alpha {
            5
        } else {
            7
        }
    } else {
        header16 & 7
    }) as usize;
    let ly = 3.max(if is_landscape {
        header16 & 7
    } else if has_alpha {
        5
    } else {
        7
    }) as usize;
    let a_dc = if has_alpha {
        f64::from(byte(5) & 15) / 15.0
    } else {
        1.0
    };
    let a_scale = f64::from(byte(5) >> 4) / 15.0;

    // The varying factors, with saturation boosted by 1.25 to make up for quantization.
    let ac_start = if has_alpha { 6 } else { 5 };
    let mut ac_index = 0usize;
    let mut decode_channel = |nx: usize, ny: usize, scale: f64| {
        let mut ac = Vec::new();
        for cy in 0..ny {
            let mut cx = usize::from(cy == 0);
            while cx * ny < nx * (ny - cy) {
                let nibble = (byte(ac_start + (ac_index >> 1)) >> ((ac_index & 1) << 2)) & 15;
                ac_index += 1;
                ac.push((f64::from(nibble) / 7.5 - 1.0) * scale);
                cx += 1;
            }
        }
        ac
    };
    let l_ac = decode_channel(lx, ly, l_scale);
    let p_ac = decode_channel(3, 3, p_scale * 1.25);
    let q_ac = decode_channel(3, 3, q_scale * 1.25);
    let a_ac = if has_alpha {
        decode_channel(5, 5, a_scale)
    } else {
        Vec::new()
    };

    let ratio = approximate_aspect_ratio(hash)?;
    let width = (if ratio > 1.0 { 32.0 } else { 32.0 * ratio }).round() as usize;
    let height = (if ratio > 1.0 { 32.0 / ratio } else { 32.0 }).round() as usize;
    let mut rgba = vec![0u8; width * height * 4];
    let columns = lx.max(if has_alpha { 5 } else { 3 });
    let rows = ly.max(if has_alpha { 5 } else { 3 });
    let mut fx = vec![0.0; columns];
    let mut fy = vec![0.0; rows];
    let channel = |value: f64| (255.0 * value.min(1.0)).max(0.0) as u8;
    for y in 0..height {
        for x in 0..width {
            let (mut l, mut p, mut q, mut a) = (l_dc, p_dc, q_dc, a_dc);
            for (cx, f) in fx.iter_mut().enumerate() {
                *f = (PI / width as f64 * (x as f64 + 0.5) * cx as f64).cos();
            }
            for (cy, f) in fy.iter_mut().enumerate() {
                *f = (PI / height as f64 * (y as f64 + 0.5) * cy as f64).cos();
            }
            let mut j = 0;
            for cy in 0..ly {
                let fy2 = fy[cy] * 2.0;
                let mut cx = usize::from(cy == 0);
                while cx * ly < lx * (ly - cy) {
                    l += l_ac[j] * fx[cx] * fy2;
                    cx += 1;
                    j += 1;
                }
            }
            let mut j = 0;
            for cy in 0..3 {
                let fy2 = fy[cy] * 2.0;
                for cx in usize::from(cy == 0)..3 - cy {
                    let f = fx[cx] * fy2;
                    p += p_ac[j] * f;
                    q += q_ac[j] * f;
                    j += 1;
                }
            }
            if has_alpha {
                let mut j = 0;
                for cy in 0..5 {
                    let fy2 = fy[cy] * 2.0;
                    for cx in usize::from(cy == 0)..5 - cy {
                        a += a_ac[j] * fx[cx] * fy2;
                        j += 1;
                    }
                }
            }
            let b = l - 2.0 / 3.0 * p;
            let r = (3.0 * l - b + q) / 2.0;
            let g = r - q;
            let i = (y * width + x) * 4;
            rgba[i] = channel(r);
            rgba[i + 1] = channel(g);
            rgba[i + 2] = channel(b);
            rgba[i + 3] = channel(a);
        }
    }
    Some((width, height, rgba))
}

/// The original image's approximate width / height.
fn approximate_aspect_ratio(hash: &[u8]) -> Option<f64> {
    let header = hash.get(3)?;
    let has_alpha = hash.get(2)? & 0x80 != 0;
    let is_landscape = hash.get(4)? & 0x80 != 0;
    let lx = if is_landscape {
        if has_alpha {
            5
        } else {
            7
        }
    } else {
        header & 7
    };
    let ly = if is_landscape {
        header & 7
    } else if has_alpha {
        5
    } else {
        7
    };
    (ly != 0).then(|| f64::from(lx) / f64::from(ly))
}

/// An uncompressed PNG of RGBA pixels, as the CDN writes it.
fn rgba_to_png(width: usize, height: usize, rgba: &[u8]) -> Vec<u8> {
    let row = width * 4 + 1;
    let idat = 6 + height * (5 + row);
    let mut bytes = vec![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
    bytes.extend_from_slice(&(width as u32).to_be_bytes());
    bytes.extend_from_slice(&(height as u32).to_be_bytes());
    bytes.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    bytes.extend_from_slice(&(idat as u32).to_be_bytes());
    bytes.extend_from_slice(&[73, 68, 65, 84, 120, 1]);
    let (mut a, mut b) = (1u32, 0u32);
    for y in 0..height {
        bytes.extend_from_slice(&[
            u8::from(y + 1 == height),
            (row & 255) as u8,
            (row >> 8) as u8,
            (!row & 255) as u8,
            ((row >> 8) ^ 255) as u8,
            0,
        ]);
        b = (b + a) % 65521;
        for &value in &rgba[y * (row - 1)..(y + 1) * (row - 1)] {
            bytes.push(value);
            a = (a + u32::from(value)) % 65521;
            b = (b + a) % 65521;
        }
    }
    bytes.extend_from_slice(&[(b >> 8) as u8, b as u8, (a >> 8) as u8, a as u8]);
    let checksums = bytes.len();
    bytes.extend_from_slice(&[0; 8]);
    bytes.extend_from_slice(&[73, 69, 78, 68, 174, 66, 96, 130]);
    // The CRCs of the IHDR chunk (bytes 12..29) and the IDAT chunk.
    for (start, end) in [(12, 29), (37, checksums)] {
        let crc = crc32(&bytes[start..end]);
        bytes.splice(end..end + 4, crc.to_be_bytes());
    }
    bytes
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in data {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xedb8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}
