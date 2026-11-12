package com.calmlens.testing;

import java.util.List;
import java.util.Map;

/** The mock's generated classification lists, for the surface runner in {@code com.calmlens}. */
public final class MockClassificationValues {
  private MockClassificationValues() {}

  /** @return the categories {@link MockDecision} accepts */
  public static List<String> categories() { return MockClassification.CATEGORIES; }

  /** @return the qualifiers {@link MockDecision} accepts, by category */
  public static Map<String, List<String>> qualifiers() { return MockClassification.QUALIFIERS; }
}
