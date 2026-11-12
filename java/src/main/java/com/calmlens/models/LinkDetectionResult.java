package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * A link detection result. {@code qrCodes} and {@code links} are set only for {@code
 * evaluated}; {@code reason} only for {@code not-evaluated}.
 */
public final class LinkDetectionResult extends CalmLensObject {
  @Required private EvaluationStatus status;
  private FeatureNotEvaluatedReason reason;
  private List<DetectedQrCode> qrCodes;
  private List<DetectedLink> links;

  private LinkDetectionResult() {}

  /** @return {@code evaluated} or {@code not-evaluated} */
  public EvaluationStatus getStatus() { return required(status, "status"); }

  /** @return why the feature was not evaluated: {@code not-supported}, {@code unavailable} or {@code in-children}; empty when the API sends none */
  public Optional<FeatureNotEvaluatedReason> getReason() { return Optional.ofNullable(reason); }

  /** @return QR codes found in the image; empty when the API sends none */
  public Optional<List<DetectedQrCode>> getQrCodes() { return Optional.ofNullable(qrCodes); }

  /** @return links found in QR codes and text; empty when the API sends none */
  public Optional<List<DetectedLink>> getLinks() { return Optional.ofNullable(links); }
}
