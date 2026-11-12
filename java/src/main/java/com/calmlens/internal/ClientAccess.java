package com.calmlens.internal;

import com.calmlens.CalmLensServerClient;
import com.calmlens.Transport;
import com.calmlens.models.SignedUploadToken;
import com.calmlens.params.UploadTokenSignParams;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.List;
import java.util.function.LongSupplier;
import org.jspecify.annotations.Nullable;

/**
 * What the offline mock needs from the client beyond its public API. Internal: {@link
 * CalmLensServerClient} installs the implementation when it loads.
 */
public interface ClientAccess {
  /**
   * @param builder the client configuration
   * @param transport the transport that answers every request
   * @param sleeper the retry waits
   * @param nanoTime the clock decision waits measure with
   * @param defaultMaxRetries the retries unless the builder sets them
   * @param deferUploadChecks whether size checks are left to the API
   * @return the client
   */
  CalmLensServerClient build(CalmLensServerClient.Builder builder, Transport transport, Sleeper sleeper, LongSupplier nanoTime,
      int defaultMaxRetries, boolean deferUploadChecks);

  /**
   * @param failure what a transport threw
   * @return the client's exception for it: a timeout or a connection failure
   */
  com.calmlens.exception.CalmLensException transportError(Throwable failure);

  /**
   * @param response a CDN response
   * @param body its body stream
   * @return the response as {@code cdn().serve} returns it
   */
  com.calmlens.CdnResponse cdnResponse(Transport.Response response, java.io.InputStream body);

  /**
   * Signs an upload token as {@code uploadTokens().sign} does, at {@code now} with {@code nonce}.
   *
   * @param apiKey the API key
   * @param params the token's params
   * @param now epoch milliseconds
   * @param nonce the token's nonce
   * @return the token
   */
  SignedUploadToken signUploadToken(String apiKey, UploadTokenSignParams params, long now, String nonce);

  /**
   * @param mimeType an upload's MIME type
   * @return whether the API accepts uploads of it
   */
  boolean isAcceptedUploadMimeType(String mimeType);

  /**
   * @param mimeType an upload's MIME type
   * @return the API's message refusing it
   */
  String rejectedUploadMimeTypeMessage(String mimeType);

  /**
   * @param value a path segment
   * @return it percent-encoded like JavaScript's {@code encodeURIComponent}
   */
  String encodeComponent(String value);

  /**
   * Reads a CDN selector as the CDN does.
   *
   * @param selector the path after the resource, still percent-encoded
   * @return the lens and options
   * @throws IllegalArgumentException for a selector the CDN refuses
   */
  TransformSelector parseTransformSelector(String selector);

  /**
   * @param options transform options
   * @return the keys the CDN doesn't know and those whose values it refuses
   */
  TransformProblems checkTransformOptions(JsonElement options);

  /**
   * A CDN selector as the CDN reads it.
   *
   * @param lens the lens, or null
   * @param options the transform options, or null
   */
  record TransformSelector(@Nullable String lens, @Nullable JsonObject options) {}

  /**
   * Transform options the CDN would refuse.
   *
   * @param unknownKeys dotted keys it doesn't know
   * @param invalidKeys dotted keys whose values it refuses
   */
  record TransformProblems(List<String> unknownKeys, List<String> invalidKeys) {
    /** @return whether there are none */
    public boolean isEmpty() { return unknownKeys.isEmpty() && invalidKeys.isEmpty(); }
  }

  /** The installed implementation. */
  final class Holder {
    private Holder() {}

    private static volatile ClientAccess access;

    /** @param value the implementation */
    public static void install(ClientAccess value) { access = value; }

    /** @return the implementation, loading the client first */
    public static ClientAccess get() {
      if (access == null) {
        try {
          Class.forName(CalmLensServerClient.class.getName(), true, CalmLensServerClient.class.getClassLoader());
        } catch (ClassNotFoundException unreachable) {
          throw new IllegalStateException(unreachable);
        }
      }
      return access;
    }
  }
}
