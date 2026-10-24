<?php

declare(strict_types=1);

namespace Chirp;

/**
 * Chirp's database: one JSON file, locked for each change. Enough for a local example; use a
 * real database in production.
 *
 * users:      username → {username, bio, showSensitiveMedia, createdAt}
 * posts:      id → {id, author, text, parentId, createdAt, image: null | {assetId, status, findings, checkedAt}}
 * deliveries: webhook delivery IDs already applied, newest last
 */
final class Store
{
    private const EMPTY = ['users' => [], 'posts' => [], 'deliveries' => []];

    public function __construct(private string $path) {}

    public function read(): array
    {
        if (!is_file($this->path)) {
            return self::EMPTY;
        }
        $handle = fopen($this->path, 'rb');
        flock($handle, LOCK_SH);
        $data = json_decode(stream_get_contents($handle) ?: 'null', true);
        flock($handle, LOCK_UN);
        fclose($handle);
        return is_array($data) ? $data + self::EMPTY : self::EMPTY;
    }

    /** Runs `$change` on the data under an exclusive lock and saves what it leaves. */
    public function update(callable $change): mixed
    {
        $handle = fopen($this->path, 'c+b');
        flock($handle, LOCK_EX);
        try {
            $data = json_decode(stream_get_contents($handle) ?: 'null', true);
            $data = is_array($data) ? $data + self::EMPTY : self::EMPTY;
            $result = $change($data);
            ftruncate($handle, 0);
            rewind($handle);
            fwrite($handle, json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
            fflush($handle);
            return $result;
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }
}
