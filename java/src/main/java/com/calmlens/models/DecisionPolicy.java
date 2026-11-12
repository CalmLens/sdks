package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * The policy that made a decision, as it was when it made it.
 */
public final class DecisionPolicy extends CalmLensObject {
  @Required private String id;
  @Required private Integer revision;
  private DecisionPolicyPreset preset;

  private DecisionPolicy() {}

  /** @return the policy's ID */
  public String getId() { return required(id, "id"); }

  /** @return the policy's revision when it made the decision */
  public int getRevision() { return required(revision, "revision"); }

  /** @return the preset release the policy used; null for a policy not made from a preset; empty when the API sends none */
  public Optional<DecisionPolicyPreset> getPreset() { return Optional.ofNullable(preset); }
}
