package com.calmlens.models;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import org.jspecify.annotations.Nullable;

/**
 * The HTTP response a model was read from: its status, headers and request ID. Quote the request ID
 * when you contact support about a result, such as a moderation decision.
 */
public final class ApiResponse {
  private final int status;
  private final Map<String, List<String>> headers;

  /**
   * @param status the HTTP status
   * @param headers the response headers
   */
  public ApiResponse(int status, @Nullable Map<String, List<String>> headers) {
    this.status = status;
    Map<String, List<String>> copy = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
    if (headers != null) headers.forEach((name, values) -> { if (name != null && values != null) copy.put(name, List.copyOf(values)); });
    this.headers = Collections.unmodifiableMap(copy);
  }

  /** @return the HTTP status */
  public int getStatus() { return status; }

  /** @return the response headers, with case-insensitive names */
  public Map<String, List<String>> getHeaders() { return headers; }

  /**
   * @param name a header name, in any case
   * @return the header's first value
   */
  public Optional<String> getHeader(String name) {
    List<String> values = headers.get(name);
    return values == null || values.isEmpty() ? Optional.empty() : Optional.of(values.get(0));
  }

  /** @return the {@code X-Request-Id} CalmLens gave the request */
  public Optional<String> getRequestId() { return getHeader("x-request-id"); }

  @Override public String toString() { return "ApiResponse[status=" + status + ", requestId=" + getRequestId().orElse(null) + "]"; }
}
