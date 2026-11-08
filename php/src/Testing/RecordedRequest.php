<?php

declare(strict_types=1);

namespace CalmLens\Testing;

use CalmLens\Internal\UploadForm;
use Psr\Http\Message\RequestInterface;

/** One request a mock client sent, with the status it was answered with. */
final class RecordedRequest
{
    /**
     * @param string $path the path after the API (or CDN) base URL, each segment decoded, such as
     *   `/assets/asset_5Gm2Rk8XqT3wLp9VbN4c` or `/projects/project-1/assets`.
     * @param array<string, string> $query the query parameters as sent, decoded, such as
     *   `['sort' => '-createdAt']`.
     * @param ?int $status the HTTP status of the response, or null when the request failed without one.
     * @param RequestInterface $request the PSR-7 request, with a readable body and its headers.
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query,
        public readonly ?int $status,
        public readonly RequestInterface $request,
    ) {
    }

    /** Records `$request`, relative to whichever of `$baseUrls` it was sent to. */
    public static function of(RequestInterface $request, ?int $status, string ...$baseUrls): self
    {
        $url = (string) $request->getUri()->withQuery('')->withFragment('');
        $path = $url;
        foreach ($baseUrls as $base) {
            $base = rtrim($base, '/');
            if ($url === $base || str_starts_with($url, $base . '/')) {
                $path = substr($url, strlen($base));
                break;
            }
        }
        return new self($request->getMethod(), '/' . implode('/', self::segments($path)), self::query($request->getUri()->getQuery()), $status, $request);
    }

    /**
     * The request body: null when empty; a JSON body decoded (plain text arrives as `['name' => …,
     * 'content' => ['plainText' => …, 'type' => …]]`); an upload form as `['options' => <decoded
     * options>, 'file' => <bytes>]`; otherwise its bytes, such as a later part's.
     */
    public function body(): mixed
    {
        $stream = $this->request->getBody();
        $bytes = (string) $stream;
        if ($stream->isSeekable()) {
            $stream->rewind();
        }
        if ($bytes === '') {
            return null;
        }
        $type = $this->request->getHeaderLine('Content-Type');
        if (strtolower(trim(explode(';', $type, 2)[0])) === 'application/json') {
            $data = json_decode($bytes, true);
            return json_last_error() === JSON_ERROR_NONE ? $data : $bytes;
        }
        try {
            $form = UploadForm::parse($type, $bytes);
        } catch (\UnexpectedValueException) {
            return $bytes;
        }
        return $form === null ? $bytes : ['options' => json_decode($form['options'], true), 'file' => $form['file']];
    }

    /** @return list<string> the decoded, non-empty segments of a path. */
    public static function segments(string $path): array
    {
        return array_map('rawurldecode', array_values(array_filter(explode('/', $path), fn ($part) => $part !== '')));
    }

    /** @return array<string, string> */
    private static function query(string $query): array
    {
        $pairs = [];
        foreach (explode('&', $query) as $pair) {
            if ($pair !== '') {
                [$key, $value] = explode('=', $pair, 2) + [1 => ''];
                $pairs[urldecode($key)] = urldecode($value);
            }
        }
        return $pairs;
    }
}
