/**
 * The CalmLens server SDK: {@link com.calmlens.CalmLensServerClient} and its request params
 * ({@code com.calmlens.params}), response models ({@code com.calmlens.models}), exceptions ({@code
 * com.calmlens.exception}) and the offline mock client ({@code com.calmlens.testing}).
 */
module com.calmlens {
  requires transitive com.google.gson;
  requires transitive java.net.http;
  requires static transitive org.jspecify;

  exports com.calmlens;
  exports com.calmlens.exception;
  exports com.calmlens.models;
  exports com.calmlens.params;
  exports com.calmlens.testing;

  opens com.calmlens.models to com.google.gson;
  opens com.calmlens.params to com.google.gson;
  opens com.calmlens.internal to com.google.gson;
  opens com.calmlens.testing to com.google.gson;
  opens com.calmlens to com.google.gson;
}
