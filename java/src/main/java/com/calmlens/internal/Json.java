package com.calmlens.internal;

import com.calmlens.ErrorCodes;
import com.calmlens.exception.CalmLensException;
import com.calmlens.models.ApiEnum;
import com.calmlens.models.CalmLensObject;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.Strictness;
import com.google.gson.ToNumberPolicy;
import com.google.gson.TypeAdapter;
import com.google.gson.TypeAdapterFactory;
import com.google.gson.annotations.SerializedName;
import com.google.gson.reflect.TypeToken;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import com.google.gson.stream.JsonWriter;
import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The SDK's JSON configuration. Internal: not part of the public API, and may change in any release.
 * Numbers in untyped values stay exact (whole numbers become Long).
 */
public final class Json {
  private Json() {}

  private static GsonBuilder base() {
    return new GsonBuilder()
        .disableHtmlEscaping()
        .setObjectToNumberStrategy(ToNumberPolicy.LONG_OR_DOUBLE)
        .setNumberToNumberStrategy(ToNumberPolicy.LONG_OR_DOUBLE)
        .registerTypeAdapterFactory(new EnumFactory())
        .registerTypeAdapterFactory(new PatchAdapterFactory())
        .registerTypeAdapterFactory(new ModelFactory())
        .registerTypeAdapterFactory(new ParamsFactory());
  }

  /** Reads responses strictly and turns params into trees; unset fields are omitted. */
  public static final Gson GSON = base().setStrictness(Strictness.STRICT).create();

  /** Writes request bodies built as trees, keeping explicit nulls (cleared fields). */
  public static final Gson WRITE = base().serializeNulls().create();

  /**
   * @param value a JSON tree
   * @return its JSON text, nulls kept
   */
  public static String write(JsonElement value) { return WRITE.toJson(value); }

  /** Field facts per model class: the fields to make unmodifiable and the required ones. */
  private record ModelFields(List<Field> collections, List<Field> required) {}

  private static final Map<Class<?>, ModelFields> FIELDS = new ConcurrentHashMap<>();
  private static final Field RAW, LAST_RESPONSE;

  static {
    try {
      RAW = CalmLensObject.class.getDeclaredField("rawJsonObject");
      RAW.setAccessible(true);
      LAST_RESPONSE = CalmLensObject.class.getDeclaredField("lastResponse");
      LAST_RESPONSE.setAccessible(true);
    } catch (NoSuchFieldException missing) {
      throw new IllegalStateException(missing);
    }
  }

  private static ModelFields fields(Class<?> type) {
    return FIELDS.computeIfAbsent(type, t -> {
      List<Field> collections = new ArrayList<>(), required = new ArrayList<>();
      for (Class<?> current = t; current != CalmLensObject.class; current = current.getSuperclass())
        for (Field field : current.getDeclaredFields()) {
          if (Modifier.isStatic(field.getModifiers()) || Modifier.isTransient(field.getModifiers())) continue;
          field.setAccessible(true);
          if (List.class.isAssignableFrom(field.getType()) || Map.class.isAssignableFrom(field.getType())) collections.add(field);
          if (field.isAnnotationPresent(Required.class)) required.add(field);
        }
      return new ModelFields(collections, required);
    });
  }

  /**
   * Checks a model, and every model, list and map in it, for the fields the API always sends.
   *
   * @param model the model
   * @throws com.calmlens.exception.InvalidResponseException naming the first missing field
   */
  public static void validate(CalmLensObject model) {
    ModelFields facts = fields(model.getClass());
    try {
      for (Field field : facts.required())
        if (field.get(model) == null)
          throw CalmLensException.of(ErrorCodes.SDK_INVALID_RESPONSE, "The response's " + model.getClass().getSimpleName() + " has no "
              + wireName(field), Map.of("field", wireName(field)), 0, null, null, null, null);
      for (Class<?> current = model.getClass(); current != CalmLensObject.class; current = current.getSuperclass())
        for (Field field : current.getDeclaredFields()) {
          if (Modifier.isStatic(field.getModifiers()) || Modifier.isTransient(field.getModifiers())) continue;
          field.setAccessible(true);
          validateValue(field.get(model));
        }
    } catch (IllegalAccessException unreachable) {
      throw new IllegalStateException(unreachable);
    }
  }

  private static void validateValue(Object value) {
    if (value instanceof CalmLensObject nested) validate(nested);
    else if (value instanceof List<?> list) list.forEach(Json::validateValue);
    else if (value instanceof Map<?, ?> map) map.values().forEach(Json::validateValue);
  }

