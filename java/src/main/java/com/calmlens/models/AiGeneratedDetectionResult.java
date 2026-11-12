package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * An AI-generated content detection result from provenance metadata. {@code provenance} and
 * {@code signals} are set only for {@code evaluated}; {@code reason} only for {@code not-evaluated}.
 */
public final class AiGeneratedDetectionResult extends CalmLensObject {
  private String status;
  private String reason;
  private String provenance;
  private List<ProvenanceSignal> signals;

  private AiGeneratedDetectionResult() {}

  // NOTE: no facts (not in types.json)
  /** @return {@code evaluated} or {@code not-evaluated}; empty when the API sends none */
  public Optional<String> getStatus() { return Optional.ofNullable(status); }

  // NOTE: no facts (not in types.json)
  /** @return why the feature was not evaluated: {@code not-supported}, {@code unavailable} or {@code in-children}; empty when the API sends none */
  public Optional<String> getReason() { return Optional.ofNullable(reason); }

  // NOTE: no facts (not in types.json)
  /** @return {@code ai-generated}, {@code ai-edited} or {@code unknown}; empty when the API sends none */
  public Optional<String> getProvenance() { return Optional.ofNullable(provenance); }

  // NOTE: no facts (not in types.json)
  /** @return the metadata that indicated it; empty when the API sends none */
  public Optional<List<ProvenanceSignal>> getSignals() { return Optional.ofNullable(signals); }
}
