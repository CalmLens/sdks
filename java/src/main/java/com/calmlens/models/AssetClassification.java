package com.calmlens.models;

import com.calmlens.internal.Json.EpochMillis;
import com.calmlens.internal.Required;
import com.google.gson.annotations.JsonAdapter;
import java.time.Instant;
import java.util.Optional;

/**
 * Classification progress and results grouped by capability.
 */
public final class AssetClassification extends CalmLensObject {
  @Required private AssetClassificationStatus status;
  private AssetFailureReason failureReason;
  private ClassificationProgress progress;
  @JsonAdapter(EpochMillis.class) private Instant updatedAt;
  @JsonAdapter(EpochMillis.class) private Instant completedAt;
  @Required private Boolean testInput;
  @Required private AssetModeration moderation;
  private OcrResult ocr;
  private PersonDetectionResult personDetection;
  private FaceDetectionResult faceDetection;
  private LinkDetectionResult linkDetection;
  private LinkSafetyResult linkSafety;
  private AiGeneratedDetectionResult aiGeneratedDetection;

  private AssetClassification() {}

  /** @return classification progress */
  public AssetClassificationStatus getStatus() { return required(status, "status"); }

  /** @return why processing failed: {@code file-too-large}, {@code duration-limit}, {@code resolution-limit}, {@code unsupported-format}, {@code undecodable-content}, {@code multiple-tracks}, {@code type-mismatch}, {@code free-uploads-exhausted}, {@code media-limit}, {@code uploads-paused}, {@code too-many-items} or {@code processing-error}; null unless {@code status} is {@code failed}; empty when the API sends none */
  public Optional<AssetFailureReason> getFailureReason() { return Optional.ofNullable(failureReason); }

  /** @return how far analysis of a long audio or video asset has got, section by section; null when it isn't analysed in sections; empty when the API sends none */
  public Optional<ClassificationProgress> getProgress() { return Optional.ofNullable(progress); }

  /** @return when classification state last changed; empty when the API sends none */
  public Optional<Instant> getUpdatedAt() { return Optional.ofNullable(updatedAt); }

  /** @return when classification finished; empty when the API sends none */
  public Optional<Instant> getCompletedAt() { return Optional.ofNullable(completedAt); }

  /** @return whether the results came from one of the project's test inputs rather than analysing the content; never use test results, such as age ranges, for real decisions */
  public boolean getTestInput() { return required(testInput, "testInput"); }

  /** @return safety findings and decisions */
  public AssetModeration getModeration() { return required(moderation, "moderation"); }

  /** @return text found in the image; null until OCR has run, and when it wasn't requested. For a document or website, {@code not-evaluated} with reason {@code in-children}: each of its images is a child asset with its own result ({@code assets().listChildren}); empty when the API sends none */
  public Optional<OcrResult> getOcr() { return Optional.ofNullable(ocr); }

  /** @return person detection result; null until it has run; empty when the API sends none */
  public Optional<PersonDetectionResult> getPersonDetection() { return Optional.ofNullable(personDetection); }

  /** @return face detection result; null until it has run; empty when the API sends none */
  public Optional<FaceDetectionResult> getFaceDetection() { return Optional.ofNullable(faceDetection); }

  /** @return link detection result; null until it has run; empty when the API sends none */
  public Optional<LinkDetectionResult> getLinkDetection() { return Optional.ofNullable(linkDetection); }

  // NOTE: no facts (not in types.json)
  /** @return (preview) where the asset's links lead and their verdicts; set when the project's policy acts on links; empty when the API sends none */
  public Optional<LinkSafetyResult> getLinkSafety() { return Optional.ofNullable(linkSafety); }

  // NOTE: no facts (not in types.json)
  /** @return generated-content detection result; null until it has run; empty when the API sends none */
  public Optional<AiGeneratedDetectionResult> getAiGeneratedDetection() { return Optional.ofNullable(aiGeneratedDetection); }
}
