import type {
  CalmLensServerClient,
  Lens,
  MetadataFieldsResource,
  Policy,
  ProjectSettingsResource,
  UploadPreset,
  UploadPresetDefinition,
} from "../server";

// `calmlens plan` and `calmlens apply`: one declarative file per project lists its policies (with
// the project's assignment), upload presets, lenses, metadata fields and settings, by name. A
// section the file leaves out isn't managed. `apply` sends every change with the revision it read,
// so a change made in the meantime (in the portal or by another deploy) is refused, never
// overwritten. `--prune` also deletes presets, lenses and metadata fields the file doesn't list;
// policies belong to the whole organisation, so they are never deleted.

type JsonObject = { [key: string]: unknown };

export interface PolicyDefinition {
  description?: string;
  /** Create the policy as a copy of this built-in preset. */
  presetId?: string;
  /** The complete settings, defining every category. */
  settings?: JsonObject;
}

export type UploadPresetConfig = Omit<UploadPresetDefinition, "key" | "revision" | "policyId"> & {
  /** The name of one of the file's or organisation's policies; left out uses the project's. */
  policy?: string;
};

export interface LensConfig {
  name: string;
  description?: string | null;
  type?: Lens["type"];
  active?: boolean;
  transform?: Lens["transform"];
}

type MetadataField = MetadataFieldsResource["fields"][number];
export type MetadataFieldConfig = Omit<MetadataField, "id">;

export interface ConfigurationFile {
  $schema?: string;
  /** The organisation's policies this project uses, by name. */
  policies?: Record<string, PolicyDefinition>;
  /** The name of the policy the project moderates with. */
  policy?: string;
  uploadPresets?: Record<string, UploadPresetConfig>;
  lenses?: Record<string, LensConfig>;
  metadataFields?: Record<string, MetadataFieldConfig>;
  /** The settings to manage; settings the file leaves out keep their values. */
  settings?: Partial<ProjectSettingsResource["settings"]>;
}

export class ConfigurationError extends Error {}

const SECTIONS = ["policies", "policy", "uploadPresets", "lenses", "metadataFields", "settings"];

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Reads a configuration file's JSON, checking its shape; the API checks the values. */
export const parseConfiguration = (
  text: string,
  source = "calmlens.config.json",
): ConfigurationFile => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ConfigurationError(`${source} isn't valid JSON: ${(error as Error).message}`);
  }
  if (!isObject(value)) throw new ConfigurationError(`${source} must hold a JSON object.`);
  for (const key of Object.keys(value))
    if (key !== "$schema" && !SECTIONS.includes(key))
      throw new ConfigurationError(
        `${source} has an unknown section "${key}". Use ${SECTIONS.join(", ")}.`,
      );
  for (const section of ["policies", "uploadPresets", "lenses", "metadataFields", "settings"]) {
    if (value[section] === undefined) continue;
    if (!isObject(value[section]))
      throw new ConfigurationError(`${source}: "${section}" must be an object.`);
    if (section === "settings") continue;
    for (const [name, item] of Object.entries(value[section]))
      if (!isObject(item))
        throw new ConfigurationError(`${source}: ${section} "${name}" must be an object.`);
  }
  if (value.policy !== undefined && typeof value.policy !== "string")
    throw new ConfigurationError(`${source}: "policy" must be a policy name.`);
  const config = value as ConfigurationFile;
  for (const [name, policy] of Object.entries(config.policies ?? {}))
    if (!policy.presetId && !policy.settings)
      throw new ConfigurationError(
        `${source}: policy "${name}" needs "presetId", "settings" or both.`,
      );
  return config;
};

/**
 * The parts of the project's configuration the file manages, as CalmLens holds them, with the
 * revisions read. Only those are read, so a key needs access only to what its file lists.
 */
export interface ConfigurationState {
  policies: Policy[];
  assignedPolicy?: Policy;
  uploadPresets: UploadPreset[];
  lenses: Lens[];
  metadataFields: MetadataFieldsResource["fields"];
  settings?: ProjectSettingsResource["settings"];
  /** The revision settings and metadata fields share, when either is managed. */
  settingsRevision?: number;
}

