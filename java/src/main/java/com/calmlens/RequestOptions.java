package com.calmlens;

import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.jspecify.annotations.Nullable;

/**
 * Per-call options: an idempotency key for uploads, deadlines, retries and extra headers for one
 * call. Every client method takes them as its last argument, and {@link
 * CalmLensServerClient#withRequestOptions} makes a client whose every call uses them. They are
 * immutable; build them with {@link #builder()}.
 *
 * <pre>{@code
 * client.assets().create(params, RequestOptions.builder().setIdempotencyKey(order.id()).setUploadTimeout(Duration.ofMinutes(30)).build());
 * }</pre>
 */
public final class RequestOptions {
  private static final RequestOptions NONE = builder().build();

  private final @Nullable String idempotencyKey;
  private final @Nullable Duration timeout, uploadTimeout;
  private final @Nullable Integer maxRetries;
  private final Map<String, String> headers;
  private final Map<String, @Nullable Object> extraQuery, extraBody;

  private RequestOptions(Builder builder) {
    this.idempotencyKey = builder.idempotencyKey;
    this.timeout = builder.timeout;
    this.uploadTimeout = builder.uploadTimeout;
    this.maxRetries = builder.maxRetries;
    this.headers = Collections.unmodifiableMap(new LinkedHashMap<>(builder.headers));
    this.extraQuery = Collections.unmodifiableMap(new LinkedHashMap<>(builder.extraQuery));
    this.extraBody = Collections.unmodifiableMap(new LinkedHashMap<>(builder.extraBody));
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return options that override nothing */
  public static RequestOptions none() { return NONE; }

  /** @return a builder with these options */
  public Builder toBuilder() {
    Builder builder = new Builder();
    builder.idempotencyKey = idempotencyKey;
    builder.timeout = timeout;
    builder.uploadTimeout = uploadTimeout;
    builder.maxRetries = maxRetries;
    builder.headers.putAll(headers);
    builder.extraQuery.putAll(extraQuery);
    builder.extraBody.putAll(extraBody);
    return builder;
  }

  /** @return the {@code Idempotency-Key} for an upload */
  public Optional<String> getIdempotencyKey() { return Optional.ofNullable(idempotencyKey); }

  /** @return the deadline of each request attempt */
  public Optional<Duration> getTimeout() { return Optional.ofNullable(timeout); }

  /** @return the deadline of each binary upload attempt */
  public Optional<Duration> getUploadTimeout() { return Optional.ofNullable(uploadTimeout); }

  /** @return how many times a failed request is retried */
  public Optional<Integer> getMaxRetries() { return Optional.ofNullable(maxRetries); }

  /** @return extra headers sent with each request, by name */
  public Map<String, String> getHeaders() { return headers; }

  /** @return query parameters added to each request, replacing ones of the same name */
  public Map<String, @Nullable Object> getExtraQuery() { return extraQuery; }

  /** @return JSON body fields added to each request, replacing ones of the same name */
  public Map<String, @Nullable Object> getExtraBody() { return extraBody; }

  /** @return whether these options override nothing */
  public boolean isEmpty() {
    return idempotencyKey == null && timeout == null && uploadTimeout == null && maxRetries == null && headers.isEmpty()
        && extraQuery.isEmpty() && extraBody.isEmpty();
  }

  @Override public String toString() {
    return "RequestOptions[idempotencyKey=" + idempotencyKey + ", timeout=" + timeout + ", uploadTimeout=" + uploadTimeout
        + ", maxRetries=" + maxRetries + ", headers=" + headers.keySet() + "]";
  }

  /** Builds {@link RequestOptions}. */
  public static final class Builder {
    private @Nullable String idempotencyKey;
    private @Nullable Duration timeout, uploadTimeout;
    private @Nullable Integer maxRetries;
    private final Map<String, String> headers = new LinkedHashMap<>();
    private final Map<String, @Nullable Object> extraQuery = new LinkedHashMap<>(), extraBody = new LinkedHashMap<>();

    private Builder() {}

    /**
     * Sets the {@code Idempotency-Key} for an upload. Without one, the client generates a key for
     * each call and reuses it for that call's automatic retries. Pass your own (1 to 255 printable
     * ASCII characters without a space at either end, such as a UUID stored with your record) to
     * retry safely across processes; the API refuses other keys with {@link
     * ErrorCodes#INVALID_IDEMPOTENCY_KEY}.
     *
     * @param value the key, or null for a generated one
     * @return this builder
     */
    public Builder setIdempotencyKey(@Nullable String value) { idempotencyKey = value; return this; }

    /**
     * Overrides {@link CalmLensServerClient.Builder#timeout(Duration)}: the deadline of each API
     * request attempt (text uploads included), and for {@code cdn().serve} the wait for the
     * response headers and the idle timeout of its stream.
     *
     * @param value a positive duration, or null for the client's
     * @return this builder
     */
    public Builder setTimeout(@Nullable Duration value) { timeout = value; return this; }

    /**
     * Overrides {@link CalmLensServerClient.Builder#uploadTimeout(Duration)}: the deadline of each
     * binary upload attempt.
     *
     * @param value a positive duration, or null for the client's
     * @return this builder
     */
    public Builder setUploadTimeout(@Nullable Duration value) { uploadTimeout = value; return this; }

    /**
     * Overrides {@link CalmLensServerClient.Builder#maxRetries(int)}.
     *
     * @param value 0 to 10, or null for the client's
     * @return this builder
     */
    public Builder setMaxRetries(@Nullable Integer value) { maxRetries = value; return this; }

    /**
     * Adds a header to each request, such as a tracing header. The SDK's own headers ({@code
     * X-Api-Key}, {@code Idempotency-Key}, {@code Content-Type} and the like) can't be set.
     *
     * @param name the header name
     * @param value its value
     * @return this builder
     */
    public Builder putHeader(String name, String value) { headers.put(name, value); return this; }

    /**
     * @param values headers to add, by name
     * @return this builder
     */
    public Builder putAllHeaders(Map<String, String> values) { headers.putAll(values); return this; }

    /**
     * Adds a query parameter to each request, such as one the API added after this SDK version.
     * A string is sent as it is, anything else as JSON.
     *
     * @param name the parameter
     * @param value its value
     * @return this builder
     */
    public Builder putExtraQuery(String name, @Nullable Object value) { extraQuery.put(name, value); return this; }

    /**
     * Adds a field to each request's JSON body (or an upload's options), such as one the API added
     * after this SDK version. It replaces a field of the same name.
     *
     * @param name the field
     * @param value its value, encoded as JSON; null sends null
     * @return this builder
     */
    public Builder putExtraBody(String name, @Nullable Object value) { extraBody.put(name, value); return this; }

    /** @return the options */
    public RequestOptions build() { return new RequestOptions(this); }
  }
}
