package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonDeserializer;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.function.ThrowingConsumer;

/** Replays the shared signed test input fixtures in {@code testdata/test-inputs.json}. */
class TestInputsTest {
  private static JsonObject fixture() throws Exception { return Fixtures.read("test-inputs.json").getAsJsonObject(); }

  private static Stream<DynamicTest> cases(String section, String nameKey, ThrowingConsumer<JsonObject> test) throws Exception {
    JsonArray cases = fixture().getAsJsonArray(section);
    List<DynamicTest> tests = new ArrayList<>();
    for (int i = 0; i < cases.size(); i++) {
      JsonObject item = cases.get(i).getAsJsonObject();
      tests.add(DynamicTest.dynamicTest(i + ": " + item.get(nameKey).getAsString(), () -> test.accept(item)));
    }
    assertFalse(tests.isEmpty(), "no fixture cases");
    return tests.stream();
  }

  /**
   * Decodes fixture scenarios: a box is a {@code [left, top, width, height]} array, a detection
   * list is an array or {@code "unavailable"}, and an age is a preset name or a {@code {low, high}}
   * range.
   */
  private static final Gson SCENARIOS = new GsonBuilder()
      .registerTypeAdapter(TestInput.Box.class, (JsonDeserializer<TestInput.Box>) (json, type, context) -> {
        JsonArray box = json.getAsJsonArray();
        if (box.size() != 4) throw new JsonParseException("a box has 4 values");
        return new TestInput.Box(box.get(0).getAsInt(), box.get(1).getAsInt(), box.get(2).getAsInt(), box.get(3).getAsInt());
      })
      .registerTypeAdapter(TestInput.FaceAge.class, (JsonDeserializer<TestInput.FaceAge>) (json, type, context) -> json.isJsonPrimitive()
          ? new TestInput.FaceAge.Preset(json.getAsString())
          : context.deserialize(json, TestInput.FaceAge.Range.class))
      .registerTypeAdapter(TestInput.DetectionList.class, (JsonDeserializer<TestInput.DetectionList<?>>) (json, type, context) -> {
        if (json.isJsonPrimitive() && json.getAsString().equals("unavailable")) return TestInput.DetectionList.unavailable();
        Type entry = ((ParameterizedType) type).getActualTypeArguments()[0];
        List<Object> entries = new ArrayList<>();
        json.getAsJsonArray().forEach(item -> entries.add(context.deserialize(item, entry)));
        return TestInput.DetectionList.of(entries);
      })
      .create();

  private static TestInput input(JsonElement json) { return SCENARIOS.fromJson(json, TestInput.class); }

  private static List<String> strings(JsonElement json) {
    List<String> values = new ArrayList<>();
    json.getAsJsonArray().forEach(value -> values.add(value.getAsString()));
    return values;
  }

  /** The case's expiry; generated cases always record one, and rejections may. */
  private static long expiresAt(JsonObject c) { return c.get("expiresAt").getAsBigDecimal().longValueExact(); }

  private static String text(JsonObject c) {
    String key = c.get("key").getAsString();
    if (!c.has("expiresAt"))
      return c.has("signal") ? TestInputs.generateTestTextCode(c.get("signal").getAsString(), key) : TestInputs.generateTestTextCode(input(c.get("input")), key);
    return c.has("signal") ? TestInputs.generateTestTextCode(c.get("signal").getAsString(), key, expiresAt(c))
        : TestInputs.generateTestTextCode(input(c.get("input")), key, expiresAt(c));
  }

  @Test
  void presetsMatchTheFixture() throws Exception {
    JsonObject presets = fixture().getAsJsonObject("presets");
    Map<String, TestInput> expected = new LinkedHashMap<>();
    Map<String, TestInput> actual = new LinkedHashMap<>();
    for (String name : presets.keySet()) {
      expected.put(name, input(presets.get(name)));
      // adultImage -> ADULT_IMAGE
      actual.put(name, (TestInput) TestInputs.class.getField(name.replaceAll("([A-Z])", "_$1").toUpperCase()).get(null));
    }
    assertEquals(expected, actual);
  }

