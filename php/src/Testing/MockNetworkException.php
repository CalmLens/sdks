<?php

declare(strict_types=1);

namespace CalmLens\Testing;

use Psr\Http\Client\NetworkExceptionInterface;
use Psr\Http\Message\RequestInterface;

/**
 * A simulated network failure for a request: the client reports `sdk/timeout` when `timeout` is
 * true and `sdk/transport-error` otherwise. Throw one from a `MockHttpClient` handler, or enqueue
 * one on `MockTransport`.
 */
final class MockNetworkException extends \RuntimeException implements NetworkExceptionInterface
{
    public function __construct(private RequestInterface $request, string $message = 'Simulated network failure', public readonly bool $timeout = false)
    {
        parent::__construct($message);
    }

    public function getRequest(): RequestInterface
    {
        return $this->request;
    }
}
