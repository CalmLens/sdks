type AssetDataInput = Blob | Response | ReadableStream<Uint8Array>;
type AssetBufferInput = ArrayBuffer | (Uint8Array & {
  write(string: string, offset?: number, length?: number, encoding?: string): number;
});
type AssetBinaryPayloadInput = {
  plainText: string;
  base64?: never;
  uint8Array?: never;
  buffer?: never;
  data?: never;
} | {
  base64: string;
  plainText?: never;
  uint8Array?: never;
  buffer?: never;
  data?: never;
} | {
  uint8Array: number[] | Uint8Array;
  plainText?: never;
  base64?: never;
  buffer?: never;
  data?: never;
} | {
  buffer: AssetBufferInput;
  plainText?: never;
  base64?: never;
  uint8Array?: never;
  data?: never;
} | {
  data: AssetDataInput;
  plainText?: never;
  base64?: never;
  uint8Array?: never;
  buffer?: never;
};
type AssetPayloadData = Blob | ArrayBuffer | Uint8Array | Response | ReadableStream<Uint8Array>;
declare const assetToData: (payload: AssetBinaryPayloadInput) => AssetPayloadData;
declare const assetDataToUint8Array: (data: AssetPayloadData) => Promise<Uint8Array>;
declare const getAssetPayloadByteLength: (payload: AssetBinaryPayloadInput) => number | undefined;
declare const validateAssetPayload: (payload: AssetBinaryPayloadInput, options?: {
  multipart?: boolean;
  isFinal?: boolean;
}) => {
  ok: true;
  error?: never;
} | {
  ok: false;
  error: string;
};
export { validateAssetPayload as a, getAssetPayloadByteLength as i, assetDataToUint8Array as n, assetToData as r, AssetBinaryPayloadInput as t };