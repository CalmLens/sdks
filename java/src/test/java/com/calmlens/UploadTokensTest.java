package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import com.calmlens.models.SignedUploadToken;
import com.calmlens.params.UploadTokenSignParams;
import com.calmlens.testing.MockCalmLensServerClient;
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
    SignedUploadToken signed = mock.client().uploadTokens().sign(UploadTokenSignParams.builder().setUploadPresetId("preset-1").build());
    String body = signed.getToken().substring(5, signed.getToken().indexOf('.'));
    assertEquals(0, mock.requests().size());
    assertTrue(signed.getToken().endsWith("." + signature(body, "mock-key")));
  }

}
