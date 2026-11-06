/** Resources that are served as they are: no lens or transform applies to them. */
declare const UNSELECTABLE_ASSET_RESOURCES: readonly ["original", "hls", "embed", "placeholder", "info"];
/**
 * Where each resource is served beneath an asset's URL. The HLS stream's master playlist is
 * `hls/index.m3u8`; its media playlists and segments are the other files beneath `hls/`.
 */
declare const ASSET_RESOURCE_PATHS: {
  readonly original: "original";
  readonly rendered: "rendered";
  readonly preview: "preview";
  readonly placeholder: "placeholder";
  readonly hls: "hls/index.m3u8";
  readonly embed: "embed";
  readonly info: "info";
};
export type { ASSET_RESOURCE_PATHS, UNSELECTABLE_ASSET_RESOURCES };