/** SHA-256 of the UTF-8 encoding of `value`, as lowercase hex. */
export declare const sha256Hex: (value: string) => Promise<string>;
/** HMAC-SHA256 of `message` keyed with `secret` (both UTF-8 encoded), as lowercase hex. */
export declare const hmacSha256Hex: (secret: string, message: string) => Promise<string>;
/**
 * Compares two strings without leaking, through timing, where they first differ. Strings of
 * different lengths are unequal immediately (the length itself is not secret here).
 */
export declare const timingSafeEqual: (a: string, b: string) => boolean;