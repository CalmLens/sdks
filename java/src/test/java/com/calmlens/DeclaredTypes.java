package com.calmlens;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.google.gson.annotations.SerializedName;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Parameter;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.lang.reflect.WildcardType;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;

/**
 * Compares the Java SDK's declared types with {@code types.json} (packages/sdk-contract/README.md,
 * "Declared types") and returns every mismatch as {@code <operation> <options|result> $.<path>:
 * <problem>}. Only {@link ContractTest#declaredTypesMatchTheApi()} uses it; that runner holds the
 * Java-specific allowlists.
 *
 * <p>How Java declares the README's rules:
 *
 * <ul>
 *   <li><b>Fields</b> are the Gson wire names: a field's {@link SerializedName}, else its name.
 *       Options are the non-transient instance fields of the options builder; results are record
 *       components.
 *   <li><b>Required options</b> are the parameters of a public constructor (compiled with {@code
 *       -parameters}) whose parameter names are exactly the operation's required options. Optional
 *       options are reference types, so an unset one is not sent.
 *   <li><b>Null in options</b> is {@code Patch}, set with a builder's {@code clearX()}: it sends an explicit null. A plain field
 *       omits null.
 *   <li><b>Results</b> are records. Every Java reference type can be null, and records shared with
 *       options keep their scalars boxed, so a required field can't be marked as always present:
 *       the check is that a field the API may omit or null is never a primitive (which would
 *       decode a missing value as 0 or false).
 *   <li><b>Enums</b> are Java enums (values are their {@link SerializedName}s) or the SDK's open
 *       value classes ({@code of(String)}, {@code value()} and one public constant per known
 *       value).
 *   <li><b>Unions of objects</b> are one record whose fields are every branch's fields, so the
 *       walk merges the branches: a field is required when every branch requires it, and a
 *       branch-specific tag lists every branch's value.
 *   <li><b>Maps</b> stand for records ({@code additionalProperties}) and for objects whose fields all
 *       share one type, such as one entry per category.
 *   <li><b>Timestamps</b> are {@link Instant}s that the wire carries as epoch milliseconds
 *       ({@code integer}).
 * </ul>
 */
final class DeclaredTypes {
  private final JsonObject definitions;
  private final List<String> problems = new ArrayList<>();
  private String operation;
  private String side;
  private boolean patch;
  private final Map<String, String> openStrings;
  private final Set<String> usedOpenStrings;
  /** The declaring {@code Class.field} of the value being compared, for {@link #openStrings}. */
  private String field;
  /** The model field whose presence is being checked. */
  private Field currentField;

  /**
   * @param openStrings {@code Class.field} (or {@code Class.field[]} / {@code Class.field{key}} for
   *     items and keys) that the SDK keeps as open Strings where the API lists values, with the reason
   * @param usedOpenStrings collects the entries of {@code openStrings} the walk needed
   */
  DeclaredTypes(JsonObject contract, Map<String, String> openStrings, Set<String> usedOpenStrings) {
    this.definitions = contract.getAsJsonObject("definitions");
    this.openStrings = openStrings;
    this.usedOpenStrings = usedOpenStrings;
  }

  /** Inputs that are not options (README "Declared types"): they have language-native forms. */
  static final Set<String> NOT_OPTIONS = Set.of("projectId", "wait", "content", "part", "url", "sizeInBytes", "totalSizeInBytes", "isFinal");

  List<String> check(JsonObject op, Method method) {
    operation = op.get("id").getAsString();
    patch = "PATCH".equals(op.get("method").getAsString());
    JsonObject options = op.getAsJsonObject("options");
    side = "options";
    checkOptions(options, method);
    side = "result";
    patch = false;
    JsonElement result = op.get("result");
    if (result == null || result.isJsonNull()) {
      // The method returns no model, or one the contract leaves untyped.
    } else if (method.getReturnType() == void.class) {
      problem("$", "returns nothing, the API returns a body");
    } else {
      compare(result.getAsJsonObject(), method.getGenericReturnType(), "$", new LinkedHashSet<>(), true, false);
    }
    return problems;
  }

  private void problem(String path, String message) {
    problems.add(operation + " " + side + " " + path + ": " + message);
  }

  // ------------------------------------------------------------------ Options

