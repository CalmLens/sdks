package com.calmlens;

/**
 * Receives every request attempt, for metrics and tracing; set it with {@link
 * CalmLensServerClient.Builder#requestListener(RequestListener)}. It runs on the calling thread, so
 * keep it fast; an exception it throws is ignored.
 */
@FunctionalInterface
public interface RequestListener {
  /** @param event the attempt that just finished */
  void onAttempt(RequestEvent event);
}
