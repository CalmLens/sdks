import http.client
import io
import socket
import ssl
import struct
import threading
import time
import unittest
import unittest.mock
import urllib.error
import zlib
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from calmlens import CalmLensServerClient, CalmLensError
from calmlens.client import _Transport

class TransportTests(unittest.TestCase):
    def test_connections_are_reused_and_closed(self):
        ports = []
        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def do_GET(self):
                ports.append(self.client_address[1])
                body = b'{"id":"asset","upload":{"status":"completed"},"classification":{"status":"processing","moderation":{"status":"pending"}}}'
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *args): pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            with CalmLensServerClient(api_key='key', project_id='project', base_url=f'http://127.0.0.1:{server.server_port}') as client:
                for _ in range(3): client.assets.retrieve({'assetId':'asset'})
            self.assertEqual(len(set(ports)), 1)
            with self.assertRaises(CalmLensError): client.assets.retrieve({'assetId':'asset'})
        finally: server.shutdown(); server.server_close(); thread.join()

    def test_unrelated_parts_are_concurrent(self):
        barrier = threading.Barrier(2)
        def transport(request, timeout):
            barrier.wait(timeout=2)
            response = io.BytesIO(b'{"id":"asset","upload":{"status":"completed"},"classification":{"status":"processing","moderation":{"status":"pending"}}}'); response.status = 200
            return response
        client = CalmLensServerClient(api_key='key', project_id='project', transport=transport)
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda asset: client.assets.upload_part({'assetId':asset,'part':{'plainText':'final','partNumber':2,'isFinal':True}}), ['one','two']))
        self.assertEqual(len(results), 2)


class _FailingRead(io.BytesIO):
    def __init__(self, error):
        super().__init__(b'')
        self.status, self.error = 200, error

    def read(self, *args):
        raise self.error


class TransportFailureTests(unittest.TestCase):
    FAILURES = [
        (ConnectionResetError(54, 'Connection reset by peer'), 'sdk/transport-error'),
        (ConnectionRefusedError(61, 'Connection refused'), 'sdk/transport-error'),
        (ssl.SSLError(1, 'certificate verify failed'), 'sdk/transport-error'),
        (socket.gaierror(8, 'nodename nor servname provided'), 'sdk/transport-error'),
        (http.client.RemoteDisconnected('Remote end closed connection'), 'sdk/transport-error'),
        (http.client.BadStatusLine('garbage'), 'sdk/transport-error'),
        (http.client.IncompleteRead(b'{"id"', 10), 'sdk/transport-error'),
        (http.client.LineTooLong('header line'), 'sdk/transport-error'),
        (zlib.error('invalid stored block lengths'), 'sdk/transport-error'),
        (EOFError('Compressed file ended before the end-of-stream marker was reached'), 'sdk/transport-error'),
        (socket.timeout('timed out'), 'sdk/timeout'),
        (TimeoutError('timed out'), 'sdk/timeout'),
        (urllib.error.URLError(TimeoutError('timed out')), 'sdk/timeout'),
        (urllib.error.URLError('no route'), 'sdk/transport-error'),
    ]

    def assert_wrapped(self, call, error, code):
        with self.assertRaises(CalmLensError) as raised:
            call()
        self.assertEqual(raised.exception.code, code)
        self.assertIs(raised.exception.__cause__, error)
        self.assertIsNone(raised.exception.status)

    def test_errors_raised_by_the_transport_are_wrapped(self):
        for error, code in self.FAILURES:
            with self.subTest(error=type(error).__name__):
                def transport(request, timeout): raise error
                client = CalmLensServerClient(api_key='key', project_id='project', transport=transport, max_retries=0)
                self.assert_wrapped(lambda: client.assets.retrieve({'assetId': 'asset'}), error, code)
                self.assert_wrapped(lambda: client.cdn.serve({'assetIdentifier': 'asset'}), error, code)

    def test_errors_raised_while_reading_the_body_are_wrapped(self):
        for error, code in self.FAILURES:
            with self.subTest(error=type(error).__name__):
                client = CalmLensServerClient(api_key='key', project_id='project', transport=lambda r, t: _FailingRead(error),
                                        max_retries=0)
                self.assert_wrapped(lambda: client.events.list(), error, code)
                with client.cdn.serve({'assetIdentifier': 'asset'}) as response:
                    self.assertEqual(response.status, 200)
                    self.assert_wrapped(response.read, error, code)

    def test_programming_errors_are_not_wrapped(self):
        for error in (KeyError('bug'), ValueError('Invalid header value')):
            def transport(request, timeout): raise error
            client = CalmLensServerClient(api_key='key', project_id='project', transport=transport)
            with self.subTest(error=type(error).__name__), self.assertRaises(type(error)) as raised:
                client.assets.retrieve({'assetId': 'asset'})
            self.assertIs(raised.exception, error)


