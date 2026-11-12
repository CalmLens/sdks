package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * One provenance signal.
 */
public final class ProvenanceSignal extends CalmLensObject {
  private String kind;
  private String value;

  private ProvenanceSignal() {}

  // NOTE: no facts (not in types.json)
  /** @return {@code c2pa}, {@code generator-metadata} or {@code iptc-digital-source-type}; empty when the API sends none */
  public Optional<String> getKind() { return Optional.ofNullable(kind); }

  // NOTE: no facts (not in types.json)
  /** @return the signal's value; empty when the API sends none */
  public Optional<String> getValue() { return Optional.ofNullable(value); }
}
