package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
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

  private static TestInput input(JsonElement json) { return Fixtures.JSON.fromJson(json, TestInput.class); }

  private static List<String> strings(JsonElement json) {
    List<String> values = new ArrayList<>();
    json.getAsJsonArray().forEach(value -> values.add(value.getAsString()));
    return values;
  }

  private static String text(JsonObject c) {
    String key = c.get("key").getAsString();
    return c.has("signal") ? TestInputs.generateTestTextCode(c.get("signal").getAsString(), key) : TestInputs.generateTestTextCode(input(c.get("input")), key);
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
    return c.has("signal") ? TestInputs.paintTestImage(c.get("signal").getAsString(), key) : TestInputs.paintTestImage(input(c.get("input")), key);
  }

  /** Each cell's level as packages/sdk-contract/testInputs.ts records it: the index of the cell's first red value among the levels, or -1. */
  private static String fixtureLevels(TestInputs.TestImage image, int cells) {
    int size = image.width() / cells;
    StringBuilder levels = new StringBuilder();
    for (int row = 0; row < cells; row++)
      for (int column = 0; column < cells; column++) {
        int red = image.rgba()[(row * size * image.width() + column * size) * 4] & 255;
        int level = -1;
        for (int i = 0; i < TestImageGrid.LEVELS.length; i++) if (TestImageGrid.LEVELS[i] == red) level = i;
        levels.append(level);
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

  /** Untyped rejections (unknown fields, wrong value types) cannot be expressed with {@link TestInput}. */
  @TestFactory
  Stream<DynamicTest> rejections() throws Exception {
    return cases("rejections", "name", c -> {
      Assumptions.assumeTrue(c.get("typed").getAsBoolean(), "an untyped scenario TestInput cannot express");
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
