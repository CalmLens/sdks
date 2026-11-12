package com.calmlens.testing;

import com.calmlens.CalmLensServerClient;
import com.calmlens.CdnResponse;
import com.calmlens.RequestOptions;
import com.calmlens.ErrorCodes;
import com.calmlens.Transport;
import com.calmlens.exception.*;
import com.calmlens.internal.ClientAccess;
import com.calmlens.internal.Json;
import com.calmlens.internal.UploadForm;
import com.calmlens.models.*;
import com.calmlens.params.*;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * A test scenario for {@link TestInputs}: the qualifying instances found, and optionally regional
 * delivery actions, categories left unassessed and person and face detection results. A null list
 * or value is left out of the signed scenario; an empty list is sent as an empty list. {@link TestInputs#generateTestTextCode(TestInput,
 * String)} checks the scenario.
 *
 * <pre>{@code
 * TestInput input = new TestInput(List.of(new TestInput.Instance("harassment", List.of("harassment-abuse")).withAction("block")));
 * }</pre>
 *
 * @param regionalActions delivery actions in up to 7 regions, each listed once, or null
 * @param unassessedCategories categories reported as not evaluated, none with instances, or null
 * @param instances the qualifying instances, at most 128
 * @param detections the person and face detection results to report, or null
 */
public record TestInput(List<RegionalAction> regionalActions, List<String> unassessedCategories, List<Instance> instances, Detections detections) {
  /** Copies the lists so the record stays immutable. */
  public TestInput {
    regionalActions = copy(regionalActions);
    unassessedCategories = copy(unassessedCategories);
    instances = copy(instances);
  }

  /** @param instances the qualifying instances, at most 128 */
  public TestInput(List<Instance> instances) { this(null, null, instances, null); }

  /** @param instances the qualifying instances @return a copy with these instances */
  public TestInput withInstances(List<Instance> instances) { return new TestInput(regionalActions, unassessedCategories, instances, detections); }

  /** @param regionalActions the regional delivery actions, or null @return a copy with these actions */
  public TestInput withRegionalActions(List<RegionalAction> regionalActions) { return new TestInput(regionalActions, unassessedCategories, instances, detections); }

  /** @param unassessedCategories the unassessed categories, or null @return a copy with these categories */
  public TestInput withUnassessedCategories(List<String> unassessedCategories) { return new TestInput(regionalActions, unassessedCategories, instances, detections); }

  /** @param detections the detection results, or null @return a copy with these detection results */
  public TestInput withDetections(Detections detections) { return new TestInput(regionalActions, unassessedCategories, instances, detections); }

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

  /**
   * The person and face detection results a test image or text code reports, as if the features
   * had run. Test results, such as age ranges, are for testing only; never use them for real
   * decisions.
   *
   * <pre>{@code
   * new TestInput.Detections(
   *     TestInput.DetectionList.of(new TestInput.Person(new TestInput.Box(2500, 1500, 5000, 8500))),
   *     TestInput.DetectionList.of(new TestInput.Face(new TestInput.Box(3500, 2000, 3000, 3500)).withAge(TestInput.FaceAge.ADULT)));
   * }</pre>
   *
   * @param people the people found, {@link DetectionList#unavailable()} to report person detection
   *     as not evaluated, or null to leave it out
   * @param faces the faces found, {@link DetectionList#unavailable()} to report face detection as
   *     not evaluated, or null to leave it out
   */
  public record Detections(DetectionList<Person> people, DetectionList<Face> faces) {}

  /**
   * A detection result: the entries found, at most 32, or unavailable (the feature was not
   * evaluated).
   *
   * @param <T> {@link Person} or {@link Face}
   */
  public sealed interface DetectionList<T> permits DetectionList.Entries, DetectionList.Unavailable {
    /** @param <T> the entry type @param entries the entries, at most 32 @return the entries found */
    static <T> DetectionList<T> of(List<T> entries) { return new Entries<>(entries); }

    /** @param <T> the entry type @param entries the entries, at most 32 @return the entries found */
    @SafeVarargs
    static <T> DetectionList<T> of(T... entries) { return new Entries<>(java.util.Arrays.asList(entries)); }

    /** @param <T> the entry type @return the feature reported as not evaluated */
    static <T> DetectionList<T> unavailable() { return new Unavailable<>(); }

    /**
     * The entries found.
     *
     * @param <T> the entry type
     * @param entries the entries, at most 32; an empty list reports that nothing was found
     */
    record Entries<T>(List<T> entries) implements DetectionList<T> {
      /** Copies the list so the record stays immutable. */
      public Entries { entries = copy(entries); }
    }

    /**
     * The feature reported as not evaluated ({@code "unavailable"}).
     *
     * @param <T> the entry type
     */
    record Unavailable<T>() implements DetectionList<T> {}
  }

  /**
   * Where a person or face is, in basis points of the image (0 to 10000 of its width or height).
   *
   * @param left the left edge
   * @param top the top edge
   * @param width the width; {@code left + width} is at most 10000
   * @param height the height; {@code top + height} is at most 10000
   */
  public record Box(int left, int top, int width, int height) {}

  /**
   * A person found.
   *
   * @param box where the person is
   * @param confidence the confidence from 0 to 100, or null for the default
   */
  public record Person(Box box, Integer confidence) {
    /** @param box where the person is */
    public Person(Box box) { this(box, null); }

    /** @param confidence from 0 to 100, or null @return a copy with this confidence */
    public Person withConfidence(Integer confidence) { return new Person(box, confidence); }
  }

  /**
   * A face found.
   *
   * @param box where the face is
   * @param confidence the confidence from 0 to 100, or null for the default
   * @param age the estimated age, or null for none
   */
  public record Face(Box box, Integer confidence, FaceAge age) {
    /** @param box where the face is */
    public Face(Box box) { this(box, null, null); }

    /** @param confidence from 0 to 100, or null @return a copy with this confidence */
    public Face withConfidence(Integer confidence) { return new Face(box, confidence, age); }

    /** @param age the estimated age, or null @return a copy with this age */
    public Face withAge(FaceAge age) { return new Face(box, confidence, age); }
  }

  /** A face's estimated age: a preset ({@link #ADULT} or {@link #MINOR}) or a {@link Range}. */
  public sealed interface FaceAge permits FaceAge.Preset, FaceAge.Range {
    /** An adult's age range. */
    FaceAge ADULT = new Preset("adult");
    /** A minor's age range. */
    FaceAge MINOR = new Preset("minor");

    /**
     * A named age range.
     *
     * @param name {@code adult} or {@code minor}
     */
    record Preset(String name) implements FaceAge {}

    /**
     * An age range in years.
     *
     * @param low the youngest age, from 0 to 120
     * @param high the oldest age, from {@code low} to 120
     */
    record Range(int low, int high) implements FaceAge {}
  }

  private static <T> List<T> copy(List<T> value) {
    return value == null ? null : Collections.unmodifiableList(new ArrayList<>(value));
  }
}
