export interface ProgressFetchOptions {
  /**
   * The size of everything this fetch will send, such as the file's size. An upload larger than
   * the client's `partSizeBytes` goes in several requests, and only this total keeps the
   * reported share of the file from restarting with each part.
   */
  totalBytes?: number;
}

/**
 * A `fetch` that reports how many bytes of the request body have been sent, which `fetch` itself
 * can't do. It sends through `XMLHttpRequest`, so the upload components pass it to
 * `CalmLensAppClient` as `uploadFetch`. Without `XMLHttpRequest` it falls back to `fetch` and
 * reports nothing.
 *
 * The count runs across the requests sent through it: `sentBytes` adds the bodies of earlier
 * requests that succeeded, so a file uploaded in parts keeps counting up. `totalBytes` is
 * `options.totalBytes` when given, otherwise those earlier bodies plus the current one. Create
 * one for each file.
 */
export const createProgressFetch = (
  onProgress: (sentBytes: number, totalBytes: number) => void,
  { totalBytes }: ProgressFetchOptions = {},
): ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => {
  if (typeof XMLHttpRequest === "undefined") return (input, init) => fetch(input, init);
  /** The bodies of the requests that succeeded, which a retry won't send again. */
  let accepted = 0;
  return (input, init = {}) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init.signal;
      const abortError = () =>
        signal?.reason ?? new DOMException("The upload was cancelled", "AbortError");
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const xhr = new XMLHttpRequest();
      xhr.open(init.method ?? "GET", url);
      xhr.responseType = "arraybuffer";
      for (const [name, value] of new Headers(init.headers)) xhr.setRequestHeader(name, value);
      let bodyBytes = 0;
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        bodyBytes = event.total;
        const total = totalBytes ?? accepted + event.total;
        onProgress(Math.min(accepted + event.loaded, total), total);
      };
      const onAbort = () => xhr.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      const done = () => signal?.removeEventListener("abort", onAbort);
      xhr.onload = () => {
        done();
        if (xhr.status >= 200 && xhr.status < 300) accepted += bodyBytes;
        const headers = new Headers();
        for (const line of xhr
          .getAllResponseHeaders()
          .trim()
          .split(/[\r\n]+/)) {
          const separator = line.indexOf(":");
          if (separator > 0) {
            headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
          }
        }
        const empty = [101, 204, 205, 304].includes(xhr.status);
        resolve(
          new Response(empty ? null : (xhr.response as ArrayBuffer), {
            status: xhr.status,
            statusText: xhr.statusText,
            headers,
          }),
        );
      };
      xhr.onerror = () => {
        done();
        reject(new TypeError("Network request failed"));
      };
      xhr.ontimeout = xhr.onerror;
      xhr.onabort = () => {
        done();
        reject(abortError());
      };
      xhr.send((init.body ?? null) as XMLHttpRequestBodyInit | null);
    });
};
