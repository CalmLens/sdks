<?php

declare(strict_types=1);

namespace CalmLens\Internal;

use GuzzleHttp\Psr7\StreamDecoratorTrait;
use Psr\Http\Message\StreamInterface;

/** A bounded view from the caller's current stream offset; unbounded when the size is unknown. @internal */
final class UploadStream implements StreamInterface
{
    use StreamDecoratorTrait;

    private int $position = 0;
    private int $start;

    public function __construct(private StreamInterface $stream, private ?int $size)
    {
        $this->start = $stream->isSeekable() ? $stream->tell() : 0;
        if ($size === 0 && $stream->read(1) !== '') {
            Values::invalid('Stream exceeds sizeInBytes', 'upload/invalid-payload');
        }
    }

    public function getSize(): ?int { return $this->size; }
    public function tell(): int { return $this->position; }
    public function eof(): bool { return $this->size === null ? $this->stream->eof() : $this->position === $this->size; }
    public function isWritable(): bool { return false; }
    public function write(string $string): int { throw new \RuntimeException('Upload stream is read-only'); }
    public function rewind(): void { $this->seek(0); }

    public function seek(int $offset, int $whence = SEEK_SET): void
    {
        if ($this->size === null) {
            throw new \RuntimeException('An unsized upload stream cannot seek');
        }
        $target = match ($whence) {
            SEEK_SET => $offset,
            SEEK_CUR => $this->position + $offset,
            SEEK_END => $this->size + $offset,
            default => -1,
        };
        if ($target < 0 || $target > $this->size) {
            throw new \RuntimeException('Invalid stream position');
        }
        $this->stream->seek($this->start + $target);
        $this->position = $target;
    }

    public function read(int $length): string
    {
        if ($length < 0) {
            throw new \RuntimeException('Invalid read length');
        }
        if ($length === 0 || $this->eof()) {
            return '';
        }
        if ($this->size === null) {
            $chunk = $this->stream->read($length);
            $this->position += strlen($chunk);
            return $chunk;
        }
        $chunk = $this->stream->read(min($length, $this->size - $this->position));
        if ($chunk === '') {
            Values::invalid('Stream ended before sizeInBytes', 'upload/invalid-payload');
        }
        $this->position += strlen($chunk);
        if ($this->eof() && $this->stream->read(1) !== '') {
            Values::invalid('Stream exceeds sizeInBytes', 'upload/invalid-payload');
        }
        return $chunk;
    }

    public function getContents(): string
    {
        $result = '';
        while (!$this->eof()) {
            $result .= $this->read(8192);
        }
        return $result;
    }
}