  private void checkOptions(JsonObject options, Method method) {
    JsonObject properties = options.getAsJsonObject("properties");
    Set<String> required = strings(options.getAsJsonArray("required"));
    Set<String> clientOptions = options.has("clientOptions") ? strings(options.getAsJsonArray("clientOptions")) : Set.of();
    // A parameter named after an option is that option (path IDs, ensure lists); params hold the rest.
    Map<String, Parameter> positional = new LinkedHashMap<>();
    Class<?> params = null;
    for (Parameter parameter : method.getParameters()) {
      if (!parameter.isNamePresent()) throw new IllegalStateException("compile with -parameters");
      if (com.calmlens.params.ApiParams.class.isAssignableFrom(parameter.getType())) params = parameter.getType();
      else if (parameter.getType() != com.calmlens.RequestOptions.class) positional.put(parameter.getName(), parameter);
    }
    Map<String, Field> fields = params == null ? new LinkedHashMap<>() : wireFields(params);
    for (String name : NOT_OPTIONS) fields.remove(name);
    for (String name : clientOptions) fields.remove(name);
    for (var entry : properties.entrySet()) {
      String name = entry.getKey();
      String path = "$." + name;
      JsonObject schema = entry.getValue().getAsJsonObject().getAsJsonObject("schema");
      Parameter parameter = positional.remove(name);
      if (parameter != null) {
        // A positional argument is always passed: the option must be required.
        if (!required.contains(name)) problem(path, "a required argument, but the option is optional");
        this.field = method.getDeclaringClass().getSimpleName() + "." + method.getName() + "(" + name + ")";
        Nullable split = nullable(schema, new LinkedHashSet<>());
        if (split.schema() != null) compare(split.schema(), parameter.getParameterizedType(), path, new LinkedHashSet<>(), false, true);
        continue;
      }
      Field field = fields.remove(name);
      if (field == null) { problem(path, "not declared"); continue; }
      this.field = field.getDeclaringClass().getSimpleName() + "." + field.getName();
      property(schema, field.getGenericType(), path, required.contains(name), new LinkedHashSet<>(), false);
      boolean marked = field.isAnnotationPresent(com.calmlens.internal.Required.class);
      if (required.contains(name) && !marked) problem(path, "optional in the params builder, but the API requires it");
      if (!required.contains(name) && marked) problem(path, "required by the params builder, but the API makes it optional");
    }
    for (String extra : fields.keySet()) problem("$." + extra, "declared, but the API has no such option");
    for (String extra : positional.keySet())
      if (!NOT_OPTIONS.contains(extra) && !(extra.equals("timeout") && method.getName().equals("waitForDecision")))
        problem("$." + extra, "a parameter, but the API has no such option");
  }

  // ------------------------------------------------------------------ Walk

  /** A property of an object: presence and nullability, then its value. */
  private void property(JsonObject schema, Type declared, String path, boolean required, Set<String> inside, boolean result) {
    Nullable split = nullable(schema, inside);
    Class<?> raw = raw(declared);
    boolean isPatch = raw == com.calmlens.internal.Patch.class;
    boolean isOptional = raw == Optional.class;
    if (result) {
      // A required, non-null field is @Required (decoding fails without it) and its getter returns
      // the value; any other field's getter returns Optional.
      boolean marked = currentField != null && currentField.isAnnotationPresent(com.calmlens.internal.Required.class);
      boolean always = required && !split.allowsNull;
      if (currentField != null && always && !marked && !isOpen(schema)) problem(path, "optional, but the API always sends it");
      if (currentField != null && !always && marked) problem(path, "required, but the API " + (split.allowsNull ? "allows null" : "may omit it"));
      if (raw.isPrimitive()) problem(path, "a primitive field, which can't tell a missing value from 0 or false");
    } else {
      if (raw.isPrimitive() && !required) problem(path, "a primitive, so always sent; the option is optional");
      if (isPatch && !split.allowsNull) problem(path, "a Patch (sends null), but the API refuses null");
      if (patch && split.allowsNull && !isPatch) problem(path, "not a Patch, but this PATCH clears it with null");
    }
    Type value = isPatch || isOptional ? argument(declared, 0) : declared;
    if (split.schema == null) return; // only null
    compare(split.schema, value, path, inside, result, true);
  }

