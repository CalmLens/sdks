package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * Text extracted from an asset.
 */
public final class ExtractedText extends CalmLensObject {
  @Required private ExtractedTextType type;
  private String content;
  private String id;

  private ExtractedText() {}

  /** @return extraction type */
  public ExtractedTextType getType() { return required(type, "type"); }

  /** @return extracted text; empty when the API sends none */
  public Optional<String> getContent() { return Optional.ofNullable(content); }

  /** @return extraction ID; empty when the API sends none */
  public Optional<String> getId() { return Optional.ofNullable(id); }
}
