package com.calmlens.models;

import com.calmlens.internal.Json.EpochMillis;
import com.calmlens.internal.Required;
import com.google.gson.annotations.JsonAdapter;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * The JSON body of a webhook delivery: the event in the shape {@code events.list} returns it. Get
 * it from {@code CalmLensServerClient.parseWebhookEvent}. It keeps the JSON it was read from
 * ({@link #getRawJsonObject()}), so fields this SDK version does not model survive.
 */
public final class WebhookEventPayload extends CalmLensObject {
  @Required private String id;
  @Required private String projectId;
  @Required private EventActor actor;
  @Required private EventType type;
  @Required private EventSeverity severity;
  @Required private String title;
  private String description;
  private String assetId;
  private Long assetSequence;
  private EventAsset asset;
  private List<EventFact> facts;
  @Required @JsonAdapter(EpochMillis.class) private Instant createdAt;

  private WebhookEventPayload() {}

  /** @return event ID; the same on every retry, so use it to skip duplicates */
  public String getId() { return required(id, "id"); }

  /** @return owning project */
  public String getProjectId() { return required(projectId, "projectId"); }

  /** @return who caused the event */
  public EventActor getActor() { return required(actor, "actor"); }

  /** @return event type, such as {@code asset.blocked} */
  public EventType getType() { return required(type, "type"); }

  /** @return severity */
  public EventSeverity getSeverity() { return required(severity, "severity"); }

  /** @return short summary */
  public String getTitle() { return required(title, "title"); }

  /** @return longer explanation; empty when the API sends none */
  public Optional<String> getDescription() { return Optional.ofNullable(description); }

  /** @return asset the event is about; empty when the API sends none */
  public Optional<String> getAssetId() { return Optional.ofNullable(assetId); }

  /** @return increases with each event about the asset; null for events not about an asset. Deliveries can arrive out of order: see {@code CalmLensServerClient.isNewerAssetEvent}; empty when the API sends none */
  public Optional<Long> getAssetSequence() { return Optional.ofNullable(assetSequence); }

  /** @return snapshot of the asset's decision; retrieve the asset for its current state; empty when the API sends none */
  public Optional<EventAsset> getAsset() { return Optional.ofNullable(asset); }

  /** @return registered facts (never null) */
  public List<EventFact> getFacts() { return facts == null ? List.of() : facts; }

  /** @return event creation time */
  public Instant getCreatedAt() { return required(createdAt, "createdAt"); }

}
