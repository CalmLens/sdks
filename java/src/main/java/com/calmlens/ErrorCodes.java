package com.calmlens;

import java.util.Map;
import java.util.Optional;

/**
 * Stable error codes. API codes match the CalmLens public API (packages/shared/src/PublicErrorCodes.ts,
 * checked against testdata/errors.json); {@code sdk/*} codes are raised by this SDK itself. Compare
 * {@link CalmLensException#getCode()} with these constants instead of matching messages.
 */
public final class ErrorCodes {
  private ErrorCodes() {}
  /** Invalid viewer assertions (HTTP 400). */
  public static final String INVALID_VIEWER_CLAIMS = "viewer/invalid-claims";
  /** Age-restricted delivery needs confirmation (HTTP 403). */
  public static final String AGE_CONFIRMATION_REQUIRED = "viewer/age-confirmation-required";

  /** {@code validation/invalid-cursor} (HTTP 400). */
  public static final String INVALID_CURSOR = "validation/invalid-cursor";

  /** {@code auth/missing-token} (HTTP 401). */
  public static final String MISSING_TOKEN = "auth/missing-token";
  /** {@code auth/invalid-api-key} (HTTP 401). */
  public static final String INVALID_API_KEY = "auth/invalid-api-key";
  /** {@code auth/project-mismatch} (HTTP 403). */
  public static final String API_KEY_PROJECT_MISMATCH = "auth/project-mismatch";
  /** {@code auth/api-key-not-accepted} (HTTP 403). */
  public static final String API_KEY_NOT_ACCEPTED = "auth/api-key-not-accepted";
  /** {@code auth/permission-denied} (HTTP 403). */
  public static final String PERMISSION_DENIED = "auth/permission-denied";
  /** {@code upload/file-too-large} (HTTP 400). */
  public static final String FILE_TOO_LARGE = "upload/file-too-large";
  /** {@code upload/image-requires-multipart-upload} (HTTP 400). */
  public static final String IMAGE_REQUIRES_MULTIPART_UPLOAD = "upload/image-requires-multipart-upload";
  /** {@code upload/multipart-image-too-small} (HTTP 400). */
  public static final String MULTIPART_IMAGE_TOO_SMALL = "upload/multipart-image-too-small";
  /** {@code upload/multipart-image-too-large} (HTTP 400). */
  public static final String MULTIPART_IMAGE_TOO_LARGE = "upload/multipart-image-too-large";
  /** {@code upload/image-exceeded-max-dimensions} (HTTP 400). */
  public static final String IMAGE_EXCEEDED_MAX_DIMENSIONS = "upload/image-exceeded-max-dimensions";
  /** {@code upload/limit-exceeded} (HTTP 403). */
  public static final String UPLOAD_LIMIT_EXCEEDED = "upload/limit-exceeded";
  /** {@code upload/spend-limit-reached} (HTTP 402). */
  public static final String SPEND_LIMIT_REACHED = "upload/spend-limit-reached";
  /** {@code upload/invalid-mime-type} (HTTP 400). */
  public static final String INVALID_UPLOAD_MIME_TYPE = "upload/invalid-mime-type";
  /** {@code events/invalid-cursor} (HTTP 400). */
  public static final String INVALID_EVENT_CURSOR = "events/invalid-cursor";
  /** {@code upload/invalid-payload} (HTTP 400). */
  public static final String INVALID_UPLOAD_PAYLOAD = "upload/invalid-payload";
  /** {@code upload/use-upload-part} (HTTP 409). */
  public static final String USE_UPLOAD_PART = "upload/use-upload-part";
  /** {@code upload/not-open} (HTTP 409). */
  public static final String UPLOAD_NOT_OPEN = "upload/not-open";
  /** {@code upload/invalid-part-number} (HTTP 409). */
  public static final String INVALID_UPLOAD_PART_NUMBER = "upload/invalid-part-number";
  /** {@code upload/missing} (HTTP 409). */
  public static final String UPLOAD_MISSING = "upload/missing";
  /** {@code upload/size-mismatch} (HTTP 400). */
  public static final String UPLOAD_SIZE_MISMATCH = "upload/size-mismatch";
  /** {@code idempotency/invalid-key} (HTTP 400). */
  public static final String INVALID_IDEMPOTENCY_KEY = "idempotency/invalid-key";
  /** {@code idempotency/key-reused} (HTTP 409). */
  public static final String IDEMPOTENCY_KEY_REUSED = "idempotency/key-reused";
  /** {@code idempotency/request-in-progress} (HTTP 409). */
  public static final String IDEMPOTENT_REQUEST_IN_PROGRESS = "idempotency/request-in-progress";
  /** {@code asset/not-found} (HTTP 404). */
  public static final String ASSET_NOT_FOUND = "asset/not-found";
  /** {@code project/not-found} (HTTP 404). */
  public static final String PROJECT_NOT_FOUND = "project/not-found";
  /** {@code asset/review-changed} (HTTP 409). */
  public static final String ASSET_REVIEW_CHANGED = "asset/review-changed";
  /** {@code asset/review-note-required} (HTTP 400). */
  public static final String ASSET_REVIEW_NOTE_REQUIRED = "asset/review-note-required";
  /** {@code asset/update-failed} (HTTP 500). */
  public static final String ASSET_UPDATE_FAILED = "asset/update-failed";
  /** {@code asset/safety-held} (HTTP 423). */
  public static final String ASSET_SAFETY_HELD = "asset/safety-held";
  /** {@code asset/not-retryable} (HTTP 409). */
  public static final String ASSET_NOT_RETRYABLE = "asset/not-retryable";
  /** {@code asset/content-unavailable} (HTTP 409). */
  public static final String ASSET_CONTENT_UNAVAILABLE = "asset/content-unavailable";
  /** {@code asset/not-decided} (HTTP 409). */
  public static final String ASSET_NOT_DECIDED = "asset/not-decided";
  /** {@code asset/policy-changed} (HTTP 409). */
  public static final String ASSET_POLICY_CHANGED = "asset/policy-changed";
  /** {@code asset/reviewed} (HTTP 409). */
  public static final String ASSET_REVIEWED = "asset/reviewed";
  /** {@code support/ticket-not-found} (HTTP 404). */
  public static final String SUPPORT_TICKET_NOT_FOUND = "support/ticket-not-found";
  /** {@code asset/duplicate-external-id} (HTTP 409). */
  public static final String DUPLICATE_EXTERNAL_ID = "asset/duplicate-external-id";
  /** {@code folder/not-found} (HTTP 404). */
  public static final String FOLDER_NOT_FOUND = "folder/not-found";
  /** {@code folder/duplicate-name} (HTTP 409). */
  public static final String DUPLICATE_FOLDER_NAME = "folder/duplicate-name";
  /** {@code folder/not-empty} (HTTP 409). */
  public static final String FOLDER_NOT_EMPTY = "folder/not-empty";
  /** {@code folder/parent-cycle} (HTTP 409). */
  public static final String FOLDER_PARENT_CYCLE = "folder/parent-cycle";
  /** {@code lens/version-conflict} (HTTP 409). */
  public static final String LENS_VERSION_CONFLICT = "lens/version-conflict";
  /** {@code viewer/invalid-region} (HTTP 400). */
  public static final String INVALID_VIEWER_REGION = "viewer/invalid-region";
  /** {@code viewer/region-required} (HTTP 403). */
  public static final String VIEWER_REGION_REQUIRED = "viewer/region-required";
  /** {@code asset/regional-evidence-required} (HTTP 403). */
  public static final String REGIONAL_EVIDENCE_REQUIRED = "asset/regional-evidence-required";
  /** {@code hash-list/not-found} (HTTP 404). */
  public static final String HASH_LIST_NOT_FOUND = "hash-list/not-found";
  /** {@code hash-list/entry-not-found} (HTTP 404). */
  public static final String HASH_LIST_ENTRY_NOT_FOUND = "hash-list/entry-not-found";
  /** {@code hash-list/limit-reached} (HTTP 409). */
  public static final String HASH_LIST_LIMIT_REACHED = "hash-list/limit-reached";
  /** {@code hash-list/entry-limit-reached} (HTTP 409). */
  public static final String HASH_LIST_ENTRY_LIMIT_REACHED = "hash-list/entry-limit-reached";
  /** {@code hash-list/asset-not-hashed} (HTTP 409). */
  public static final String HASH_LIST_ASSET_NOT_HASHED = "hash-list/asset-not-hashed";
  /** {@code upload-preset/not-found} (HTTP 404). */
  public static final String UPLOAD_PRESET_NOT_FOUND = "upload-preset/not-found";
  /** {@code upload-preset/disabled} (HTTP 403). */
  public static final String UPLOAD_PRESET_DISABLED = "upload-preset/disabled";
  /** {@code upload-preset/token-required} (HTTP 401). */
  public static final String UPLOAD_PRESET_TOKEN_REQUIRED = "upload-preset/token-required";
  /** {@code upload/remote-url-not-allowed} (HTTP 403). */
  public static final String REMOTE_URL_NOT_ALLOWED = "upload/remote-url-not-allowed";
  /** {@code upload/website-rate-limit-exceeded} (HTTP 429). */
  public static final String WEBSITE_RATE_LIMIT_EXCEEDED = "upload/website-rate-limit-exceeded";
  /** {@code upload-preset/content-type-not-allowed} (HTTP 415). */
  public static final String UPLOAD_PRESET_CONTENT_TYPE_NOT_ALLOWED = "upload-preset/content-type-not-allowed";
  /** {@code upload-preset/too-large} (HTTP 413). */
  public static final String UPLOAD_PRESET_TOO_LARGE = "upload-preset/too-large";
  /** {@code upload-preset/daily-limit-reached} (HTTP 429). */
  public static final String UPLOAD_PRESET_DAILY_LIMIT_REACHED = "upload-preset/daily-limit-reached";
  /** {@code upload-preset/origin-not-allowed} (HTTP 403). */
  public static final String UPLOAD_PRESET_ORIGIN_NOT_ALLOWED = "upload-preset/origin-not-allowed";
  /** {@code upload-preset/field-not-allowed} (HTTP 400). */
  public static final String UPLOAD_PRESET_FIELD_NOT_ALLOWED = "upload-preset/field-not-allowed";
  /** {@code upload-token/invalid} (HTTP 401). */
  public static final String UPLOAD_TOKEN_INVALID = "upload-token/invalid";
  /** {@code upload-token/expired} (HTTP 401). */
  public static final String UPLOAD_TOKEN_EXPIRED = "upload-token/expired";
  /** {@code upload-token/used} (HTTP 409). */
  public static final String UPLOAD_TOKEN_USED = "upload-token/used";
  /** {@code asset/invalid-remote-url} (HTTP 400). */
  public static final String INVALID_REMOTE_URL = "asset/invalid-remote-url";
  /** {@code asset/remote-url-unavailable} (HTTP 422). */
  public static final String REMOTE_URL_UNAVAILABLE = "asset/remote-url-unavailable";
  /** {@code appeal/not-found} (HTTP 404). */
  public static final String APPEAL_NOT_FOUND = "appeal/not-found";
  /** {@code appeal/judgment-not-found} (HTTP 404). */
  public static final String APPEAL_JUDGMENT_NOT_FOUND = "appeal/judgment-not-found";
  /** {@code appeal/asset-not-found} (HTTP 404). */
  public static final String APPEAL_ASSET_NOT_FOUND = "appeal/asset-not-found";
  /** {@code appeal/permission-denied} (HTTP 403). */
  public static final String APPEAL_PERMISSION_DENIED = "appeal/permission-denied";
  /** {@code appeal/already-reviewed} (HTTP 409). */
  public static final String APPEAL_ALREADY_REVIEWED = "appeal/already-reviewed";
  /** {@code appeal/decision-changed} (HTTP 409). */
  public static final String APPEAL_DECISION_CHANGED = "appeal/decision-changed";
  /** {@code appeal/invalid-action} (HTTP 400). */
  public static final String APPEAL_INVALID_ACTION = "appeal/invalid-action";
  /** {@code appeal/safety-held} (HTTP 409). */
  public static final String APPEAL_SAFETY_HELD = "appeal/safety-held";
  /** {@code appeal/content-unavailable} (HTTP 409). */
  public static final String APPEAL_CONTENT_UNAVAILABLE = "appeal/content-unavailable";

