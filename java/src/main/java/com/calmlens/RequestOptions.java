package com.calmlens;

import java.time.Duration;

/**
 * Per-call options: an idempotency key for uploads, and deadlines and retries for one call. Pass
 * them to an upload or {@code cdn.serve}, or use {@link CalmLensServerClient#withRequestOptions} for
 * a client whose every call uses them.
 *
 * <pre>{@code
 * client.assets.create(options, new RequestOptions().idempotencyKey(order.id()).uploadTimeout(Duration.ofMinutes(30)));
 * }</pre>
 */
public final class RequestOptions {
  private String idempotencyKey;
  private Duration timeout, uploadTimeout;
  private Integer maxRetries;

  /** No overrides. */
  public RequestOptions() {}

  /**
   * Sets the {@code Idempotency-Key} for an upload. Without one, the client generates a key for each
   * call and reuses it for that call's automatic retries. Pass your own (1 to 255 printable ASCII
   * characters without a space at either end, such as a UUID stored with your record) to retry
   * safely across processes; the API refuses other keys with {@link ErrorCodes#INVALID_IDEMPOTENCY_KEY}.
   *
   * @param value the key
   * @return these options
   */
  public RequestOptions idempotencyKey(String value) { idempotencyKey = value; return this; }

  /**
   * Overrides {@link CalmLensServerClient.Builder#timeout(Duration)}: the deadline of each API
   * request attempt (text uploads included), and for {@code cdn.serve} the wait for the response
   * headers and the idle timeout of its stream.
   *
   * @param value a positive duration
   * @return these options
   */
  public RequestOptions timeout(Duration value) { timeout = value; return this; }

  /**
   * Overrides {@link CalmLensServerClient.Builder#uploadTimeout(Duration)}: the deadline of each
   * binary upload attempt.
   *
   * @param value a positive duration
   * @return these options
   */
  public RequestOptions uploadTimeout(Duration value) { uploadTimeout = value; return this; }

  /**
   * Overrides {@link CalmLensServerClient.Builder#maxRetries(int)}.
   *
   * @param value 0 to 10
   * @return these options
   */
  public RequestOptions maxRetries(int value) { maxRetries = value; return this; }

  String idempotencyKeyValue() { return idempotencyKey; }

  Duration timeoutValue() { return timeout; }

  Duration uploadTimeoutValue() { return uploadTimeout; }

  Integer maxRetriesValue() { return maxRetries; }

  @Override public String toString() {
    return "RequestOptions[idempotencyKey=" + idempotencyKey + ", timeout=" + timeout + ", uploadTimeout=" + uploadTimeout + ", maxRetries=" + maxRetries + "]";
  }
}
