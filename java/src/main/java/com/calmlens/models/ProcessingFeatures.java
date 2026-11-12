package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * Optional analyses to run on an asset, keyed by feature. Link detection runs unless its {@code
 * enabled} is false; every other feature is off unless its {@code enabled} is true. Results of person, face, link and AI-generated detection appear on {@link
 * AssetClassification}; OCR stores extracted text on the image asset.
 */
public final class ProcessingFeatures extends CalmLensObject {
  private FeatureOptions ocr;
  private FeatureOptions personDetection;
  private FaceDetectionOptions faceDetection;
  private FeatureOptions linkDetection;
  private FeatureOptions aiGeneratedDetection;
  private FeatureOptions streaming;

  private ProcessingFeatures() {}

  /** @return extract text onto the image asset and add text moderation; empty when the API sends none */
  public Optional<FeatureOptions> getOcr() { return Optional.ofNullable(ocr); }

  /** @return (preview) locate people in images; empty when the API sends none */
  public Optional<FeatureOptions> getPersonDetection() { return Optional.ofNullable(personDetection); }

  /** @return (preview) locate faces in images and optionally estimate ages; empty when the API sends none */
  public Optional<FaceDetectionOptions> getFaceDetection() { return Optional.ofNullable(faceDetection); }

  /** @return find QR codes and web links in images and moderate QR code text; on by default; empty when the API sends none */
  public Optional<FeatureOptions> getLinkDetection() { return Optional.ofNullable(linkDetection); }

  // NOTE: no facts (not in types.json)
  /** @return (preview) read the AI provenance metadata images carry; empty when the API sends none */
  public Optional<FeatureOptions> getAiGeneratedDetection() { return Optional.ofNullable(aiGeneratedDetection); }

  /** @return (preview) prepare an adaptive (HLS) stream of audio or video once it is decided and made browser-safe, served at the {@code hls} resource and played by the {@code embed} page; needs {@code retainContent} and is billed per started minute of media. Left null, the project's streaming setting decides; {@code enabled} false turns it off for this upload; empty when the API sends none */
  public Optional<FeatureOptions> getStreaming() { return Optional.ofNullable(streaming); }

}
