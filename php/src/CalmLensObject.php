<?php

declare(strict_types=1);

namespace CalmLens;

/**
 * An object the API returned. Read its fields as properties (`$asset->classification->status`)
 * or as array keys (`$asset['classification']['status']`), iterate over them, or turn the whole
 * object back into arrays with `toArray()`. A field the API didn't send reads as null. Fields
 * this version of the SDK doesn't know yet are kept and read the same way. Objects are
 * read-only: change a resource with its service's methods, such as `$client->assets->update()`.
 *
 * @implements \ArrayAccess<string, mixed>
 * @implements \IteratorAggregate<array-key, mixed>
 */
abstract class CalmLensObject implements \ArrayAccess, \Countable, \IteratorAggregate, \JsonSerializable
{
    /**
     * The fields whose values are objects: a class name, `[class]` for a list of them, or
     * `['*' => class]` for a record of them keyed by name.
     *
     * @var array<string, class-string<CalmLensObject>|array{class-string<CalmLensObject>}|array{'*': class-string<CalmLensObject>}>
     */
    protected const FIELDS = [];

    /** @var array<string, mixed> */
    private array $values = [];

    private ?ApiResponse $lastResponse = null;

    final protected function __construct() {}

    /**
     * The object for an API response's decoded JSON, with its nested objects.
     *
     * @param array<array-key, mixed> $values
     */
    public static function constructFrom(array $values): static
    {
        $object = new static();
        $object->fill($values, static::FIELDS);
        return $object;
    }

    /**
     * @param array<array-key, mixed> $values
     * @param array<string, mixed> $fields
     */
    protected function fill(array $values, array $fields): void
    {
        foreach ($values as $key => $value) {
            $this->values[(string) $key] = self::convert($fields[$key] ?? null, $value);
        }
    }

    private static function convert(mixed $field, mixed $value): mixed
    {
        if ($field === null || !is_array($value)) {
            return $value;
        }
        if (is_string($field)) {
            return $field::constructFrom($value);
        }
        $item = $field[0] ?? $field['*'];
        return array_map(fn (mixed $entry) => self::convert($item, $entry), $value);
    }

    /**
     * The HTTP response this object came from: its `status`, `headers` and `requestId`. Null for
     * nested objects, and for objects that weren't returned by a request, such as a parsed webhook
     * event or a lens the client had cached.
     */
    public function getLastResponse(): ?ApiResponse
    {
        return $this->lastResponse;
    }

    /** @internal Records the response the object came from. */
    public function withLastResponse(?ApiResponse $response): static
    {
        $this->lastResponse = $response;
        return $this;
    }

    public function __get(string $name): mixed
    {
        return $this->values[$name] ?? null;
    }

    public function __isset(string $name): bool
    {
        return isset($this->values[$name]);
    }

    public function __set(string $name, mixed $value): never
    {
        throw new \LogicException(static::class . ' is read-only; change it through its service');
    }

    public function __unset(string $name): never
    {
        throw new \LogicException(static::class . ' is read-only; change it through its service');
    }

    public function offsetExists(mixed $offset): bool
    {
        return array_key_exists((string) $offset, $this->values);
    }

    public function offsetGet(mixed $offset): mixed
    {
        return $this->values[(string) $offset] ?? null;
    }

    public function offsetSet(mixed $offset, mixed $value): never
    {
        throw new \LogicException(static::class . ' is read-only; change it through its service');
    }

    public function offsetUnset(mixed $offset): never
    {
        throw new \LogicException(static::class . ' is read-only; change it through its service');
    }

    /** The number of fields the API sent. */
    public function count(): int
    {
        return count($this->values);
    }

    /** @return \ArrayIterator<string, mixed> */
    public function getIterator(): \Iterator
    {
        return new \ArrayIterator($this->values);
    }

    /** @return list<string> the names of the fields the API sent */
    public function keys(): array
    {
        return array_keys($this->values);
    }

    /**
     * The object as the API sent it, nested objects included, as associative arrays.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return self::plain($this->values);
    }

    private static function plain(mixed $value): mixed
    {
        if ($value instanceof self) {
            return $value->toArray();
        }
        return is_array($value) ? array_map(self::plain(...), $value) : $value;
    }

    /** The object as JSON would encode it: an object without fields, or a record without entries, as `{}`. */
    public function jsonSerialize(): mixed
    {
        if ($this->values === []) {
            return new \stdClass();
        }
        $values = $this->values;
        foreach (static::FIELDS as $key => $field) {
            if (is_array($field) && isset($field['*']) && ($values[$key] ?? null) === []) {
                $values[$key] = new \stdClass();
            }
        }
        return $values;
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return $this->values;
    }
}
