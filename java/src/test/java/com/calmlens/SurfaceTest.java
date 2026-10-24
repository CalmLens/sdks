package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * Replays surface.json and rejections.json (packages/sdk-contract/surface.ts): every capability a
 * server SDK must offer exists under its Java name, and every request the API would reject is
 * refused before anything is sent.
 */
class SurfaceTest {
  /** Fixture options a Java type cannot hold, so the type already refuses the request. */
  private static final Map<String, String> REJECTED_BY_TYPE = Map.of(
      "signed URL lifetime of a fraction of a second", "SignedUrlOptions.expiresInSeconds is a Long");

  private static CalmLensServerClient client(Transport transport) {
    return CalmLensServerClient.builder("key", "project-1").maxRetries(0).transport(transport).build();
  }

  private static final CalmLensServerClient REFUSING = client(request -> fail("Sent " + request.uri()));

  /** A class of the SDK by its simple name, including nested model and mock classes. */
  private static Class<?> sdkClass(String name) {
    for (String candidate : List.of("com.calmlens." + name, "com.calmlens.Models$" + name, "com.calmlens.MockCalmLensServerClient$" + name)) {
      try {
        return Class.forName(candidate);
      } catch (ClassNotFoundException next) {
        // try the next location
      }
    }
    return null;
  }

  private static boolean hasMethod(Class<?> type, String name, boolean isStatic) {
    return type != null && Arrays.stream(type.getMethods())
        .anyMatch(m -> m.getName().equals(name) && Modifier.isStatic(m.getModifiers()) == isStatic);
  }

  private static Object constant(String name) {
    int dot = name.lastIndexOf('.');
    Class<?> type = sdkClass(name.substring(0, dot));
    try {
      Field field = type == null ? null : type.getField(name.substring(dot + 1));
      return field != null && Modifier.isStatic(field.getModifiers()) ? field.get(null) : null;
    } catch (ReflectiveOperationException missing) {
      return null;
    }
  }

  private static CalmLensException raisedError(JsonObject spec) {
    CalmLensServerClient failing = client(request -> {
      Map<String, List<String>> headers = new java.util.HashMap<>();
      spec.getAsJsonObject("headers").entrySet().forEach(e -> headers.put(e.getKey(), List.of(e.getValue().getAsString())));
      return new Transport.Response(spec.get("status").getAsInt(), headers, spec.get("body").toString().getBytes(StandardCharsets.UTF_8));
    });
    return assertThrows(CalmLensException.class,
        () -> Fixtures.invoke(failing, spec.get("operation").getAsString(), spec.getAsJsonObject("options")));
  }

  private static boolean present(JsonObject capability, JsonObject surface) throws Exception {
    String name = capability.getAsJsonObject("names").get("java").getAsString();
    String value = capability.has("value") ? capability.get("value").getAsString() : null;
    switch (capability.get("kind").getAsString()) {
      case "method": {
        String[] parts = name.split("\\.");
        Class<?> target = CalmLensServerClient.class;
        if (parts.length == 2) {
          try {
            target = CalmLensServerClient.class.getField(parts[0]).getType();
          } catch (NoSuchFieldException missing) {
            return false;
          }
        }
        return hasMethod(target, parts[parts.length - 1], false);
      }
      case "function":
      case "mock-function": {
        int dot = name.lastIndexOf('.');
        return hasMethod(sdkClass(name.substring(0, dot)), name.substring(dot + 1), true);
      }
      case "constant":
        return value.equals(constant(name));
      case "error-field": {
        JsonObject spec = surface.getAsJsonObject("errorResponse");
        JsonObject expected = spec.getAsJsonObject("expected");
        Object want = switch (capability.get("id").getAsString()) {
          case "errors.code" -> expected.get("code").getAsString();
          case "errors.status" -> expected.get("status").getAsInt();
          case "errors.requestId" -> expected.get("requestId").getAsString();
          case "errors.retryAfter" -> Optional.of(Duration.ofSeconds(expected.get("retryAfterSeconds").getAsLong()));
          default -> throw new AssertionError(capability);
        };
        CalmLensException error = raisedError(spec);
        Method accessor;
        try {
          accessor = error.getClass().getMethod(name);
        } catch (NoSuchMethodException missing) {
          return false;
        }
        return want.equals(accessor.invoke(error));
      }
      case "cdn-resource":
        return REFUSING.cdn.getAssetUrl(new Models.CdnRequest("asset-1").resource(name)).endsWith("/asset-1/" + value);
      case "cdn-option":
      case "mock-option": {
        int dot = name.lastIndexOf('.');
        return hasMethod(sdkClass(name.substring(0, dot)), name.substring(dot + 1), false);
      }
      case "mock-client":
        return sdkClass(name) != null;
      case "mock-method":
        return hasMethod(MockCalmLensServerClient.class, name, false);
      default:
        throw new AssertionError("Unknown capability kind " + capability);
    }
  }

  @Test void offersEveryCapability() throws Exception {
    JsonObject surface = Fixtures.read("surface.json").getAsJsonObject();
    List<String> missing = new ArrayList<>();
    for (JsonElement item : surface.getAsJsonArray("capabilities")) {
      JsonObject capability = item.getAsJsonObject();
      if (!present(capability, surface))
        missing.add(capability.get("id").getAsString() + " (" + capability.getAsJsonObject("names").get("java").getAsString() + ")");
    }
    assertEquals(List.of(), missing);
  }

  @Test void refusesRejectedRequestsBeforeSending() throws Exception {
    for (JsonElement item : Fixtures.read("rejections.json").getAsJsonArray()) {
      JsonObject rejection = item.getAsJsonObject();
      String name = rejection.get("name").getAsString();
      JsonObject options = rejection.getAsJsonObject("options");
      if (REJECTED_BY_TYPE.containsKey(name)) {
        // The typed options cannot hold the fixture's value: it does not survive decoding.
        JsonObject typed = Models.encode(Fixtures.decode(options, Models.SignedUrlOptions.class));
        assertNotEquals(options, typed, name + ": " + REJECTED_BY_TYPE.get(name));
        continue;
      }
      Throwable failure = assertThrows(Throwable.class,
          () -> Fixtures.invoke(REFUSING, rejection.get("operation").getAsString(), options), name);
      assertInstanceOf(CalmLensException.class, failure, name);
      assertEquals(rejection.get("error").getAsString(), ((CalmLensException) failure).getCode(), name);
    }
  }
}