  /** A request could not be sent or its response could not be read (connection, TLS, protocol). */
  public static final String SDK_TRANSPORT_ERROR = "sdk/transport-error";
  /** A request did not complete within its timeout. */
  public static final String SDK_TIMEOUT = "sdk/timeout";
  /** The calling thread was interrupted while a request was in flight. */
  public static final String SDK_CANCELLED = "sdk/cancelled";
  /** The API answered with a body the SDK could not read as the expected model. */
  public static final String SDK_INVALID_RESPONSE = "sdk/invalid-response";
  /** The API answered with an error status and no CalmLens error body. */
  public static final String SDK_HTTP_ERROR = "sdk/http-error";
  /** A response body exceeded the configured size limit. */
  public static final String SDK_RESPONSE_TOO_LARGE = "sdk/response-too-large";
  /** A method argument is missing or invalid; nothing was sent. */
  public static final String SDK_INVALID_ARGUMENT = "sdk/invalid-argument";
  /** A client option is missing or invalid. */
  public static final String SDK_INVALID_CONFIG = "sdk/invalid-config";
  /** The client was used after {@link CalmLensServerClient#close()}. */
  public static final String SDK_CLIENT_CLOSED = "sdk/client-closed";
  /** A webhook delivery failed signature or timestamp verification. */
  public static final String SDK_INVALID_WEBHOOK_SIGNATURE = "sdk/invalid-webhook-signature";
  /** A verified webhook body is not a CalmLens event. */
  public static final String SDK_INVALID_WEBHOOK_PAYLOAD = "sdk/invalid-webhook-payload";

