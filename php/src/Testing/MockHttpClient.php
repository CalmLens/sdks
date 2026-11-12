<?php

declare(strict_types=1);

namespace CalmLens\Testing;

use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

/**
 * A PSR-18 client that answers each request with `$handler`, which returns a response or throws,
 * such as a `MockNetworkException`. Pass it to `ServerClient` as `httpClient` to script responses.
 */
final class MockHttpClient implements ClientInterface
{
    /** @param \Closure(RequestInterface): ResponseInterface $handler */
    public function __construct(private \Closure $handler) {}

    public function sendRequest(RequestInterface $request): ResponseInterface
    {
        return ($this->handler)($request);
    }
}
