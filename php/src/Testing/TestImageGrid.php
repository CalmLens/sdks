<?php

declare(strict_types=1);

namespace CalmLens\Testing;

/**
 * The test image grid of packages/shared/src/TestImageGrid.ts, painted byte for byte: an odd N×N
 * grid with an alternating black-and-white ring, two Gray-coded bits per interior cell as one of
 * four luma levels (colour in chroma only), and Reed–Solomon parity over GF(256).
 *
 * @internal
 */
final class TestImageGrid
{
    /** Target luma of the four data levels. */
    public const LEVELS = [72, 128, 184, 240];
    private const SYMBOL_LEVEL = [0, 1, 3, 2];
    private const PARITY = 32;

    /** @var list<int> */
    private static array $exp = [];
    /** @var array<int, int> */
    private static array $log = [];
    /** @var list<int> */
    private static array $generator = [];

    private function __construct()
    {
    }

    private static function init(): void
    {
        if (self::$exp !== []) {
            return;
        }
        // GF(256) with the polynomial 0x11d and generator 2.
        $exp = array_fill(0, 512, 0);
        $log = array_fill(0, 256, 0);
        for ($i = 0, $x = 1; $i < 255; $i++) {
            $exp[$i] = $x;
            $log[$x] = $i;
            $x <<= 1;
            if ($x & 256) {
                $x ^= 0x11d;
            }
        }
        for ($i = 255; $i < 512; $i++) {
            $exp[$i] = $exp[$i - 255];
        }
        self::$exp = $exp;
        self::$log = $log;
        $g = [1];
        for ($i = 0; $i < self::PARITY; $i++) {
            $next = array_fill(0, count($g) + 1, 0);
            foreach ($g as $j => $coefficient) {
                $next[$j] ^= $coefficient;
                $next[$j + 1] ^= self::mul($coefficient, $exp[$i]);
            }
            $g = $next;
        }
        self::$generator = $g;
    }

    private static function mul(int $a, int $b): int
    {
        return $a === 0 || $b === 0 ? 0 : self::$exp[self::$log[$a] + self::$log[$b]];
    }

    /**
     * @param list<int> $block
     * @return list<int>
     */
    private static function parity(array $block): array
    {
        $parity = array_fill(0, self::PARITY, 0);
        foreach ($block as $byte) {
            $factor = $byte ^ $parity[0];
            array_shift($parity);
            $parity[] = 0;
            if ($factor !== 0) {
                for ($j = 0; $j < self::PARITY; $j++) {
                    $parity[$j] ^= self::mul(self::$generator[$j + 1], $factor);
                }
            }
        }
        return $parity;
    }

    /** @return array{int, list<int>, int} the codeword bytes a grid holds, its block lengths and its data bytes */
    private static function layout(int $cells): array
    {
        $capacity = intdiv(($cells - 2) * ($cells - 2), 4);
        $blocks = intdiv($capacity + 254, 255);
        $lengths = [];
        for ($i = 0; $i < $blocks; $i++) {
            $lengths[] = intdiv($capacity, $blocks) + ($i < $capacity % $blocks ? 1 : 0);
        }
        return [$capacity, $lengths, $capacity - $blocks * self::PARITY];
    }

    /**
     * The colour's chroma on the level's luma, scaled by the largest s/16 that keeps every channel
     * in 0–255; each scaled difference is truncated toward zero.
     *
     * @param array{int, int, int} $colour
     */
    private static function pixel(array $colour, int $level): string
    {
        $target = self::LEVELS[$level];
        $own = (77 * $colour[0] + 150 * $colour[1] + 29 * $colour[2]) >> 8;
        for ($scale = 16; ; $scale--) {
            $pixel = [];
            foreach ($colour as $channel) {
                $difference = $channel - $own;
                $magnitude = (abs($difference) * $scale) >> 4;
                $pixel[] = $difference < 0 ? $target - $magnitude : $target + $magnitude;
            }
            if (min($pixel) >= 0 && max($pixel) <= 255) {
                return pack('C4', $pixel[0], $pixel[1], $pixel[2], 255);
            }
        }
    }