  /** The value: kind, enum values, arrays, records and objects. */
  private void compare(JsonObject schema, Type declared, String path, Set<String> inside, boolean result, boolean nullHandled) {
    if (schema.has("$ref")) {
      String ref = schema.get("$ref").getAsString();
      if (inside.contains(ref)) return;
      Set<String> deeper = new LinkedHashSet<>(inside);
      deeper.add(ref);
      compare(definitions.getAsJsonObject(ref.substring("#/definitions/".length())), declared, path, deeper, result, nullHandled);
      return;
    }
    if (!nullHandled) {
      Nullable split = nullable(schema, inside);
      if (split.schema == null) return;
      schema = split.schema;
    }
    Class<?> raw = raw(declared);
    if (raw == com.calmlens.internal.Patch.class || raw == Optional.class) { compare(schema, argument(declared, 0), path, inside, result, true); return; }
    if (isOpen(schema)) {
      if (raw != Object.class && raw != JsonElement.class) problem(path, "declared " + name(declared) + ", the API allows any JSON value");
      return;
    }
    if (schema.has("anyOf") || schema.has("oneOf")) { union(schema, declared, path, inside, result); return; }
    Set<String> values = enumValues(schema);
    if (values != null) { enumeration(values, declared, path); return; }
    if (schema.has("type") && schema.get("type").isJsonArray()) {
      List<JsonObject> kinds = new ArrayList<>();
      for (JsonElement kind : schema.getAsJsonArray("type")) { JsonObject one = schema.deepCopy(); one.add("type", kind); kinds.add(one); }
      if (!result) {
        // An option the API accepts as several kinds (a boolean or its multipart string form) is
        // declared as one of them.
        for (JsonObject kind : kinds) {
          int before = problems.size();
          compare(kind, declared, path, inside, result, true);
          if (problems.size() == before) return;
          problems.subList(before, problems.size()).clear();
        }
        problem(path, "declared " + name(declared) + ", should be one of " + schema.get("type"));
      } else if (raw != Object.class && raw != JsonElement.class) problem(path, "declared " + name(declared) + ", the API sends any of " + schema.get("type"));
      return;
    }
    String type = schemaType(schema);
    if (type == null) { problem(path, "schema has no type the runner understands: " + schema); return; }
    switch (type) {
      case "string" -> { if (raw != String.class) problem(path, "declared " + name(declared) + ", should be a String"); }
      case "boolean" -> {
        if (raw != boolean.class && raw != Boolean.class) problem(path, "declared " + name(declared) + ", should be a boolean");
      }
      case "integer" -> {
        if (!Set.of(int.class, Integer.class, long.class, Long.class, double.class, Double.class, Instant.class).contains(raw))
          problem(path, "declared " + name(declared) + ", should be an integer");
      }
      case "number" -> {
        if (!Set.of(double.class, Double.class, float.class, Float.class).contains(raw))
          problem(path, "declared " + name(declared) + ", should be a number that accepts fractions");
      }
      case "array" -> {
        if (!Collection.class.isAssignableFrom(raw) && !raw.isArray()) { problem(path, "declared " + name(declared) + ", should be a List"); return; }
        Type item = raw.isArray() ? raw.getComponentType() : argument(declared, 0);
        String owner = field;
        field = owner + "[]";
        if (schema.has("items")) compare(schema.getAsJsonObject("items"), item, path + "[]", inside, result, false);
        field = owner;
      }
      case "object" -> object(schema, declared, path, inside, result);
      default -> problem(path, "unknown schema type " + type);
    }
  }

