package com.calmlens.models;

/**
 * Why an adaptive stream is unavailable ({@code content.hls.reason}). A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum HlsUnavailableReason implements ApiEnum {
  ALLOWANCE_USED("allowance-used"),
  BILLING_REQUIRED("billing-required"),
  SPEND_LIMIT("spend-limit"),
  PROCESSING_FAILED("processing-failed"),
  CONTENT_NOT_KEPT("content-not-kept"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  HlsUnavailableReason(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "allowance-used"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static HlsUnavailableReason fromValue(String value) { return ApiEnum.fromValue(HlsUnavailableReason.class, value); }
}
