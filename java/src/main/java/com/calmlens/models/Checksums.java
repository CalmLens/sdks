package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.Optional;

/**
 * Digests of an asset's uploaded content. Each is null when not computed.
 */
public final class Checksums extends CalmLensObject {
  private String md5;
  private String sha1;
  private String sha256;
  private String sha384;
  private String sha512;

  private Checksums() {}

  /** @return MD5 digest; empty when the API sends none */
  public Optional<String> getMd5() { return Optional.ofNullable(md5); }

  /** @return SHA-1 digest; empty when the API sends none */
  public Optional<String> getSha1() { return Optional.ofNullable(sha1); }

  /** @return SHA-256 digest; empty when the API sends none */
  public Optional<String> getSha256() { return Optional.ofNullable(sha256); }

  /** @return SHA-384 digest; empty when the API sends none */
  public Optional<String> getSha384() { return Optional.ofNullable(sha384); }

  /** @return SHA-512 digest; empty when the API sends none */
  public Optional<String> getSha512() { return Optional.ofNullable(sha512); }
}
