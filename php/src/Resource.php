<?php

declare(strict_types=1);

namespace CalmLens;

use CalmLens\Internal\Session;
use CalmLens\Internal\Values;

/** @internal */
abstract class Resource
{
    public function __construct(protected Session $session) {}
    public function __debugInfo(): array { return ['projectId' => $this->session->projectId]; }

    /** The prefix of this resource's operations in Internal\OptionKeys. */
    protected const OPERATIONS = '';

    /**
     * Checks a method's params and request options. `$method` names the public method, whose params
     * are checked against the keys it takes: an unknown key fails with `sdk/invalid-argument`. A
     * param given as null is left out, as if omitted, unless the method sends it as null (such as
     * `description`, which null clears).
     *
     * @param array<string, mixed> $params
     * @param array<string, mixed> $requestOptions
     * @return array{array<string, mixed>, array<string, mixed>} the params to send and the request options
     */
    protected function split(array $params, string $method, array $requestOptions = []): array
    {
        Values::knownOptions($params, static::OPERATIONS . '.' . $method);
        $this->session->operation = static::OPERATIONS . '.' . $method;
        return [Values::withoutNulls($params, static::OPERATIONS . '.' . $method), $requestOptions];
    }

    /**
     * The `$class` object for a response, which must be a JSON object (`sdk/invalid-response` otherwise).
     *
     * @template T of CalmLensObject
     * @param class-string<T> $class
     * @return T
     */
    protected function model(string $class, mixed $data): CalmLensObject
    {
        if (!is_array($data) || ($data !== [] && array_is_list($data))) {
            throw CalmLensException::create('sdk/invalid-response', 'Expected an object response');
        }
        return $class::constructFrom($data)->withLastResponse($this->session->lastResponse);
    }

    /**
     * A page of `$item` objects, which fetches the next page with `$fetch` and the same `$params`.
     *
     * @template C of Collection
     * @param class-string<C> $class
     * @param null|class-string<CalmLensObject> $item
     * @param \Closure(array<string, mixed>): C $fetch
     * @param array<string, mixed> $params
     * @return C
     */
    protected function collection(string $class, ?string $item, mixed $data, \Closure $fetch, array $params): Collection
    {
        if (!is_array($data) || !is_array($data['items'] ?? null) || !array_is_list($data['items']) || !is_bool($data['hasMore'] ?? null)) {
            throw CalmLensException::create('sdk/invalid-response', 'Invalid page');
        }
        return $class::page($data, $item, $fetch, $params)->withLastResponse($this->session->lastResponse);
    }

    protected function path(array &$options, string $resource, string $key): string
    {
        $id = Values::segment($options[$key] ?? null);
        unset($options[$key]);
        return '/' . $resource . '/' . $id;
    }
}
