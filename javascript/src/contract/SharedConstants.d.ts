import "zod";
export declare const MAX_IMAGE_UPLOAD_BYTES: number;
export declare const MIN_MULTIPART_IMAGE_UPLOAD_BYTES: number;
export declare const MIN_MULTIPART_UPLOAD_PART_BYTES: number;
export declare const isRejectedUploadMimeType: (mimeType: string) => boolean;
export declare const getRejectedUploadMimeTypeError: (mimeType: string) => string;
export declare const DOMAIN = "calmlens.com";