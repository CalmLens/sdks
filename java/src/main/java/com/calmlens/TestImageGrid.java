package com.calmlens;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.zip.Adler32;
import java.util.zip.CRC32;

/**
 * The test image grid of {@code packages/shared/src/TestImageGrid.ts}, painted byte for byte: an odd
 * N×N grid with an alternating black-and-white ring, two Gray-coded bits per interior cell as one
 * of four luma levels (colour in chroma only), and Reed–Solomon parity over GF(256).
 */
final class TestImageGrid {
  private TestImageGrid() {}

  /** Target luma of the four data levels. */
  static final int[] LEVELS = {72, 128, 184, 240};
  private static final int[] SYMBOL_LEVEL = {0, 1, 3, 2};
  private static final int PARITY = 32;
  private static final int[] EXP = new int[512];
  private static final int[] LOG = new int[256];
  private static final int[] GENERATOR;

  static {
    // GF(256) with the polynomial 0x11d and generator 2.
    for (int i = 0, x = 1; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if ((x & 256) != 0) x ^= 0x11d;
    }
    for (int i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    int[] g = {1};
    for (int i = 0; i < PARITY; i++) {
      int[] next = new int[g.length + 1];
      for (int j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = next;
    }
    GENERATOR = g;
  }

  private static int mul(int a, int b) { return a == 0 || b == 0 ? 0 : EXP[LOG[a] + LOG[b]]; }

  private static int[] parity(int[] data, int from, int length) {
    int[] parity = new int[PARITY];
    for (int i = from; i < from + length; i++) {
      int factor = data[i] ^ parity[0];
      System.arraycopy(parity, 1, parity, 0, PARITY - 1);
      parity[PARITY - 1] = 0;
      if (factor != 0) for (int j = 0; j < PARITY; j++) parity[j] ^= mul(GENERATOR[j + 1], factor);
    }
    return parity;
  }

  /** Codeword bytes a grid of {@code cells} holds. */
  private static int capacity(int cells) { return (cells - 2) * (cells - 2) / 4; }

  private static int[] lengths(int capacity) {
    int blocks = (capacity + 254) / 255;
    int[] lengths = new int[blocks];
    for (int i = 0; i < blocks; i++) lengths[i] = capacity / blocks + (i < capacity % blocks ? 1 : 0);
    return lengths;
  }

  /**
   * The colour's chroma on the level's luma, scaled by the largest s/16 that keeps every channel in
   * 0–255; each scaled difference is truncated toward zero.
   */
  private static int[] pixel(int[] colour, int level) {
    int target = LEVELS[level];
    int own = (77 * colour[0] + 150 * colour[1] + 29 * colour[2]) >> 8;
    for (int scale = 16; ; scale--) {
      int[] pixel = new int[3];
      boolean inRange = true;
      for (int c = 0; c < 3; c++) {
        int difference = colour[c] - own;
        pixel[c] = target + Integer.signum(difference) * ((Math.abs(difference) * scale) >> 4);
        inRange &= pixel[c] >= 0 && pixel[c] <= 255;
      }
      if (inRange) return pixel;
    }
  }

  /** The grid's width (and height) and RGBA bytes, or null when no grid holds {@code data}. */
  static TestInputs.TestImage paint(byte[] data, List<int[]> palette) {
    int cells = 15;
    while (cells <= 127 && capacity(cells) - lengths(capacity(cells)).length * PARITY < data.length) cells += 2;
    if (cells > 127) return null;
    int capacity = capacity(cells);
    int[] lengths = lengths(capacity);
    int[] padded = new int[capacity - lengths.length * PARITY];
    for (int i = 0; i < padded.length; i++) padded[i] = i < data.length ? data[i] & 255 : (i - data.length) % 2 == 1 ? 0x11 : 0xec;
    int[][] codewords = new int[lengths.length][];
    int longest = 0;
    for (int b = 0, offset = 0; b < lengths.length; b++) {
      int length = lengths[b] - PARITY;
      codewords[b] = new int[lengths[b]];
      System.arraycopy(padded, offset, codewords[b], 0, length);
      System.arraycopy(parity(padded, offset, length), 0, codewords[b], length, PARITY);
      offset += length;
      longest = Math.max(longest, lengths[b]);
    }
    int[] stream = new int[capacity];
    int position = 0;
    for (int i = 0; i < longest; i++) for (int[] codeword : codewords) if (i < codeword.length) stream[position++] = codeword[i];
    // Whitening: a uniform area never reads as the all-zero codeword.
    for (int i = 0; i < capacity; i++) stream[i] ^= (i * 151 + 77) & 255;
    int span = cells - 1;
    int denominator = span * span;
    int last = palette.size() - 1;
    int[][] pixels = new int[cells * cells][];
    for (int y = 0; y < cells; y++)
      for (int x = 0; x < cells; x++) {
        if (x == 0 || y == 0 || x == span || y == span) {
          int grey = (x + y) % 2 == 1 ? 255 : 0;
          pixels[y * cells + x] = new int[] {grey, grey, grey};
          continue;
        }
        int symbol = (y - 1) * (cells - 2) + x - 1;
        int index = symbol >> 2;
        int level = index < capacity ? SYMBOL_LEVEL[(stream[index] >> (6 - 2 * (symbol & 3))) & 3] : 0;
        int blend = (x * (span - y) + (span - x) * y) * last;
        int start = blend / denominator;
        int remainder = blend - start * denominator;
        int[] from = palette.get(start);
        int[] to = palette.get(Math.min(start + 1, last));
        int[] colour = new int[3];
        for (int c = 0; c < 3; c++) colour[c] = (from[c] * (denominator - remainder) + to[c] * remainder) / denominator;
        pixels[y * cells + x] = pixel(colour, level);
      }
    int cellSize = 2 * (512 / 2 / cells);
    int width = cells * cellSize;
    byte[] rgba = new byte[width * width * 4];
    for (int y = 0, offset = 0; y < width; y++)
      for (int x = 0; x < width; x++) {
        int[] pixel = pixels[(y / cellSize) * cells + x / cellSize];
        rgba[offset++] = (byte) pixel[0];
        rgba[offset++] = (byte) pixel[1];
        rgba[offset++] = (byte) pixel[2];
        rgba[offset++] = (byte) 255;
      }
    return new TestInputs.TestImage(width, width, rgba, png(width, width, rgba));
  }

  /** 8-bit RGBA rows without filtering in stored deflate blocks, so every SDK writes the same bytes. */
  private static byte[] png(int width, int height, byte[] rgba) {
    int stride = width * 4;
    byte[] raw = new byte[(stride + 1) * height];
    for (int row = 0; row < height; row++) System.arraycopy(rgba, row * stride, raw, row * (stride + 1) + 1, stride);
    ByteArrayOutputStream zlib = new ByteArrayOutputStream();
    zlib.write(0x78);
    zlib.write(0x01);
    for (int offset = 0; offset < raw.length; offset += 65535) {
      int length = Math.min(65535, raw.length - offset);
      zlib.write(offset + length == raw.length ? 1 : 0);
      zlib.write(length & 255);
      zlib.write(length >> 8);
      zlib.write(~length & 255);
      zlib.write((~length >> 8) & 255);
      zlib.write(raw, offset, length);
    }
    Adler32 adler = new Adler32();
    adler.update(raw);
    zlib.writeBytes(ByteBuffer.allocate(4).putInt((int) adler.getValue()).array());
    ByteArrayOutputStream png = new ByteArrayOutputStream();
    png.writeBytes(new byte[] {(byte) 137, 80, 78, 71, 13, 10, 26, 10});
    chunk(png, "IHDR", ByteBuffer.allocate(13).putInt(width).putInt(height).put(new byte[] {8, 6, 0, 0, 0}).array());
    chunk(png, "IDAT", zlib.toByteArray());
    chunk(png, "IEND", new byte[0]);
    return png.toByteArray();
  }

  private static void chunk(ByteArrayOutputStream png, String type, byte[] data) {
    byte[] typed = new byte[data.length + 4];
    System.arraycopy(type.getBytes(StandardCharsets.US_ASCII), 0, typed, 0, 4);
    System.arraycopy(data, 0, typed, 4, data.length);
    CRC32 crc = new CRC32();
    crc.update(typed);
    png.writeBytes(ByteBuffer.allocate(4).putInt(data.length).array());
    png.writeBytes(typed);
    png.writeBytes(ByteBuffer.allocate(4).putInt((int) crc.getValue()).array());
  }
}
