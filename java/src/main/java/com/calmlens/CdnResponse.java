package com.calmlens;

import com.calmlens.exception.CalmLensException;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.http.HttpTimeoutException;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * A streamed CDN response from {@code cdn.serve}. Any status is returned (check {@link #status()}:
 * 200, 206 for ranges, 403 for blocked content, 404, ...). Close it to release the connection; a
 * read that receives no data for the idle timeout fails with {@link
 * java.net.http.HttpTimeoutException}.
 *
 * <pre>{@code
 * try (CdnResponse response = client.cdn().serve(CdnRequestParams.builder().setAssetId(assetId).build())) {
 *   if (response.status() == 200) response.transferTo(output);
 * }
 * }</pre>
 */
public final class CdnResponse implements Closeable {
  private static final Pattern ASSET_INFO_DELIMITER = Pattern.compile("\"(?:[^\"\\\\]|\\\\.)*\"|[\",]");
  private static final Pattern ASSET_INFO_DIMENSION = Pattern.compile("^(width|height)=([0-9]{1,15})$");

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

  /** @return served image dimensions, or null if missing or invalid. The body stays unread. */
  public ServedAssetInfo getAssetInfo() {
    var values = headers().get("x-calmlens-asset-info");
    if (values == null) return null;
    String header = String.join(",", values) + ",";
    var delimiters = ASSET_INFO_DELIMITER.matcher(header);
    int start = 0;
    long width = 0;
    long height = 0;
    while (delimiters.find()) {
      if (delimiters.group().equals("\"")) return null;
      if (!delimiters.group().equals(",")) continue;
      String member = header.substring(start, delimiters.start()).strip();
      start = delimiters.end();
      String key = member.split("[=; \t]", 2)[0];
      if (!key.equals("width") && !key.equals("height")) continue;
      var dimension = ASSET_INFO_DIMENSION.matcher(member);
      if (!dimension.matches()) return null;
      long size = Long.parseLong(dimension.group(2));
      if (size == 0) return null;
      if (key.equals("width")) {
        if (width != 0) return null;
        width = size;
      } else {
        if (height != 0) return null;
        height = size;
      }
    }
    return width == 0 || height == 0 ? null : new ServedAssetInfo(width, height);
  }

  /** @return the body stream; IO failures follow the {@link InputStream} contract */
  public InputStream body() { return body; }

  /**
   * Copies the body to {@code out} and closes this response.
   *
   * @param out destination
   * @return bytes copied
   * @throws CalmLensException {@link com.calmlens.exception.ConnectionException} or {@link com.calmlens.exception.TimeoutException} when the body cannot be read
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
   *     {@link com.calmlens.exception.ConnectionException} when it cannot be read
   */
  public byte[] readAllBytes(long maxBytes) {
    try {
      byte[] bytes = body.readNBytes((int) Math.min(Integer.MAX_VALUE - 8, maxBytes + 1));
      if (bytes.length > maxBytes)
        throw CalmLensException.of(ErrorCodes.SDK_RESPONSE_TOO_LARGE, "CDN response is larger than " + maxBytes + " bytes", null, status(), headers(), null, null, null);
      return bytes;
    } catch (IOException failure) {
      throw failed(failure);
    } finally {
      close();
    }
  }

  private static CalmLensException failed(IOException failure) {
    String message = failure.getMessage() == null ? failure.getClass().getName() : failure.getMessage();
    return failure instanceof HttpTimeoutException ? CalmLensException.of(ErrorCodes.SDK_TIMEOUT, message, failure)
        : CalmLensException.of(ErrorCodes.SDK_TRANSPORT_ERROR, message, failure);
  }

  @Override public void close() {
    try { body.close(); } catch (IOException ignored) { /* nothing left to release */ }
  }

  @Override public String toString() {
    return "CdnResponse[status=" + status() + ", contentType=" + header("content-type") + ", contentLength=" + header("content-length") + "]";
  }
}
