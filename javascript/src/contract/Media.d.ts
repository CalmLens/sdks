/**
 * Limits shared with the media decoder. Oversized media fails; it is never truncated.
 *
 * A clip of up to `MAX_MEDIA_DURATION_SECONDS` and `MAX_MEDIA_UPLOAD_BYTES` is analysed in one
 * pass, and these are also the limits of a free upload (made before billing is set up). With
 * billing set up, longer media up to the long-media limits is analysed in sections. The media
 * processor accepts up to an hour and 2 GiB, so these limits can grow to that without a new
 * container image.
 */
export declare const MAX_MEDIA_UPLOAD_BYTES: number;