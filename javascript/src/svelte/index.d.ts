import type { Component } from "svelte";
import type { MediaProps, UploaderProps } from "../ui.js";

/**
 * A drop zone and file list that uploads through an upload preset, shows each file's progress
 * and moderation decision, and reports finished uploads to `onUploaded`.
 */
export declare const CalmLensUploader: Component<UploaderProps>;

/**
 * Shows an asset from the CalmLens CDN with responsive sources and a blurred placeholder while
 * it loads. Age-restricted assets stay behind the placeholder and a reveal button until
 * `canView` is set; blocked and purged assets show an unavailable notice.
 */
export declare const CalmLensMedia: Component<MediaProps>;

export * from "../ui.js";
