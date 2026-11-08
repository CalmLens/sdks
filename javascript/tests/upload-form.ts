// Reads an upload form as the API does (packages/sdk-contract/README.md, "Scripted client cases"):
// exactly an `options` part, then a `file` part, then the closing boundary.

export interface UploadForm {
  /** The options part's JSON. */
  options: unknown;
  file: { type: string | null; bytes: Uint8Array };
}

export const readUploadForm = (body: Uint8Array, contentType: string | null): UploadForm => {
  const boundary = /^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(
    contentType ?? "",
  );
  if (!boundary) throw new Error(`not an upload form: ${contentType}`);
  // As latin1 text, each character is one byte, so text offsets are byte offsets.
  const framed = `\r\n${Buffer.from(body).toString("latin1")}`;
  const delimiter = `\r\n--${boundary[1] ?? boundary[2]}`;
  if (framed.indexOf(delimiter) !== 0) throw new Error("the form doesn't start with its boundary");
  const parts: { name?: string; type?: string; bytes: Uint8Array }[] = [];
  for (let at = 0; !framed.startsWith("--", at + delimiter.length); ) {
    const headerEnd = framed.indexOf("\r\n\r\n", at);
    const next = headerEnd === -1 ? -1 : framed.indexOf(delimiter, headerEnd + 4);
    if (next === -1) throw new Error("the form ends before its closing boundary");
    const headers = framed.slice(at + delimiter.length + 2, headerEnd);
    parts.push({
      name: /^content-disposition:\s*form-data;[^\r\n]*?\bname="([^"]*)"/im.exec(headers)?.[1],
      type: /^content-type:\s*([^\r\n]*)/im.exec(headers)?.[1],
      bytes: body.slice(headerEnd + 2, next - 2),
    });
    at = next;
  }
  const names = parts.map((part) => part.name).join();
  if (names !== "options,file") throw new Error(`the form holds ${names}, not options then file`);
  return {
    options: JSON.parse(new TextDecoder().decode(parts[0]!.bytes)),
    file: { type: parts[1]!.type ?? null, bytes: parts[1]!.bytes },
  };
};
