<?php

declare(strict_types=1);

namespace CalmLens\Testing;

use CalmLens\ServerClient;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Psr7\Utils;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

/** FIFO offline responses through the real SDK serialization, validation and error handling. */
final class MockTransport
{
    /** @var list<ResponseInterface|\Throwable> */
    private array $queue = [];
    /** @var list<array{request: RequestInterface, response: ?ResponseInterface}> */
    private array $history = [];

    public function enqueueJson(mixed $body, int $status = 200, array $headers = []): self
    {
        return $this->enqueue(new Response($status, $headers + ['Content-Type' => 'application/json'], json_encode($body, JSON_THROW_ON_ERROR)));
    }

    public function enqueue(ResponseInterface|\Throwable $response): self
    {
        $this->queue[] = $response;
        return $this;
    }

    public function client(string $projectId = 'project-1'): ServerClient
    {
        $http = new MockHttpClient(function (RequestInterface $request): ResponseInterface {
            // Consume uploads in offline tests too, validating their byte count and freezing a snapshot.
            $request = $request->withBody(Utils::streamFor($request->getBody()->getContents()));
            $answer = array_shift($this->queue) ?? throw new \OutOfBoundsException('MockTransport has no queued response');
            $this->history[] = ['request' => $request, 'response' => $answer instanceof ResponseInterface ? $answer : null];
            if ($answer instanceof \Throwable) {
                throw $answer;
            }
            return $answer;
        });
        return new ServerClient('test-key', $projectId, maxRetries: 0, httpClient: $http);
    }

    /** @return list<RecordedRequest> every request sent, oldest first, with the status it was answered with. */
    public function requests(): array
    {
        return array_map(fn (array $entry) => RecordedRequest::of($entry['request'], $entry['response']?->getStatusCode(),
            ServerClient::DEFAULT_BASE_URL, ServerClient::DEFAULT_CDN_BASE_URL), $this->history);
    }

    public function pending(): int { return count($this->queue); }
}
