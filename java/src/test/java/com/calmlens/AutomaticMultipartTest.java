package com.calmlens;

import static org.junit.jupiter.api.Assertions.*;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Content larger than partSizeBytes is uploaded in parts, retried per part and resumable by key. */
class AutomaticMultipartTest {
  private static final int MIB = 1024 * 1024;

  /** One request as the transport received it, with its body read. */
  private record Sent(String path, Map<String, String> query, String key, byte[] body) {}

  /** Distinct bytes, so a part sent at the wrong offset shows. */
  private static byte[] fileOf(int length) {
    byte[] bytes = new byte[length];
    for (int i = 0; i < length; i++) bytes[i] = (byte) ((i * 7) % 251);
    return bytes;
  }

  private static Map<String, String> query(String raw) {
    Map<String, String> query = new HashMap<>();
    if (raw != null) for (String pair : raw.split("&")) {
      String[] kv = pair.split("=", 2);
      query.put(URLDecoder.decode(kv[0], StandardCharsets.UTF_8), kv.length > 1 ? URLDecoder.decode(kv[1], StandardCharsets.UTF_8) : "");
    }
    return query;
  }

  /** A transport that records each request and answers with {@code respond(request, index)}. */
  private static Transport scripted(List<Sent> sent, BiFunction<Sent, Integer, Transport.Response> respond) {
    return request -> {
      byte[] body;
      if (request.body() == null) body = new byte[0];
      else try (InputStream in = request.body().open()) { body = in.readAllBytes(); }
      Sent recorded = new Sent(request.uri().getRawPath(), query(request.uri().getRawQuery()), request.headers().get("Idempotency-Key"), body);
      sent.add(recorded);
      return respond.apply(recorded, sent.size() - 1);
    };
  }

  /** Answers each part like the API: the asset, completed by the final part. */
  private static Transport.Response uploadResponse(Sent request) {
    return Fixtures.json(200, Fixtures.assetJson("asset-1", "true".equals(request.query().get("isFinal")) ? "completed" : "pending", "allowed"));
  }

  private static Transport.Response apiError(String code, int status, String details) {
    return Fixtures.json(status, "{\"code\":\"" + code + "\",\"message\":\"" + code + "\",\"requestId\":\"req\",\"details\":" + details + "}");
  }

  private static byte[] joined(List<Sent> sent) {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    for (Sent request : sent) out.writeBytes(request.body());
    return out.toByteArray();
  }

  private static List<Object> each(List<Sent> sent, java.util.function.Function<Sent, Object> field) {
    List<Object> values = new ArrayList<>();
    for (Sent request : sent) values.add(field.apply(request));
    return values;
  }

  @Test void contentLargerThanPartSizeBytesIsSentInPartsWithDerivedKeys() {
    List<Sent> sent = new ArrayList<>();
    CalmLensServerClient client = CalmLensServerClient.builder("key", "project-1").partSizeBytes(5L * MIB)
        .transport(scripted(sent, (request, index) -> uploadResponse(request))).build();
    byte[] file = fileOf(11 * MIB);
    client.assets.classify(new Models.SubmitAsset("clip.mp4", Models.Content.bytes(file, "video/mp4")), new RequestOptions().idempotencyKey("upload-1"));

    assertEquals(List.of("/v1/projects/project-1/assets", "/v1/assets/asset-1/part", "/v1/assets/asset-1/part"), each(sent, Sent::path));
    assertEquals(List.of("upload-1", "upload-1:part-2", "upload-1:part-3"), each(sent, Sent::key));
    assertEquals(List.of("1", "2", "3"), each(sent, r -> r.query().get("partNumber")));
    assertEquals(List.of("false", "false", "true"), each(sent, r -> r.query().get("isFinal")));
    assertEquals(List.of(String.valueOf(5 * MIB), String.valueOf(5 * MIB), String.valueOf(MIB)), each(sent, r -> r.query().get("sizeInBytes")));
    assertEquals(String.valueOf(11 * MIB), sent.get(0).query().get("totalSizeInBytes"));
    // The queue choice goes with the first part, which saves it for the upload.
    assertEquals(java.util.Arrays.asList("false", null, null), each(sent, r -> r.query().get("queue")));
    assertArrayEquals(file, joined(sent));
  }

