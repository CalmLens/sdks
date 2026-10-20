package com.calmlens;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.http.HttpTimeoutException;
import java.util.List;
import java.util.Map;

/**
 * A streamed CDN response from {@code cdn.serve}. Any status is returned (check {@link #status()}:
 * 200, 206 for ranges, 403 for blocked content, 404, ...). Close it to release the connection; a
 * read that receives no data for the idle timeout fails with {@link
 * java.net.http.HttpTimeoutException}.
 *
 * <pre>{@code
 * try (CdnResponse response = client.cdn.serve(new CdnRequest(assetId))) {
 *   if (response.status() == 200) response.transferTo(output);
 * }
 * }</pre>
 */
public final class CdnResponse implements Closeable {
  private final Transport.Response response;
  private final InputStream body;

  CdnResponse(Transport.Response response, InputStream body) {
    this.response = response;
    this.body = body;
  }

  /** @return the HTTP status */
  public int status() { return response.status(); }

  /** @return the response headers, with case-insensitive names */
  public Map<String, List<String>> headers() { return response.headers(); }

  /**
   * @param name header name, matched case-insensitively
   * @return the first value, or null
   */
  public String header(String name) { return response.header(name); }

  /** @return the body stream; IO failures follow the {@link InputStream} contract */
  public InputStream body() { return body; }

  /**
   * Copies the body to {@code out} and closes this response.
   *
   * @param out destination
   * @return bytes copied
   * @throws CalmLensException {@link TransportException} or {@link RequestTimeoutException} when the body cannot be read
   */
  public long transferTo(OutputStream out) {
    try {
      return body.transferTo(out);
    } catch (IOException failure) {
      throw failed(failure);
    } finally {
      close();
    }
  }

  /**
   * Reads the whole body into memory and closes this response.
   *
   * @param maxBytes the largest body accepted
   * @return the body
   * @throws CalmLensException {@link ErrorCodes#SDK_RESPONSE_TOO_LARGE} when the body is larger, or a
   *     {@link TransportException} when it cannot be read
   */
  public byte[] readAllBytes(long maxBytes) {
    try {
      byte[] bytes = body.readNBytes((int) Math.min(Integer.MAX_VALUE - 8, maxBytes + 1));
      if (bytes.length > maxBytes)
        throw new ApiException(ErrorCodes.SDK_RESPONSE_TOO_LARGE, "CDN response is larger than " + maxBytes + " bytes", null, status(), headers(), null);
      return bytes;
    } catch (IOException failure) {
      throw failed(failure);
    } finally {
      close();
    }
  }

  private static CalmLensException failed(IOException failure) {
    String message = failure.getMessage() == null ? failure.getClass().getName() : failure.getMessage();
    return failure instanceof HttpTimeoutException ? new RequestTimeoutException(message, failure)
        : new TransportException(ErrorCodes.SDK_TRANSPORT_ERROR, message, failure);
  }

  @Override public void close() {
    try { body.close(); } catch (IOException ignored) { /* nothing left to release */ }
  }

  @Override public String toString() {
    return "CdnResponse[status=" + status() + ", contentType=" + header("content-type") + ", contentLength=" + header("content-length") + "]";
  }
}
