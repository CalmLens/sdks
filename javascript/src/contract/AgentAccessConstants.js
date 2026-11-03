// packages/shared/src/AgentAccessConstants.ts
/** The CLI's built-in OAuth client: it signs in with the device flow and needs no registration. */
const CLI_OAUTH_CLIENT_ID = "calmlens-cli";
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const DEVICE_POLL_INTERVAL_SECONDS = 5;
export { CLI_OAUTH_CLIENT_ID, DEVICE_CODE_GRANT_TYPE, DEVICE_POLL_INTERVAL_SECONDS };