  @Test void aFileIsReadAgainPartByPart(@TempDir Path directory) throws IOException {
    Path path = directory.resolve("report.pdf");
    byte[] file = fileOf(12 * MIB + 3);
    Files.write(path, file);
    List<Sent> sent = new ArrayList<>();
    CalmLensServerClient client = CalmLensServerClient.builder("key", "project-1").partSizeBytes(5L * MIB)
        .transport(scripted(sent, (request, index) -> uploadResponse(request))).build();
    client.assets.create(new Models.SubmitAsset("report.pdf", Models.Content.file(path, "application/pdf")));
    assertEquals(List.of("1", "2", "3"), each(sent, r -> r.query().get("partNumber")));
    assertArrayEquals(file, joined(sent));
    // Without a caller's key, the parts share a generated one.
    assertEquals(sent.get(0).key() + ":part-3", sent.get(2).key());
  }

  @Test void contentOfOnePartOrLessAndStreamsGoInOneRequest() {
    List<Sent> sent = new ArrayList<>();
    CalmLensServerClient client = CalmLensServerClient.builder("key", "project-1")
        .transport(scripted(sent, (request, index) -> uploadResponse(request))).build();
    client.assets.create(new Models.SubmitAsset("exact.pdf", Models.Content.bytes(fileOf(8 * MIB), "application/pdf")));
    byte[] streamed = fileOf(9 * MIB);
    client.assets.create(new Models.SubmitAsset("stream.pdf", Models.Content.stream(new ByteArrayInputStream(streamed), streamed.length, "application/pdf")));
    assertEquals(java.util.Arrays.asList(null, null), each(sent, r -> r.query().get("partNumber")));
    assertEquals(List.of(8 * MIB, 9 * MIB), each(sent, r -> r.body().length));
  }

  @Test void aFailedPartIsRetriedWithItsOwnKeyAndAPartTheApiHasIsSkipped() {
    List<Sent> sent = new ArrayList<>();
    CalmLensServerClient client = CalmLensServerClient.builder("key", "project-1").partSizeBytes(5L * MIB).maxRetries(1)
        .transport(scripted(sent, (request, index) -> {
          if (index == 1) return Fixtures.json(503, "{}", Map.of("Retry-After", List.of("0")));
          // Part 3's response was lost before: the API asks for part 4.
          if ("3".equals(request.query().get("partNumber")))
            return apiError(ErrorCodes.INVALID_UPLOAD_PART_NUMBER, 409, "{\"expectedPartNumber\":4,\"receivedPartNumber\":3}");
          return uploadResponse(request);
        })).build(null, delay -> {});
    Models.Asset result = client.assets.create(new Models.SubmitAsset("report.pdf", Models.Content.bytes(fileOf(16 * MIB), "application/pdf")),
        new RequestOptions().idempotencyKey("upload-2"));
    assertEquals(Models.AssetClassificationStatus.COMPLETED, result.classification().status());
    assertEquals(List.of("upload-2", "upload-2:part-2", "upload-2:part-2", "upload-2:part-3", "upload-2:part-4"), each(sent, Sent::key));
    assertArrayEquals(sent.get(1).body(), sent.get(2).body());
    assertEquals("true", sent.get(4).query().get("isFinal"));
  }

  @Test void aFinalPartThatFindsTheUploadCompletedReadsTheAssetBack() {
    List<Sent> sent = new ArrayList<>();
    CalmLensServerClient client = CalmLensServerClient.builder("key", "project-1")
        .transport(scripted(sent, (request, index) -> request.path().endsWith("/part") ? apiError(ErrorCodes.UPLOAD_NOT_OPEN, 409, "{}")
            : Fixtures.json(200, Fixtures.assetJson("asset-1", "completed", "allowed")))).build();
    Models.Asset result = client.assets.create(new Models.SubmitAsset("clip.mp4", Models.Content.bytes(fileOf(9 * MIB), "video/mp4")));
    assertEquals("asset-1", result.id());
    assertEquals(List.of("/v1/projects/project-1/assets", "/v1/assets/asset-1/part", "/v1/assets/asset-1"), each(sent, Sent::path));
  }

