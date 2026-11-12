package com.calmlens;

import java.time.Duration;
import java.util.Optional;
import org.jspecify.annotations.Nullable;

/**
 * One attempt of a request, as {@link RequestListener#onAttempt} receives it. It never holds the
 * API key, request or response bodies, query strings or signed URLs.
 */
public final class RequestEvent {
  private final @Nullable String operation;
  private final String method, path;
  private final int attempt;
  private final @Nullable Duration delay;
  private final int status;
  private final @Nullable String requestId, errorCode;
  private final Duration duration;

  RequestEvent(@Nullable String operation, String method, String path, int attempt, @Nullable Duration delay, int status,
      @Nullable String requestId, @Nullable String errorCode, Duration duration) {
    this.operation = operation;
    this.method = method;
    this.path = path;
    this.attempt = attempt;
    this.delay = delay;
    this.status = status;
    this.requestId = requestId;
    this.errorCode = errorCode;
    this.duration = duration;
  }

  /** @return the SDK operation, such as {@code assets.retrieve}; empty for {@code request} and CDN fetches */
  public Optional<String> getOperation() { return Optional.ofNullable(operation); }

  /** @return the HTTP method */
  public String getMethod() { return method; }

  /** @return the request path without its query; signed asset grants are redacted */
  public String getPath() { return path; }

  /** @return the attempt, 1 for the first */
  public int getAttempt() { return attempt; }

  /** @return the wait before the next attempt; empty when the request won't be retried */
  public Optional<Duration> getDelay() { return Optional.ofNullable(delay); }

  /** @return the HTTP status, or 0 when no response arrived */
  public int getStatus() { return status; }

  /** @return the response's request ID */
  public Optional<String> getRequestId() { return Optional.ofNullable(requestId); }

  /** @return the error code of a failed attempt */
  public Optional<String> getErrorCode() { return Optional.ofNullable(errorCode); }

  /** @return how long the attempt took */
  public Duration getDuration() { return duration; }

  @Override public String toString() {
    return "RequestEvent[" + (operation == null ? "" : operation + " ") + method + " " + path + " attempt=" + attempt + " status=" + status
        + (requestId == null ? "" : " requestId=" + requestId) + (errorCode == null ? "" : " error=" + errorCode)
        + " duration=" + duration.toMillis() + "ms" + (delay == null ? "" : " retryIn=" + delay.toMillis() + "ms") + "]";
  }
}
