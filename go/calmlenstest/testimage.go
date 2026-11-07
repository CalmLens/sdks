package calmlenstest

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"hash/adler32"
	"hash/crc32"
	"slices"
	"strings"
)

// TestImage is a painted test image: Width × Height pixels of 8-bit RGBA in RGBA, row by row, and
// the same image as PNG bytes to upload.
type TestImage struct {
	Width, Height int
	RGBA          []byte
	PNG           []byte
}

// testInputColors are the category colours, carried in a test image's chroma only.
var testInputColors = map[string][3]int{
	"sexual":               {232, 80, 160},
	"violence":             {224, 56, 64},
	"self-harm":            {24, 168, 152},
	"harassment":           {240, 128, 48},
	"hate":                 {144, 80, 216},
	"criminal-activity":    {224, 184, 40},
	"personal-information": {48, 128, 224},
	"profanity":            {136, 192, 48},
}

// PaintTestImage paints a scenario's signed test image: a grid that survives lossy formats and
// resizing. Upload its PNG bytes, or encode its RGBA in any format. CalmLens recognises it only as
// the whole upload (a plain single-colour border aside) in a project with test inputs turned on.
// Like a text code it expires, a day from now unless options set ExpiresAt, so paint it when the
// test runs. Use TestInputForSignal with TestInputImage for a signal's scenario. testInputKey is
// the project's secret test input key from the portal. An invalid key, scenario or expiry, or a
// scenario too large for a test image, is an sdk/invalid-argument error.
func PaintTestImage(input TestInput, testInputKey string, options *TestInputCodeOptions) (*TestImage, error) {
	code, err := GenerateTestTextCode(input, testInputKey, options)
	if err != nil {
		return nil, err
	}
	fields := strings.Fields(strings.TrimSuffix(code, ">"))
	tag, _ := hex.DecodeString(fields[1])
	signed, _ := base64.RawURLEncoding.DecodeString(fields[2])
	data := append(append([]byte{byte(len(signed) >> 8), byte(len(signed))}, tag...), signed...)
	var palette [][3]int
	for _, instance := range input.Instances {
		if color := testInputColors[instance.Category]; !slices.Contains(palette, color) {
			palette = append(palette, color)
		}
	}
	if palette == nil {
		palette = [][3]int{{144, 152, 160}}
	}
	width, rgba, ok := paintTestImageGrid(data, palette)
	if !ok {
		return nil, invalidTestInput("Test scenario is too large for a test image")
	}
	return &TestImage{Width: width, Height: width, RGBA: rgba, PNG: encodeTestImagePNG(width, width, rgba)}, nil
}

// The grid of packages/shared/src/TestImageGrid.ts: Reed–Solomon over GF(256) (0x11d, α = 2) with
// 32 parity bytes per block, interleaved and whitened, two Gray-coded bits per cell as one of four luma levels.
const testImageGridParity = 32

var (
	testImageGridLevels      = [4]int{72, 128, 184, 240}
	testImageGridSymbolLevel = [4]int{0, 1, 3, 2}
	gfExp, gfLog             = func() (exp [512]int, log [256]int) {
		for i, x := 0, 1; i < 255; i++ {
			exp[i], log[x] = x, i
			if x <<= 1; x&256 != 0 {
				x ^= 0x11d
			}
		}
		for i := 255; i < 512; i++ {
			exp[i] = exp[i-255]
		}
		return
	}()
	testImageGridGenerator = func() []int {
		g := []int{1}
		for i := range testImageGridParity {
			next := make([]int, len(g)+1)
			for j, coefficient := range g {
				next[j] ^= coefficient
				next[j+1] ^= gfMul(coefficient, gfExp[i])
			}
			g = next
		}
		return g
	}()
)

func gfMul(a, b int) int {
	if a == 0 || b == 0 {
		return 0
	}
	return gfExp[gfLog[a]+gfLog[b]]
}

func reedSolomonParity(block []byte) []byte {
	parity := make([]int, testImageGridParity)
	for _, b := range block {
		factor := int(b) ^ parity[0]
		copy(parity, parity[1:])
		parity[testImageGridParity-1] = 0
		if factor != 0 {
			for j := range parity {
				parity[j] ^= gfMul(testImageGridGenerator[j+1], factor)
			}
		}
	}
	out := make([]byte, len(parity))
	for i, p := range parity {
		out[i] = byte(p)
	}
	return out
}

func testImageGridLayout(cells int) (capacity int, lengths []int, dataBytes int) {
	capacity = (cells - 2) * (cells - 2) / 4
	blocks := (capacity + 254) / 255
	for i := range blocks {
		length := capacity / blocks
		if i < capacity%blocks {
			length++
		}
		lengths = append(lengths, length)
	}
	return capacity, lengths, capacity - blocks*testImageGridParity
}

