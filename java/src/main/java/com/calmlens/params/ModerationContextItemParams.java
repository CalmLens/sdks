package com.calmlens.params;

import com.calmlens.internal.Required;
import org.jspecify.annotations.Nullable;

/** An earlier post in the conversation. */
public final class ModerationContextItemParams extends ApiParams {
  @Required private final @Nullable String text;
  private final @Nullable String authorId;

  private ModerationContextItemParams(Builder builder) {
    super(builder);
    this.text = builder.text;
    this.authorId = builder.authorId;
  }

  /**
   * @param text the post's text
   * @param authorId your identifier for who wrote it, or null
   * @return the post
   */
  public static ModerationContextItemParams of(String text, @Nullable String authorId) { return builder().setText(text).setAuthorId(authorId).build(); }

  /**
   * @param text the post's text, without an author
   * @return the post
   */
  public static ModerationContextItemParams of(String text) { return builder().setText(text).build(); }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the post's text; empty when unset */
  public java.util.Optional<String> getText() { return java.util.Optional.ofNullable(text); }

  /** @return your identifier for who wrote it; empty when unset */
  public java.util.Optional<String> getAuthorId() { return java.util.Optional.ofNullable(authorId); }


  /** Builds {@link ModerationContextItemParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable String text;
    private @Nullable String authorId;

    private Builder() {}

    /**
     * @param value the post's text
     * @return this builder
     */
    public Builder setText(@Nullable String value) { this.text = value; return this; }

    /**
     * @param value your identifier for who wrote it; null unsets it
     * @return this builder
     */
    public Builder setAuthorId(@Nullable String value) { this.authorId = value; return this; }


    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public ModerationContextItemParams build() { return checkRequired(new ModerationContextItemParams(this)); }
  }
}
