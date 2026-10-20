package com.calmlens;

import java.time.Duration;

/**
 * Per-call options for uploads and CDN requests.
 *
 * <pre>{@code
 * client.assets.create(options, new RequestOptions().idempotencyKey(order.id()).timeout(Duration.ofMinutes(30)));
 * }</pre>
 */
public final class RequestOptions {
  private String idempotencyKey;
  private Duration timeout;

  /** No overrides. */
  public RequestOptions() {}

  /**
   * Sets the {@code Idempotency-Key} for an upload. Without one, the client generates a key for each
   * call and reuses it for that call's automatic retries. Pass your own (1 to 255 printable ASCII
   * characters, such as a UUID stored with your record) to retry safely across processes.
   *
   * @param value the key
   * @return these options
   */
  public RequestOptions idempotencyKey(String value) { idempotencyKey = value; return this; }

  /**
   * Overrides the client's upload timeout (uploads) or idle timeout (CDN streams) for this call.
   *
   * @param value a positive duration
   * @return these options
   */
  public RequestOptions timeout(Duration value) { timeout = value; return this; }

  String idempotencyKeyValue() { return idempotencyKey; }

  Duration timeoutValue() { return timeout; }

  @Override public String toString() { return "RequestOptions[idempotencyKey=" + idempotencyKey + ", timeout=" + timeout + "]"; }
}
