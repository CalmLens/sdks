<?php

declare(strict_types=1);

use CalmLens\Exception\InvalidArgumentException;
use CalmLens\SdkErrorCodes;
use CalmLens\Testing\Classification;
use CalmLens\Testing\TestImageGrid;
use CalmLens\Testing\TestInputs;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Replays the shared signed test input fixture (Ruby's testdata copy of
 * packages/sdk-contract/testInputs.ts): text codes, test images, media phrases, presets, signal shortcuts, the qualifier vocabulary and every rejected scenario.
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

    /**
     * Rejections a PHP array can't express. `detections: []` (a list) decodes to the same empty
     * array as `detections: {}`, which is a valid scenario; a non-empty list is still refused.
     */
    private const INEXPRESSIBLE_REJECTIONS = ['detections list'];

    public static function rejections(): array
    {
        return array_diff_key(self::cases('rejections', static fn (array $case): string => "{$case['kind']} {$case['name']}"),
            array_flip(array_map(static fn (string $name): string => "text $name", self::INEXPRESSIBLE_REJECTIONS)));
    }

    public static function images(): array
    {
        return self::cases('images', static fn (array $case): string => $case['name']);
    }

    public static function imageRejections(): array
    {
        return self::cases('imageRejections', static fn (array $case): string => $case['name']);
    }

    #[DataProvider('images')]
    public function testImageMatchesTheFixture(array $case): void
    {
        $image = TestInputs::paintTestImage($case['input'] ?? $case['signal'], $case['key']);
        self::assertSame([$case['width'], $case['height']], [$image->width, $image->height]);
        self::assertSame($case['rgbaSha256'], hash('sha256', $image->rgba));
        self::assertSame($case['levels'], self::fixtureLevels($image->rgba, $image->width, $case['cells']));
        self::assertSame([$image->width, $image->height, $image->rgba], self::decodePng($image->png));
    }

    #[DataProvider('imageRejections')]
    public function testOversizedImageScenarioRaisesInvalidArgument(array $case): void
    {
        try {
            TestInputs::paintTestImage($case['input'] ?? $case['signal'], $case['key']);
            self::fail("{$case['name']} was painted");
        } catch (InvalidArgumentException $error) {
            self::assertSame(SdkErrorCodes::INVALID_ARGUMENT, $error->errorCode);
        }
    }

    /** Each cell's level as packages/sdk-contract/testInputs.ts records it: "r" for the outer ring, else the data level (0-3) nearest the luma of the cell's top-left pixel. */
    private static function fixtureLevels(string $rgba, int $width, int $cells): string
    {
        $size = intdiv($width, $cells);
        $levels = '';
        for ($row = 0; $row < $cells; $row++) {
            for ($column = 0; $column < $cells; $column++) {
                if ($row === 0 || $column === 0 || $row === $cells - 1 || $column === $cells - 1) {
                    $levels .= 'r';
                    continue;
                }
                $offset = ($row * $size * $width + $column * $size) * 4;
                $luma = (77 * ord($rgba[$offset]) + 150 * ord($rgba[$offset + 1]) + 29 * ord($rgba[$offset + 2])) >> 8;
                $nearest = 0;
                foreach (TestImageGrid::LEVELS as $level => $target) {
                    if (abs($target - $luma) < abs(TestImageGrid::LEVELS[$nearest] - $luma)) {
                        $nearest = $level;
                    }
                }
                $levels .= (string) $nearest;
            }
        }
        return $levels;
    }

    /** @return array{int, int, string} the width, height and RGBA of an unfiltered 8-bit RGBA PNG, checking every chunk's CRC */
    private static function decodePng(string $png): array
    {
        self::assertSame("\x89PNG\r\n\x1a\n", substr($png, 0, 8));
        $chunks = ['IHDR' => '', 'IDAT' => ''];
        for ($offset = 8; $offset < strlen($png); $offset += 12 + $length) {
            $length = unpack('N', $png, $offset)[1];
            $type = substr($png, $offset + 4, 4);
            $body = substr($png, $offset + 8, $length);
            self::assertSame(crc32($type . $body), unpack('N', $png, $offset + 8 + $length)[1]);
            $chunks[$type] = ($chunks[$type] ?? '') . $body;
        }
        ['width' => $width, 'height' => $height, 'depth' => $depth, 'colour' => $colour] = unpack('Nwidth/Nheight/Cdepth/Ccolour', $chunks['IHDR']);
        self::assertSame([8, 6], [$depth, $colour]);
        $raw = gzuncompress($chunks['IDAT']);
        $stride = $width * 4 + 1;
        $rgba = '';
        for ($row = 0; $row < $height; $row++) {
            self::assertSame("\0", $raw[$row * $stride]);
            $rgba .= substr($raw, $row * $stride + 1, $stride - 1);
        }
        return [$width, $height, $rgba];
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

    /**
     * Each way a call can throw with the key on the stack, down to the helpers it passes the key
     * to: an unknown signal, a bad key's check, and a scenario too large to sign.
     *
     * @return iterable<string, array{callable(string): mixed, string}>
     */
    public static function failingKeyedCalls(): iterable
    {
        $key = str_repeat('0123456789abcdef', 2);
        // Base64 of this canonical JSON is over the 8000 characters a text code may hold.
        $tooLarge = ['instances' => array_fill(0, 128, ['category' => 'harassment', 'qualifiers' => ['harassment-abuse', 'harassment-threat']])];
        yield 'text code: checkKey' => [fn (#[\SensitiveParameter] string $secret) => TestInputs::generateTestTextCode('clean', $secret), 'not-hexadecimal-but-long-enough-to-spot'];
        yield 'text code: textCode' => [fn (#[\SensitiveParameter] string $secret) => TestInputs::generateTestTextCode($tooLarge, $secret), $key];
        yield 'image: checkKey' => [fn (#[\SensitiveParameter] string $secret) => TestInputs::paintTestImage('hate', $secret), 'not-hexadecimal-but-long-enough-to-spot'];
        yield 'image: textCode' => [fn (#[\SensitiveParameter] string $secret) => TestInputs::paintTestImage($tooLarge, $secret), $key];
        yield 'media: unknown signal' => [fn (#[\SensitiveParameter] string $secret) => TestInputs::generateMediaTestCode('no-such-signal', $secret), $key];
        yield 'media: checkKey' => [fn (#[\SensitiveParameter] string $secret) => TestInputs::generateMediaTestCode('hate', $secret), 'not-hexadecimal-but-long-enough-to-spot'];
    }

    #[DataProvider('failingKeyedCalls')]
    public function testATestInputKeyStaysOutOfStackTraces(callable $call, #[\SensitiveParameter] string $secret): void
    {
        $previous = ini_set('zend.exception_ignore_args', '0');
        try {
            $call($secret);
            self::fail('Expected the call to throw');
        } catch (InvalidArgumentException $error) {
            // A trace string shortens each string argument to 15 characters.
            self::assertStringNotContainsString(substr($secret, 0, 15), $error->getTraceAsString());
            $arguments = array_merge(...array_map(fn (array $frame) => $frame['args'] ?? [], $error->getTrace()));
            self::assertNotContains($secret, $arguments);
            // The trace does hold its arguments, so their absence means they were redacted.
            self::assertNotEmpty(array_filter($arguments, fn (mixed $argument) => $argument instanceof \SensitiveParameterValue));
        } finally {
            ini_set('zend.exception_ignore_args', (string) $previous);
        }
    }

    public function testDetectionLimitsAndAgePresetsMatchTheFixture(): void
    {
        $detections = self::fixture()['detections'];
        self::assertSame(
            [$detections['maxEntries'], $detections['boxMax'], $detections['ageMax'], array_keys($detections['agePresets'])],
            [Classification::TEST_DETECTIONS_MAX, Classification::TEST_DETECTION_BOX_MAX, Classification::TEST_FACE_AGE_MAX, Classification::TEST_FACE_AGE_PRESETS],
        );
    }

    public function testDetectionsAsAListAreRefused(): void
    {
        try {
            TestInputs::generateTestTextCode(['instances' => [], 'detections' => [['box' => [0, 0, 1, 1]]]], str_repeat('a', 32));
            self::fail('a detections list was accepted');
        } catch (InvalidArgumentException $error) {
            self::assertSame(SdkErrorCodes::INVALID_ARGUMENT, $error->errorCode);
        }
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
