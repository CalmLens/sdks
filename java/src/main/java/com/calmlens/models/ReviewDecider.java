package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * Who made a review decision.
 */
public final class ReviewDecider extends CalmLensObject {
  @Required private ReviewerType type;
  private String id;

  private ReviewDecider() {}

  /** @return {@code user} for a person (or an assistant's key acting for one), {@code api-key} for an API key */
  public ReviewerType getType() { return required(type, "type"); }

  /** @return the user's or API key's ID; null only when it was not recorded; empty when the API sends none */
  public Optional<String> getId() { return Optional.ofNullable(id); }
}
