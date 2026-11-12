package com.calmlens;

import com.calmlens.internal.Json;
import com.calmlens.models.ApiResponse;
import com.google.gson.JsonElement;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** The response of {@link CalmLensServerClient#request}: its status, headers, request ID and JSON body. */
public final class RawResponse {
  private final ApiResponse response;
  private final JsonElement body;

  RawResponse(ApiResponse response, JsonElement body) {
    this.response = response;
    this.body = body;
  }

  /** @return the HTTP status */
  public int getStatus() { return response.getStatus(); }

  /** @return the response headers, with case-insensitive names */
  public Map<String, List<String>> getHeaders() { return response.getHeaders(); }

  /** @return the {@code X-Request-Id} CalmLens gave the request */
  public Optional<String> getRequestId() { return response.getRequestId(); }

  /** @return the JSON body; {@code JsonNull} when it was empty */
  public JsonElement getBody() { return body.deepCopy(); }

  /**
   * Reads the body as a model or other type, such as {@code Asset.class}.
   *
   * @param <T> the type
   * @param type the class
   * @return the body as that type
   */
  public <T> T getBodyAs(Class<T> type) {
    T value = Json.GSON.fromJson(body, type);
    if (value instanceof com.calmlens.models.CalmLensObject model) Json.setLastResponse(model, response);
    return value;
  }

  @Override public String toString() { return "RawResponse[status=" + getStatus() + ", requestId=" + getRequestId().orElse(null) + "]"; }
}
