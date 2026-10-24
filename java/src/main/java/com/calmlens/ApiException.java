package com.calmlens;

import java.time.Duration;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

/**
 * The API answered with an error status, or with a body the SDK could not read ({@link
 * ErrorCodes#SDK_INVALID_RESPONSE}, {@link ErrorCodes#SDK_RESPONSE_TOO_LARGE}). Log {@link
 * #getRequestId()} with failures and include it when contacting support.
 */
public class ApiException extends CalmLensException {
  private static final long serialVersionUID = 1L;
  private final int status;
  private final String requestId;
  private final String traceId;
  private final transient Map<String, List<String>> headers;
  private final Duration retryAfter;

  ApiException(String code, String message, Map<String, Object> details, int status,
      Map<String, List<String>> headers, Throwable cause) {
    super(code, message, details, cause);
    this.status = status;
    Map<String, List<String>> copy = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
    if (headers != null)
      headers.forEach((name, values) -> { if (name != null && values != null) copy.put(name, List.copyOf(values)); });
    this.headers = Collections.unmodifiableMap(copy);
    this.requestId = first(copy, "x-request-id");
    Object trace = details == null ? null : details.get("traceId");
    this.traceId = trace == null ? null : trace.toString();
    this.retryAfter = retryAfter(first(copy, "retry-after"));
  }

  private static String first(Map<String, List<String>> headers, String name) {
    List<String> values = headers.get(name);
    return values == null || values.isEmpty() ? null : values.get(0);
  }

  /** Parses a {@code Retry-After} value in seconds, or an HTTP date as the delay from now. */
  static Duration retryAfter(String value) {
    if (value == null || value.isBlank()) return null;
    String text = value.strip();
    try {
      long seconds = Long.parseLong(text);
      return seconds < 0 ? null : Duration.ofSeconds(seconds);
    } catch (NumberFormatException notSeconds) {
      try {
        Instant at = ZonedDateTime.parse(text, DateTimeFormatter.RFC_1123_DATE_TIME.withLocale(Locale.ROOT)).toInstant();
        Duration delay = Duration.between(Instant.now(), at);
        return delay.isNegative() ? Duration.ZERO : delay;
      } catch (DateTimeParseException invalid) {
        return null;
      }
    }
  }

  @Override public int getStatus() { return status; }

  @Override public String getRequestId() { return requestId; }

  /** @return the {@code traceId} from the error body, or null */
  public String getTraceId() { return traceId; }

  /** @return the response headers, with case-insensitive names */
  public Map<String, List<String>> getHeaders() { return headers == null ? Map.of() : headers; }

  /** @return the {@code Retry-After} delay sent with the response (HTTP 429 and in-progress idempotent requests) */
  public Optional<Duration> getRetryAfter() { return Optional.ofNullable(retryAfter); }
}
