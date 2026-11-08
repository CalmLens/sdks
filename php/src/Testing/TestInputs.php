<?php

declare(strict_types=1);

namespace CalmLens\Testing;

use CalmLens\Exception\InvalidArgumentException;
use CalmLens\SdkErrorCodes;

/**
 * Signed test inputs: text codes, test images and media phrases that a project's test input key
 * authenticates, so CalmLens returns the scenario they describe instead of classifying them. The
 * formats match the JavaScript SDK's
 * `calmlens/test-inputs` byte for byte.
 *
 * A scenario is an array with the API's keys: up to 128 `instances` (each a `category`, the
 * category's content `qualifiers` that apply, and optionally a `score` from 0 to 1 and an
 * `action`, set on every instance or on none), the `unassessedCategories` CalmLens reports as not
 * assessed (none may have instances), up to one of the `regionalActions` per region, and
 * optionally the person and face `detections` to report instead of running detection.
 * Input-type qualifiers such as `sexual-text` are automatic. Every method checks its scenario and
 * key and throws `InvalidArgumentException` (`sdk/invalid-argument`) for one the API would reject.
 *
 * `detections` may hold `people` and `faces`, each a list of up to
 * `Classification::TEST_DETECTIONS_MAX` (32) entries, or `'unavailable'` to report that feature as
 * not evaluated. An entry has a `box` of `[left, top, width, height]` in integer basis points of
 * the image (0 to `Classification::TEST_DETECTION_BOX_MAX`, 10000, with left + width and top +
 * height at most 10000) and optionally a `confidence` from 0 to 100; a face may also have an
 * `age`: one of `Classification::TEST_FACE_AGE_PRESETS` (`'adult'` or `'minor'`) or a range
 * `['low' => …, 'high' => …]` of whole years from 0 to `Classification::TEST_FACE_AGE_MAX` (120).
 *
 * @phpstan-type TestInstance array{category: string, score?: int|float, action?: string, qualifiers: list<string>}
 * @phpstan-type TestRegionalAction array{region: string, action: string}
 * @phpstan-type TestDetectionBox array{int, int, int, int}
 * @phpstan-type TestDetectedPerson array{box: TestDetectionBox, confidence?: int}
 * @phpstan-type TestFaceAge 'adult'|'minor'|array{low: int, high: int}
 * @phpstan-type TestDetectedFace array{box: TestDetectionBox, confidence?: int, age?: TestFaceAge}
 * @phpstan-type TestDetections array{people?: list<TestDetectedPerson>|'unavailable', faces?: list<TestDetectedFace>|'unavailable'}
 * @phpstan-type TestInput array{regionalActions?: list<TestRegionalAction>, unassessedCategories?: list<string>, instances: list<TestInstance>, detections?: TestDetections}
 */
final class TestInputs
{
    /**
     * Ready-made scenarios: a clean input, a limited one, adult images and text, regional
     * delivery, content blocked only in Germany, mixed instances in one category, and person and
     * face detections: one person with one face (`oneFace`), nobody (`noFace`), one face
     * estimated as an adult (`adultFace`) or a minor (`minorFace`), and three people side by side
     * (`group`).
     *
     * @var array<string, TestInput>
     */
    public const PRESETS = [
        'clean' => ['instances' => []],
        'limited' => ['instances' => [['category' => 'harassment', 'qualifiers' => ['harassment-abuse']]]],
        'adultImage' => ['instances' => [['category' => 'sexual', 'qualifiers' => ['sexual-pornographic-media']]]],
        'adultText' => ['instances' => [['category' => 'sexual', 'qualifiers' => ['sexual-explicit-language']]]],
        'regionalDelivery' => ['regionalActions' => [
            ['region' => 'DE', 'action' => 'block'], ['region' => 'GB', 'action' => 'age-restrict'],
            ['region' => 'FR', 'action' => 'limit'],
        ], 'instances' => []],
        'germany' => ['regionalActions' => [['region' => 'DE', 'action' => 'block']], 'instances' => []],
        'mixed' => ['instances' => [
            ['category' => 'harassment', 'qualifiers' => ['harassment-abuse', 'harassment-documentary']],
            ['category' => 'harassment', 'qualifiers' => ['harassment-threat']],
        ]],
        'oneFace' => ['instances' => [], 'detections' => [
            'people' => [['box' => [2500, 1500, 5000, 8500]]], 'faces' => [['box' => [3500, 2000, 3000, 3500]]],
        ]],
        'noFace' => ['instances' => [], 'detections' => ['people' => [], 'faces' => []]],
        'adultFace' => ['instances' => [], 'detections' => [
            'people' => [['box' => [2500, 1500, 5000, 8500]]], 'faces' => [['box' => [3500, 2000, 3000, 3500], 'age' => 'adult']],
        ]],
        'minorFace' => ['instances' => [], 'detections' => [
            'people' => [['box' => [2500, 1500, 5000, 8500]]], 'faces' => [['box' => [3500, 2000, 3000, 3500], 'age' => 'minor']],
        ]],
        'group' => ['instances' => [], 'detections' => [
            'people' => [['box' => [500, 2000, 2800, 8000]], ['box' => [3600, 2000, 2800, 8000]], ['box' => [6700, 2000, 2800, 8000]]],
            'faces' => [['box' => [1200, 2500, 1400, 2000]], ['box' => [4300, 2500, 1400, 2000]], ['box' => [7400, 2500, 1400, 2000]]],
        ]],
    ];

