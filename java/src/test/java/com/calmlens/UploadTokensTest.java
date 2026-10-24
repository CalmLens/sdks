package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

class UploadTokensTest {
  private static final String API_KEY = "clsk_use_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHabcdef";

  private static String signature(String body, String apiKey) throws Exception {
    String secret = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(apiKey.getBytes(StandardCharsets.UTF_8)));
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    return HexFormat.of().formatHex(mac.doFinal(("calmlens-upload-token:v1:" + body).getBytes(StandardCharsets.UTF_8)));
  }

  private static JsonObject claims(String token) {
    String body = token.substring("clut_".length(), token.indexOf('.'));
    return JsonParser.parseString(new String(Base64.getUrlDecoder().decode(body), StandardCharsets.UTF_8)).getAsJsonObject();
  }

  @Test void theMockSignsTokensWithoutARequest() throws Exception {
    MockCalmLensServerClient mock = new MockCalmLensServerClient();
    Models.SignedUploadToken signed = mock.client.uploadTokens.sign(new Models.SignUploadToken("preset-1"));
    String body = signed.token().substring(5, signed.token().indexOf('.'));
    assertEquals(0, mock.requests().size());
    assertTrue(signed.token().endsWith("." + signature(body, "mock-key")));
  }

}