class _RawServer:
    """A TCP server that answers every connection with ``handler(socket)``."""

    def __init__(self, handler):
        self.sock = socket.socket()
        self.sock.bind(('127.0.0.1', 0))
        self.sock.listen()
        self.handler, self.closed = handler, threading.Event()
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.sock.getsockname()[1]}'

    def serve(self):
        while not self.closed.is_set():
            try:
                connection, _ = self.sock.accept()
            except OSError:
                return
            with connection:
                connection.recv(65536)
                self.handler(connection)

    def close(self):
        self.closed.set()
        self.sock.close()


class DefaultTransportFailureTests(unittest.TestCase):
    def request(self, handler, timeout=5):
        server = _RawServer(handler)
        try:
            with CalmLensServerClient(api_key='key', project_id='project', base_url=server.url, timeout=timeout,
                                max_retries=0) as client:
                with self.assertRaises(CalmLensError) as raised:
                    client.assets.retrieve({'assetId': 'asset'})
            return raised.exception
        finally:
            server.close()

    def test_truncated_body(self):
        error = self.request(lambda c: c.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{"id"'))
        self.assertEqual(error.code, 'sdk/transport-error')
        self.assertIsInstance(error.__cause__, http.client.IncompleteRead)

    def test_malformed_status_line(self):
        error = self.request(lambda c: c.sendall(b'NOT HTTP\r\n\r\n'))
        self.assertEqual(error.code, 'sdk/transport-error')
        self.assertIsInstance(error.__cause__, http.client.HTTPException)

    def test_connection_closed_without_response(self):
        error = self.request(lambda c: None)
        self.assertEqual(error.code, 'sdk/transport-error')
        self.assertIsInstance(error.__cause__, http.client.RemoteDisconnected)

    def test_connection_reset(self):
        def reset(connection):
            connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
        error = self.request(reset)
        self.assertEqual(error.code, 'sdk/transport-error')
        self.assertIsInstance(error.__cause__, (ConnectionResetError, http.client.RemoteDisconnected))

    def test_read_timeout(self):
        error = self.request(lambda c: time.sleep(0.5), timeout=0.1)
        self.assertEqual(error.code, 'sdk/timeout')
        self.assertIsInstance(error.__cause__, TimeoutError)

    def test_connection_refused(self):
        sock = socket.socket()
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
        sock.close()
        client = CalmLensServerClient(api_key='key', project_id='project', base_url=f'http://127.0.0.1:{port}', max_retries=0)
        with self.assertRaises(CalmLensError) as raised:
            client.assets.retrieve({'assetId': 'asset'})
        self.assertEqual(raised.exception.code, 'sdk/transport-error')
        self.assertIsInstance(raised.exception.__cause__, ConnectionRefusedError)


class _KeepAliveServer:
    """Answers requests over keep-alive connections. ``on_request(index, connection)`` is called
    before answering request ``index`` on a connection (with the socket) and after it (with
    None); returning False closes the connection at that point."""

    BODY = b'{"id":"asset","upload":{"status":"completed"},"classification":{"status":"processing","moderation":{"status":"pending"}}}'

    def __init__(self, on_request):
        self.sock = socket.socket()
        self.sock.bind(('127.0.0.1', 0))
        self.sock.listen()
        self.on_request, self.connections, self.answered = on_request, 0, 0
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.sock.getsockname()[1]}'

    def serve(self):
        while True:
            try:
                connection, _ = self.sock.accept()
            except OSError:
                return
            self.connections += 1
            threading.Thread(target=self.handle, args=(connection,), daemon=True).start()

    def handle(self, connection):
        with connection:
            for index in range(100):
                if not connection.recv(65536) or self.on_request(index, connection) is False:
                    return
                # Counted before sending, so the client cannot read the answer before it is counted.
                self.answered += 1
                connection.sendall(b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n'
                                   b'Content-Length: %d\r\n\r\n%s' % (len(self.BODY), self.BODY))
                if self.on_request(index, None) is False:
                    return

    def close(self):
        self.sock.close()


class StaleConnectionTests(unittest.TestCase):
    def retrieve_twice(self, on_request, pause=0.0):
        server = _KeepAliveServer(on_request)
        try:
            with CalmLensServerClient(api_key='key', project_id='project', base_url=server.url, timeout=5) as client:
                client.assets.retrieve({'assetId': 'asset'})
                time.sleep(pause)
                self.assertEqual(client.assets.retrieve({'assetId': 'asset'})['id'], 'asset')
            return server
        finally:
            server.close()

    def test_connection_closed_by_server_while_idle_is_not_reused(self):
        # After answering, the server closes the keep-alive connection, as idle timeouts do.
        server = self.retrieve_twice(lambda index, connection: connection is not None, pause=0.2)
        self.assertEqual((server.connections, server.answered), (2, 2))

    def test_request_is_resent_once_when_a_reused_connection_closes_unanswered(self):
        # The connection looks open while idle, then closes when the next request arrives.
        server = self.retrieve_twice(lambda index, connection: connection is None or index == 0)
        self.assertEqual((server.connections, server.answered), (2, 2))

    def test_new_connection_failures_are_not_resent(self):
        server = _KeepAliveServer(lambda index, connection: False)
        try:
            with CalmLensServerClient(api_key='key', project_id='project', base_url=server.url, timeout=5,
                                max_retries=0) as client:
                with self.assertRaises(CalmLensError) as raised:
                    client.assets.retrieve({'assetId': 'asset'})
            self.assertEqual(raised.exception.code, 'sdk/transport-error')
            self.assertIsInstance(raised.exception.__cause__, http.client.RemoteDisconnected)
            self.assertEqual(server.connections, 1)
        finally:
            server.close()


class ConstructorValidationTests(unittest.TestCase):
    def test_invalid_options_fail_before_setup(self):
        created = []
        original = _Transport.__init__
        def tracking_init(self, *args):
            created.append(self)
            original(self, *args)
        cases = [{'timeout': 0}, {'timeout': -1}, {'timeout': float('nan')}, {'timeout': float('inf')},
                 {'timeout': '5'}, {'timeout': True}, {'timeout': None}, {'api_key': ''}, {'project_id': None},
                 {'base_url': 'ftp://example.com'}, {'cdn_base_url': 'not a url'}, {'transport': 'nope'},
                 {'connect_timeout': 0}, {'max_retries': -1}, {'max_retries': 1.5}, {'project_id': '..'}]
        with unittest.mock.patch.object(_Transport, '__init__', tracking_init):
            for case in cases:
                with self.subTest(case=case):
                    with self.assertRaises(CalmLensError) as raised:
                        CalmLensServerClient(**{'api_key': 'key', 'project_id': 'project', **case})
                    self.assertEqual(raised.exception.code, 'sdk/invalid-config')
        self.assertEqual(created, [])
        self.assertEqual(CalmLensServerClient(api_key='key', project_id='project', timeout=0.5).timeout, 0.5)
