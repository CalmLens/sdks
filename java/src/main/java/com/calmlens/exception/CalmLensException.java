package com.calmlens.exception;

import com.calmlens.ErrorCodes;
import java.time.Duration;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import org.jspecify.annotations.Nullable;

/**
 * Base type of every failure the SDK reports. It is unchecked, like most Java HTTP client errors.
 * Each kind of failure has its own subclass, so catch the one you handle:
 *
 * <ul>
 *   <li>{@link ApiException}: the API answered with an error status. {@link BadRequestException}
 *       (400), {@link AuthenticationException} (401), {@link PermissionDeniedException} (403),
 *       {@link NotFoundException} (404), {@link ConflictException} (409), {@link
 *       PayloadTooLargeException} (413), {@link UnprocessableEntityException} (422), {@link
 *       RateLimitException} (429) and {@link ServerException} (500 or above) extend it.
 *   <li>{@link ConnectionException}, {@link TimeoutException} and {@link CancelledException}: no
 *       complete response arrived.
 *   <li>{@link InvalidArgumentException} (with {@link ConfigurationException}): the SDK refused the
 *       call before sending anything.
 *   <li>{@link InvalidResponseException} and {@link WebhookVerificationException}.
 * </ul>
 *
 * <p>Branch on {@link #getCode()} (see {@link ErrorCodes}) for a specific failure; messages are for
 * logs.
 */
public class CalmLensException extends RuntimeException {
  private static final long serialVersionUID = 1L;
  /** The most characters of a response body an exception keeps. */
  public static final int MAX_BODY_CHARS = 64 * 1024;

  private final String code;
  private final transient Map<String, Object> details;
  private final int status;
  private final @Nullable String requestId;
  private final transient Map<String, List<String>> headers;
  private final @Nullable Duration retryAfter;
  private final @Nullable String body;

