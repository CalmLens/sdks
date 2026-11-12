package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import com.calmlens.models.EventType;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** Options for {@code events().list} and {@code events().pages}. {@code types} and {@code assetId} narrow the feed; a cursor belongs to the filters it was issued with, so pass the same ones with each cursor. */
public final class EventListParams extends ApiParams {
  private final @Nullable String cursor;
  private final @Nullable Integer pageSize;
  private final @Nullable List<EventType> types;
  private final @Nullable String assetId;

  private EventListParams(Builder builder) {
    super(builder);
    this.cursor = builder.cursor;
    this.pageSize = builder.pageSize;
    this.types = builder.types;
    this.assetId = builder.assetId;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the previous page's {@code nextCursor}; empty when unset */
  public java.util.Optional<String> getCursor() { return java.util.Optional.ofNullable(cursor); }

  /** @return items per page, 1 to 100 (default 50); empty when unset */
  public java.util.Optional<Integer> getPageSize() { return java.util.Optional.ofNullable(pageSize); }

  /** @return only events of these types; empty when unset */
  public java.util.Optional<List<EventType>> getTypes() { return java.util.Optional.ofNullable(types); }

  /** @return only events about this asset; empty when unset */
  public java.util.Optional<String> getAssetId() { return java.util.Optional.ofNullable(assetId); }

  /** Builds {@link EventListParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String cursor;
    private @Nullable Integer pageSize;
    private @Nullable List<EventType> types;
    private @Nullable String assetId;

    private Builder() {}

    /**
     * @param value the previous page's {@code nextCursor}; null unsets it
     * @return this builder
     */
    public Builder setCursor(@Nullable String value) { this.cursor = value; return this; }

    /**
     * @param value items per page, 1 to 100 (default 50); null unsets it
     * @return this builder
     */
    public Builder setPageSize(@Nullable Integer value) { this.pageSize = value; return this; }

    /**
     * @param value only events of these types; null unsets it
     * @return this builder
     */
    public Builder setTypes(@Nullable List<EventType> value) { this.types = value == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value)); return this; }

    /**
     * @param value only events about this asset; null unsets it
     * @return this builder
     */
    public Builder setAssetId(@Nullable String value) { this.assetId = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public EventListParams build() { return checkRequired(new EventListParams(this)); }
  }
}
