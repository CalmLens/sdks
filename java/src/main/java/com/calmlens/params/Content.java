package com.calmlens.params;

import com.google.gson.annotations.SerializedName;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.jspecify.annotations.Nullable;

/**
 * The content of an upload or of one part of a multipart upload: text, bytes, base64, a file or a
 * stream, with its MIME type. Create it with {@link #text}, {@link #bytes}, {@link #file} or {@link
 * #stream}; the {@code with...} methods return a copy with one more setting.
 */
public final class Content {
  @SerializedName("type") private final @Nullable String mimeType;
  private final @Nullable String plainText;
  private final @Nullable String base64;
  private final @Nullable List<Integer> bytes;
  private final @Nullable Long sizeInBytes;
  private final @Nullable Integer partNumber;
  private final @Nullable Boolean isFinal;
  private final transient byte @Nullable [] data;
  private final transient @Nullable Path file;
  private final transient @Nullable InputStream stream;

  private Content(@Nullable String mimeType, @Nullable String plainText, @Nullable String base64, @Nullable List<Integer> bytes,
      @Nullable Long sizeInBytes, @Nullable Integer partNumber, @Nullable Boolean isFinal, byte @Nullable [] data,
      @Nullable Path file, @Nullable InputStream stream) {
    this.mimeType = mimeType;
    this.plainText = plainText;
    this.base64 = base64;
    this.bytes = bytes == null ? null : List.copyOf(bytes);
    this.sizeInBytes = sizeInBytes;
    this.partNumber = partNumber;
    this.isFinal = isFinal;
    this.data = data;
    this.file = file;
    this.stream = stream;
  }

  /**
   * @param text UTF-8 text
   * @return {@code text/plain} content
   */
  public static Content text(String text) {
    return new Content("text/plain", Objects.requireNonNull(text, "text"), null, null, null, null, null, null, null, null);
  }

  /**
   * @param bytes the content; not copied, so do not change it until the call returns
   * @param mimeType the file's MIME type, such as {@code image/png}
   * @return binary content
   */
  public static Content bytes(byte[] bytes, String mimeType) {
    return new Content(mimeType, null, null, null, null, null, null, Objects.requireNonNull(bytes, "bytes"), null, null);
  }

  /**
   * @param base64 the content, base64-encoded
   * @param mimeType the file's MIME type
   * @return binary content sent as base64
   */
  public static Content base64(String base64, String mimeType) {
    return new Content(mimeType, null, Objects.requireNonNull(base64, "base64"), null, null, null, null, null, null, null);
  }

  /**
   * @param file a regular file, streamed when the request is sent
   * @param mimeType the file's MIME type
   * @return file content
   */
  public static Content file(Path file, String mimeType) {
    return new Content(mimeType, null, null, null, null, null, null, null, Objects.requireNonNull(file, "file"), null);
  }

  /**
   * Content read from a stream. The stream is read once and not closed; requests that carry it are
   * not retried automatically.
   *
   * @param stream the source
   * @param sizeInBytes the exact number of bytes the stream supplies
   * @param mimeType the file's MIME type
   * @return streamed content
   */
  public static Content stream(InputStream stream, long sizeInBytes, String mimeType) {
    return new Content(mimeType, null, null, null, sizeInBytes, null, null, null, null, Objects.requireNonNull(stream, "stream"));
  }

  /**
   * Content read from a stream whose size is not known. It is sent chunked, without {@code
   * sizeInBytes}; the stream is read once and not closed, and the request is not retried.
   *
   * @param stream the source
   * @param mimeType the file's MIME type
   * @return streamed content
   */
  public static Content stream(InputStream stream, String mimeType) {
    return new Content(mimeType, null, null, null, null, null, null, null, null, Objects.requireNonNull(stream, "stream"));
  }

  /**
   * @param value the MIME type
   * @return a copy with this MIME type
   */
  public Content withMimeType(@Nullable String value) {
    return new Content(value, plainText, base64, bytes, sizeInBytes, partNumber, isFinal, data, file, stream);
  }

  /**
   * @param value the byte values, 0 to 255, sent as a JSON array
   * @return a copy with these bytes
   */
  public Content withBytes(@Nullable List<Integer> value) {
    return new Content(mimeType, plainText, base64, value, sizeInBytes, partNumber, isFinal, data, file, stream);
  }

  /**
   * @param value the content's size in bytes
   * @return a copy with this size
   */
  public Content withSizeInBytes(@Nullable Long value) {
    return new Content(mimeType, plainText, base64, bytes, value, partNumber, isFinal, data, file, stream);
  }

  /**
   * @param value the part's number, from 1, for a multipart upload
   * @return a copy with this part number
   */
  public Content withPartNumber(@Nullable Integer value) {
    return new Content(mimeType, plainText, base64, bytes, sizeInBytes, value, isFinal, data, file, stream);
  }

  /**
   * @param value whether this is the last part of a multipart upload
   * @return a copy marked so
   */
  public Content withIsFinal(@Nullable Boolean value) {
    return new Content(mimeType, plainText, base64, bytes, sizeInBytes, partNumber, value, data, file, stream);
  }

  /** @return the MIME type */
  public Optional<String> getMimeType() { return Optional.ofNullable(mimeType); }

  /** @return the text of text content */
  public Optional<String> getPlainText() { return Optional.ofNullable(plainText); }

  /** @return the base64 of base64 content */
  public Optional<String> getBase64() { return Optional.ofNullable(base64); }

  /** @return the byte values sent as a JSON array */
  public Optional<List<Integer>> getBytes() { return Optional.ofNullable(bytes); }

  /** @return the size in bytes, when set */
  public Optional<Long> getSizeInBytes() { return Optional.ofNullable(sizeInBytes); }

  /** @return the part number, for a multipart upload */
  public Optional<Integer> getPartNumber() { return Optional.ofNullable(partNumber); }

  /** @return whether this is the last part, when set */
  public Optional<Boolean> getIsFinal() { return Optional.ofNullable(isFinal); }

  /** @return the bytes of byte content; not a copy */
  public Optional<byte[]> getData() { return Optional.ofNullable(data); }

  /** @return the file of file content */
  public Optional<Path> getFile() { return Optional.ofNullable(file); }

  /** @return the stream of streamed content */
  public Optional<InputStream> getStream() { return Optional.ofNullable(stream); }

  @Override public String toString() {
    String source = data != null ? "bytes[" + data.length + "]" : file != null ? "file" : stream != null ? "stream" : null;
    return "Content{type=" + mimeType + (source == null ? "" : ", source=" + source)
        + (plainText == null ? "" : ", plainText=" + plainText.length() + " chars")
        + (base64 == null ? "" : ", base64=" + base64.length() + " chars")
        + (sizeInBytes == null ? "" : ", sizeInBytes=" + sizeInBytes)
        + (partNumber == null ? "" : ", partNumber=" + partNumber)
        + (isFinal == null ? "" : ", isFinal=" + isFinal) + "}";
  }
}
