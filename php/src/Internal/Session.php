<?php

declare(strict_types=1);

namespace CalmLens\Internal;

use CalmLens\CalmLensException;
use CalmLens\Version;
use GuzzleHttp\Client;
use GuzzleHttp\ClientInterface;
use GuzzleHttp\Exception\TransferException;
use GuzzleHttp\Psr7\Request;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\StreamInterface;

/** @internal */
final class Session
{
    private ClientInterface $http;
    /** Sleeps for a number of seconds; replaced by the mock so waits take no real time. */
    public \Closure $sleep;
    /** Monotonic seconds; replaced by the mock together with `sleep`. */
    public \Closure $clock;

    public function __construct(
        #[\SensitiveParameter] private string $apiKey,
        public readonly string $projectId,
        public readonly string $baseUrl,
        public readonly string $cdnBaseUrl,
        private array $defaults,
        ?ClientInterface $http = null,
    ) {
        $this->http = $http ?? new Client();
        $this->sleep = static function (float $seconds): void { usleep((int) ($seconds * 1_000_000)); };
        $this->clock = static fn (): float => hrtime(true) / 1e9;
        self::validateOptions($defaults, 'sdk/invalid-config');
    }

    public function __debugInfo(): array { return ['projectId' => $this->projectId]; }
    public function project(string $path): string { return '/projects/' . Values::segment($this->projectId) . '/' . $path; }

    private static function validateOptions(array $options, string $code = 'sdk/invalid-argument'): void
    {
        foreach (['timeout', 'connectTimeout'] as $key) {
            if (isset($options[$key]) && (!is_numeric($options[$key]) || !is_finite((float) $options[$key]) || $options[$key] <= 0)) {
                Values::invalid("$key must be positive", $code);
            }
        }
        if (isset($options['maxRetries']) && (!is_int($options['maxRetries']) || $options['maxRetries'] < 0)) {
            Values::invalid('maxRetries must be a non-negative integer', $code);
        }
        if (isset($options['idempotencyKey']) && (!is_string($options['idempotencyKey']) || !preg_match('/^[\x21-\x7e]+$/D', $options['idempotencyKey']))) {
            Values::invalid('Invalid idempotency key', $code);
        }
    }

    public function request(string $method, string $path, array $query = [], mixed $body = null,
        ?StreamInterface $raw = null, array $headers = [], bool $idempotent = false, array $options = []): mixed
    {
        $url = $this->baseUrl . $path;
        $params = Values::query($query);
        if ($params !== '') {
            $url .= '?' . $params;
        }
        $headers['Accept'] = 'application/json';
        if ($body !== null) {
            $raw = \GuzzleHttp\Psr7\Utils::streamFor(Values::json($body));
            $headers['Content-Type'] = 'application/json';
        }
        if ($raw !== null) {
            $headers['Content-Length'] = (string) $raw->getSize();
        }
        if ($idempotent || isset($options['idempotencyKey'])) {
            $headers['Idempotency-Key'] = $options['idempotencyKey'] ?? Values::uuid();
        }
        $response = $this->execute($method, $url, $headers, $raw, $options);
        $status = $response->getStatusCode();
        if ($status < 200 || $status >= 300) {
            throw $this->apiError($response);
        }
        $bytes = $this->readBounded($response, 32 * 1024 * 1024);
        $deleting = $method === 'DELETE' && !str_ends_with($path, '/content');
        if ($bytes === '' && $deleting) {
            return null;
        }
        try {
            $data = json_decode($bytes, true, 512, JSON_THROW_ON_ERROR);
            if (!is_array($data) && !($deleting && $data === null)) {
                throw new \JsonException('Expected an object or array');
            }
            return $data;
        } catch (\JsonException) {
            throw CalmLensException::create('sdk/invalid-response', 'API response is not JSON', $status);
        }
    }

    public function cdn(string $method, string $url, array $headers, array $options): ResponseInterface
    {
        return $this->execute($method, $url, $headers, null, $options, true);
    }

    private function execute(string $method, string $url, array $headers, ?StreamInterface $body, array $options, bool $stream = false): ResponseInterface
    {
        self::validateOptions($options);
        $options += $this->defaults;
        foreach ($headers as $key => $_) {
            if (in_array(strtolower($key), ['x-api-key', 'user-agent'], true)) {
                unset($headers[$key]);
            }
        }
        $headers['X-Api-Key'] = $this->apiKey;
        $headers['User-Agent'] = 'calmlens-php/' . Version::VERSION;
        $safe = in_array($method, ['GET', 'HEAD'], true) || isset($headers['Idempotency-Key']);
        for ($attempt = 0; ; $attempt++) {
            try {
                $response = $this->http->send(new Request($method, $url, $headers, $body), [
                    'http_errors' => false, 'allow_redirects' => false,
                    'timeout' => $options['timeout'], 'connect_timeout' => $options['connectTimeout'],
                    'read_timeout' => $options['timeout'], 'stream' => $stream,
                ]);
                $status = $response->getStatusCode();
                if ($status >= 200 && $status < 300) {
                    return $response;
                }
                // Streaming CDN responses remain caller-owned, including error responses.
                if ($stream) {
                    return $response;
                }
                $error = $this->apiError($response);
            } catch (\InvalidArgumentException $error) {
                throw CalmLensException::create('sdk/invalid-argument', $error->getMessage(), previous: $error);
            } catch (TransferException $error) {
                $context = method_exists($error, 'getHandlerContext') ? $error->getHandlerContext() : [];
                $timeout = ($context['errno'] ?? null) === 28;
                $error = CalmLensException::create($timeout ? 'sdk/timeout' : 'sdk/transport-error',
                    $timeout ? 'Request timed out' : 'Request failed', previous: $error);
            }
            if (!$safe || $attempt >= $options['maxRetries'] || !$error->isRetryable() || ($body !== null && !$body->isSeekable())) {
                throw $error;
            }
            $delay = $error->retryAfter() ?? min(0.5 * (2 ** min($attempt, 5)), 8) * random_int(0, 1000) / 1000;
            if ($delay > 60) {
                throw $error;
            }
            ($this->sleep)($delay);
            $body?->rewind();
        }
    }

    private function readBounded(ResponseInterface $response, int $limit): string
    {
        $stream = $response->getBody();
        $bytes = '';
        while (!$stream->eof() && strlen($bytes) <= $limit) {
            $chunk = $stream->read(min(8192, $limit + 1 - strlen($bytes)));
            if ($chunk === '' && !$stream->eof()) {
                throw CalmLensException::create('sdk/invalid-response', 'Response body stopped before EOF');
            }
            $bytes .= $chunk;
        }
        if (strlen($bytes) > $limit) {
            throw CalmLensException::create('sdk/response-too-large', 'Response body exceeds the SDK limit');
        }
        return $bytes;
    }

    private function apiError(ResponseInterface $response): CalmLensException
    {
        try {
            $data = json_decode($this->readBounded($response, 1024 * 1024), true);
        } catch (CalmLensException) {
            $data = null;
        }
        $details = is_array($data['details'] ?? null) ? $data['details'] : [];
        $details['network'] = true;
        if (isset($data['traceId'])) {
            $details['traceId'] = $data['traceId'];
        }
        return CalmLensException::create(
            is_string($data['code'] ?? null) ? $data['code'] : 'sdk/http-error',
            is_string($data['message'] ?? null) ? $data['message'] : 'HTTP ' . $response->getStatusCode(),
            $response->getStatusCode(), $details, $response->getHeaders(),
        );
    }
}
