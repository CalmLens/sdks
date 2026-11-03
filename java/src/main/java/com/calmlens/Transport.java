package com.calmlens;

import java.io.ByteArrayInputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.function.Supplier;

/**
 * Sends one HTTP request. The default transport uses {@link java.net.http.HttpClient}; supply your
 * own through {@link CalmLensServerClient.Builder#transport(Transport)} to route requests through another
 * HTTP stack, or use {@link MockCalmLensServerClient} in tests. The client adds authentication, retries,
 * body limits and error mapping around it.
 *
 * <p>Throw {@link IOException} for network failures ({@link java.net.http.HttpTimeoutException} or
 * {@link java.net.SocketTimeoutException} for timeouts). The client closes every returned {@link
 * Response}.
 */
@FunctionalInterface
public interface Transport {
  /**
   * Sends {@code request} and returns once the response status and headers are available.
   *
   * @param request the request to send
   * @return the response; its body is read (and closed) by the client
   * @throws IOException when the request cannot be sent or the response cannot be read
   * @throws InterruptedException when the calling thread is interrupted
   */
  Response send(Request request) throws IOException, InterruptedException;

  /**
   * An outgoing request.
   *
   * @param method HTTP method
   * @param uri absolute URL
   * @param headers request headers, including {@code X-Api-Key}
   * @param body request body, or null
   * @param timeout time allowed until the response headers arrive, or null for no limit
   */
  record Request(String method, URI uri, Map<String, String> headers, Body body, Duration timeout) {
    /** Copies the headers. */
    public Request {
      headers = Collections.unmodifiableMap(new LinkedHashMap<>(headers));
    }

    /** @return the request without the API key, safe to log */
    @Override public String toString() {
      Map<String, String> safe = new LinkedHashMap<>();
      headers.forEach((name, value) -> safe.put(name, name.equalsIgnoreCase("X-Api-Key") ? "[redacted]" : value));
      return "Request[method=" + method + ", uri=" + uri + ", headers=" + safe + ", body=" + body + ", timeout=" + timeout + "]";
    }
  }

  /**
   * A response whose body has not been read yet.
   *
   * @param status HTTP status
   * @param headers response headers, with case-insensitive names
   * @param body response body stream
   */
  record Response(int status, Map<String, List<String>> headers, InputStream body) implements Closeable {
    /** Copies the headers into a case-insensitive map; a null body becomes an empty stream. */
    public Response {
      Map<String, List<String>> copy = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
      if (headers != null)
        headers.forEach((name, values) -> { if (name != null && values != null) copy.put(name, List.copyOf(values)); });
      headers = Collections.unmodifiableMap(copy);
      body = body == null ? InputStream.nullInputStream() : body;
    }

    /**
     * A response with a byte body.
     *
     * @param status HTTP status
     * @param headers response headers
     * @param body response body
     */
    public Response(int status, Map<String, List<String>> headers, byte[] body) {
      this(status, headers, new ByteArrayInputStream(body == null ? new byte[0] : body));
    }

    /**
     * @param name header name, matched case-insensitively
     * @return the first value of the header, or null
     */
    public String header(String name) {
      List<String> values = headers.get(name);
      return values == null || values.isEmpty() ? null : values.get(0);
    }

    @Override public void close() throws IOException { body.close(); }
  }

  /**
   * A request body with a known length. Byte and file bodies can be sent again, so requests that
   * carry them can be retried; a stream body can be read once.
   */
  final class Body {
    private final long length;
    private final byte[] bytes;
    private final Path file;
    private final Supplier<InputStream> stream;
    /** A stream body that opens a new stream for every attempt, such as a range of a file. */
    private final boolean reopenable;
    private boolean consumed;

    private Body(long length, byte[] bytes, Path file, Supplier<InputStream> stream) { this(length, bytes, file, stream, false); }

    private Body(long length, byte[] bytes, Path file, Supplier<InputStream> stream, boolean reopenable) {
      this.length = length; this.bytes = bytes; this.file = file; this.stream = stream; this.reopenable = reopenable;
    }

    /**
     * @param bytes the body; not copied, so do not change it while the request runs
     * @return a body sending these bytes
     */
    public static Body ofBytes(byte[] bytes) { return new Body(bytes.length, Objects.requireNonNull(bytes), null, null); }

    /**
     * @param file a regular file, read when the request is sent
     * @param length the file's size in bytes
     * @return a body streaming the file
     */
    public static Body ofFile(Path file, long length) { return new Body(length, null, Objects.requireNonNull(file), null); }

    /**
     * @param stream the source, read once when the request is sent
     * @param length the exact number of bytes the stream supplies, or -1 when unknown (sent chunked)
     * @return a body streaming {@code stream}
     */
    public static Body ofStream(InputStream stream, long length) {
      Objects.requireNonNull(stream);
      return new Body(length, null, null, () -> stream);
    }

    /** @return the exact body length in bytes, or -1 for a stream of unknown length */
    public long length() { return length; }

    /** @return whether {@link #open()} can be called more than once */
    public boolean replayable() { return stream == null || reopenable; }

    /**
     * The {@code length} bytes from {@code offset} of a replayable body, read again from its source
     * on every attempt: a part of an upload sent in parts.
     */
    Body slice(long offset, long length) {
      if (bytes != null) return ofBytes(java.util.Arrays.copyOfRange(bytes, (int) offset, (int) (offset + length)));
      if (file == null) throw new IllegalStateException("Only byte and file bodies can be split");
      Path source = file;
      return new Body(length, null, null, () -> {
        try {
          InputStream in = Files.newInputStream(source);
          in.skipNBytes(offset);
          return new java.io.FilterInputStream(in) {
            private long left = length;
            @Override public int read() throws IOException {
              if (left <= 0) return -1;
              int b = super.read();
              if (b >= 0) left--;
              return b;
            }
            @Override public int read(byte[] buffer, int from, int count) throws IOException {
              if (left <= 0) return -1;
              int read = super.read(buffer, from, (int) Math.min(count, left));
              if (read > 0) left -= read;
              return read;
            }
            @Override public long skip(long count) throws IOException {
              long skipped = super.skip(Math.min(count, left));
              left -= skipped;
              return skipped;
            }
            @Override public int available() throws IOException { return (int) Math.min(super.available(), left); }
          };
        } catch (IOException e) { throw new java.io.UncheckedIOException(e); }
      }, true);
    }

    /** @return the bytes for an in-memory body, or null for a file or stream body */
    public byte[] bytes() { return bytes; }

    /** @return the file for a file body, or null */
    public Path file() { return file; }

    /**
     * Opens the body for sending. A stream body can be opened once.
     *
     * @return a new stream over the body
     * @throws IOException when the file cannot be opened or a stream body was already sent
     */
    public synchronized InputStream open() throws IOException {
      if (bytes != null) return new ByteArrayInputStream(bytes);
      if (file != null) return Files.newInputStream(file);
      if (reopenable) {
        try { return stream.get(); } catch (java.io.UncheckedIOException e) { throw e.getCause(); }
      }
      if (consumed) throw new IOException("A stream request body can be sent only once");
      consumed = true;
      return stream.get();
    }

    @Override public String toString() {
      return "Body[" + (bytes != null ? "bytes" : file != null ? "file" : "stream") + ", length=" + length + "]";
    }
  }
}
