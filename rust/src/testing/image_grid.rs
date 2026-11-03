//! The test image grid of `packages/shared/src/TestImageGrid.ts`, painted byte for byte: an odd
//! N×N grid with an alternating black-and-white ring, two Gray-coded bits per interior cell as
//! one of four luma levels (colour in chroma only), and Reed–Solomon parity over GF(256), interleaved and whitened.

const PARITY: usize = 32;
const LEVELS: [i32; 4] = [72, 128, 184, 240];
const SYMBOL_LEVEL: [usize; 4] = [0, 1, 3, 2];

/// GF(256) with the polynomial 0x11d and generator α = 2: (exp, log).
const GF: ([u8; 512], [u8; 256]) = {
    let mut exp = [0u8; 512];
    let mut log = [0u8; 256];
    let mut x: u32 = 1;
    let mut i = 0;
    while i < 255 {
        exp[i] = x as u8;
        log[x as usize] = i as u8;
        x <<= 1;
        if x & 256 != 0 {
            x ^= 0x11d;
        }
        i += 1;
    }
    while i < 512 {
        exp[i] = exp[i - 255];
        i += 1;
    }
    (exp, log)
};

const fn mul(a: u8, b: u8) -> u8 {
    if a == 0 || b == 0 {
        0
    } else {
        GF.0[GF.1[a as usize] as usize + GF.1[b as usize] as usize]
    }
}

/// g(x) = (x − α^0)…(x − α^31), highest coefficient first.
const GENERATOR: [u8; PARITY + 1] = {
    let mut g = [0u8; PARITY + 1];
    g[0] = 1;
    let mut i = 0;
    while i < PARITY {
        // Multiply the i + 1 coefficients so far by (x − α^i).
        let mut j = i + 1;
        while j > 0 {
            g[j] ^= mul(g[j - 1], GF.0[i]);
            j -= 1;
        }
        i += 1;
    }
    g
};

fn parity(block: &[u8]) -> [u8; PARITY] {
    let mut parity = [0u8; PARITY];
    for &byte in block {
        let factor = byte ^ parity[0];
        parity.copy_within(1.., 0);
        parity[PARITY - 1] = 0;
        if factor != 0 {
            for (j, value) in parity.iter_mut().enumerate() {
                *value ^= mul(GENERATOR[j + 1], factor);
            }
        }
    }
    parity
}

/// The codeword bytes an N-cell grid holds, its block lengths and its data bytes.
fn layout(cells: usize) -> (usize, Vec<usize>, usize) {
    let capacity = (cells - 2) * (cells - 2) / 4;
    let blocks = capacity.div_ceil(255);
    let lengths = (0..blocks)
        .map(|index| capacity / blocks + usize::from(index < capacity % blocks))
        .collect();
    (capacity, lengths, capacity - blocks * PARITY)
}

/// The colour's chroma on the level's luma, scaled by the largest s/16 that keeps every channel in
/// 0–255; each scaled difference is truncated toward zero.
fn pixel(colour: [i32; 3], level: usize) -> [u8; 3] {
    let target = LEVELS[level];
    let own = (77 * colour[0] + 150 * colour[1] + 29 * colour[2]) >> 8;
    (0..=16)
        .rev()
        .find_map(|scale| {
            let pixel = colour.map(|channel| {
                let difference = channel - own;
                target + difference.signum() * ((difference.abs() * scale) >> 4)
            });
            pixel
                .iter()
                .all(|channel| (0..=255).contains(channel))
                .then(|| pixel.map(|channel| channel as u8))
        })
        .expect("scale 0 is the level's grey")
}

