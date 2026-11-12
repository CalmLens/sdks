<?php

declare(strict_types=1);

namespace CalmLens\Internal;

use Psr\Log\AbstractLogger;
use Psr\Log\LogLevel;

/** The logger `CALMLENS_LOG=info` or `debug` turns on: one line per message on standard error. @internal */
final class StderrLogger extends AbstractLogger
{
    private const LEVELS = [LogLevel::DEBUG => 0, LogLevel::INFO => 1, LogLevel::NOTICE => 2, LogLevel::WARNING => 3,
        LogLevel::ERROR => 4, LogLevel::CRITICAL => 5, LogLevel::ALERT => 6, LogLevel::EMERGENCY => 7];

    public function __construct(private string $level) {}

    public function log($level, string|\Stringable $message, array $context = []): void
    {
        if ((self::LEVELS[$level] ?? 0) < self::LEVELS[$this->level]) {
            return;
        }
        $fields = implode(' ', array_map(fn ($key, $value) => $key . '=' . (is_scalar($value) ? var_export($value, true) : json_encode($value)),
            array_keys($context), $context));
        file_put_contents('php://stderr', "[calmlens] $level: $message" . ($fields === '' ? '' : " $fields") . "\n");
    }
}
