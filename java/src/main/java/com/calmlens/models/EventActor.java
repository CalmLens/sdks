package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * Who caused an event.
 */
public final class EventActor extends CalmLensObject {
  @Required private ActorType type;
  private String id;

  private EventActor() {}

  /** @return {@code user} for a person in the portal (or an assistant acting for one), {@code api-key} for an API key, {@code automated} for automated moderation or {@code system} for CalmLens itself */
  public ActorType getType() { return required(type, "type"); }

  /** @return the user's or API key's ID; null when it was not recorded, and for {@code automated} and {@code system}; empty when the API sends none */
  public Optional<String> getId() { return Optional.ofNullable(id); }

  /**
   * An actor, for building test events.
   *
   * @param type who caused the event
   * @param id their ID, or null
   * @return the actor
   */
  public static EventActor of(ActorType type, @org.jspecify.annotations.Nullable String id) {
    com.google.gson.JsonObject json = new com.google.gson.JsonObject();
    json.addProperty("type", type.getValue());
    json.addProperty("id", id);
    return com.calmlens.internal.Json.GSON.fromJson(json, EventActor.class);
  }
}
