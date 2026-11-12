package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;

/**
 * What {@code uploadPresets.ensure} stored.
 */
public final class EnsureUploadPresetsResponse extends CalmLensObject {
  @Required private List<UploadPreset> uploadPresets;

  private EnsureUploadPresetsResponse() {}

  /** @return the stored presets, in the order they were sent */
  public List<UploadPreset> getUploadPresets() { return required(uploadPresets, "uploadPresets"); }
}
