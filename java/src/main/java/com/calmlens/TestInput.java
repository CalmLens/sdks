package com.calmlens;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * A test scenario for {@link TestInputs}: the qualifying instances found, and optionally regional
 * delivery actions and categories left unassessed. A null list is left out of the signed scenario;
 * an empty list is sent as an empty list. {@link TestInputs#generateTestTextCode(TestInput,
 * String)} checks the scenario.
 *
 * <pre>{@code
 * TestInput input = new TestInput(List.of(new TestInput.Instance("harassment", List.of("harassment-abuse")).withAction("block")));
 * }</pre>
 *
 * @param regionalActions delivery actions in up to 7 regions, each listed once, or null
 * @param unassessedCategories categories reported as not evaluated, none with instances, or null
 * @param instances the qualifying instances, at most 128
 */
public record TestInput(List<RegionalAction> regionalActions, List<String> unassessedCategories, List<Instance> instances) {
  /** Copies the lists so the record stays immutable. */
  public TestInput {
    regionalActions = copy(regionalActions);
    unassessedCategories = copy(unassessedCategories);
    instances = copy(instances);
  }

  /** @param instances the qualifying instances, at most 128 */
  public TestInput(List<Instance> instances) { this(null, null, instances); }

  /** @param instances the qualifying instances @return a copy with these instances */
  public TestInput withInstances(List<Instance> instances) { return new TestInput(regionalActions, unassessedCategories, instances); }

  /** @param regionalActions the regional delivery actions, or null @return a copy with these actions */
  public TestInput withRegionalActions(List<RegionalAction> regionalActions) { return new TestInput(regionalActions, unassessedCategories, instances); }

  /** @param unassessedCategories the unassessed categories, or null @return a copy with these categories */
  public TestInput withUnassessedCategories(List<String> unassessedCategories) { return new TestInput(regionalActions, unassessedCategories, instances); }

  /**
   * One qualifying instance of a category.
   *
   * @param category one of the 8 moderation categories, such as {@code harassment}
   * @param score the confidence from 0 to 1, or null for the default
   * @param action {@code allow}, {@code limit}, {@code age-restrict} or {@code block}, or null to let
   *     the project's policy decide; either every instance of a scenario has an action or none does
   * @param qualifiers unique qualifiers of the category, at most 64; qualifiers the input type sets,
   *     such as {@code sexual-text}, are added automatically and cannot be listed
   */
  public record Instance(String category, Double score, String action, List<String> qualifiers) {
    /** Copies the list so the record stays immutable. */
    public Instance {
      qualifiers = copy(qualifiers);
    }

    /**
     * @param category the category
     * @param qualifiers its qualifiers
     */
    public Instance(String category, List<String> qualifiers) { this(category, null, null, qualifiers); }

    /** @param score from 0 to 1, or null @return a copy with this score */
    public Instance withScore(Double score) { return new Instance(category, score, action, qualifiers); }

    /** @param action the action, or null @return a copy with this action */
    public Instance withAction(String action) { return new Instance(category, score, action, qualifiers); }
  }

  /**
   * A delivery action in one region.
   *
   * @param region {@code DE}, {@code AT}, {@code FR}, {@code GB}, {@code EU}, {@code AU} or {@code BR}
   * @param action {@code limit}, {@code age-restrict} or {@code block}
   */
  public record RegionalAction(String region, String action) {}

  private static <T> List<T> copy(List<T> value) {
    return value == null ? null : Collections.unmodifiableList(new ArrayList<>(value));
  }
}
