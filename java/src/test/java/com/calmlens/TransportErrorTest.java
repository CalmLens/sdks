package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.calmlens.exception.CalmLensException;
import com.calmlens.exception.ConnectionException;
import com.calmlens.exception.InvalidResponseException;
import com.calmlens.exception.TimeoutException;
import com.calmlens.internal.UploadForm;
import com.calmlens.models.LensType;
import com.calmlens.params.AssetCreateParams;
import com.calmlens.params.CdnRequestParams;
import com.calmlens.params.Content;
import com.calmlens.params.LensCreateParams;
import com.calmlens.params.ModerationContextItemParams;
import com.calmlens.params.ModerationContextParams;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The built-in HttpClient transport against raw sockets: failures, timeouts and streamed uploads. */
class TransportErrorTest {
  private final ExecutorService executor = Executors.newCachedThreadPool();
  private final List<String> heads = new CopyOnWriteArrayList<>();
  private ServerSocket server;

  @AfterEach void close() throws IOException {
    executor.shutdownNow();
    if (server != null) server.close();
  }

  private String serve(Consumer<Socket> handler) throws IOException { return serve(true, handler); }

  /** Starts a raw socket server that handles each connection with {@code handler}. */
  private String serve(boolean awaitHead, Consumer<Socket> handler) throws IOException {
    server = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
    executor.submit(() -> {
      while (!server.isClosed()) {
        try {
          Socket socket = server.accept();
          executor.submit(() -> {
            try (socket) {
              if (awaitHead) heads.add(readHead(socket.getInputStream()));
              handler.accept(socket);
            } catch (IOException ignored) { /* the client reports the failure */ }
          });
        } catch (IOException e) { return; }
      }
    });
    return "http://127.0.0.1:" + server.getLocalPort() + "/v1";
  }

  private static String readHead(InputStream in) throws IOException {
    ByteArrayOutputStream head = new ByteArrayOutputStream();
    int matched = 0;
    for (int b; matched < 4 && (b = in.read()) != -1;) {
      head.write(b);
      matched = (b == "\r\n\r\n".charAt(matched)) ? matched + 1 : (b == '\r' ? 1 : 0);
    }
    return head.toString(StandardCharsets.ISO_8859_1);
  }

  private static String header(String head, String name) {
    for (String line : head.split("\r\n")) {
      int colon = line.indexOf(':');
      if (colon > 0 && line.substring(0, colon).strip().equalsIgnoreCase(name)) return line.substring(colon + 1).strip();
    }
    return null;
  }

  private static void write(Socket socket, String raw) {
    try {
      socket.getOutputStream().write(raw.getBytes(StandardCharsets.ISO_8859_1));
      socket.getOutputStream().flush();
    } catch (IOException e) { throw new UncheckedIOException(e); }
  }

  private static CalmLensServerClient client(String baseUrl, Duration timeout) {
    return CalmLensServerClient.builder().apiKey("key").projectId("project").baseUrl(baseUrl).cdnBaseUrl(baseUrl).timeout(timeout).maxRetries(0).build();
  }

  private static CalmLensException retrieveFails(CalmLensServerClient client, String code) {
    var error = assertThrows(CalmLensException.class, () -> client.assets().retrieve("asset"));
    assertEquals(code, error.getCode(), String.valueOf(error.getCause()));
    assertNotNull(error.getCause());
    return error;
  }

  @Test void truncatedBody() throws Exception {
    String url = serve(socket -> write(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"id\":"));
    assertInstanceOf(ConnectionException.class, retrieveFails(client(url, Duration.ofSeconds(5)), ErrorCodes.SDK_TRANSPORT_ERROR));
  }

  @Test void truncatedCdnBody() throws Exception {
    String url = serve(socket -> write(socket, "HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial"));
    try (CdnResponse response = client(url, Duration.ofSeconds(5)).cdn().serve(CdnRequestParams.builder().setAssetId("asset").build())) {
      var error = assertThrows(ConnectionException.class, () -> response.readAllBytes(1000));
      assertEquals(ErrorCodes.SDK_TRANSPORT_ERROR, error.getCode());
      assertInstanceOf(IOException.class, error.getCause());
    }
  }

  @Test void connectionClosedWithoutResponse() throws Exception {
    retrieveFails(client(serve(socket -> {}), Duration.ofSeconds(5)), ErrorCodes.SDK_TRANSPORT_ERROR);
  }

