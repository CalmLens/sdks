<?php

declare(strict_types=1);

use CalmLens\CalmLensException;
use CalmLens\ErrorCodes;
use CalmLens\ServerClient;
use CalmLens\Testing\MockModerationInput;
use CalmLens\Testing\MockServerClient;
use CalmLens\Testing\RecordedRequest;
use GuzzleHttp\Client;
use GuzzleHttp\Promise\Create;
use GuzzleHttp\Psr7\NoSeekStream;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Psr7\Utils;
use PHPUnit\Framework\TestCase;
use Psr\Http\Message\RequestInterface;

final class AutomaticMultipartTest extends TestCase
{
    private const MIB = 1024 * 1024;

    /** Distinct bytes, so a part sent at the wrong offset shows. */
    private static function fileOf(int $length): string
    {
        $pattern = '';
        for ($i = 0; $i < 251; $i++) {
            $pattern .= chr(($i * 7) % 251);
        }
        return substr(str_repeat($pattern, intdiv($length, 251) + 1), 0, $length);
    }

    private static function asset(string $status, ?int $partsReceived): array
    {
        return ['id' => 'asset-1', 'upload' => ['status' => $status, 'partsReceived' => $partsReceived],
            'classification' => ['status' => 'pending', 'moderation' => ['status' => 'pending']]];
    }

    /**
     * A client whose requests are recorded in `$sent` (path, query, Idempotency-Key, body) and
     * answered by `$respond`, or like the API: uploading until the final part.
     *
     * @param list<array{path: string, query: array, key: string, body: string}> $sent
     */
    private static function scripted(array &$sent, ?callable $respond = null, int $maxRetries = 0, int $partSizeBytes = 5 * self::MIB): ServerClient
    {
        $handler = function (RequestInterface $request) use (&$sent, $respond) {
            parse_str($request->getUri()->getQuery(), $query);
            $entry = ['path' => $request->getUri()->getPath(), 'query' => $query,
                'key' => $request->getHeaderLine('Idempotency-Key'), 'body' => (string) $request->getBody()];
            $sent[] = $entry;
            $response = $respond === null ? null : $respond($entry);
            $response ??= new Response(200, ['Content-Type' => 'application/json'], json_encode(($query['isFinal'] ?? null) === 'true'
                ? self::asset('completed', null) : self::asset('uploading', (int) ($query['partNumber'] ?? 1))));
            return Create::promiseFor($response);
        };
        return new ServerClient('key', 'project-1', maxRetries: $maxRetries, httpClient: new Client(['handler' => $handler]),
            partSizeBytes: $partSizeBytes);
    }

    private static function apiError(string $code, array $details = []): Response
    {
        return new Response(ErrorCodes::STATUSES[$code], ['Content-Type' => 'application/json'],
            json_encode(['code' => $code, 'message' => $code, 'requestId' => 'req', 'details' => (object) $details]));
    }

    private static function errorCode(callable $call): ?string
    {
        try {
            $call();
        } catch (CalmLensException $error) {
            return $error->errorCode;
        }
        return null;
    }

    public function testContentLargerThanAPartIsSplitAndTheMockStoresTheJoinedBytes(): void
    {
        $moderated = [];
        $mock = new MockServerClient(partSizeBytes: 5 * self::MIB, moderate: function (MockModerationInput $input) use (&$moderated) {
            $moderated[] = $input->bytes;
            return 'allowed';
        });
        $file = self::fileOf(11 * self::MIB);
        $asset = $mock->client()->assets->classify(['name' => 'clip.mp4', 'content' => ['bytes' => $file, 'type' => 'video/mp4'],
            'requestOptions' => ['idempotencyKey' => 'upload-1']]);

        self::assertSame('completed', $asset['upload']['status']);
        self::assertSame(11 * self::MIB, $asset['content']['sizeInBytes']);
        $requests = $mock->requests();
        self::assertSame(['/projects/project-1/assets', "/assets/{$asset['id']}/part", "/assets/{$asset['id']}/part"],
            array_map(fn (RecordedRequest $request) => $request->path, $requests));
        self::assertSame(['upload-1', 'upload-1:part-2', 'upload-1:part-3'],
            array_map(fn (RecordedRequest $request) => $request->request->getHeaderLine('Idempotency-Key'), $requests));
        self::assertSame([['1', 'false', (string) (5 * self::MIB)], ['2', 'false', (string) (5 * self::MIB)], ['3', 'true', (string) self::MIB]],
            array_map(fn (RecordedRequest $request) => [$request->query['partNumber'], $request->query['isFinal'], $request->query['sizeInBytes']], $requests));
        self::assertSame((string) (11 * self::MIB), $requests[0]->query['totalSizeInBytes']);
        self::assertSame([hash('sha256', $file)], array_map(fn (?string $bytes) => $bytes === null ? null : hash('sha256', $bytes), $moderated));
    }