// testImageGridPixel puts the colour's chroma on the level's luma, scaled by the largest s/16
// that keeps every channel in 0–255, truncating each scaled difference toward zero.
func testImageGridPixel(color [3]int, level int) [3]int {
	target := testImageGridLevels[level]
	own := (77*color[0] + 150*color[1] + 29*color[2]) >> 8
	for scale := 16; ; scale-- {
		var pixel [3]int
		inRange := true
		for c, channel := range color {
			difference := channel - own
			if difference < 0 {
				pixel[c] = target - (-difference*scale)>>4
			} else {
				pixel[c] = target + (difference*scale)>>4
			}
			inRange = inRange && pixel[c] >= 0 && pixel[c] <= 255
		}
		if inRange {
			return pixel
		}
	}
}

func paintTestImageGrid(data []byte, palette [][3]int) (width int, rgba []byte, ok bool) {
	cells := 15
	for ; cells <= 127; cells += 2 {
		if _, _, dataBytes := testImageGridLayout(cells); dataBytes >= len(data) {
			break
		}
	}
	if cells > 127 {
		return 0, nil, false
	}
	capacity, lengths, dataBytes := testImageGridLayout(cells)
	padded := slices.Clone(data)
	for i := 0; len(padded) < dataBytes; i++ {
		padded = append(padded, []byte{0xec, 0x11}[i%2])
	}
	var codewords [][]byte
	offset := 0
	for _, length := range lengths {
		block := padded[offset : offset+length-testImageGridParity]
		offset += len(block)
		codewords = append(codewords, append(slices.Clone(block), reedSolomonParity(block)...))
	}
	stream := make([]byte, 0, capacity)
	for i := range slices.Max(lengths) {
		for _, codeword := range codewords {
			if i < len(codeword) {
				stream = append(stream, codeword[i])
			}
		}
	}
	// Whitening: a uniform area never reads as the all-zero codeword.
	for i := range stream {
		stream[i] ^= byte((i*151 + 77) & 255)
	}
	span := cells - 1
	denominator := span * span
	last := len(palette) - 1
	pixels := make([][3]int, 0, cells*cells)
	for y := range cells {
		for x := range cells {
			if x == 0 || y == 0 || x == span || y == span {
				grey := 255 * ((x + y) % 2)
				pixels = append(pixels, [3]int{grey, grey, grey})
				continue
			}
			symbol := (y-1)*(cells-2) + x - 1
			level := 0
			if index := symbol >> 2; index < capacity {
				level = testImageGridSymbolLevel[(int(stream[index])>>(6-2*(symbol&3)))&3]
			}
			position := (x*(span-y) + (span-x)*y) * last
			start := position / denominator
			remainder := position - start*denominator
			from, to := palette[start], palette[min(start+1, last)]
			var color [3]int
			for c := range color {
				color[c] = (from[c]*(denominator-remainder) + to[c]*remainder) / denominator
			}
			pixels = append(pixels, testImageGridPixel(color, level))
		}
	}
	cellSize := 2 * (512 / 2 / cells)
	width = cells * cellSize
	rgba = make([]byte, 0, width*width*4)
	for y := range width {
		for x := range width {
			pixel := pixels[(y/cellSize)*cells+x/cellSize]
			rgba = append(rgba, byte(pixel[0]), byte(pixel[1]), byte(pixel[2]), 255)
		}
	}
	return width, rgba, true
}

// encodeTestImagePNG writes 8-bit RGBA rows without filtering in stored deflate blocks, so every
// SDK writes the same bytes.
func encodeTestImagePNG(width, height int, rgba []byte) []byte {
	stride := width * 4
	raw := make([]byte, 0, (stride+1)*height)
	for row := range height {
		raw = append(append(raw, 0), rgba[row*stride:(row+1)*stride]...)
	}
	zlib := []byte{0x78, 0x01}
	for offset := 0; offset < len(raw); offset += 65535 {
		block := raw[offset:min(offset+65535, len(raw))]
		final := byte(0)
		if offset+len(block) == len(raw) {
			final = 1
		}
		n := uint16(len(block))
		zlib = append(append(zlib, final, byte(n), byte(n>>8), byte(^n), byte(^n>>8)), block...)
	}
	zlib = binary.BigEndian.AppendUint32(zlib, adler32.Checksum(raw))
	png := []byte{137, 80, 78, 71, 13, 10, 26, 10}
	chunk := func(kind string, data []byte) {
		png = binary.BigEndian.AppendUint32(png, uint32(len(data)))
		start := len(png)
		png = append(append(png, kind...), data...)
		png = binary.BigEndian.AppendUint32(png, crc32.ChecksumIEEE(png[start:]))
	}
	header := binary.BigEndian.AppendUint32(binary.BigEndian.AppendUint32(nil, uint32(width)), uint32(height))
	chunk("IHDR", append(header, 8, 6, 0, 0, 0))
	chunk("IDAT", zlib)
	chunk("IEND", nil)
	return png
}
