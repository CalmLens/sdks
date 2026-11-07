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
  /** {@code viewer-claims/invalid} (HTTP 400). */
  public static final String INVALID_VIEWER_CLAIMS = "viewer-claims/invalid";
  /** {@code viewer/age-confirmation-required} (HTTP 403). */
  public static final String AGE_CONFIRMATION_REQUIRED = "viewer/age-confirmation-required";
  /** {@code viewer-region/invalid} (HTTP 400). */
  public static final String INVALID_VIEWER_REGION = "viewer-region/invalid";
  /** {@code viewer/region-required} (HTTP 403). */
  public static final String VIEWER_REGION_REQUIRED = "viewer/region-required";
  /** {@code asset/regional-evidence-required} (HTTP 403). */
  public static final String REGIONAL_EVIDENCE_REQUIRED = "asset/regional-evidence-required";
  /** {@code signed-url/expired} (HTTP 403). */
  public static final String SIGNED_URL_EXPIRED = "signed-url/expired";
  /** {@code signed-url/invalid} (HTTP 403). */
  public static final String SIGNED_URL_INVALID = "signed-url/invalid";
  /** {@code signed-url/original-not-granted} (HTTP 403). */
  public static final String SIGNED_URL_ORIGINAL_NOT_GRANTED = "signed-url/original-not-granted";
  /** {@code validation/invalid-request} (HTTP 400). */
  public static final String INVALID_REQUEST = "validation/invalid-request";
  /** {@code validation/invalid-type} (HTTP 400). */
  public static final String INVALID_TYPE = "validation/invalid-type";
  /** {@code validation/too-small} (HTTP 400). */
  public static final String TOO_SMALL = "validation/too-small";
  /** {@code validation/too-big} (HTTP 400). */
  public static final String TOO_BIG = "validation/too-big";
  /** {@code validation/invalid-format} (HTTP 400). */
  public static final String INVALID_FORMAT = "validation/invalid-format";
  /** {@code validation/invalid-value} (HTTP 400). */
  public static final String INVALID_VALUE = "validation/invalid-value";
  /** {@code validation/unknown-field} (HTTP 400). */
  public static final String UNKNOWN_FIELD = "validation/unknown-field";
  /** {@code request/unsupported-content-type} (HTTP 415). */
  public static final String UNSUPPORTED_CONTENT_TYPE = "request/unsupported-content-type";
  /** {@code filter/invalid} (HTTP 400). */
  public static final String INVALID_FILTER = "filter/invalid";
  /** {@code ordering/unsupported-field} (HTTP 400). */
  public static final String UNSUPPORTED_ORDERING_FIELD = "ordering/unsupported-field";
  /** {@code request/route-not-found} (HTTP 404). */
  public static final String ROUTE_NOT_FOUND = "request/route-not-found";
  /** {@code server/internal-error} (HTTP 500). */
  public static final String INTERNAL_ERROR = "server/internal-error";
  /** {@code auth/unauthenticated} (HTTP 401). */
  public static final String UNAUTHENTICATED = "auth/unauthenticated";
  /** {@code session-token/expired} (HTTP 401). */
  public static final String TOKEN_EXPIRED = "session-token/expired";
  /** {@code session-token/invalid} (HTTP 401). */
  public static final String INVALID_TOKEN = "session-token/invalid";
  /** {@code search/unavailable} (HTTP 503). */
  public static final String SEARCH_UNAVAILABLE = "search/unavailable";
  /** {@code transform/invalid} (HTTP 400). */
  public static final String INVALID_TRANSFORM = "transform/invalid";
  /** {@code transform-options/invalid} (HTTP 400). */
  public static final String INVALID_TRANSFORM_OPTIONS = "transform-options/invalid";
  /** {@code remote-url/too-many-redirects} (HTTP 400). */
  public static final String REMOTE_URL_TOO_MANY_REDIRECTS = "remote-url/too-many-redirects";
  /** {@code cursor/invalid} (HTTP 400). */
  public static final String INVALID_CURSOR = "cursor/invalid";
  /** {@code api-key/missing} (HTTP 401). */
  public static final String MISSING_API_KEY = "api-key/missing";
  /** {@code api-key/invalid} (HTTP 401). */
  public static final String INVALID_API_KEY = "api-key/invalid";
  /** {@code api-key/project-mismatch} (HTTP 403). */
  public static final String API_KEY_PROJECT_MISMATCH = "api-key/project-mismatch";
  /** {@code api-key/not-accepted} (HTTP 403). */
  public static final String API_KEY_NOT_ACCEPTED = "api-key/not-accepted";
  /** {@code auth/permission-denied} (HTTP 403). */
  public static final String PERMISSION_DENIED = "auth/permission-denied";
  /** {@code upload/too-large} (HTTP 413). */
  public static final String UPLOAD_TOO_LARGE = "upload/too-large";
  /** {@code document/too-many-items} (HTTP 422). */
  public static final String DOCUMENT_TOO_MANY_ITEMS = "document/too-many-items";
  /** {@code image/invalid} (HTTP 422). */
  public static final String INVALID_IMAGE = "image/invalid";
  /** {@code image/too-large} (HTTP 422). */
  public static final String IMAGE_TOO_LARGE = "image/too-large";
  /** {@code usage/free-uploads-exhausted} (HTTP 403). */
  public static final String FREE_UPLOADS_EXHAUSTED = "usage/free-uploads-exhausted";
  /** {@code usage/uploads-paused} (HTTP 402). */
  public static final String UPLOADS_PAUSED = "usage/uploads-paused";
  /** {@code upload/unsupported-type} (HTTP 415). */
  public static final String UNSUPPORTED_UPLOAD_TYPE = "upload/unsupported-type";
  /** {@code upload-payload/invalid} (HTTP 400). */
  public static final String INVALID_UPLOAD_PAYLOAD = "upload-payload/invalid";
  /** {@code upload/use-upload-part} (HTTP 409). */
  public static final String USE_UPLOAD_PART = "upload/use-upload-part";
  /** {@code upload/not-open} (HTTP 409). */
  public static final String UPLOAD_NOT_OPEN = "upload/not-open";
  /** {@code upload-part/invalid-number} (HTTP 409). */
  public static final String INVALID_UPLOAD_PART_NUMBER = "upload-part/invalid-number";
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
  /** {@code asset/no-rendered-version} (HTTP 404). */
  public static final String NO_RENDERED_VERSION = "asset/no-rendered-version";
  /** {@code asset/not-found} (HTTP 404). */
  public static final String ASSET_NOT_FOUND = "asset/not-found";
  /** {@code asset/child-not-deletable} (HTTP 409). */
  public static final String ASSET_CHILD_NOT_DELETABLE = "asset/child-not-deletable";
  /** {@code project/not-found} (HTTP 404). */
  public static final String PROJECT_NOT_FOUND = "project/not-found";
  /** {@code asset/review-changed} (HTTP 409). */
  public static final String ASSET_REVIEW_CHANGED = "asset/review-changed";
  /** {@code asset/review-note-required} (HTTP 400). */
  public static final String ASSET_REVIEW_NOTE_REQUIRED = "asset/review-note-required";
  /** {@code asset/update-failed} (HTTP 500). */
  public static final String ASSET_UPDATE_FAILED = "asset/update-failed";
  /** {@code asset/held} (HTTP 423). */
  public static final String ASSET_HELD = "asset/held";
  /** {@code asset/processing} (HTTP 409). */
  public static final String ASSET_PROCESSING = "asset/processing";
  /** {@code asset/decision-not-allowed} (HTTP 409). */
  public static final String ASSET_DECISION_NOT_ALLOWED = "asset/decision-not-allowed";
  /** {@code asset/decision-unchanged} (HTTP 409). */
  public static final String ASSET_DECISION_UNCHANGED = "asset/decision-unchanged";
  /** {@code asset/not-retryable} (HTTP 409). */
  public static final String ASSET_NOT_RETRYABLE = "asset/not-retryable";
  /** {@code asset/content-unavailable} (HTTP 409). */
  public static final String ASSET_CONTENT_UNAVAILABLE = "asset/content-unavailable";
  /** {@code asset/content-purged} (HTTP 409). */
  public static final String ASSET_CONTENT_PURGED = "asset/content-purged";
  /** {@code asset/not-decided} (HTTP 409). */
  public static final String ASSET_NOT_DECIDED = "asset/not-decided";
  /** {@code asset/policy-changed} (HTTP 409). */
  public static final String ASSET_POLICY_CHANGED = "asset/policy-changed";
  /** {@code asset/reviewed} (HTTP 409). */
  public static final String ASSET_REVIEWED = "asset/reviewed";
  /** {@code support-ticket/not-found} (HTTP 404). */
  public static final String SUPPORT_TICKET_NOT_FOUND = "support-ticket/not-found";
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
  /** {@code lens/not-found} (HTTP 404). */
  public static final String LENS_NOT_FOUND = "lens/not-found";
  /** {@code lens/identifier-taken} (HTTP 409). */
  public static final String LENS_IDENTIFIER_TAKEN = "lens/identifier-taken";
  /** {@code lens/identifier-reserved} (HTTP 409). */
  public static final String LENS_IDENTIFIER_RESERVED = "lens/identifier-reserved";
  /** {@code hash-list/not-found} (HTTP 404). */
  public static final String HASH_LIST_NOT_FOUND = "hash-list/not-found";
  /** {@code hash-list-entry/not-found} (HTTP 404). */
  public static final String HASH_LIST_ENTRY_NOT_FOUND = "hash-list-entry/not-found";
  /** {@code hash-list/limit-reached} (HTTP 409). */
  public static final String HASH_LIST_LIMIT_REACHED = "hash-list/limit-reached";
  /** {@code hash-list-entry/limit-reached} (HTTP 409). */
  public static final String HASH_LIST_ENTRY_LIMIT_REACHED = "hash-list-entry/limit-reached";
  /** {@code hash-list/asset-not-hashed} (HTTP 409). */
  public static final String HASH_LIST_ASSET_NOT_HASHED = "hash-list/asset-not-hashed";
  /** {@code policy/not-found} (HTTP 404). */
  public static final String POLICY_NOT_FOUND = "policy/not-found";
  /** {@code policy/revision-conflict} (HTTP 409). */
  public static final String POLICY_REVISION_CONFLICT = "policy/revision-conflict";
  /** {@code policy/projects-changed} (HTTP 409). */
  public static final String POLICY_PROJECTS_CHANGED = "policy/projects-changed";
  /** {@code policy/in-use} (HTTP 409). */
  public static final String POLICY_IN_USE = "policy/in-use";
  /** {@code policy/used-by-another-project} (HTTP 409). */
  public static final String POLICY_USED_BY_ANOTHER_PROJECT = "policy/used-by-another-project";
  /** {@code policy/no-preset} (HTTP 400). */
  public static final String POLICY_NO_PRESET = "policy/no-preset";
  /** {@code policy/preset-version-conflict} (HTTP 409). */
  public static final String POLICY_PRESET_VERSION_CONFLICT = "policy/preset-version-conflict";
  /** {@code policy/preset-update-unavailable} (HTTP 409). */
  public static final String POLICY_PRESET_UPDATE_UNAVAILABLE = "policy/preset-update-unavailable";
  /** {@code policy/automatic-updates-unavailable} (HTTP 409). */
  public static final String POLICY_AUTOMATIC_UPDATES_UNAVAILABLE = "policy/automatic-updates-unavailable";
  /** {@code upload-preset/not-found} (HTTP 404). */
  public static final String UPLOAD_PRESET_NOT_FOUND = "upload-preset/not-found";
  /** {@code upload-preset/disabled} (HTTP 403). */
  public static final String UPLOAD_PRESET_DISABLED = "upload-preset/disabled";
  /** {@code upload-preset/token-required} (HTTP 401). */
  public static final String UPLOAD_PRESET_TOKEN_REQUIRED = "upload-preset/token-required";
  /** {@code remote-url/not-allowed} (HTTP 403). */
  public static final String REMOTE_URL_NOT_ALLOWED = "remote-url/not-allowed";
  /** {@code upload/website-rate-limit-reached} (HTTP 429). */
  public static final String WEBSITE_RATE_LIMIT_REACHED = "upload/website-rate-limit-reached";
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
  /** {@code remote-url/invalid} (HTTP 400). */
  public static final String INVALID_REMOTE_URL = "remote-url/invalid";
  /** {@code remote-url/unavailable} (HTTP 422). */
  public static final String REMOTE_URL_UNAVAILABLE = "remote-url/unavailable";
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
      Map.entry(INVALID_VIEWER_CLAIMS, 400),
      Map.entry(AGE_CONFIRMATION_REQUIRED, 403),
      Map.entry(INVALID_VIEWER_REGION, 400),
      Map.entry(VIEWER_REGION_REQUIRED, 403),
      Map.entry(REGIONAL_EVIDENCE_REQUIRED, 403),
      Map.entry(SIGNED_URL_EXPIRED, 403),
      Map.entry(SIGNED_URL_INVALID, 403),
      Map.entry(SIGNED_URL_ORIGINAL_NOT_GRANTED, 403),
      Map.entry(INVALID_REQUEST, 400),
      Map.entry(INVALID_TYPE, 400),
      Map.entry(TOO_SMALL, 400),
      Map.entry(TOO_BIG, 400),
      Map.entry(INVALID_FORMAT, 400),
      Map.entry(INVALID_VALUE, 400),
      Map.entry(UNKNOWN_FIELD, 400),
      Map.entry(UNSUPPORTED_CONTENT_TYPE, 415),
      Map.entry(INVALID_FILTER, 400),
      Map.entry(UNSUPPORTED_ORDERING_FIELD, 400),
      Map.entry(ROUTE_NOT_FOUND, 404),
      Map.entry(INTERNAL_ERROR, 500),
      Map.entry(UNAUTHENTICATED, 401),
      Map.entry(TOKEN_EXPIRED, 401),
      Map.entry(INVALID_TOKEN, 401),
      Map.entry(SEARCH_UNAVAILABLE, 503),
      Map.entry(INVALID_TRANSFORM, 400),
      Map.entry(INVALID_TRANSFORM_OPTIONS, 400),
      Map.entry(REMOTE_URL_TOO_MANY_REDIRECTS, 400),
      Map.entry(INVALID_CURSOR, 400),
      Map.entry(MISSING_API_KEY, 401),
      Map.entry(INVALID_API_KEY, 401),
      Map.entry(API_KEY_PROJECT_MISMATCH, 403),
      Map.entry(API_KEY_NOT_ACCEPTED, 403),
      Map.entry(PERMISSION_DENIED, 403),
      Map.entry(UPLOAD_TOO_LARGE, 413),
      Map.entry(INVALID_IMAGE, 422),
      Map.entry(IMAGE_TOO_LARGE, 422),
      Map.entry(DOCUMENT_TOO_MANY_ITEMS, 422),
      Map.entry(FREE_UPLOADS_EXHAUSTED, 403),
      Map.entry(UPLOADS_PAUSED, 402),
      Map.entry(UNSUPPORTED_UPLOAD_TYPE, 415),
      Map.entry(INVALID_UPLOAD_PAYLOAD, 400),
      Map.entry(USE_UPLOAD_PART, 409),
      Map.entry(UPLOAD_NOT_OPEN, 409),
      Map.entry(INVALID_UPLOAD_PART_NUMBER, 409),
      Map.entry(UPLOAD_MISSING, 409),
      Map.entry(UPLOAD_SIZE_MISMATCH, 400),
      Map.entry(INVALID_IDEMPOTENCY_KEY, 400),
      Map.entry(IDEMPOTENCY_KEY_REUSED, 409),
      Map.entry(IDEMPOTENT_REQUEST_IN_PROGRESS, 409),
      Map.entry(NO_RENDERED_VERSION, 404),
      Map.entry(ASSET_NOT_FOUND, 404),
      Map.entry(ASSET_CHILD_NOT_DELETABLE, 409),
      Map.entry(PROJECT_NOT_FOUND, 404),
      Map.entry(ASSET_REVIEW_CHANGED, 409),
      Map.entry(ASSET_REVIEW_NOTE_REQUIRED, 400),
      Map.entry(ASSET_UPDATE_FAILED, 500),
      Map.entry(ASSET_HELD, 423),
      Map.entry(ASSET_PROCESSING, 409),
      Map.entry(ASSET_DECISION_NOT_ALLOWED, 409),
      Map.entry(ASSET_DECISION_UNCHANGED, 409),
      Map.entry(ASSET_NOT_RETRYABLE, 409),
      Map.entry(ASSET_CONTENT_UNAVAILABLE, 409),
      Map.entry(ASSET_CONTENT_PURGED, 409),
      Map.entry(ASSET_NOT_DECIDED, 409),
      Map.entry(ASSET_POLICY_CHANGED, 409),
      Map.entry(ASSET_REVIEWED, 409),
      Map.entry(SUPPORT_TICKET_NOT_FOUND, 404),
      Map.entry(DUPLICATE_EXTERNAL_ID, 409),
      Map.entry(FOLDER_NOT_FOUND, 404),
      Map.entry(DUPLICATE_FOLDER_NAME, 409),
      Map.entry(FOLDER_NOT_EMPTY, 409),
      Map.entry(FOLDER_PARENT_CYCLE, 409),
      Map.entry(LENS_NOT_FOUND, 404),
      Map.entry(LENS_IDENTIFIER_TAKEN, 409),
      Map.entry(LENS_IDENTIFIER_RESERVED, 409),
      Map.entry(HASH_LIST_NOT_FOUND, 404),
      Map.entry(HASH_LIST_ENTRY_NOT_FOUND, 404),
      Map.entry(HASH_LIST_LIMIT_REACHED, 409),
      Map.entry(HASH_LIST_ENTRY_LIMIT_REACHED, 409),
      Map.entry(HASH_LIST_ASSET_NOT_HASHED, 409),
      Map.entry(POLICY_NOT_FOUND, 404),
      Map.entry(POLICY_REVISION_CONFLICT, 409),
      Map.entry(POLICY_PROJECTS_CHANGED, 409),
      Map.entry(POLICY_IN_USE, 409),
      Map.entry(POLICY_USED_BY_ANOTHER_PROJECT, 409),
      Map.entry(POLICY_NO_PRESET, 400),
      Map.entry(POLICY_PRESET_VERSION_CONFLICT, 409),
      Map.entry(POLICY_PRESET_UPDATE_UNAVAILABLE, 409),
      Map.entry(POLICY_AUTOMATIC_UPDATES_UNAVAILABLE, 409),
      Map.entry(UPLOAD_PRESET_NOT_FOUND, 404),
      Map.entry(UPLOAD_PRESET_DISABLED, 403),
      Map.entry(UPLOAD_PRESET_TOKEN_REQUIRED, 401),
      Map.entry(REMOTE_URL_NOT_ALLOWED, 403),
      Map.entry(WEBSITE_RATE_LIMIT_REACHED, 429),
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