/// Paints `data` as a grid coloured by `palette`: its width (and height) and RGBA bytes, or
/// `None` when no grid holds the data.
pub(super) fn paint(data: &[u8], palette: &[[u8; 3]]) -> Option<(u32, Vec<u8>)> {
    let cells = (15..=127)
        .step_by(2)
        .find(|&cells| layout(cells).2 >= data.len())?;
    let (capacity, lengths, data_bytes) = layout(cells);
    let mut padded = data.to_vec();
    padded.extend((0..data_bytes - data.len()).map(|i| if i % 2 == 1 { 0x11 } else { 0xec }));
    let mut codewords = Vec::new();
    let mut offset = 0;
    for length in &lengths {
        let block = &padded[offset..offset + length - PARITY];
        offset += block.len();
        let mut codeword = block.to_vec();
        codeword.extend_from_slice(&parity(block));
        codewords.push(codeword);
    }
    // Interleave the blocks byte by byte, then whiten the stream so a uniform area never reads as
    // the all-zero codeword.
    let longest = lengths.iter().copied().max().unwrap_or(0);
    let stream: Vec<u8> = (0..longest)
        .flat_map(|i| {
            codewords
                .iter()
                .filter_map(move |codeword| codeword.get(i).copied())
        })
        .enumerate()
        .map(|(i, byte)| byte ^ ((i * 151 + 77) & 255) as u8)
        .collect();
    let span = cells - 1;
    let denominator = span * span;
    let last = palette.len() - 1;
    let mut pixels = Vec::with_capacity(cells * cells);
    for y in 0..cells {
        for x in 0..cells {
            if x == 0 || y == 0 || x == span || y == span {
                let grey = if (x + y) % 2 == 1 { 255 } else { 0 };
                pixels.push([grey; 3]);
                continue;
            }
            let symbol = (y - 1) * (cells - 2) + x - 1;
            let index = symbol >> 2;
            let level = if index < capacity {
                SYMBOL_LEVEL[usize::from((stream[index] >> (6 - 2 * (symbol & 3))) & 3)]
            } else {
                0
            };
            let position = (x * (span - y) + (span - x) * y) * last;
            let start = position / denominator;
            let remainder = position - start * denominator;
            let (from, to) = (palette[start], palette[(start + 1).min(last)]);
            let colour: [i32; 3] = std::array::from_fn(|c| {
                ((usize::from(from[c]) * (denominator - remainder)
                    + usize::from(to[c]) * remainder)
                    / denominator) as i32
            });
            pixels.push(pixel(colour, level));
        }
    }
    let cell_size = 2 * (512 / 2 / cells);
    let width = cells * cell_size;
    let mut rgba = Vec::with_capacity(width * width * 4);
    for y in 0..width {
        for x in 0..width {
            rgba.extend_from_slice(&pixels[(y / cell_size) * cells + x / cell_size]);
            rgba.push(255);
        }
    }
    Some((width as u32, rgba))
}

/// 8-bit RGBA rows without filtering in stored deflate blocks, so every SDK writes the same bytes.
pub(super) fn png(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    let stride = width as usize * 4;
    let mut raw = Vec::with_capacity((stride + 1) * height as usize);
    for row in rgba.chunks(stride) {
        raw.push(0);
        raw.extend_from_slice(row);
    }
    let mut zlib = vec![0x78, 0x01];
    let blocks = raw.chunks(65535);
    let count = blocks.len();
    for (index, block) in blocks.enumerate() {
        let length = block.len() as u16;
        zlib.push(u8::from(index + 1 == count));
        zlib.extend_from_slice(&length.to_le_bytes());
        zlib.extend_from_slice(&(!length).to_le_bytes());
        zlib.extend_from_slice(block);
    }
    zlib.extend_from_slice(&adler32(&raw).to_be_bytes());
    let mut header = width.to_be_bytes().to_vec();
    header.extend_from_slice(&height.to_be_bytes());
    header.extend_from_slice(&[8, 6, 0, 0, 0]);
    let mut png = vec![137, 80, 78, 71, 13, 10, 26, 10];
    for (kind, data) in [(b"IHDR", &header), (b"IDAT", &zlib), (b"IEND", &Vec::new())] {
        png.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let start = png.len();
        png.extend_from_slice(kind);
        png.extend_from_slice(data);
        let crc = crc32(&png[start..]);
        png.extend_from_slice(&crc.to_be_bytes());
    }
    png
}

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &byte in data {
        a = (a + u32::from(byte)) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

const CRC_TABLE: [u32; 256] = {
    let mut table = [0u32; 256];
    let mut n = 0;
    while n < 256 {
        let mut c = n as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 == 1 {
                0xEDB8_8320 ^ (c >> 1)
            } else {
                c >> 1
            };
            k += 1;
        }
        table[n] = c;
        n += 1;
    }
    table
};

fn crc32(data: &[u8]) -> u32 {
    !data.iter().fold(!0u32, |crc, &byte| {
        CRC_TABLE[((crc ^ u32::from(byte)) & 255) as usize] ^ (crc >> 8)
    })
}
