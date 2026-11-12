package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * An OCR result. {@code textRegions} is set only for {@code evaluated}; {@code reason} only for
 * {@code not-evaluated}.
 */
public final class OcrResult extends CalmLensObject {
  @Required private EvaluationStatus status;
  private FeatureNotEvaluatedReason reason;
  private List<TextRegion> textRegions;

  private OcrResult() {}

  /** @return {@code evaluated} or {@code not-evaluated} */
  public EvaluationStatus getStatus() { return required(status, "status"); }

  /** @return why the feature was not evaluated: {@code not-supported}, {@code unavailable} or {@code in-children}; empty when the API sends none */
  public Optional<FeatureNotEvaluatedReason> getReason() { return Optional.ofNullable(reason); }

  /** @return the text regions found in the image; empty when the API sends none */
  public Optional<List<TextRegion>> getTextRegions() { return Optional.ofNullable(textRegions); }
}
