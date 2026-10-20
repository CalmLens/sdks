package com.calmlens;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Bounds body reads, which {@link java.net.http.HttpClient}'s request timeout does not cover: a
 * single daemon thread closes a stream whose deadline passes, so a blocked read fails instead of
 * hanging.
 */
final class Timeouts {
  private Timeouts() {}

  private static final ScheduledThreadPoolExecutor TIMER = new ScheduledThreadPoolExecutor(1, runnable -> {
    Thread thread = new Thread(runnable, "calmlens-timeouts");
    thread.setDaemon(true);
    return thread;
  });

  static {
    TIMER.setRemoveOnCancelPolicy(true);
  }

  static ScheduledFuture<?> schedule(Runnable task, Duration delay) {
    return TIMER.schedule(task, Math.max(1, delay.toMillis()), TimeUnit.MILLISECONDS);
  }

  private static void closeQuietly(InputStream in) {
    try { in.close(); } catch (IOException ignored) { /* the read in progress reports the failure */ }
  }

  /** Thrown when a deadline or idle timeout closed the stream. */
  static final class BodyTimeout extends HttpTimeoutException {
    private static final long serialVersionUID = 1L;
    BodyTimeout(String message) { super(message); }
  }

  /**
   * Reads at most {@code maxBytes} from {@code in} within {@code timeout}.
   *
   * @return the bytes, or null when the body is larger than {@code maxBytes}
   */
  static byte[] readAll(InputStream in, long maxBytes, Duration timeout) throws IOException {
    AtomicBoolean fired = new AtomicBoolean();
    ScheduledFuture<?> timer = timeout == null ? null : schedule(() -> { fired.set(true); closeQuietly(in); }, timeout);
    try {
      byte[] body = in.readNBytes((int) Math.min(Integer.MAX_VALUE - 8, maxBytes + 1));
      if (fired.get()) throw new BodyTimeout("Response body was not received within " + timeout);
      return body.length > maxBytes ? null : body;
    } catch (IOException failure) {
      if (fired.get()) {
        BodyTimeout timedOut = new BodyTimeout("Response body was not received within " + timeout);
        timedOut.initCause(failure);
        throw timedOut;
      }
      throw failure;
    } finally {
      if (timer != null) timer.cancel(false);
    }
  }

  /** Fails a read that receives no data for {@code idle}, by closing the underlying stream. */
  static final class IdleTimeoutInputStream extends FilterInputStream {
    private final Duration idle;
    private final AtomicBoolean fired = new AtomicBoolean();

    IdleTimeoutInputStream(InputStream in, Duration idle) {
      super(in);
      this.idle = idle;
    }

    private ScheduledFuture<?> arm() {
      return idle == null ? null : schedule(() -> { fired.set(true); closeQuietly(in); }, idle);
    }

    private IOException timeout(IOException cause) {
      BodyTimeout timedOut = new BodyTimeout("No data received for " + idle);
      if (cause != null) timedOut.initCause(cause);
      return timedOut;
    }

    @Override public int read() throws IOException {
      byte[] one = new byte[1];
      int read = read(one, 0, 1);
      return read < 0 ? -1 : one[0] & 0xff;
    }

    @Override public int read(byte[] buffer, int offset, int length) throws IOException {
      if (fired.get()) throw timeout(null);
      ScheduledFuture<?> timer = arm();
      try {
        int read = in.read(buffer, offset, length);
        if (fired.get()) throw timeout(null);
        return read;
      } catch (IOException failure) {
        if (fired.get() && !(failure instanceof BodyTimeout)) throw timeout(failure);
        throw failure;
      } finally {
        if (timer != null) timer.cancel(false);
      }
    }

    @Override public long skip(long count) throws IOException {
      ScheduledFuture<?> timer = arm();
      try { return in.skip(count); } finally { if (timer != null) timer.cancel(false); }
    }
  }
}
