package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * A restriction of the asset in one region.
 */
public final class RegionalDecision extends CalmLensObject {
  @Required private Region region;
  @Required private RegionalRestriction status;
  @Required private String rule;
  private ModerationCategory category;

  private RegionalDecision() {}

  /** @return the jurisdiction */
  public Region getRegion() { return required(region, "region"); }

  /** @return {@code limited}, {@code age-restricted}, {@code blocked} or {@code purged} */
  public RegionalRestriction getStatus() { return required(status, "status"); }

  /** @return the rule that restricted it */
  public String getRule() { return required(rule, "rule"); }

  /** @return the category the rule is about; empty when the API sends none */
  public Optional<ModerationCategory> getCategory() { return Optional.ofNullable(category); }
}