  /**
   * Records the response a model was read from.
   *
   * @param model the model
   * @param response its response
   */
  public static void setLastResponse(CalmLensObject model, com.calmlens.models.ApiResponse response) {
    try {
      LAST_RESPONSE.set(model, response);
    } catch (IllegalAccessException unreachable) {
      throw new IllegalStateException(unreachable);
    }
  }

  /** The API name of a field: its {@link SerializedName}, else its Java name. */
  public static String wireName(Field field) {
    SerializedName name = field.getAnnotation(SerializedName.class);
    return name != null ? name.value() : field.getName();
  }

  /**
   * Reads models keeping the JSON object they were read from and makes their lists and maps
   * unmodifiable (a missing required field fails when its getter is read, or in {@code validate()}); writes a model as that JSON object, unknown fields
   * included.
   */
  static final class ModelFactory implements TypeAdapterFactory {
    @Override
    @SuppressWarnings("unchecked")
    public <T> TypeAdapter<T> create(Gson gson, TypeToken<T> token) {
      if (!CalmLensObject.class.isAssignableFrom(token.getRawType())) return null;
      TypeAdapter<T> delegate = gson.getDelegateAdapter(this, token);
      TypeAdapter<JsonElement> elements = gson.getAdapter(JsonElement.class);
      Class<?> type = token.getRawType();
      return new TypeAdapter<T>() {
        @Override public void write(JsonWriter out, T value) throws IOException {
          if (value == null) { out.nullValue(); return; }
          boolean serializeNulls = out.getSerializeNulls();
          out.setSerializeNulls(true);
          try {
            elements.write(out, ((CalmLensObject) value).getRawJsonObject());
          } finally {
            out.setSerializeNulls(serializeNulls);
          }
        }

        @Override public T read(JsonReader in) throws IOException {
          JsonElement tree = elements.read(in);
          if (tree == null || tree.isJsonNull()) return null;
          if (!tree.isJsonObject()) throw new com.google.gson.JsonSyntaxException("Expected an object for " + type.getSimpleName());
          T model = delegate.fromJsonTree(tree);
          ModelFields facts = fields(type);
          try {
            RAW.set(model, tree.getAsJsonObject());
            for (Field field : facts.collections()) {
              Object value = field.get(model);
              if (value instanceof List<?> list) field.set(model, Collections.unmodifiableList(list));
              else if (value instanceof Map<?, ?> map) field.set(model, Collections.unmodifiableMap(new LinkedHashMap<>(map)));
            }
          } catch (IllegalAccessException unreachable) {
            throw new IllegalStateException(unreachable);
          }
          return model;
        }
      };
    }
  }

  /** Writes params with their extra params, which replace typed options of the same name. */
  static final class ParamsFactory implements TypeAdapterFactory {
    @Override
    public <T> TypeAdapter<T> create(Gson gson, TypeToken<T> token) {
      if (!com.calmlens.params.ApiParams.class.isAssignableFrom(token.getRawType())) return null;
      TypeAdapter<T> delegate = gson.getDelegateAdapter(this, token);
      TypeAdapter<JsonElement> elements = gson.getAdapter(JsonElement.class);
      return new TypeAdapter<T>() {
        @Override public void write(JsonWriter out, T value) throws IOException {
          if (value == null) { out.nullValue(); return; }
          // Written as text without nulls, so unset options are left out and cleared ones kept.
          java.io.StringWriter text = new java.io.StringWriter();
          JsonWriter writer = new JsonWriter(text);
          writer.setSerializeNulls(false);
          delegate.write(writer, value);
          writer.flush();
          JsonElement tree = com.google.gson.JsonParser.parseString(text.toString());
          Map<String, Object> extra = ((com.calmlens.params.ApiParams) value).getExtraParams();
          if (!extra.isEmpty() && tree.isJsonObject()) {
            JsonObject object = tree.getAsJsonObject();
            extra.forEach((key, item) -> object.add(key, item == null ? com.google.gson.JsonNull.INSTANCE : gson.toJsonTree(item)));
          }
          // The tree already leaves out unset options, so its nulls are cleared fields: keep them.
          boolean serializeNulls = out.getSerializeNulls();
          out.setSerializeNulls(true);
          try { elements.write(out, tree); } finally { out.setSerializeNulls(serializeNulls); }
        }

        @Override public T read(JsonReader in) throws IOException { return delegate.read(in); }
      };
    }
  }