    /**
     * Paints `$data` as a grid coloured by `$palette`: its width (and height) and RGBA bytes, or
     * null when no grid holds the data.
     *
     * @param list<array{int, int, int}> $palette
     * @return array{int, string}|null
     */
    public static function paint(string $data, array $palette): ?array
    {
        self::init();
        $cells = null;
        for ($size = 15; $size <= 127; $size += 2) {
            if (self::layout($size)[2] >= strlen($data)) {
                $cells = $size;
                break;
            }
        }
        if ($cells === null) {
            return null;
        }
        [$capacity, $lengths, $dataBytes] = self::layout($cells);
        $padded = array_values(unpack('C*', $data) ?: []);
        for ($i = 0; count($padded) < $dataBytes; $i++) {
            $padded[] = $i % 2 ? 0x11 : 0xec;
        }
        $codewords = [];
        $offset = 0;
        foreach ($lengths as $length) {
            $block = array_slice($padded, $offset, $length - self::PARITY);
            $offset += count($block);
            $codewords[] = [...$block, ...self::parity($block)];
        }
        $stream = [];
        for ($i = 0; $i < max($lengths); $i++) {
            foreach ($codewords as $codeword) {
                if ($i < count($codeword)) {
                    $stream[] = $codeword[$i];
                }
            }
        }
        // Whitening: a uniform area never reads as the all-zero codeword.
        foreach ($stream as $i => $byte) {
            $stream[$i] = $byte ^ (($i * 151 + 77) & 255);
        }
        $span = $cells - 1;
        $denominator = $span * $span;
        $last = count($palette) - 1;
        $cellSize = 2 * intdiv(intdiv(512, 2), $cells);
        $rows = '';
        for ($y = 0; $y < $cells; $y++) {
            $line = '';
            for ($x = 0; $x < $cells; $x++) {
                if ($x === 0 || $y === 0 || $x === $span || $y === $span) {
                    $grey = ($x + $y) % 2 ? 255 : 0;
                    $line .= str_repeat(pack('C4', $grey, $grey, $grey, 255), $cellSize);
                    continue;
                }
                $symbol = ($y - 1) * ($cells - 2) + $x - 1;
                $index = $symbol >> 2;
                $level = $index < $capacity ? self::SYMBOL_LEVEL[($stream[$index] >> (6 - 2 * ($symbol & 3))) & 3] : 0;
                $position = ($x * ($span - $y) + ($span - $x) * $y) * $last;
                $start = intdiv($position, $denominator);
                $remainder = $position - $start * $denominator;
                $from = $palette[$start];
                $to = $palette[min($start + 1, $last)];
                $colour = [0, 0, 0];
                for ($c = 0; $c < 3; $c++) {
                    $colour[$c] = intdiv($from[$c] * ($denominator - $remainder) + $to[$c] * $remainder, $denominator);
                }
                $line .= str_repeat(self::pixel($colour, $level), $cellSize);
            }
            $rows .= str_repeat($line, $cellSize);
        }
        return [$cells * $cellSize, $rows];
    }

    /** 8-bit RGBA rows without filtering in stored deflate blocks, so every SDK writes the same bytes. */
    public static function png(int $width, int $height, string $rgba): string
    {
        $stride = $width * 4;
        $raw = '';
        for ($row = 0; $row < $height; $row++) {
            $raw .= "\0" . substr($rgba, $row * $stride, $stride);
        }
        $stream = "\x78\x01";
        foreach (str_split($raw, 65535) as $offset => $block) {
            $size = strlen($block);
            $stream .= pack('Cvv', ($offset + 1) * 65535 >= strlen($raw) ? 1 : 0, $size, ~$size & 0xFFFF) . $block;
        }
        $stream .= hash('adler32', $raw, true);
        $chunk = static fn (string $type, string $body): string => pack('N', strlen($body)) . $type . $body . pack('N', crc32($type . $body));
        return "\x89PNG\r\n\x1a\n" . $chunk('IHDR', pack('NNC5', $width, $height, 8, 6, 0, 0, 0))
            . $chunk('IDAT', $stream) . $chunk('IEND', '');
    }
}
