package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.AssetModerationDecision;
import org.jspecify.annotations.Nullable;

/** Options for {@code assets().decide}: a reviewer's decision and the note recorded with it. Purging deletes the stored content and needs {@code setConfirmPurge(true)}. */
public final class AssetDecideParams extends ApiParams {
  @Required private final @Nullable AssetModerationDecision decision;
  @Required private final @Nullable String note;
  private final @Nullable Boolean confirmPurge;

  private AssetDecideParams(Builder builder) {
    super(builder);
    this.decision = builder.decision;
    this.note = builder.note;
    this.confirmPurge = builder.confirmPurge;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the new moderation decision; empty when unset */
  public java.util.Optional<AssetModerationDecision> getDecision() { return java.util.Optional.ofNullable(decision); }

  /** @return why the reviewer decided this, 1 to 1499 characters after trimming; empty when unset */
  public java.util.Optional<String> getNote() { return java.util.Optional.ofNullable(note); }

  /** @return must be true to purge: the content is deleted and can't be restored; empty when unset */
  public java.util.Optional<Boolean> getConfirmPurge() { return java.util.Optional.ofNullable(confirmPurge); }

  /** Builds {@link AssetDecideParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable AssetModerationDecision decision;
    private @Nullable String note;
    private @Nullable Boolean confirmPurge;

    private Builder() {}

    /**
     * @param value the new moderation decision
     * @return this builder
     */
    public Builder setDecision(@Nullable AssetModerationDecision value) { this.decision = value; return this; }

    /**
     * @param value why the reviewer decided this, 1 to 1499 characters after trimming
     * @return this builder
     */
    public Builder setNote(@Nullable String value) { this.note = value; return this; }

    /**
     * @param value must be true to purge: the content is deleted and can't be restored; null unsets it
     * @return this builder
     */
    public Builder setConfirmPurge(@Nullable Boolean value) { this.confirmPurge = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public AssetDecideParams build() { return checkRequired(new AssetDecideParams(this)); }
  }
}