const collect = async <T>(items: AsyncIterable<T>) => {
  const all: T[] = [];
  for await (const item of items) all.push(item);
  return all;
};

/** Reads what the file manages. */
export const readConfigurationState = async (
  client: CalmLensServerClient,
  config: ConfigurationFile,
): Promise<ConfigurationState> => {
  const presetsNamePolicies = Object.values(config.uploadPresets ?? {}).some(
    (preset) => preset.policy !== undefined,
  );
  const [policies, assignedPolicy, uploadPresets, lenses, metadataFields, settings] =
    await Promise.all([
      config.policies || config.policy !== undefined || presetsNamePolicies
        ? collect(client.policies.list())
        : [],
      config.policy !== undefined ? client.policies.retrieveAssigned() : undefined,
      config.uploadPresets ? collect(client.uploadPresets.list()) : [],
      config.lenses ? collect(client.lenses.list()) : [],
      config.metadataFields ? client.metadataFields.list() : undefined,
      config.settings ? client.projectSettings.get() : undefined,
    ]);
  return {
    policies,
    assignedPolicy,
    uploadPresets,
    lenses,
    metadataFields: metadataFields?.fields ?? [],
    settings: settings?.settings,
    settingsRevision: settings?.revision ?? metadataFields?.revision,
  };
};

