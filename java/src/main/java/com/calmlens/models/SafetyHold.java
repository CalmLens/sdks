package com.calmlens.models;

import com.calmlens.internal.Json.EpochMillis;
import com.calmlens.internal.Required;
import com.google.gson.annotations.JsonAdapter;
import java.time.Instant;
import java.util.Optional;

/**
 * A safety hold that restricts access to an asset.
 */
public final class SafetyHold extends CalmLensObject {
  @Required private SafetyHoldReason reason;
  @Required @JsonAdapter(EpochMillis.class) private Instant placedAt;
  @JsonAdapter(EpochMillis.class) private Instant disposedAt;

  private SafetyHold() {}

  /** @return hold reason */
  public SafetyHoldReason getReason() { return required(reason, "reason"); }

  /** @return when the hold was placed */
  public Instant getPlacedAt() { return required(placedAt, "placedAt"); }

  /** @return when the held content was disposed of; empty when the API sends none */
  public Optional<Instant> getDisposedAt() { return Optional.ofNullable(disposedAt); }
}
