package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * A link safety result (preview). {@code links} is set only for {@code evaluated}; {@code reason}
 * only for {@code not-evaluated}. It runs when the project's policy acts on links, not through
 * {@code processingOptions.features}.
 */
public final class LinkSafetyResult extends CalmLensObject {
  private String status;
  private String reason;
  private List<CheckedLink> links;

  private LinkSafetyResult() {}

  // NOTE: no facts (not in types.json)
  /** @return {@code evaluated} or {@code not-evaluated}; empty when the API sends none */
  public Optional<String> getStatus() { return Optional.ofNullable(status); }

  // NOTE: no facts (not in types.json)
  /** @return why the feature was not evaluated: {@code not-supported} or {@code unavailable}; empty when the API sends none */
  public Optional<String> getReason() { return Optional.ofNullable(reason); }

  // NOTE: no facts (not in types.json)
  /** @return every link found in the asset, with where it leads and its verdict; empty when the API sends none */
  public Optional<List<CheckedLink>> getLinks() { return Optional.ofNullable(links); }
}