  private void object(JsonObject schema, Type declared, String path, Set<String> inside, boolean result) {
    Class<?> raw = raw(declared);
    JsonObject properties = schema.has("properties") ? schema.getAsJsonObject("properties") : new JsonObject();
    JsonElement additional = schema.get("additionalProperties");
    boolean record = additional != null && additional.isJsonObject() && properties.size() == 0;
    if (record) {
      JsonObject values = additional.getAsJsonObject();
      if (isOpen(values) && !Map.class.isAssignableFrom(raw)) return; // any declared object
      if (!Map.class.isAssignableFrom(raw)) { problem(path, "declared " + name(declared) + ", should be a Map"); return; }
      if (schema.has("propertyNames")) {
        Set<String> keys = enumValues(schema.getAsJsonObject("propertyNames"));
        if (keys != null) mapKeys(keys, declared, path);
      }
      compare(values, argument(declared, 1), path + "{}", inside, result, false);
      return;
    }
    if (Map.class.isAssignableFrom(raw) && properties.size() > 0) {
      // A Map stands for an object whose fields all share one type, keyed by name (categories).
      mapKeys(new TreeSet<>(properties.keySet()), declared, path);
      currentField = null;
      for (var entry : properties.entrySet())
        property(entry.getValue().getAsJsonObject(), argument(declared, 1), path + "." + entry.getKey(), true, inside, result);
      return;
    }
    if (raw == Object.class || raw == JsonElement.class || raw.isPrimitive() || raw == String.class || Map.class.isAssignableFrom(raw) || Collection.class.isAssignableFrom(raw)) {
      problem(path, "declared " + name(declared) + ", should be an object with fields " + properties.keySet());
      return;
    }
    Set<String> required = schema.has("required") ? strings(schema.getAsJsonArray("required")) : Set.of();
    Map<String, Field> fields = wireFields(raw);
    for (var entry : properties.entrySet()) {
      String child = path + "." + entry.getKey();
      Field field = fields.remove(entry.getKey());
      if (field == null) { problem(child, "not declared"); continue; }
      this.field = field.getDeclaringClass().getSimpleName() + "." + field.getName();
      this.currentField = field;
      property(entry.getValue().getAsJsonObject(), field.getGenericType(), child, required.contains(entry.getKey()), inside, result);
      this.currentField = null;
    }
    for (String extra : fields.keySet()) problem(path + "." + extra, "declared, but the API has no such field");
  }

  private void mapKeys(Set<String> keys, Type declared, String path) {
    String owner = field;
    field = owner + "{key}";
    enumeration(keys, argument(declared, 0), path + "{key}");
    field = owner;
  }

  private void union(JsonObject schema, Type declared, String path, Set<String> inside, boolean result) {
    List<JsonObject> branches = new ArrayList<>();
    for (JsonElement branch : schema.has("anyOf") ? schema.getAsJsonArray("anyOf") : schema.getAsJsonArray("oneOf"))
      branches.add(branch.getAsJsonObject());
    if (branches.size() == 1) { compare(branches.get(0), declared, path, inside, result, false); return; }
    List<JsonObject> resolved = new ArrayList<>();
    Set<String> deeper = new LinkedHashSet<>(inside);
    for (JsonObject branch : branches) resolved.add(resolve(branch, deeper));
    if (resolved.stream().allMatch(b -> "object".equals(schemaType(b)) && b.has("properties"))) {
      object(mergeObjects(resolved), declared, path, deeper, result);
      return;
    }
    Set<String> values = new TreeSet<>();
    boolean allEnums = true;
    for (JsonObject branch : resolved) {
      Set<String> branchValues = enumValues(branch);
      if (branchValues == null) { allEnums = false; break; }
      values.addAll(branchValues);
    }
    if (allEnums) { enumeration(values, declared, path); return; }
    Set<String> kinds = new HashSet<>();
    for (JsonObject branch : resolved) kinds.add(isOpen(branch) ? "any" : String.valueOf(schemaType(branch)));
    if (kinds.size() == 1 && !kinds.contains("any") && !kinds.contains("object")) {
      // Same kind in every branch (a string and a string with a format, say).
      for (JsonObject branch : resolved) compare(branch, declared, path, deeper, result, false);
      return;
    }
    Class<?> raw = raw(declared);
    if (raw != Object.class && raw != JsonElement.class) problem(path, "declared " + name(declared) + ", the API allows any of " + kinds);
  }