  /**
   * Creates the exception. The SDK raises these itself; construct one only to test your handling.
   *
   * @param code the error code, such as {@code asset/not-found}
   * @param message a message for logs
   * @param details structured details, or null
   * @param status the HTTP status, or 0 without a response
   * @param headers the response headers, or null
   * @param requestId the request ID when the response has no {@code X-Request-Id} header, or null
   * @param body the response body, or null; kept up to {@link #MAX_BODY_CHARS} characters
   * @param cause the cause, or null
   */
  public CalmLensException(String code, @Nullable String message, @Nullable Map<String, Object> details, int status,
      @Nullable Map<String, List<String>> headers, @Nullable String requestId, @Nullable String body, @Nullable Throwable cause) {
    super("[calmlens] " + (message == null || message.isEmpty() ? code : message), cause);
    this.code = code;
    this.details = details == null || details.isEmpty() ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(details));
    this.status = status;
    Map<String, List<String>> copy = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
    if (headers != null)
      headers.forEach((name, values) -> { if (name != null && values != null) copy.put(name, List.copyOf(values)); });
    this.headers = Collections.unmodifiableMap(copy);
    String header = first(copy, "x-request-id");
    this.requestId = header != null ? header : requestId;
    this.retryAfter = retryAfter(first(copy, "retry-after"));
    this.body = body == null || body.length() <= MAX_BODY_CHARS ? body : body.substring(0, MAX_BODY_CHARS);
  }

  private static @Nullable String first(Map<String, List<String>> headers, String name) {
    List<String> values = headers.get(name);
    return values == null || values.isEmpty() ? null : values.get(0);
  }

  /**
   * Parses a {@code Retry-After} value in seconds, or an HTTP date as the whole seconds from now (0
   * when past).
   *
   * @param value the header value, or null
   * @return the delay, or null when there is none or it can't be read
   */
  public static @Nullable Duration retryAfter(@Nullable String value) {
    if (value == null || value.isBlank()) return null;
    String text = value.strip();
    try {
      long seconds = Long.parseLong(text);
      return seconds < 0 ? null : Duration.ofSeconds(seconds);
    } catch (NumberFormatException notSeconds) {
      try {
        Instant at = ZonedDateTime.parse(text, DateTimeFormatter.RFC_1123_DATE_TIME.withLocale(Locale.ROOT)).toInstant();
        // Whole seconds from now, rounded up, as the API means them.
        long millis = Duration.between(Instant.now(), at).toMillis();
        return millis <= 0 ? Duration.ZERO : Duration.ofSeconds((millis + 999) / 1000);
      } catch (DateTimeParseException invalid) {
        return null;
      }
    }
  }

  /** @return the stable error code, for example {@code asset/not-found} or {@code sdk/timeout} */
  public String getCode() { return code; }

  /** @return extra structured information from the API error body; never null */
  public Map<String, Object> getDetails() { return details == null ? Map.of() : details; }

  /** @return the HTTP status, or 0 when the failure did not come from an HTTP response */
  public int getStatus() { return status; }

  /** @return the {@code X-Request-Id} of the failed request; empty when there was no response */
  public Optional<String> getRequestId() { return Optional.ofNullable(requestId); }

  /** @return the response headers, with case-insensitive names; empty without a response */
  public Map<String, List<String>> getHeaders() { return headers == null ? Map.of() : headers; }

  /** @return the {@code Retry-After} delay sent with the response (HTTP 429 and in-progress idempotent requests) */
  public Optional<Duration> getRetryAfter() { return Optional.ofNullable(retryAfter); }

  /**
   * The raw response body, such as a proxy's HTML error page, up to {@link #MAX_BODY_CHARS}
   * characters.
   *
   * @return the body; empty without a response
   */
  public Optional<String> getBody() { return Optional.ofNullable(body); }

  /**
   * Whether the SDK raised this exception itself, with no HTTP response: before sending (an
   * invalid argument or option, or content it checks first, such as {@link
   * ErrorCodes#UNSUPPORTED_UPLOAD_TYPE}), or because no response arrived (a timeout, an interruption
   * or a connection failure). The code is the one the API would use; {@link #getStatus()} is 0 and
   * {@link #getRequestId()} empty, so branch on {@link #getCode()}.
   *
   * @return whether no HTTP response produced this exception
   */
  public final boolean isLocal() { return getStatus() == 0; }

  /**
   * Whether repeating the same request later may succeed. It follows from {@link #getCode()} and
   * {@link #getStatus()} alone, whatever the exception's class: {@link ErrorCodes#SDK_TRANSPORT_ERROR},
   * {@link ErrorCodes#SDK_TIMEOUT} (a request timeout or {@code waitForDecision}'s deadline), {@link
   * ErrorCodes#IDEMPOTENT_REQUEST_IN_PROGRESS} and HTTP 429, 500, 502, 503 and 504 are retryable; nothing
   * else is, {@link ErrorCodes#SDK_CANCELLED} and other 5xx statuses included. The client already
   * retries these for safe requests. Repeat a write only with the same idempotency key.
   *
   * @return whether the failure is transient
   */
  public final boolean isRetryable() {
    String code = getCode();
    int status = getStatus();
    return ErrorCodes.SDK_TRANSPORT_ERROR.equals(code) || ErrorCodes.SDK_TIMEOUT.equals(code)
        || ErrorCodes.IDEMPOTENT_REQUEST_IN_PROGRESS.equals(code)
        || status == 429 || status == 500 || status == 502 || status == 503 || status == 504;
  }

  /**
   * The exception of the kind {@code code} and {@code status} decide (README "errorKinds"): an SDK
   * code decides it, except {@code sdk/http-error}, which a response's status decides; otherwise the
   * status does, and a code raised before sending (status 0) is an {@link InvalidArgumentException}.
   *
   * @param code the error code
   * @param message a message for logs
   * @param details structured details, or null
   * @param status the HTTP status, or 0 without a response
   * @param headers the response headers, or null
   * @param requestId the error body's request ID, or null
   * @param body the response body, or null
   * @param cause the cause, or null
   * @return the exception, not thrown
   */
  public static CalmLensException of(String code, @Nullable String message, @Nullable Map<String, Object> details, int status,
      @Nullable Map<String, List<String>> headers, @Nullable String requestId, @Nullable String body, @Nullable Throwable cause) {
    switch (code) {
      case ErrorCodes.SDK_TRANSPORT_ERROR: return new ConnectionException(code, message, details, status, headers, requestId, body, cause);
      case ErrorCodes.SDK_TIMEOUT: return new TimeoutException(code, message, details, status, headers, requestId, body, cause);
      case ErrorCodes.SDK_CANCELLED: return new CancelledException(code, message, details, status, headers, requestId, body, cause);
      case ErrorCodes.SDK_INVALID_RESPONSE:
      case ErrorCodes.SDK_RESPONSE_TOO_LARGE: return new InvalidResponseException(code, message, details, status, headers, requestId, body, cause);
      case ErrorCodes.SDK_INVALID_ARGUMENT: return new InvalidArgumentException(code, message, details, status, headers, requestId, body, cause);
      case ErrorCodes.SDK_INVALID_CONFIG:
      case "sdk/no-fetch": return new ConfigurationException(code, message, details, status, headers, requestId, body, cause);
      case ErrorCodes.SDK_INVALID_WEBHOOK_SIGNATURE:
      case ErrorCodes.SDK_INVALID_WEBHOOK_PAYLOAD: return new WebhookVerificationException(code, message, details, status, headers, requestId, body, cause);
      default: break;
    }
    // sdk/http-error is an HTTP failure whatever its status: the status decides which kind.
    if (status == 0 && ErrorCodes.SDK_HTTP_ERROR.equals(code)) return new ApiException(code, message, details, status, headers, requestId, body, cause);
    if (status == 0) return new InvalidArgumentException(code, message, details, status, headers, requestId, body, cause);
    if (status >= 500) return new ServerException(code, message, details, status, headers, requestId, body, cause);
    switch (status) {
      case 400: return new BadRequestException(code, message, details, status, headers, requestId, body, cause);
      case 401: return new AuthenticationException(code, message, details, status, headers, requestId, body, cause);
      case 403: return new PermissionDeniedException(code, message, details, status, headers, requestId, body, cause);
      case 404: return new NotFoundException(code, message, details, status, headers, requestId, body, cause);
      case 409: return new ConflictException(code, message, details, status, headers, requestId, body, cause);
      case 413: return new PayloadTooLargeException(code, message, details, status, headers, requestId, body, cause);
      case 422: return new UnprocessableEntityException(code, message, details, status, headers, requestId, body, cause);
      case 429: return new RateLimitException(code, message, details, status, headers, requestId, body, cause);
      default: return new ApiException(code, message, details, status, headers, requestId, body, cause);
    }
  }

  /**
   * An exception raised before or without a response.
   *
   * @param code the error code
   * @param message a message for logs
   * @return the exception of the code's kind, not thrown
   */
  public static CalmLensException of(String code, String message) { return of(code, message, null, 0, null, null, null, null); }

  /**
   * An exception raised before or without a response.
   *
   * @param code the error code
   * @param message a message for logs
   * @param cause the cause
   * @return the exception of the code's kind, not thrown
   */
  public static CalmLensException of(String code, String message, @Nullable Throwable cause) {
    return of(code, message, null, 0, null, null, null, cause);
  }
}
