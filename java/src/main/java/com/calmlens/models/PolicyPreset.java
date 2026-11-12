package com.calmlens.models;

import com.calmlens.internal.Required;

/**
 * Where a policy started from a built-in preset.
 */
public final class PolicyPreset extends CalmLensObject {
  @Required private PolicyPresetId id;
  @Required private Integer version;
  @Required private Integer latestVersion;
  @Required private PolicyPresetMode mode;

  private PolicyPreset() {}

  /** @return the preset, such as {@code general-community} or {@code children-platform} */
  public PolicyPresetId getId() { return required(id, "id"); }

  /** @return the preset release the policy is at; {@code policies.reset} restores a pinned or copied policy to it */
  public int getVersion() { return required(version, "version"); }

  /** @return the newest release, which {@code policies.upgrade} moves an unchanged pinned or copied policy to */
  public int getLatestVersion() { return required(latestVersion, "latestVersion"); }

  /** @return {@code live} for the organisation's own preset policy following automatic updates, which always has the latest settings; {@code pinned} for that policy with automatic updates off, kept at {@code version}; {@code copy} for a policy made from the preset */
  public PolicyPresetMode getMode() { return required(mode, "mode"); }
}
