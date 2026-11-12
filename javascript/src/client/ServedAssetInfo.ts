/** Pixel dimensions of the representation served by the CDN. */
export interface ServedAssetInfo {
  readonly width: number;
  readonly height: number;
}

export interface CdnResponse extends Response {
  /** Reads the served image dimensions from the headers without consuming the body. */
  getAssetInfo(): ServedAssetInfo | undefined;
  clone(): CdnResponse;
}

export function parseServedAssetInfo(header: string | null): ServedAssetInfo | undefined {
  if (!header) return undefined;
  const dimensions: Partial<Record<"width" | "height", number>> = {};
  let start = 0;
  // A future member can contain quoted commas. Only bare commas delimit dictionary members.
  for (const delimiter of `${header},`.matchAll(/"(?:[^"\\]|\\.)*"|[",]/g)) {
    if (delimiter[0] === '"') return undefined;
    if (delimiter[0] !== ",") continue;
    const member = header.slice(start, delimiter.index).trim();
    start = delimiter.index + 1;
    const [key] = member.split(/[=; \t]/, 1);
    if (key !== "width" && key !== "height") continue;
    const match = /^(?:width|height)=([0-9]{1,15})$/.exec(member);
    if (!match || dimensions[key] !== undefined || Number(match[1]) === 0) return undefined;
    dimensions[key] = Number(match[1]);
  }
  const { width, height } = dimensions;
  return width === undefined || height === undefined ? undefined : { width, height };
}
