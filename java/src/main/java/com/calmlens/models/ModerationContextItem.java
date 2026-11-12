package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * An earlier post in the conversation.
 */
public final class ModerationContextItem extends CalmLensObject {
  @Required private String text;
  private String authorId;

  private ModerationContextItem() {}

  /** @return the post's text */
  public String getText() { return required(text, "text"); }

  /** @return your identifier for who wrote it; empty when the API sends none */
  public Optional<String> getAuthorId() { return Optional.ofNullable(authorId); }

}
