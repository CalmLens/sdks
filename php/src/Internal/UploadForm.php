<?php

declare(strict_types=1);

namespace CalmLens\Internal;

use GuzzleHttp\Psr7\AppendStream;
use GuzzleHttp\Psr7\StreamDecoratorTrait;
use GuzzleHttp\Psr7\Utils;
use Psr\Http\Message\StreamInterface;

/**
 * An upload form: `multipart/form-data` with the asset's fields as the JSON `options` part, then
 * the bytes as the `file` part. Asset fields never go in the URL, which proxies and servers log.
 *
 * @internal
 */
final class UploadForm
{
    /** The asset fields an upload carries in its body (the form's options, or the JSON of plain text): the API refuses them in the query. */
    public const FIELDS = ['name', 'description', 'processingOptions', 'visibility', 'metadata', 'tags', 'authorId',
        'context', 'externalId', 'externalUrl', 'folderId', 'uploadPresetId'];

    /**
     * The form around `$file`, which is still read as the form is sent: seekable (and so retried)
     * only when `$file` is, and sized only when `$file` is.
     *
     * @return array{0: StreamInterface, 1: string} the body and its Content-Type
     */
    public static function build(array $options, string $mime, StreamInterface $file): array
    {
        $boundary = 'calmlens-' . Values::uuid();
        $head = "--$boundary\r\nContent-Disposition: form-data; name=\"options\"\r\nContent-Type: application/json\r\n\r\n"
            . Values::json((object) $options)
            . "\r\n--$boundary\r\nContent-Disposition: form-data; name=\"file\"\r\nContent-Type: $mime\r\n\r\n";
        $parts = new AppendStream([Utils::streamFor($head), $file, Utils::streamFor("\r\n--$boundary--\r\n")]);
        // Reading a one-shot form as a string reads it once, as for other streams, instead of failing to rewind.
        $body = new class ($parts) implements StreamInterface {
            use StreamDecoratorTrait;

            public function __construct(private StreamInterface $stream) {}
        };
        return [$body, "multipart/form-data; boundary=$boundary"];
    }

    /**
     * Reads an upload form as the API does: an `options` part, then a `file` part, then the closing
     * boundary. Returns null when `$contentType` isn't `multipart/form-data`; throws
     * `\UnexpectedValueException` for a form the API refuses.
     *
     * @return ?array{options: string, file: string, fileType: ?string}
     */
    public static function parse(string $contentType, string $body): ?array
    {
        if (strtolower(trim(explode(';', $contentType, 2)[0])) !== 'multipart/form-data') {
            return null;
        }
        if (!preg_match('/;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i', $contentType, $match)) {
            throw new \UnexpectedValueException('The multipart/form-data Content-Type needs a boundary');
        }
        $delimiter = "\r\n--" . ($match[1] !== '' ? $match[1] : $match[2]);
        $body = "\r\n" . $body;
        $parts = [];
        $at = strpos($body, $delimiter);
        while ($at !== false) {
            $start = $at + strlen($delimiter);
            if (substr($body, $start, 2) === '--') {
                break;
            }
            $headerEnd = strpos($body, "\r\n\r\n", $start);
            $next = $headerEnd === false ? false : strpos($body, $delimiter, $headerEnd + 4);
            if ($next === false) {
                throw new \UnexpectedValueException('The upload body ended before its closing boundary');
            }
            $headers = substr($body, $start, $headerEnd - $start);
            preg_match('/content-disposition:\s*form-data\s*;[^\r\n]*?\bname="([^"]*)"/i', $headers, $name);
            preg_match('/content-type:\s*([^\r\n]*)/i', $headers, $type);
            $parts[] = ['name' => $name[1] ?? null, 'type' => isset($type[1]) ? trim($type[1]) : null,
                'content' => substr($body, $headerEnd + 4, $next - $headerEnd - 4)];
            $at = $next;
        }
        if ($at === false) {
            throw new \UnexpectedValueException('The upload body ended before its closing boundary');
        }
        if (count($parts) !== 2 || $parts[0]['name'] !== 'options' || $parts[1]['name'] !== 'file') {
            throw new \UnexpectedValueException('The upload form must hold an options part, then a file part');
        }
        return ['options' => $parts[0]['content'], 'file' => $parts[1]['content'], 'fileType' => $parts[1]['type']];
    }
}
