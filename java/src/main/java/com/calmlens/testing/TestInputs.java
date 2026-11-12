package com.calmlens.testing;

import com.calmlens.CalmLensServerClient;
import com.calmlens.CdnResponse;
import com.calmlens.RequestOptions;
import com.calmlens.ErrorCodes;
import com.calmlens.Transport;
import com.calmlens.exception.*;
import com.calmlens.internal.ClientAccess;
import com.calmlens.internal.Json;
import com.calmlens.internal.UploadForm;
import com.calmlens.models.*;
import com.calmlens.params.*;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Signed test inputs: text codes, test images and media phrases that a project's moderation
 * recognises as a declared scenario when they are signed with its secret test input key. The key
 * is in the portal's project settings, for
 * members and API keys that can read them. The formats match the backend byte for byte.
 *
 * <pre>{@code
 * String text = TestInputs.generateTestTextCode(TestInputs.LIMITED, testInputKey);
 * byte[] faces = TestInputs.paintTestImage(TestInputs.ADULT_FACE, testInputKey).png();
 * byte[] png = TestInputs.paintTestImage("violence", testInputKey).png();
 * String phrase = TestInputs.generateMediaTestCode("violence", testInputKey);
 * }</pre>
 *
 * <p>An invalid key, scenario or signal throws {@link CalmLensException} with {@link
 * ErrorCodes#SDK_INVALID_ARGUMENT}.
 */
public final class TestInputs {
  private TestInputs() {}

  /** The kind of input a signal shortcut stands for. */
  public enum Kind {
    /** A text input ({@link #generateTestTextCode(String, String)}). */
    TEXT,
    /** An image input ({@link #paintTestImage(String, String)}). */
    IMAGE
  }

  /**
   * A painted test image: {@code width * height} RGBA pixels, row by row, and the same image as PNG.
   *
   * @param width the width in pixels
   * @param height the height in pixels
   * @param rgba 4 bytes per pixel (red, green, blue, alpha)
   * @param png the image as PNG bytes, ready to upload
   */
  public record TestImage(int width, int height, byte[] rgba, byte[] png) {}

  /** Category colours, carried in a test image's chroma only. */
  private static final Map<String, int[]> COLORS = Map.of(
      "sexual", new int[] {232, 80, 160},
      "violence", new int[] {224, 56, 64},
      "self-harm", new int[] {24, 168, 152},
      "harassment", new int[] {240, 128, 48},
      "hate", new int[] {144, 80, 216},
      "criminal-activity", new int[] {224, 184, 40},
      "personal-information", new int[] {48, 128, 224},
      "profanity", new int[] {136, 192, 48});

  /** No findings. */
  public static final TestInput CLEAN = new TestInput(List.of());
  /** Harassment abuse, which the built-in policies limit. */
  public static final TestInput LIMITED = one("harassment", "harassment-abuse");
  /** Pornographic media, for an image. */
  public static final TestInput ADULT_IMAGE = one("sexual", "sexual-pornographic-media");
  /** Explicit sexual language, for text. */
  public static final TestInput ADULT_TEXT = one("sexual", "sexual-explicit-language");
  /** No findings, but blocked in DE, age-restricted in GB and limited in FR. */
  public static final TestInput REGIONAL_DELIVERY = new TestInput(List.of(
      new TestInput.RegionalAction("DE", "block"), new TestInput.RegionalAction("GB", "age-restrict"), new TestInput.RegionalAction("FR", "limit")), null, List.of(), null);
  /** No findings, but blocked in DE. */
  public static final TestInput GERMANY = new TestInput(List.of(new TestInput.RegionalAction("DE", "block")), null, List.of(), null);
  /** Documentary harassment abuse alongside a harassment threat. */
  public static final TestInput MIXED = new TestInput(List.of(
      new TestInput.Instance("harassment", List.of("harassment-abuse", "harassment-documentary")),
      new TestInput.Instance("harassment", List.of("harassment-threat"))));
  /** One person with one face, without an age. */
  public static final TestInput ONE_FACE = detected(List.of(person(2500, 1500, 5000, 8500)), List.of(face(3500, 2000, 3000, 3500, null)));
  /** Person and face detection that found nobody. */
  public static final TestInput NO_FACE = detected(List.of(), List.of());
  /** One person with one face estimated as an adult. */
  public static final TestInput ADULT_FACE = detected(List.of(person(2500, 1500, 5000, 8500)), List.of(face(3500, 2000, 3000, 3500, TestInput.FaceAge.ADULT)));
  /** One person with one face estimated as a minor. */
  public static final TestInput MINOR_FACE = detected(List.of(person(2500, 1500, 5000, 8500)), List.of(face(3500, 2000, 3000, 3500, TestInput.FaceAge.MINOR)));
  /** Three people side by side, each with a face without an age. */
  public static final TestInput GROUP = detected(
      List.of(person(500, 2000, 2800, 8000), person(3600, 2000, 2800, 8000), person(6700, 2000, 2800, 8000)),
      List.of(face(1200, 2500, 1400, 2000, null), face(4300, 2500, 1400, 2000, null), face(7400, 2500, 1400, 2000, null)));

  /**
   * The signals {@link #testInputForSignal(String, Kind)} accepts: the 8 categories and {@code
   * sexual.involving-minors}, {@code harassment.insult}, {@code sexual.adult}, {@code
   * hate.regional-symbol} and {@code violence.graphic}.
   */
  public static final List<String> SIGNALS = Stream.concat(MockClassification.CATEGORIES.stream(),
      Stream.of("sexual.involving-minors", "harassment.insult", "sexual.adult", "hate.regional-symbol", "violence.graphic")).toList();

  /** The signals {@link #generateMediaTestCode(String, String)} accepts: the 8 categories and {@code violence.graphic}. */
  public static final List<String> MEDIA_SIGNALS = Stream.concat(MockClassification.CATEGORIES.stream(), Stream.of("violence.graphic")).toList();

  /**
   * The qualifiers a scenario may list for each category: all but those the input type sets, such
   * as {@code sexual-text}.
   */
  public static final Map<String, List<String>> QUALIFIERS = MockClassification.QUALIFIERS.entrySet().stream()
      .collect(Collectors.toUnmodifiableMap(Map.Entry::getKey,
          entry -> entry.getValue().stream().filter(q -> !MockClassification.INPUT_QUALIFIERS.contains(q)).toList()));

  private static final List<String> ACTIONS = List.of("allow", "limit", "age-restrict", "block");
  private static final List<String> REGIONS = List.of("DE", "AT", "FR", "GB", "EU", "AU", "BR");
  private static final List<String> REGIONAL_ACTIONS = List.of("limit", "age-restrict", "block");
  private static final Pattern KEY = Pattern.compile("[a-f0-9]{32}");
  private static final String[] WORDS = {"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "alpha", "bravo", "charlie", "delta", "echo", "foxtrot"};
  private static TestInput one(String category, String... qualifiers) {
    return new TestInput(List.of(new TestInput.Instance(category, List.of(qualifiers))));
  }

  private static TestInput detected(List<TestInput.Person> people, List<TestInput.Face> faces) {
    return new TestInput(List.of()).withDetections(new TestInput.Detections(TestInput.DetectionList.of(people), TestInput.DetectionList.of(faces)));
  }

  private static TestInput.Person person(int left, int top, int width, int height) { return new TestInput.Person(new TestInput.Box(left, top, width, height)); }

  private static TestInput.Face face(int left, int top, int width, int height, TestInput.FaceAge age) {
    return new TestInput.Face(new TestInput.Box(left, top, width, height)).withAge(age);
  }

  /**
   * @param signal one of {@link #SIGNALS}
   * @param kind the kind of input
   * @return the scenario the signal stands for in an input of that kind
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} for another signal or a null kind
   */
  public static TestInput testInputForSignal(String signal, Kind kind) {
    if (kind == null) throw invalid("Test input kind must be text or image");
    if (signal == null) throw invalid("A test signal is required");
    switch (signal) {
      case "harassment.insult": return LIMITED;
      case "sexual.adult": return kind == Kind.IMAGE ? ADULT_IMAGE : ADULT_TEXT;
      // A Nazi symbol on public display, which German law restricts.
      case "hate.regional-symbol": return one("hate", "hate-symbol", "hate-nazi-symbols-public-display");
      case "sexual.involving-minors": return one("sexual", "sexual-minors");
      case "violence.graphic": return one("violence", "violence-injury", "violence-graphic");
      default:
        if (!MockClassification.CATEGORIES.contains(signal)) throw invalid("Unknown test signal " + signal);
        return one(signal);
    }
  }

  /**
   * @param signal one of {@link #SIGNALS}
   * @return the scenario the signal stands for in a text input
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} for another signal
   */
  public static TestInput testInputForSignal(String signal) { return testInputForSignal(signal, Kind.TEXT); }

  /**
   * Returns the signed text code for a scenario. CalmLens recognises it only as the whole of a text
   * input (surrounding whitespace aside); text with anything else around the code is moderated as
   * ordinary content.
   *
   * @param input the scenario
   * @param testInputKey the project's secret test input key from the portal
   * @return the code, {@code <!calmlens-test ...>}
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} for an invalid key or scenario
   */
  public static String generateTestTextCode(TestInput input, String testInputKey) {
    checkKey(testInputKey);
    validate(input);
    String payload = Base64.getUrlEncoder().withoutPadding().encodeToString(canonical(input).getBytes(StandardCharsets.UTF_8));
    if (payload.length() > 8000) throw invalid("Test scenario is too large");
    return "<!calmlens-test " + tag(testInputKey, "calmlens-test:v2:" + payload) + " " + payload + ">";
  }

  /**
   * Returns the signed text code for a signal's text scenario ({@link #testInputForSignal(String)}).
   *
   * @param signal one of {@link #SIGNALS}
   * @param testInputKey the project's secret test input key from the portal
   * @return the code
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} for an invalid key or signal
   */
  public static String generateTestTextCode(String signal, String testInputKey) {
    return generateTestTextCode(testInputForSignal(signal, Kind.TEXT), testInputKey);
  }

  /**
   * Returns the phrase that triggers a signal in audio or video: read it aloud, or show it as
   * large, high-contrast text in a frame.
   *
   * @param signal one of {@link #MEDIA_SIGNALS}
   * @param testInputKey the project's secret test input key from the portal
   * @return the phrase
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} for an invalid key or signal
   */
  public static String generateMediaTestCode(String signal, String testInputKey) {
    if (!in(MEDIA_SIGNALS, signal)) throw invalid("Unsupported media test signal " + signal);
    checkKey(testInputKey);
    StringBuilder phrase = new StringBuilder("Calm Lens test");
    for (char digit : tag(testInputKey, "calmlens-test:media:" + signal).toCharArray())
      phrase.append(' ').append(WORDS[Character.digit(digit, 16)]);
    return phrase.append(' ').append(signal.replace('.', ' ').replace('-', ' ')).append(" end test").toString();
  }

  /**
   * Paints a scenario's signed test image: a grid that survives lossy formats and resizing. Upload
   * its {@link TestImage#png()}, or encode its {@link TestImage#rgba()} in any format. CalmLens
   * recognises it only as the whole upload (a plain single-colour border aside).
   *
   * @param input the scenario
   * @param testInputKey the project's secret test input key from the portal
   * @return the image
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} for an invalid key or scenario, or
   *     one too large for a test image
   */
  public static TestImage paintTestImage(TestInput input, String testInputKey) {
    String[] code = generateTestTextCode(input, testInputKey).split(" ");
    String tag = code[1];
    byte[] signed = Base64.getUrlDecoder().decode(code[2].substring(0, code[2].length() - 1));
    byte[] data = new byte[18 + signed.length];
    data[0] = (byte) (signed.length >> 8);
    data[1] = (byte) signed.length;
    for (int i = 0; i < 16; i++) data[2 + i] = (byte) Integer.parseInt(tag.substring(2 * i, 2 * i + 2), 16);
    System.arraycopy(signed, 0, data, 18, signed.length);
    List<int[]> palette = new ArrayList<>();
    Set<String> seen = new HashSet<>();
    for (TestInput.Instance instance : input.instances())
      if (seen.add(instance.category())) palette.add(COLORS.get(instance.category()));
    if (palette.isEmpty()) palette.add(new int[] {144, 152, 160});
    TestImage image = TestImageGrid.paint(data, palette);
    if (image == null) throw invalid("Test scenario is too large for a test image");
    return image;
  }

  /**
   * Paints a signal's image scenario ({@link #testInputForSignal(String, Kind)} with {@link Kind#IMAGE}).
   *
   * @param signal one of {@link #SIGNALS}
   * @param testInputKey the project's secret test input key from the portal
   * @return the image
   * @throws CalmLensException {@link ErrorCodes#SDK_INVALID_ARGUMENT} for an invalid key or signal
   */
  public static TestImage paintTestImage(String signal, String testInputKey) {
    return paintTestImage(testInputForSignal(signal, Kind.IMAGE), testInputKey);
  }

  private static void checkKey(String key) {
    if (key == null || !KEY.matcher(key).matches()) throw invalid("The test input key must be 32 lowercase hexadecimal characters");
  }

  private static void validate(TestInput input) {
    if (input == null || input.instances() == null) throw invalid("A test scenario needs instances");
    if (input.instances().size() > 128) throw invalid("A test scenario has at most 128 instances");
    int withAction = 0;
    for (TestInput.Instance instance : input.instances()) {
      if (instance == null || !in(MockClassification.CATEGORIES, instance.category())) throw invalid("Each instance needs a CalmLens category");
      if (instance.score() != null && !(Double.isFinite(instance.score()) && instance.score() >= 0 && instance.score() <= 1))
        throw invalid("Score must be a number from 0 to 1");
      if (instance.action() != null && !in(ACTIONS, instance.action())) throw invalid("Action must be one of " + String.join(", ", ACTIONS));
      if (instance.qualifiers() == null || instance.qualifiers().size() > 64) throw invalid("An instance needs at most 64 qualifiers");
      List<String> allowed = QUALIFIERS.get(instance.category());
      if (!instance.qualifiers().stream().allMatch(qualifier -> in(allowed, qualifier)) || new HashSet<>(instance.qualifiers()).size() != instance.qualifiers().size())
        throw invalid("Choose unique " + instance.category() + " qualifiers; input-type qualifiers are automatic");
      if (instance.action() != null) withAction++;
    }
    if (withAction != 0 && withAction != input.instances().size()) throw invalid("Set an action for every instance or omit all actions");
    List<String> unassessed = input.unassessedCategories();
    if (unassessed != null) {
      if (unassessed.size() > MockClassification.CATEGORIES.size()) throw invalid("A test scenario has at most 8 unassessed categories");
      Set<String> seen = new HashSet<>();
      for (String category : unassessed)
        if (!in(MockClassification.CATEGORIES, category) || !seen.add(category)
            || input.instances().stream().anyMatch(instance -> instance.category().equals(category)))
          throw invalid("Unassessed categories must be unique categories without instances");
    }
    List<TestInput.RegionalAction> regional = input.regionalActions();
    if (regional != null) {
      if (regional.size() > REGIONS.size()) throw invalid("A test scenario has at most 7 regional actions");
      Set<String> seen = new HashSet<>();
      for (TestInput.RegionalAction action : regional) {
        if (action == null || !in(REGIONS, action.region()) || !seen.add(action.region()))
          throw invalid("Regional actions need unique regions from " + String.join(", ", REGIONS));
        if (!in(REGIONAL_ACTIONS, action.action())) throw invalid("Regional action must be one of " + String.join(", ", REGIONAL_ACTIONS));
      }
    }
    TestInput.Detections detections = input.detections();
    if (detections != null) {
      for (TestInput.Person person : entries(detections.people())) {
        if (person == null) throw invalid("Each person needs a box");
        checkDetection(person.box(), person.confidence());
      }
      for (TestInput.Face face : entries(detections.faces())) {
        if (face == null) throw invalid("Each face needs a box");
        checkDetection(face.box(), face.confidence());
        if (face.age() instanceof TestInput.FaceAge.Preset preset && !in(MockClassification.TEST_FACE_AGE_PRESETS, preset.name()))
          throw invalid("A face's age preset must be one of " + String.join(", ", MockClassification.TEST_FACE_AGE_PRESETS));
        if (face.age() instanceof TestInput.FaceAge.Range range
            && !(range.low() >= 0 && range.low() <= range.high() && range.high() <= MockClassification.TEST_FACE_AGE_MAX))
          throw invalid("A face's age range needs whole years from 0 to " + MockClassification.TEST_FACE_AGE_MAX + ", low no higher than high");
      }
    }
  }

  /** A detection list's entries: none when it is left out or unavailable. */
  private static <T> List<T> entries(TestInput.DetectionList<T> list) {
    if (!(list instanceof TestInput.DetectionList.Entries<T> found)) return List.of();
    if (found.entries() == null || found.entries().size() > MockClassification.TEST_DETECTIONS_MAX)
      throw invalid("A detection list has at most " + MockClassification.TEST_DETECTIONS_MAX + " entries");
    return found.entries();
  }

  private static void checkDetection(TestInput.Box box, Integer confidence) {
    int max = MockClassification.TEST_DETECTION_BOX_MAX;
    if (box == null || !IntStream.of(box.left(), box.top(), box.width(), box.height()).allMatch(value -> value >= 0 && value <= max)
        || box.left() + box.width() > max || box.top() + box.height() > max)
      throw invalid("A detection box needs left, top, width and height from 0 to " + max + " basis points, inside the image");
    if (confidence != null && !(confidence >= 0 && confidence <= 100)) throw invalid("Confidence must be a whole number from 0 to 100");
  }

  /** The scenario's JSON in the backend's key order. Every string is a validated ASCII token, so none needs escaping. */
  private static String canonical(TestInput input) {
    StringBuilder json = new StringBuilder("{");
    if (input.regionalActions() != null)
      json.append("\"regionalActions\":[").append(input.regionalActions().stream()
          .map(action -> "{\"region\":\"" + action.region() + "\",\"action\":\"" + action.action() + "\"}").collect(Collectors.joining(","))).append("],");
    if (input.unassessedCategories() != null) json.append("\"unassessedCategories\":").append(strings(input.unassessedCategories())).append(',');
    json.append("\"instances\":[");
    for (int i = 0; i < input.instances().size(); i++) {
      TestInput.Instance instance = input.instances().get(i);
      if (i > 0) json.append(',');
      json.append("{\"category\":\"").append(instance.category()).append("\",");
      if (instance.score() != null) json.append("\"score\":").append(jsNumber(instance.score())).append(',');
      if (instance.action() != null) json.append("\"action\":\"").append(instance.action()).append("\",");
      json.append("\"qualifiers\":").append(strings(instance.qualifiers())).append('}');
    }
    json.append(']');
    TestInput.Detections detections = input.detections();
    if (detections != null) {
      json.append(",\"detections\":{");
      if (detections.people() != null) json.append("\"people\":").append(detectionList(detections.people(), person -> detection(person.box(), person.confidence(), null)));
      if (detections.faces() != null)
        json.append(detections.people() != null ? "," : "").append("\"faces\":").append(detectionList(detections.faces(), face -> detection(face.box(), face.confidence(), face.age())));
      json.append('}');
    }
    return json.append('}').toString();
  }

  private static <T> String detectionList(TestInput.DetectionList<T> list, java.util.function.Function<T, String> entry) {
    if (list instanceof TestInput.DetectionList.Entries<T> found) return found.entries().stream().map(entry).collect(Collectors.joining(",", "[", "]"));
    return "\"unavailable\"";
  }

  private static String detection(TestInput.Box box, Integer confidence, TestInput.FaceAge age) {
    StringBuilder json = new StringBuilder("{\"box\":[").append(box.left()).append(',').append(box.top()).append(',').append(box.width()).append(',').append(box.height()).append(']');
    if (confidence != null) json.append(",\"confidence\":").append(confidence);
    if (age instanceof TestInput.FaceAge.Preset preset) json.append(",\"age\":\"").append(preset.name()).append('"');
    else if (age instanceof TestInput.FaceAge.Range range) json.append(",\"age\":{\"low\":").append(range.low()).append(",\"high\":").append(range.high()).append('}');
    return json.append('}').toString();
  }

  private static String strings(List<String> values) {
    return values.stream().map(value -> "\"" + value + "\"").collect(Collectors.joining(",", "[", "]"));
  }

  /**
   * A finite number as JavaScript's {@code JSON.stringify} prints it: the shortest digits that
   * round-trip, in plain decimal from 1e-6 to below 1e21 and in exponent form otherwise.
   */
  static String jsNumber(double value) {
    if (value == 0) return "0";
    String sign = value < 0 ? "-" : "";
    BigDecimal exact = new BigDecimal(Math.abs(value));
    BigDecimal shortest = exact;
    for (int precision = 1; precision <= 17; precision++) {
      shortest = exact.round(new MathContext(precision, RoundingMode.HALF_EVEN));
      if (shortest.doubleValue() == Math.abs(value)) break;
    }
    shortest = shortest.stripTrailingZeros();
    String digits = shortest.unscaledValue().toString();
    int k = digits.length();
    int n = k - shortest.scale(); // value = 0.digits * 10^n
    String body;
    if (k <= n && n <= 21) body = digits + "0".repeat(n - k);
    else if (0 < n && n <= 21) body = digits.substring(0, n) + "." + digits.substring(n);
    else if (-6 < n && n <= 0) body = "0." + "0".repeat(-n) + digits;
    else {
      int e = n - 1;
      body = (k == 1 ? digits : digits.charAt(0) + "." + digits.substring(1)) + "e" + (e < 0 ? "-" : "+") + Math.abs(e);
    }
    return sign + body;
  }

  private static String tag(String key, String message) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.US_ASCII), "HmacSHA256"));
      StringBuilder hex = new StringBuilder();
      for (byte b : mac.doFinal(message.getBytes(StandardCharsets.UTF_8))) hex.append(String.format("%02x", b));
      return hex.substring(0, 32);
    } catch (GeneralSecurityException unavailable) {
      throw new IllegalStateException("HmacSHA256 is unavailable", unavailable);
    }
  }

  /** Whether {@code value} is non-null and in {@code values}, which rejects null lookups. */
  private static boolean in(List<String> values, String value) { return value != null && values.contains(value); }

  private static CalmLensException invalid(String message) { return CalmLensException.of(ErrorCodes.SDK_INVALID_ARGUMENT, message); }
}
