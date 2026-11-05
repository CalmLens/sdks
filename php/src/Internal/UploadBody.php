<?php

declare(strict_types=1);

namespace CalmLens\Internal;

use CalmLens\ErrorCodes;
use GuzzleHttp\Psr7\Utils;
use Psr\Http\Message\StreamInterface;

/** @internal */
final class UploadBody
{
    /** `$checkPartSize` refuses non-final multipart parts under 5 MiB before sending, as the API would. */
    public static function from(mixed $content, bool $multipart, bool $checkPartSize = true): StreamInterface
    {
        if (!is_array($content)) {
            Values::invalid('Content must be an array', ErrorCodes::INVALID_UPLOAD_PAYLOAD);
        }
        $keys = array_values(array_intersect(['plainText', 'base64', 'data', 'bytes'], array_keys($content)));
        if (count($keys) !== 1) {
            Values::invalid('Supply exactly one payload representation', ErrorCodes::INVALID_UPLOAD_PAYLOAD);
        }
        $kind = $keys[0];
        $value = $content[$kind];
        if ($kind === 'plainText' && !is_string($value)) {
            Values::invalid('plainText must be a string', ErrorCodes::INVALID_UPLOAD_PAYLOAD);
        }
        if ($kind === 'base64') {
            if (!is_string($value)) {
                Values::invalid('base64 must be a string', ErrorCodes::INVALID_UPLOAD_PAYLOAD);
            }
            $raw = preg_replace('/\s/', '', preg_replace('/^data:[^,]*;base64,/', '', $value));
            if (($multipart && strlen($raw) % 4 !== 0) || ($value = base64_decode($raw, true)) === false) {
                Values::invalid('Invalid base64; encode each part separately', ErrorCodes::INVALID_UPLOAD_PAYLOAD);
            }
        }
        if (!is_string($value) && !is_resource($value) && !$value instanceof StreamInterface) {
            Values::invalid('Expected bytes or a readable stream', ErrorCodes::INVALID_UPLOAD_PAYLOAD);
        }
        $stream = is_resource($value) ? new BorrowedResourceStream($value) : Utils::streamFor($value);
        if (!$stream->isReadable()) {
            Values::invalid('Stream is not readable', ErrorCodes::INVALID_UPLOAD_PAYLOAD);
        }
        $known = $stream->getSize();
        if ($known !== null && $stream->isSeekable()) {
            $known -= $stream->tell();
        } elseif (!$stream->isSeekable()) {
            $known = null;
        }
        $size = $content['sizeInBytes'] ?? $known;
        // A file stream may leave its size out; multipart parts need exact byte counts.
        if (($size !== null || $multipart) && (!is_int($size) || $size < 0 || ($known !== null && $size !== $known))) {
            Values::invalid('sizeInBytes must match the remaining bytes; required for unsized multipart streams', ErrorCodes::INVALID_UPLOAD_PAYLOAD);
        }
        if (isset($content['isFinal']) && !is_bool($content['isFinal'])) {
            Values::invalid('isFinal must be a boolean', ErrorCodes::INVALID_UPLOAD_PAYLOAD);
        }
        if ($checkPartSize && $multipart && !($content['isFinal'] ?? false) && $size < 5 * 1024 * 1024) {
            Values::invalid('Non-final parts must be at least 5MiB', ErrorCodes::INVALID_UPLOAD_PAYLOAD);
        }
        return new UploadStream($stream, $size);
    }
}
