package calmmarket;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** A small, bounded multipart/form-data parser for the listing form. */
final class Multipart {
  record Part(String name, String fileName, byte[] data) {
    String text() { return new String(data, StandardCharsets.UTF_8); }
  }

  static final class Invalid extends Exception {
    Invalid(String message) { super(message); }
  }

  private Multipart() {}

  /** Returns the boundary from a multipart/form-data Content-Type, or null. */
  static String boundary(String contentType) {
    if (contentType == null) return null;
    String[] parts = contentType.split(";");
    if (!parts[0].strip().equalsIgnoreCase("multipart/form-data")) return null;
    for (int i = 1; i < parts.length; i++) {
      String parameter = parts[i].strip();
      if (parameter.toLowerCase(Locale.ROOT).startsWith("boundary=")) {
        String value = parameter.substring(9);
        if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) value = value.substring(1, value.length() - 1);
        return value.isEmpty() || value.length() > 70 ? null : value;
      }
    }
    return null;
  }

  static List<Part> parse(byte[] body, String boundary, int maxParts) throws Invalid {
    byte[] delimiter = ("--" + boundary).getBytes(StandardCharsets.ISO_8859_1);
    int position = indexOf(body, delimiter, 0);
    if (position != 0) throw new Invalid("Malformed form");
    List<Part> parts = new ArrayList<>();
    while (true) {
      position += delimiter.length;
      if (startsWith(body, position, "--")) return parts;
      if (!startsWith(body, position, "\r\n")) throw new Invalid("Malformed form");
      position += 2;
      int headersEnd = indexOf(body, "\r\n\r\n".getBytes(StandardCharsets.ISO_8859_1), position);
      if (headersEnd < 0 || headersEnd - position > 4096) throw new Invalid("Malformed form");
      String headers = new String(body, position, headersEnd - position, StandardCharsets.UTF_8);
      int next = indexOf(body, ("\r\n--" + boundary).getBytes(StandardCharsets.ISO_8859_1), headersEnd + 4);
      if (next < 0) throw new Invalid("Malformed form");
      if (parts.size() == maxParts) throw new Invalid("Too many form fields");
      parts.add(part(headers, java.util.Arrays.copyOfRange(body, headersEnd + 4, next)));
      position = next + 2;
    }
  }

  private static Part part(String headers, byte[] data) throws Invalid {
    for (String line : headers.split("\r\n")) {
      int colon = line.indexOf(':');
      if (colon < 0 || !line.substring(0, colon).strip().equalsIgnoreCase("content-disposition")) continue;
      String name = null, fileName = null;
      for (String parameter : line.substring(colon + 1).split(";")) {
        String[] pair = parameter.strip().split("=", 2);
        if (pair.length != 2) continue;
        String value = pair[1].strip();
        if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) value = value.substring(1, value.length() - 1);
        if (pair[0].equalsIgnoreCase("name")) name = value;
        else if (pair[0].equalsIgnoreCase("filename")) fileName = value;
      }
      if (name == null || name.isEmpty()) break;
      return new Part(name, fileName, data);
    }
    throw new Invalid("Malformed form");
  }

  private static boolean startsWith(byte[] body, int offset, String prefix) {
    if (offset + prefix.length() > body.length) return false;
    for (int i = 0; i < prefix.length(); i++) if (body[offset + i] != prefix.charAt(i)) return false;
    return true;
  }

  private static int indexOf(byte[] body, byte[] needle, int from) {
    outer:
    for (int i = Math.max(0, from); i <= body.length - needle.length; i++) {
      for (int j = 0; j < needle.length; j++) if (body[i + j] != needle[j]) continue outer;
      return i;
    }
    return -1;
  }
}