  /** One object whose fields are every branch's fields; a field is required when every branch requires it. */
  private static JsonObject mergeObjects(List<JsonObject> branches) {
    Map<String, List<JsonObject>> fields = new LinkedHashMap<>();
    Set<String> required = null;
    for (JsonObject branch : branches) {
      for (var entry : branch.getAsJsonObject("properties").entrySet())
        fields.computeIfAbsent(entry.getKey(), k -> new ArrayList<>()).add(entry.getValue().getAsJsonObject());
      Set<String> branchRequired = branch.has("required") ? strings(branch.getAsJsonArray("required")) : Set.of();
      if (required == null) required = new LinkedHashSet<>(branchRequired);
      else required.retainAll(branchRequired);
    }
    JsonObject properties = new JsonObject();
    for (var entry : fields.entrySet()) {
      List<JsonObject> schemas = new ArrayList<>(new LinkedHashSet<>(entry.getValue()));
      if (schemas.size() == 1) { properties.add(entry.getKey(), schemas.get(0)); continue; }
      JsonArray anyOf = new JsonArray();
      schemas.forEach(anyOf::add);
      JsonObject union = new JsonObject();
      union.add("anyOf", anyOf);
      properties.add(entry.getKey(), union);
    }
    JsonObject merged = new JsonObject();
    merged.addProperty("type", "object");
    merged.add("properties", properties);
    JsonArray requiredArray = new JsonArray();
    required.forEach(requiredArray::add);
    merged.add("required", requiredArray);
    return merged;
  }

  private void enumeration(Set<String> values, Type declared, String path) {
    Class<?> raw = raw(declared);
    if (values.equals(Set.of("true")) || values.equals(Set.of("false"))) {
      if (raw != boolean.class && raw != Boolean.class) problem(path, "declared " + name(declared) + ", should be a boolean");
      return;
    }
    if (raw == String.class) {
      if (field != null && openStrings.containsKey(field)) usedOpenStrings.add(field);
      else problem(path, "a plain String (" + field + "), the API lists " + values);
      return;
    }
    Set<String> declaredValues = declaredValues(raw);
    if (declaredValues == null) { problem(path, "declared " + name(declared) + ", should be an enum of " + values); return; }
    Set<String> missing = new TreeSet<>(values);
    missing.removeAll(declaredValues);
    Set<String> extra = new TreeSet<>(declaredValues);
    extra.removeAll(values);
    if (!missing.isEmpty()) problem(path, raw.getSimpleName() + " lacks " + missing);
    if (!extra.isEmpty()) problem(path, raw.getSimpleName() + " has " + extra + ", which the API lacks");
  }

  /** The wire values of a Java enum or one of the SDK's open value classes, or null. */
  static Set<String> declaredValues(Class<?> type) {
    Set<String> values = new TreeSet<>();
    if (type.isEnum() && com.calmlens.models.ApiEnum.class.isAssignableFrom(type)) {
      // UNKNOWN has no value: it stands for every value this SDK version doesn't know.
      for (Object constant : type.getEnumConstants()) {
        String value = ((com.calmlens.models.ApiEnum) constant).getValue();
        if (value != null) values.add(value);
      }
      return values;
    }
    if (type.isEnum()) {
      for (Field field : type.getFields()) {
        if (!field.isEnumConstant()) continue;
        SerializedName name = field.getAnnotation(SerializedName.class);
        values.add(name != null ? name.value() : field.getName());
      }
      return values;
    }
    try {
      type.getMethod("of", String.class);
      Method value = type.getMethod("value");
      for (Field field : type.getFields()) {
        if (Modifier.isStatic(field.getModifiers()) && field.getType() == type) values.add((String) value.invoke(field.get(null)));
      }
      return values;
    } catch (NoSuchMethodException notOpen) {
      return null;
    } catch (ReflectiveOperationException failure) {
      throw new IllegalStateException(failure);
    }
  }

  // ------------------------------------------------------------------ Schemas

  private record Nullable(JsonObject schema, boolean allowsNull) {}

