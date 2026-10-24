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
    /** Retry backoff before retry n (0-based): d = min(max, base * 2^n), waiting d/2 plus up to d/2 more. */
    public const RETRY_BASE_DELAY_MS = 500;
    public const RETRY_MAX_DELAY_MS = 8000;
    /** A `Retry-After` longer than this is returned to the caller instead of waited out. */
    public const RETRY_AFTER_MAX_MS = 60000;
    private const RETRYABLE_STATUSES = [429, 502, 503, 504];

    private ClientInterface $http;
    /** Sleeps for a number of seconds; replaced by the mock so waits take no real time. */
    public \Closure $sleep;
    /** Monotonic seconds; replaced by the mock together with `sleep`. */
    public \Closure $clock;
    /** Leaves multipart size checks to the API; set by the mock so its stand-in answers them in the API's order. */
    public bool $deferUploadChecks = false;

    public function __construct(
        #[\SensitiveParameter] private string $apiKey,
        public readonly string $projectId,
        public readonly string $baseUrl,
        public readonly string $cdnBaseUrl,
        private array $defaults,
        ?ClientInterface $http = null,
    ) {
        $this->http = $http ?? new Client();
        $this->sleep = static function (float $seconds): void { usleep((int) round($seconds * 1_000_000)); };
        $this->clock = static fn (): float => hrtime(true) / 1e9;
        self::validateOptions($defaults, 'sdk/invalid-config');
    }

    public function __debugInfo(): array { return ['projectId' => $this->projectId]; }
    public function project(string $path): string { return '/projects/' . Values::segment($this->projectId) . '/' . $path; }

    private static function validateOptions(array $options, string $code = 'sdk/invalid-argument'): void
    {
        foreach (['timeout', 'connectTimeout', 'uploadTimeout'] as $key) {
            if (isset($options[$key]) && ((!is_int($options[$key]) && !is_float($options[$key])) || !is_finite((float) $options[$key]) || $options[$key] <= 0)) {
                Values::invalid("$key must be a positive number of seconds", $code);
            }
        }
        if (array_key_exists('maxRetries', $options) && (!is_int($options['maxRetries']) || $options['maxRetries'] < 0)) {
            Values::invalid('maxRetries must be a non-negative integer', $code);
        }
        if (array_key_exists('maxResponseBytes', $options) && (!is_int($options['maxResponseBytes']) || $options['maxResponseBytes'] < 1)) {
            Values::invalid('maxResponseBytes must be a positive integer', $code);
        }
        // The API checks the key's characters and length (`idempotency/invalid-key`).
        if (isset($options['idempotencyKey']) && (!is_string($options['idempotencyKey']) || $options['idempotencyKey'] === '')) {
            Values::invalid('An idempotency key must be a non-empty string', $code);
        }
    }

    /**
     * Sends an API request and returns its decoded JSON body (null for an empty delete). `$upload`
     * marks a binary upload, whose deadline is `uploadTimeout` (none unless set).
     */
    public function request(string $method, string $path, array $query = [], mixed $body = null,
        ?StreamInterface $raw = null, array $headers = [], bool $idempotent = false, array $options = [], bool $upload = false): mixed
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
        if ($raw !== null && $raw->getSize() !== null) {
            $headers['Content-Length'] = (string) $raw->getSize();
        }
        if ($idempotent || isset($options['idempotencyKey'])) {
            $headers['Idempotency-Key'] = $options['idempotencyKey'] ?? Values::uuid();
        }
        self::validateOptions($options);
        $settings = $options + $this->defaults;
        if ($upload) {
            $settings['timeout'] = $options['uploadTimeout'] ?? $options['timeout'] ?? $this->defaults['uploadTimeout'] ?? null;
        }
        $response = $this->execute($method, $url, $headers, $raw, $settings);
        $status = $response->getStatusCode();
        $bytes = $this->readBounded($response, $settings['maxResponseBytes']);
        if ($bytes === '' && ($status === 204 || $method === 'DELETE')) {
            return null;
        }
        try {
            $data = json_decode($bytes, true, 512, JSON_THROW_ON_ERROR);
            if (!is_array($data)) {
                throw new \JsonException('Expected an object or array');
            }
            return $data;
        } catch (\JsonException $error) {
            throw $this->responseError('sdk/invalid-response', "Invalid JSON response (HTTP $status)", $response, $error);
        }
    }

    /** A CDN request: the deadline ends when the headers arrive and non-2xx responses are returned. */
    public function cdn(string $method, string $url, array $headers, array $options): ResponseInterface
    {
        self::validateOptions($options);
        return $this->execute($method, $url, $headers, null, $options + $this->defaults, true);
    }

    /** `Retry-After` in seconds (whole seconds or an HTTP date; 0 retries at once), or null. */
    public static function retryAfter(?string $value): ?int
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }
        if (preg_match('/^\d+$/D', $value)) {
            return (int) $value;
        }
        $time = strtotime($value);
        return $time === false ? null : max(0, (int) ceil($time - microtime(true)));
    }

    /** Exponential backoff with jitter, in milliseconds: half the delay is fixed, the other half random. */
    public static function retryDelayMs(int $attempt): int
    {
        $delay = min(self::RETRY_MAX_DELAY_MS, self::RETRY_BASE_DELAY_MS * 2 ** min($attempt, 30));
        return (int) round($delay / 2 + mt_rand() / mt_getrandmax() * ($delay / 2));
    }

    private function execute(string $method, string $url, array $headers, ?StreamInterface $body, array $settings, bool $cdn = false): ResponseInterface
    {
        foreach ($headers as $key => $_) {
            if (in_array(strtolower((string) $key), ['x-api-key', 'user-agent', 'authorization'], true)) {
                unset($headers[$key]);
            }
        }
        $headers['X-Api-Key'] = $this->apiKey;
        $headers['User-Agent'] = Version::userAgent();
        // Reads and requests carrying an Idempotency-Key are safe to repeat, unless their body is a one-shot stream.
        $retryable = (in_array($method, ['GET', 'HEAD'], true) || isset($headers['Idempotency-Key']))
            && ($body === null || $body->isSeekable());
        for ($attempt = 0; ; $attempt++) {
            $again = $retryable && $attempt < $settings['maxRetries'];
            try {
                $response = $this->http->send(new Request($method, $url, $headers, $body), [
                    'http_errors' => false, 'allow_redirects' => false,
                    'timeout' => $settings['timeout'] ?? 0, 'connect_timeout' => $settings['connectTimeout'],
                    'read_timeout' => $settings['timeout'] ?? 0, 'stream' => $cdn,
                ]);
            } catch (\InvalidArgumentException $error) {
                throw CalmLensException::create('sdk/invalid-argument', $error->getMessage(), previous: $error);
            } catch (TransferException $error) {
                $context = method_exists($error, 'getHandlerContext') ? $error->getHandlerContext() : [];
                $timeout = ($context['errno'] ?? null) === 28;
                $failure = CalmLensException::create($timeout ? 'sdk/timeout' : 'sdk/transport-error',
                    $timeout ? 'Request timed out' : 'Request failed', previous: $error);
                if (!$again) {
                    throw $failure;
                }
                $this->wait(self::retryDelayMs($attempt));
                $body?->rewind();
                continue;
            }
            $status = $response->getStatusCode();
            // Redirects are never followed: they could send the API key to another origin.
            if ($status >= 300 && $status < 400 && $response->hasHeader('Location')) {
                throw $this->responseError('sdk/http-error', "Unexpected redirect (HTTP $status)", $response);
            }
            if ($status >= 200 && $status < 300) {
                return $response;
            }
            if ($cdn) {
                // CDN error responses are returned, after retrying the retryable ones.
                $retryAfter = self::retryAfter($response->getHeaderLine('Retry-After'));
                $delay = $retryAfter !== null ? $retryAfter * 1000 : self::retryDelayMs($attempt);
                if (!$again || !in_array($status, self::RETRYABLE_STATUSES, true) || $delay > self::RETRY_AFTER_MAX_MS) {
                    return $response;
                }
                $response->getBody()->close();
                $this->wait($delay);
                continue;
            }
            $error = $this->apiError($response, $settings['maxResponseBytes']);
            $retryAfter = $error->retryAfter();
            $delay = $retryAfter !== null ? (int) ($retryAfter * 1000) : self::retryDelayMs($attempt);
            if (!$again || !$error->isRetryable() || $delay > self::RETRY_AFTER_MAX_MS) {
                throw $error;
            }
            $this->wait($delay);
            $body?->rewind();
        }
    }

    private function wait(int $milliseconds): void
    {
        ($this->sleep)($milliseconds / 1000);
    }

    /** Reads at most `$limit` bytes, failing with `sdk/response-too-large` beyond that, or for a larger declared length. */
    private function readBounded(ResponseInterface $response, int $limit): string
    {
        $declared = $response->getHeaderLine('Content-Length');
        if (preg_match('/^\d+$/D', $declared) && (int) $declared > $limit) {
            $response->getBody()->close();
            throw $this->responseError('sdk/response-too-large', "Response body exceeds $limit bytes", $response, retryAfter: false);
        }
        $stream = $response->getBody();
        $bytes = '';
        try {
            while (!$stream->eof() && strlen($bytes) <= $limit) {
                $chunk = $stream->read(min(8192, $limit + 1 - strlen($bytes)));
                if ($chunk === '' && !$stream->eof()) {
                    throw CalmLensException::create('sdk/transport-error', 'Response body stopped before EOF');
                }
                $bytes .= $chunk;
            }
        } catch (\RuntimeException $error) {
            if ($error instanceof CalmLensException) {
                throw $error;
            }
            throw CalmLensException::create('sdk/transport-error', 'Reading the response failed', previous: $error);
        }
        if (strlen($bytes) > $limit) {
            throw $this->responseError('sdk/response-too-large', "Response body exceeds $limit bytes", $response, retryAfter: false);
        }
        return $bytes;
    }

    /** An SDK error about a response, with its status, request ID and (unless `retryAfter` is false) headers. */
    private function responseError(string $code, string $message, ResponseInterface $response, ?\Throwable $previous = null, bool $retryAfter = true): CalmLensException
    {
        $headers = $response->getHeaders();
        if (!$retryAfter) {
            $headers = array_filter($headers, fn ($name) => strcasecmp((string) $name, 'retry-after') !== 0, ARRAY_FILTER_USE_KEY);
        }
        return CalmLensException::create($code, $message, $response->getStatusCode(), [], $headers, $previous,
            $response->hasHeader('X-Request-Id') ? $response->getHeaderLine('X-Request-Id') : null);
    }

    private function apiError(ResponseInterface $response, int $limit): CalmLensException
    {
        $data = json_decode($this->readBounded($response, $limit), true);
        if (!is_array($data) || !is_string($data['code'] ?? null)) {
            return $this->responseError('sdk/http-error', 'HTTP ' . $response->getStatusCode(), $response);
        }
        $details = is_array($data['details'] ?? null) ? $data['details'] : [];
        if (is_string($data['traceId'] ?? null)) {
            $details['traceId'] = $data['traceId'];
        }
        return CalmLensException::create($data['code'], is_string($data['message'] ?? null) ? $data['message'] : $data['code'],
            $response->getStatusCode(), $details, $response->getHeaders());
    }
}