/** JSON with object keys sorted, so equal values compare equal whatever their key order. */
const canonical = (value: unknown): string =>
  JSON.stringify(value ?? null, (_key, item) =>
    isObject(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

export type ChangeKind =
  | "policy"
  | "assignment"
  | "metadataField"
  | "settings"
  | "lens"
  | "uploadPreset";

export interface Change {
  kind: ChangeKind;
  action: "create" | "update" | "delete";
  /** The key, identifier, ID or name the file uses. */
  name: string;
  /** The fields that change, for an update. */
  fields?: string[];
}

export interface ConfigurationPlan {
  changes: Change[];
  unchanged: number;
}

const LABELS: Record<ChangeKind, string> = {
  policy: "policy",
  assignment: "project policy",
  metadataField: "metadata field",
  settings: "project settings",
  lens: "lens",
  uploadPreset: "upload preset",
};

/** The stored values a preset definition sets, with the API's defaults (toUploadPresetValues). */
const presetValues = (definition: Omit<UploadPresetDefinition, "revision">) => {
  const list = (value: string[] | null | undefined) => (value?.length ? [...new Set(value)] : null);
  return {
    key: definition.key,
    name: definition.name,
    access: definition.access ?? "token",
    enabled: definition.enabled ?? true,
    allowedContentTypes: list(definition.allowedContentTypes),
    maxSizeInBytes: definition.maxSizeInBytes ?? null,
    folderId: definition.folderId ?? null,
    policyId: definition.policyId ?? null,
    visibility: definition.visibility ?? "private",
    processingOptions: definition.processingOptions ?? null,
    revealDecision: definition.revealDecision ?? false,
    dailyUploadLimit: definition.dailyUploadLimit ?? null,
    allowedOrigins: list(definition.allowedOrigins),
  };
};

const lensValues = (identifier: string, lens: LensConfig) => ({
  identifier,
  name: lens.name,
  description: lens.description ?? null,
  type: lens.type ?? "image",
  active: lens.active ?? true,
  transform: lens.transform ?? null,
});

const changedFields = (desired: Record<string, unknown>, current: object) =>
  Object.keys(desired).filter(
    (key) => !same(desired[key], (current as Record<string, unknown>)[key]),
  );

/** The organisation's policy with this name; names must be unambiguous. */
const policyNamed = (state: ConfigurationState, name: string) => {
  const matches = state.policies.filter((policy) => policy.name === name);
  if (matches.length > 1)
    throw new ConfigurationError(
      `The organisation has ${matches.length} policies named "${name}". Rename all but one in the portal.`,
    );
  return matches[0];
};

/** Compares the file with the project, section by section. */
export const planConfiguration = (
  config: ConfigurationFile,
  state: ConfigurationState,
  options: { prune?: boolean } = {},
): ConfigurationPlan => {
  const changes: Change[] = [];
  let unchanged = 0;
  const update = (kind: ChangeKind, name: string, fields: string[]) => {
    if (fields.length) changes.push({ kind, action: "update", name, fields });
    else unchanged++;
  };
  const knownPolicy = (name: string) => {
    if (!config.policies?.[name] && !policyNamed(state, name))
      throw new ConfigurationError(
        `No policy is named "${name}": add it under "policies" or create it in the portal.`,
      );
  };
  /** Deletes for `--prune`: what CalmLens holds that the file's section doesn't list. */
  const prune = (kind: ChangeKind, held: string[], listed: object) => {
    if (options.prune)
      for (const name of held)
        if (!(name in listed)) changes.push({ kind, action: "delete", name });
  };

  for (const [name, definition] of Object.entries(config.policies ?? {})) {
    const existing = policyNamed(state, name);
    if (!existing) changes.push({ kind: "policy", action: "create", name });
    else
      update("policy", name, [
        ...(definition.description !== undefined && definition.description !== existing.description
          ? ["description"]
          : []),
        ...(definition.settings && !same(definition.settings, existing.settings)
          ? ["settings"]
          : []),
      ]);
  }

  if (config.policy !== undefined) {
    knownPolicy(config.policy);
    if (policyNamed(state, config.policy)?.id === state.assignedPolicy?.id) unchanged++;
    else changes.push({ kind: "assignment", action: "update", name: config.policy });
  }

  if (config.metadataFields) {
    const current = new Map(state.metadataFields.map((field) => [field.id, field]));
    for (const [id, field] of Object.entries(config.metadataFields)) {
      const existing = current.get(id);
      if (!existing) changes.push({ kind: "metadataField", action: "create", name: id });
      else update("metadataField", id, changedFields({ id, ...field }, existing));
    }
    prune("metadataField", [...current.keys()], config.metadataFields);
  }

  if (config.settings)
    update("settings", "settings", changedFields(config.settings, state.settings ?? {}));

  if (config.lenses) {
    const current = new Map(state.lenses.map((lens) => [lens.identifier, lens]));
    for (const [identifier, lens] of Object.entries(config.lenses)) {
      const existing = current.get(identifier);
      if (!existing) changes.push({ kind: "lens", action: "create", name: identifier });
      else update("lens", identifier, changedFields(lensValues(identifier, lens), existing));
    }
    prune("lens", [...current.keys()], config.lenses);
  }

  if (config.uploadPresets) {
    const current = new Map(state.uploadPresets.map((preset) => [preset.key, preset]));
    for (const [key, { policy, ...preset }] of Object.entries(config.uploadPresets)) {
      if (policy !== undefined) knownPolicy(policy);
      const existing = current.get(key);
      if (!existing) {
        changes.push({ kind: "uploadPreset", action: "create", name: key });
        continue;
      }
      // A policy the file creates has no ID yet, so it differs from any stored one.
      const policyId = policy === undefined ? null : (policyNamed(state, policy)?.id ?? policy);
      update(
        "uploadPreset",
        key,
        changedFields(presetValues({ ...preset, key, policyId }), existing).map((field) =>
          field === "policyId" ? "policy" : field,
        ),
      );
    }
    prune("uploadPreset", [...current.keys()], config.uploadPresets);
  }

  return { changes, unchanged };
};

/** The plan as `calmlens plan` prints it. */
export const formatPlan = (plan: ConfigurationPlan): string => {
  const items = (count: number) => `${count} item${count === 1 ? "" : "s"}`;
  if (!plan.changes.length) return `No changes: ${items(plan.unchanged)} already match the file.\n`;
  const symbol = { create: "+", update: "~", delete: "-" } as const;
  const lines = plan.changes.map((change) => {
    const subject =
      change.kind === "settings" ? LABELS.settings : `${LABELS[change.kind]} "${change.name}"`;
    const fields = change.fields?.length ? ` (${change.fields.join(", ")})` : "";
    return `  ${symbol[change.action]} ${subject}${fields}`;
  });
  const count = (action: Change["action"]) =>
    plan.changes.filter((change) => change.action === action).length;
  return `${lines.join("\n")}\n\n${count("create")} to create, ${count("update")} to update, ${count("delete")} to delete, ${plan.unchanged} unchanged.\n`;
};

/**
 * Makes the plan's changes, each with the revision read in `state`, so anything changed since it
 * was read is refused. Policies come first, so the project and presets can name new ones.
 */
export const applyConfiguration = async (
  client: CalmLensServerClient,
  config: ConfigurationFile,
  state: ConfigurationState,
  plan: ConfigurationPlan,
  log: (line: string) => void = () => {},
): Promise<void> => {
  const changes = (kind: ChangeKind, deletes = false) =>
    plan.changes.filter(
      (change) => change.kind === kind && (change.action === "delete") === deletes,
    );
  const plural = (count: number, noun: string, many = `${noun}s`) =>
    `${count} ${count === 1 ? noun : many}`;
  const policyIds = new Map(state.policies.map((policy) => [policy.name, policy.id]));
  const policyIdOf = (name: string) => policyIds.get(name)!;

  for (const change of changes("policy")) {
    const { presetId, settings, description } = config.policies![change.name]!;
    const existing = state.policies.find((policy) => policy.name === change.name);
    if (existing) {
      await client.policies.update({
        policyId: existing.id,
        revision: existing.revision,
        ...(description !== undefined && { description }),
        ...(settings && { settings: settings as never }),
      });
      log(`Updated policy "${change.name}".`);
      continue;
    }
    const created = await client.policies.create({
      name: change.name,
      ...(description !== undefined && { description }),
      ...(presetId ? { presetId: presetId as never } : { settings: settings as never }),
    });
    policyIds.set(change.name, created.id);
    // A copy of a preset starts from the preset's settings, which the file's then replace.
    if (presetId && settings)
      await client.policies.update({
        policyId: created.id,
        revision: created.revision,
        settings: settings as never,
      });
    log(`Created policy "${change.name}".`);
  }

  for (const change of changes("assignment")) {
    await client.policies.assign({ policyId: policyIdOf(change.name) });
    log(`The project now moderates with policy "${change.name}".`);
  }

  // Metadata fields and settings share one revision: each change sends the one it last saw.
  let revision = state.settingsRevision;
  const fields = changes("metadataField");
  if (fields.length) {
    ({ revision } = await client.metadataFields.ensure({
      revision,
      fields: fields.map((change) => ({
        id: change.name,
        ...config.metadataFields![change.name]!,
      })),
    }));
    log(`Saved ${plural(fields.length, "metadata field")}.`);
  }
  for (const change of changes("metadataField", true)) {
    await client.metadataFields.delete({ fieldId: change.name, revision });
    ({ revision } = await client.metadataFields.list());
    log(`Deleted metadata field "${change.name}".`);
  }

  if (changes("settings").length) {
    await client.projectSettings.update({
      revision,
      settings: { ...state.settings, ...config.settings },
    });
    log("Saved the project settings.");
  }

  const lenses = changes("lens");
  if (lenses.length) {
    await client.ensureLenses({
      lenses: lenses.map((change) => lensValues(change.name, config.lenses![change.name]!)),
    });
    log(`Saved ${plural(lenses.length, "lens", "lenses")}.`);
  }
  for (const change of changes("lens", true)) {
    const lens = state.lenses.find((candidate) => candidate.identifier === change.name)!;
    await client.lenses.delete({ lensId: lens.id });
    log(`Deleted lens "${change.name}".`);
  }

  const presets = changes("uploadPreset");
  if (presets.length) {
    await client.uploadPresets.ensure({
      uploadPresets: presets.map((change) => {
        const { policy, ...preset } = config.uploadPresets![change.name]!;
        const existing = state.uploadPresets.find((candidate) => candidate.key === change.name);
        return {
          ...preset,
          key: change.name,
          revision: existing?.revision ?? 0,
          policyId: policy === undefined ? null : policyIdOf(policy),
        };
      }),
    });
    log(`Saved ${plural(presets.length, "upload preset")}.`);
  }
  for (const change of changes("uploadPreset", true)) {
    const preset = state.uploadPresets.find((candidate) => candidate.key === change.name)!;
    await client.uploadPresets.delete({ uploadPresetId: preset.id });
    log(`Deleted upload preset "${change.name}".`);
  }
};
