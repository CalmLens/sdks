package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Which processing features run. */
public final class ProcessingFeaturesParams extends ApiParams {
  private final @Nullable Patch<FeatureOptionsParams> ocr;
  private final @Nullable Patch<FeatureOptionsParams> personDetection;
  private final @Nullable Patch<FaceDetectionOptionsParams> faceDetection;
  private final @Nullable Patch<FeatureOptionsParams> linkDetection;
  private final @Nullable Patch<FeatureOptionsParams> streaming;
  private final @Nullable Patch<FeatureOptionsParams> aiGeneratedDetection;

  private ProcessingFeaturesParams(Builder builder) {
    super(builder);
    this.ocr = builder.ocr;
    this.personDetection = builder.personDetection;
    this.faceDetection = builder.faceDetection;
    this.linkDetection = builder.linkDetection;
    this.streaming = builder.streaming;
    this.aiGeneratedDetection = builder.aiGeneratedDetection;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return text recognition: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<FeatureOptionsParams> getOcr() { return java.util.Optional.ofNullable(ocr == null ? null : ocr.get()); }

  /** @return person detection: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<FeatureOptionsParams> getPersonDetection() { return java.util.Optional.ofNullable(personDetection == null ? null : personDetection.get()); }

  /** @return face detection: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<FaceDetectionOptionsParams> getFaceDetection() { return java.util.Optional.ofNullable(faceDetection == null ? null : faceDetection.get()); }

  /** @return link detection: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<FeatureOptionsParams> getLinkDetection() { return java.util.Optional.ofNullable(linkDetection == null ? null : linkDetection.get()); }

  /** @return adaptive streaming: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<FeatureOptionsParams> getStreaming() { return java.util.Optional.ofNullable(streaming == null ? null : streaming.get()); }

  /** @return (preview) generated-content detection: empty when unset; a cleared option is sent as null (see {@link #isCleared(String)}) */
  public java.util.Optional<FeatureOptionsParams> getAiGeneratedDetection() { return java.util.Optional.ofNullable(aiGeneratedDetection == null ? null : aiGeneratedDetection.get()); }

  /**
   * @param name an option's API name
   * @return whether the option is cleared: sent as null
   */
  public boolean isCleared(String name) { return (name.equals("ocr") && ocr != null && ocr.isClear()) || (name.equals("personDetection") && personDetection != null && personDetection.isClear()) || (name.equals("faceDetection") && faceDetection != null && faceDetection.isClear()) || (name.equals("linkDetection") && linkDetection != null && linkDetection.isClear()) || (name.equals("streaming") && streaming != null && streaming.isClear()) || (name.equals("aiGeneratedDetection") && aiGeneratedDetection != null && aiGeneratedDetection.isClear()); }

  /** Builds {@link ProcessingFeaturesParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Patch<FeatureOptionsParams> ocr;
    private @Nullable Patch<FeatureOptionsParams> personDetection;
    private @Nullable Patch<FaceDetectionOptionsParams> faceDetection;
    private @Nullable Patch<FeatureOptionsParams> linkDetection;
    private @Nullable Patch<FeatureOptionsParams> streaming;
    private @Nullable Patch<FeatureOptionsParams> aiGeneratedDetection;

    private Builder() {}

    /**
     * @param value text recognition; null unsets it
     * @return this builder
     */
    public Builder setOcr(@Nullable FeatureOptionsParams value) { this.ocr = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for ocr, clearing it.
     *
     * @return this builder
     */
    public Builder clearOcr() { this.ocr = Patch.clear(); return this; }

    /**
     * @param value person detection; null unsets it
     * @return this builder
     */
    public Builder setPersonDetection(@Nullable FeatureOptionsParams value) { this.personDetection = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for personDetection, clearing it.
     *
     * @return this builder
     */
    public Builder clearPersonDetection() { this.personDetection = Patch.clear(); return this; }

    /**
     * @param value face detection; null unsets it
     * @return this builder
     */
    public Builder setFaceDetection(@Nullable FaceDetectionOptionsParams value) { this.faceDetection = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for faceDetection, clearing it.
     *
     * @return this builder
     */
    public Builder clearFaceDetection() { this.faceDetection = Patch.clear(); return this; }

    /**
     * @param value link detection; null unsets it
     * @return this builder
     */
    public Builder setLinkDetection(@Nullable FeatureOptionsParams value) { this.linkDetection = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for linkDetection, clearing it.
     *
     * @return this builder
     */
    public Builder clearLinkDetection() { this.linkDetection = Patch.clear(); return this; }

    /**
     * @param value adaptive streaming; null unsets it
     * @return this builder
     */
    public Builder setStreaming(@Nullable FeatureOptionsParams value) { this.streaming = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for streaming, clearing it.
     *
     * @return this builder
     */
    public Builder clearStreaming() { this.streaming = Patch.clear(); return this; }

    /**
     * @param value (preview) generated-content detection; null unsets it
     * @return this builder
     */
    public Builder setAiGeneratedDetection(@Nullable FeatureOptionsParams value) { this.aiGeneratedDetection = value == null ? null : Patch.value(value); return this; }

    /**
     * Sends null for aiGeneratedDetection, clearing it.
     *
     * @return this builder
     */
    public Builder clearAiGeneratedDetection() { this.aiGeneratedDetection = Patch.clear(); return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public ProcessingFeaturesParams build() { return checkRequired(new ProcessingFeaturesParams(this)); }
  }
}
