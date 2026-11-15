import { globalRegistry } from "zod";
// packages/shared/src/LazySchema.ts
const registryMap = globalRegistry._map;
/**
* A schema built the first time anything reads it, rather than when its module loads. Building
* Zod schemas costs a new isolate CPU before its first request, so a module whose schemas most
* requests never use (support tickets, compliance cases, appeals…) builds them only when one does.
*
* The returned proxy stands for the schema: reading, calling or composing it (`.parse`, `.extend`,
* embedding it in another schema) builds the schema and forwards to it, with the schema as the
* receiver, so its methods see the real instance. Its metadata (`.meta()`, `.describe()`, zod-meta's
* stores) is registered under the proxy too, for the code that looks schemas up by identity (JSON
* Schema generation, where the proxy is embedded in another schema).
*/
const lazySchema = (build) => {
	let schema;
	const real = () => {
		if (!schema) {
			const built = build();
			schema = built;
			const meta = registryMap.get(built);
			if (meta !== void 0) registryMap.set(proxy, meta);
			const internals = built._zod;
			const process = internals.processJSONSchema;
			if (process) internals.processJSONSchema = (context, json, params) => {
				const record = context.seen.get(proxy);
				if (!record || context.seen.has(built)) return process(context, json, params);
				context.seen.set(built, record);
				try {
					return process(context, json, params);
				} finally {
					if (context.seen.get(built) === record) context.seen.delete(built);
				}
			};
		}
		return schema;
	};
	const proxy = new Proxy({}, {
		get(_, key) {
			const target = real();
			return Reflect.get(target, key, target);
		},
		set(_, key, value) {
			const target = real();
			return Reflect.set(target, key, value, target);
		},
		has(_, key) {
			return Reflect.has(real(), key);
		},
		ownKeys() {
			return Reflect.ownKeys(real());
		},
		getOwnPropertyDescriptor(_, key) {
			const descriptor = Reflect.getOwnPropertyDescriptor(real(), key);
			return descriptor && {
				...descriptor,
				configurable: true
			};
		},
		getPrototypeOf() {
			return Reflect.getPrototypeOf(real());
		},
		defineProperty(_, key, descriptor) {
			return Reflect.defineProperty(real(), key, descriptor);
		}
	});
	return proxy;
};
export { lazySchema as t };
