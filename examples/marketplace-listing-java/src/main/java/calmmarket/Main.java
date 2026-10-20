package calmmarket;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * Serves Calmmarket on loopback with the JDK's built-in HTTP server.
 * Requests are handled concurrently, on virtual threads when the JDK has them.
 */
public final class Main {
  static final int DEFAULT_PORT = 6404;
  /** Requests handled at once; each may hold a listing form of up to 16MiB in memory. */
  static final int MAX_CONCURRENT_REQUESTS = 32;

  private Main() {}

  /** Virtual threads on Java 21 and later (looked up reflectively, as the example targets Java 17), else a bounded pool. */
  static ExecutorService executor() {
    try {
      return (ExecutorService) Executors.class.getMethod("newVirtualThreadPerTaskExecutor").invoke(null);
    } catch (ReflectiveOperationException unavailable) {
      return Executors.newFixedThreadPool(MAX_CONCURRENT_REQUESTS);
    }
  }

  /** Starts a loopback server for {@code app}; port 0 picks a free port. */
  static HttpServer serve(Calmmarket app, int port) throws IOException {
    HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), port), 64);
    Semaphore slots = new Semaphore(MAX_CONCURRENT_REQUESTS);
    server.setExecutor(executor());
    server.createContext("/", exchange -> {
      try (exchange) {
        Calmmarket.Response response;
        boolean acquired = false;
        try {
          acquired = slots.tryAcquire(10, TimeUnit.SECONDS);
          response = acquired ? handle(app, exchange) : Calmmarket.text(503, "The server is busy. Try again.");
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
          response = Calmmarket.text(503, "The server is stopping.");
        } finally {
          if (acquired) slots.release();
        }
        response.headers().forEach(exchange.getResponseHeaders()::set);
        boolean empty = response.body().length == 0 || exchange.getRequestMethod().equals("HEAD");
        exchange.sendResponseHeaders(response.status(), empty ? -1 : response.body().length);
        if (!empty) try (OutputStream out = exchange.getResponseBody()) { out.write(response.body()); }
      }
    });
    server.start();
    return server;
  }

  /** A response to a request whose body was not read: the connection is closed instead of drained. */
  private static Calmmarket.Response refuse(int status, String message) {
    Calmmarket.Response response = Calmmarket.text(status, message);
    response.headers().put("connection", "close");
    return response;
  }

  private static Calmmarket.Response handle(Calmmarket app, HttpExchange exchange) throws IOException {
    String method = exchange.getRequestMethod();
    byte[] body = new byte[0];
    if (method.equals("POST")) {
      int limit = exchange.getRequestURI().getPath().equals("/listings") ? Calmmarket.MAX_FORM_BYTES : Calmmarket.MAX_WEBHOOK_BYTES;
      String length = exchange.getRequestHeaders().getFirst("content-length");
      long declared;
      try { declared = length == null ? -1 : Long.parseLong(length); } catch (NumberFormatException invalid) { declared = -1; }
      if (declared < 0) return refuse(411, "Content-Length is required");
      // Bodies are read only after their declared size has been checked.
      if (declared > limit) return refuse(413, "Request body is too large");
      try (InputStream in = exchange.getRequestBody()) { body = in.readNBytes((int) declared); }
      if (body.length != declared) return Calmmarket.text(400, "Incomplete request body");
    }
    Map<String, String> headers = new HashMap<>();
    for (Map.Entry<String, List<String>> header : exchange.getRequestHeaders().entrySet())
      if (!header.getValue().isEmpty()) headers.put(header.getKey().toLowerCase(Locale.ROOT), header.getValue().get(0));
    return app.handle(new Calmmarket.Request(method, exchange.getRequestURI().getPath(),
        exchange.getRequestURI().getRawQuery(), headers, body));
  }

  public static void main(String[] args) throws IOException {
    int port = DEFAULT_PORT;
    boolean demo = false;
    for (int i = 0; i < args.length; i++) {
      if (args[i].equals("--port") && i + 1 < args.length) port = Integer.parseInt(args[++i]);
      else if (args[i].equals("--demo")) demo = true;
      else { System.err.println("Usage: mvn -q compile exec:java [-Dexec.args=\"--port PORT --demo\"]"); System.exit(2); }
    }
    Calmmarket app;
    try {
      app = Calmmarket.fromEnvironment(System.getenv(), demo);
    } catch (IllegalArgumentException invalid) {
      System.err.println("Calmmarket: " + invalid.getMessage());
      System.exit(1);
      return;
    }
    serve(app, port);
    System.out.println("Calmmarket: http://127.0.0.1:" + port + " (" + (app.demo() ? "demo" : "live") + ")");
  }
}