    public function testASeekableFileIsSplitFromItsCurrentOffset(): void
    {
        $sent = [];
        $client = self::scripted($sent);
        $file = self::fileOf(6 * self::MIB);
        $handle = fopen('php://temp', 'w+b');
        fwrite($handle, 'skip' . $file);
        fseek($handle, 4);
        $client->assets->create(['name' => 'report.pdf', 'content' => ['data' => $handle, 'type' => 'application/pdf']]);
        self::assertSame(['1', '2'], array_map(fn ($request) => $request['query']['partNumber'], $sent));
        self::assertSame(hash('sha256', $file), hash('sha256', implode('', array_column($sent, 'body'))));
        fclose($handle);
    }

    public function testTheMockResumesAnUploadWithTheSameKeyAfterAPartFails(): void
    {
        $moderated = [];
        $mock = new MockServerClient(partSizeBytes: 5 * self::MIB, moderate: function (MockModerationInput $input) use (&$moderated) {
            $moderated[] = strlen((string) $input->bytes);
            return 'allowed';
        });
        $options = ['name' => 'report.pdf', 'content' => ['bytes' => self::fileOf(12 * self::MIB), 'type' => 'application/pdf'],
            'requestOptions' => ['idempotencyKey' => 'upload-3']];
        $mock->failNextRequest('transport-error', 'assets.uploadPart');
        self::assertSame('sdk/transport-error', self::errorCode(fn () => $mock->client()->assets->classify($options)));

        $finished = $mock->client()->assets->classify($options);
        self::assertSame('completed', $finished['upload']['status']);
        self::assertSame(12 * self::MIB, $finished['content']['sizeInBytes']);
        self::assertSame([$finished['id']], array_column($mock->client()->assets->list()['items'], 'id'));
        self::assertSame([12 * self::MIB], $moderated);
    }

    public function testAFailedPartIsRetriedWithItsOwnKeyAndAPartTheApiHasIsSkipped(): void
    {
        $sent = [];
        $failed = false;
        $file = self::fileOf(16 * self::MIB);
        $client = self::scripted($sent, function (array $request) use (&$failed) {
            if (($request['query']['partNumber'] ?? null) === '2' && !$failed) {
                $failed = true;
                return new Response(503, ['Retry-After' => '0']);
            }
            // Part 3's response was lost before: the API asks for part 4.
            return ($request['query']['partNumber'] ?? null) === '3'
                ? self::apiError(ErrorCodes::INVALID_UPLOAD_PART_NUMBER, ['expectedPartNumber' => 4, 'receivedPartNumber' => 3]) : null;
        }, maxRetries: 1);
        $asset = $client->assets->create(['name' => 'report.pdf', 'content' => ['bytes' => $file, 'type' => 'application/pdf'],
            'requestOptions' => ['idempotencyKey' => 'upload-2']]);

        self::assertSame('completed', $asset['upload']['status']);
        self::assertSame(['upload-2', 'upload-2:part-2', 'upload-2:part-2', 'upload-2:part-3', 'upload-2:part-4'], array_column($sent, 'key'));
        self::assertSame($sent[1]['body'], $sent[2]['body']);
        self::assertSame(substr($file, 15 * self::MIB), $sent[4]['body']);
        self::assertSame('true', $sent[4]['query']['isFinal']);
    }

