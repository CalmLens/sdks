package com.calmlens.models;

/**
 * Where an asset is in the pipeline ({@code classification.status}). A value this SDK version doesn't know decodes as {@link #UNKNOWN}; the model's {@link
 * CalmLensObject#getRawJsonObject()} still has it.
 */
public enum AssetClassificationStatus implements ApiEnum {
  /** Waiting for its content, such as a multipart upload still receiving parts, or for its turn. */
  QUEUED("queued"),
  /** Being classified. */
  PROCESSING("processing"),
  /** Processing finished; see {@code classification.moderation.decision} for the decision. */
  COMPLETED("completed"),
  /** Processing failed; {@code assets.retry} processes the asset again. */
  FAILED("failed"),
  /** A value this SDK version doesn't know. It can't be sent. */
  UNKNOWN(null);

  private final String value;

  AssetClassificationStatus(String value) { this.value = value; }

  /** @return the API value, or null for {@link #UNKNOWN} */
  @Override public String getValue() { return value; }

  /**
   * @param value an API value, such as {@code "queued"}
   * @return the matching constant, or {@link #UNKNOWN}
   */
  public static AssetClassificationStatus fromValue(String value) { return ApiEnum.fromValue(AssetClassificationStatus.class, value); }
}