    /** The signals `generateTestTextCode` and `paintTestImage` accept: the categories and a few named shortcuts. */
    public const TEXT_SIGNALS = [...Classification::CATEGORIES, 'sexual.involving-minors', 'harassment.insult', 'sexual.adult', 'hate.regional-symbol', 'violence.graphic'];

    /** The signals `generateMediaTestCode` accepts. */
    public const MEDIA_SIGNALS = [...Classification::CATEGORIES, 'violence.graphic'];

    private const ACTIONS = ['allow', 'limit', 'age-restrict', 'block'];
    private const REGIONS = ['DE', 'AT', 'FR', 'GB', 'EU', 'AU', 'BR'];
    private const REGIONAL_ACTIONS = ['limit', 'age-restrict', 'block'];
    /** Category colours, carried in a test image's chroma only. */
    private const COLOURS = [
        'sexual' => [232, 80, 160], 'violence' => [224, 56, 64], 'self-harm' => [24, 168, 152], 'harassment' => [240, 128, 48],
        'hate' => [144, 80, 216], 'criminal-activity' => [224, 184, 40], 'personal-information' => [48, 128, 224], 'profanity' => [136, 192, 48],
    ];
    private const HEX_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
    private function __construct()
    {
    }

    /**
     * The scenario a signal (one of `TEXT_SIGNALS`) stands for in a text code (`$kind = 'text'`)
     * or an image (`'image'`).
     *
     * @return TestInput
     */
    public static function testInputForSignal(string $signal, string $kind = 'text'): array
    {
        if (!in_array($kind, ['text', 'image'], true)) {
            throw self::invalid('kind must be text or image');
        }
        return match (true) {
            $signal === 'harassment.insult' => self::PRESETS['limited'],
            $signal === 'sexual.adult' => self::PRESETS[$kind === 'image' ? 'adultImage' : 'adultText'],
            $signal === 'hate.regional-symbol' => ['instances' => [['category' => 'hate', 'qualifiers' => ['hate-symbol', 'hate-nazi-symbols-public-display']]]],
            $signal === 'sexual.involving-minors' => ['instances' => [['category' => 'sexual', 'qualifiers' => ['sexual-minors']]]],
            $signal === 'violence.graphic' => ['instances' => [['category' => 'violence', 'qualifiers' => ['violence-injury', 'violence-graphic']]]],
            in_array($signal, Classification::CATEGORIES, true) => ['instances' => [['category' => $signal, 'qualifiers' => []]]],
            default => throw self::invalid("Unknown test signal: $signal"),
        };
    }

