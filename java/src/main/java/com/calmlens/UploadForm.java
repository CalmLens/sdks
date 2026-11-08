package com.calmlens;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * An upload form: {@code multipart/form-data} holding the asset's fields as the JSON {@code options}
 * part, then the content as the {@code file} part. Asset fields never go in the URL, which proxies,
 * CDNs and servers log; the query holds only transport values.
 */
final class UploadForm {
  private UploadForm() {}

  /** The asset fields an upload carries in its body; the API refuses them in the query string. */
  static final List<String> OPTION_KEYS = List.of("name", "description", "processingOptions", "visibility", "metadata", "tags",
      "authorId", "context", "externalId", "externalUrl", "folderId", "uploadPresetId");

  private static final Pattern BOUNDARY = Pattern.compile(";\\s*boundary=(?:\"([^\"]+)\"|([^;\\s]+))", Pattern.CASE_INSENSITIVE);
  private static final Pattern NAME = Pattern.compile("(?im)^content-disposition:\\s*form-data\\s*;[^\\r\\n]*?\\bname=\"([^\"]*)\"");
  private static final Pattern TYPE = Pattern.compile("(?im)^content-type:\\s*([^\\r\\n]*)");

  /** A form to send: its body and its {@code Content-Type}, which names the boundary. */
  record Built(Transport.Body body, String contentType) {}

  /** A form as read: the options part's text, the file part's {@code Content-Type} (or null) and bytes. */
  record Parsed(String options, String fileType, byte[] file) {}

  /** The upload fields of encoded submit options, in {@link #OPTION_KEYS} order, without null values. */
  static JsonObject fields(JsonObject options) {
    JsonObject fields = new JsonObject();
    for (String key : OPTION_KEYS) {
      JsonElement value = options.get(key);
      if (value != null && !value.isJsonNull()) fields.add(key, value);
    }
    return fields;
  }

  /**
   * The form for {@code options} and {@code file} of type {@code fileType}, under a random
   * boundary. The file is streamed as it is read; the form has a known length when the file does,
   * and can be sent again when the file can.
   */
  static Built build(JsonObject options, String fileType, Transport.Body file) {
    String boundary = "calmlens-" + UUID.randomUUID();
    String head = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"options\"\r\nContent-Type: application/json\r\n\r\n"
        + Json.write(options) + "\r\n--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"\r\nContent-Type: "
        + fileType.replaceAll("[\\r\\n]", "") + "\r\n\r\n";
    String tail = "\r\n--" + boundary + "--\r\n";
    return new Built(Transport.Body.framed(head.getBytes(StandardCharsets.UTF_8), file, tail.getBytes(StandardCharsets.UTF_8)),
        "multipart/form-data; boundary=" + boundary);
  }

  /** Whether {@code contentType} is {@code multipart/form-data}, whatever its parameters. */
  static boolean isForm(String contentType) {
    return contentType != null && contentType.split(";", 2)[0].strip().toLowerCase(Locale.ROOT).equals("multipart/form-data");
  }

  /**
   * Reads an upload form as the API does: exactly an {@code options} part, then a {@code file}
   * part, then the closing boundary.
   *
   * @throws IllegalArgumentException when the body is not such a form
   */
  static Parsed read(byte[] body, String contentType) {
    if (!isForm(contentType)) throw new IllegalArgumentException("Not multipart/form-data: " + contentType);
    Matcher boundary = BOUNDARY.matcher(contentType);
    if (!boundary.find()) throw new IllegalArgumentException("The multipart/form-data Content-Type needs a boundary");
    byte[] delimiter = ("\r\n--" + (boundary.group(1) != null ? boundary.group(1) : boundary.group(2))).getBytes(StandardCharsets.ISO_8859_1);
    byte[] framed = new byte[body.length + 2];
    framed[0] = '\r';
    framed[1] = '\n';
    System.arraycopy(body, 0, framed, 2, body.length);
    byte[] blank = {'\r', '\n', '\r', '\n'};
    List<String> names = new ArrayList<>();
    List<String> types = new ArrayList<>();
    List<byte[]> contents = new ArrayList<>();
    int at = indexOf(framed, delimiter, 0);
    if (at != 0) throw new IllegalArgumentException("The form doesn't start with its boundary");
    while (true) {
      int start = at + delimiter.length;
      if (start + 1 < framed.length && framed[start] == '-' && framed[start + 1] == '-') break;
      int headerEnd = indexOf(framed, blank, start);
      int next = headerEnd < 0 ? -1 : indexOf(framed, delimiter, headerEnd + 4);
      if (next < 0) throw new IllegalArgumentException("The upload body ended before its closing boundary");
      String headers = new String(framed, start, headerEnd - start, StandardCharsets.UTF_8);
      Matcher name = NAME.matcher(headers), type = TYPE.matcher(headers);
      names.add(name.find() ? name.group(1) : null);
      types.add(type.find() ? type.group(1).strip() : null);
      contents.add(Arrays.copyOfRange(framed, headerEnd + 4, next));
      at = next;
    }
    if (!names.equals(List.of("options", "file"))) throw new IllegalArgumentException("The upload form must hold an options part, then a file part, not " + names);
    return new Parsed(new String(contents.get(0), StandardCharsets.UTF_8), types.get(1), contents.get(1));
  }

  private static int indexOf(byte[] data, byte[] needle, int from) {
    outer:
    for (int i = Math.max(from, 0); i <= data.length - needle.length; i++) {
      for (int j = 0; j < needle.length; j++) if (data[i + j] != needle[j]) continue outer;
      return i;
    }
    return -1;
  }
}