  @Test void connectionReset() throws Exception {
    String url = serve(socket -> {
      try { socket.setSoLinger(true, 0); } catch (SocketException e) { throw new UncheckedIOException(e); }
    });
    retrieveFails(client(url, Duration.ofSeconds(5)), ErrorCodes.SDK_TRANSPORT_ERROR);
  }

  @Test void protocolError() throws Exception {
    retrieveFails(client(serve(socket -> write(socket, "NOT-HTTP garbage\r\n\r\n")), Duration.ofSeconds(5)), ErrorCodes.SDK_TRANSPORT_ERROR);
  }

  @Test void tlsFailure() throws Exception {
    // A plain-HTTP server answers the TLS ClientHello, so the handshake fails.
    String url = serve(false, socket -> write(socket, "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n"));
    retrieveFails(client(url.replace("http://", "https://"), Duration.ofSeconds(5)), ErrorCodes.SDK_TRANSPORT_ERROR);
  }

  @Test void connectionRefused() throws Exception {
    int port;
    try (ServerSocket unused = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) { port = unused.getLocalPort(); }
    retrieveFails(client("http://127.0.0.1:" + port + "/v1", Duration.ofSeconds(5)), ErrorCodes.SDK_TRANSPORT_ERROR);
  }

  @Test void responseTimeout() throws Exception {
    CountDownLatch release = new CountDownLatch(1);
    String url = serve(socket -> { try { release.await(10, TimeUnit.SECONDS); } catch (InterruptedException ignored) { } });
    try {
      var error = retrieveFails(client(url, Duration.ofMillis(200)), ErrorCodes.SDK_TIMEOUT);
      assertInstanceOf(TimeoutException.class, error);
      assertInstanceOf(java.net.http.HttpTimeoutException.class, error.getCause());
    } finally {
      release.countDown();
    }
  }