  /** Reads an {@link ApiEnum} by its value, an unknown one as {@code UNKNOWN}, and refuses to write {@code UNKNOWN}. */
  static final class EnumFactory implements TypeAdapterFactory {
    @Override
    @SuppressWarnings({"unchecked", "rawtypes"})
    public <T> TypeAdapter<T> create(Gson gson, TypeToken<T> token) {
      Class<?> type = token.getRawType();
      if (!type.isEnum() || !ApiEnum.class.isAssignableFrom(type)) return null;
      Class<? extends Enum> enumType = (Class<? extends Enum>) type;
      return (TypeAdapter<T>) new TypeAdapter<ApiEnum>() {
        @Override public void write(JsonWriter out, ApiEnum value) throws IOException {
          if (value == null) { out.nullValue(); return; }
          if (value.getValue() == null)
            throw CalmLensException.of(ErrorCodes.SDK_INVALID_ARGUMENT, type.getSimpleName() + ".UNKNOWN can't be sent");
          out.value(value.getValue());
        }

        @Override public ApiEnum read(JsonReader in) throws IOException {
          if (in.peek() == JsonToken.NULL) { in.nextNull(); return null; }
          return (ApiEnum) ApiEnum.fromValue((Class) enumType, in.nextString());
        }
      };
    }
  }

  /** Metadata nulls are data; optional request fields still omit unset values. */
  public static final class MetadataValueAdapter extends TypeAdapter<Object> {
    @Override public void write(JsonWriter out, Object value) throws IOException {
      boolean serializeNulls = out.getSerializeNulls();
      out.setSerializeNulls(true);
      try {
        GSON.getAdapter(Object.class).write(out, value);
      } finally {
        out.setSerializeNulls(serializeNulls);
      }
    }

    @Override public Object read(JsonReader in) throws IOException {
      return GSON.getAdapter(Object.class).read(in);
    }
  }

  /** Timestamps are milliseconds since the Unix epoch on the wire and {@link Instant} in models. */
  public static final class EpochMillis extends TypeAdapter<Instant> {
    @Override public void write(JsonWriter out, Instant value) throws IOException {
      if (value == null) out.nullValue();
      else out.value(value.toEpochMilli());
    }

    @Override public Instant read(JsonReader in) throws IOException {
      JsonToken token = in.peek();
      if (token == JsonToken.NULL) { in.nextNull(); return null; }
      if (token == JsonToken.STRING) return Instant.parse(in.nextString());
      String number = in.nextString();
      try {
        return Instant.ofEpochMilli(Long.parseLong(number));
      } catch (NumberFormatException fractional) {
        return Instant.ofEpochMilli(Math.round(Double.parseDouble(number)));
      }
    }
  }

  /** Reads JSON null as {@link Patch#clear()} and writes it as null even when nulls are omitted. */
  static final class PatchAdapterFactory implements TypeAdapterFactory {
    @Override
    @SuppressWarnings("unchecked")
    public <T> TypeAdapter<T> create(Gson gson, TypeToken<T> token) {
      if (token.getRawType() != Patch.class) return null;
      Type valueType = token.getType() instanceof ParameterizedType parameterized ? parameterized.getActualTypeArguments()[0] : Object.class;
      TypeAdapter<Object> delegate = (TypeAdapter<Object>) gson.getAdapter(TypeToken.get(valueType));
      return (TypeAdapter<T>) new TypeAdapter<Patch<?>>() {
        @Override public void write(JsonWriter out, Patch<?> patch) throws IOException {
          if (patch == null) { out.nullValue(); return; }
          if (patch.isClear()) {
            boolean serializeNulls = out.getSerializeNulls();
            out.setSerializeNulls(true);
            out.nullValue();
            out.setSerializeNulls(serializeNulls);
            return;
          }
          delegate.write(out, patch.get());
        }

        @Override public Patch<?> read(JsonReader in) throws IOException {
          if (in.peek() == JsonToken.NULL) { in.nextNull(); return Patch.clear(); }
          return Patch.value(delegate.read(in));
        }
      };
    }
  }

  /**
   * @param object the object to add to
   * @param name the field
   * @param value a value Gson can encode, or null to skip
   */
  public static void addProperty(JsonObject object, String name, Object value) {
    if (value != null) object.add(name, GSON.toJsonTree(value));
  }
}
