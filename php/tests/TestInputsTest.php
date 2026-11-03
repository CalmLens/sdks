<?php

declare(strict_types=1);

use CalmLens\Exception\InvalidArgumentException;
use CalmLens\SdkErrorCodes;
use CalmLens\Testing\Classification;
use CalmLens\Testing\TestInputs;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Replays the shared signed test input fixture (Ruby's testdata copy of
 * packages/sdk-contract/testInputs.ts): text codes, media phrases, presets, signal shortcuts, the qualifier vocabulary and every rejected scenario.
 */
final class TestInputsTest extends TestCase
{
    private static ?array $fixture = null;

    private static function fixture(): array
    {
        return self::$fixture ??= json_decode(file_get_contents(__DIR__ . '/../../ruby/testdata/test-inputs.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    /** Sorts object keys at every level, so JSON values compare whatever their key order. */
    private static function canon(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        if (!array_is_list($value)) {
            ksort($value, SORT_STRING);
        }
        return array_map(self::canon(...), $value);
    }

    /** @return array<string, array{array}> */
    private static function cases(string $section, callable $name): array
    {
        $cases = [];
        foreach (self::fixture()[$section] as $case) {
            $cases[$name($case)] = [$case];
        }
        return $cases;
    }

    public static function texts(): array
    {
        return self::cases('text', static fn (array $case): string => $case['name']);
    }

    public static function media(): array
    {
        return self::cases('media', static fn (array $case): string => $case['signal']);
    }

    public static function signalInputs(): array
    {
        return self::cases('signalInputs', static fn (array $case): string => "{$case['signal']} {$case['kind']}");
    }

    public static function rejections(): array
    {
        return self::cases('rejections', static fn (array $case): string => "{$case['kind']} {$case['name']}");
    }

    #[DataProvider('texts')]
    public function testTextCodeMatchesTheFixture(array $case): void
    {
        self::assertSame($case['code'], TestInputs::generateTestTextCode($case['input'] ?? $case['signal'], $case['key']));
    }

    #[DataProvider('media')]
    public function testMediaPhraseMatchesTheFixture(array $case): void
    {
        self::assertSame($case['code'], TestInputs::generateMediaTestCode($case['signal'], $case['key']));
    }

    #[DataProvider('signalInputs')]
    public function testSignalStandsForTheFixtureScenario(array $case): void
    {
        self::assertSame(self::canon($case['input']), self::canon(TestInputs::testInputForSignal($case['signal'], $case['kind'])));
    }

    public function testPresetsAndSignalsMatchTheFixture(): void
    {
        $fixture = self::fixture();
        self::assertSame(self::canon($fixture['presets']), self::canon(TestInputs::PRESETS));
        self::assertSame($fixture['signals']['text'], TestInputs::TEXT_SIGNALS);
        self::assertSame($fixture['signals']['media'], TestInputs::MEDIA_SIGNALS);
    }

    public function testScenarioQualifierVocabularyMatchesTheFixture(): void
    {
        $allowed = array_map(static fn (array $qualifiers): array => array_values(array_diff($qualifiers, Classification::INPUT_QUALIFIERS)), Classification::QUALIFIERS);
        self::assertSame(self::fixture()['qualifiers'], $allowed);
    }

    #[DataProvider('rejections')]
    public function testRejectedScenarioRaisesInvalidArgument(array $case): void
    {
        $scenario = $case['input'] ?? $case['signal'];
        try {
            match ($case['kind']) {
                'text' => TestInputs::generateTestTextCode($scenario, $case['key']),
                'media' => TestInputs::generateMediaTestCode($scenario, $case['key']),
            };
            self::fail("{$case['name']} was accepted");
        } catch (InvalidArgumentException $error) {
            self::assertSame(SdkErrorCodes::INVALID_ARGUMENT, $error->errorCode);
        }
    }
}
