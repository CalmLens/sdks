package com.calmlens.models;

import com.calmlens.internal.Required;
import java.util.List;
import java.util.Optional;

/**
 * A link in an asset and what its destination is (preview).
 */
public final class CheckedLink extends CalmLensObject {
  private String url;
  private String finalUrl;
  private Integer redirects;
  private String source;
  private String verdict;
  private List<LinkSafetyEvidence> evidence;

  private CheckedLink() {}

  // NOTE: no facts (not in types.json)
  /** @return the link as found, with {@code https://} added when it was left out; empty when the API sends none */
  public Optional<String> getUrl() { return Optional.ofNullable(url); }

  // NOTE: no facts (not in types.json)
  /** @return where the link leads after following its redirects; null when a short link or redirect chain could not be followed; empty when the API sends none */
  public Optional<String> getFinalUrl() { return Optional.ofNullable(finalUrl); }

  // NOTE: no facts (not in types.json)
  /** @return how many redirects were followed to reach {@code finalUrl}; empty when the API sends none */
  public Optional<Integer> getRedirects() { return Optional.ofNullable(redirects); }

  // NOTE: no facts (not in types.json)
  /** @return where it was found: {@code qr-code} or {@code text}; empty when the API sends none */
  public Optional<String> getSource() { return Optional.ofNullable(source); }

  // NOTE: no facts (not in types.json)
  /** @return {@code safe}, {@code adult}, {@code gambling}, {@code phishing}, {@code malware} or {@code unresolved}: the most severe finding of any address on the way; empty when the API sends none */
  public Optional<String> getVerdict() { return Optional.ofNullable(verdict); }

  // NOTE: no facts (not in types.json)
  /** @return the reputation checks of the link, its redirects and its destination; empty when the API sends none */
  public Optional<List<LinkSafetyEvidence>> getEvidence() { return Optional.ofNullable(evidence); }
}
