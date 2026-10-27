// ../../../../private/tmp/calmlens-explicit-scenario-contract/packages/shared/src/JsonUtils.ts
const stringifyJsonCanonical = (value) => JSON.stringify(value, (_key, nestedValue) => {
	if (!nestedValue || typeof nestedValue !== "object" || Array.isArray(nestedValue)) return nestedValue;
	return Object.fromEntries(Object.keys(nestedValue).sort().map((key) => [key, nestedValue[key]]));
});
export { stringifyJsonCanonical };
