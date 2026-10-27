import "zod";
/**
 * The prefix of every kind of object customers can see, so an ID says what it identifies:
 * `proj_8fK2mQx7Lp4NvB3tRz9Y` is a project. Rows that never leave the backend (usage meters, upload
 * token uses, retained variants, terms acceptances, notices) keep their own internal IDs.
 */
declare const ID_PREFIXES: {
  readonly organisation: "org";
  readonly project: "proj";
  readonly asset: "asset";
  readonly folder: "fldr";
  readonly lens: "lens";
  readonly apiKey: "key";
  readonly uploadPreset: "preset";
  readonly connector: "conn";
  readonly connectorDelivery: "dlv";
  readonly hashList: "hl";
  readonly hashListEntry: "hle";
  readonly policy: "pol";
  readonly event: "evt";
  readonly user: "user";
  readonly member: "mem";
  readonly invitation: "inv";
  readonly supportTicket: "tkt";
  readonly supportTicketMessage: "msg";
  readonly humanReview: "rev";
  readonly appeal: "apl";
  readonly complianceCase: "case";
  readonly safetyHold: "hold";
  readonly creditPurchase: "cp";
  readonly oauthClient: "oac";
  readonly waitlistEntry: "wl";
};
type IdKind = keyof typeof ID_PREFIXES;
type IdPrefix = (typeof ID_PREFIXES)[IdKind];
/** An ID with its prefix, such as `Id<"proj">`. */
type Id<P extends IdPrefix = IdPrefix> = `${P}_${string}`;
/** A new random ID, such as `newId("proj")` → `proj_8fK2mQx7Lp4NvB3tRz9Y`. */
export declare const newId: <P extends IdPrefix>(prefix: P) => Id<P>;
/** Whether `value` is an ID with `prefix` (or with any registered prefix). */
export declare const isId: <P extends IdPrefix = IdPrefix>(value: unknown, prefix?: P) => value is Id<P>;
export type { IdPrefix };