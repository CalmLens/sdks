<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Model\ServedAssetInfo;
use GuzzleHttp\Psr7\Response;

/** A streaming PSR-7 response from Cdn::serve. */
final class CdnResponse extends Response
{
    /** Reads served image dimensions from the headers without consuming the body. */
    public function getAssetInfo(): ?ServedAssetInfo
    {
        $header = $this->getHeaderLine('X-CalmLens-Asset-Info') . ',';
        $pattern = <<<'REGEX'
~"(?:[^"\\]|\\.)*"|[",]~
REGEX;
        preg_match_all($pattern, $header, $delimiters, PREG_OFFSET_CAPTURE);
        $dimensions = [];
        $start = 0;
        foreach ($delimiters[0] as [$delimiter, $offset]) {
            if ($delimiter === '"') {
                return null;
            }
            if ($delimiter !== ',') {
                continue;
            }
            $member = trim(substr($header, $start, $offset - $start));
            $start = $offset + 1;
            $key = substr($member, 0, strcspn($member, "=; \t"));
            if ($key !== 'width' && $key !== 'height') {
                continue;
            }
            if (isset($dimensions[$key]) || !preg_match('/^[a-z]+=([0-9]{1,15})$/D', $member, $match)) {
                return null;
            }
            $size = (int) $match[1];
            if ($size === 0 || (string) $size !== ltrim($match[1], '0')) {
                return null;
            }
            $dimensions[$key] = $size;
        }
        return isset($dimensions['width'], $dimensions['height'])
            ? new ServedAssetInfo($dimensions['width'], $dimensions['height'])
            : null;
    }
}
