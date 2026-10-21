<?php

declare(strict_types=1);

use CalmLens\CalmLensException;
use CalmLens\ServerClient;
use PHPUnit\Framework\TestCase;

final class HttpTest extends TestCase
{
    private static $process;
    private static string $url;
    private static string $log;

    public static function setUpBeforeClass(): void
    {
        $socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
        if ($socket === false) {
            throw new RuntimeException($error, $errno);
        }
        $address = stream_socket_get_name($socket, false);
        fclose($socket);
        self::$url = 'http://' . $address;
        self::$log = tempnam(sys_get_temp_dir(), 'calmlens-http-');
        self::$process = proc_open([PHP_BINARY, '-S', $address, __DIR__ . '/http-router.php'],
            [0 => ['pipe', 'r'], 1 => ['file', self::$log, 'a'], 2 => ['file', self::$log, 'a']], $pipes);
        fclose($pipes[0]);
        $deadline = microtime(true) + 5;
        do {
            $ready = @stream_socket_client('tcp://' . $address, $errno, $error, 0.1);
            if ($ready !== false) {
                fclose($ready);
                return;
            }
            usleep(10000);
        } while (microtime(true) < $deadline);
        throw new RuntimeException('HTTP fixture did not start: ' . file_get_contents(self::$log));
    }

    public static function tearDownAfterClass(): void
    {
        if (is_resource(self::$process)) {
            proc_terminate(self::$process);
            proc_close(self::$process);
        }
        unlink(self::$log);
    }

    public function testRealHttpUploadSendsStoredBytesHeadersAndNestedQuery(): void
    {
        $client = new ServerClient('local-key', 'project', baseUrl: self::$url . '/v1');
        $file = tmpfile();
        try {
            fwrite($file, "skip\0binary\xff✓");
            fseek($file, 4);
            $received = $client->assets->create(['name' => 'file', 'content' => ['type' => 'image/png', 'data' => $file], 'metadata' => [['id' => 'source', 'value' => 'a&b']]]);
            self::assertSame('POST', $received['method']);
            self::assertSame('/v1/projects/project/assets', $received['path']);
            self::assertSame("\0binary\xff✓", base64_decode($received['bytes']));
            self::assertSame('local-key', $received['apiKey']);
            self::assertSame('image/png', $received['contentType']);
            self::assertSame('[{"id":"source","value":"a&b"}]', $received['query']['metadata']);
            self::assertSame('true', $received['query']['queue']);
            self::assertMatchesRegularExpression('/^[a-f0-9-]{36}$/', $received['idempotencyKey']);
        } finally {
            fclose($file);
        }
    }

    public function testRealHttpNeverFollowsCredentialBearingRedirect(): void
    {
        $client = new ServerClient('local-key', 'project', baseUrl: self::$url . '/v1');
        try {
            $client->assets->retrieve(['assetId' => 'redirect']);
            self::fail('Redirect was followed');
        } catch (CalmLensException $error) {
            self::assertSame('sdk/http-error', $error->errorCode);
            self::assertSame(302, $error->status);
        }
    }
}