    /**
     * A text code for a scenario or a signal (one of `TEXT_SIGNALS`), signed with
     * `$testInputKey`: the project's secret test input key from the portal. Submit it as the whole
     * text: CalmLens moderates text with anything else around the code as ordinary content.
     *
     * @param TestInput|string $scenario
     */
    public static function generateTestTextCode(array|string $scenario, #[\SensitiveParameter] string $testInputKey): string
    {
        self::checkKey($testInputKey);
        return self::textCode(self::validate(is_string($scenario) ? self::testInputForSignal($scenario) : $scenario), $testInputKey);
    }

    /**
     * The test image for a scenario or a signal (one of `TEXT_SIGNALS`), signed with
     * `$testInputKey`: the project's secret test input key from the portal. The image survives
     * lossy formats and resizing: upload its `png`, or encode its `rgba` in any format, as the
     * whole image, optionally on a plain single-colour border; CalmLens moderates an image with
     * anything else in it as ordinary content. Throws `InvalidArgumentException` for a scenario
     * too large for a test image.
     *
     * @param TestInput|string $scenario
     */
    public static function paintTestImage(array|string $scenario, #[\SensitiveParameter] string $testInputKey): PaintedTestImage
    {
        self::checkKey($testInputKey);
        $checked = self::validate(is_string($scenario) ? self::testInputForSignal($scenario, 'image') : $scenario);
        $tag = explode(' ', self::textCode($checked, $testInputKey))[1];
        $content = self::canonical($checked);
        $palette = [];
        foreach ($checked['instances'] as $instance) {
            $palette[$instance['category']] = self::COLOURS[$instance['category']];
        }
        $grid = TestImageGrid::paint(pack('n', strlen($content)) . hex2bin($tag) . $content, array_values($palette) ?: [[144, 152, 160]]);
        if ($grid === null) {
            throw self::invalid('The test scenario is too large for a test image');
        }
        [$width, $rgba] = $grid;
        return new PaintedTestImage($width, $width, $rgba, TestImageGrid::png($width, $width, $rgba));
    }

    /**
     * A phrase to read aloud in audio, or show as large, high-contrast text in a video frame, for
     * one of `MEDIA_SIGNALS`, signed with `$testInputKey`: the project's secret test input key
     * from the portal.
     */
    public static function generateMediaTestCode(string $signal, #[\SensitiveParameter] string $testInputKey): string
    {
        if (!in_array($signal, self::MEDIA_SIGNALS, true)) {
            throw self::invalid("Unsupported media test signal: $signal");
        }
        self::checkKey($testInputKey);
        $words = array_map(static fn (string $digit): string => self::HEX_WORDS[hexdec($digit)], str_split(self::tag($testInputKey, "calmlens-test:media:$signal")));
        return 'Calm Lens test ' . implode(' ', $words) . ' ' . str_replace(['.', '-'], ' ', $signal) . ' end test';
    }

    private static function checkKey(#[\SensitiveParameter] string $testInputKey): void
    {
        if (!preg_match('/^[a-f0-9]{32}$/D', $testInputKey)) {
            throw self::invalid('The test input key must be 32 lowercase hexadecimal characters');
        }
    }

    private static function tag(#[\SensitiveParameter] string $testInputKey, string $message): string
    {
        return substr(hash_hmac('sha256', $message, $testInputKey), 0, 32);
    }

    /**
     * The signed payload is the scenario's canonical JSON.
     *
     * @param TestInput $scenario
     */
    private static function textCode(array $scenario, #[\SensitiveParameter] string $testInputKey): string
    {
        $payload = rtrim(strtr(base64_encode(self::canonical($scenario)), '+/', '-_'), '=');
        if (strlen($payload) > 8000) {
            throw self::invalid('The test scenario is too large');
        }
        return '<!calmlens-test ' . self::tag($testInputKey, "calmlens-test:v2:$payload") . " $payload>";
    }

    /**
     * JSON without whitespace, with numbers as JavaScript prints them; validated scenarios are
     * already in the canonical key order and hold only ASCII tokens. `$object` prints an empty
     * array as `{}`: `detections` is the only object a scenario may leave empty.
     */
    private static function canonical(mixed $value, bool $object = false): string
    {
        return match (true) {
            is_array($value) && array_is_list($value) && !($object && $value === []) => '[' . implode(',', array_map(static fn (mixed $item): string => self::canonical($item), $value)) . ']',
            is_array($value) => '{' . implode(',', array_map(static fn (string $key, mixed $item): string => "\"$key\":" . self::canonical($item, $key === 'detections'), array_keys($value), $value)) . '}',
            is_string($value) => "\"$value\"",
            is_int($value) => (string) $value,
            default => self::jsNumber((float) $value),
        };
    }

    /** A score (0 to 1) as JavaScript's `JSON.stringify` prints it. */
    private static function jsNumber(float $value): string
    {
        if ($value === floor($value)) {
            return (string) (int) $value;
        }
        for ($precision = 0; (float) ($text = sprintf("%.{$precision}e", $value)) !== $value; $precision++) {
        }
        [$mantissa, $exponent] = explode('e', $text);
        $digits = rtrim(str_replace('.', '', $mantissa), '0');
        $power = (int) $exponent;
        if ($value < 1e-6) {
            return $digits[0] . (strlen($digits) > 1 ? '.' . substr($digits, 1) : '') . "e$power";
        }
        return '0.' . str_repeat('0', -$power - 1) . $digits;
    }

    /** @return list<mixed> */
    private static function list(mixed $value, string $name, int $limit): array
    {
        if (!is_array($value) || !array_is_list($value)) {
            throw self::invalid("$name must be a list");
        }
        if (count($value) > $limit) {
            throw self::invalid("$name may have at most $limit items");
        }
        return $value;
    }

    /**
     * @param list<string> $required
     * @param list<string> $optional
     * @return array<string, mixed>
     */
    private static function fields(mixed $value, string $name, array $required, array $optional = []): array
    {
        if (!is_array($value)) {
            throw self::invalid("$name must be an array");
        }
        $unknown = array_diff(array_map(strval(...), array_keys($value)), $required, $optional);
        if ($unknown) {
            throw self::invalid("$name has unknown fields: " . implode(', ', $unknown));
        }
        $missing = array_diff($required, array_keys($value));
        if ($missing) {
            throw self::invalid("$name is missing " . implode(', ', $missing));
        }
        return $value;
    }

    /** @param list<mixed> $values */
    private static function unique(array $values): bool
    {
        return count(array_unique($values)) === count($values);
    }

    /**
     * Checks a scenario like the API and copies it in canonical key order.
     *
     * @return TestInput
     */
    private static function validate(mixed $scenario): array
    {
        $fields = self::fields($scenario, 'The test scenario', ['instances'], ['regionalActions', 'unassessedCategories', 'detections']);
        $result = [];
        if (array_key_exists('regionalActions', $fields)) {
            $result['regionalActions'] = [];
            foreach (self::list($fields['regionalActions'], 'regionalActions', count(self::REGIONS)) as $item) {
                $entry = self::fields($item, 'A regional action', ['region', 'action']);
                if (!in_array($entry['region'], self::REGIONS, true) || !in_array($entry['action'], self::REGIONAL_ACTIONS, true)) {
                    throw self::invalid('Regional actions need a region of ' . implode(', ', self::REGIONS) . ' and an action of ' . implode(', ', self::REGIONAL_ACTIONS));
                }
                $result['regionalActions'][] = ['region' => $entry['region'], 'action' => $entry['action']];
            }
            if (!self::unique(array_column($result['regionalActions'], 'region'))) {
                throw self::invalid('Each region may have one regional action');
            }
        }
        $instances = [];
        foreach (self::list($fields['instances'], 'instances', 128) as $item) {
            $entry = self::fields($item, 'An instance', ['category', 'qualifiers'], ['score', 'action']);
            $category = $entry['category'];
            if (!in_array($category, Classification::CATEGORIES, true)) {
                throw self::invalid('An instance needs a category of ' . implode(', ', Classification::CATEGORIES));
            }
            $instance = ['category' => $category];
            if (array_key_exists('score', $entry)) {
                $score = $entry['score'];
                if (!(is_int($score) || is_float($score)) || !($score >= 0 && $score <= 1)) {
                    throw self::invalid("An instance's score must be a number from 0 to 1");
                }
                $instance['score'] = $score;
            }
            if (array_key_exists('action', $entry)) {
                if (!in_array($entry['action'], self::ACTIONS, true)) {
                    throw self::invalid("An instance's action must be one of " . implode(', ', self::ACTIONS));
                }
                $instance['action'] = $entry['action'];
            }
            $qualifiers = self::list($entry['qualifiers'], 'qualifiers', 64);
            foreach ($qualifiers as $qualifier) {
                if (!in_array($qualifier, Classification::QUALIFIERS[$category], true) || in_array($qualifier, Classification::INPUT_QUALIFIERS, true)) {
                    throw self::invalid("Choose content qualifiers of $category; input-type qualifiers are automatic");
                }
            }
            if (!self::unique($qualifiers)) {
                throw self::invalid('Each qualifier may be listed once');
            }
            $instance['qualifiers'] = $qualifiers;
            $instances[] = $instance;
        }
        if (count(array_unique(array_map(static fn (array $instance): bool => isset($instance['action']), $instances))) > 1) {
            throw self::invalid('Set an action on every instance or on none');
        }
        if (array_key_exists('unassessedCategories', $fields)) {
            $unassessed = self::list($fields['unassessedCategories'], 'unassessedCategories', count(Classification::CATEGORIES));
            foreach ($unassessed as $category) {
                if (!in_array($category, Classification::CATEGORIES, true) || in_array($category, array_column($instances, 'category'), true)) {
                    throw self::invalid('Unassessed categories must be unique categories without instances');
                }
            }
            if (!self::unique($unassessed)) {
                throw self::invalid('Unassessed categories must be unique categories without instances');
            }
            $result['unassessedCategories'] = $unassessed;
        }
        $result['instances'] = $instances;
        if (array_key_exists('detections', $fields)) {
            $result['detections'] = self::detections($fields['detections']);
        }
        return $result;
    }

    /**
     * Checks a scenario's `detections` and copies them in canonical key order.
     *
     * @return TestDetections
     */
    private static function detections(mixed $value): array
    {
        $fields = self::fields($value, 'detections', [], ['people', 'faces']);
        $result = [];
        foreach (['people' => false, 'faces' => true] as $name => $face) {
            if (!array_key_exists($name, $fields)) {
                continue;
            }
            if ($fields[$name] === 'unavailable') {
                $result[$name] = 'unavailable';
                continue;
            }
            $result[$name] = array_map(static fn (mixed $item): array => self::detection($item, $face),
                self::list($fields[$name], "detections.$name", Classification::TEST_DETECTIONS_MAX));
        }
        return $result;
    }

    /**
     * Checks one detected person or face (with `$face`, which may have an age).
     *
     * @return TestDetectedPerson|TestDetectedFace
     */
    private static function detection(mixed $value, bool $face): array
    {
        $entry = self::fields($value, $face ? 'A detected face' : 'A detected person', ['box'], $face ? ['confidence', 'age'] : ['confidence']);
        $box = $entry['box'];
        $max = Classification::TEST_DETECTION_BOX_MAX;
        if (!is_array($box) || !array_is_list($box) || count($box) !== 4
            || array_filter($box, static fn (mixed $side): bool => !self::whole($side, $max)) !== []
            || $box[0] + $box[2] > $max || $box[1] + $box[3] > $max) {
            throw self::invalid("A box must be four whole numbers from 0 to $max, with left + width and top + height at most $max");
        }
        $detection = ['box' => $box];
        if (array_key_exists('confidence', $entry)) {
            if (!self::whole($entry['confidence'], 100)) {
                throw self::invalid('A confidence must be a whole number from 0 to 100');
            }
            $detection['confidence'] = $entry['confidence'];
        }
        if (array_key_exists('age', $entry)) {
            $detection['age'] = self::age($entry['age']);
        }
        return $detection;
    }

    /** @return TestFaceAge */
    private static function age(mixed $value): string|array
    {
        if (is_string($value)) {
            if (!in_array($value, Classification::TEST_FACE_AGE_PRESETS, true)) {
                throw self::invalid('An age must be one of ' . implode(', ', Classification::TEST_FACE_AGE_PRESETS) . ' or a range');
            }
            return $value;
        }
        $range = self::fields($value, 'An age range', ['low', 'high']);
        $max = Classification::TEST_FACE_AGE_MAX;
        if (!self::whole($range['low'], $max) || !self::whole($range['high'], $max) || $range['low'] > $range['high']) {
            throw self::invalid("An age range needs whole years from 0 to $max, with low at most high");
        }
        return ['low' => $range['low'], 'high' => $range['high']];
    }

    /** Whether `$value` is an integer from 0 to `$max`. */
    private static function whole(mixed $value, int $max): bool
    {
        return is_int($value) && $value >= 0 && $value <= $max;
    }

    private static function invalid(string $message): InvalidArgumentException
    {
        return new InvalidArgumentException(SdkErrorCodes::INVALID_ARGUMENT, $message);
    }
}
