package com.calmlens.params;

import com.calmlens.internal.Patch;
import com.calmlens.internal.Required;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** Earlier posts in the conversation, oldest first. */
public final class ModerationContextParams extends ApiParams {
  @Required private final @Nullable List<ModerationContextItemParams> items;

  private ModerationContextParams(Builder builder) {
    super(builder);
    this.items = builder.items;
  }

  /** The most recent earlier posts CalmLens uses. */
  public static final int USED_ITEMS = 5;

  /**
   * The most characters (Unicode code points) of earlier posts CalmLens uses. The newest post
   * always fits, since no post may be longer.
   */
  public static final int USED_CHARACTERS = 2_000;

  /**
   * @param items earlier posts, oldest first
   * @return the context; the SDK sends only the posts CalmLens uses
   */
  public static ModerationContextParams of(List<ModerationContextItemParams> items) { return builder().setItems(items).build(); }

  /**
   * The earlier posts CalmLens uses: walking from the newest, at most {@link #USED_ITEMS} posts
   * within {@link #USED_CHARACTERS} Unicode code points, returned oldest first. The newest post is
   * always kept, so an over-long one is left for the API to reject.
   *
   * @param items earlier posts, oldest first
   * @return the posts the SDK sends, oldest first
   * @throws com.calmlens.exception.InvalidArgumentException when the list, a post or its text is null
   */
  public static List<ModerationContextItemParams> selectItems(@Nullable List<ModerationContextItemParams> items) {
    if (items == null) throw com.calmlens.exception.CalmLensException.of(com.calmlens.ErrorCodes.SDK_INVALID_ARGUMENT, "context.items must be a list of earlier posts");
    java.util.ArrayDeque<ModerationContextItemParams> selected = new java.util.ArrayDeque<>();
    int characters = 0;
    for (int index = items.size() - 1; index >= 0 && selected.size() < USED_ITEMS; index--) {
      ModerationContextItemParams item = items.get(index);
      String text = item == null ? null : item.getText().orElse(null);
      if (text == null)
        throw com.calmlens.exception.CalmLensException.of(com.calmlens.ErrorCodes.SDK_INVALID_ARGUMENT, "context.items[" + index + "].text must be a string");
      int length = text.codePointCount(0, text.length());
      if (!selected.isEmpty() && characters + length > USED_CHARACTERS) break;
      selected.addFirst(item);
      characters += length;
    }
    return List.copyOf(selected);
  }

  /** @return a builder with nothing set */
  public static Builder builder() { return new Builder(); }

  /** @return the posts; empty when unset */
  public java.util.Optional<List<ModerationContextItemParams>> getItems() { return java.util.Optional.ofNullable(items); }

  /** Builds {@link ModerationContextParams}. */
  public static final class Builder extends ApiParams.Builder<Builder> {
    private @Nullable List<ModerationContextItemParams> items;

    private Builder() {}

    /**
     * @param value the posts
     * @return this builder
     */
    public Builder setItems(@Nullable List<ModerationContextItemParams> value) { this.items = value == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(value)); return this; }

    /**
     * @return the params
     * @throws com.calmlens.exception.InvalidArgumentException when a required option is unset
     */
    public ModerationContextParams build() { return checkRequired(new ModerationContextParams(this)); }
  }
}
