package com.calmlens.internal;

import java.time.Duration;

/** Waits between retries; replaced in mocks so tests do not sleep. Internal. */
@FunctionalInterface
public interface Sleeper {
  /**
   * @param delay how long to wait
   * @throws InterruptedException when the thread is interrupted
   */
  void sleep(Duration delay) throws InterruptedException;
}
