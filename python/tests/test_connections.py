"""The default transport against local servers: streamed uploads, fork safety and proxies."""
import base64
import os
import tempfile
import threading
import unittest
import unittest.mock
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from calmlens import CalmLensServerClient, CalmLensError


class _RecordingServer:
    """A keep-alive HTTP server that records each request's line, headers and body."""

    def __init__(self):
        self.requests, self.connections = [], 0
        recorder = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def setup(self):
                super().setup()
                recorder.connections += 1

            def answer(self):
                length = int(self.headers.get('Content-Length') or 0)
                body = self.rfile.read(length) if length else b''
                if self.headers.get('Transfer-Encoding') == 'chunked':
                    while True:
                        size = int(self.rfile.readline().split(b';')[0], 16)
                        body += self.rfile.read(size)
                        self.rfile.readline()
                        if not size:
                            break
                recorder.requests.append((self.requestline, self.headers, body))
                payload = b'{"id":"asset","upload":{"status":"completed"},"classification":{"status":"processing","moderation":{"status":"pending"}}}'
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            do_GET = do_POST = answer

            def do_CONNECT(self):
                recorder.requests.append((self.requestline, self.headers, b''))
                self.send_response(502)
                self.send_header('Content-Length', '0')
                self.end_headers()
                self.close_connection = True

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.address = f'127.0.0.1:{self.server.server_port}'

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class StreamingUploadTests(unittest.TestCase):
    def test_file_uploads_stream_with_a_content_length(self):
        server = _RecordingServer()
        try:
            with tempfile.TemporaryFile() as file:
                file.write(b'x' * 300_000)
                file.seek(0)
                with CalmLensServerClient(api_key='key', project_id='project', base_url=f'http://{server.address}/v1') as client:
                    client.assets.create(name='photo.jpg', content={'data': file, 'type': 'image/jpeg'})
            line, headers, body = server.requests[-1]
            self.assertTrue(line.startswith('POST /v1/projects/project/assets?'))
            self.assertEqual(headers.get('Content-Length'), '300000')
            self.assertNotIn('Transfer-Encoding', headers)
            self.assertEqual(body, b'x' * 300_000)
        finally:
            server.close()


    def test_streams_of_unknown_length_are_sent_chunked(self):
        server = _RecordingServer()
        read, write = os.pipe()
        try:
            os.write(write, b'y' * 30_000)
            os.close(write)
            with open(read, 'rb', buffering=0) as pipe, CalmLensServerClient(
                    api_key='key', project_id='project', base_url=f'http://{server.address}/v1') as client:
                client.assets.create(name='doc.pdf', content={'data': pipe, 'type': 'application/pdf'})
            line, headers, body = server.requests[-1]
            self.assertNotIn('sizeInBytes', line)
            self.assertEqual((headers.get('Transfer-Encoding'), headers.get('Content-Length')), ('chunked', None))
            self.assertEqual(body, b'y' * 30_000)
        finally:
            server.close()


class ForkTests(unittest.TestCase):
    @unittest.skipIf(not hasattr(os, 'fork'), 'requires os.fork')
    def test_child_process_opens_its_own_connections(self):
        server = _RecordingServer()
        try:
            with CalmLensServerClient(api_key='key', project_id='project', base_url=f'http://{server.address}/v1',
                                max_retries=0) as client:
                client.assets.retrieve(asset_id='asset')
                self.assertEqual(server.connections, 1)
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore', DeprecationWarning)  # fork() while threads run
                    pid = os.fork()
                if pid == 0:
                    try:
                        client.assets.retrieve(asset_id='asset')
                        os._exit(0)
                    except BaseException:
                        os._exit(1)
                _, status = os.waitpid(pid, 0)
                self.assertEqual(os.waitstatus_to_exitcode(status), 0)
                self.assertEqual(server.connections, 2)
                # The parent's pooled connection is still its own.
                client.assets.retrieve(asset_id='asset')
                self.assertEqual(server.connections, 2)
        finally:
            server.close()


class ProxyTests(unittest.TestCase):
    def environment(self, **proxies):
        clean = {k: v for k, v in os.environ.items()
                 if k.lower() not in ('http_proxy', 'https_proxy', 'no_proxy', 'all_proxy')}
        return unittest.mock.patch.dict(os.environ, {**clean, **proxies}, clear=True)

    def test_http_requests_use_absolute_urls_and_proxy_credentials(self):
        proxy = _RecordingServer()
        try:
            with self.environment(HTTP_PROXY=f'http://user:p%40ss@{proxy.address}'):
                with CalmLensServerClient(api_key='key', project_id='project', base_url='http://api.example.test/v1') as client:
                    client.assets.retrieve(asset_id='asset')
            line, headers, _ = proxy.requests[-1]
            self.assertEqual(line, 'GET http://api.example.test/v1/assets/asset HTTP/1.1')
            self.assertEqual(headers['Proxy-Authorization'], 'Basic ' + base64.b64encode(b'user:p@ss').decode())
        finally:
            proxy.close()

    def test_https_requests_tunnel_through_http_proxies(self):
        proxy = _RecordingServer()
        try:
            with self.environment(HTTPS_PROXY=f'http://user:pw@{proxy.address}'):
                with CalmLensServerClient(api_key='key', project_id='project', base_url='https://api.example.test/v1',
                                    max_retries=0) as client:
                    with self.assertRaises(CalmLensError) as raised:
                        client.assets.retrieve(asset_id='asset')
            self.assertEqual(raised.exception.code, 'sdk/transport-error')
            line, headers, _ = proxy.requests[-1]
            self.assertTrue(line.startswith('CONNECT api.example.test:443 HTTP/1.'), line)
            self.assertEqual(headers['Proxy-Authorization'], 'Basic ' + base64.b64encode(b'user:pw').decode())
        finally:
            proxy.close()

    def test_https_proxy_urls_for_https_requests_are_a_configuration_error(self):
        def connect(*args, **kwargs):
            raise AssertionError('connected')
        with self.environment(HTTPS_PROXY='https://proxy.example.test:3128'), \
                unittest.mock.patch('socket.create_connection', connect):
            with CalmLensServerClient(api_key='key', project_id='project') as client:
                with self.assertRaises(CalmLensError) as raised:
                    client.assets.retrieve(asset_id='asset')
        self.assertEqual(raised.exception.code, 'sdk/invalid-config')


if __name__ == '__main__':
    unittest.main()