  @Test void bodyThatStopsArrivingTimesOut() throws Exception {
    CountDownLatch release = new CountDownLatch(1);
    String url = serve(socket -> {
      write(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"id\":");
      try { release.await(10, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
    });
    try {
      long started = System.nanoTime();
      retrieveFails(client(url, Duration.ofMillis(300)), ErrorCodes.SDK_TIMEOUT);
      assertTrue(Duration.ofNanos(System.nanoTime() - started).compareTo(Duration.ofSeconds(5)) < 0);
    } finally {
      release.countDown();
    }
  }

  @Test void uploadsStreamFilesInAFormWithTheirLengthAndOutliveTheReadTimeout(@TempDir Path directory) throws Exception {
    Path file = directory.resolve("document.pdf");
    byte[] data = new byte[2 * 1024 * 1024];
    Arrays.fill(data, (byte) 7);
    Files.write(file, data);
    byte[][] received = {null};
    String url = serve(socket -> {
      try {
        String head = heads.get(heads.size() - 1);
        received[0] = socket.getInputStream().readNBytes(Integer.parseInt(header(head, "content-length")));
        Thread.sleep(2500); // longer than the client's read timeout, shorter than its upload timeout
        String asset = Fixtures.assetJson("asset-1", "processing", "pending");
        write(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + asset.length() + "\r\n\r\n" + asset);
      } catch (IOException | InterruptedException e) { throw new IllegalStateException(e); }
    });
    CalmLensServerClient client = CalmLensServerClient.builder().apiKey("key").projectId("project").baseUrl(url).timeout(Duration.ofSeconds(1)).uploadTimeout(Duration.ofSeconds(30)).build();
    AssetCreateParams upload = AssetCreateParams.builder().setName("document.pdf").setContent(Content.file(file, "application/pdf"))
        .setDescription("Homework").setAuthorId("pupil-7").setContext(ModerationContextParams.of(List.of(ModerationContextItemParams.of("An earlier post")))).build();
    assertEquals("asset-1", client.assets().create(upload).getId());
    String head = heads.get(0);
    // The asset's fields travel in the form's options part; the URL holds only transport values.
    String target = head.substring(0, head.indexOf("\r\n"));
    assertEquals("POST /v1/projects/project/assets?wait=false&contentType=application%2Fpdf&sizeInBytes=" + data.length + " HTTP/1.1", target);
    UploadForm.Parsed form = UploadForm.read(received[0], header(head, "content-type"));
    assertEquals(com.google.gson.JsonParser.parseString("{\"name\":\"document.pdf\",\"description\":\"Homework\",\"authorId\":\"pupil-7\","
        + "\"context\":{\"items\":[{\"text\":\"An earlier post\"}]}}"), com.google.gson.JsonParser.parseString(form.options()));
    assertEquals("application/pdf", form.fileType());
    assertArrayEquals(data, form.file());
    assertEquals(Integer.toString(received[0].length), header(head, "content-length"));
    assertNull(header(head, "transfer-encoding"));
    assertEquals("calmlens-java/" + CalmLensServerClient.VERSION + " (java/" + Runtime.version() + ")", header(head, "user-agent"));
    assertTrue(header(head, "idempotency-key").matches("[0-9a-f-]{36}"), head);
    assertEquals("content", header(head, "x-calmlens-upload"));
  }

  @Test void customTransportFailuresAreWrapped() {
    var unchecked = new UncheckedIOException(new SocketException("Connection reset"));
    assertSame(unchecked, retrieveFails(CalmLensServerClient.builder().apiKey("key").projectId("project").maxRetries(0).transport(request -> { throw unchecked; }).build(), ErrorCodes.SDK_TRANSPORT_ERROR).getCause());
    var runtime = new IllegalStateException("decompression failed");
    assertSame(runtime, retrieveFails(CalmLensServerClient.builder().apiKey("key").projectId("project").maxRetries(0).transport(request -> { throw runtime; }).build(), ErrorCodes.SDK_TRANSPORT_ERROR).getCause());
    assertInstanceOf(TimeoutException.class, retrieveFails(CalmLensServerClient.builder().apiKey("key").projectId("project").maxRetries(0)
        .transport(request -> { throw new SocketTimeoutException("read timed out"); }).build(), ErrorCodes.SDK_TIMEOUT));
    retrieveFails(CalmLensServerClient.builder().apiKey("key").projectId("project").maxRetries(0)
        .transport(request -> { throw new UncheckedIOException(new java.net.http.HttpTimeoutException("slow")); }).build(), ErrorCodes.SDK_TIMEOUT);
    var missing = assertThrows(ConnectionException.class, () -> CalmLensServerClient.builder().apiKey("key").projectId("project").maxRetries(0).transport(request -> null).build().assets().retrieve("asset"));
    assertEquals(ErrorCodes.SDK_TRANSPORT_ERROR, missing.getCode());
  }

  @Test void nonObjectResponsesAreInvalid() {
    for (String body : List.of("[]", "\"text\"", "null")) {
      var client = CalmLensServerClient.builder().apiKey("key").projectId("project").transport(request -> Fixtures.json(200, body)).build();
      AssetCreateParams text = AssetCreateParams.builder().setName("post").setContent(Content.text("hi")).build();
      assertEquals(ErrorCodes.SDK_INVALID_RESPONSE, assertThrows(InvalidResponseException.class, () -> client.assets().classify(text)).getCode(), body);
      assertEquals(ErrorCodes.SDK_INVALID_RESPONSE, assertThrows(InvalidResponseException.class, () -> client.folders().list()).getCode(), body);
      LensCreateParams lens = LensCreateParams.builder().setIdentifier("thumb").setName("Thumb").setType(LensType.IMAGE).build();
      assertEquals(ErrorCodes.SDK_INVALID_RESPONSE, assertThrows(InvalidResponseException.class, () -> client.ensureLens(lens)).getCode(), body);
    }
  }

  @Test void builderValidatesOptionsFirst() {
    var timeout = assertThrows(CalmLensException.class, () -> CalmLensServerClient.builder().apiKey("key").projectId("project").timeout(Duration.ofSeconds(-1)).build());
    assertEquals(ErrorCodes.SDK_INVALID_CONFIG, timeout.getCode());
    for (String url : Arrays.asList(null, "", "api.calmlens.com/v1", "ftp://host/v1", "http://bad host/v1")) {
      assertEquals(ErrorCodes.SDK_INVALID_CONFIG, assertThrows(CalmLensException.class, () -> CalmLensServerClient.builder().apiKey("key").projectId("project").baseUrl(url).build(), String.valueOf(url)).getCode());
      assertEquals(ErrorCodes.SDK_INVALID_CONFIG, assertThrows(CalmLensException.class, () -> CalmLensServerClient.builder().apiKey("key").projectId("project").cdnBaseUrl(url).build(), String.valueOf(url)).getCode());
    }
  }
}