  private static final Map<String, Integer> STATUSES = Map.ofEntries(
      Map.entry(INVALID_CURSOR, 400),
      Map.entry(INVALID_VIEWER_CLAIMS, 400),
      Map.entry(AGE_CONFIRMATION_REQUIRED, 403),
      Map.entry(MISSING_TOKEN, 401),
      Map.entry(INVALID_API_KEY, 401),
      Map.entry(API_KEY_PROJECT_MISMATCH, 403),
      Map.entry(API_KEY_NOT_ACCEPTED, 403),
      Map.entry(PERMISSION_DENIED, 403),
      Map.entry(FILE_TOO_LARGE, 400),
      Map.entry(IMAGE_REQUIRES_MULTIPART_UPLOAD, 400),
      Map.entry(MULTIPART_IMAGE_TOO_SMALL, 400),
      Map.entry(MULTIPART_IMAGE_TOO_LARGE, 400),
      Map.entry(IMAGE_EXCEEDED_MAX_DIMENSIONS, 400),
      Map.entry(UPLOAD_LIMIT_EXCEEDED, 403),
      Map.entry(SPEND_LIMIT_REACHED, 402),
      Map.entry(INVALID_UPLOAD_MIME_TYPE, 400),
      Map.entry(INVALID_EVENT_CURSOR, 400),
      Map.entry(INVALID_UPLOAD_PAYLOAD, 400),
      Map.entry(USE_UPLOAD_PART, 409),
      Map.entry(UPLOAD_NOT_OPEN, 409),
      Map.entry(INVALID_UPLOAD_PART_NUMBER, 409),
      Map.entry(UPLOAD_MISSING, 409),
      Map.entry(UPLOAD_SIZE_MISMATCH, 400),
      Map.entry(INVALID_IDEMPOTENCY_KEY, 400),
      Map.entry(IDEMPOTENCY_KEY_REUSED, 409),
      Map.entry(IDEMPOTENT_REQUEST_IN_PROGRESS, 409),
      Map.entry(ASSET_NOT_FOUND, 404),
      Map.entry(PROJECT_NOT_FOUND, 404),
      Map.entry(ASSET_REVIEW_CHANGED, 409),
      Map.entry(ASSET_REVIEW_NOTE_REQUIRED, 400),
      Map.entry(ASSET_UPDATE_FAILED, 500),
      Map.entry(ASSET_SAFETY_HELD, 423),
      Map.entry(ASSET_NOT_RETRYABLE, 409),
      Map.entry(ASSET_CONTENT_UNAVAILABLE, 409),
      Map.entry(ASSET_NOT_DECIDED, 409),
      Map.entry(ASSET_POLICY_CHANGED, 409),
      Map.entry(ASSET_REVIEWED, 409),
      Map.entry(SUPPORT_TICKET_NOT_FOUND, 404),
      Map.entry(DUPLICATE_EXTERNAL_ID, 409),
      Map.entry(FOLDER_NOT_FOUND, 404),
      Map.entry(DUPLICATE_FOLDER_NAME, 409),
      Map.entry(FOLDER_NOT_EMPTY, 409),
      Map.entry(FOLDER_PARENT_CYCLE, 409),
      Map.entry(LENS_VERSION_CONFLICT, 409),
      Map.entry(INVALID_VIEWER_REGION, 400),
      Map.entry(VIEWER_REGION_REQUIRED, 403),
      Map.entry(REGIONAL_EVIDENCE_REQUIRED, 403),
      Map.entry(HASH_LIST_NOT_FOUND, 404),
      Map.entry(HASH_LIST_ENTRY_NOT_FOUND, 404),
      Map.entry(HASH_LIST_LIMIT_REACHED, 409),
      Map.entry(HASH_LIST_ENTRY_LIMIT_REACHED, 409),
      Map.entry(HASH_LIST_ASSET_NOT_HASHED, 409),
      Map.entry(UPLOAD_PRESET_NOT_FOUND, 404),
      Map.entry(UPLOAD_PRESET_DISABLED, 403),
      Map.entry(UPLOAD_PRESET_TOKEN_REQUIRED, 401),
      Map.entry(REMOTE_URL_NOT_ALLOWED, 403),
      Map.entry(WEBSITE_RATE_LIMIT_EXCEEDED, 429),
      Map.entry(UPLOAD_PRESET_CONTENT_TYPE_NOT_ALLOWED, 415),
      Map.entry(UPLOAD_PRESET_TOO_LARGE, 413),
      Map.entry(UPLOAD_PRESET_DAILY_LIMIT_REACHED, 429),
      Map.entry(UPLOAD_PRESET_ORIGIN_NOT_ALLOWED, 403),
      Map.entry(UPLOAD_PRESET_FIELD_NOT_ALLOWED, 400),
      Map.entry(UPLOAD_TOKEN_INVALID, 401),
      Map.entry(UPLOAD_TOKEN_EXPIRED, 401),
      Map.entry(UPLOAD_TOKEN_USED, 409),
      Map.entry(INVALID_REMOTE_URL, 400),
      Map.entry(REMOTE_URL_UNAVAILABLE, 422),
      Map.entry(APPEAL_NOT_FOUND, 404),
      Map.entry(APPEAL_JUDGMENT_NOT_FOUND, 404),
      Map.entry(APPEAL_ASSET_NOT_FOUND, 404),
      Map.entry(APPEAL_PERMISSION_DENIED, 403),
      Map.entry(APPEAL_ALREADY_REVIEWED, 409),
      Map.entry(APPEAL_DECISION_CHANGED, 409),
      Map.entry(APPEAL_INVALID_ACTION, 400),
      Map.entry(APPEAL_SAFETY_HELD, 409),
      Map.entry(APPEAL_CONTENT_UNAVAILABLE, 409));

  /**
   * The HTTP status the API returns with a public API error code, or empty for an unknown code and
   * for {@code sdk/*} codes.
   *
   * @param code an error code such as {@link #ASSET_NOT_FOUND}
   * @return the HTTP status for that code
   */
  public static Optional<Integer> httpStatus(String code) {
    return Optional.ofNullable(code == null ? null : STATUSES.get(code));
  }

  /** @return every public API error code with its HTTP status */
  public static Map<String, Integer> apiStatuses() { return STATUSES; }
}
