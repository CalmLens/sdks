package com.calmlens;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import com.google.gson.TypeAdapter;
import com.google.gson.annotations.JsonAdapter;
import com.google.gson.annotations.SerializedName;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import com.google.gson.stream.JsonWriter;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Request options and response models.
 *
 * <p>Request options ({@link SubmitAsset}, {@link ListAssets}, ...) are small builders: create one,
 * chain the setters you need, and pass it to the client. Unset options are not sent. {@link Patch}
 * fields distinguish "leave unchanged" (unset), {@link Patch#clear()} and {@link Patch#value}.
 *
 * <p>Responses ({@link Asset}, {@link AssetPage}, {@link Event}, ...) are immutable records whose
 * components keep the API's camelCase names. Optional values are null when the API omits them;
 * timestamps are {@link Instant}s. Only metadata values and event fact values, where the API
 * accepts any JSON, are untyped: {@code String}, {@code Long}, {@code Double}, {@code Boolean},
 * {@code List} and {@code Map}. Unknown
 * response fields are ignored, and unknown {@link AssetClassificationStatus}, {@link
 * AssetModerationStatus}, {@link AssetModerationDecision}, {@link AssetContentStatus}, {@link
 * AssetRenderedKind} or {@link Visibility} values keep their raw
 * value instead of failing.
 */
public final class Models {
  private Models() {}

  // ------------------------------------------------------------------ Encoding

  static JsonObject encode(Object value) {
    if (value == null) throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "Options are required");
    JsonElement tree = Json.GSON.toJsonTree(value);
    if (!tree.isJsonObject()) throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "Options must be an object");
    return tree.getAsJsonObject();
  }

  private static String describe(Object value) {
    JsonObject tree = Json.GSON.toJsonTree(value).getAsJsonObject();
    shorten(tree);
    return value.getClass().getSimpleName() + Json.GSON.toJson(tree);
  }

  private static void shorten(JsonElement element) {
    if (element.isJsonObject()) {
      for (var entry : element.getAsJsonObject().entrySet()) {
        JsonElement child = entry.getValue();
        if (child.isJsonPrimitive() && child.getAsJsonPrimitive().isString() && child.getAsString().length() > 120)
          entry.setValue(new JsonPrimitive(child.getAsString().substring(0, 120) + "…(" + child.getAsString().length() + " chars)"));
        else if (child.isJsonArray() && child.getAsJsonArray().size() > 32)
          entry.setValue(new JsonPrimitive("[" + child.getAsJsonArray().size() + " items]"));
        else shorten(child);
      }
    } else if (element.isJsonArray()) element.getAsJsonArray().forEach(Models::shorten);
  }

  private static <T> List<T> list(List<T> value) {
    return value == null ? null : Collections.unmodifiableList(new ArrayList<>(value));
  }

  private static <T> List<T> listOrEmpty(List<T> value) {
    return value == null ? List.of() : Collections.unmodifiableList(new ArrayList<>(value));
  }

  /** A field of a whole definition: null is sent as null, the same as its default. */
  private static <T> Patch<T> patch(T value) { return value == null ? Patch.clear() : Patch.value(value); }

  private static <K, V> Map<K, V> map(Map<K, V> value) {
    return value == null ? null : Collections.unmodifiableMap(new LinkedHashMap<>(value));
  }

  /**
   * One page of a cursor list: pass {@code nextCursor} as the next request's {@code cursor} while
   * {@code hasMore}. The list's {@code iterate} methods do this for you.
   *
   * @param <T> the listed item
   */
  public interface CursorPage<T> {
    /** @return the items on this page */
    List<T> items();
    /** @return the next page's cursor, or null on the last page */
    String nextCursor();
    /** @return whether another page follows */
    boolean hasMore();
  }

  // ------------------------------------------------------------------ Values

  /**
   * Where an asset is in the pipeline ({@code classification.status}). Known values are the constants
   * below and can be compared with {@code ==}; a status this SDK version does not know is kept with
   * its raw {@link #value()} and {@link #isKnown()} returns false.
   */
  @JsonAdapter(AssetClassificationStatus.Adapter.class)
  public static final class AssetClassificationStatus {
    /**
     * Waiting for its content, such as a multipart upload still receiving parts, or for its turn.
     */
    public static final AssetClassificationStatus QUEUED = new AssetClassificationStatus("queued");
    /** Being classified. */
    public static final AssetClassificationStatus PROCESSING = new AssetClassificationStatus("processing");
    /** Processing finished; see {@code classification.moderation.status} for the decision. */
    public static final AssetClassificationStatus COMPLETED = new AssetClassificationStatus("completed");
    /** Processing failed; {@code assets.retry} processes the asset again. */
    public static final AssetClassificationStatus FAILED = new AssetClassificationStatus("failed");
    private static final Map<String, AssetClassificationStatus> KNOWN = Map.of(
        "queued", QUEUED, "processing", PROCESSING, "completed", COMPLETED, "failed", FAILED);
    private final String value;

    private AssetClassificationStatus(String value) { this.value = value; }

    /**
     * @param value the API value, such as {@code "completed"}
     * @return the matching constant, or a new instance keeping an unknown value
     */
    public static AssetClassificationStatus of(String value) {
      AssetClassificationStatus known = KNOWN.get(Objects.requireNonNull(value, "value"));
      return known != null ? known : new AssetClassificationStatus(value);
    }

    /** @return the API value, such as {@code "completed"} */
    public String value() { return value; }

    /** @return whether this SDK version knows the value */
    public boolean isKnown() { return KNOWN.containsKey(value); }

    @Override public boolean equals(Object other) { return other instanceof AssetClassificationStatus status && status.value.equals(value); }
    @Override public int hashCode() { return value.hashCode(); }
    @Override public String toString() { return value; }

    static final class Adapter extends TypeAdapter<AssetClassificationStatus> {
      @Override public void write(JsonWriter out, AssetClassificationStatus status) throws IOException { if (status == null) out.nullValue(); else out.value(status.value); }
      @Override public AssetClassificationStatus read(JsonReader in) throws IOException {
        if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
        return of(in.nextString());
      }
    }
  }

  /**
   * The moderation decision in force ({@code classification.moderation.status}), which also decides
   * delivery: a reviewer's decision when there is one, otherwise the policy's. Unknown values are
   * kept like {@link AssetClassificationStatus}. Show content publicly only when it is {@link
   * #ALLOWED}.
   */
  @JsonAdapter(AssetModerationStatus.Adapter.class)
  public static final class AssetModerationStatus {
    /** No decision yet. */
    public static final AssetModerationStatus PENDING = new AssetModerationStatus("pending");
    /** Delivered to anyone with access. */
    public static final AssetModerationStatus ALLOWED = new AssetModerationStatus("allowed");
    /**
     * Delivered like {@link #ALLOWED}, but marked so your app reduces its reach: keep it out of
     * recommendations, trending and notifications, rank it lower or collapse it.
     */
    public static final AssetModerationStatus LIMITED = new AssetModerationStatus("limited");
    /** Delivered only through signed URLs or API keys, like a private asset; show it only behind your own age gate. */
    public static final AssetModerationStatus AGE_RESTRICTED = new AssetModerationStatus("age-restricted");
    /** Blocked: not delivered; the content is kept. */
    public static final AssetModerationStatus BLOCKED = new AssetModerationStatus("blocked");
    /** Not delivered, and the stored content is deleted. */
    public static final AssetModerationStatus PURGED = new AssetModerationStatus("purged");
    private static final Map<String, AssetModerationStatus> KNOWN = Map.of("pending", PENDING, "allowed", ALLOWED,
        "limited", LIMITED, "age-restricted", AGE_RESTRICTED, "blocked", BLOCKED, "purged", PURGED);
    private final String value;

    private AssetModerationStatus(String value) { this.value = value; }

    /**
     * @param value the API value, such as {@code "allowed"}
     * @return the matching constant, or a new instance keeping an unknown value
     */
    public static AssetModerationStatus of(String value) {
      AssetModerationStatus known = KNOWN.get(Objects.requireNonNull(value, "value"));
      return known != null ? known : new AssetModerationStatus(value);
    }

    /** @return the API value, such as {@code "allowed"} */
    public String value() { return value; }

    /** @return whether this SDK version knows the value */
    public boolean isKnown() { return KNOWN.containsKey(value); }

    @Override public boolean equals(Object other) { return other instanceof AssetModerationStatus status && status.value.equals(value); }
    @Override public int hashCode() { return value.hashCode(); }
    @Override public String toString() { return value; }

    static final class Adapter extends TypeAdapter<AssetModerationStatus> {
      @Override public void write(JsonWriter out, AssetModerationStatus status) throws IOException { if (status == null) out.nullValue(); else out.value(status.value); }
      @Override public AssetModerationStatus read(JsonReader in) throws IOException {
        if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
        return of(in.nextString());
      }
    }
  }

  /**
   * A reviewer's decision in an asset's review history ({@code classification.moderation.manualReviews[].decision}).
   * Unknown values are kept like {@link AssetClassificationStatus}.
   */
  @JsonAdapter(AssetModerationDecision.Adapter.class)
  public static final class AssetModerationDecision {
    /** Deliver to anyone with access. */
    public static final AssetModerationDecision ALLOWED = new AssetModerationDecision("allowed");
    /** Deliver to anyone with access, but mark it so your app reduces its reach. */
    public static final AssetModerationDecision LIMITED = new AssetModerationDecision("limited");
    /** Deliver only through signed URLs or API keys. */
    public static final AssetModerationDecision AGE_RESTRICTED = new AssetModerationDecision("age-restricted");
    /** Don't deliver; keep the content. */
    public static final AssetModerationDecision BLOCKED = new AssetModerationDecision("blocked");
    /** Don't deliver, and delete the stored content. */
    public static final AssetModerationDecision PURGED = new AssetModerationDecision("purged");
    private static final Map<String, AssetModerationDecision> KNOWN = Map.of("allowed", ALLOWED,
        "limited", LIMITED, "age-restricted", AGE_RESTRICTED, "blocked", BLOCKED, "purged", PURGED);
    private final String value;

    private AssetModerationDecision(String value) { this.value = value; }

    /**
     * @param value the API value, such as {@code "blocked"}
     * @return the matching constant, or a new instance keeping an unknown value
     */
    public static AssetModerationDecision of(String value) {
      AssetModerationDecision known = KNOWN.get(Objects.requireNonNull(value, "value"));
      return known != null ? known : new AssetModerationDecision(value);
    }

    /** @return the API value, such as {@code "blocked"} */
    public String value() { return value; }

    /** @return whether this SDK version knows the value */
    public boolean isKnown() { return KNOWN.containsKey(value); }

    @Override public boolean equals(Object other) { return other instanceof AssetModerationDecision decision && decision.value.equals(value); }
    @Override public int hashCode() { return value.hashCode(); }
    @Override public String toString() { return value; }

    static final class Adapter extends TypeAdapter<AssetModerationDecision> {
      @Override public void write(JsonWriter out, AssetModerationDecision decision) throws IOException { if (decision == null) out.nullValue(); else out.value(decision.value); }
      @Override public AssetModerationDecision read(JsonReader in) throws IOException {
        if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
        return of(in.nextString());
      }
    }
  }

  /**
   * Whether CalmLens holds an asset's content ({@code content.status}): its source, preview and
   * extracted text. Unknown values are kept like {@link AssetClassificationStatus}.
   */
  @JsonAdapter(AssetContentStatus.Adapter.class)
  public static final class AssetContentStatus {
    /** Held only until processing finishes. */
    public static final AssetContentStatus TEMPORARY = new AssetContentStatus("temporary");
    /** Retained after processing. */
    public static final AssetContentStatus STORED = new AssetContentStatus("stored");
    /** Deleted; {@code content.removalReason} says why. */
    public static final AssetContentStatus REMOVED = new AssetContentStatus("removed");
    private static final Map<String, AssetContentStatus> KNOWN = Map.of("temporary", TEMPORARY, "stored", STORED, "removed", REMOVED);
    private final String value;

    private AssetContentStatus(String value) { this.value = value; }

    /**
     * @param value the API value, such as {@code "stored"}
     * @return the matching constant, or a new instance keeping an unknown value
     */
    public static AssetContentStatus of(String value) {
      AssetContentStatus known = KNOWN.get(Objects.requireNonNull(value, "value"));
      return known != null ? known : new AssetContentStatus(value);
    }

    /** @return the API value, such as {@code "stored"} */
    public String value() { return value; }

    /** @return whether this SDK version knows the value */
    public boolean isKnown() { return KNOWN.containsKey(value); }

    @Override public boolean equals(Object other) { return other instanceof AssetContentStatus status && status.value.equals(value); }
    @Override public int hashCode() { return value.hashCode(); }
    @Override public String toString() { return value; }

    static final class Adapter extends TypeAdapter<AssetContentStatus> {
      @Override public void write(JsonWriter out, AssetContentStatus status) throws IOException { if (status == null) out.nullValue(); else out.value(status.value); }
      @Override public AssetContentStatus read(JsonReader in) throws IOException {
        if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
        return of(in.nextString());
      }
    }
  }

  /**
   * What an asset's rendered file is ({@code content.rendered.kind}): an image, a PDF, video or
   * audio. Unknown values are kept like {@link AssetClassificationStatus}.
   */
  @JsonAdapter(AssetRenderedKind.Adapter.class)
  public static final class AssetRenderedKind {
    /** A still image; it takes lenses and transforms. */
    public static final AssetRenderedKind IMAGE = new AssetRenderedKind("image");
    /** A PDF. */
    public static final AssetRenderedKind PDF = new AssetRenderedKind("pdf");
    /** Browser-safe video. */
    public static final AssetRenderedKind VIDEO = new AssetRenderedKind("video");
    /** Browser-safe audio. */
    public static final AssetRenderedKind AUDIO = new AssetRenderedKind("audio");
    private static final Map<String, AssetRenderedKind> KNOWN = Map.of("image", IMAGE, "pdf", PDF, "video", VIDEO, "audio", AUDIO);
    private final String value;

    private AssetRenderedKind(String value) { this.value = value; }

    /**
     * @param value the API value, such as {@code "pdf"}
     * @return the matching constant, or a new instance keeping an unknown value
     */
    public static AssetRenderedKind of(String value) {
      AssetRenderedKind known = KNOWN.get(Objects.requireNonNull(value, "value"));
      return known != null ? known : new AssetRenderedKind(value);
    }

    /** @return the API value, such as {@code "pdf"} */
    public String value() { return value; }

    /** @return whether this SDK version knows the value */
    public boolean isKnown() { return KNOWN.containsKey(value); }

    @Override public boolean equals(Object other) { return other instanceof AssetRenderedKind kind && kind.value.equals(value); }
    @Override public int hashCode() { return value.hashCode(); }
    @Override public String toString() { return value; }

    static final class Adapter extends TypeAdapter<AssetRenderedKind> {
      @Override public void write(JsonWriter out, AssetRenderedKind kind) throws IOException { if (kind == null) out.nullValue(); else out.value(kind.value); }
      @Override public AssetRenderedKind read(JsonReader in) throws IOException {
        if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
        return of(in.nextString());
      }
    }
  }

  /** Who can read an asset's content through the CDN. Unknown values are kept like {@link AssetClassificationStatus}. */
  @JsonAdapter(Visibility.Adapter.class)
  public static final class Visibility {
    /** Anyone with the CDN URL. */
    public static final Visibility PUBLIC = new Visibility("public");
    /** Only with the API key or a signed URL. */
    public static final Visibility PRIVATE = new Visibility("private");
    private final String value;

    private Visibility(String value) { this.value = value; }

    /**
     * @param value the API value
     * @return the matching constant, or a new instance keeping an unknown value
     */
    public static Visibility of(String value) {
      return switch (Objects.requireNonNull(value, "value")) {
        case "public" -> PUBLIC;
        case "private" -> PRIVATE;
        default -> new Visibility(value);
      };
    }

    /** @return the API value */
    public String value() { return value; }

    /** @return whether this SDK version knows the value */
    public boolean isKnown() { return this == PUBLIC || this == PRIVATE; }

    @Override public boolean equals(Object other) { return other instanceof Visibility visibility && visibility.value.equals(value); }
    @Override public int hashCode() { return value.hashCode(); }
    @Override public String toString() { return value; }

    static final class Adapter extends TypeAdapter<Visibility> {
      @Override public void write(JsonWriter out, Visibility visibility) throws IOException { if (visibility == null) out.nullValue(); else out.value(visibility.value); }
      @Override public Visibility read(JsonReader in) throws IOException {
        if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
        return of(in.nextString());
      }
    }
  }

  /**
   * An update field: leave it unset to keep the current value, {@link #clear()} to set it to null,
   * or {@link #value(Object)} to replace it.
   *
   * @param <T> the field type
   */
  @JsonAdapter(value = Json.PatchAdapterFactory.class, nullSafe = false)
  public static final class Patch<T> {
    private static final Patch<?> CLEAR = new Patch<>(null);
    private final T value;

    private Patch(T value) { this.value = value; }

    /**
     * @param <T> the field type
     * @return a patch that clears the field
     */
    @SuppressWarnings("unchecked")
    public static <T> Patch<T> clear() { return (Patch<T>) CLEAR; }

    /**
     * @param <T> the field type
     * @param value the new value; not null (use {@link #clear()})
     * @return a patch that sets the field
     */
    public static <T> Patch<T> value(T value) { return new Patch<>(Objects.requireNonNull(value, "Use Patch.clear() to clear a field")); }

    /** @return whether this patch clears the field */
    public boolean isClear() { return value == null; }

    /** @return the new value, or null when this patch clears the field */
    public T get() { return value; }

    @Override public boolean equals(Object other) { return other instanceof Patch<?> patch && Objects.equals(patch.value, value); }
    @Override public int hashCode() { return Objects.hashCode(value); }
    @Override public String toString() { return value == null ? "Patch.clear()" : "Patch.value(" + value + ")"; }
  }

  // ------------------------------------------------------------------ Shared value records

  /**
   * One metadata entry. Values are strings, numbers, booleans, lists or maps.
   *
   * @param id metadata field identifier
   * @param value field value
   */
  public record MetadataItem(String id, @JsonAdapter(value = Json.MetadataValueAdapter.class, nullSafe = false) Object value) {
    /** An empty item; set {@link #id(String)} and {@link #value(Object)}. */
    public MetadataItem() { this(null, null); }

    /** @param id the identifier @return a copy with this identifier */
    public MetadataItem id(String id) { return new MetadataItem(id, value); }

    /** @param value the value @return a copy with this value */
    public MetadataItem value(Object value) { return new MetadataItem(id, value); }
  }

  /** The most recent earlier posts CalmLens uses. */
  public static final int MODERATION_CONTEXT_USED_ITEMS = 5;

  /**
   * The most characters (Unicode code points) of earlier posts CalmLens uses. The newest post
   * always fits, since no post may be longer.
   */
  public static final int MODERATION_CONTEXT_USED_CHARACTERS = 2_000;

  /**
   * An earlier post in the conversation.
   *
   * @param text the post's text
   * @param authorId your identifier for who wrote it, or null
   */
  public record ModerationContextItem(String text, String authorId) {
    /** @param text the post's text, without an author */
    public ModerationContextItem(String text) { this(text, null); }
  }

  /**
   * Earlier posts in the conversation, oldest first. CalmLens moderates only the content and uses
   * these to read who it addresses, what it refers to and whether it quotes, reports, counters or
   * mocks something.
   *
   * @param items the earlier posts, oldest first
   */
  public record ModerationContext(List<ModerationContextItem> items) {
    /** Copies the list so the record stays immutable. */
    public ModerationContext {
      items = list(items);
    }
  }

  /**
   * The earlier posts CalmLens uses: walking from the newest, at most {@link
   * #MODERATION_CONTEXT_USED_ITEMS} posts within {@link #MODERATION_CONTEXT_USED_CHARACTERS}
   * Unicode code points, returned oldest first. The newest post is always kept, so an over-long
   * one is left for the API to reject.
   *
   * @param items earlier posts, oldest first
   * @return the posts the SDK sends, oldest first
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} when the list, a post or its
   *     text is null
   */
  public static List<ModerationContextItem> selectModerationContextItems(List<ModerationContextItem> items) {
    if (items == null) throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "context.items must be a list of earlier posts");
    java.util.ArrayDeque<ModerationContextItem> selected = new java.util.ArrayDeque<>();
    int characters = 0;
    for (int index = items.size() - 1; index >= 0 && selected.size() < MODERATION_CONTEXT_USED_ITEMS; index--) {
      ModerationContextItem item = items.get(index);
      if (item == null || item.text() == null)
        throw new CalmLensException(ErrorCodes.SDK_INVALID_ARGUMENT, "context.items[" + index + "].text must be a string");
      int length = item.text().codePointCount(0, item.text().length());
      if (!selected.isEmpty() && characters + length > MODERATION_CONTEXT_USED_CHARACTERS) break;
      selected.addFirst(item);
      characters += length;
    }
    return List.copyOf(selected);
  }

  /**
   * Turns one optional feature on or off. Link detection runs unless {@code enabled} is false; the
   * other features are off unless it is true.
   *
   * @param enabled whether the feature runs
   */
  public record FeatureOptions(Boolean enabled) {
    /** No options set. */
    public FeatureOptions() { this(null); }

    /** @param enabled whether the feature runs @return a copy with this setting */
    public FeatureOptions enabled(Boolean enabled) { return new FeatureOptions(enabled); }
  }

  /**
   * Options for face detection (preview). Faces are located, never identified.
   *
   * @param enabled whether face detection runs
   * @param ageEstimation whether an age range is also estimated for each face
   */
  public record FaceDetectionOptions(Boolean enabled, Boolean ageEstimation) {
    /** No options set. */
    public FaceDetectionOptions() { this(null, null); }

    /** @param enabled whether face detection runs @return a copy with this setting */
    public FaceDetectionOptions enabled(Boolean enabled) { return new FaceDetectionOptions(enabled, ageEstimation); }

    /** @param ageEstimation whether to estimate ages @return a copy with this setting */
    public FaceDetectionOptions ageEstimation(Boolean ageEstimation) { return new FaceDetectionOptions(enabled, ageEstimation); }
  }

  /**
   * Optional analyses to run on an asset, keyed by feature. Link detection runs unless its {@code
   * enabled} is false; every other feature is off unless its {@code enabled} is true. Results of person, face, link and AI-generated detection appear on {@link
   * AssetClassification}; OCR stores extracted text on the image asset.
   *
   * @param ocr extract text onto the image asset and add text moderation
   * @param personDetection (preview) locate people in images
   * @param faceDetection (preview) locate faces in images and optionally estimate ages
   * @param linkDetection find QR codes and web links in images and moderate QR code text; on by
   *     default
   * @param aiGeneratedDetection (preview) read the AI provenance metadata images carry
   * @param streaming (preview) prepare an adaptive (HLS) stream of audio or video once it is
   *     decided and made browser-safe, served at the {@code hls} resource and played by the
   *     {@code embed} page; needs {@code retainContent} and is billed per started minute
   *     of media. Left null, the project's streaming setting decides; {@code enabled} false turns
   *     it off for this upload
   */
  public record ProcessingFeatures(FeatureOptions ocr, FeatureOptions personDetection, FaceDetectionOptions faceDetection,
      FeatureOptions linkDetection, FeatureOptions aiGeneratedDetection, FeatureOptions streaming) {
    /** No features set. */
    public ProcessingFeatures() { this(null, null, null, null, null, null); }

    /** @param value OCR options @return a copy with these options */
    public ProcessingFeatures ocr(FeatureOptions value) { return new ProcessingFeatures(value, personDetection, faceDetection, linkDetection, aiGeneratedDetection, streaming); }

    /** @param value person detection options @return a copy with these options */
    public ProcessingFeatures personDetection(FeatureOptions value) { return new ProcessingFeatures(ocr, value, faceDetection, linkDetection, aiGeneratedDetection, streaming); }

    /** @param value face detection options @return a copy with these options */
    public ProcessingFeatures faceDetection(FaceDetectionOptions value) { return new ProcessingFeatures(ocr, personDetection, value, linkDetection, aiGeneratedDetection, streaming); }

    /** @param value link detection options @return a copy with these options */
    public ProcessingFeatures linkDetection(FeatureOptions value) { return new ProcessingFeatures(ocr, personDetection, faceDetection, value, aiGeneratedDetection, streaming); }

    /** @param value AI-generated detection options @return a copy with these options */
    public ProcessingFeatures aiGeneratedDetection(FeatureOptions value) { return new ProcessingFeatures(ocr, personDetection, faceDetection, linkDetection, value, streaming); }

    /** @param value streaming options @return a copy with these options */
    public ProcessingFeatures streaming(FeatureOptions value) { return new ProcessingFeatures(ocr, personDetection, faceDetection, linkDetection, aiGeneratedDetection, value); }
  }

  /**
   * Processing options for an asset.
   *
   * @param retainContent whether stored content is kept after classification
   * @param storeSensitiveMetadata overrides the project's {@code storeSensitiveMetadata} setting
   *     for this upload: when false, embedded image metadata (EXIF, XMP and IPTC) is removed from
   *     the file before it is stored, and {@code content.metadata} leaves out the creator and
   *     location; when true, the image is stored as uploaded
   * @param features optional analyses to run, such as OCR
   */
  public record ProcessingOptions(Boolean retainContent, Boolean storeSensitiveMetadata, ProcessingFeatures features) {
    /** No options set. */
    public ProcessingOptions() { this(null, null, null); }

    /** @param value whether to keep content @return a copy with this setting */
    public ProcessingOptions retainContent(Boolean value) { return new ProcessingOptions(value, storeSensitiveMetadata, features); }

    /** @param value whether to store embedded image metadata @return a copy with this setting */
    public ProcessingOptions storeSensitiveMetadata(Boolean value) { return new ProcessingOptions(retainContent, value, features); }

    /** @param value optional features @return a copy with these features */
    public ProcessingOptions features(ProcessingFeatures value) { return new ProcessingOptions(retainContent, storeSensitiveMetadata, value); }
  }

  /**
   * Where an image transform crops from: a named position such as {@code face}, {@code center} or
   * {@code entropy}, or a point.
   */
  @JsonAdapter(Gravity.Adapter.class)
  public static final class Gravity {
    private final String position;
    private final String mode;
    private final Double x, y;

    private Gravity(String position, String mode, Double x, Double y) { this.position = position; this.mode = mode; this.x = x; this.y = y; }

    /**
     * @param position {@code face}, {@code left}, {@code right}, {@code top}, {@code bottom}, {@code
     *     center}, {@code auto} or {@code entropy}
     * @return a named gravity
     */
    public static Gravity position(String position) { return new Gravity(Objects.requireNonNull(position, "position"), null, null, null); }

    /**
     * @param mode {@code remainder} (fractions of the space left after resizing) or {@code box-center}
     *     (the crop box's centre as fractions of the image)
     * @param x horizontal position from 0 to 1, or null
     * @param y vertical position from 0 to 1, or null
     * @return a point gravity
     */
    public static Gravity point(String mode, Double x, Double y) { return new Gravity(null, Objects.requireNonNull(mode, "mode"), x, y); }

    /** @return the named position, or null for a point */
    public String position() { return position; }
    /** @return the point's mode, or null for a named position */
    public String mode() { return mode; }
    /** @return the point's horizontal position, or null */
    public Double x() { return x; }
    /** @return the point's vertical position, or null */
    public Double y() { return y; }

    @Override public boolean equals(Object other) {
      return other instanceof Gravity g && Objects.equals(g.position, position) && Objects.equals(g.mode, mode) && Objects.equals(g.x, x) && Objects.equals(g.y, y);
    }
    @Override public int hashCode() { return Objects.hash(position, mode, x, y); }
    @Override public String toString() { return position != null ? position : "{mode=" + mode + ", x=" + x + ", y=" + y + "}"; }

    static final class Adapter extends TypeAdapter<Gravity> {
      @Override public void write(JsonWriter out, Gravity value) throws IOException {
        if (value == null) { out.nullValue(); return; }
        if (value.position != null) { out.value(value.position); return; }
        out.beginObject();
        out.name("mode").value(value.mode);
        if (value.x != null) out.name("x").value(value.x);
        if (value.y != null) out.name("y").value(value.y);
        out.endObject();
      }

      @Override public Gravity read(JsonReader in) throws IOException {
        if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
        if (in.peek() == JsonToken.STRING) return position(in.nextString());
        JsonObject object = JsonParser.parseReader(in).getAsJsonObject();
        return point(object.get("mode").getAsString(), number(object, "x"), number(object, "y"));
      }
    }
  }

  /** An image transform's output quality: a number from 1 to 100, or a level. */
  @JsonAdapter(Quality.Adapter.class)
  public static final class Quality {
    private final Integer value;
    private final String level;

    private Quality(Integer value, String level) { this.value = value; this.level = level; }

    /**
     * @param value a quality from 1 to 100
     * @return a numeric quality
     */
    public static Quality of(int value) { return new Quality(value, null); }

    /**
     * @param level {@code low}, {@code medium} or {@code high}
     * @return a quality level
     */
    public static Quality level(String level) { return new Quality(null, Objects.requireNonNull(level, "level")); }

    /** @return the numeric quality, or null for a level */
    public Integer value() { return value; }
    /** @return the level, or null for a numeric quality */
    public String level() { return level; }

    @Override public boolean equals(Object other) {
      return other instanceof Quality q && Objects.equals(q.value, value) && Objects.equals(q.level, level);
    }
    @Override public int hashCode() { return Objects.hash(value, level); }
    @Override public String toString() { return level != null ? level : String.valueOf(value); }

    static final class Adapter extends TypeAdapter<Quality> {
      @Override public void write(JsonWriter out, Quality quality) throws IOException {
        if (quality == null) out.nullValue();
        else if (quality.level != null) out.value(quality.level);
        else out.value(quality.value);
      }

      @Override public Quality read(JsonReader in) throws IOException {
        if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
        if (in.peek() == JsonToken.STRING) return level(in.nextString());
        return of(in.nextInt());
      }
    }
  }

  private static Double number(JsonObject object, String name) {
    JsonElement value = object.get(name);
    return value == null || value.isJsonNull() ? null : value.getAsDouble();
  }

  /**
   * A border drawn around the image.
   *
   * @param color colour, such as {@code #fff}
   * @param width width in pixels
   */
  public record ImageBorder(String color, Double width) {
    /** No border settings. */
    public ImageBorder() { this(null, null); }

    /** @param value the colour @return a copy with this colour */
    public ImageBorder color(String value) { return new ImageBorder(value, width); }

    /** @param value the width in pixels @return a copy with this width */
    public ImageBorder width(Double value) { return new ImageBorder(color, value); }
  }

  /** What an image transform trims: a uniform border ({@link #border()}) or edges ({@link #edges(TrimEdges)}). */
  @JsonAdapter(Trim.Adapter.class)
  public static final class Trim {
    private final String mode;
    private final TrimEdges edges;

    private Trim(String mode, TrimEdges edges) { this.mode = mode; this.edges = edges; }

    /** @return a trim of a uniform border ({@code "border"}) */
    public static Trim border() { return new Trim("border", null); }

    /**
     * @param edges pixels to trim from each edge, or the size to trim to
     * @return an edge trim
     */
    public static Trim edges(TrimEdges edges) { return new Trim(null, Objects.requireNonNull(edges, "edges")); }

    /** @return the named mode, such as {@code border}, or null for an edge trim */
    public String mode() { return mode; }
    /** @return the edges, or null for a named mode */
    public TrimEdges edges() { return edges; }

    @Override public boolean equals(Object other) { return other instanceof Trim t && Objects.equals(t.mode, mode) && Objects.equals(t.edges, edges); }
    @Override public int hashCode() { return Objects.hash(mode, edges); }
    @Override public String toString() { return mode != null ? mode : edges.toString(); }

    static final class Adapter extends TypeAdapter<Trim> {
      @Override public void write(JsonWriter out, Trim value) throws IOException {
        if (value == null) out.nullValue();
        else if (value.mode != null) out.value(value.mode);
        else Json.GSON.toJson(Json.GSON.toJsonTree(value.edges), out);
      }

      @Override public Trim read(JsonReader in) throws IOException {
        if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
        if (in.peek() == JsonToken.STRING) return new Trim(in.nextString(), null);
        return edges(Json.GSON.fromJson(JsonParser.parseReader(in), TrimEdges.class));
      }
    }
  }

  /**
   * Pixels to trim from each image edge, or the size to trim to.
   *
   * @param top pixels from the top
   * @param bottom pixels from the bottom
   * @param left pixels from the left
   * @param right pixels from the right
   * @param width width to trim to
   * @param height height to trim to
   * @param border also trim a uniform border
   */
  public record TrimEdges(Double top, Double bottom, Double left, Double right, Double width, Double height, TrimBorder border) {
    /** No edges set. */
    public TrimEdges() { this(null, null, null, null, null, null, null); }
    /** @param value pixels @return a copy with this setting */
    public TrimEdges top(Double value) { return new TrimEdges(value, bottom, left, right, width, height, border); }
    /** @param value pixels @return a copy with this setting */
    public TrimEdges bottom(Double value) { return new TrimEdges(top, value, left, right, width, height, border); }
    /** @param value pixels @return a copy with this setting */
    public TrimEdges left(Double value) { return new TrimEdges(top, bottom, value, right, width, height, border); }
    /** @param value pixels @return a copy with this setting */
    public TrimEdges right(Double value) { return new TrimEdges(top, bottom, left, value, width, height, border); }
    /** @param value pixels @return a copy with this setting */
    public TrimEdges width(Double value) { return new TrimEdges(top, bottom, left, right, value, height, border); }
    /** @param value pixels @return a copy with this setting */
    public TrimEdges height(Double value) { return new TrimEdges(top, bottom, left, right, width, value, border); }
    /** @param value border trimming @return a copy with this setting */
    public TrimEdges border(TrimBorder value) { return new TrimEdges(top, bottom, left, right, width, height, value); }
  }

  /** Whether and how an edge trim also trims a uniform border. */
  @JsonAdapter(TrimBorder.Adapter.class)
  public static final class TrimBorder {
    private final Boolean enabled;
    private final String color;
    private final Double tolerance, keep;

    private TrimBorder(Boolean enabled, String color, Double tolerance, Double keep) { this.enabled = enabled; this.color = color; this.tolerance = tolerance; this.keep = keep; }

    /**
     * @param enabled whether to trim the border
     * @return {@code true} or {@code false} on the wire
     */
    public static TrimBorder enabled(boolean enabled) { return new TrimBorder(enabled, null, null, null); }

    /**
     * @param color the border colour, or null to detect it
     * @param tolerance how far colours may differ from it, or null
     * @param keep pixels of border to keep, or null
     * @return border trimming with these settings
     */
    public static TrimBorder options(String color, Double tolerance, Double keep) { return new TrimBorder(null, color, tolerance, keep); }

    /** @return the on/off value, or null when settings are given */
    public Boolean enabled() { return enabled; }
    /** @return the border colour, or null */
    public String color() { return color; }
    /** @return the colour tolerance, or null */
    public Double tolerance() { return tolerance; }
    /** @return pixels of border to keep, or null */
    public Double keep() { return keep; }

    @Override public boolean equals(Object other) {
      return other instanceof TrimBorder b && Objects.equals(b.enabled, enabled) && Objects.equals(b.color, color) && Objects.equals(b.tolerance, tolerance) && Objects.equals(b.keep, keep);
    }
    @Override public int hashCode() { return Objects.hash(enabled, color, tolerance, keep); }
    @Override public String toString() { return enabled != null ? enabled.toString() : "{color=" + color + ", tolerance=" + tolerance + ", keep=" + keep + "}"; }

    static final class Adapter extends TypeAdapter<TrimBorder> {
      @Override public void write(JsonWriter out, TrimBorder value) throws IOException {
        if (value == null) { out.nullValue(); return; }
        if (value.enabled != null) { out.value(value.enabled); return; }
        out.beginObject();
        if (value.color != null) out.name("color").value(value.color);
        if (value.tolerance != null) out.name("tolerance").value(value.tolerance);
        if (value.keep != null) out.name("keep").value(value.keep);
        out.endObject();
      }

      @Override public TrimBorder read(JsonReader in) throws IOException {
        if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
        if (in.peek() == JsonToken.BOOLEAN) return enabled(in.nextBoolean());
        JsonObject object = JsonParser.parseReader(in).getAsJsonObject();
        JsonElement color = object.get("color");
        return options(color == null || color.isJsonNull() ? null : color.getAsString(), number(object, "tolerance"), number(object, "keep"));
      }
    }
  }

  /**
   * Image transform options, applied in one pass; set only what you need. Values with a fixed set, such as
   * {@code format} ({@code jpg}, {@code png}, {@code webp}, {@code avif}, {@code gif}), {@code fit}
   * ({@code scale-down}, {@code contain}, {@code pad}, {@code squeeze}, {@code cover}, {@code crop}),
   * {@code flip} ({@code h}, {@code v}, {@code hv}) and {@code segment} ({@code foreground}), are
   * strings so values added later still read.
   */
  // <generated: image-transform-options>
  // Generated by packages/sdk-contract/generate.ts from IMAGE_TRANSFORM_OPTIONS_SCHEMA; do not edit.
  /** Image transform options; set only what you need. */
  public static final class ImageTransformOptions {
    private String format;
    private Integer width;
    private Integer height;
    private Double dpr;
    private Boolean anim;
    private String background;
    private Double blur;
    private ImageBorder border;
    private Double brightness;
    private Double contrast;
    private Quality quality;
    private String fit;
    private String flip;
    private Double gamma;
    private String segment;
    private Gravity gravity;
    private Integer rotate;
    private Double saturation;
    private Double sharpen;
    private Trim trim;

    /** No options set. */
    public ImageTransformOptions() {}

    /** @param value The output format. Leave it out to serve the best format the browser accepts. @return these options */
    public ImageTransformOptions format(String value) { format = value; return this; }
    /** @return The output format. Leave it out to serve the best format the browser accepts. */
    public String format() { return format; }
    /** @param value The width in pixels, 1 to 10,000 after dpr. With a size and no fit, the image scales down. @return these options */
    public ImageTransformOptions width(Integer value) { width = value; return this; }
    /** @return The width in pixels, 1 to 10,000 after dpr. With a size and no fit, the image scales down. */
    public Integer width() { return width; }
    /** @param value The height in pixels, 1 to 10,000 after dpr. @return these options */
    public ImageTransformOptions height(Integer value) { height = value; return this; }
    /** @return The height in pixels, 1 to 10,000 after dpr. */
    public Integer height() { return height; }
    /** @param value The pixel density, 1 to 3: multiplies the width, height and border width. @return these options */
    public ImageTransformOptions dpr(Double value) { dpr = value; return this; }
    /** @return The pixel density, 1 to 3: multiplies the width, height and border width. */
    public Double dpr() { return dpr; }
    /** @param value false serves the first frame of an animated GIF or WebP. @return these options */
    public ImageTransformOptions anim(Boolean value) { anim = value; return this; }
    /** @return false serves the first frame of an animated GIF or WebP. */
    public Boolean anim() { return anim; }
    /** @param value The background colour, such as #ffffff, for padding and transparency. @return these options */
    public ImageTransformOptions background(String value) { background = value; return this; }
    /** @return The background colour, such as #ffffff, for padding and transparency. */
    public String background() { return background; }
    /** @param value The blur radius. @return these options */
    public ImageTransformOptions blur(Double value) { blur = value; return this; }
    /** @return The blur radius. */
    public Double blur() { return blur; }
    /** @param value A border drawn around the image. @return these options */
    public ImageTransformOptions border(ImageBorder value) { border = value; return this; }
    /** @return A border drawn around the image. */
    public ImageBorder border() { return border; }
    /** @param value The brightness factor. @return these options */
    public ImageTransformOptions brightness(Double value) { brightness = value; return this; }
    /** @return The brightness factor. */
    public Double brightness() { return brightness; }
    /** @param value The contrast factor. @return these options */
    public ImageTransformOptions contrast(Double value) { contrast = value; return this; }
    /** @return The contrast factor. */
    public Double contrast() { return contrast; }
    /** @param value The quality: 1 to 100, or a level. Lossy output defaults to high. @return these options */
    public ImageTransformOptions quality(Quality value) { quality = value; return this; }
    /** @return The quality: 1 to 100, or a level. Lossy output defaults to high. */
    public Quality quality() { return quality; }
    /** @param value How the image fits the width and height. @return these options */
    public ImageTransformOptions fit(String value) { fit = value; return this; }
    /** @return How the image fits the width and height. */
    public String fit() { return fit; }
    /** @param value Flips the image horizontally (h), vertically (v) or both (hv). @return these options */
    public ImageTransformOptions flip(String value) { flip = value; return this; }
    /** @return Flips the image horizontally (h), vertically (v) or both (hv). */
    public String flip() { return flip; }
    /** @param value The gamma. @return these options */
    public ImageTransformOptions gamma(Double value) { gamma = value; return this; }
    /** @return The gamma. */
    public Double gamma() { return gamma; }
    /** @param value foreground removes the background. @return these options */
    public ImageTransformOptions segment(String value) { segment = value; return this; }
    /** @return foreground removes the background. */
    public String segment() { return segment; }
    /** @param value Where to keep when cropping: a side, face, auto, or a point. @return these options */
    public ImageTransformOptions gravity(Gravity value) { gravity = value; return this; }
    /** @return Where to keep when cropping: a side, face, auto, or a point. */
    public Gravity gravity() { return gravity; }
    /** @param value The clockwise rotation in degrees. @return these options */
    public ImageTransformOptions rotate(Integer value) { rotate = value; return this; }
    /** @return The clockwise rotation in degrees. */
    public Integer rotate() { return rotate; }
    /** @param value The saturation factor. @return these options */
    public ImageTransformOptions saturation(Double value) { saturation = value; return this; }
    /** @return The saturation factor. */
    public Double saturation() { return saturation; }
    /** @param value The sharpen amount. @return these options */
    public ImageTransformOptions sharpen(Double value) { sharpen = value; return this; }
    /** @return The sharpen amount. */
    public Double sharpen() { return sharpen; }
    /** @param value Trims the edges: border trims a detected border, or give edges and sizes. @return these options */
    public ImageTransformOptions trim(Trim value) { trim = value; return this; }
    /** @return Trims the edges: border trims a detected border, or give edges and sizes. */
    public Trim trim() { return trim; }

    @Override public boolean equals(Object other) {
      return other instanceof ImageTransformOptions o && Json.GSON.toJsonTree(o).equals(Json.GSON.toJsonTree(this));
    }
    @Override public int hashCode() { return Json.GSON.toJsonTree(this).hashCode(); }
    @Override public String toString() { return describe(this); }
  }
  // </generated: image-transform-options>

  // ------------------------------------------------------------------ Request options

  /**
   * File content for {@link SubmitAsset#content(Content)}, {@link SubmitAsset#part(Content)} and
   * {@link UploadPart}. Create it from bytes, a file or a stream; files and streams are sent without
   * being read into memory. Set exactly one source.
   */
  public static final class Content {
    @SerializedName("type") private String mimeType;
    private String plainText;
    private String base64;
    private List<Integer> bytes;
    private Long sizeInBytes;
    private Integer partNumber;
    private Boolean isFinal;
    transient byte[] data;
    transient Path file;
    transient InputStream stream;

    /** Empty content; set a MIME type and one source. */
    public Content() {}

    /**
     * @param text UTF-8 text
     * @return {@code text/plain} content
     */
    public static Content text(String text) { return new Content().mimeType("text/plain").plainText(text); }

    /**
     * @param bytes the content; not copied, so do not change it until the call returns
     * @param mimeType the file's MIME type, such as {@code image/png}
     * @return binary content
     */
    public static Content bytes(byte[] bytes, String mimeType) {
      Content content = new Content().mimeType(mimeType);
      content.data = Objects.requireNonNull(bytes, "bytes");
      return content;
    }

    /**
     * @param file a regular file, streamed when the request is sent
     * @param mimeType the file's MIME type
     * @return file content
     */
    public static Content file(Path file, String mimeType) {
      Content content = new Content().mimeType(mimeType);
      content.file = Objects.requireNonNull(file, "file");
      return content;
    }

    /**
     * Content read from a stream. The stream is read once and not closed; requests that carry it
     * are not retried automatically.
     *
     * @param stream the source
     * @param sizeInBytes the exact number of bytes the stream supplies
     * @param mimeType the file's MIME type
     * @return streamed content
     */
    public static Content stream(InputStream stream, long sizeInBytes, String mimeType) {
      Content content = new Content().mimeType(mimeType).sizeInBytes(sizeInBytes);
      content.stream = Objects.requireNonNull(stream, "stream");
      return content;
    }

    /**
     * Content read from a stream whose size is not known. It is sent chunked, without {@code
     * sizeInBytes}; the stream is read once and not closed, and the request is not retried.
     *
     * @param stream the source
     * @param mimeType the file's MIME type
     * @return streamed content
     */
    public static Content stream(InputStream stream, String mimeType) {
      Content content = new Content().mimeType(mimeType);
      content.stream = Objects.requireNonNull(stream, "stream");
      return content;
    }

    public Content mimeType(String value) { mimeType = value; return this; }
    public Content plainText(String value) { plainText = value; return this; }
    public Content base64(String value) { base64 = value; return this; }
    public Content bytes(List<Integer> value) { bytes = value; return this; }
    public Content sizeInBytes(Long value) { sizeInBytes = value; return this; }
    public Content partNumber(Integer value) { partNumber = value; return this; }
    public Content isFinal(Boolean value) { isFinal = value; return this; }

    /** @return the MIME type */
    public String mimeType() { return mimeType; }

    @Override public String toString() {
      String source = data != null ? "bytes[" + data.length + "]" : file != null ? "file" : stream != null ? "stream" : null;
      return "Content{type=" + mimeType + (source == null ? "" : ", source=" + source)
          + (plainText == null ? "" : ", plainText=" + plainText.length() + " chars")
          + (base64 == null ? "" : ", base64=" + base64.length() + " chars")
          + (sizeInBytes == null ? "" : ", sizeInBytes=" + sizeInBytes)
          + (partNumber == null ? "" : ", partNumber=" + partNumber)
          + (isFinal == null ? "" : ", isFinal=" + isFinal) + "}";
    }
  }

  /** Options for {@code assets.create} and {@code assets.classify}: a name and one of content, part or url. */
  public static final class SubmitAsset {
    private String name;
    private Content content;
    private Content part;
    private String url;
    private String description;
    private ProcessingOptions processingOptions;
    private Visibility visibility;
    private List<MetadataItem> metadata;
    private List<String> tags;
    private String authorId;
    private ModerationContext context;
    private String externalId;
    private String externalUrl;
    private Patch<String> folderId;
    private String uploadPresetId;
    private Long sizeInBytes;
    private Long totalSizeInBytes;

    /** Empty options. */
    public SubmitAsset() {}

    /**
     * @param name asset name, such as the file name
     * @param content the file content
     */
    public SubmitAsset(String name, Content content) { this.name = name; this.content = content; }

    /**
     * @param text UTF-8 text
     * @return options for a {@code text/plain} asset named {@code text}
     */
    public static SubmitAsset text(String text) { return new SubmitAsset("text", Content.text(text)); }

    public SubmitAsset name(String value) { name = value; return this; }
    public SubmitAsset content(Content value) { content = value; return this; }
    /** @param value the first part of a multipart upload @return these options */
    public SubmitAsset part(Content value) { part = value; return this; }
    public SubmitAsset url(String value) { url = value; return this; }
    public SubmitAsset description(String value) { description = value; return this; }
    public SubmitAsset processingOptions(ProcessingOptions value) { processingOptions = value; return this; }
    public SubmitAsset visibility(Visibility value) { visibility = value; return this; }
    public SubmitAsset metadata(List<MetadataItem> value) { metadata = value; return this; }
    /** @param value tags for the asset, such as {@code List.of("catalogue", "backpacks")} @return these options */
    public SubmitAsset tags(List<String> value) { tags = value; return this; }
    /**
     * @param value your identifier for who wrote the content; CalmLens only compares it with the
     *     author IDs in the context, to tell which posts share a speaker
     * @return these options
     */
    public SubmitAsset authorId(String value) { authorId = value; return this; }
    /**
     * @param value earlier posts in the conversation, oldest first; the SDK sends only the posts
     *     CalmLens uses (see {@link Models#selectModerationContextItems(List)})
     * @return these options
     */
    public SubmitAsset context(ModerationContext value) { context = value; return this; }
    public SubmitAsset externalId(String value) { externalId = value; return this; }
    public SubmitAsset externalUrl(String value) { externalUrl = value; return this; }
    public SubmitAsset folderId(Patch<String> value) { folderId = value; return this; }
    /** @param value the upload preset to apply: its folder, visibility, file types, size limit, moderation policy and processing options (processing options set here replace the preset's) @return these options */
    public SubmitAsset uploadPresetId(String value) { uploadPresetId = value; return this; }
    public SubmitAsset sizeInBytes(Long value) { sizeInBytes = value; return this; }
    /** @param value the whole file's size, checked when a multipart upload starts @return these options */
    public SubmitAsset totalSizeInBytes(Long value) { totalSizeInBytes = value; return this; }

    Content contentValue() { return content; }
    Content partValue() { return part; }
    ModerationContext contextValue() { return context; }

    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code uploadTokens.sign}. */
  public static final class SignUploadToken {
    private String uploadPresetId;
    private String externalId;
    private Integer expiresIn;

    /** Empty options. */
    public SignUploadToken() {}

    /** @param uploadPresetId the upload preset the token may upload through */
    public SignUploadToken(String uploadPresetId) { this.uploadPresetId = uploadPresetId; }

    public SignUploadToken uploadPresetId(String value) { uploadPresetId = value; return this; }
    /** @param value the external ID the uploaded asset gets; must not be empty @return these options */
    public SignUploadToken externalId(String value) { externalId = value; return this; }
    /** @param value lifetime in seconds, from 1 to 3600 (default 600) @return these options */
    public SignUploadToken expiresIn(Integer value) { expiresIn = value; return this; }

    String uploadPresetIdValue() { return uploadPresetId; }
    String externalIdValue() { return externalId; }
    Integer expiresInValue() { return expiresIn; }

    @Override public String toString() { return describe(this); }
  }

  /**
   * A signed upload token.
   *
   * @param token the token, to hand to the browser as its bearer token
   * @param expiresAt when it expires, in milliseconds since the Unix epoch
   */
  public record SignedUploadToken(String token, long expiresAt) {}

  /** Options for {@code text.classify}. */
  public static final class ClassifyText {
    private String text;
    private String name;
    private String description;
    private ProcessingOptions processingOptions;
    private List<MetadataItem> metadata;
    private List<String> tags;
    private String authorId;
    private ModerationContext context;
    private String externalId;
    private String externalUrl;
    private Patch<String> folderId;
    private String uploadPresetId;

    /** Empty options. */
    public ClassifyText() {}

    /** @param text the text to classify */
    public ClassifyText(String text) { this.text = text; }

    public ClassifyText text(String value) { text = value; return this; }
    public ClassifyText name(String value) { name = value; return this; }
    public ClassifyText description(String value) { description = value; return this; }
    public ClassifyText processingOptions(ProcessingOptions value) { processingOptions = value; return this; }
    public ClassifyText metadata(List<MetadataItem> value) { metadata = value; return this; }
    /** @param value tags for the asset, such as {@code List.of("catalogue", "backpacks")} @return these options */
    public ClassifyText tags(List<String> value) { tags = value; return this; }
    /**
     * @param value your identifier for who wrote the content; CalmLens only compares it with the
     *     author IDs in the context, to tell which posts share a speaker
     * @return these options
     */
    public ClassifyText authorId(String value) { authorId = value; return this; }
    /**
     * @param value earlier posts in the conversation, oldest first; the SDK sends only the posts
     *     CalmLens uses (see {@link Models#selectModerationContextItems(List)})
     * @return these options
     */
    public ClassifyText context(ModerationContext value) { context = value; return this; }
    public ClassifyText externalId(String value) { externalId = value; return this; }
    public ClassifyText externalUrl(String value) { externalUrl = value; return this; }
    public ClassifyText folderId(Patch<String> value) { folderId = value; return this; }
    /** @param value the upload preset to apply @return these options */
    public ClassifyText uploadPresetId(String value) { uploadPresetId = value; return this; }

    String textValue() { return text; }

    SubmitAsset toSubmitAsset() {
      SubmitAsset asset = new SubmitAsset(name == null ? "text" : name, Content.text(text));
      asset.description = description;
      asset.processingOptions = processingOptions;
      asset.metadata = metadata;
      asset.tags = tags;
      asset.authorId = authorId;
      asset.context = context;
      asset.externalId = externalId;
      asset.externalUrl = externalUrl;
      asset.folderId = folderId;
      asset.uploadPresetId = uploadPresetId;
      return asset;
    }

    @Override public String toString() { return describe(this); }
  }

  /** Identifies one asset. */
  public static final class AssetId {
    private String assetId;
    public AssetId() {}
    /** @param assetId the asset ID */
    public AssetId(String assetId) { this.assetId = assetId; }
    public AssetId assetId(String value) { assetId = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code assets.waitForDecision}. */
  public static final class WaitForDecision {
    private String assetId;
    private transient Duration timeout;
    public WaitForDecision() {}
    /** @param assetId the asset */
    public WaitForDecision(String assetId) { this.assetId = assetId; }
    public WaitForDecision assetId(String value) { assetId = value; return this; }
    /**
     * @param value how long to wait for a decision; 60 seconds when unset, and zero checks once
     * @return these options
     */
    public WaitForDecision timeout(Duration value) { timeout = value; return this; }
    Duration timeoutValue() { return timeout; }
    @Override public String toString() { return describe(this); }
  }

  /** Identifies one folder. */
  public static final class FolderId {
    private String folderId;
    public FolderId() {}
    /** @param folderId the folder ID */
    public FolderId(String folderId) { this.folderId = folderId; }
    public FolderId folderId(String value) { folderId = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code assets.search}. */
  public static final class SearchAssets {
    private String query;
    private String mode;
    private Integer pageSize;
    public SearchAssets() {}
    public SearchAssets query(String value) { query = value; return this; }
    /** @param value {@code keyword}, {@code semantic} or {@code hybrid} @return these options */
    public SearchAssets mode(String value) { mode = value; return this; }
    /** @param value how many of the best matches to return, 1 to 20 (default 10) @return these options */
    public SearchAssets pageSize(Integer value) { pageSize = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code assets.list} and {@code assets.iterate}. */
  public static final class ListAssets {
    private String cursor;
    private Integer pageSize;
    private String filter;
    private String sort;
    public ListAssets() {}
    /** @param value the previous page's {@code nextCursor} @return these options */
    public ListAssets cursor(String value) { cursor = value; return this; }
    /** @param value assets per page, 1 to 100 (default 50) @return these options */
    public ListAssets pageSize(Integer value) { pageSize = value; return this; }
    /**
     * @param value an RSQL filter such as {@code classification.moderation.status==allowed}, or
     *     {@code folderId==fldr_...} ({@code folderId==null} for the project root) for one folder's assets
     * @return these options
     */
    public ListAssets filter(String value) { filter = value; return this; }
    /**
     * @param value comma-separated {@code createdAt} and {@code id}, each ascending unless prefixed
     *     with {@code -}, such as {@code -createdAt,id}; newest first when unset
     * @return these options
     */
    public ListAssets sort(String value) { sort = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code assets.listChildren} and {@code assets.iterateChildren}. */
  public static final class ListChildren {
    private String assetId;
    private String cursor;
    private Integer pageSize;
    private String sort;
    public ListChildren() {}
    /** @param assetId the parent asset ID */
    public ListChildren(String assetId) { this.assetId = assetId; }
    public ListChildren assetId(String value) { assetId = value; return this; }
    /** @param value the previous page's {@code nextCursor} @return these options */
    public ListChildren cursor(String value) { cursor = value; return this; }
    /** @param value children per page, 1 to 100 (default 50) @return these options */
    public ListChildren pageSize(Integer value) { pageSize = value; return this; }
    /** @param value comma-separated {@code createdAt} and {@code id}, descending when prefixed with {@code -}; newest first when unset @return these options */
    public ListChildren sort(String value) { sort = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code assets.listTimeline} and {@code assets.iterateTimeline}. */
  public static final class ListTimeline {
    private String assetId;
    private String cursor;
    private Integer pageSize;
    public ListTimeline() {}
    /** @param assetId the audio or video asset ID */
    public ListTimeline(String assetId) { this.assetId = assetId; }
    public ListTimeline assetId(String value) { assetId = value; return this; }
    /** @param value the previous page's {@code nextCursor} @return these options */
    public ListTimeline cursor(String value) { cursor = value; return this; }
    /** @param value segments per page, 1 to 100 (default 50) @return these options */
    public ListTimeline pageSize(Integer value) { pageSize = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code assets.update}; unset fields keep their value. */
  public static final class UpdateAsset {
    private String assetId;
    private String name;
    private Patch<String> description;
    private Patch<List<String>> tags;
    private Patch<List<MetadataItem>> metadata;
    private Patch<String> folderId;
    private Patch<String> externalId;
    private Patch<String> externalUrl;
    private Patch<Visibility> visibility;
    public UpdateAsset() {}
    /** @param assetId the asset to update */
    public UpdateAsset(String assetId) { this.assetId = assetId; }
    public UpdateAsset assetId(String value) { assetId = value; return this; }
    /** @param value the new name; an asset always has one, so it can't be cleared @return these options */
    public UpdateAsset name(String value) { name = value; return this; }
    public UpdateAsset description(Patch<String> value) { description = value; return this; }
    public UpdateAsset tags(Patch<List<String>> value) { tags = value; return this; }
    public UpdateAsset metadata(Patch<List<MetadataItem>> value) { metadata = value; return this; }
    public UpdateAsset folderId(Patch<String> value) { folderId = value; return this; }
    public UpdateAsset externalId(Patch<String> value) { externalId = value; return this; }
    public UpdateAsset externalUrl(Patch<String> value) { externalUrl = value; return this; }
    public UpdateAsset visibility(Patch<Visibility> value) { visibility = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * Options for {@code assets.decide}: a reviewer's decision and the note recorded with it. Purging
   * deletes the stored content and needs {@link #confirmPurge(boolean)}.
   */
  public static final class DecideAsset {
    private String assetId;
    private AssetModerationDecision decision;
    private String note;
    private Boolean confirmPurge;
    public DecideAsset() {}
    /** @param assetId the asset @param decision the new moderation status @param note why, 1 to 1499 characters */
    public DecideAsset(String assetId, AssetModerationDecision decision, String note) { this.assetId = assetId; this.decision = decision; this.note = note; }
    public DecideAsset assetId(String value) { assetId = value; return this; }
    public DecideAsset decision(AssetModerationDecision value) { decision = value; return this; }
    /** @param value why the reviewer decided this, 1 to 1499 characters after trimming @return these options */
    public DecideAsset note(String value) { note = value; return this; }
    /** @param value must be true to purge: the content is deleted and can't be restored @return these options */
    public DecideAsset confirmPurge(boolean value) { confirmPurge = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code assets.explain}. */
  public static final class ExplainAsset {
    private String assetId;
    private Boolean rerun;
    public ExplainAsset() {}
    /** @param assetId the asset */
    public ExplainAsset(String assetId) { this.assetId = assetId; }
    public ExplainAsset assetId(String value) { assetId = value; return this; }
    /**
     * @param value whether to moderate the asset again with the project's current policy instead of
     *     explaining the decision as made
     * @return these options
     */
    public ExplainAsset rerun(boolean value) { rerun = value; return this; }
    boolean rerunValue() { return Boolean.TRUE.equals(rerun); }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code assets.move}; a null folder moves the asset to the project root. */
  public static final class MoveAsset {
    private String assetId;
    private String folderId;
    public MoveAsset() {}
    /** @param assetId the asset @param folderId the target folder, or null for the root */
    public MoveAsset(String assetId, String folderId) { this.assetId = assetId; this.folderId = folderId; }
    public MoveAsset assetId(String value) { assetId = value; return this; }
    public MoveAsset folderId(String value) { folderId = value; return this; }
    String folderIdValue() { return folderId; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * What {@code assets.batch} does to every asset: {@link #DELETE} deletes it with its child assets
   * and stored content; {@link #REMOVE_CONTENT} removes its stored content and keeps the record.
   */
  public enum AssetBatchOperation {
    @SerializedName("delete") DELETE("delete"),
    @SerializedName("remove-content") REMOVE_CONTENT("remove-content");
    private final String value;
    AssetBatchOperation(String value) { this.value = value; }
    /** @return the API value, such as {@code remove-content} */
    public String value() { return value; }
    @Override public String toString() { return value; }
  }

  /** Options for {@code assets.batch}: 1 to 500 asset IDs and the operation to run on them. */
  public static final class BatchAssets {
    private List<String> assetIds;
    private AssetBatchOperation operation;
    public BatchAssets() {}
    /** @param assetIds 1 to 500 asset IDs in the project @param operation what to do with them */
    public BatchAssets(List<String> assetIds, AssetBatchOperation operation) { this.assetIds = assetIds; this.operation = operation; }
    public BatchAssets assetIds(List<String> value) { assetIds = value; return this; }
    public BatchAssets operation(AssetBatchOperation value) { operation = value; return this; }
    List<String> assetIdsValue() { return assetIds; }
    AssetBatchOperation operationValue() { return operation; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * What {@code assets.batch} returns once the operation is queued. The {@code asset.deleted} and
   * {@code asset.content-removed} events the batch records carry a {@code batch-id} fact naming
   * {@code batchId}.
   *
   * @param batchId the batch's ID ({@code batch_} prefix)
   * @param status {@code queued}
   * @param assetCount how many distinct assets the batch covers
   */
  public record BatchAssetsResponse(String batchId, String status, int assetCount) {}

  /** Options for {@code assets.uploadPart}: a later part of a multipart upload. */
  public static final class UploadPart {
    private String assetId;
    private Content part;
    private Boolean wait;
    public UploadPart() {}
    /** @param assetId the uploading asset @param part the part, with its part number and isFinal */
    public UploadPart(String assetId, Content part) { this.assetId = assetId; this.part = part; }
    public UploadPart assetId(String value) { assetId = value; return this; }
    public UploadPart part(Content value) { part = value; return this; }
    /**
     * Overrides, for the final part, the choice saved when the upload started ({@code classify}
     * waits, {@code create} doesn't); leave unset to use it.
     *
     * @param value true to wait for the decision, false to return with the asset {@code queued}
     * @return these options
     */
    public UploadPart wait(Boolean value) { wait = value; return this; }
    Content partValue() { return part; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * Options for {@code cdn.signAssetUrl}: the private asset to sign a URL for, by exactly one of
   * {@link #assetId} and {@link #externalId}, how long the grant lasts and whether it grants the
   * original. {@link #resource}, {@link #lens}, {@code transform} and {@link #viewerClaims} aren't
   * part of the grant: they are appended to the signed URL exactly as {@code cdn.getAssetUrl}
   * appends them, and can be changed later without signing again.
   */
  public static final class SignAssetUrlOptions {
    private String projectId;
    private String assetId;
    private String externalId;
    private Long expiresIn;
    private Boolean original;
    private String resource;
    private String lens;
    private transient Object transform;
    private ViewerClaims viewerClaims;
    public SignAssetUrlOptions() {}
    /** @param assetId the asset's ID */
    public SignAssetUrlOptions(String assetId) { this.assetId = assetId; }
    /** @param value the asset's project; null for the client's @return these options */
    public SignAssetUrlOptions projectId(String value) { projectId = value; return this; }
    /** @param value the asset's ID; set this or {@link #externalId}, not both @return these options */
    public SignAssetUrlOptions assetId(String value) { assetId = value; return this; }
    /** @param value the external ID the asset was uploaded with; set this or {@link #assetId}, not both @return these options */
    public SignAssetUrlOptions externalId(String value) { externalId = value; return this; }
    /**
     * @param value the grant's lifetime in whole seconds, from 1 to {@link
     *     CalmLensServerClient#MAX_SIGNED_URL_EXPIRES_IN_SECONDS}; null for {@link
     *     CalmLensServerClient#DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS}
     * @return these options
     */
    public SignAssetUrlOptions expiresIn(Long value) { expiresIn = value; return this; }
    /** @param value whether the URL serves the {@code original} resource, the exact upload, which it refuses otherwise; null for false @return these options */
    public SignAssetUrlOptions original(Boolean value) { original = value; return this; }
    /** @param value a resource to return the URL of beneath the grant; null for the signed asset URL itself; see {@link CalmLensServerClient#CDN_RESOURCES} @return these options */
    public SignAssetUrlOptions resource(String value) { resource = value; return this; }
    /** @param value a lens, for the {@code rendered} or {@code preview} resource @return these options */
    public SignAssetUrlOptions lens(String value) { lens = value; return this; }
    /**
     * @param value comma-separated options in one path segment, such as {@code fit=cover,width=1024},
     *     for the {@code rendered} or {@code preview} resource; they replace the lens's options of
     *     the same name
     * @return these options
     */
    public SignAssetUrlOptions transform(String value) { transform = value; return this; }
    /** @param value structured options, at least one set, serialized as a selector @return these options */
    public SignAssetUrlOptions transform(ImageTransformOptions value) { transform = value; return this; }
    /** @param value claims appended as the {@code viewerClaims} query, defaults left out @return these options */
    public SignAssetUrlOptions viewerClaims(ViewerClaims value) { viewerClaims = value; return this; }
    Object transformValue() { return transform; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * One page of folders and the visible paths needed to reveal them.
   *
   * @param items folders on this page
   * @param ancestors folders on the paths to the listed, selected and parent folders
   * @param nextCursor pass as {@code cursor} to get the next page; null on the last page
   * @param hasMore whether another page follows
   */
  public record FolderPage(List<Folder> items, List<Folder> ancestors, String nextCursor, boolean hasMore) implements CursorPage<Folder> {
    /** Copies collections; missing lists become empty. */
    public FolderPage { items = listOrEmpty(items); ancestors = listOrEmpty(ancestors); }
  }

  /** Options for {@code folders.list} and {@code folders.iterate}. */
  public static final class ListFolders {
    private String parentId;
    private String cursor;
    private Integer pageSize;
    private String sort;
    private String search;
    /** @param value lists this folder's children; unset lists the project root @return these options */
    public ListFolders parentId(String value) { parentId = value; return this; }
    /** @param value the previous page's {@code nextCursor} @return these options */
    public ListFolders cursor(String value) { cursor = value; return this; }
    /** @param value folders per page, 1 to 100 (default 50) @return these options */
    public ListFolders pageSize(Integer value) { pageSize = value; return this; }
    /** @param value {@code name} (the default) or {@code createdAt}, descending when prefixed with {@code -}, such as {@code -createdAt} @return these options */
    public ListFolders sort(String value) { sort = value; return this; }
    /** @param value case-insensitive text the folder name contains @return these options */
    public ListFolders search(String value) { search = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code folders.create}. */
  public static final class CreateFolder {
    private String name;
    private Patch<String> parentId;
    private String description;
    public CreateFolder() {}
    /** @param name the folder name */
    public CreateFolder(String name) { this.name = name; }
    public CreateFolder name(String value) { name = value; return this; }
    public CreateFolder parentId(Patch<String> value) { parentId = value; return this; }
    public CreateFolder description(String value) { description = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code folders.update}. */
  public static final class UpdateFolder {
    private String folderId;
    private Patch<String> name;
    private Patch<String> description;
    public UpdateFolder() {}
    /** @param folderId the folder */
    public UpdateFolder(String folderId) { this.folderId = folderId; }
    public UpdateFolder folderId(String value) { folderId = value; return this; }
    public UpdateFolder name(Patch<String> value) { name = value; return this; }
    public UpdateFolder description(Patch<String> value) { description = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code folders.move}; a null parent moves the folder to the project root. */
  public static final class MoveFolder {
    private String folderId;
    private String parentId;
    public MoveFolder() {}
    /** @param folderId the folder @param parentId the new parent, or null for the root */
    public MoveFolder(String folderId, String parentId) { this.folderId = folderId; this.parentId = parentId; }
    public MoveFolder folderId(String value) { folderId = value; return this; }
    public MoveFolder parentId(String value) { parentId = value; return this; }
    String parentIdValue() { return parentId; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * Options for {@code events.list} and {@code events.pages}. {@code types} and {@code assetId}
   * narrow the feed; a cursor belongs to the filters it was issued with, so pass the same ones with
   * each {@code cursor}.
   */
  public static final class ListEvents {
    private String cursor;
    private Integer pageSize;
    private List<String> types;
    private String assetId;
    public ListEvents() {}
    /** @param value a previous page's {@code nextCursor}; omit for an empty page whose cursor is the current time @return these options */
    public ListEvents cursor(String value) { cursor = value; return this; }
    /** @param value events per page, 1 to 100 (default 50) @return these options */
    public ListEvents pageSize(Integer value) { pageSize = value; return this; }
    /** @param value only events of these types, such as {@code asset.blocked}; null or empty for every type @return these options */
    public ListEvents types(List<String> value) { types = value == null ? null : List.copyOf(value); return this; }
    /** @param value only events about this asset, or null for every event @return these options */
    public ListEvents assetId(String value) { assetId = value; return this; }
    List<String> typesValue() { return types; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * A lens definition for {@code ensureLens}, {@code ensureLenses} and {@code lenses.create}. The
   * CDN serves files made with each lens's current definition.
   */
  public static final class LensDefinition {
    private String identifier;
    private String name;
    private Patch<String> description;
    @SerializedName("type") private String lensType;
    private Boolean active;
    private Patch<ImageTransformOptions> transform;
    public LensDefinition() {}
    /**
     * @param identifier stable identifier used in CDN URLs
     * @param name display name
     * @param lensType lens type, such as {@code image}
     */
    public LensDefinition(String identifier, String name, String lensType) {
      this.identifier = identifier; this.name = name; this.lensType = lensType;
    }
    /**
     * @param identifier stable identifier used in CDN URLs
     * @param name display name
     * @param lensType lens type, such as {@code image}
     * @param active whether the CDN serves the lens; null or unset means it does
     */
    public LensDefinition(String identifier, String name, String lensType, Boolean active) {
      this.identifier = identifier; this.name = name; this.lensType = lensType; this.active = active;
    }
    public LensDefinition identifier(String value) { identifier = value; return this; }
    public LensDefinition name(String value) { name = value; return this; }
    public LensDefinition description(Patch<String> value) { description = value; return this; }
    /** @param value the lens type ({@code type} in the API) @return this definition */
    public LensDefinition lensType(String value) { lensType = value; return this; }
    /** @param value whether the CDN serves the lens; null or unset means it does @return this definition */
    public LensDefinition active(Boolean value) { active = value; return this; }
    public LensDefinition transform(Patch<ImageTransformOptions> value) { transform = value; return this; }
    String identifierValue() { return identifier; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code lenses.list} and {@code lenses.iterate}. */
  public static final class ListLenses {
    private String cursor;
    private Integer pageSize;
    private String sort;
    public ListLenses() {}
    /** @param value the previous page's {@code nextCursor} @return these options */
    public ListLenses cursor(String value) { cursor = value; return this; }
    /** @param value lenses per page, 1 to 100 (default 50) @return these options */
    public ListLenses pageSize(Integer value) { pageSize = value; return this; }
    /** @param value comma-separated {@code createdAt} and {@code id}, descending when prefixed with {@code -}; newest first when unset @return these options */
    public ListLenses sort(String value) { sort = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Identifies one lens, for {@code lenses.retrieve} and {@code lenses.delete}. */
  public static final class LensId {
    private String lensId;
    public LensId() {}
    /** @param lensId the lens ID */
    public LensId(String lensId) { this.lensId = lensId; }
    public LensId lensId(String value) { lensId = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code lenses.update}; unset fields keep their value. The identifier can't change. */
  public static final class UpdateLens {
    private String lensId;
    private String name;
    private Patch<String> description;
    @SerializedName("type") private String lensType;
    private Boolean active;
    private Patch<ImageTransformOptions> transform;
    public UpdateLens() {}
    /** @param lensId the lens */
    public UpdateLens(String lensId) { this.lensId = lensId; }
    public UpdateLens lensId(String value) { lensId = value; return this; }
    public UpdateLens name(String value) { name = value; return this; }
    public UpdateLens description(Patch<String> value) { description = value; return this; }
    /** @param value the lens type ({@code type} in the API) @return these options */
    public UpdateLens lensType(String value) { lensType = value; return this; }
    /** @param value whether the CDN serves the lens; unset keeps its value @return these options */
    public UpdateLens active(Boolean value) { active = value; return this; }
    /** @param value the new transform; the CDN serves files made with it from then on @return these options */
    public UpdateLens transform(Patch<ImageTransformOptions> value) { transform = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code ensureLenses}. */
  public static final class EnsureLenses {
    private List<LensDefinition> lenses;
    public EnsureLenses() {}
    /** @param lenses the lenses to create or update */
    public EnsureLenses(List<LensDefinition> lenses) { this.lenses = lenses; }
    public EnsureLenses lenses(List<LensDefinition> value) { lenses = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * Options for {@code cdn.getAssetUrl} and {@code cdn.serve}: an asset, by exactly one of {@link
   * #assetId} and {@link #externalId}, and optionally one of its resources with a lens or transform
   * and the viewer claims. Transform options replace a lens's options of the same name.
   */
  public static final class CdnRequest {
    private String projectId;
    private String assetId;
    private String externalId;
    private String resource;
    private String lens;
    private transient Object transform;
    private ViewerClaims viewerClaims;
    private HttpOptions init;
    public CdnRequest() {}
    /** @param assetId the asset's ID */
    public CdnRequest(String assetId) { this.assetId = assetId; }
    /** @param value the asset's project; null for the client's @return these options */
    public CdnRequest projectId(String value) { projectId = value; return this; }
    /** @param value the asset's ID; set this or {@link #externalId}, not both @return these options */
    public CdnRequest assetId(String value) { assetId = value; return this; }
    /**
     * @param value the external ID the asset was uploaded with, written {@code ext:} and the
     *     URL-encoded ID; set this or {@link #assetId}, not both
     * @return these options
     */
    public CdnRequest externalId(String value) { externalId = value; return this; }
    /**
     * @param value {@code rendered}, {@code preview} (both take a lens or transform), or {@code
     *     original}, {@code hls}, {@code embed}, {@code placeholder} or {@code info}; see {@link
     *     CalmLensServerClient#CDN_RESOURCES}. Null builds the asset URL itself for {@code
     *     cdn.getAssetUrl}, and serves {@code rendered} for {@code cdn.serve}
     * @return these options
     */
    public CdnRequest resource(String value) { resource = value; return this; }
    /** @param value a lens, for the {@code rendered} or {@code preview} resource @return these options */
    public CdnRequest lens(String value) { lens = value; return this; }
    /**
     * @param value comma-separated options in one path segment, such as {@code fit=cover,width=1024};
     *     they replace the lens's options of the same name
     * @return these options
     */
    public CdnRequest transform(String value) { transform = value; return this; }
    /** @param value structured options, at least one set, serialized as a selector @return these options */
    public CdnRequest transform(ImageTransformOptions value) { transform = value; return this; }
    /** @param value claims appended as the {@code viewerClaims} query, defaults left out @return these options */
    public CdnRequest viewerClaims(ViewerClaims value) { viewerClaims = value; return this; }
    Object transformValue() { return transform; }
    /** @param value the request method and extra headers, such as {@code Range} @return these options */
    public CdnRequest init(HttpOptions value) { init = value; return this; }
    HttpOptions initValue() { return init; }
    @Override public String toString() { return describe(this); }
  }

  /** Request method and headers for {@code cdn.serve}. */
  public static final class HttpOptions {
    private String method;
    private Map<String, String> headers;
    public HttpOptions() {}
    /** @param value {@code GET} (default) or {@code HEAD} @return these options */
    public HttpOptions method(String value) { method = value; return this; }
    public HttpOptions headers(Map<String, String> value) { headers = value; return this; }
    String methodValue() { return method; }
    Map<String, String> headersValue() { return headers; }
    @Override public String toString() { return describe(this); }
  }

  // ------------------------------------------------------------------ Responses

  /**
   * An asset. {@code id}, {@code processing} and {@code moderation} are always set.
   *
   * @param id asset ID
   * @param name asset name
   * @param projectId owning project
   * @param type asset type, such as {@code image} or {@code plaintext-document}
   * @param folderId containing folder, or null at the project root
   * @param metadata metadata entries
   * @param parentId parent asset for derived assets such as images extracted from documents
   * @param parentPages the pages of the parent document a child shows, numbered from 1; empty
   *     when its page isn't known or it has no parent document
   * @param uploadPresetId upload preset the asset was uploaded through, if any
   * @param createdAt creation time
   * @param updatedAt last update time
   * @param description description
   * @param externalId your identifier for the asset
   * @param externalUrl your URL for the asset
   * @param authorId your identifier for who wrote the content, or null
   * @param context the earlier posts CalmLens used, oldest first; null when none were sent or once
   *     the content is removed
   * @param tags tags
   * @param visibility CDN visibility
   * @param upload receipt of source content
   * @param classification progress and capability results
   * @param content whether CalmLens holds the content, and its details
   */
  public record Asset(
      String id, String name, String projectId, String type, String folderId,
      List<MetadataItem> metadata, String parentId, List<Integer> parentPages, String uploadPresetId,
      @JsonAdapter(Json.EpochMillis.class) Instant createdAt,
      @JsonAdapter(Json.EpochMillis.class) Instant updatedAt,
      String description, String externalId, String externalUrl, String authorId, ModerationContext context, List<String> tags,
      Visibility visibility,
      AssetUpload upload, AssetClassification classification, AssetContent content) {
    /** Copies collections so the record stays immutable. */
    public Asset {
      metadata = list(metadata);
      parentPages = list(parentPages);
      tags = list(tags);
    }
  }

  /** Receipt of source content and multipart progress. */
  public record AssetUpload(String status, @JsonAdapter(Json.EpochMillis.class) Instant updatedAt, Integer partsReceived) {}

  /**
   * Classification progress and results grouped by capability.
   *
   * @param status classification progress
   * @param failureReason why processing failed: {@code file-too-large}, {@code duration-limit},
   *     {@code resolution-limit}, {@code unsupported-format}, {@code undecodable-content}, {@code
   *     multiple-tracks}, {@code type-mismatch}, {@code free-uploads-exhausted}, {@code
   *     media-limit}, {@code uploads-paused}, {@code too-many-items} or {@code processing-error}; null unless {@code
   *     status} is {@code failed}
   * @param progress how far analysis of a long audio or video asset has got, section by section;
   *     null when it isn't analysed in sections
   * @param updatedAt when classification state last changed
   * @param completedAt when classification finished
   * @param testInput whether the results came from one of the project's test inputs rather than
   *     analysing the content; never use test results, such as age ranges, for real decisions
   * @param moderation safety findings and decisions
   * @param ocr text found in the image; null until OCR has run, and when it wasn't requested. For
   *     a document or website, {@code not-evaluated} with reason {@code in-children}: each of its
   *     images is a child asset with its own result ({@code assets().listChildren})
   * @param personDetection person detection result; null until it has run
   * @param faceDetection face detection result; null until it has run
   * @param linkDetection link detection result; null until it has run
   * @param linkSafety (preview) where the asset's links lead and their verdicts; set when the
   *     project's policy acts on links
   * @param aiGeneratedDetection generated-content detection result; null until it has run
   */
  public record AssetClassification(AssetClassificationStatus status, String failureReason,
      ClassificationProgress progress, @JsonAdapter(Json.EpochMillis.class) Instant updatedAt,
      @JsonAdapter(Json.EpochMillis.class) Instant completedAt, Boolean testInput,
      AssetModeration moderation, OcrResult ocr, PersonDetectionResult personDetection,
      FaceDetectionResult faceDetection, LinkDetectionResult linkDetection,
      LinkSafetyResult linkSafety,
      AiGeneratedDetectionResult aiGeneratedDetection) {}

  /**
   * An OCR result. {@code textRegions} is set only for {@code evaluated}; {@code reason} only for
   * {@code not-evaluated}.
   *
   * @param status {@code evaluated} or {@code not-evaluated}
   * @param reason why the feature was not evaluated: {@code not-supported}, {@code unavailable} or {@code in-children}
   * @param textRegions the text regions found in the image
   */
  public record OcrResult(String status, String reason, List<TextRegion> textRegions) {
    /** Copies collections so the record stays immutable. */
    public OcrResult { textRegions = list(textRegions); }
  }

  /**
   * A link detection result. {@code qrCodes} and {@code links} are set only for {@code
   * evaluated}; {@code reason} only for {@code not-evaluated}.
   *
   * @param status {@code evaluated} or {@code not-evaluated}
   * @param reason why the feature was not evaluated: {@code not-supported}, {@code unavailable} or {@code in-children}
   * @param qrCodes QR codes found in the image
   * @param links links found in QR codes and text
   */
  public record LinkDetectionResult(String status, String reason, List<DetectedQrCode> qrCodes, List<DetectedLink> links) {
    /** Copies collections so the record stays immutable. */
    public LinkDetectionResult { qrCodes = list(qrCodes); links = list(links); }
  }

  /**
   * A QR code found in an image.
   *
   * @param value the decoded value
   * @param box where the code is in the image
   */
  public record DetectedQrCode(String value, BoundingBox box) {}

  /**
   * A link found in an asset.
   *
   * @param url the link
   * @param source where it was found: {@code qr-code} or {@code text}
   */
  public record DetectedLink(String url, String source) {}

  /**
   * A link safety result (preview). {@code links} is set only for {@code evaluated}; {@code reason}
   * only for {@code not-evaluated}. It runs when the project's policy acts on links, not through
   * {@code processingOptions.features}.
   *
   * @param status {@code evaluated} or {@code not-evaluated}
   * @param reason why the feature was not evaluated: {@code not-supported} or {@code unavailable}
   * @param links every link found in the asset, with where it leads and its verdict
   */
  public record LinkSafetyResult(String status, String reason, List<CheckedLink> links) {
    /** Copies collections so the record stays immutable. */
    public LinkSafetyResult { links = list(links); }
  }

  /**
   * A link in an asset and what its destination is (preview).
   *
   * @param url the link as found, with {@code https://} added when it was left out
   * @param finalUrl where the link leads after following its redirects; null when a short link
   *     or redirect chain could not be followed
   * @param redirects how many redirects were followed to reach {@code finalUrl}
   * @param source where it was found: {@code qr-code} or {@code text}
   * @param verdict {@code safe}, {@code adult}, {@code gambling}, {@code phishing}, {@code
   *     malware} or {@code unresolved}: the most severe finding of any address on the way
   * @param evidence the reputation checks of the link, its redirects and its destination
   */
  public record CheckedLink(String url, String finalUrl, Integer redirects, String source, String verdict,
      List<LinkSafetyEvidence> evidence) {
    /** Copies collections so the record stays immutable. */
    public CheckedLink { evidence = list(evidence); }
  }

  /**
   * One reputation check of a link, every address it redirects through and its destination
   * (preview).
   *
   * @param check {@code domain-categories} or {@code threat-lists}
   * @param status {@code checked}, or {@code failed} when the check could not answer, which makes
   *     the link {@code unresolved}
   * @param labels what the check reported for any of the addresses, such as the domains' content
   *     categories and security risks or the threat types listed
   */
  public record LinkSafetyEvidence(String check, String status, List<String> labels) {
    /** Copies collections so the record stays immutable. */
    public LinkSafetyEvidence { labels = list(labels); }
  }

  /**
   * An AI-generated content detection result from provenance metadata. {@code provenance} and
   * {@code signals} are set only for {@code evaluated}; {@code reason} only for {@code not-evaluated}.
   *
   * @param status {@code evaluated} or {@code not-evaluated}
   * @param reason why the feature was not evaluated: {@code not-supported}, {@code unavailable} or {@code in-children}
   * @param provenance {@code ai-generated}, {@code ai-edited} or {@code unknown}
   * @param signals the metadata that indicated it
   */
  public record AiGeneratedDetectionResult(String status, String reason, String provenance, List<ProvenanceSignal> signals) {
    /** Copies collections so the record stays immutable. */
    public AiGeneratedDetectionResult { signals = list(signals); }
  }

  /**
   * One provenance signal.
   *
   * @param kind {@code c2pa}, {@code generator-metadata} or {@code iptc-digital-source-type}
   * @param value the signal's value
   */
  public record ProvenanceSignal(String kind, String value) {}

  /**
   * A text region found by OCR.
   *
   * @param box where the text is in the image
   * @param personalInformation whether the region holds personal information
   */
  public record TextRegion(BoundingBox box, Boolean personalInformation) {}

  /**
   * An upload's match against a hash list entry.
   *
   * @param source {@code hash-list}
   * @param hashListId the hash list
   * @param hashListEntryId the matching entry
   * @param distance Hamming distance between the hashes
   * @param action the list's action when matched: {@code flag} or {@code block}
   */
  public record HashMatch(String source, String hashListId, String hashListEntryId, Integer distance, HashListAction action) {}

  /**
   * One reviewer decision in an asset's review history.
   *
   * @param decision the reviewer's decision
   * @param note why the reviewer decided this, or null
   * @param decidedBy who made the decision
   * @param applied whether the decision was applied to the asset
   */
  public record AssetReview(String id, AssetModerationDecision decision, String note, ReviewDecider decidedBy,
      @JsonAdapter(Json.EpochMillis.class) Instant reviewedAt, boolean applied) {}

  /**
   * Who made a review decision.
   *
   * @param type {@code user} for a person (or an assistant's key acting for one), {@code api-key}
   *     for an API key
   * @param id the user's or API key's ID; null only when it was not recorded
   */
  public record ReviewDecider(String type, String id) {}

  /**
   * Content-safety findings, policy assessment and reviewer decision.
   *
   * @param status the moderation decision in force, which also decides delivery
   * @param automatedStatus the policy's own outcome before any reviewer decision: {@code allowed},
   *     {@code limited}, {@code age-restricted}, {@code blocked} or {@code purged}; null before a
   *     decision
   * @param policy the policy that made the automated decision, as it was then; null before a
   *     decision
   * @param pendingReview the review the human review queue is waiting for, set with the automated
   *     decision that joined the queue; null when no review is waiting
   * @param regions the regions where the asset is restricted, each with its own status
   * @param linkSafety (preview) what the policy's link safety settings made of the asset's links;
   *     null when the policy doesn't act on links
   * @param timeline the audio or video asset's findings timeline, which {@code assets.listTimeline}
   *     pages through; null for other assets and before analysis
   */
  public record AssetModeration(AssetModerationStatus status, List<AssetReview> manualReviews,
      AssetModerationStatus automatedStatus, DecisionPolicy policy, AssetPendingReview pendingReview,
      String source, String rule, List<String> flaggedCategories,
      LinkSafetyDecision linkSafety,
      List<RegionalDecision> regions, Boolean explanationComplete,
      Map<String, CategoryPolicyScore> categories, ModerationRaw raw, ModerationTimeline timeline) {
    public AssetModeration { categories = map(categories); manualReviews = list(manualReviews); flaggedCategories = listOrEmpty(flaggedCategories); regions = listOrEmpty(regions); }
  }

  /**
   * The policy that made a decision, as it was when it made it.
   *
   * @param id the policy's ID
   * @param revision the policy's revision when it made the decision
   * @param preset the preset release the policy used; null for a policy not made from a preset
   */
  public record DecisionPolicy(String id, Integer revision, DecisionPolicyPreset preset) {}

  /**
   * The built-in preset release a decision's policy used.
   *
   * @param id the preset's ID
   * @param version the preset release
   */
  public record DecisionPolicyPreset(String id, Integer version) {}

  /**
   * A review the human review queue is waiting for.
   *
   * @param requestedAt when the asset joined the queue, in Unix milliseconds
   * @param reason {@code sampled} or {@code uncertain}
   * @param uncertainCategories the categories that made the decision uncertain; empty for a sampled
   *     decision
   */
  public record AssetPendingReview(Long requestedAt, String reason, List<String> uncertainCategories) {
    /** Copies collections so the record stays immutable. */
    public AssetPendingReview { uncertainCategories = listOrEmpty(uncertainCategories); }
  }

  /**
   * What the policy's link safety settings made of an asset's links (preview).
   *
   * @param action the strongest action the asset's links take: {@code allow}, {@code limit},
   *     {@code age-restrict} or {@code block}
   * @param links the checked links that take that action, as in {@code classification.linkSafety.links}
   * @param settings the link safety settings the decision used
   */
  public record LinkSafetyDecision(String action, List<CheckedLink> links, LinkSafetySettings settings) {
    /** Copies collections so the record stays immutable. */
    public LinkSafetyDecision { links = list(links); }
  }

  /**
   * What happens to assets that link to unsafe destinations (preview). Link checks never change a
   * moderation category's score.
   *
   * @param verdictActions the action for an asset with a link of each verdict ({@code phishing},
   *     {@code malware}, {@code adult}, {@code gambling} or {@code unresolved}); a verdict left out
   *     is allowed
   * @param offPlatformLinks acts on every link whose destination is outside its allowed domains,
   *     whatever its verdict; null when off
   */
  public record LinkSafetySettings(Map<String, String> verdictActions, OffPlatformLinks offPlatformLinks) {
    /** Copies collections so the record stays immutable. */
    public LinkSafetySettings { verdictActions = map(verdictActions); }
  }

  /**
   * The action for links outside a list of domains (preview).
   *
   * @param action {@code limit}, {@code age-restrict} or {@code block}
   * @param allowedDomains bare lowercase domains whose links are on-platform; a domain also covers
   *     its subdomains
   */
  public record OffPlatformLinks(String action, List<String> allowedDomains) {
    /** Copies collections so the record stays immutable. */
    public OffPlatformLinks { allowedDomains = list(allowedDomains); }
  }

  /**
   * An audio or video asset's findings timeline, listed with {@code assets.listTimeline}.
   *
   * @param segmentCount how many segments the timeline has
   */
  public record ModerationTimeline(int segmentCount) {}

  /** Detection findings before policy evaluation. */
  public record ModerationRaw(Map<String, CategoryResult> categories, List<HashMatch> hashMatches) {
    public ModerationRaw { categories = map(categories); hashMatches = list(hashMatches); }
  }

  /**
   * An asset's content state and details.
   *
   * @param status whether CalmLens holds the content: {@code temporary}, {@code stored} or {@code removed}
   * @param removalReason why the content was removed: {@code policy}, {@code retention}, {@code
   *     requested}, {@code parent-removed} or {@code disposed}; null while content is held
   * @param updatedAt when the content status last changed
   * @param safetyHold safety hold, if any
   * @param format MIME type of the content
   * @param extension file extension of the content
   * @param sizeInBytes size of the uploaded content
   * @param checksums digests of the uploaded content
   * @param width the upload's width in pixels, for images, video and websites; null when unknown
   * @param height the upload's height in pixels, like {@code width}
   * @param durationSeconds the length of audio and video; null for other assets
   * @param pageCount the number of pages of a document; null for other assets
   * @param perceptualHash perceptual hash for matching similar images, for image assets
   * @param perceptualHashQuality the perceptual hash's quality from 0 to 100; low values match
   *     less reliably
   * @param metadata metadata embedded in an uploaded image, such as its capture time, camera and
   *     software; read-only and separate from the asset's own {@code metadata}. Null when the
   *     image declares none, for other asset types, once the content is removed and while the
   *     asset is held
   * @param extractedText text extracted from the content
   * @param rendered the displayable file the CDN's {@code rendered} resource serves; null when the
   *     asset has none (text, spreadsheets, other files, before processing makes one, once the
   *     content is removed and while a safety hold is on)
   * @param hls (preview) the adaptive stream of video or audio the CDN's {@code hls} resource
   *     serves and the {@code embed} page plays, once streaming has prepared it from the rendered
   *     file; null for other assets, until a stream is prepared, once the content is removed and
   *     while a safety hold is on
   * @param preview the still image the CDN's {@code preview} resource serves; null when the asset
   *     has none, like {@code rendered}
   */
  public record AssetContent(AssetContentStatus status, String removalReason,
      @JsonAdapter(Json.EpochMillis.class) Instant updatedAt,
      SafetyHold safetyHold, String format, String extension, Long sizeInBytes, Checksums checksums,
      Integer width, Integer height, Double durationSeconds, Integer pageCount,
      String perceptualHash, Integer perceptualHashQuality, FileMetadata metadata,
      ExtractedText extractedText, AssetRendered rendered, AssetHls hls,
      AssetPreview preview) {}

  /**
   * The one displayable file of an asset, as the CDN's {@code rendered} resource serves it.
   *
   * @param kind {@code image}, {@code pdf}, {@code video} or {@code audio}; only an image takes
   *     lenses and transforms
   * @param format the file's MIME type
   * @param width width in pixels; null when unknown or not visual
   * @param height height in pixels, like {@code width}
   * @param peaks audio waveform peaks from 0 to 1; null for other kinds and before processing
   */
  public record AssetRendered(AssetRenderedKind kind, String format, Integer width, Integer height, List<Double> peaks) {
    /** Copies collections so the record stays immutable. */
    public AssetRendered { peaks = list(peaks); }
  }

  /**
   * The adaptive (HLS) stream of audio or video, with fragmented MP4 (CMAF) segments, as the CDN's
   * {@code hls} resource serves it at {@code hls/index.m3u8}.
   *
   * @param renditions every rendition, video from the largest down, then audio
   */
  public record AssetHls(String status, String reason, List<AssetHlsRendition> renditions) {
    /** Copies collections so the record stays immutable. */
    public AssetHls { renditions = list(renditions); }
  }

  /**
   * One rendition of the adaptive stream, as the HLS master playlist lists it.
   *
   * @param kind {@code video} for a picture size (video renditions carry no sound; they play with
   *     the {@code audio} rendition), or {@code audio}
   * @param width picture width in pixels; null for audio
   * @param height picture height in pixels; null for audio
   * @param bandwidth peak bit rate in bits per second, counting the audio a video rendition plays
   *     with
   * @param codecs the rendition's codecs as RFC 6381 names, such as {@code avc1.64001f}
   */
  public record AssetHlsRendition(String kind, Integer width, Integer height, Long bandwidth, String codecs) {}

  /**
   * The still image that stands for an asset, as the CDN's {@code preview} resource serves it: the
   * image itself, a website's screenshot, a document's first page or an audio waveform.
   *
   * @param width width in pixels; null when unknown
   * @param height height in pixels; null when unknown
   * @param thumbhash ThumbHash placeholder to render while the preview loads; null until
   *     processed
   * @param averageColor average colour of the preview; null until processed
   */
  public record AssetPreview(Integer width, Integer height, String thumbhash, String averageColor) {}


  /**
   * How strongly a category meets the policy and what the policy does with it.
   *
   * @param score policy score from 0 to 1
   * @param action {@code allow}, {@code limit}, {@code age-restrict}, {@code block} or {@code purge}
   */
  public record CategoryPolicyScore(Double score, String action, CategoryPolicySource source,
      CategoryPolicySettingsSnapshot settings) {}

  /**
   * The rule that decided the outcome, or that the policy score stayed below 50%.
   *
   * @param kind {@code default}, {@code below-threshold}, {@code allowance} or {@code restriction}
   * @param indexes for {@code allowance} and {@code restriction}, the positions of the deciding
   *     rules in the category's settings, the decisive rule first; empty otherwise
   * @param conditionScore for {@code allowance} and {@code restriction}, the evidence that triggered
   *     the rules, from 0 to 1: a restriction's same-content presence or the allowances' coverage.
   *     A rule with {@code unless} qualifiers, or several {@code when} qualifiers, is assessed as a
   *     whole, so its qualifiers can be missing from {@code raw}; null otherwise
   */
  public record CategoryPolicySource(String kind, List<Integer> indexes, Double conditionScore) {
    public CategoryPolicySource { indexes = list(indexes); }
  }

  /**
   * A named allowance or restriction of a category: the qualifiers that must all hold for the same
   * content ({@code when}), the qualifiers that exclude it ({@code unless}, restrictions only) and
   * its action. A decision keeps its rules as configured then.
   */
  public record PolicyRuleSnapshot(String name, List<String> when, String action, List<String> unless) {
    public PolicyRuleSnapshot { when = list(when); unless = list(unless); }
  }

  /**
   * Historical category settings used to explain the saved decision.
   *
   * @param action the category's default action when its policy score reaches 0.5
   * @param allowances the category's allowances then
   * @param restrictions the category's restrictions then
   */
  public record CategoryPolicySettingsSnapshot(String action,
      List<PolicyRuleSnapshot> allowances, List<PolicyRuleSnapshot> restrictions) {
    public CategoryPolicySettingsSnapshot { allowances = list(allowances); restrictions = list(restrictions); }
  }

  /**
   * A restriction of the asset in one region.
   *
   * @param region the jurisdiction
   * @param status {@code limited}, {@code age-restricted}, {@code blocked} or {@code purged}
   * @param rule the rule that restricted it
   * @param category the category the rule is about, or null
   */
  public record RegionalDecision(String region, AssetModerationStatus status, String rule, String category) {}
  /**
   * One category result. {@code score} is set only for {@code evaluated} and {@code partial}.
   *
   * @param status {@code evaluated}, {@code partial} or {@code not-evaluated}
   * @param score score from 0 to 1
   * @param likelihood likelihood bucket
   * @param reason why the category was not evaluated
   * @param qualifiers qualifier results
   */
  public record CategoryResult(String status, Double score, String likelihood, String reason, Map<String, QualifierResult> qualifiers) {
    /** Copies collections so the record stays immutable. */
    public CategoryResult { qualifiers = map(qualifiers); }
  }

  /**
   * A category qualifier result.
   *
   * @param allScore confidence that the content is only this qualifier; never above someScore
   * @param status evaluation status
   * @param someScore confidence that some of the content is this qualifier
   * @param likelihood likelihood bucket
   * @param reason reason when not evaluated
   */
  public record QualifierResult(Double allScore, String status, Double someScore, String likelihood, String reason) {}

  /**
   * Results of the optional features requested in {@code processingOptions.features}. A feature
   * that was not requested is null. Results are informational and never change the decision.
   *
   * @param personDetection person detection result (preview)
   * @param faceDetection face detection result (preview)
   * @param linkDetection QR codes and links found in the image
   * @param aiGeneratedDetection AI provenance read from the image's metadata (preview)
   */
  public record ProcessingFeatureResults(PersonDetectionResult personDetection, FaceDetectionResult faceDetection,
      LinkDetectionResult linkDetection, AiGeneratedDetectionResult aiGeneratedDetection) {}

  /**
   * A person detection result. {@code people} is set only for {@code evaluated}; {@code reason}
   * only for {@code not-evaluated}.
   *
   * @param status {@code evaluated} or {@code not-evaluated}
   * @param reason why the feature was not evaluated: {@code not-supported}, {@code unavailable} or {@code in-children}
   * @param people detected people
   */
  public record PersonDetectionResult(String status, String reason, List<DetectedPerson> people) {
    /** Copies collections so the record stays immutable. */
    public PersonDetectionResult { people = list(people); }
  }

  /**
   * A face detection result. {@code faces} is set only for {@code evaluated}; {@code reason} only
   * for {@code not-evaluated}.
   *
   * @param status {@code evaluated} or {@code not-evaluated}
   * @param reason why the feature was not evaluated: {@code not-supported}, {@code unavailable} or {@code in-children}
   * @param faces detected faces
   */
  public record FaceDetectionResult(String status, String reason, List<DetectedFace> faces) {
    /** Copies collections so the record stays immutable. */
    public FaceDetectionResult { faces = list(faces); }
  }

  /**
   * A detected person.
   *
   * @param box where the person is in the image
   * @param confidence detection confidence from 0 to 1
   */
  public record DetectedPerson(BoundingBox box, Double confidence) {}

  /**
   * A detected face. Faces are not identified or stored as biometric templates.
   *
   * @param box where the face is in the image
   * @param confidence detection confidence from 0 to 1
   * @param ageRange estimated age range, set when age estimation was requested
   */
  public record DetectedFace(BoundingBox box, Double confidence, AgeRange ageRange) {}

  /**
   * Position and size as fractions of the image width and height, from 0 to 1. {@code left} and
   * {@code top} can be slightly negative when the subject extends past the edge.
   *
   * @param left left edge
   * @param top top edge
   * @param width width
   * @param height height
   */
  public record BoundingBox(Double left, Double top, Double width, Double height) {}

  /**
   * How far analysis of a long audio or video asset has got.
   *
   * @param completedSections sections analysed so far
   * @param totalSections sections in the asset
   */
  public record ClassificationProgress(Integer completedSections, Integer totalSections) {}

  /**
   * Estimated age range in years. Estimates can be off by several years.
   *
   * @param low lowest estimated age
   * @param high highest estimated age
   */
  public record AgeRange(Integer low, Integer high) {}

  /**
   * One stretch of an audio or video asset's findings: its source, times and scores.
   *
   * @param source {@code clip}, {@code frame}, {@code frame-text} or {@code speech}
   * @param startSeconds segment start
   * @param endSeconds segment end
   * @param categories results by category
   */
  public record MediaClassificationSegment(String source, Double startSeconds, Double endSeconds, Map<String, CategoryResult> categories) {
    /** Copies collections so the record stays immutable. */
    public MediaClassificationSegment { categories = map(categories); }
  }

  /**
   * Digests of an asset's uploaded content. Each is null when not computed.
   *
   * @param md5 MD5 digest
   * @param sha1 SHA-1 digest
   * @param sha256 SHA-256 digest
   * @param sha384 SHA-384 digest
   * @param sha512 SHA-512 digest
   */
  public record Checksums(String md5, String sha1, String sha256, String sha384, String sha512) {}

  /**
   * A safety hold that restricts access to an asset.
   *
   * @param reason hold reason
   * @param placedAt when the hold was placed
   * @param disposedAt when the held content was disposed of
   */
  public record SafetyHold(String reason,
      @JsonAdapter(Json.EpochMillis.class) Instant placedAt,
      @JsonAdapter(Json.EpochMillis.class) Instant disposedAt) {}

  /**
   * Text extracted from an asset.
   *
   * @param type extraction type
   * @param content extracted text
   * @param id extraction ID
   */
  public record ExtractedText(String type, String content, String id) {}

  /**
   * Descriptive metadata embedded in an uploaded image. Each text value is null when the file
   * doesn't record it.
   *
   * @param capturedAt when the picture was taken, as the file records it: an ISO 8601 date and
   *     time, such as {@code 2026-05-01T12:30:00+01:00}. It includes the UTC offset only when the
   *     file records one; without it, the time is the camera's local time
   * @param cameraMake camera manufacturer, such as {@code Canon}
   * @param cameraModel camera or phone model, such as {@code EOS R5}
   * @param lensModel lens model
   * @param software software that created or last edited the file
   * @param creator creator or artist the file names; sensitive, so recorded only when {@code
   *     storeSensitiveMetadata} is on
   * @param copyright copyright notice the file declares
   * @param digitalSourceType IPTC digital source type the file declares, such as {@code
   *     digitalCapture} for a camera photo or {@code trainedAlgorithmicMedia} for generated media.
   *     Files can declare any value, so treat it as a claim
   * @param containsLocation whether the uploaded file embedded GPS coordinates, whatever {@code
   *     storeSensitiveMetadata} is set to
   * @param location where the picture was taken, from its GPS coordinates; sensitive, so recorded
   *     only when {@code storeSensitiveMetadata} is on
   */
  public record FileMetadata(String capturedAt, String cameraMake, String cameraModel,
      String lensModel, String software, String creator, String copyright,
      String digitalSourceType, boolean containsLocation, FileMetadataLocation location) {}

  /**
   * A GPS position in decimal degrees.
   *
   * @param latitude latitude, from -90 to 90
   * @param longitude longitude, from -180 to 180
   */
  public record FileMetadataLocation(double latitude, double longitude) {}

  /**
   * One page of assets. Use {@code assets.iterate} to go through every page.
   *
   * @param items assets on this page
   * @param nextCursor continuation cursor, or null
   * @param hasMore whether another page follows
   */
  public record AssetPage(List<Asset> items, String nextCursor, boolean hasMore) implements CursorPage<Asset> {
    /** Copies collections; a missing item list becomes empty. */
    public AssetPage { items = listOrEmpty(items); }
  }

  /**
   * One page of an audio or video asset's findings timeline, in time order.
   *
   * @param items segments on this page
   * @param nextCursor continuation cursor, or null
   * @param hasMore whether another page follows
   */
  public record AssetTimelinePage(List<MediaClassificationSegment> items, String nextCursor, boolean hasMore) implements CursorPage<MediaClassificationSegment> {
    /** Copies collections; a missing item list becomes empty. */
    public AssetTimelinePage { items = listOrEmpty(items); }
  }

  /**
   * One search match.
   *
   * @param asset the matching asset
   * @param score relevance score
   * @param matchedFields fields that matched
   */
  public record AssetSearchMatch(Asset asset, Double score, List<String> matchedFields) {
    /** Copies collections so the record stays immutable. */
    public AssetSearchMatch { matchedFields = list(matchedFields); }
  }

  /**
   * Search results.
   *
   * @param query the query
   * @param items matches, best first
   * @param semanticStatus availability of semantic search
   */
  public record AssetSearchResponse(String query, List<AssetSearchMatch> items, String semanticStatus) {
    /** Copies collections; a missing item list becomes empty. */
    public AssetSearchResponse { items = listOrEmpty(items); }
  }

  /**
   * A folder.
   *
   * @param id folder ID
   * @param name name
   * @param parentId parent folder, or null at the root
   * @param projectId owning project
   * @param createdAt creation time
   * @param updatedAt last update time
   */
  public record Folder(String id, String name, String parentId, String projectId,
      @JsonAdapter(Json.EpochMillis.class) Instant createdAt,
      @JsonAdapter(Json.EpochMillis.class) Instant updatedAt) {}

  // ------------------------------------------------------------------ Hash lists

  /** What a hash list's matches do. Unknown values are kept like {@link Visibility}. */
  @JsonAdapter(HashListAction.Adapter.class)
  public static final class HashListAction {
    /** Matches are reported in {@code classification.moderation.hashMatches}. */
    public static final HashListAction FLAG = new HashListAction("flag");
    /** Matches are reported, and close matches are blocked. */
    public static final HashListAction BLOCK = new HashListAction("block");
    private final String value;

    private HashListAction(String value) { this.value = value; }

    /**
     * @param value the API value
     * @return the matching constant, or a new instance keeping an unknown value
     */
    public static HashListAction of(String value) {
      return switch (Objects.requireNonNull(value, "value")) {
        case "flag" -> FLAG;
        case "block" -> BLOCK;
        default -> new HashListAction(value);
      };
    }

    /** @return the API value */
    public String value() { return value; }

    /** @return whether this SDK version knows the value */
    public boolean isKnown() { return this == FLAG || this == BLOCK; }

    @Override public boolean equals(Object other) { return other instanceof HashListAction action && action.value.equals(value); }
    @Override public int hashCode() { return value.hashCode(); }
    @Override public String toString() { return value; }

    static final class Adapter extends TypeAdapter<HashListAction> {
      @Override public void write(JsonWriter out, HashListAction action) throws IOException { if (action == null) out.nullValue(); else out.value(action.value); }
      @Override public HashListAction read(JsonReader in) throws IOException {
        if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
        return of(in.nextString());
      }
    }
  }

  /**
   * A list of PDQ perceptual hashes that image uploads are compared with.
   *
   * @param id hash list ID
   * @param projectId owning project
   * @param name name
   * @param description description, or null
   * @param action what matches do
   * @param createdAt creation time
   * @param updatedAt last update time
   */
  public record HashList(String id, String projectId, String name, String description, HashListAction action,
      @JsonAdapter(Json.EpochMillis.class) Instant createdAt,
      @JsonAdapter(Json.EpochMillis.class) Instant updatedAt) {}

  /**
   * One hash in a hash list.
   *
   * @param id entry ID
   * @param projectId owning project
   * @param hashListId the hash list
   * @param hash PDQ hash, 64 lowercase hexadecimal characters
   * @param quality the hash's quality from 0 to 100, or null when unknown
   * @param label label, or null
   * @param assetId the asset the hash was taken from, or null
   * @param createdAt when it was added
   */
  public record HashListEntry(String id, String projectId, String hashListId, String hash, Integer quality,
      String label, String assetId,
      @JsonAdapter(Json.EpochMillis.class) Instant createdAt) {}

  /**
   * One page of a project's hash lists.
   *
   * @param items hash lists on this page
   * @param nextCursor pass as {@code cursor} to get the next page; null on the last page
   * @param hasMore whether another page follows
   */
  public record HashListPage(List<HashList> items, String nextCursor, boolean hasMore) implements CursorPage<HashList> {
    /** Copies collections; a missing item list becomes empty. */
    public HashListPage { items = listOrEmpty(items); }
  }

  /** Options for {@code hashLists.list} and {@code hashLists.iterate}. */
  public static final class ListHashLists {
    private String cursor;
    private Integer pageSize;
    private String sort;
    public ListHashLists() {}
    /** @param value the previous page's {@code nextCursor} @return these options */
    public ListHashLists cursor(String value) { cursor = value; return this; }
    /** @param value hash lists per page, 1 to 100 (default 50) @return these options */
    public ListHashLists pageSize(Integer value) { pageSize = value; return this; }
    /** @param value comma-separated {@code createdAt} and {@code id}, descending when prefixed with {@code -}; newest first when unset @return these options */
    public ListHashLists sort(String value) { sort = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * One page of a hash list's entries, newest first unless {@code sort} says otherwise.
   *
   * @param items entries on this page
   * @param nextCursor continuation cursor, or null
   * @param hasMore whether another page follows
   */
  public record HashListEntryPage(List<HashListEntry> items, String nextCursor, boolean hasMore) implements CursorPage<HashListEntry> {
    /** Copies collections; a missing item list becomes empty. */
    public HashListEntryPage { items = listOrEmpty(items); }
  }

  /** Identifies one hash list. */
  public static final class HashListId {
    private String hashListId;
    public HashListId() {}
    /** @param hashListId the hash list ID */
    public HashListId(String hashListId) { this.hashListId = hashListId; }
    public HashListId hashListId(String value) { hashListId = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Identifies one hash list entry. */
  public static final class HashListEntryId {
    private String entryId;
    public HashListEntryId() {}
    /** @param entryId the entry ID */
    public HashListEntryId(String entryId) { this.entryId = entryId; }
    public HashListEntryId entryId(String value) { entryId = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code hashLists.create}. */
  public static final class CreateHashList {
    private String name;
    private String description;
    private HashListAction action;
    public CreateHashList() {}
    /** @param name the list name @param action what matches do */
    public CreateHashList(String name, HashListAction action) { this.name = name; this.action = action; }
    public CreateHashList name(String value) { name = value; return this; }
    public CreateHashList description(String value) { description = value; return this; }
    public CreateHashList action(HashListAction value) { action = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code hashLists.update}; unset fields keep their value. A new action applies to later uploads. */
  public static final class UpdateHashList {
    private String hashListId;
    private Patch<String> name;
    private Patch<String> description;
    private Patch<HashListAction> action;
    public UpdateHashList() {}
    /** @param hashListId the hash list */
    public UpdateHashList(String hashListId) { this.hashListId = hashListId; }
    public UpdateHashList hashListId(String value) { hashListId = value; return this; }
    public UpdateHashList name(Patch<String> value) { name = value; return this; }
    public UpdateHashList description(Patch<String> value) { description = value; return this; }
    public UpdateHashList action(Patch<HashListAction> value) { action = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code hashLists.listEntries} and {@code hashLists.iterateEntries}. */
  public static final class ListHashListEntries {
    private String hashListId;
    private String cursor;
    private Integer pageSize;
    private String sort;
    public ListHashListEntries() {}
    /** @param hashListId the hash list */
    public ListHashListEntries(String hashListId) { this.hashListId = hashListId; }
    public ListHashListEntries hashListId(String value) { hashListId = value; return this; }
    /** @param value the previous page's {@code nextCursor} @return these options */
    public ListHashListEntries cursor(String value) { cursor = value; return this; }
    /** @param value entries per page, 1 to 100 (default 50) @return these options */
    public ListHashListEntries pageSize(Integer value) { pageSize = value; return this; }
    /** @param value comma-separated {@code createdAt} and {@code id}, descending when prefixed with {@code -}; newest first when unset @return these options */
    public ListHashListEntries sort(String value) { sort = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * Options for {@code hashLists.addEntry}: set either {@code hash} (with an optional {@code
   * quality}) or {@code assetId}, whose image's perceptual hash is added.
   */
  public static final class AddHashListEntry {
    private String hashListId;
    private String hash;
    private Integer quality;
    private String assetId;
    private String label;
    public AddHashListEntry() {}
    /** @param hashListId the hash list */
    public AddHashListEntry(String hashListId) { this.hashListId = hashListId; }
    public AddHashListEntry hashListId(String value) { hashListId = value; return this; }
    /** @param value a PDQ hash of 64 hexadecimal characters @return these options */
    public AddHashListEntry hash(String value) { hash = value; return this; }
    /** @param value the hash's quality from 0 to 100 @return these options */
    public AddHashListEntry quality(Integer value) { quality = value; return this; }
    /** @param value an image asset whose perceptual hash to add @return these options */
    public AddHashListEntry assetId(String value) { assetId = value; return this; }
    public AddHashListEntry label(String value) { label = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  // ------------------------------------------------------------------ Policies

  /**
   * A moderation policy. Policies belong to the organisation and its projects share them.
   *
   * @param id policy ID
   * @param name display name
   * @param description what the policy is for
   * @param settings what the policy does with each category
   * @param revision changes with every saved change; send it with each change
   * @param preset the built-in preset it started from, or null
   * @param projectIds projects this policy moderates, as their policy or through an upload preset
   * @param createdAt creation time
   * @param updatedAt last change
   */
  public record Policy(String id, String name, String description, PolicySettings settings, Integer revision,
      PolicyPreset preset, List<String> projectIds,
      @JsonAdapter(Json.EpochMillis.class) Instant createdAt,
      @JsonAdapter(Json.EpochMillis.class) Instant updatedAt) {
    /** Copies collections so the record stays immutable. */
    public Policy { projectIds = list(projectIds); }
  }

  /**
   * Where a policy started from a built-in preset.
   *
   * @param id the preset, such as {@code general-community} or {@code children-platform}
   * @param version the preset release the policy is at; {@code policies.reset} restores a pinned
   *     or copied policy to it
   * @param latestVersion the newest release, which {@code policies.upgrade} moves an unchanged
   *     pinned or copied policy to
   * @param mode {@code live} for the organisation's own preset policy following automatic updates,
   *     which always has the latest settings; {@code pinned} for that policy with automatic updates
   *     off, kept at {@code version}; {@code copy} for a policy made from the preset
   */
  public record PolicyPreset(String id, int version, int latestVersion, String mode) {}

  /**
   * A policy's settings.
   *
   * @param categorySettings the settings of every category, by category: {@code sexual}, {@code
   *     violence}, {@code self-harm}, {@code harassment}, {@code hate}, {@code criminal-activity},
   *     {@code personal-information} and {@code profanity}
   * @param linkSafety what happens to assets that link to unsafe destinations (preview), or null
   */
  public record PolicySettings(Map<String, PolicyCategorySettings> categorySettings, LinkSafetySettings linkSafety) {
    /** Copies collections so the record stays immutable. */
    public PolicySettings { categorySettings = map(categorySettings); }
  }

  /**
   * What a policy does with one category.
   *
   * @param action the action when the category's policy score reaches 0.5: {@code allow}, {@code
   *     limit}, {@code age-restrict}, {@code block} or {@code purge}
   * @param allowances contexts that let content through, or act on it more softly; send an empty
   *     list for none
   * @param restrictions conditions that act on matching content; they outweigh allowances; send an
   *     empty list for none
   */
  public record PolicyCategorySettings(String action, List<PolicyRuleSnapshot> allowances, List<PolicyRuleSnapshot> restrictions) {
    /** Copies collections so the record stays immutable. */
    public PolicyCategorySettings { allowances = list(allowances); restrictions = list(restrictions); }
  }

  /**
   * One page of the organisation's policies, oldest first unless {@code sort} says otherwise.
   *
   * @param items policies on this page
   * @param nextCursor pass as {@code cursor} to get the next page; null on the last page
   * @param hasMore whether another page follows
   */
  public record PolicyPage(List<Policy> items, String nextCursor, boolean hasMore) implements CursorPage<Policy> {
    /** Copies collections; a missing item list becomes empty. */
    public PolicyPage { items = listOrEmpty(items); }
  }

  /** Options for {@code policies.list} and {@code policies.iterate}. */
  public static final class ListPolicies {
    private String cursor;
    private Integer pageSize;
    private String sort;
    public ListPolicies() {}
    /** @param value the previous page's {@code nextCursor} @return these options */
    public ListPolicies cursor(String value) { cursor = value; return this; }
    /** @param value policies per page, 1 to 100 (default 50) @return these options */
    public ListPolicies pageSize(Integer value) { pageSize = value; return this; }
    /** @param value comma-separated {@code createdAt} and {@code id}, descending when prefixed with {@code -}; oldest first when unset @return these options */
    public ListPolicies sort(String value) { sort = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Identifies one policy, for {@code policies.retrieve}, {@code policies.delete} and {@code policies.assign}. */
  public static final class PolicyId {
    private String policyId;
    public PolicyId() {}
    /** @param policyId the policy ID */
    public PolicyId(String policyId) { this.policyId = policyId; }
    public PolicyId policyId(String value) { policyId = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * Options for {@code policies.create}: {@code settings} with a {@code name}, or {@code presetId}
   * to copy the latest release of a built-in preset.
   */
  public static final class CreatePolicy {
    private String name;
    private String description;
    private PolicySettings settings;
    private String presetId;
    public CreatePolicy() {}
    /** @param value display name; a copy of a preset defaults to its name @return these options */
    public CreatePolicy name(String value) { name = value; return this; }
    public CreatePolicy description(String value) { description = value; return this; }
    /** @param value settings defining every category @return these options */
    public CreatePolicy settings(PolicySettings value) { settings = value; return this; }
    /** @param value a built-in preset, such as {@code children-platform} @return these options */
    public CreatePolicy presetId(String value) { presetId = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code policies.update}; unset fields keep their value. A policy changed since {@code revision} is refused. */
  public static final class UpdatePolicy {
    private String policyId;
    private Integer revision;
    private String name;
    private String description;
    private PolicySettings settings;
    public UpdatePolicy() {}
    /** @param policyId the policy @param revision its current revision */
    public UpdatePolicy(String policyId, int revision) { this.policyId = policyId; this.revision = revision; }
    public UpdatePolicy policyId(String value) { policyId = value; return this; }
    public UpdatePolicy revision(Integer value) { revision = value; return this; }
    public UpdatePolicy name(String value) { name = value; return this; }
    public UpdatePolicy description(String value) { description = value; return this; }
    /** @param value the complete new settings, defining every category @return these options */
    public UpdatePolicy settings(PolicySettings value) { settings = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * Options for {@code policies.reset}: restores the settings of the preset release a {@code
   * pinned} or {@code copy} policy is at, discarding its edits.
   */
  public static final class ResetPolicy {
    private String policyId;
    private Integer revision;
    private Integer presetVersion;
    public ResetPolicy() {}
    /**
     * @param policyId the policy
     * @param revision its current revision
     * @param presetVersion the {@code preset.version} you reviewed
     */
    public ResetPolicy(String policyId, int revision, int presetVersion) {
      this.policyId = policyId; this.revision = revision; this.presetVersion = presetVersion;
    }
    public ResetPolicy policyId(String value) { policyId = value; return this; }
    public ResetPolicy revision(Integer value) { revision = value; return this; }
    public ResetPolicy presetVersion(Integer value) { presetVersion = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * Options for {@code policies.upgrade}: moves a {@code pinned} or {@code copy} policy whose
   * settings are unchanged from its preset release to the latest release.
   */
  public static final class UpgradePolicy {
    private String policyId;
    private Integer revision;
    private Integer presetVersion;
    public UpgradePolicy() {}
    /**
     * @param policyId the policy
     * @param revision its current revision
     * @param presetVersion the {@code preset.latestVersion} you reviewed
     */
    public UpgradePolicy(String policyId, int revision, int presetVersion) {
      this.policyId = policyId; this.revision = revision; this.presetVersion = presetVersion;
    }
    public UpgradePolicy policyId(String value) { policyId = value; return this; }
    public UpgradePolicy revision(Integer value) { revision = value; return this; }
    public UpgradePolicy presetVersion(Integer value) { presetVersion = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * Options for {@code policies.setAutomaticUpdates} on the organisation's own preset policy.
   * Switching on makes a {@code pinned} policy {@code live}, replacing its changes with the latest
   * preset; switching off pins a {@code live} policy at its current preset release.
   */
  public static final class SetPolicyAutomaticUpdates {
    private String policyId;
    private Boolean enabled;
    private Integer revision;
    private Integer presetVersion;
    public SetPolicyAutomaticUpdates() {}
    /**
     * @param policyId the organisation's own preset policy
     * @param enabled whether it follows the preset
     * @param revision its current revision
     * @param presetVersion the preset's {@code latestVersion} you reviewed
     */
    public SetPolicyAutomaticUpdates(String policyId, boolean enabled, int revision, int presetVersion) {
      this.policyId = policyId; this.enabled = enabled; this.revision = revision; this.presetVersion = presetVersion;
    }
    public SetPolicyAutomaticUpdates policyId(String value) { policyId = value; return this; }
    public SetPolicyAutomaticUpdates enabled(Boolean value) { enabled = value; return this; }
    public SetPolicyAutomaticUpdates revision(Integer value) { revision = value; return this; }
    public SetPolicyAutomaticUpdates presetVersion(Integer value) { presetVersion = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  // ------------------------------------------------------------------ Configuration

  /**
   * An upload preset: the rules for uploads from browsers and apps.
   *
   * @param id upload preset ID
   * @param projectId project it belongs to
   * @param createdByUserId who created it, or null
   * @param key stable identifier, unique in the project
   * @param revision changes with every saved change; send it to {@code uploadPresets.ensure} to refuse a change made since
   * @param name display name
   * @param access {@code token} or {@code anyone}
   * @param enabled whether it accepts uploads
   * @param allowedContentTypes MIME types it accepts, or null for any supported type
   * @param maxSizeInBytes largest upload it accepts, or null for the standard limits
   * @param folderId folder uploads go into, or null for the project's root
   * @param policyId moderation policy for its uploads, or null for the project's policy
   * @param visibility visibility of uploaded assets
   * @param processingOptions processing options for every upload through it, or null
   * @param revealDecision whether browser uploads see the moderation decision for their own upload
   * @param dailyUploadLimit most uploads it accepts from each client per UTC day, or null
   * @param allowedOrigins sites allowed to upload from the browser, or null for any site
   * @param createdAt creation time
   * @param updatedAt last change
   */
  public record UploadPreset(String id, String projectId, String createdByUserId, String key, Integer revision, String name,
      String access, Boolean enabled, List<String> allowedContentTypes, Long maxSizeInBytes, String folderId, String policyId,
      Visibility visibility, ProcessingOptions processingOptions, Boolean revealDecision, Integer dailyUploadLimit,
      List<String> allowedOrigins,
      @JsonAdapter(Json.EpochMillis.class) Instant createdAt,
      @JsonAdapter(Json.EpochMillis.class) Instant updatedAt) {
    /** Copies collections so the record stays immutable. */
    public UploadPreset { allowedContentTypes = list(allowedContentTypes); allowedOrigins = list(allowedOrigins); }
  }

  /**
   * One page of the project's upload presets, oldest first unless {@code sort} says otherwise.
   *
   * @param items upload presets on this page
   * @param nextCursor pass as {@code cursor} to get the next page; null on the last page
   * @param hasMore whether another page follows
   */
  public record UploadPresetPage(List<UploadPreset> items, String nextCursor, boolean hasMore) implements CursorPage<UploadPreset> {
    /** Copies collections; a missing item list becomes empty. */
    public UploadPresetPage { items = listOrEmpty(items); }
  }

  /**
   * What {@code uploadPresets.ensure} stored.
   *
   * @param uploadPresets the stored presets, in the order they were sent
   */
  public record EnsureUploadPresetsResponse(List<UploadPreset> uploadPresets) {
    /** Copies collections; a missing list becomes empty. */
    public EnsureUploadPresetsResponse { uploadPresets = listOrEmpty(uploadPresets); }
  }

  /** Options for {@code uploadPresets.list} and {@code uploadPresets.iterate}. */
  public static final class ListUploadPresets {
    private String cursor;
    private Integer pageSize;
    private String sort;
    public ListUploadPresets() {}
    /** @param value the previous page's {@code nextCursor} @return these options */
    public ListUploadPresets cursor(String value) { cursor = value; return this; }
    /** @param value upload presets per page, 1 to 100 (default 50) @return these options */
    public ListUploadPresets pageSize(Integer value) { pageSize = value; return this; }
    /** @param value comma-separated {@code createdAt} and {@code id}, descending when prefixed with {@code -}; oldest first when unset @return these options */
    public ListUploadPresets sort(String value) { sort = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Identifies one upload preset, for {@code uploadPresets.delete}. */
  public static final class UploadPresetId {
    private String uploadPresetId;
    public UploadPresetId() {}
    /** @param uploadPresetId the upload preset ID */
    public UploadPresetId(String uploadPresetId) { this.uploadPresetId = uploadPresetId; }
    public UploadPresetId uploadPresetId(String value) { uploadPresetId = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * One upload preset's whole definition for {@code uploadPresets.ensure}, by key. Fields left unset
   * take their defaults, so the stored preset matches what was sent.
   */
  public static final class UploadPresetDefinition {
    private String key;
    private Integer revision;
    private String name;
    private String access;
    private Boolean enabled;
    private Patch<List<String>> allowedContentTypes;
    private Patch<Long> maxSizeInBytes;
    private Patch<String> folderId;
    private Patch<String> policyId;
    private Visibility visibility;
    private Patch<ProcessingOptions> processingOptions;
    private Boolean revealDecision;
    private Patch<Integer> dailyUploadLimit;
    private Patch<List<String>> allowedOrigins;
    public UploadPresetDefinition() {}
    /** @param key stable identifier, unique in the project @param name display name */
    public UploadPresetDefinition(String key, String name) { this.key = key; this.name = name; }
    public UploadPresetDefinition key(String value) { key = value; return this; }
    /** @param value the revision you read, or 0 for a preset that must not exist yet; a preset changed since is refused @return this definition */
    public UploadPresetDefinition revision(Integer value) { revision = value; return this; }
    public UploadPresetDefinition name(String value) { name = value; return this; }
    /** @param value {@code token} (the default) or {@code anyone}, which needs a {@code dailyUploadLimit} @return this definition */
    public UploadPresetDefinition access(String value) { access = value; return this; }
    /** @param value whether the preset accepts uploads (default true) @return this definition */
    public UploadPresetDefinition enabled(Boolean value) { enabled = value; return this; }
    /** @param value MIME types it accepts, such as {@code image/*}; null or empty accepts any supported type @return this definition */
    public UploadPresetDefinition allowedContentTypes(List<String> value) { allowedContentTypes = patch(value == null ? null : List.copyOf(value)); return this; }
    /** @param value largest upload it accepts, in bytes; null uses the standard limits @return this definition */
    public UploadPresetDefinition maxSizeInBytes(Long value) { maxSizeInBytes = patch(value); return this; }
    /** @param value folder uploads go into; null uses the project's root @return this definition */
    public UploadPresetDefinition folderId(String value) { folderId = patch(value); return this; }
    /** @param value moderation policy for its uploads; null uses the project's policy @return this definition */
    public UploadPresetDefinition policyId(String value) { policyId = patch(value); return this; }
    /** @param value visibility of uploaded assets (default private) @return this definition */
    public UploadPresetDefinition visibility(Visibility value) { visibility = value; return this; }
    /** @param value processing options for every upload through the preset, or null @return this definition */
    public UploadPresetDefinition processingOptions(ProcessingOptions value) { processingOptions = patch(value); return this; }
    /** @param value whether browser uploads see the decision for their own upload (default false) @return this definition */
    public UploadPresetDefinition revealDecision(Boolean value) { revealDecision = value; return this; }
    /** @param value most uploads it accepts from each client per UTC day; required when access is {@code anyone} @return this definition */
    public UploadPresetDefinition dailyUploadLimit(Integer value) { dailyUploadLimit = patch(value); return this; }
    /** @param value sites allowed to upload from the browser; null or empty allows any site @return this definition */
    public UploadPresetDefinition allowedOrigins(List<String> value) { allowedOrigins = patch(value == null ? null : List.copyOf(value)); return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code uploadPresets.ensure}. */
  public static final class EnsureUploadPresets {
    private List<UploadPresetDefinition> uploadPresets;
    public EnsureUploadPresets() {}
    /** @param uploadPresets the presets to create or replace */
    public EnsureUploadPresets(List<UploadPresetDefinition> uploadPresets) { this.uploadPresets = uploadPresets; }
    public EnsureUploadPresets uploadPresets(List<UploadPresetDefinition> value) { uploadPresets = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * Restricts the domains a project accepts when content is submitted by URL, including websites.
   *
   * @param mode {@code allow} accepts only the listed domains; {@code deny} accepts every domain except them
   * @param domains the domains
   */
  public record RemoteUrlRule(String mode, List<String> domains) {
    /** Copies collections so the record stays immutable. */
    public RemoteUrlRule { domains = list(domains); }
  }

  /**
   * Which automated decisions are sampled into the human review queue.
   *
   * @param allowedSamplePercent percentage of allowed assets to sample
   * @param restrictedSamplePercent percentage of restricted assets to sample
   * @param uncertaintyMarginPercent how close to a threshold a score queues the asset
   * @param reviewMissingEvidence whether assets with missing evidence are queued
   */
  public record HumanReviewSettings(Double allowedSamplePercent, Double restrictedSamplePercent,
      Double uncertaintyMarginPercent, Boolean reviewMissingEvidence) {
    /** No settings set. */
    public HumanReviewSettings() { this(null, null, null, null); }

    /** @param value percentage of allowed assets to sample @return a copy with this setting */
    public HumanReviewSettings allowedSamplePercent(Double value) { return new HumanReviewSettings(value, restrictedSamplePercent, uncertaintyMarginPercent, reviewMissingEvidence); }

    /** @param value percentage of restricted assets to sample @return a copy with this setting */
    public HumanReviewSettings restrictedSamplePercent(Double value) { return new HumanReviewSettings(allowedSamplePercent, value, uncertaintyMarginPercent, reviewMissingEvidence); }

    /** @param value how close to a threshold a score queues the asset @return a copy with this setting */
    public HumanReviewSettings uncertaintyMarginPercent(Double value) { return new HumanReviewSettings(allowedSamplePercent, restrictedSamplePercent, value, reviewMissingEvidence); }

    /** @param value whether assets with missing evidence are queued @return a copy with this setting */
    public HumanReviewSettings reviewMissingEvidence(Boolean value) { return new HumanReviewSettings(allowedSamplePercent, restrictedSamplePercent, uncertaintyMarginPercent, value); }
  }

  /**
   * A project's settings, with defaults filled in.
   *
   * @param optOutJurisdictions optional standards the project doesn't serve, such as {@code EU}
   * @param retainContent whether new uploads keep their content after processing
   * @param blockUnmoderatedAssets whether the CDN refuses to serve assets whose moderation is pending
   * @param storeSensitiveMetadata whether uploaded images keep their embedded metadata
   * @param streamingEnabled whether audio and video uploads that keep their content get an adaptive stream
   * @param linkCheckingEnabled whether paid link checks are enabled
   * @param aiMediaSearchEnabled whether audio and video are indexed for AI search
   * @param remoteUrlRule the domains accepted when content is submitted by URL, or null for every public domain
   * @param websiteSubmissionsPerMinute how many websites the project can submit per minute, or null for the platform limit
   * @param humanReview which automated decisions are sampled into the human review queue
   */
  public record ProjectSettings(Boolean retainContent, List<String> optOutJurisdictions, Boolean blockUnmoderatedAssets, Boolean storeSensitiveMetadata,
      Boolean streamingEnabled, Boolean aiMediaSearchEnabled, Boolean linkCheckingEnabled, RemoteUrlRule remoteUrlRule, Integer websiteSubmissionsPerMinute,
      HumanReviewSettings humanReview) {
    /** Copies collections so the record stays immutable. */
    public ProjectSettings { optOutJurisdictions = list(optOutJurisdictions); }
  }

  /**
   * A project's settings and their revision.
   *
   * @param projectId the project
   * @param revision changes with every real change; metadata fields share it
   * @param settings the settings
   */
  public record ProjectSettingsResource(String projectId, Integer revision, ProjectSettings settings) {}

  /** The settings to save with {@code projectSettings.update}. Settings left unset return to their defaults. */
  public static final class ProjectSettingsInput {
    private Boolean retainContent;
    /** @param value whether to retain new uploads (default true) @return these settings */
    public ProjectSettingsInput retainContent(Boolean value) { retainContent = value; return this; }
    private List<String> optOutJurisdictions;
    private Boolean blockUnmoderatedAssets;
    private Boolean storeSensitiveMetadata;
    private Boolean streamingEnabled;
    private Boolean aiMediaSearchEnabled;
    private Boolean linkCheckingEnabled;
    private Patch<RemoteUrlRule> remoteUrlRule;
    private Patch<Integer> websiteSubmissionsPerMinute;
    private HumanReviewSettings humanReview;
    public ProjectSettingsInput() {}
    /** @param value optional standards the project doesn't serve, such as {@code EU} (default none) @return these settings */
    public ProjectSettingsInput optOutJurisdictions(List<String> value) { optOutJurisdictions = value == null ? null : List.copyOf(value); return this; }
    /** @param value whether the CDN refuses to serve assets whose moderation is pending (default true) @return these settings */
    public ProjectSettingsInput blockUnmoderatedAssets(Boolean value) { blockUnmoderatedAssets = value; return this; }
    /** @param value whether uploaded images keep their embedded metadata (default false) @return these settings */
    public ProjectSettingsInput storeSensitiveMetadata(Boolean value) { storeSensitiveMetadata = value; return this; }
    /** @param value whether audio and video uploads that keep their content get an adaptive stream (default false) @return these settings */
    public ProjectSettingsInput streamingEnabled(Boolean value) { streamingEnabled = value; return this; }
    /** @param value whether audio and video are indexed for AI search (default false) @return these settings */
    /** @param value whether to enable paid link checks @return these settings */
    public ProjectSettingsInput linkCheckingEnabled(Boolean value) { linkCheckingEnabled = value; return this; }
    public ProjectSettingsInput aiMediaSearchEnabled(Boolean value) { aiMediaSearchEnabled = value; return this; }
    /** @param value the domains accepted when content is submitted by URL; null accepts every public domain @return these settings */
    public ProjectSettingsInput remoteUrlRule(RemoteUrlRule value) { remoteUrlRule = patch(value); return this; }
    /** @param value how many websites the project can submit per minute; null uses the platform limit @return these settings */
    public ProjectSettingsInput websiteSubmissionsPerMinute(Integer value) { websiteSubmissionsPerMinute = patch(value); return this; }
    /** @param value which automated decisions are sampled into the human review queue @return these settings */
    public ProjectSettingsInput humanReview(HumanReviewSettings value) { humanReview = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code projectSettings.update}, which replaces the settings. */
  public static final class UpdateProjectSettings {
    private Integer revision;
    private ProjectSettingsInput settings;
    private Double searchIndexingBudgetUnits;
    public UpdateProjectSettings() {}
    /** @param settings the complete settings */
    public UpdateProjectSettings(ProjectSettingsInput settings) { this.settings = settings; }
    /** @param value the revision you read; settings changed since are refused @return these options */
    public UpdateProjectSettings revision(Integer value) { revision = value; return this; }
    public UpdateProjectSettings settings(ProjectSettingsInput value) { settings = value; return this; }
    /** @param value needed when turning on {@code aiMediaSearchEnabled}: the most indexing units you accept for existing media @return these options */
    public UpdateProjectSettings searchIndexingBudgetUnits(Double value) { searchIndexingBudgetUnits = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * A metadata field definition.
   *
   * @param id field identifier
   * @param title display title
   * @param description what the field holds, or null
   * @param type {@code string}, {@code number}, {@code boolean}, {@code date} or {@code url}
   * @param icon {@code folder}, {@code hash}, {@code layers}, {@code link}, {@code photo}, {@code tag} or {@code user}
   * @param color display color, such as {@code #2563eb}
   */
  public record MetadataField(String id, String title, String description, String type, String icon, String color) {
    /** A field without a description. @param id field identifier @param title display title @param type value type @param icon icon @param color display color */
    public MetadataField(String id, String title, String type, String icon, String color) { this(id, title, null, type, icon, color); }
  }

  /**
   * A project's metadata fields and their revision.
   *
   * @param projectId the project
   * @param revision shared with the project's settings
   * @param fields the field definitions
   */
  public record MetadataFieldsResource(String projectId, Integer revision, List<MetadataField> fields) {
    /** Copies collections; a missing list becomes empty. */
    public MetadataFieldsResource { fields = listOrEmpty(fields); }
  }

  /** Options for {@code metadataFields.ensure}: fields to create or replace by ID; other fields are kept. */
  public static final class EnsureMetadataFields {
    private Integer revision;
    private List<MetadataField> fields;
    public EnsureMetadataFields() {}
    /** @param fields the fields to create or replace */
    public EnsureMetadataFields(List<MetadataField> fields) { this.fields = fields; }
    /** @param value the revision you read; fields changed since are refused @return these options */
    public EnsureMetadataFields revision(Integer value) { revision = value; return this; }
    public EnsureMetadataFields fields(List<MetadataField> value) { fields = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code metadataFields.delete}. */
  public static final class DeleteMetadataField {
    private String fieldId;
    private Integer revision;
    public DeleteMetadataField() {}
    /** @param fieldId the field ID */
    public DeleteMetadataField(String fieldId) { this.fieldId = fieldId; }
    public DeleteMetadataField fieldId(String value) { fieldId = value; return this; }
    /** @param value the revision you read; fields changed since are refused @return these options */
    public DeleteMetadataField revision(Integer value) { revision = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /**
   * One registered event fact. Render {@code url} only after checking it (see the events docs).
   *
   * @param key fact key, such as {@code flagged-categories}
   * @param value fact value
   * @param url link for the fact, if any
   */
  public record EventFact(String key, Object value, String url) {}

  /**
   * Who caused an event.
   *
   * @param type {@code user} for a person in the portal (or an assistant acting for one), {@code
   *     api-key} for an API key, {@code automated} for automated moderation or {@code system} for
   *     CalmLens itself
   * @param id the user's or API key's ID; null when it was not recorded, and for {@code automated}
   *     and {@code system}
   */
  public record EventActor(String type, String id) {}

  /**
   * The asset's state when an event was created.
   *
   * @param id asset ID
   * @param externalId the asset's external ID
   * @param uploadPresetId upload preset used to create the asset, or null
   * @param upload upload status at the time
   * @param classification classification status and moderation decision at the time
   * @param content content status at the time
   */
  public record EventAsset(String id, String externalId, String uploadPresetId, EventAssetUpload upload, EventAssetClassification classification, EventAssetContent content) {}

  /** @param status the asset's classification status */
  public record EventAssetUpload(String status) {}

  /**
   * @param status the asset's classification status
   * @param testInput whether the results came from one of the project's test inputs rather than
   *     analysing the content; never use test results, such as age ranges, for real decisions
   * @param moderation the moderation decision at the time
   */
  public record EventAssetClassification(AssetClassificationStatus status, Boolean testInput, EventAssetModeration moderation) {}

  /** @param status the moderation decision in force */
  public record EventAssetModeration(AssetModerationStatus status) {}

  /** @param status whether CalmLens held the content */
  public record EventAssetContent(AssetContentStatus status) {}

  /**
   * An event from the events feed. Webhook deliveries carry events in the same shape ({@link
   * WebhookEventPayload}).
   *
   * @param id event ID; deliveries of the same event share it
   * @param projectId owning project
   * @param actor who caused the event
   * @param type event type, such as {@code asset.blocked}
   * @param severity severity
   * @param title short summary
   * @param description longer explanation, or null
   * @param assetId asset the event is about, or null
   * @param assetSequence increases with each event about the asset; null for events not about an
   *     asset. Deliveries can arrive out of order: see {@code CalmLensServerClient.isNewerAssetEvent}
   * @param asset snapshot of the asset's decision, or null; retrieve the asset for its current state
   * @param facts registered facts (never null)
   * @param createdAt creation time
   * @param json the event's JSON object as the API sent it, fields this SDK version does not model
   *     included; null for an event built in code
   */
  public record Event(String id, String projectId, EventActor actor, String type, String severity, String title, String description,
      String assetId, Long assetSequence, EventAsset asset, List<EventFact> facts,
      @JsonAdapter(Json.EpochMillis.class) Instant createdAt, Map<String, Object> json) {
    /** Copies facts; missing facts become an empty list. */
    public Event { facts = listOrEmpty(facts); json = json == null ? null : Collections.unmodifiableMap(new LinkedHashMap<>(json)); }

    /**
     * An event built in code, without received JSON.
     *
     * @param id event ID
     * @param projectId owning project
     * @param actor who caused the event
     * @param type event type
     * @param severity severity
     * @param title short summary
     * @param description longer explanation, or null
     * @param assetId asset the event is about, or null
     * @param assetSequence the event's number among those about its asset, or null
     * @param asset snapshot of the asset, or null
     * @param facts registered facts
     * @param createdAt creation time
     */
    public Event(String id, String projectId, EventActor actor, String type, String severity, String title, String description,
        String assetId, Long assetSequence, EventAsset asset, List<EventFact> facts, Instant createdAt) {
      this(id, projectId, actor, type, severity, title, description, assetId, assetSequence, asset, facts, createdAt, null);
    }

    Event withJson(Map<String, Object> value) {
      return new Event(id, projectId, actor, type, severity, title, description, assetId, assetSequence, asset, facts, createdAt, value);
    }
  }

  /**
   * One page of the events feed.
   *
   * @param items events, oldest first
   * @param nextCursor pass as {@code cursor} to get newer events; never null, so persist it to resume
   * @param hasMore whether more events are available now
   * @param excludedTypes event types this feed never includes, because the API key lacks the
   *     permission to see them; give the key that permission to receive them
   */
  public record EventsPage(List<Event> items, String nextCursor, boolean hasMore, List<String> excludedTypes) {
    /** Copies the lists; a missing list becomes empty. */
    public EventsPage {
      items = listOrEmpty(items);
      excludedTypes = listOrEmpty(excludedTypes);
    }
  }

  /**
   * The JSON body of a webhook delivery: the event in the shape {@code events.list} returns it. Get
   * it from {@code CalmLensServerClient.parseWebhookEvent}. Serialized with Gson it is written as
   * {@link #json()} when it has one, so fields this SDK version does not model survive.
   *
   * @param id event ID; the same on every retry, so use it to skip duplicates
   * @param projectId owning project
   * @param actor who caused the event
   * @param type event type, such as {@code asset.blocked}
   * @param severity severity
   * @param title short summary
   * @param description longer explanation, or null
   * @param assetId asset the event is about, or null
   * @param assetSequence increases with each event about the asset; null for events not about an
   *     asset. Deliveries can arrive out of order: see {@code CalmLensServerClient.isNewerAssetEvent}
   * @param asset snapshot of the asset's decision, or null; retrieve the asset for its current state
   * @param facts registered facts (never null)
   * @param createdAt event creation time
   * @param json the whole body as received (or as {@code toWebhookEventPayload} builds it), fields
   *     this SDK version does not model included; null for a payload built in code
   */
  public record WebhookEventPayload(String id, String projectId, EventActor actor, String type, String severity, String title, String description,
      String assetId, Long assetSequence, EventAsset asset, List<EventFact> facts,
      @JsonAdapter(Json.EpochMillis.class) Instant createdAt, Map<String, Object> json) {
    /** Copies facts and the JSON object; missing facts become an empty list. */
    public WebhookEventPayload {
      facts = listOrEmpty(facts);
      json = json == null ? null : Collections.unmodifiableMap(new LinkedHashMap<>(json));
    }

    /**
     * A payload built in code, without received JSON.
     *
     * @param id event ID
     * @param projectId owning project
     * @param actor who caused the event
     * @param type event type
     * @param severity severity
     * @param title short summary
     * @param description longer explanation, or null
     * @param assetId asset the event is about, or null
     * @param assetSequence the event's number among those about its asset, or null
     * @param asset snapshot of the asset, or null
     * @param facts registered facts
     * @param createdAt event creation time
     */
    public WebhookEventPayload(String id, String projectId, EventActor actor, String type, String severity, String title, String description,
        String assetId, Long assetSequence, EventAsset asset, List<EventFact> facts, Instant createdAt) {
      this(id, projectId, actor, type, severity, title, description, assetId, assetSequence, asset, facts, createdAt, null);
    }

    WebhookEventPayload withJson(Map<String, Object> value) {
      return new WebhookEventPayload(id, projectId, actor, type, severity, title, description, assetId, assetSequence, asset, facts, createdAt, value);
    }
  }

  /**
   * A lens: a named image transform the CDN applies at {@code /@<identifier>}. The CDN serves files
   * made with its current definition.
   *
   * @param id lens ID
   * @param identifier stable identifier used in CDN URLs
   * @param name display name
   * @param type lens type
   * @param active whether the CDN serves the lens
   * @param projectId owning project
   * @param createdAt creation time
   * @param updatedAt last update time
   * @param description description
   * @param transform image transform options
   */
  public record Lens(String id, String identifier, String name, String type, Boolean active,
      String projectId,
      @JsonAdapter(Json.EpochMillis.class) Instant createdAt,
      @JsonAdapter(Json.EpochMillis.class) Instant updatedAt,
      String description, ImageTransformOptions transform) {}

  /**
   * One page of the project's lenses, newest first unless {@code sort} says otherwise. The built-in
   * lenses are always available and aren't listed.
   *
   * @param items lenses on this page
   * @param nextCursor pass as {@code cursor} to get the next page; null on the last page
   * @param hasMore whether another page follows
   */
  public record LensPage(List<Lens> items, String nextCursor, boolean hasMore) implements CursorPage<Lens> {
    /** Copies collections; a missing item list becomes empty. */
    public LensPage { items = listOrEmpty(items); }
  }

  /**
   * A signed asset URL, or a resource URL beneath it. It grants access until it expires, so {@link
   * #toString()} hides its grant and query.
   *
   * @param url the signed URL
   * @param expiresAt expiry time
   */
  public record SignedAssetUrl(String url, @JsonAdapter(Json.EpochMillis.class) Instant expiresAt) {
    @Override public String toString() {
      String shown = url == null ? null : url.replaceAll("/sig_[^/?#]*", "/sig_[redacted]").replaceAll("\\?.*$", "?[redacted]");
      return "SignedAssetUrl[url=" + shown + ", expiresAt=" + expiresAt + "]";
    }
  }

  /** Whether the viewer an {@link AssetInfo} was read for can see the asset now. */
  public enum AssetAvailability {
    /** The viewer can see the content now. */
    @SerializedName("available") AVAILABLE("available"),
    /** The content needs the viewer's age confirmed ({@link ViewerClaims#ageConfirmed}). */
    @SerializedName("age-restricted") AGE_RESTRICTED("age-restricted"),
    /** The viewer can't see the content: it is held, blocked, not yet moderated or removed. */
    @SerializedName("unavailable") UNAVAILABLE("unavailable");

    private final String value;

    AssetAvailability(String value) { this.value = value; }

    /** @return the CDN value, such as {@code "age-restricted"} */
    public String value() { return value; }
  }

  /**
   * An asset's display info, the CDN's {@code info} resource: the public asset fields a viewer needs,
   * with the same names as on {@link Asset}, and whether this viewer can see it now. It never holds
   * moderation results, metadata, names, tags or extracted text.
   *
   * @param id the asset's ID
   * @param projectId the asset's project
   * @param type the asset's type, such as {@code image} or {@code video}
   * @param externalUrl a website's page, which a viewer links to; null for other assets
   * @param content the displayable content
   * @param availability whether the viewer the request's claims describe can see it; the CDN's
   *     resources refuse exactly what it refuses
   */
  public record AssetInfo(String id, String projectId, String type, String externalUrl, AssetInfoContent content, AssetAvailability availability) {}

  /**
   * The part of {@link AssetContent} that {@link AssetInfo} carries.
   *
   * @param format the content's MIME type; it tells a spreadsheet from other documents
   * @param width width in pixels; null when unknown or not visual
   * @param height height in pixels, like {@code width}
   * @param durationSeconds audio or video length; null for other content
   * @param pageCount a document's pages; null for other content
   * @param rendered the displayable file; null when there is none
   * @param preview the still image; null when there is none
   * @param hls the adaptive stream; null until one is prepared
   */
  public record AssetInfoContent(String format, Integer width, Integer height, Double durationSeconds, Integer pageCount,
      AssetRendered rendered, AssetPreview preview, AssetHls hls) {}

  /**
   * Your app's assertions about the viewer, added to a CDN URL (public or signed) as its
   * {@code viewerClaims} query. The defaults, no region and no age confirmation, are left out so
   * default URLs stay cacheable.
   */
  public static final class ViewerClaims {
    private String region;
    private Boolean ageConfirmed;
    /** @param value the viewer's country, an ISO 3166-1 alpha-2 code such as {@code DE} @return these claims */
    public ViewerClaims region(String value) { region = value; return this; }
    /**
     * Your platform's confirmation that the viewer passed its age check; defaults to false. Your
     * platform confirms the viewer's age; viewer claims are assertions from your app, and CalmLens
     * doesn't verify them. To control who loads an age-restricted asset, make it
     * private and sign its URL only for viewers whose age you confirmed.
     *
     * @param value whether your platform confirmed the viewer's age
     * @return these claims
     */
    public ViewerClaims ageConfirmed(Boolean value) { ageConfirmed = value; return this; }
  }

}
