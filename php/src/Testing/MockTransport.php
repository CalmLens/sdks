<?php

declare(strict_types=1);

namespace CalmLens\Testing;

use CalmLens\ServerClient;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use Psr\Http\Message\ResponseInterface;

/** FIFO offline responses through the real SDK serialization, validation and error handling. */
final class MockTransport
{
    private MockHandler $handler;
    private array $history = [];

    public function __construct()
    {
        $this->handler = new MockHandler();
    }

    public function enqueueJson(mixed $body, int $status = 200, array $headers = []): self
    {
        return $this->enqueue(new Response($status, $headers + ['Content-Type' => 'application/json'], json_encode($body, JSON_THROW_ON_ERROR)));
    }

    public function enqueue(ResponseInterface|\Throwable $response): self
    {
        $this->handler->append($response);
        return $this;
    }

    public function client(string $projectId = 'project-test'): ServerClient
    {
        $stack = HandlerStack::create($this->handler);
        $stack->push(Middleware::mapRequest(function ($request) {
            // Consume uploads in offline tests too, validating their byte count and freezing a snapshot.
            return $request->withBody(\GuzzleHttp\Psr7\Utils::streamFor($request->getBody()->getContents()));
        }));
        $stack->push(Middleware::history($this->history));
        return new ServerClient('test-key', $projectId, maxRetries: 0, httpClient: new Client(['handler' => $stack]));
    }

    public function requests(): array
    {
        return array_column($this->history, 'request');
    }

    public function pending(): int { return count($this->handler); }
}
