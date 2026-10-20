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

  @Test void signsATokenTheBackendCanVerifyAgainstTheKeysHash() throws Exception {
    CalmLensServerClient client = CalmLensServerClient.builder(API_KEY, "project-1").build();
    long before = System.currentTimeMillis();
    Models.SignedUploadToken signed = client.uploadTokens.sign(
        new Models.SignUploadToken("preset-1").externalId("post-42").expiresInSeconds(120));
    assertTrue(signed.token().startsWith("clut_"));
    String body = signed.token().substring(5, signed.token().indexOf('.'));
    String sent = signed.token().substring(signed.token().indexOf('.') + 1);
    JsonObject claims = claims(signed.token());
    assertEquals(1, claims.get("v").getAsInt());
    assertEquals("preset-1", claims.get("u").getAsString());
    assertEquals("post-42", claims.get("x").getAsString());
    assertEquals("clsk_use_abcd", claims.get("k").getAsString());
    assertEquals(signed.expiresAt(), claims.get("e").getAsLong());
    long lifetime = signed.expiresAt() - before;
    assertTrue(lifetime >= 120_000 && lifetime < 121_000, "lifetime " + lifetime);
    assertEquals(signature(body, API_KEY), sent);
    assertNotEquals(signature(body, "other"), sent);
  }

  @Test void everyTokenHasItsOwnNonceAndOtherKeysUseAnEightCharacterPrefix() {
    CalmLensServerClient client = CalmLensServerClient.builder("legacykey-1234", "project-1").build();
    JsonObject first = claims(client.uploadTokens.sign(new Models.SignUploadToken("p1")).token());
    JsonObject second = claims(client.uploadTokens.sign(new Models.SignUploadToken("p1")).token());
    assertNotEquals(first.get("n").getAsString(), second.get("n").getAsString());
    assertEquals("legacyke", first.get("k").getAsString());
    assertFalse(first.has("x"));
  }

  @Test void rejectsInvalidOptions() {
    CalmLensServerClient client = CalmLensServerClient.builder(API_KEY, "project-1").build();
    for (Models.SignUploadToken options : new Models.SignUploadToken[] {
        new Models.SignUploadToken(), new Models.SignUploadToken("p").expiresInSeconds(3601),
        new Models.SignUploadToken("p").expiresInSeconds(0), new Models.SignUploadToken("p").externalId("")}) {
      CalmLensException error = assertThrows(CalmLensException.class, () -> client.uploadTokens.sign(options));
      assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, error.getCode());
    }
  }

  @Test void theMockSignsTokensWithoutARequest() throws Exception {
    MockCalmLensServerClient mock = new MockCalmLensServerClient();
    Models.SignedUploadToken signed = mock.client.uploadTokens.sign(new Models.SignUploadToken("preset-1"));
    String body = signed.token().substring(5, signed.token().indexOf('.'));
    assertEquals(0, mock.requests().size());
    assertTrue(signed.token().endsWith("." + signature(body, "mock-key")));
  }

  @Test void uploadPresetIdIsSentAsAQueryParameter() {
    MockCalmLensServerClient mock = new MockCalmLensServerClient().enqueue(200, Fixtures.asset("asset-1", "processing", "pending"));
    mock.client.assets.create(Models.SubmitAsset.text("hi").uploadPresetId("preset-1"));
    assertEquals("preset-1", mock.requests().get(0).query().get("uploadPresetId"));
  }
}