    public function testAFinalPartThatFindsTheUploadCompletedReadsTheAssetBack(): void
    {
        $sent = [];
        $client = self::scripted($sent, fn (array $request) => str_ends_with($request['path'], '/part')
            ? self::apiError(ErrorCodes::UPLOAD_NOT_OPEN)
            : (str_ends_with($request['path'], '/assets/asset-1') ? new Response(200, [], json_encode(self::asset('completed', null))) : null),
            partSizeBytes: ServerClient::DEFAULT_PART_SIZE_BYTES);
        $asset = $client->assets->create(['name' => 'clip.mp4', 'content' => ['bytes' => self::fileOf(9 * self::MIB), 'type' => 'video/mp4']]);

        self::assertSame('completed', $asset['upload']['status']);
        self::assertSame(['/v1/projects/project-1/assets', '/v1/assets/asset-1/part', '/v1/assets/asset-1'], array_column($sent, 'path'));
        // Without a caller's key, the parts share a generated one.
        self::assertSame("{$sent[0]['key']}:part-2", $sent[1]['key']);
        self::assertSame('', $sent[2]['key']);
    }

    public function testStreamsAndContentOfOnePartGoInOneRequest(): void
    {
        $sent = [];
        $client = self::scripted($sent, fn () => new Response(200, [], json_encode(self::asset('completed', null))),
            partSizeBytes: ServerClient::DEFAULT_PART_SIZE_BYTES);
        $client->assets->create(['name' => 'exact.pdf', 'content' => ['bytes' => self::fileOf(8 * self::MIB), 'type' => 'application/pdf']]);
        $stream = new NoSeekStream(Utils::streamFor(self::fileOf(9 * self::MIB)));
        $client->assets->create(['name' => 'stream.pdf', 'content' => ['data' => $stream, 'type' => 'application/pdf', 'sizeInBytes' => 9 * self::MIB]]);

        self::assertSame([null, null], array_map(fn ($request) => $request['query']['partNumber'] ?? null, $sent));
        self::assertSame([8 * self::MIB, 9 * self::MIB], array_map(fn ($request) => strlen($request['body']), $sent));
    }

    public function testRefusesAnInvalidPartSizeAnOverLongKeyAndAnImageOver20MiB(): void
    {
        foreach ([5 * self::MIB - 1, 64 * self::MIB + 1, 5.5 * self::MIB] as $size) {
            self::assertSame('sdk/invalid-config', self::errorCode(fn () => new ServerClient('key', 'project-1', partSizeBytes: $size)));
        }
        $sent = [];
        $client = self::scripted($sent);
        self::assertSame('sdk/invalid-argument', self::errorCode(fn () => $client->assets->create([
            'name' => 'clip.mp4', 'content' => ['bytes' => self::fileOf(6 * self::MIB), 'type' => 'video/mp4'],
            'requestOptions' => ['idempotencyKey' => str_repeat('k', 241)]])));
        self::assertSame(ErrorCodes::MULTIPART_IMAGE_TOO_LARGE, self::errorCode(fn () => $client->assets->create([
            'name' => 'huge.png', 'content' => ['bytes' => self::fileOf(21 * self::MIB), 'type' => 'image/png']])));
        self::assertSame([], $sent);
    }

    public function testAnImageOverTheOneRequestLimitGoesInParts(): void
    {
        $sent = [];
        $client = self::scripted($sent);
        $asset = $client->assets->create(['name' => 'photo.png', 'content' => ['bytes' => self::fileOf(15 * self::MIB), 'type' => 'image/png']]);
        self::assertSame('completed', $asset['upload']['status']);
        self::assertSame(['1', '2', '3'], array_map(fn ($request) => $request['query']['partNumber'], $sent));
    }
}
