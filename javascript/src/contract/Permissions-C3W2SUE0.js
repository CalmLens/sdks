import { n as idField } from "./Ids-4lJ3KFur.js";
import * as zod from "zod";
// ../../../../private/tmp/calmlens-decision-contract/packages/shared/src/Permissions.ts
const ACTION_SCHEMA = zod.enum([
	"assets:read",
	"assets:download",
	"assets:create",
	"assets:update",
	"assets:delete",
	"assets:share",
	"folders:read",
	"folders:create",
	"folders:update",
	"folders:delete",
	"settings:read",
	"settings:write",
	"members:read",
	"members:write",
	"api-keys:read",
	"api-keys:write",
	"connectors:read",
	"connectors:write",
	"metadata:read",
	"metadata:write",
	"lenses:read",
	"lenses:write",
	"upload-presets:read",
	"upload-presets:write",
	"hash-lists:read",
	"hash-lists:write",
	"reviews:read",
	"reviews:write",
	"project:manage"
]);
const PROJECT_ACTIONS = [...[
	"settings",
	"members",
	"api-keys",
	"connectors",
	"metadata",
	"lenses",
	"upload-presets",
	"hash-lists",
	"reviews"
].flatMap((feature) => [`${feature}:read`, `${feature}:write`]), "project:manage"];
const isProjectAction = (action) => PROJECT_ACTIONS.includes(action);
/** The actions that include `action`: its feature's write action and project:manage. */
const actionsImplying = (action) => !isProjectAction(action) || action === "project:manage" ? [] : action.endsWith(":read") ? [action.replace(/:read$/, ":write"), "project:manage"] : ["project:manage"];
const GRANT_SCHEMA = zod.object({
	actions: zod.array(ACTION_SCHEMA),
	folderId: idField("fldr").nullable(),
	includeSubfolders: zod.boolean()
}).strict().refine((g) => g.folderId === null || !g.actions.some(isProjectAction), "Project configuration permissions require project scope");
const GRANTS_SCHEMA = zod.array(GRANT_SCHEMA).max(100);
const ACCESS_ROLE_SCHEMA = zod.enum([
	"admin",
	"editor",
	"viewer",
	"custom"
]);
const permits = (grants, action, folderId, folders) => grants.some((grant) => {
	if (![action, ...actionsImplying(action)].some((held) => grant.actions.includes(held))) return false;
	if (grant.folderId === null) return true;
	let current = folderId;
	const visited = /* @__PURE__ */ new Set();
	while (current && !visited.has(current)) {
		if (current === grant.folderId) return true;
		if (!grant.includeSubfolders) return false;
		visited.add(current);
		current = folders.find((folder) => folder.id === current)?.parentId ?? null;
	}
	return false;
});
/**
* What a person can let an AI assistant or the CLI do for them. `read` looks at assets, folders and
* events; `write` also creates, changes and deletes assets and folders. Members, API keys,
* connectors, sharing, downloads and project settings are never delegated.
*/
const AGENT_SCOPE_SCHEMA = zod.enum(["read", "write"]);
zod.array(AGENT_SCOPE_SCHEMA).min(1).max(2);
zod.enum(["active", "banned"]);
export { GRANTS_SCHEMA as n, permits as r, ACCESS_ROLE_SCHEMA as t };
