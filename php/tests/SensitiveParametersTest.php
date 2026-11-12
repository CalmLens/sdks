<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Keeps secrets out of stack traces: every function parameter in the package named for an API key,
 * webhook secret, upload token or test input key carries `#[\SensitiveParameter]`, private helpers
 * included, as a secret in a nested frame leaks equally. Name a new one so this finds it.
 */
final class SensitiveParametersTest extends TestCase
{
    private const SECRET_NAME = '/^(apiKey|secret|.*Secret|uploadToken|testInputKey)$/';

    /** @return iterable<string, array{ReflectionParameter}> */
    public static function secretParameters(): iterable
    {
        $source = realpath(__DIR__ . '/../src');
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source, FilesystemIterator::SKIP_DOTS)) as $file) {
            $relative = substr($file->getPathname(), strlen($source) + 1, -strlen('.php'));
            $class = 'CalmLens\\' . str_replace('/', '\\', $relative);
            if (!class_exists($class)) {
                continue;
            }
            foreach ((new ReflectionClass($class))->getMethods() as $method) {
                foreach ($method->getParameters() as $parameter) {
                    // `Session::execute`'s `bool $apiKey` says whether to send the key; it isn't the key.
                    $string = $parameter->getType() instanceof ReflectionNamedType && $parameter->getType()->getName() === 'string';
                    if ($string && preg_match(self::SECRET_NAME, $parameter->getName())) {
                        yield "$class::{$method->getName()}(\${$parameter->getName()})" => [$parameter];
                    }
                }
            }
        }
    }

    #[DataProvider('secretParameters')]
    public function testASecretParameterIsMarkedSensitive(ReflectionParameter $parameter): void
    {
        self::assertNotSame([], $parameter->getAttributes(\SensitiveParameter::class));
    }

    /** Finds the parameters the audit is for, so a change to how it finds them can't empty it. */
    public function testTheAuditCoversTheKnownSecretParameters(): void
    {
        $found = array_keys(iterator_to_array(self::secretParameters()));
        foreach (['CalmLens\ServerClient::__construct($apiKey)', 'CalmLens\Internal\Session::__construct($apiKey)',
            'CalmLens\Webhooks::verify($secret)', 'CalmLens\Internal\UploadTokenSigner::sign($apiKey)',
            'CalmLens\Testing\TestInputs::generateTestTextCode($testInputKey)', 'CalmLens\Testing\TestInputs::tag($testInputKey)',
            'CalmLens\Testing\MockServerClient::grantsOf($apiKey)'] as $name) {
            self::assertContains($name, $found);
        }
    }
}