  /** Splits {@code null} off a schema: {@code type: [x, "null"]} or an {@code anyOf} with a null branch. */
  private Nullable nullable(JsonObject schema, Set<String> inside) {
    if (schema.has("type") && schema.get("type").isJsonArray()) {
      List<String> types = new ArrayList<>();
      schema.getAsJsonArray("type").forEach(t -> types.add(t.getAsString()));
      if (!types.remove("null")) return new Nullable(schema, false);
      if (types.isEmpty()) return new Nullable(null, true);
      JsonObject copy = schema.deepCopy();
      if (types.size() == 1) copy.addProperty("type", types.get(0));
      else { JsonArray rest = new JsonArray(); types.forEach(rest::add); copy.add("type", rest); }
      return new Nullable(copy, true);
    }
    if (schema.has("type") && "null".equals(schema.get("type").getAsString())) return new Nullable(null, true);
    String key = schema.has("anyOf") ? "anyOf" : schema.has("oneOf") ? "oneOf" : null;
    if (key == null) return new Nullable(schema, false);
    JsonArray rest = new JsonArray();
    boolean allowsNull = false;
    for (JsonElement branch : schema.getAsJsonArray(key)) {
      JsonObject object = branch.getAsJsonObject();
      if (object.has("type") && object.get("type").isJsonPrimitive() && "null".equals(object.get("type").getAsString())) allowsNull = true;
      else rest.add(object);
    }
    if (!allowsNull) return new Nullable(schema, false);
    if (rest.isEmpty()) return new Nullable(null, true);
    if (rest.size() == 1) return new Nullable(rest.get(0).getAsJsonObject(), true);
    JsonObject copy = new JsonObject();
    copy.add(key, rest);
    return new Nullable(copy, true);
  }

  private JsonObject resolve(JsonObject schema, Set<String> inside) {
    while (schema.has("$ref")) {
      String ref = schema.get("$ref").getAsString();
      inside.add(ref);
      schema = definitions.getAsJsonObject(ref.substring("#/definitions/".length()));
    }
    return schema;
  }

  private static boolean isOpen(JsonObject schema) {
    for (String key : List.of("type", "anyOf", "oneOf", "enum", "const", "properties", "$ref", "items", "additionalProperties")) if (schema.has(key)) return false;
    return true;
  }

  private static String schemaType(JsonObject schema) {
    JsonElement type = schema.get("type");
    if (type != null && type.isJsonPrimitive()) return type.getAsString();
    if (schema.has("properties") || schema.has("additionalProperties")) return "object";
    if (schema.has("items")) return "array";
    return null;
  }

  /** The values of an {@code enum} or {@code const}, as strings, or null when the schema lists none. */
  private static Set<String> enumValues(JsonObject schema) {
    Set<String> values = new TreeSet<>();
    if (schema.has("const")) values.add(primitive(schema.get("const")));
    else if (schema.has("enum")) schema.getAsJsonArray("enum").forEach(v -> values.add(primitive(v)));
    else return null;
    return values;
  }

  private static String primitive(JsonElement value) {
    if (value instanceof JsonPrimitive primitive) return primitive.getAsString();
    return value.toString();
  }

  private static Set<String> strings(JsonArray array) {
    Set<String> values = new LinkedHashSet<>();
    if (array != null) array.forEach(v -> values.add(v.getAsString()));
    return values;
  }

  // ------------------------------------------------------------------ Java types

  /** The Gson wire fields of a class: non-static, non-transient fields by their serialized name. */
  static Map<String, Field> wireFields(Class<?> type) {
    Map<String, Field> fields = new LinkedHashMap<>();
    for (Class<?> current = type; current != null && current != Object.class && current != Record.class; current = current.getSuperclass()) {
      for (Field field : current.getDeclaredFields()) {
        int modifiers = field.getModifiers();
        if (Modifier.isStatic(modifiers) || Modifier.isTransient(modifiers) || field.isSynthetic()) continue;
        // Json.KEEPS_JSON: Event and WebhookEventPayload keep the object they were read from.
        SerializedName name = field.getAnnotation(SerializedName.class);
        fields.put(name != null ? name.value() : field.getName(), field);
      }
    }
    return fields;
  }

  static Class<?> raw(Type type) {
    if (type instanceof Class<?> c) return c;
    if (type instanceof ParameterizedType p) return (Class<?>) p.getRawType();
    if (type instanceof WildcardType w) return raw(w.getUpperBounds()[0]);
    return Object.class;
  }

  private static Type argument(Type type, int index) {
    if (type instanceof ParameterizedType p) {
      Type argument = p.getActualTypeArguments()[index];
      return argument instanceof WildcardType w ? w.getUpperBounds()[0] : argument;
    }
    return Object.class;
  }

  private static String name(Type type) {
    return type.getTypeName().replace("com.calmlens.Models$", "").replace("java.lang.", "").replace("java.util.", "");
  }
}
