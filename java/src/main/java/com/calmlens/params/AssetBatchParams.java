package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.AssetBatchOperation;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** Options for {@code assets().batch}. */
public final class AssetBatchParams extends ApiParams {
  @Required private final @Nullable List<String> assetIds;
  @Required private final @Nullable AssetBatchOperation operation;

  private AssetBatchParams(Builder builder) {
    super(builder);
    this.assetIds = builder.assetIds;
    this.operation = builder.operation;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return 1 to 500 asset IDs; empty when unset */
  public java.util.Optional<List<String>> getAssetIds() { return java.util.Optional.ofNullable(assetIds); }

  /** @return what to do to every asset; empty when unset */
  public java.util.Optional<AssetBatchOperation> getOperation() { return java.util.Optional.ofNullable(operation); }

  /** Builds {@link AssetBatchParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable List<String> assetIds;
    private @Nullable AssetBatchOperation operation;

    private Builder() {}

    /**
     * @param value 1 to 500 asset IDs
     * @return this builder
     */
    public Builder setAssetIds(@Nullable List<String> value) { this.assetIds = value == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value)); return this; }

    /**
     * @param value what to do to every asset
     * @return this builder
     */
    public Builder setOperation(@Nullable AssetBatchOperation value) { this.operation = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public AssetBatchParams build() { return checkRequired(new AssetBatchParams(this)); }
  }
}
