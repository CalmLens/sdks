// The ID of an upload preset open to "Anyone with the preset ID". It's safe to publish: it can
// only upload through that preset, within its daily limit and file rules. Leave the placeholder
// to run the page in demo mode, which uploads to an in-memory mock instead of CalmLens.
export const UPLOAD_PRESET_ID = "your-upload-preset-id";

// The CalmLens API. Leave it undefined for https://api.calmlens.com/v1.
export const API_BASE_URL = undefined;
