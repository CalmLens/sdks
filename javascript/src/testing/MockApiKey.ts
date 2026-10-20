import { GRANTS_SCHEMA, type PermissionGrant } from "../contract/Permissions.js";
export const MOCK_API_KEY_PREFIX = "sk_test_";

const toBase64Url = (value: string) =>
  btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

const fromBase64Url = (value: string) => {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
};

export const createMockApiKey = (grants: PermissionGrant[] = []) =>
  `${MOCK_API_KEY_PREFIX}${toBase64Url(JSON.stringify(GRANTS_SCHEMA.parse(grants)))}`;
export const getMockApiKeyGrants = (apiKey: string): PermissionGrant[] => {
  if (!apiKey.startsWith(MOCK_API_KEY_PREFIX)) return [];
  try {
    return GRANTS_SCHEMA.parse(JSON.parse(fromBase64Url(apiKey.slice(MOCK_API_KEY_PREFIX.length))));
  } catch {
    return [];
  }
};
