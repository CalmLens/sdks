//#region packages/shared/src/SharedConstants.ts
const IMPERSONATION_COOKIE_NAME = "CL_impersonation";
const DAY_MS = 864e5;
const YEAR_MS = 365 * DAY_MS;
const FIRST_PARTY_COOKIES = {
	ACCEPTED_COOKIES_VERSION: {
		name: "CL_acceptedCookiesVersion",
		description: "Records your cookie choice: the version of this cookie list you answered and whether you allowed functional and analytics cookies",
		expirationDescription: "1 year",
		expirationMs: YEAR_MS,
		type: "essential",
		providerName: "CalmLens"
	},
	EVER_LOGGED_IN: {
		name: "CL_everLoggedIn",
		description: "Remembers which sign-in method you last used on this device so the sign-in page can suggest it",
		expirationDescription: "10 years",
		type: "functional",
		providerName: "CalmLens"
	},
	ID_TOKEN: {
		name: "CL_idToken",
		description: "Authentication token that keeps you signed in (HttpOnly)",
		expirationDescription: "When the token expires (about 1 hour); renewed while you are signed in",
		type: "essential",
		providerName: "CalmLens"
	},
	ID_TOKEN_EXPIRES_AT: {
		name: "CL_idTokenExpiresAt",
		description: "When the current authentication token expires, so it can be renewed in time",
		expirationDescription: "10 years, or until you sign out",
		type: "essential",
		providerName: "CalmLens"
	},
	REFRESH_TOKEN: {
		name: "CL_refreshToken",
		description: "Token used to renew your sign-in without asking for your password again (HttpOnly)",
		expirationDescription: "10 years, or until you sign out",
		type: "essential",
		providerName: "CalmLens"
	},
	LOGGED_IN: {
		name: "CL_loggedIn",
		description: "Indicates that you are signed in, so pages can show the signed-in view",
		expirationDescription: "10 years, or until you sign out",
		type: "essential",
		providerName: "CalmLens"
	},
	IMPERSONATION: {
		name: IMPERSONATION_COOKIE_NAME,
		description: "Staff support access only: lets an authorised CalmLens staff member view the service as a specific user for support, security, safety or legal reasons. Only honoured for staff accounts and never set for other users",
		expirationDescription: "Session",
		type: "essential",
		providerName: "CalmLens"
	},
	MAINTENANCE_BYPASS: {
		name: "CL_maintenanceBypass",
		description: "Staff only: allows authorised staff to use the site while it is in maintenance mode (HttpOnly)",
		expirationDescription: "1 hour",
		expirationMs: 36e5,
		type: "essential",
		providerName: "CalmLens"
	},
	WAITLIST_BYPASS: {
		name: "CL_waitlistBypass",
		description: "Staff only: allows authorised staff to use the site while access is limited to the waitlist (HttpOnly)",
		expirationDescription: "1 hour",
		expirationMs: 36e5,
		type: "essential",
		providerName: "CalmLens"
	},
	SIGN_IN_CODE: {
		name: "CL_signInCode",
		description: "Records that you entered the sign-in code while access is limited to the waitlist, so you can sign in (HttpOnly)",
		expirationDescription: "30 days",
		expirationMs: 30 * DAY_MS,
		type: "essential",
		providerName: "CalmLens"
	},
	SIGN_IN_CODE_ACCEPTED: {
		name: "CL_signInCodeAccepted",
		description: "Indicates that you entered the sign-in code, so the sign-in page shows the sign-in options",
		expirationDescription: "30 days",
		expirationMs: 30 * DAY_MS,
		type: "essential",
		providerName: "CalmLens"
	},
	PRE_RENDERED_WIDTH: {
		name: "CL_preRenderedWidth",
		description: "Your browser's viewport width, so pages are rendered with the right layout for your screen",
		expirationDescription: "30 days",
		expirationMs: 30 * DAY_MS,
		type: "essential",
		providerName: "CalmLens"
	},
	SELECTED_PROJECT_ID: {
		name: "CL_selectedProjectId",
		description: "Remembers the project you last selected in the portal",
		expirationDescription: "1 year",
		expirationMs: YEAR_MS,
		type: "functional",
		providerName: "CalmLens"
	},
	ASSET_DASHBOARD_STATE: {
		name: "CL_assetDashboardState",
		description: "Remembers your asset dashboard view (view mode, filters, sorting and folder)",
		expirationDescription: "1 year",
		expirationMs: YEAR_MS,
		type: "functional",
		providerName: "CalmLens"
	},
	ASSET_VIEW: {
		name: "CL_assetView",
		description: "Remembers whether you chose the grid or table view for an asset's sub-assets (one cookie per asset, named CL_assetView_<assetId>)",
		expirationDescription: "30 days",
		expirationMs: 30 * DAY_MS,
		type: "functional",
		providerName: "CalmLens",
		isPrefix: true
	},
	PORTAL_GUIDANCE_HIDDEN: {
		name: "CL_portalGuidanceHidden",
		description: "Remembers whether you hid next-step tips for a project",
		expirationDescription: "1 year",
		expirationMs: YEAR_MS,
		type: "functional",
		providerName: "CalmLens",
		isPrefix: true
	},
	PORTAL_LAYOUT_SPLIT_PANE: {
		name: "CL_portalLayoutSplitPane",
		description: "Remembers the width you set for the portal sidebar",
		expirationDescription: "1 year",
		expirationMs: YEAR_MS,
		type: "functional",
		providerName: "CalmLens"
	},
	DOCS_UI_LIBRARY: {
		name: "CL_docsUiLibrary",
		description: "Remembers the UI library you selected for documentation examples",
		expirationDescription: "1 year",
		expirationMs: YEAR_MS,
		type: "functional",
		providerName: "CalmLens"
	},
	DOCS_LANGUAGE: {
		name: "CL_docsLanguage",
		description: "Remembers the programming language you selected for documentation examples",
		expirationDescription: "1 year",
		expirationMs: YEAR_MS,
		type: "functional",
		providerName: "CalmLens"
	},
	SEARCH_SDK_LANGUAGE: {
		name: "CL_searchSdkLanguage",
		description: "Remembers the SDK you chose to filter documentation search results by",
		expirationDescription: "1 year",
		expirationMs: YEAR_MS,
		type: "functional",
		providerName: "CalmLens"
	}
};
const THIRD_PARTY_COOKIES = {
	GOOGLE_ANALYTICS: {
		name: "_ga",
		description: "Google Analytics distinguishes visitors and maintains session state, only with analytics consent",
		expirationDescription: "2 years",
		type: "analytics",
		providerName: "Google Analytics",
		isPrefix: true
	},
	GOOGLE_AD_CLICK: {
		name: "_gcl",
		description: "Links consented ad clicks to signups; no personalised advertising",
		expirationDescription: "Up to 90 days",
		type: "marketing",
		providerName: "Google",
		isPrefix: true
	},
	GOOGLE_CAMPAIGN: {
		name: "_gac",
		description: "Stores consented campaign attribution",
		expirationDescription: "Up to 90 days",
		type: "marketing",
		providerName: "Google",
		isPrefix: true
	}
};
[...Object.values(FIRST_PARTY_COOKIES), ...Object.values(THIRD_PARTY_COOKIES)];
const MAX_IMAGE_UPLOAD_BYTES = /* @__PURE__ */ (() => 20971520)();
const MIN_MULTIPART_IMAGE_UPLOAD_BYTES = /* @__PURE__ */ (() => 10485760)();
const MIN_MULTIPART_UPLOAD_PART_BYTES = /* @__PURE__ */ (() => 5242880)();
const REJECTED_UPLOAD_MIME_TYPE_SET = /* @__PURE__ */ new Set([
	"application/octet-stream",
	"multipart/form-data",
	"multipart/mixed",
	"multipart/alternative",
	"multipart/related",
	"multipart/signed",
	"multipart/encrypted"
]);
const normalizeUploadMimeType = (mimeType) => mimeType.toLowerCase().split(";")[0]?.trim() || mimeType.toLowerCase().trim();
const isRejectedUploadMimeType = (mimeType) => REJECTED_UPLOAD_MIME_TYPE_SET.has(normalizeUploadMimeType(mimeType));
const getRejectedUploadMimeTypeError = (mimeType) => `${normalizeUploadMimeType(mimeType)} is not a valid upload file type. Uploads must use a concrete file MIME type that CalmLens can store and process, such as image/png, image/jpeg, application/pdf, or text/plain.`;
const DOMAIN = "calmlens.com";
//#endregion
export { getRejectedUploadMimeTypeError as a, MIN_MULTIPART_UPLOAD_PART_BYTES as i, MAX_IMAGE_UPLOAD_BYTES as n, isRejectedUploadMimeType as o, MIN_MULTIPART_IMAGE_UPLOAD_BYTES as r, DOMAIN as t };
