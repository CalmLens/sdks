package com.calmlens.internal;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a field the API always sends, and never as null, in a response model, or an option a
 * params builder requires. Decoding a model without one fails with {@code sdk/invalid-response};
 * building params without one fails with {@code sdk/invalid-argument}.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.FIELD)
public @interface Required {}