  @Test void refusesAPartSizeOutsideItsRangeAnOverLongKeyAndAnImageOver20MiB() {
    for (long size : new long[] {5L * MIB - 1, 64L * MIB + 1})
      assertEquals(ErrorCodes.SDK_INVALID_CONFIG, assertThrows(CalmLensException.class,
          () -> CalmLensServerClient.builder("key", "project-1").partSizeBytes(size).build()).getCode());
    List<Sent> sent = new ArrayList<>();
    CalmLensServerClient client = CalmLensServerClient.builder("key", "project-1")
        .transport(scripted(sent, (request, index) -> uploadResponse(request))).build();
    assertEquals(ErrorCodes.SDK_INVALID_ARGUMENT, assertThrows(CalmLensException.class, () -> client.assets.create(
        new Models.SubmitAsset("clip.mp4", Models.Content.bytes(fileOf(9 * MIB), "video/mp4")), new RequestOptions().idempotencyKey("k".repeat(241)))).getCode());
    CalmLensException tooLarge = assertThrows(CalmLensException.class, () -> client.assets.create(
        new Models.SubmitAsset("huge.png", Models.Content.bytes(fileOf(21 * MIB), "image/png"))));
    assertEquals(ErrorCodes.UPLOAD_TOO_LARGE, tooLarge.getCode());
    assertEquals(Map.of("limitBytes", 20L * MIB, "source", "plan"), tooLarge.getDetails());
    assertEquals(List.of(), sent);
    // An image over the one-request limit goes in parts.
    client.assets.create(new Models.SubmitAsset("large.png", Models.Content.bytes(fileOf(12 * MIB), "image/png")));
    assertEquals(List.of("1", "2"), each(sent, r -> r.query().get("partNumber")));
  }

  @Test void theMockJoinsThePartsAndResumesAnUploadWithTheSameKeyAfterAFailedPart() {
    List<Integer> moderated = new ArrayList<>();
    MockCalmLensServerClient mock = new MockCalmLensServerClient(CalmLensServerClient.builder(MockCalmLensServerClient.createMockApiKey(), "project-1")
        .partSizeBytes(5L * MIB), new MockCalmLensServerClient.Options().moderate(input -> {
          moderated.add(1);
          return MockDecision.of("allowed");
        }));
    byte[] file = fileOf(12 * MIB);
    Models.SubmitAsset options = new Models.SubmitAsset("report.pdf", Models.Content.bytes(file, "application/pdf"))
        .processingOptions(new Models.ProcessingOptions().keepContentAfterProcessing(true));
    RequestOptions key = new RequestOptions().idempotencyKey("upload-3");
    mock.failNextRequest("transport-error", new MockCalmLensServerClient.FailureOptions().operation("assets.uploadPart"));
    assertEquals(ErrorCodes.SDK_TRANSPORT_ERROR, assertThrows(CalmLensException.class, () -> mock.client.assets.classify(options, key)).getCode());
    Models.Asset finished = mock.client.assets.classify(options, key);
    assertEquals(Models.AssetClassificationStatus.COMPLETED, finished.classification().status());
    assertEquals(List.of(finished.id()), mock.client.assets.list(new Models.ListAssets()).items().stream().map(Models.Asset::id).toList());
    assertEquals(List.of(1), moderated);
    mock.withStorage(storage -> {
      ByteArrayOutputStream stored = new ByteArrayOutputStream();
      var parts = storage.content.get(finished.id()).parts();
      assertEquals(List.of(1, 2, 3), List.copyOf(parts.keySet()));
      parts.values().forEach(stored::writeBytes);
      assertArrayEquals(file, stored.toByteArray());
    });
  }
}
