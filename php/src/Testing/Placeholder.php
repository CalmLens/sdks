<?php

declare(strict_types=1);

namespace CalmLens\Testing;

/**
 * Renders a ThumbHash as the small PNG the CDN serves for an asset's `placeholder` resource
 * (a port of the ThumbHash reference decoder and its uncompressed PNG writer). @internal
 */
final class Placeholder
{
    /** @return string the PNG bytes for a base64 ThumbHash. */
    public static function png(string $thumbhash): string
    {
        [$w, $h, $rgba] = self::rgba(array_values(unpack('C*', base64_decode($thumbhash, true))));
        return self::encodePng($w, $h, $rgba);
    }

    private static function rgba(array $hash): array
    {
        $header24 = $hash[0] | ($hash[1] << 8) | ($hash[2] << 16);
        $header16 = $hash[3] | ($hash[4] << 8);
        $lDc = ($header24 & 63) / 63;
        $pDc = (($header24 >> 6) & 63) / 31.5 - 1;
        $qDc = (($header24 >> 12) & 63) / 31.5 - 1;
        $lScale = (($header24 >> 18) & 31) / 31;
        $hasAlpha = $header24 >> 23;
        $pScale = (($header16 >> 3) & 63) / 63;
        $qScale = (($header16 >> 9) & 63) / 63;
        $isLandscape = $header16 >> 15;
        $lx = max(3, $isLandscape ? ($hasAlpha ? 5 : 7) : $header16 & 7);
        $ly = max(3, $isLandscape ? $header16 & 7 : ($hasAlpha ? 5 : 7));
        $aDc = $hasAlpha ? ($hash[5] & 15) / 15 : 1;
        $aScale = ($hash[5] >> 4) / 15;

        // The varying factors, with saturation boosted 1.25x to compensate for quantization.
        $acStart = $hasAlpha ? 6 : 5;
        $acIndex = 0;
        $decode = function (int $nx, int $ny, float $scale) use ($hash, $acStart, &$acIndex): array {
            $ac = [];
            for ($cy = 0; $cy < $ny; $cy++) {
                for ($cx = $cy ? 0 : 1; $cx * $ny < $nx * ($ny - $cy); $cx++) {
                    $ac[] = ((($hash[$acStart + ($acIndex >> 1)] >> (($acIndex & 1) << 2)) & 15) / 7.5 - 1) * $scale;
                    $acIndex++;
                }
            }
            return $ac;
        };
        $lAc = $decode($lx, $ly, $lScale);
        $pAc = $decode(3, 3, $pScale * 1.25);
        $qAc = $decode(3, 3, $qScale * 1.25);
        $aAc = $hasAlpha ? $decode(5, 5, $aScale) : [];

        // The approximate aspect ratio picks a size of at most 32 by 32.
        $ratioLx = ($hash[4] & 0x80) ? (($hash[2] & 0x80) ? 5 : 7) : $hash[3] & 7;
        $ratioLy = ($hash[4] & 0x80) ? $hash[3] & 7 : (($hash[2] & 0x80) ? 5 : 7);
        $ratio = $ratioLx / $ratioLy;
        $w = (int) self::round($ratio > 1 ? 32 : 32 * $ratio);
        $h = (int) self::round($ratio > 1 ? 32 / $ratio : 32);
        $rgba = [];
        $fx = [];
        $fy = [];
        for ($y = 0; $y < $h; $y++) {
            for ($x = 0; $x < $w; $x++) {
                $l = $lDc;
                $p = $pDc;
                $q = $qDc;
                $a = $aDc;
                for ($cx = 0, $n = max($lx, $hasAlpha ? 5 : 3); $cx < $n; $cx++) {
                    $fx[$cx] = cos(M_PI / $w * ($x + 0.5) * $cx);
                }
                for ($cy = 0, $n = max($ly, $hasAlpha ? 5 : 3); $cy < $n; $cy++) {
                    $fy[$cy] = cos(M_PI / $h * ($y + 0.5) * $cy);
                }
                for ($cy = 0, $j = 0; $cy < $ly; $cy++) {
                    for ($cx = $cy ? 0 : 1, $fy2 = $fy[$cy] * 2; $cx * $ly < $lx * ($ly - $cy); $cx++, $j++) {
                        $l += $lAc[$j] * $fx[$cx] * $fy2;
                    }
                }
                for ($cy = 0, $j = 0; $cy < 3; $cy++) {
                    for ($cx = $cy ? 0 : 1, $fy2 = $fy[$cy] * 2; $cx < 3 - $cy; $cx++, $j++) {
                        $f = $fx[$cx] * $fy2;
                        $p += $pAc[$j] * $f;
                        $q += $qAc[$j] * $f;
                    }
                }
                if ($hasAlpha) {
                    for ($cy = 0, $j = 0; $cy < 5; $cy++) {
                        for ($cx = $cy ? 0 : 1, $fy2 = $fy[$cy] * 2; $cx < 5 - $cy; $cx++, $j++) {
                            $a += $aAc[$j] * $fx[$cx] * $fy2;
                        }
                    }
                }
                $b = $l - 2 / 3 * $p;
                $r = (3 * $l - $b + $q) / 2;
                $g = $r - $q;
                // Like a Uint8Array store: truncated towards zero.
                foreach ([$r, $g, $b, $a] as $channel) {
                    $rgba[] = (int) max(0, 255 * min(1, $channel));
                }
            }
        }
        return [$w, $h, $rgba];
    }

    /** JavaScript's Math.round: halves round up. */
    private static function round(float $value): float
    {
        return floor($value + 0.5);
    }

    /** An uncompressed (stored deflate block per row) RGBA PNG. */
    private static function encodePng(int $w, int $h, array $rgba): string
    {
        $row = $w * 4 + 1;
        $a = 1;
        $b = 0;
        $data = "\x78\x01";
        for ($y = 0, $i = 0; $y < $h; $y++) {
            $data .= chr($y + 1 < $h ? 0 : 1) . pack('v', $row) . pack('v', ~$row & 0xffff) . "\0";
            $b = ($b + $a) % 65521;
            for ($end = $i + $row - 1; $i < $end; $i++) {
                $u = $rgba[$i] & 255;
                $data .= chr($u);
                $a = ($a + $u) % 65521;
                $b = ($b + $a) % 65521;
            }
        }
        $data .= pack('n', $b) . pack('n', $a);
        $chunk = fn (string $type, string $body) => pack('N', strlen($body)) . $type . $body . pack('N', crc32($type . $body));
        return "\x89PNG\r\n\x1a\n"
            . $chunk('IHDR', pack('NN', $w, $h) . "\x08\x06\x00\x00\x00")
            . $chunk('IDAT', $data)
            . $chunk('IEND', '');
    }
}
