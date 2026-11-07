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
     * Rejections PHP can't express. `detections: []` (a list) decodes to the same empty array as
     * `detections: {}`, which is a valid scenario; a non-empty list is still refused. `$expiresAt`
     * is an `int`, so a fractional expiry is a `TypeError`.
     */
    private const INEXPRESSIBLE_REJECTIONS = ['detections list', 'expiry 1.5'];

    public function testFractionalExpiryIsATypeError(): void
    {
        $this->expectException(TypeError::class);
        TestInputs::generateTestTextCode('harassment', str_repeat('a', 32), expiresAt: 1.5);
    }

    public function testExpiryLifetimesMatchTheFixture(): void
    {
        $expiry = self::fixture()['expiry'];
        self::assertSame([$expiry['defaultLifetimeSeconds'], $expiry['maxLifetimeSeconds']],
            [TestInputs::DEFAULT_LIFETIME_SECONDS, TestInputs::MAX_LIFETIME_SECONDS]);
    }

    /** Without `$expiresAt`, the signed payload's first four bytes are a day from now. */
    public function testCodeExpiresAfterTheDefaultLifetime(): void
    {
        $code = TestInputs::generateTestTextCode('harassment', str_repeat('a', 32));
        $now = time();
        $payload = explode(' ', substr($code, 0, -1))[2];
        $expiresAt = unpack('N', (string) base64_decode(strtr($payload, '-_', '+/'), true))[1];
        $lifetime = self::fixture()['expiry']['defaultLifetimeSeconds'];
        self::assertGreaterThanOrEqual($now + $lifetime - 5, $expiresAt);
        self::assertLessThanOrEqual($now + $lifetime + 5, $expiresAt);
    }

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
        $image = TestInputs::paintTestImage($case['input'] ?? $case['signal'], $case['key'], $case['expiresAt']);
        self::assertSame([$case['width'], $case['height']], [$image->width, $image->height]);
        self::assertSame($case['rgbaSha256'], hash('sha256', $image->rgba));
        self::assertSame($case['levels'], self::fixtureLevels($image->rgba, $image->width, $case['cells']));
        self::assertSame([$image->width, $image->height, $image->rgba], self::decodePng($image->png));
    }

    #[DataProvider('imageRejections')]
    public function testOversizedImageScenarioRaisesInvalidArgument(array $case): void
    {
        try {
            TestInputs::paintTestImage($case['input'] ?? $case['signal'], $case['key'], $case['expiresAt']);
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
        self::assertSame($case['code'], TestInputs::generateTestTextCode($case['input'] ?? $case['signal'], $case['key'], $case['expiresAt']));
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
                'text' => TestInputs::generateTestTextCode($scenario, $case['key'], $case['expiresAt'] ?? null),
                'media' => TestInputs::generateMediaTestCode($scenario, $case['key']),
            };
            self::fail("{$case['name']} was accepted");
        } catch (InvalidArgumentException $error) {
            self::assertSame(SdkErrorCodes::INVALID_ARGUMENT, $error->errorCode);
        }
    }
}
