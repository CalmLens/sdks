package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** Options for {@code projectSettings().update}. */
public final class ProjectSettingsUpdateParams extends ApiParams {
  private final @Nullable Integer revision;
  @Required private final @Nullable ProjectSettingsParams settings;
  private final @Nullable Double searchIndexingBudgetUnits;

  private ProjectSettingsUpdateParams(Builder builder) {
    super(builder);
    this.revision = builder.revision;
    this.settings = builder.settings;
    this.searchIndexingBudgetUnits = builder.searchIndexingBudgetUnits;
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the revision you read, so a concurrent edit is refused; empty when unset */
  public java.util.Optional<Integer> getRevision() { return java.util.Optional.ofNullable(revision); }

  /** @return the new settings; empty when unset */
  public java.util.Optional<ProjectSettingsParams> getSettings() { return java.util.Optional.ofNullable(settings); }

  /** @return the search indexing budget; empty when unset */
  public java.util.Optional<Double> getSearchIndexingBudgetUnits() { return java.util.Optional.ofNullable(searchIndexingBudgetUnits); }

  /** Builds {@link ProjectSettingsUpdateParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable Integer revision;
    private @Nullable ProjectSettingsParams settings;
    private @Nullable Double searchIndexingBudgetUnits;

    private Builder() {}

    /**
     * @param value the revision you read, so a concurrent edit is refused; null unsets it
     * @return this builder
     */
    public Builder setRevision(@Nullable Integer value) { this.revision = value; return this; }

    /**
     * @param value the new settings
     * @return this builder
     */
    public Builder setSettings(@Nullable ProjectSettingsParams value) { this.settings = value; return this; }

    /**
     * @param value the search indexing budget; null unsets it
     * @return this builder
     */
    public Builder setSearchIndexingBudgetUnits(@Nullable Double value) { this.searchIndexingBudgetUnits = value; return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public ProjectSettingsUpdateParams build() { return checkRequired(new ProjectSettingsUpdateParams(this)); }
  }
}