  @Test
  void detectionLimitsMatchTheFixture() throws Exception {
    JsonObject detections = fixture().getAsJsonObject("detections");
    assertEquals(List.of(detections.get("maxEntries").getAsInt(), detections.get("boxMax").getAsInt(), detections.get("ageMax").getAsInt()),
        List.of(MockClassification.TEST_DETECTIONS_MAX, MockClassification.TEST_DETECTION_BOX_MAX, MockClassification.TEST_FACE_AGE_MAX));
    List<String> presets = List.copyOf(detections.getAsJsonObject("agePresets").keySet());
    assertEquals(presets, MockClassification.TEST_FACE_AGE_PRESETS);
    assertEquals(presets, Stream.of(TestInput.FaceAge.ADULT, TestInput.FaceAge.MINOR).map(age -> ((TestInput.FaceAge.Preset) age).name()).toList());
  }

  /** Scenarios only Java can build: null entries, and box values whose sums overflow an int. */
  @Test
  void rejectsDetectionsOnlyJavaCanExpress() {
    TestInput.Box box = new TestInput.Box(0, 0, 1, 1);
    List<TestInput.Detections> invalid = List.of(
        new TestInput.Detections(TestInput.DetectionList.of((List<TestInput.Person>) null), null),
        new TestInput.Detections(TestInput.DetectionList.of(java.util.Arrays.asList(new TestInput.Person(box), null)), null),
        new TestInput.Detections(null, TestInput.DetectionList.of(new TestInput.Face(null))),
        new TestInput.Detections(null, TestInput.DetectionList.of(new TestInput.Face(new TestInput.Box(Integer.MAX_VALUE, 0, Integer.MAX_VALUE, 1)))),
        new TestInput.Detections(TestInput.DetectionList.of(new TestInput.Person(new TestInput.Box(0, 1, 1, Integer.MAX_VALUE))), null));
    for (TestInput.Detections detections : invalid) {
      CalmLensException error = assertThrows(CalmLensException.class,
          () -> TestInputs.generateTestTextCode(TestInputs.CLEAN.withDetections(detections), "0123456789abcdef0123456789abcdef"), detections.toString());
      assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, error.getCode());
    }
  }

  @Test
  void signalListsMatchTheFixture() throws Exception {
    JsonObject signals = fixture().getAsJsonObject("signals");
    assertEquals(strings(signals.get("text")), TestInputs.SIGNALS);
    assertEquals(strings(signals.get("media")), TestInputs.MEDIA_SIGNALS);
  }

  @Test
  void qualifierVocabularyMatchesTheFixture() throws Exception {
    JsonObject qualifiers = fixture().getAsJsonObject("qualifiers");
    Map<String, List<String>> expected = new LinkedHashMap<>();
    for (String category : qualifiers.keySet()) expected.put(category, strings(qualifiers.get(category)));
    assertEquals(expected, TestInputs.QUALIFIERS);
  }

  @TestFactory
  Stream<DynamicTest> signalInputs() throws Exception {
    return cases("signalInputs", "signal", c -> assertEquals(input(c.get("input")),
        TestInputs.testInputForSignal(c.get("signal").getAsString(), TestInputs.Kind.valueOf(c.get("kind").getAsString().toUpperCase()))));
  }

  @TestFactory
  Stream<DynamicTest> textCodes() throws Exception {
    return cases("text", "name", c -> assertEquals(c.get("code").getAsString(), text(c)));
  }

  @TestFactory
  Stream<DynamicTest> mediaPhrases() throws Exception {
    return cases("media", "signal", c -> assertEquals(c.get("code").getAsString(),
        TestInputs.generateMediaTestCode(c.get("signal").getAsString(), c.get("key").getAsString())));
  }

  private static TestInputs.TestImage image(JsonObject c) {
    String key = c.get("key").getAsString();
    return c.has("signal") ? TestInputs.paintTestImage(c.get("signal").getAsString(), key, expiresAt(c))
        : TestInputs.paintTestImage(input(c.get("input")), key, expiresAt(c));
  }

  /** Each cell's level as packages/sdk-contract/testInputs.ts records it: "r" for the outer ring, else the data level (0-3) nearest the luma of the cell's top-left pixel. */
  private static String fixtureLevels(TestInputs.TestImage image, int cells) {
    int size = image.width() / cells;
    StringBuilder levels = new StringBuilder();
    for (int row = 0; row < cells; row++)
      for (int column = 0; column < cells; column++) {
        if (row == 0 || column == 0 || row == cells - 1 || column == cells - 1) {
          levels.append('r');
          continue;
        }
        int offset = (row * size * image.width() + column * size) * 4;
        byte[] rgba = image.rgba();
        int luma = (77 * (rgba[offset] & 255) + 150 * (rgba[offset + 1] & 255) + 29 * (rgba[offset + 2] & 255)) >> 8;
        int nearest = 0;
        for (int level = 1; level < TestImageGrid.LEVELS.length; level++)
          if (Math.abs(TestImageGrid.LEVELS[level] - luma) < Math.abs(TestImageGrid.LEVELS[nearest] - luma)) nearest = level;
        levels.append(nearest);
      }
    return levels.toString();
  }

  @TestFactory
  Stream<DynamicTest> images() throws Exception {
    return cases("images", "name", c -> {
      TestInputs.TestImage image = image(c);
      assertEquals(List.of(c.get("width").getAsInt(), c.get("height").getAsInt()), List.of(image.width(), image.height()));
      assertEquals(c.get("rgbaSha256").getAsString(), HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(image.rgba())));
      assertEquals(c.get("levels").getAsString(), fixtureLevels(image, c.get("cells").getAsInt()));
      BufferedImage decoded = ImageIO.read(new ByteArrayInputStream(image.png()));
      assertEquals(List.of(image.width(), image.height()), List.of(decoded.getWidth(), decoded.getHeight()));
      int[] samples = decoded.getRaster().getPixels(0, 0, image.width(), image.height(), (int[]) null);
      byte[] rgba = new byte[samples.length];
      for (int i = 0; i < samples.length; i++) rgba[i] = (byte) samples[i];
      assertArrayEquals(image.rgba(), rgba, "PNG pixels");
    });
  }

  @TestFactory
  Stream<DynamicTest> imageRejections() throws Exception {
    return cases("imageRejections", "name", c -> {
      CalmLensException error = assertThrows(CalmLensException.class, () -> image(c));
      assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, error.getCode());
    });
  }

  /**
   * Untyped rejections (unknown fields, wrong value types) cannot be expressed with {@link TestInput},
   * nor a fractional expiry with a {@code long}; out-of-range expiries can and are refused.
   */
  @TestFactory
  Stream<DynamicTest> rejections() throws Exception {
    return cases("rejections", "name", c -> {
      boolean integralExpiry = c.has("expiresAt") && c.get("expiresAt").getAsBigDecimal().stripTrailingZeros().scale() <= 0;
      Assumptions.assumeTrue(c.get("typed").getAsBoolean() || integralExpiry, "an untyped scenario or expiry Java cannot express");
      String key = c.get("key").getAsString();
      CalmLensException error = assertThrows(CalmLensException.class, () -> {
        switch (c.get("kind").getAsString()) {
          case "text" -> text(c);
          case "media" -> TestInputs.generateMediaTestCode(c.get("signal").getAsString(), key);
          default -> fail("unknown kind " + c.get("kind"));
        }
      }, c.toString());
      assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, error.getCode());
    });
  }

  @Test
  void expiryLifetimesMatchTheFixture() throws Exception {
    JsonObject expiry = fixture().getAsJsonObject("expiry");
    assertEquals(List.of(expiry.get("defaultLifetimeSeconds").getAsLong(), expiry.get("maxLifetimeSeconds").getAsLong()),
        List.of(TestInputs.DEFAULT_LIFETIME_SECONDS, TestInputs.MAX_LIFETIME_SECONDS));
  }

  /** A code generated without an expiry carries one a day from now in its signed payload. */
  @Test
  void textCodesExpireInADayByDefault() {
    long before = Instant.now().getEpochSecond();
    String code = TestInputs.generateTestTextCode("violence", "1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d");
    long after = Instant.now().getEpochSecond();
    String payload = code.substring(0, code.length() - 1).split(" ")[2];
    long expiresAt = Integer.toUnsignedLong(ByteBuffer.wrap(Base64.getUrlDecoder().decode(payload)).getInt());
    assertTrue(expiresAt >= before + 86400 && expiresAt <= after + 86400, expiresAt + " not a day after " + before + ".." + after);
  }

  @Test
  void scoresPrintAsJavaScriptNumbers() {
    Map<Double, String> expected = new LinkedHashMap<>();
    expected.put(0.0, "0");
    expected.put(-0.0, "0");
    expected.put(1.0, "1");
    expected.put(0.5, "0.5");
    expected.put(0.000001, "0.000001");
    expected.put(0.1 + 0.2, "0.30000000000000004");
    expected.put(0.123456789012345, "0.123456789012345");
    expected.put(1e-7, "1e-7");
    expected.put(1.5e-7, "1.5e-7");
    expected.put(2e-323, "2e-323");
    Map<Double, String> actual = new LinkedHashMap<>();
    expected.keySet().forEach(value -> actual.put(value, TestInputs.jsNumber(value)));
    assertEquals(expected, actual);
  }
}
