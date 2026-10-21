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
 * AssetModerationStatus}, {@link AssetContentStatus} or {@link Visibility} values keep their raw
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

  private static <K, V> Map<K, V> map(Map<K, V> value) {
    return value == null ? null : Collections.unmodifiableMap(new LinkedHashMap<>(value));
  }

  // ------------------------------------------------------------------ Values

  /**
   * Where an asset is in the pipeline ({@code classification.status}). Known values are the constants
   * below and can be compared with {@code ==}; a status this SDK version does not know is kept with
   * its raw {@link #value()} and {@link #isKnown()} returns false.
   */
  @JsonAdapter(AssetClassificationStatus.Adapter.class)
  public static final class AssetClassificationStatus {
    /** The content is still arriving, such as the parts of a multipart upload. */
    public static final AssetClassificationStatus PENDING = new AssetClassificationStatus("pending");
    /** Queued or being classified. */
    public static final AssetClassificationStatus PROCESSING = new AssetClassificationStatus("processing");
    /** Processing finished; see {@code classification.moderation.decision} for the decision. */
    public static final AssetClassificationStatus COMPLETED = new AssetClassificationStatus("completed");
    /** Processing failed; {@code assets.retry} processes the asset again. */
    public static final AssetClassificationStatus FAILED = new AssetClassificationStatus("failed");
    private static final Map<String, AssetClassificationStatus> KNOWN = Map.of(
        "pending", PENDING, "processing", PROCESSING, "completed", COMPLETED, "failed", FAILED);
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
   * The moderation decision in force ({@code classification.moderation.decision}): a reviewer's decision when there
   * is one, otherwise the automated one. Unknown values are kept like {@link AssetClassificationStatus}.
   * Treat anything other than {@link #APPROVED} as not publishable.
   */
  @JsonAdapter(AssetModerationStatus.Adapter.class)
  public static final class AssetModerationStatus {
    /** No decision yet. */
    public static final AssetModerationStatus PENDING = new AssetModerationStatus("pending");
    /** Approved by moderation or a reviewer. */
    public static final AssetModerationStatus APPROVED = new AssetModerationStatus("approved");
    /** Rejected by moderation or a reviewer. */
    public static final AssetModerationStatus REJECTED = new AssetModerationStatus("rejected");
    private static final Map<String, AssetModerationStatus> KNOWN = Map.of("pending", PENDING, "approved", APPROVED, "rejected", REJECTED);
    private final String value;

    private AssetModerationStatus(String value) { this.value = value; }

    /**
     * @param value the API value, such as {@code "approved"}
     * @return the matching constant, or a new instance keeping an unknown value
     */
    public static AssetModerationStatus of(String value) {
      AssetModerationStatus known = KNOWN.get(Objects.requireNonNull(value, "value"));
      return known != null ? known : new AssetModerationStatus(value);
    }

    /** @return the API value, such as {@code "approved"} */
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
  public record MetadataItem(String id, Object value) {
    /** An empty item; set {@link #id(String)} and {@link #value(Object)}. */
    public MetadataItem() { this(null, null); }

    /** @param id the identifier @return a copy with this identifier */
    public MetadataItem id(String id) { return new MetadataItem(id, value); }

    /** @param value the value @return a copy with this value */
    public MetadataItem value(Object value) { return new MetadataItem(id, value); }
  }

  /**
   * One ordering clause for list requests.
   *
   * @param field field name, such as {@code createdAt}
   * @param direction {@code ASC} or {@code DESC}
   */
  public record Order(String field, String direction) {
    /** An empty clause. */
    public Order() { this(null, null); }

    /** @param field the field @return a copy ordering by this field */
    public Order field(String field) { return new Order(field, direction); }

    /** @param direction {@code ASC} or {@code DESC} @return a copy with this direction */
    public Order direction(String direction) { return new Order(field, direction); }
  }

  /**
   * What happens to flagged content for one asset, overriding the project's moderation action.
   *
   * @param action {@code ignore} takes no action, {@code alert} keeps delivery enabled, {@code hide}
   *     blocks delivery while keeping the content, and {@code purge} deletes it
   */
  public record FlaggedContentPolicy(String action) {
    /** No action set. */
    public FlaggedContentPolicy() { this(null); }

    /** @param value the action @return a copy with this action */
    public FlaggedContentPolicy action(String value) { return new FlaggedContentPolicy(value); }
  }

  /**
   * Turns one optional feature on or off. Features are off unless {@code enabled} is true.
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
   * Options for face detection (beta). Faces are located, never identified.
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
   * Optional analyses to run on an asset, keyed by feature. Each feature is off unless its {@code
   * enabled} is true. Results of person and face detection appear in {@link
   * AssetClassification#faceDetection()}; OCR stores extracted text on the image asset.
   *
   * @param ocr extract text onto the image asset and add text moderation
   * @param personDetection (beta) locate people in images
   * @param faceDetection (beta) locate faces in images and optionally estimate ages
   */
  public record ProcessingFeatures(FeatureOptions ocr, FeatureOptions personDetection, FaceDetectionOptions faceDetection) {
    /** No features set. */
    public ProcessingFeatures() { this(null, null, null); }

    /** @param value OCR options @return a copy with these options */
    public ProcessingFeatures ocr(FeatureOptions value) { return new ProcessingFeatures(value, personDetection, faceDetection); }

    /** @param value person detection options @return a copy with these options */
    public ProcessingFeatures personDetection(FeatureOptions value) { return new ProcessingFeatures(ocr, value, faceDetection); }

    /** @param value face detection options @return a copy with these options */
    public ProcessingFeatures faceDetection(FaceDetectionOptions value) { return new ProcessingFeatures(ocr, personDetection, value); }
  }

  /**
   * Processing options for an asset.
   *
   * @param keepContentAfterProcessing whether stored content is kept after classification
   * @param flaggedContentPolicy overrides the project's moderation action for this asset
   * @param features optional analyses to run, such as OCR
   */
  public record ProcessingOptions(Boolean keepContentAfterProcessing, FlaggedContentPolicy flaggedContentPolicy, ProcessingFeatures features) {
    /** No options set. */
    public ProcessingOptions() { this(null, null, null); }

    /** @param value whether to keep content @return a copy with this setting */
    public ProcessingOptions keepContentAfterProcessing(Boolean value) { return new ProcessingOptions(value, flaggedContentPolicy, features); }

    /** @param value the policy @return a copy with this setting */
    public ProcessingOptions flaggedContentPolicy(FlaggedContentPolicy value) { return new ProcessingOptions(keepContentAfterProcessing, value, features); }

    /** @param value optional features @return a copy with these features */
    public ProcessingOptions features(ProcessingFeatures value) { return new ProcessingOptions(keepContentAfterProcessing, flaggedContentPolicy, value); }
  }

  /**
   * A lens transform. Build image transforms with {@link #image(ImageTransformOptions)}. Pass one or
   * a list to {@code transform(...)} on {@link CdnRequest} or {@link SignedUrlOptions} to transform
   * an asset directly. A transform type this SDK version does not know is read with null options.
   *
   * @param type transform type, such as {@code imageTransform}
   * @param options the options of an {@code imageTransform}
   */
  @JsonAdapter(Transform.Adapter.class)
  public record Transform(String type, ImageTransformOptions options) {
    /** The only transform type the CDN accepts. */
    public static final String IMAGE = "imageTransform";

    /**
     * @param options image options
     * @return an {@code imageTransform}
     */
    public static Transform image(ImageTransformOptions options) { return new Transform(IMAGE, options); }

    static final class Adapter extends TypeAdapter<Transform> {
      @Override public void write(JsonWriter out, Transform transform) throws IOException {
        if (transform == null) { out.nullValue(); return; }
        out.beginObject();
        out.name("type").value(transform.type);
        out.name("options");
        if (transform.options == null) out.nullValue();
        else Json.GSON.toJson(Json.GSON.toJsonTree(transform.options), out);
        out.endObject();
      }

      @Override public Transform read(JsonReader in) throws IOException {
        if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
        JsonObject object = JsonParser.parseReader(in).getAsJsonObject();
        JsonElement type = object.get("type");
        String name = type == null || type.isJsonNull() ? null : type.getAsString();
        JsonElement options = object.get("options");
        if (!IMAGE.equals(name) || options == null || options.isJsonNull()) return new Transform(name, null);
        return new Transform(name, Json.GSON.fromJson(options, ImageTransformOptions.class));
      }
    }
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
   * Options of an {@code imageTransform}; set only what you need. Values with a fixed set, such as
   * {@code format} ({@code jpg}, {@code png}, {@code webp}, {@code avif}, {@code gif}), {@code fit}
   * ({@code scale-down}, {@code contain}, {@code pad}, {@code squeeze}, {@code cover}, {@code crop}),
   * {@code flip} ({@code h}, {@code v}, {@code hv}) and {@code segment} ({@code foreground}), are
   * strings so values added later still read.
   */
  public static final class ImageTransformOptions {
    private String format, background, fit, flip, segment;
    private Integer width, height, quality, rotate;
    private Double blur, brightness, contrast, gamma, saturation, sharpen;
    private ImageBorder border;
    private Gravity gravity;
    private Trim trim;

    /** No options set. */
    public ImageTransformOptions() {}

    public ImageTransformOptions format(String value) { format = value; return this; }
    public ImageTransformOptions width(Integer value) { width = value; return this; }
    public ImageTransformOptions height(Integer value) { height = value; return this; }
    public ImageTransformOptions background(String value) { background = value; return this; }
    public ImageTransformOptions blur(Double value) { blur = value; return this; }
    public ImageTransformOptions border(ImageBorder value) { border = value; return this; }
    public ImageTransformOptions brightness(Double value) { brightness = value; return this; }
    public ImageTransformOptions contrast(Double value) { contrast = value; return this; }
    /** @param value quality from 0 to 255 @return these options */
    public ImageTransformOptions quality(Integer value) { quality = value; return this; }
    public ImageTransformOptions fit(String value) { fit = value; return this; }
    public ImageTransformOptions flip(String value) { flip = value; return this; }
    public ImageTransformOptions gamma(Double value) { gamma = value; return this; }
    public ImageTransformOptions segment(String value) { segment = value; return this; }
    public ImageTransformOptions gravity(Gravity value) { gravity = value; return this; }
    /** @param value 0, 90, 180 or 270 degrees @return these options */
    public ImageTransformOptions rotate(Integer value) { rotate = value; return this; }
    public ImageTransformOptions saturation(Double value) { saturation = value; return this; }
    public ImageTransformOptions sharpen(Double value) { sharpen = value; return this; }
    public ImageTransformOptions trim(Trim value) { trim = value; return this; }

    /** @return the output format */
    public String format() { return format; }
    /** @return the width in pixels */
    public Integer width() { return width; }
    /** @return the height in pixels */
    public Integer height() { return height; }
    /** @return the background colour */
    public String background() { return background; }
    /** @return the blur radius */
    public Double blur() { return blur; }
    /** @return the border */
    public ImageBorder border() { return border; }
    /** @return the brightness factor */
    public Double brightness() { return brightness; }
    /** @return the contrast factor */
    public Double contrast() { return contrast; }
    /** @return the quality */
    public Integer quality() { return quality; }
    /** @return how the image fits the box */
    public String fit() { return fit; }
    /** @return the flip direction */
    public String flip() { return flip; }
    /** @return the gamma */
    public Double gamma() { return gamma; }
    /** @return the segmentation */
    public String segment() { return segment; }
    /** @return where to crop from */
    public Gravity gravity() { return gravity; }
    /** @return the rotation in degrees */
    public Integer rotate() { return rotate; }
    /** @return the saturation factor */
    public Double saturation() { return saturation; }
    /** @return the sharpen amount */
    public Double sharpen() { return sharpen; }
    /** @return what to trim */
    public Trim trim() { return trim; }

    @Override public boolean equals(Object other) {
      return other instanceof ImageTransformOptions o && Json.GSON.toJsonTree(o).equals(Json.GSON.toJsonTree(this));
    }
    @Override public int hashCode() { return Json.GSON.toJsonTree(this).hashCode(); }
    @Override public String toString() { return describe(this); }
  }

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
    public SubmitAsset externalId(String value) { externalId = value; return this; }
    public SubmitAsset externalUrl(String value) { externalUrl = value; return this; }
    public SubmitAsset folderId(Patch<String> value) { folderId = value; return this; }
    /** @param value the upload preset to apply: its folder, visibility, file types and size limit @return these options */
    public SubmitAsset uploadPresetId(String value) { uploadPresetId = value; return this; }
    public SubmitAsset sizeInBytes(Long value) { sizeInBytes = value; return this; }
    /** @param value the whole file's size, checked when a multipart upload starts @return these options */
    public SubmitAsset totalSizeInBytes(Long value) { totalSizeInBytes = value; return this; }

    Content contentValue() { return content; }
    Content partValue() { return part; }

    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code uploadTokens.sign}. */
  public static final class SignUploadToken {
    private String uploadPresetId;
    private String externalId;
    private Integer expiresInSeconds;

    /** Empty options. */
    public SignUploadToken() {}

    /** @param uploadPresetId the upload preset the token may upload through */
    public SignUploadToken(String uploadPresetId) { this.uploadPresetId = uploadPresetId; }

    public SignUploadToken uploadPresetId(String value) { uploadPresetId = value; return this; }
    /** @param value the external ID the uploaded asset gets; must not be empty @return these options */
    public SignUploadToken externalId(String value) { externalId = value; return this; }
    /** @param value lifetime in seconds, from 1 to 3600 (default 600) @return these options */
    public SignUploadToken expiresInSeconds(Integer value) { expiresInSeconds = value; return this; }

    String uploadPresetIdValue() { return uploadPresetId; }
    String externalIdValue() { return externalId; }
    Integer expiresInSecondsValue() { return expiresInSeconds; }

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
    private Integer limit;
    public SearchAssets() {}
    public SearchAssets query(String value) { query = value; return this; }
    /** @param value {@code keyword}, {@code semantic} or {@code hybrid} @return these options */
    public SearchAssets mode(String value) { mode = value; return this; }
    public SearchAssets limit(Integer value) { limit = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code assets.list} and {@code assets.iterate}. */
  public static final class ListAssets {
    private String cursor;
    private Integer pageSize;
    private String filter;
    private List<Order> ordering;
    public ListAssets() {}
    public ListAssets cursor(String value) { cursor = value; return this; }
    public ListAssets pageSize(Integer value) { pageSize = value; return this; }
    /** @param value a filter such as {@code classification.moderation.decision==approved} @return these options */
    public ListAssets filter(String value) { filter = value; return this; }
    public ListAssets ordering(List<Order> value) { ordering = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code assets.listChildren} and {@code assets.iterateChildren}. */
  public static final class ListChildren {
    private String assetId;
    private String cursor;
    private Integer pageSize;
    private String filter;
    private List<Order> ordering;
    public ListChildren() {}
    /** @param assetId the parent asset ID */
    public ListChildren(String assetId) { this.assetId = assetId; }
    public ListChildren assetId(String value) { assetId = value; return this; }
    public ListChildren cursor(String value) { cursor = value; return this; }
    public ListChildren pageSize(Integer value) { pageSize = value; return this; }
    public ListChildren filter(String value) { filter = value; return this; }
    public ListChildren ordering(List<Order> value) { ordering = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code assets.update}; unset fields keep their value. */
  public static final class UpdateAsset {
    private String assetId;
    private Patch<String> name;
    private Patch<String> description;
    private Patch<List<String>> tags;
    private Patch<List<MetadataItem>> metadata;
    private Patch<String> folderId;
    private Patch<String> externalId;
    private Patch<String> externalUrl;
    private Patch<Visibility> visibility;
    private Patch<ProcessingOptions> processingOptions;
    public UpdateAsset() {}
    /** @param assetId the asset to update */
    public UpdateAsset(String assetId) { this.assetId = assetId; }
    public UpdateAsset assetId(String value) { assetId = value; return this; }
    public UpdateAsset name(Patch<String> value) { name = value; return this; }
    public UpdateAsset description(Patch<String> value) { description = value; return this; }
    public UpdateAsset tags(Patch<List<String>> value) { tags = value; return this; }
    public UpdateAsset metadata(Patch<List<MetadataItem>> value) { metadata = value; return this; }
    public UpdateAsset folderId(Patch<String> value) { folderId = value; return this; }
    public UpdateAsset externalId(Patch<String> value) { externalId = value; return this; }
    public UpdateAsset externalUrl(Patch<String> value) { externalUrl = value; return this; }
    public UpdateAsset visibility(Patch<Visibility> value) { visibility = value; return this; }
    public UpdateAsset processingOptions(Patch<ProcessingOptions> value) { processingOptions = value; return this; }
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

  /** Options for {@code assets.uploadPart}: a later part of a multipart upload. */
  public static final class UploadPart {
    private String assetId;
    private Content part;
    private Boolean queue;
    public UploadPart() {}
    /** @param assetId the uploading asset @param part the part, with its part number and isFinal */
    public UploadPart(String assetId, Content part) { this.assetId = assetId; this.part = part; }
    public UploadPart assetId(String value) { assetId = value; return this; }
    public UploadPart part(Content value) { part = value; return this; }
    /**
     * Overrides the queue choice saved when the upload started; leave unset to use it.
     *
     * @param value true to queue processing, false to wait for classification
     * @return these options
     */
    public UploadPart queue(Boolean value) { queue = value; return this; }
    Content partValue() { return part; }
    @Override public String toString() { return describe(this); }
  }

  /** Options for {@code assets.createSignedUrl}. */
  public static final class SignedUrlOptions {
    private String assetId;
    private String resource;
    private String lens;
    private transient Object transform;
    private Long expiresInSeconds;
    public SignedUrlOptions() {}
    /** @param assetId the asset */
    public SignedUrlOptions(String assetId) { this.assetId = assetId; }
    public SignedUrlOptions assetId(String value) { assetId = value; return this; }
    public SignedUrlOptions resource(String value) { resource = value; return this; }
    public SignedUrlOptions lens(String value) { lens = value; return this; }
    /**
     * @param value a CDN selector, such as {@code imageTransform[format=png,width=1024]}
     * @return these options
     */
    public SignedUrlOptions transform(String value) { transform = value; return this; }
    /** @param value one transform step, serialized as a selector @return these options */
    public SignedUrlOptions transform(Transform value) { transform = value; return this; }
    /** @param value transform steps, applied in order; at least one @return these options */
    public SignedUrlOptions transform(List<Transform> value) { transform = value; return this; }
    Object transformValue() { return transform; }
    public SignedUrlOptions expiresInSeconds(Long value) { expiresInSeconds = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** One page of folders and the visible paths needed to reveal them. */
  public record FolderPage(List<Folder> folders, List<Folder> ancestors, boolean hasMore) {}
  public static final class ListFolders {
    private String parentId;
    private Integer pageIndex;
    private Integer pageSize;
    private String search;
    private Boolean searchAll;
    private Boolean resolveOnly;
    private List<String> ids;
    private String sort;
    private String direction;
    public ListFolders parentId(String value) { parentId = value; return this; }
    public ListFolders pageIndex(Integer value) { pageIndex = value; return this; }
    public ListFolders pageSize(Integer value) { pageSize = value; return this; }
    public ListFolders search(String value) { search = value; return this; }
    public ListFolders searchAll(Boolean value) { searchAll = value; return this; }
    public ListFolders resolveOnly(Boolean value) { resolveOnly = value; return this; }
    public ListFolders ids(List<String> value) { ids = value; return this; }
    public ListFolders sort(String value) { sort = value; return this; }
    public ListFolders direction(String value) { direction = value; return this; }
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

  /** Options for {@code events.list} and {@code events.pages}. */
  public static final class ListEvents {
    private String after;
    private Integer limit;
    public ListEvents() {}
    /** @param value a cursor from a previous page; omit for a cursor at the current time @return these options */
    public ListEvents after(String value) { after = value; return this; }
    public ListEvents limit(Integer value) { limit = value; return this; }
    @Override public String toString() { return describe(this); }
  }

  /** A lens definition for {@code ensureLens} and {@code ensureLenses}. */
  public static final class LensDefinition {
    private String identifier;
    private String name;
    private Patch<String> description;
    @SerializedName("type") private String lensType;
    private Boolean active;
    private Integer version;
    private Patch<List<Transform>> transforms;
    public LensDefinition() {}
    /**
     * @param identifier stable identifier used in CDN URLs
     * @param name display name
     * @param lensType lens type, such as {@code image}
     * @param active whether the lens is active
     * @param version version; raise it to change the transforms
     */
    public LensDefinition(String identifier, String name, String lensType, Boolean active, Integer version) {
      this.identifier = identifier; this.name = name; this.lensType = lensType; this.active = active; this.version = version;
    }
    public LensDefinition identifier(String value) { identifier = value; return this; }
    public LensDefinition name(String value) { name = value; return this; }
    public LensDefinition description(Patch<String> value) { description = value; return this; }
    /** @param value the lens type ({@code type} in the API) @return this definition */
    public LensDefinition lensType(String value) { lensType = value; return this; }
    public LensDefinition active(Boolean value) { active = value; return this; }
    public LensDefinition version(Integer value) { version = value; return this; }
    public LensDefinition transforms(Patch<List<Transform>> value) { transforms = value; return this; }
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

  /** Options for {@code cdn.getAssetUrl} and {@code cdn.serve}. A lens runs before any additional transforms. */
  public static final class CdnRequest {
    private String assetIdentifier;
    private String resource;
    private String lens;
    private transient Object transform;
    private HttpOptions init;
    public CdnRequest() {}
    /** @param assetIdentifier an asset ID or external ID */
    public CdnRequest(String assetIdentifier) { this.assetIdentifier = assetIdentifier; }
    public CdnRequest assetIdentifier(String value) { assetIdentifier = value; return this; }
    /** @param value {@code content} (default) or {@code preview} @return these options */
    public CdnRequest resource(String value) { resource = value; return this; }
    public CdnRequest lens(String value) { lens = value; return this; }
    /**
     * @param value a CDN selector, such as {@code imageTransform[format=png,width=1024]}
     * @return these options
     */
    public CdnRequest transform(String value) { transform = value; return this; }
    /** @param value one transform step, serialized as a selector @return these options */
    public CdnRequest transform(Transform value) { transform = value; return this; }
    /** @param value transform steps, applied in order; at least one @return these options */
    public CdnRequest transform(List<Transform> value) { transform = value; return this; }
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
   * @param userId creating user, if any
   * @param parentId parent asset for derived assets such as images extracted from documents
   * @param uploadPresetId upload preset the asset was uploaded through, if any
   * @param createdAt creation time
   * @param updatedAt last update time
   * @param description description
   * @param externalId your identifier for the asset
   * @param externalUrl your URL for the asset
   * @param tags tags
   * @param processingOptions processing options
   * @param visibility CDN visibility
   * @param upload receipt of source content
   * @param classification progress and capability results
   * @param content whether CalmLens holds the content, and its details
   */
  public record Asset(
      String id, String name, String projectId, String type, String folderId,
      List<MetadataItem> metadata, String userId, String parentId, String uploadPresetId,
      @JsonAdapter(Json.EpochMillis.class) Instant createdAt,
      @JsonAdapter(Json.EpochMillis.class) Instant updatedAt,
      String description, String externalId, String externalUrl, List<String> tags,
      ProcessingOptions processingOptions, Visibility visibility,
      AssetUpload upload, AssetClassification classification, AssetContent content) {
    /** Copies collections so the record stays immutable. */
    public Asset {
      metadata = list(metadata);
      tags = list(tags);
    }
  }

  /** Receipt of source content and multipart progress. */
  public record AssetUpload(String status, @JsonAdapter(Json.EpochMillis.class) Instant updatedAt, Integer partsReceived) {}

  /** Classification progress and results grouped by capability. */
  public record AssetClassification(AssetClassificationStatus status,
      @JsonAdapter(Json.EpochMillis.class) Instant updatedAt,
      @JsonAdapter(Json.EpochMillis.class) Instant completedAt,
      AssetModeration moderation, PersonDetectionResult personDetection,
      FaceDetectionResult faceDetection, List<ClassificationLabel> labels) {
    public AssetClassification { labels = list(labels); }
  }

  /** Content-safety findings, policy assessment and reviewer decision. */
  public record AssetModeration(AssetModerationStatus decision, String action,
      String reviewerAction, String reviewerNote, String reviewerUserId,
      @JsonAdapter(Json.EpochMillis.class) Instant reviewedAt,
      Map<String, CategoryResult> categories, Double score,
      MediaClassificationReport timeline, ReportPolicy policy) {
    public AssetModeration { categories = map(categories); }
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
   * @param image image dimensions and hash, for image assets
   * @param previewImage generated preview
   * @param extractedText text extracted from the content
   */
  public record AssetContent(AssetContentStatus status, String removalReason,
      @JsonAdapter(Json.EpochMillis.class) Instant updatedAt,
      SafetyHold safetyHold, String format, String extension, Long sizeInBytes, Checksums checksums,
      ImageData image, PreviewImage previewImage, ExtractedText extractedText) {}


  /**
   * Each assessed category's policy score and action, and the highest policy score.
   *
   * @param score the highest category policy score
   * @param categories policy results by category
   */
  public record ReportPolicy(Double score, Map<String, CategoryPolicyScore> categories, ReportPolicyDecision decision) {
    /** Copies collections so the record stays immutable. */
    public ReportPolicy { categories = map(categories); }
  }

  /**
   * How strongly a category meets the policy and what the policy does with it.
   *
   * @param score policy score from 0 to 1
   * @param action {@code ignore}, {@code alert}, {@code hide} or {@code purge}
   */
  public record CategoryPolicyScore(Double score, String action, CategoryPolicySource source,
      CategoryPolicySettingsSnapshot settings) {}

  /** The category threshold or rule that decided the outcome. */
  public record CategoryPolicySource(String kind, Integer index) {}

  /** A named rule as it was configured when the asset was decided. */
  public record PolicyRuleSnapshot(String name, List<String> when, String action) {
    public PolicyRuleSnapshot { when = list(when); }
  }

  /** Historical category settings used to explain the saved decision. */
  public record CategoryPolicySettingsSnapshot(Double threshold, String categoryAction,
      List<PolicyRuleSnapshot> allowances, List<PolicyRuleSnapshot> restrictions) {
    public CategoryPolicySettingsSnapshot { allowances = list(allowances); restrictions = list(restrictions); }
  }

  /** Final automatic action, flagged categories and decision source. */
  public record ReportPolicyDecision(String source, String action, List<String> flaggedCategories) {
    public ReportPolicyDecision { flaggedCategories = list(flaggedCategories); }
  }

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
   * A detected label.
   *
   * @param description label text
   * @param score confidence
   * @param topicalityScore topicality
   * @param likelihood likelihood bucket
   * @param knowledgeBaseId knowledge base identifier
   */
  public record ClassificationLabel(String description, Double score, Double topicalityScore, String likelihood, String knowledgeBaseId) {}

  /**
   * Results of the optional features requested in {@code processingOptions.features}. A feature
   * that was not requested is null. Results are informational and never change the decision.
   *
   * @param personDetection person detection result (beta)
   * @param faceDetection face detection result (beta)
   */
  public record ProcessingFeatureResults(PersonDetectionResult personDetection, FaceDetectionResult faceDetection) {}

  /**
   * A person detection result. {@code people} is set only for {@code evaluated}; {@code reason}
   * only for {@code not-evaluated}.
   *
   * @param status {@code evaluated} or {@code not-evaluated}
   * @param stage feature maturity, {@code beta} or {@code ga}; beta results may change shape
   * @param reason why the feature was not evaluated: {@code not-supported} or {@code unavailable}
   * @param people detected people
   */
  public record PersonDetectionResult(String status, String stage, String reason, List<DetectedPerson> people) {
    /** Copies collections so the record stays immutable. */
    public PersonDetectionResult { people = list(people); }
  }

  /**
   * A face detection result. {@code faces} is set only for {@code evaluated}; {@code reason} only
   * for {@code not-evaluated}.
   *
   * @param status {@code evaluated} or {@code not-evaluated}
   * @param stage feature maturity, {@code beta} or {@code ga}; beta results may change shape
   * @param reason why the feature was not evaluated: {@code not-supported} or {@code unavailable}
   * @param faces detected faces
   */
  public record FaceDetectionResult(String status, String stage, String reason, List<DetectedFace> faces) {
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
   * Estimated age range in years. Estimates can be off by several years.
   *
   * @param low lowest estimated age
   * @param high highest estimated age
   */
  public record AgeRange(Integer low, Integer high) {}

  /**
   * Audio and video classification.
   *
   * @param durationSeconds media duration
   * @param frameIntervalSeconds frame sampling interval
   * @param sampledFrames frames sampled
   * @param audioTranscribed whether audio was transcribed
   * @param segments per-segment results
   */
  public record MediaClassificationReport(Double durationSeconds, Double frameIntervalSeconds, Integer sampledFrames,
      Boolean audioTranscribed, List<MediaClassificationSegment> segments) {
    /** Copies collections so the record stays immutable. */
    public MediaClassificationReport { segments = list(segments); }
  }

  /**
   * One media segment.
   *
   * @param source {@code frame} or {@code audio}
   * @param startSeconds segment start
   * @param endSeconds segment end
   * @param categories results by category
   */
  public record MediaClassificationSegment(String source, Double startSeconds, Double endSeconds, Map<String, CategoryResult> categories) {
    /** Copies collections so the record stays immutable. */
    public MediaClassificationSegment { categories = map(categories); }
  }

  /**
   * Image details.
   *
   * @param perceptualHash perceptual hash
   * @param width width in pixels
   * @param height height in pixels
   */
  public record ImageData(String perceptualHash, Integer width, Integer height) {}

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
   * A generated preview image.
   *
   * @param fileFormat format
   * @param thumbhash thumbhash placeholder
   * @param averageColor average color
   * @param width width
   * @param height height
   */
  public record PreviewImage(String fileFormat, String thumbhash, String averageColor, Integer width, Integer height) {}

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
   * One page of assets. Use {@code assets.iterate} to go through every page.
   *
   * @param items assets on this page
   * @param nextCursor continuation cursor, or null
   * @param pageSize page size
   * @param hasMore whether another page follows
   * @param ordering ordering applied
   */
  public record AssetPage(List<Asset> items, String nextCursor, Integer pageSize, boolean hasMore, List<Order> ordering) {
    /** Copies collections; a missing item list becomes empty. */
    public AssetPage { items = listOrEmpty(items); ordering = list(ordering); }
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

  /**
   * One registered event fact. Render {@code url} only after checking it (see the events docs).
   *
   * @param key fact key, such as {@code reviewer-name}
   * @param value fact value
   * @param url link for the fact, if any
   */
  public record EventFact(String key, Object value, String url) {}

  /**
   * The asset's state when an event was created.
   *
   * @param id asset ID
   * @param externalId the asset's external ID
   * @param upload upload status at the time
   * @param classification classification status and moderation decision at the time
   * @param content content status at the time
   */
  public record EventAsset(String id, String externalId, EventAssetUpload upload, EventAssetClassification classification, EventAssetContent content) {}

  /** @param status the asset's classification status */
  public record EventAssetUpload(String status) {}

  public record EventAssetClassification(AssetClassificationStatus status, EventAssetModeration moderation) {}

  /**
   * @param decision the moderation decision in force
   * @param action what the policy did with flagged content ({@code alert}, {@code hide} or {@code
   *     purge}), or null when nothing was flagged
   */
  public record EventAssetModeration(AssetModerationStatus decision, String action) {}

  /** @param status whether CalmLens held the content */
  public record EventAssetContent(AssetContentStatus status) {}

  /**
   * An event from the events feed.
   *
   * @param id event ID; deliveries of the same event share it
   * @param type event type, such as {@code asset.flagged}
   * @param createdAt creation time
   * @param updatedAt last update time
   * @param projectId owning project
   * @param userId user who caused the event, if any
   * @param severity severity
   * @param title short summary
   * @param description longer explanation
   * @param assetId asset the event is about
   * @param asset snapshot of the asset's decision; retrieve the asset for its current state
   * @param facts registered facts (never null)
   * @param notifies whether the event triggers portal notifications ({@code notify} in the API)
   * @param readAt when it was marked as read in the portal
   */
  public record Event(String id, String type,
      @JsonAdapter(Json.EpochMillis.class) Instant createdAt,
      @JsonAdapter(Json.EpochMillis.class) Instant updatedAt,
      String projectId, String userId, String severity, String title, String description,
      String assetId, EventAsset asset, List<EventFact> facts, @SerializedName("notify") Boolean notifies,
      @JsonAdapter(Json.EpochMillis.class) Instant readAt) {
    /** Copies facts; missing facts become an empty list. */
    public Event { facts = listOrEmpty(facts); }
  }

  /**
   * One page of the events feed.
   *
   * @param events events, oldest first
   * @param cursor pass as {@code after} to get newer events; persist it to resume
   * @param hasMore whether more events are available now
   */
  public record EventsPage(List<Event> events, String cursor, boolean hasMore) {
    /** Copies events; a missing list becomes empty. */
    public EventsPage { events = listOrEmpty(events); }
  }

  /**
   * The event fields of a webhook delivery.
   *
   * @param severity severity
   * @param title short summary
   * @param description longer explanation
   * @param assetId asset the event is about
   * @param asset snapshot of the asset's decision; retrieve the asset for its current state
   * @param facts registered facts (never null)
   */
  public record WebhookEventData(String severity, String title, String description, String assetId, EventAsset asset, List<EventFact> facts) {
    /** Copies facts; missing facts become an empty list. */
    public WebhookEventData { facts = listOrEmpty(facts); }
  }

  /**
   * The JSON body of a webhook delivery. Get it from {@code CalmLensServerClient.parseWebhookEvent}.
   *
   * @param id event ID; the same on every retry, so use it to skip duplicates
   * @param type event type, such as {@code asset.flagged}
   * @param createdAt event creation time
   * @param projectId owning project
   * @param data event fields
   */
  public record WebhookEventPayload(String id, String type,
      @JsonAdapter(Json.EpochMillis.class) Instant createdAt, String projectId, WebhookEventData data) {}

  /**
   * A lens.
   *
   * @param id lens ID
   * @param identifier stable identifier used in CDN URLs
   * @param name display name
   * @param type lens type
   * @param active whether the lens is active
   * @param version version
   * @param projectId owning project
   * @param userId creating user
   * @param createdAt creation time
   * @param updatedAt last update time
   * @param description description
   * @param transforms transforms
   */
  public record Lens(String id, String identifier, String name, String type, Boolean active, Integer version,
      String projectId, String userId,
      @JsonAdapter(Json.EpochMillis.class) Instant createdAt,
      @JsonAdapter(Json.EpochMillis.class) Instant updatedAt,
      String description, List<Transform> transforms) {
    /** Copies transforms so the record stays immutable. */
    public Lens { transforms = list(transforms); }
  }

  /**
   * A signed CDN URL. It grants access until it expires, so {@link #toString()} hides its query.
   *
   * @param url the signed URL
   * @param expiresAt expiry time
   */
  public record SignedUrl(String url, @JsonAdapter(Json.EpochMillis.class) Instant expiresAt) {
    @Override public String toString() {
      int query = url == null ? -1 : url.indexOf('?');
      return "SignedUrl[url=" + (query < 0 ? url : url.substring(0, query) + "?[redacted]") + ", expiresAt=" + expiresAt + "]";
    }
  }
}
