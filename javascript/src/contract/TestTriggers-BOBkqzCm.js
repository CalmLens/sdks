import { a as primaryIdField, c as createMetaType, l as metaStore, n as idField, s as updatedAt } from "./Ids-aHyP9ZcF.js";
import "./SharedConstants-CyiUWW66.js";
import { r as timingSafeEqual, t as hmacSha256Hex } from "./CryptoUtils-B_x8lMIx.js";
import { n as JURISDICTION_SCHEMA } from "./Jurisdiction-FusEXb4U.js";
import * as zod from "zod";
// packages/shared/src/DocMetaTypes.ts
const docPropertyInfo = createMetaType({ id: "docPropertyInfo" });
// packages/shared/src/Messages.ts
/**
* Marks English text in shared, backend and data modules that the portal shows, so the app's
* message catalog (packages/app/vite/messageCatalog.ts) extracts it and the portal can translate it
* where it renders (`useTranslateText()` from `#i18n`). Returns the text unchanged: the API, events,
* emails and logs keep English. Only a string literal argument is extracted.
*/
const msg = (text) => text;
// packages/shared/src/ZodUtils.ts
const createdAtField = () => zod.number().int().meta({ examples: [17672256e5] });
const updatedAtField = () => zod.number().int().optional().meta({
	...metaStore([updatedAt()]),
	examples: [17672259e5]
});
const SIZE_LIMITS = {
	small: 64,
	medium: 200,
	large: 1500,
	xlarge: 1e4,
	token: 1e4
};
const saneStringField = (options) => {
	return zod.string().transform((value) => value.trim()).refine((value) => {
		if (options?.minWidth && value.length < options.minWidth) return false;
		return true;
	}, "Not long enough").refine((value) => {
		const sizeLimit = options?.maxLength ?? SIZE_LIMITS[options?.type ?? "medium"];
		return typeof value === "string" && value.length < sizeLimit;
	}, "Too long");
};
/** A real PDQ hash, for documentation examples. */
const EXAMPLE_PDQ_HASH = "d8f8f0cce0f4a84f0e370a22028f67f0b36e2ed596623e1d33e6b39c4e9c9b22";
const PDQ_HASH_SCHEMA = zod.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/, msg("Use a PDQ hash of 64 hexadecimal characters"));
/**
* What a match does: `flag` reports it on the asset and in an event without changing the
* decision, `block` also blocks close matches.
*/
const HASH_LIST_ACTION_SCHEMA = zod.enum(["flag", "block"]);
zod.object({
	id: primaryIdField("hl").describe("Unique hash list ID"),
	projectId: idField("proj").describe("ID of the project that owns the list"),
	name: saneStringField({
		type: "medium",
		minWidth: 1
	}).meta(metaStore([docPropertyInfo({
		description: "Display name",
		example: "Removed images"
	})])),
	description: saneStringField({ type: "large" }).nullish().describe("What the list is for, such as the policy it enforces"),
	action: HASH_LIST_ACTION_SCHEMA.describe(`What a match does: \`flag\` reports it without changing the decision, \`block\` blocks matches 16 bits apart or fewer and flags looser ones`),
	createdAt: createdAtField().describe("When the list was created, in milliseconds since the Unix epoch"),
	updatedAt: updatedAtField().describe("When the list was last updated, in milliseconds since the Unix epoch")
}).extend({ createdByUserId: idField("user").nullish() });
zod.object({
	id: primaryIdField("hle").describe("Unique entry ID"),
	projectId: idField("proj").describe("ID of the project that owns the entry"),
	hashListId: idField("hl").describe("ID of the list the entry belongs to"),
	hash: PDQ_HASH_SCHEMA.meta(metaStore([docPropertyInfo({
		description: "PDQ hash of the listed image, as 64 hexadecimal characters",
		example: EXAMPLE_PDQ_HASH
	})])),
	quality: zod.number().int().min(0).max(100).nullable().describe(`PDQ quality of the hash from 0 to 100, or \`null\` when it was added without one. Entries below 50 are never matched.`),
	label: saneStringField({ type: "medium" }).nullish().describe("Your own note or reference for the entry"),
	sourceAssetId: idField("asset").nullish().describe("ID of the asset the hash was taken from, when it was added from an asset"),
	createdAt: createdAtField().describe("When the entry was added, in milliseconds since the Unix epoch")
}).extend({ createdByUserId: idField("user").nullish() });
/**
* Where a match came from. Project hash lists are the only source today; shared industry lists
* join this enum as they are connected.
*/
const HASH_MATCH_SOURCE_SCHEMA = zod.enum(["hash-list"]);
const HASH_MATCH_SCHEMA = zod.object({
	source: HASH_MATCH_SOURCE_SCHEMA.describe("Where the matching hash came from"),
	listId: zod.string().describe("ID of the matching list"),
	entryId: zod.string().describe("ID of the matching entry in that list"),
	distance: zod.number().int().min(0).max(256).describe("Number of bits that differ between the hashes. 0 is the same picture."),
	action: HASH_LIST_ACTION_SCHEMA.describe("What this match did: `block` when it is close enough for a block list to block, otherwise `flag`")
}).strict();
const MODERATION_CATEGORY_DEFINITIONS = {
	sexual: {
		summary: msg("Sexual acts, explicit sexual anatomy, sexual services, sexual assault depictions and clearly erotic material."),
		definition: "covers sexual acts, explicit sexual anatomy, sexual services and clearly erotic material. Actual exposed adult breasts or nipples, genitals or buttocks, and descriptions of masturbation, oral sex, ejaculation or orgasm count in clinical, educational and non-erotic material too. Descriptions of sexual assault can qualify without erotic intent. Fictional, illustrated and generated depictions can also qualify. Flirtation, innuendo and sexual jokes, and in images people shown in swimwear or other revealing clothing, also count, so that a policy can allow or restrict them.",
		exclusions: "Ordinary affection, diagrams without exposed sexual anatomy or acts, and general sexual-health education without a qualifying sexual description do not qualify on their own. Clinical, medical or educational framing does not erase actual sexual anatomy or activity; educational qualifiers control allowances.",
		docsHref: "/docs/guides/moderation-categories#sexual-content"
	},
	violence: {
		summary: msg("Physical attacks, graphic bodily harm, death, threats against others, and planning or encouraging physical violence."),
		definition: "covers physical attacks, sexual assault, graphic bodily harm, death and threats against others. Non-consensual sexual touching and coerced sexual acts count even without a separately described injury. Graphic bodily detail and natural death also count without an attacker; a non-graphic injury or medical condition alone does not. It also includes planning, requesting, encouraging or praising physical violence. A depicted or described act can qualify in fiction or news reporting even when the author condemns it. In images, a weapon shown without an attack and consensual combat sport or training also count, so that a policy can allow or restrict them.",
		exclusions: "Solely intentional self-injury or suicide belongs under self-harm. Property damage alone, figurative language and abstract discussion of violence, injury or death do not establish violence. Non-graphic injuries and medical states alone do not qualify, regardless of severity: fractures, wounds, bruises, scars, coma, treatment and recovery do not establish an attack. Explicit disturbing bodily detail such as exposed bone, organs or mutilation can qualify even after an accident or during medical treatment.",
		docsHref: "/docs/guides/moderation-categories#violence"
	},
	"self-harm": {
		summary: msg("Intentional self-injury, suicide, preparation, methods or encouragement; text also includes current or recurring self-harm thoughts."),
		definition: "covers intentional self-injury, suicide, current self-harm risk, preparation, methods and encouragement. For text, it also includes current or recurring self-harm thoughts and an explicitly expressed desire to die. Asking for support does not cancel a separate disclosure of current risk or behavior.",
		exclusions: "An injury or covered body does not establish that harm was self-inflicted. General sadness, neutral statistics and healed scars alone are excluded. Prevention or recovery without a concrete described act, current risk or harmful methods is insufficient; reported or historical acts still count.",
		docsHref: "/docs/guides/moderation-categories#self-harm"
	},
	harassment: {
		summary: msg("Attacks on an identifiable person or a non-protected group: insults and humiliation, threats and intimidation, bullying and exclusion, sexual harassment and abuse, abuse within a relationship, and encouraging others to do these."),
		definition: "covers content that attacks an identifiable person, or a group that is not a protected identity group, or asks others to. Attacks are insults and contemptuous name-calling, demeaning or humiliating treatment, threats and intimidation, bullying and exclusion, sexual harassment, sexual abuse or objectification, and abuse or coercive control by a partner, family member or someone else in an ongoing relationship. Mild mockery and teasing, including mild or jokey name-calling such as fool, dummy, silly or clowns, sarcasm and mocking nicknames, are a lighter form of their own rather than insults, so that a policy can allow or restrict them. The target can be named, addressed, implied or invented, and need not have a protected identity. Attacks that are quoted, reported, shown in fiction, taught or condemned still count; qualifiers record their framing, their severity and whether the target is a public figure or group.",
		exclusions: "Not harassment on its own: dislike or anger without an attack, such as \"I hate you\"; disagreement or criticism of an idea, argument, decision, conduct or work, however blunt; untargeted profanity; affectionate teasing between people on good terms; telling someone not to call another person a name. An attack on a protected identity group is Hate, and a one-off physical attack is Violence; either is also Harassment when the content separately attacks a person in one of the ways above.",
		docsHref: "/docs/guides/moderation-categories#harassment-and-bullying"
	},
	hate: {
		summary: msg("Identity-based abuse, dehumanization, discriminatory exclusion or threats against people because of protected characteristics."),
		definition: "covers attacks on people because of race, ethnicity, nationality, religion, caste, sex, gender identity, sexual orientation or disability. It includes dehumanization, claims that a group is inferior, harmful stereotypes and generalisations such as saying a group is criminal, violent, dangerous or immoral, discriminatory exclusion, identity-based slurs and abuse, and threats. Images that show a hate symbol or attack to counter or prevent hate, such as anti-hate education, also count, so that a policy can allow or restrict them.",
		exclusions: "Not hate on its own: mentioning an identity, cultural clothing or religious imagery; describing differences in outcomes or treatment between groups without claiming that a group is inferior; criticism of beliefs, ideologies, political movements or conduct; reclaimed identity language used without contempt; discussing a slur as a word; an insult about someone’s conduct where a protected trait only identifies them; everyday insults such as dummy or fool. Attacks that are quoted, reported, condemned or taught still count, and qualifiers record that framing.",
		docsHref: "/docs/guides/moderation-categories#hate-and-identity-abuse"
	},
	"personal-information": {
		summary: msg("Private contact details, precise personal location, sensitive identifiers or credentials, and requests to disclose them."),
		definition: "covers supplied private personal contact details such as personal email addresses and phone numbers, precise home or current location, government or financial identifiers, account credentials and authentication secrets. Explicit requests to disclose those details also count even when no value is supplied. Own details and other people's details both count; qualifiers distinguish them. Concrete quoted, reported or educational instances remain present; framing does not erase them. Readable details in images count, but do not infer identity or unseen details from a face or setting.",
		exclusions: "Ordinary names alone, ages alone, broad locations such as a city, public business or official contact details, clearly fictional examples or placeholders such as example.com addresses, redacted values, generic privacy advice and descriptions of omitted details do not qualify.",
		docsHref: "/docs/guides/moderation-categories#personal-information"
	},
	profanity: {
		summary: msg("Actual swear words, vulgar language or offensive slurs, including clearly recognisable obfuscations."),
		definition: "covers actual swear words, vulgar expletives and offensive slurs in the supplied language, including mild and strong forms and clearly recognisable censored or obfuscated spellings. It does not require a target, abusive intent or an attack. Quoted, reclaimed, historical, fictional, educational and supportive uses still contain the language; qualifiers distinguish its form and framing. Readable words in images count.",
		exclusions: "Descriptions such as the character swears or the passage contains a slur without the actual wording, ordinary anatomical or medical terminology, insults or dehumanising words that are neither swear words nor conventional slurs (such as vermin, pests, idiot or clown), words with innocent literal meanings, names containing a swear-word substring, and ambiguous abbreviations or symbols without supported profane meaning do not qualify.",
		docsHref: "/docs/guides/moderation-categories#profanity"
	},
	"criminal-activity": {
		summary: msg("Concrete criminal or seriously dangerous acts, plans, assistance or instructions; fraud, scams, grooming, illegal drugs and contraband, plus policy-controlled alcohol, tobacco/vaping and gambling."),
		definition: "covers concrete criminal or seriously dangerous acts and their planning, requests for assistance, instructions, encouragement or facilitation, including help evading detection, consequences or accountability for them, and concrete acts depicted or described in reporting, fiction, education or prevention. A request can qualify even when no act occurs and a later reply refuses it. Dangerous activity requires a concrete serious risk of physical harm. It also covers fraud, scams and phishing aimed at the reader, illegal drug use, dealing, production or trafficking, and contraband such as stolen goods, counterfeit money or documents and smuggled or illegally traded weapons. Consensual adult sexual solicitation, including paid services, also counts so that a policy can allow or restrict it; this does not establish illegality. Concrete grooming for sexual exploitation or abuse also counts, including evidenced manipulation before explicit sexual content. Child sexual abuse material counts whenever it is supplied, sought, traded or merely named or referred to, so that a policy can restrict even a bare mention; conduct qualifiers distinguish an actual instance from a mention. Depicted or concretely described alcohol drinking or trade, tobacco or vaping use or trade, and gambling with real-value stakes count for policy control even when lawful; this does not assert illegality. In images, graffiti on property counts. Harm-reduction, recovery or prevention material about illegal drug use counts in text and images. A policy can allow or restrict each.",
		exclusions: `Solely self-directed harm, suicidal thoughts, self-harm risk or help-seeking belongs under self-harm, not criminal activity; require separate criminal conduct or serious endangerment of others. A depiction or report of a non-violent offence that endangers no one, such as theft, burglary, shoplifting, trespass, vandalism or a past fraud, does not qualify on its own, even when it shows the act in progress; it qualifies only with an actual plan, request, instructions, facilitation, promotion or encouragement, or as an offer to sell stolen or counterfeit goods. Violent acts, threats, coercion such as blackmail, and acts that seriously endanger people still qualify when depicted or reported. A topic mention, lawful safety advice without a concrete criminal act, or vague dangerous reference does not qualify. Lawful medical, pharmaceutical, clinical and research activity is not criminal, including prescriptions, dosages, side effects, controlled medicines used as prescribed, pharmacies, hospitals and lawful pharmaceutical manufacturing. Framing something as reporting, education or prevention does not erase an actual qualifying criminal act or harmful instructions. Generic alcohol, tobacco, gambling or drug-policy discussion without a concrete qualifying instance does not qualify. Non-alcoholic drinks, disinfectant, prescribed cessation treatment and games without real-value stakes do not qualify. Masks, computers, payment cards, detention or ordinary tools do not establish criminal facilitation by themselves. A clear visual demonstration of how to carry out a crime can qualify.`,
		docsHref: "/docs/guides/moderation-categories#criminal-and-dangerous-activity"
	}
};
// packages/shared/src/ModerationPolicyDimensions.ts
const MODERATION_QUALIFIER_INFO = {
	"sexual-pornographic-media": {
		category: "sexual",
		kind: "harm",
		harmOption: false,
		displayName: msg("Pornographic images or video"),
		description: msg("An image or video frame depicting explicit sexual activity or exposed sexual anatomy presented primarily for sexual arousal, including drawn, animated or generated adult pornography."),
		exclusions: "Text, non-erotic nudity, medical or educational anatomy, breastfeeding, art without pornographic presentation, swimwear and suggestive content.",
		inputs: ["image"]
	},
	"hate-nazi-symbols-public-display": {
		category: "hate",
		kind: "harm",
		harmOption: false,
		displayName: msg("Public Nazi symbols outside supported context"),
		description: msg("A clearly identifiable Nazi symbol, slogan or salute, such as a Hakenkreuz or SS insignia, displayed or shared publicly, unless it is shown for civic information, opposition to Nazism, reporting, teaching, science, research or art."),
		exclusions: "Religious or cultural swastikas, similar shapes, mentioning a symbol without showing it, and displays for reporting, teaching, counterspeech or art. Fictional styling or a disclaimer alone is not an exception."
	},
	"hate-nazi-insignia-public-display": {
		category: "hate",
		kind: "harm",
		harmOption: false,
		displayName: msg("Public Nazi insignia outside non-promotional depictions"),
		description: msg("A clearly identifiable symbol or insignia of a banned Nazi organisation displayed or shared publicly. Printed, pictorial, stage and film depictions that don't approve or spread the organisation's ideology, and exhibitions opposed to it, don't count."),
		exclusions: "Religious or cultural swastikas, similar shapes, a mention without a display, and non-promotional journalistic, teaching or artistic depictions."
	},
	"hate-nazi-genocide-public-peace": {
		category: "hate",
		kind: "harm",
		harmOption: false,
		displayName: msg("Nazi genocide denial or approval affecting public peace"),
		description: msg("Publicly approving, denying or grossly trivialising the Nazi genocide in a way that can disturb public peace, including antisemitic denial or justification addressed to the public."),
		exclusions: "Mentioning the topic, rejecting denial, accurate history, and reporting, teaching, research or art that quotes someone else's denial. Quotation marks or a label don't excuse the author's own denial."
	},
	"hate-nazi-genocide-denial-or-approval": {
		category: "hate",
		kind: "harm",
		harmOption: false,
		displayName: msg("Nazi genocide denial or approval"),
		description: msg("The author publicly denies, trivialises, approves or justifies the Nazi genocide or Nazi crimes against humanity, including partial denial."),
		exclusions: "Mentioning the topic, accurate history, rejecting denial, and reporting, teaching, research or art that attributes the denial to someone else without adopting it. A disclaimer doesn't excuse the author's own denial."
	},
	"hate-adjudicated-nazi-crimes-denial": {
		category: "hate",
		kind: "harm",
		harmOption: false,
		displayName: msg("Denial of adjudicated Nazi crimes"),
		description: msg("The author publicly disputes Nazi crimes against humanity established by the Nuremberg tribunal or another competent court, including Holocaust denial."),
		exclusions: "Mentioning the topic, accurate history, rejecting denial, and reporting, teaching, research or art that quotes someone else's denial without adopting it. Fictional styling doesn't excuse the author's own denial."
	},
	"violence-high-impact": {
		category: "violence",
		kind: "harm",
		harmOption: false,
		displayName: msg("High-impact violent media"),
		description: msg("Images or video with explicit, high-impact bodily detail, such as dismemberment, exposed organs, gruesome mutilation or prolonged torture, including fictional depictions."),
		exclusions: "Text, minor injuries, moderate violence or blood, harm that happens off screen, and self-inflicted harm without other violence.",
		inputs: ["image"]
	},
	"self-harm-age-restricted": {
		category: "self-harm",
		kind: "harm",
		harmOption: false,
		displayName: msg("Promotion or instruction of self-harm"),
		description: msg("Content that encourages, promotes or gives instructions for suicide, self-injury or disordered eating, rather than depicting or mentioning it. Actionable instructions count even inside a report."),
		exclusions: "Recovery, support and prevention, mentions, incident reports that don't promote it, sharing thoughts without promoting them, and asking for help."
	},
	"personal-information-contact": {
		category: "personal-information",
		kind: "harm",
		displayName: msg("Private contact details"),
		description: msg("Private personal email addresses, phone numbers or other direct contact details, or requests to reveal them."),
		exclusions: "Public business or official contacts, names, broad locations, placeholders and redacted values."
	},
	"personal-information-email": {
		category: "personal-information",
		kind: "harm",
		displayName: msg("Private email addresses"),
		description: msg("A private personal email address, or a request to reveal one."),
		exclusions: "Public business or official addresses, example.com placeholders and redacted addresses."
	},
	"personal-information-phone": {
		category: "personal-information",
		kind: "harm",
		displayName: msg("Private phone numbers"),
		description: msg("A private personal phone or mobile number, or a request to reveal one."),
		exclusions: "Public business or official numbers, redacted values and numbers that aren't phone numbers."
	},
	"personal-information-government-id": {
		category: "personal-information",
		kind: "harm",
		displayName: msg("Government identifiers"),
		description: msg("A personal passport, national identity, national insurance, social security or similar government-issued number, or a request to reveal one."),
		exclusions: "Organisation identifiers, ordinary names or numbers, redacted identifiers and fictional placeholders."
	},
	"personal-information-financial": {
		category: "personal-information",
		kind: "harm",
		displayName: msg("Financial identifiers"),
		description: msg("A private bank account, payment card or other sensitive financial account number, or a request to reveal one."),
		exclusions: "Public business payment details, prices, ordinary numbers, redacted values and placeholders."
	},
	"personal-information-location": {
		category: "personal-information",
		kind: "harm",
		displayName: msg("Precise personal location"),
		description: msg("A home address or a person's current precise location, including coordinates or a live location, or a request to reveal one."),
		exclusions: "Broad locations, public venues not tied to where a person lives or is now, fictional placeholders, redacted values and requests that don't target a precise personal location."
	},
	"personal-information-identifiers": {
		category: "personal-information",
		kind: "harm",
		displayName: msg("Sensitive identifiers"),
		description: msg("Government ID, national insurance, social security, passport, bank account or payment card numbers tied to a person, or requests to reveal them."),
		exclusions: "Names, dates or numbers with no identifier context, organisation identifiers, redacted values and placeholders."
	},
	"personal-information-credentials": {
		category: "personal-information",
		kind: "harm",
		displayName: msg("Credentials and secrets"),
		description: msg("Private passwords, access tokens, API secrets, authentication codes or recovery codes for an account, or requests to reveal them."),
		exclusions: "Usernames alone, advice on creating a strong password, redacted values and sample credentials that don't work."
	},
	"personal-information-request": {
		category: "personal-information",
		kind: "harm",
		displayName: msg("Requests for private details"),
		description: msg("A message or chat turn that asks someone to disclose private contact details, a precise personal location, sensitive identifiers or credentials."),
		exclusions: "General privacy discussion, public business contacts, describing someone else's request, and asking only for a name or broad location."
	},
	"personal-information-self-disclosure": {
		category: "personal-information",
		kind: "target",
		displayName: msg("Own details"),
		description: msg("The person sharing private details says they are their own."),
		exclusions: "Details that don't say whose they are, other people's details, and requests that share no details."
	},
	"personal-information-third-party": {
		category: "personal-information",
		kind: "target",
		displayName: msg("Other people’s details"),
		description: msg("The private details belong to someone other than the person sharing them, or don't say whose they are, such as a filled-in form or record."),
		exclusions: "Details the person sharing them says are their own, and requests that share no details."
	},
	"personal-information-historical": {
		category: "personal-information",
		kind: "context",
		displayName: msg("Historical"),
		description: msg("Qualifying content explicitly attributed to a real historical event."),
		exclusions: "A date, past tense, an old-looking setting or a historical topic alone; a separate current threat, request or endorsement."
	},
	"personal-information-documentary": {
		category: "personal-information",
		kind: "context",
		displayName: msg("Reporting or documentary"),
		description: msg("Private details explicitly framed as factual reporting or documentation of an actual real-world event, such as a news report, court record or public notice that contains them."),
		exclusions: "Sharing or passing on someone's details, however accurate; telling people to contact, visit or find someone; third-person narration or quotation marks alone; fictional or invented examples."
	},
	"personal-information-educational": {
		category: "personal-information",
		kind: "context",
		displayName: msg("Educational"),
		description: msg("Qualifying content used in a lesson, clinical explanation or academic study."),
		exclusions: "Neutral description alone, or an educational label on a separate harmful request."
	},
	"personal-information-fictional": {
		category: "personal-information",
		kind: "context",
		displayName: msg("Fictional"),
		description: msg("Qualifying content clearly presented as fiction, such as a story, game or illustration."),
		exclusions: "A claim of fiction with nothing in the content to show it, or a reference to a passage that isn't included."
	},
	"personal-information-support-prevention": {
		category: "personal-information",
		kind: "context",
		displayName: msg("Support and prevention"),
		description: msg("Qualifying content shared only to seek or give support, prevent harm, oppose abuse or aid recovery."),
		exclusions: "A separate harmful request or attack, general safety advice with no qualifying content, and neutral description with no support or prevention purpose."
	},
	"profanity-mild": {
		category: "profanity",
		kind: "harm",
		displayName: msg("Mild profanity"),
		description: msg("Mild swear words or exclamations, such as damn or hell used as swearing, in the language they are written in."),
		exclusions: "Literal or religious meanings, strong profanity, mentions of swearing without the words, and ambiguous abbreviations."
	},
	"profanity-strong": {
		category: "profanity",
		kind: "harm",
		displayName: msg("Strong profanity"),
		description: msg("Strong swear words or vulgar expressions, including clearly recognisable disguised spellings, in the language they are written in."),
		exclusions: "Mild exclamations, medical or anatomical terms, innocent words that contain a swear word, mentions of swearing without the words, and ambiguous symbols."
	},
	"profanity-slurs": {
		category: "profanity",
		kind: "harm",
		displayName: msg("Offensive slurs"),
		description: msg("Conventional offensive identity slurs, including quoted or reclaimed uses. This records the word; whether it attacks someone is assessed under Hate."),
		exclusions: "A slur that is referred to but not written, neutral identity terms, and words that only resemble a slur."
	},
	"profanity-obfuscated": {
		category: "profanity",
		kind: "harm",
		displayName: msg("Obfuscated profanity"),
		description: msg("A swear word or offensive slur that remains clearly recognisable despite masking, spacing, character substitutions or deliberate misspelling."),
		exclusions: "Symbols that can't be read as a word, innocent abbreviations, ordinary words or names that happen to contain one, and censored passages that don't show which word was used."
	},
	"profanity-historical": {
		category: "profanity",
		kind: "context",
		displayName: msg("Historical"),
		description: msg("Qualifying content explicitly attributed to a real historical event."),
		exclusions: "A date, past tense, an old-looking setting or a historical topic alone; a separate current threat, request or endorsement."
	},
	"profanity-documentary": {
		category: "profanity",
		kind: "context",
		displayName: msg("Reporting or documentary"),
		description: msg("Qualifying content explicitly framed as factual reporting, testimony or documentation of actual real-world events or utterances, including a person's own incident report or a report to an authority."),
		exclusions: "Neutral wording, third-person narration or quotation marks alone; fiction and invented teaching examples."
	},
	"profanity-educational": {
		category: "profanity",
		kind: "context",
		displayName: msg("Educational"),
		description: msg("Qualifying content used in a lesson, clinical explanation or academic study."),
		exclusions: "Neutral description alone, or an educational label on a separate harmful request."
	},
	"profanity-fictional": {
		category: "profanity",
		kind: "context",
		displayName: msg("Fictional"),
		description: msg("Qualifying content clearly presented as fiction, such as a story, game or illustration."),
		exclusions: "A claim of fiction with nothing in the content to show it, or a reference to a passage that isn't included."
	},
	"profanity-support-prevention": {
		category: "profanity",
		kind: "context",
		displayName: msg("Support and prevention"),
		description: msg("Qualifying content shared only to seek or give support, prevent harm, oppose abuse or aid recovery."),
		exclusions: "A separate harmful request or attack, general safety advice with no qualifying content, and neutral description with no support or prevention purpose."
	},
	"sexual-nudity": {
		category: "sexual",
		kind: "harm",
		displayName: msg("Nudity"),
		description: msg("Explicitly exposed intimate sexual anatomy, including partially exposed breasts, genitals or buttocks and a pubic area or pubic hair exposed by clothing pulled down or open. Drawn, animated and generated characters count, including creature or anthropomorphic characters drawn with genitals or other sexual anatomy."),
		exclusions: "Swimwear, revealing clothing and diagrams without exposed sexual anatomy, and animals or cartoon characters without drawn sexual anatomy. Exposed anatomy in a medical diagram still counts; its educational context is recorded separately."
	},
	"sexual-activity": {
		category: "sexual",
		kind: "harm",
		displayName: msg("Sexual activity"),
		description: msg("A depicted or described sexual act, including sexual assault. Solo acts count: masturbation, touching or stimulating one's own genitals, and using a sex toy. So do explicitly sexual fetish acts and sexual acts by drawn, animated, generated, creature or anthropomorphic characters."),
		exclusions: "Affection, non-sexual touching, romantic roleplay limited to kissing or touching, which is Suggestive content, and general sexual-health education."
	},
	"sexual-explicit-language": {
		category: "sexual",
		kind: "harm",
		displayName: msg("Explicit sexual language"),
		description: msg("Graphic sexual descriptions or explicitly erotic dialogue."),
		exclusions: "Untargeted profanity, anatomical terms, non-erotic medical or educational language, romantic roleplay limited to kissing or touching, and naming a sex act in passing or in a crude joke."
	},
	"sexual-assault-media": {
		category: "sexual",
		kind: "harm",
		harmOption: false,
		displayName: msg("Sexual-assault images or video"),
		description: msg("Images or video showing a sexual act involving force, coercion or a person who can't consent, including realistic staged, animated or generated depictions. It counts inside reporting, education or support too, and concerns consent to the act, not to sharing the image."),
		exclusions: "Text or captions describing, reporting or discussing an assault; survivor accounts, support or prevention without a depicted assault; aftermath alone; consensual roleplay; ambiguous contact, expressions or nudity.",
		inputs: ["image"]
	},
	"sexual-non-consensual": {
		category: "sexual",
		kind: "harm",
		displayName: msg("Non-consensual sexual content"),
		description: msg("Sexual content depicting or describing non-consensual sexual activity, such as sexual assault, rape or coerced sex presented as sexual or erotic material, including fiction, animation and generated images."),
		exclusions: "Factual reports, survivor accounts, support, prevention and non-graphic discussion that don't present the assault as sexual material, and consensual sexual activity. Sharing a real person's intimate images without consent is Intimate image abuse."
	},
	"sexual-intimate-image-abuse": {
		category: "sexual",
		kind: "harm",
		harmOption: false,
		displayName: msg("Intimate image abuse"),
		description: msg("Intimate images of a real, identifiable person shared, offered, sought or traded without their consent, or threatened to be shared: nudity, sexual acts or sexualised images, including hidden-camera, upskirt, leaked or hacked images, sextortion threats, and sexual deepfakes or digitally undressed images of real people."),
		exclusions: "Consensual adult content, including people sharing their own images or professional adult content; fictional or drawn characters with no real person depicted; non-sexual images; reports, survivor accounts, prevention or support that share no such image and make no threat; mentioning a leak without sharing, offering or seeking the images."
	},
	"sexual-extreme": {
		category: "sexual",
		kind: "harm",
		harmOption: false,
		displayName: msg("Extreme pornography"),
		description: msg("Pornographic content showing or describing sex with an animal or with a dead body, or a sexual act that threatens a person's life or is likely to cause serious injury to the anus, breasts or genitals, including realistic drawn or generated depictions."),
		exclusions: "Consensual adult content without such an act, including bondage, role play or rough play; non-sexual images of animals, death or injury; reports, education, support or discussion that present no such material."
	},
	"sexual-minors": {
		category: "sexual",
		kind: "harm",
		harmOption: false,
		displayName: msg("Sexualised minors"),
		description: msg("Sexual content involving a child or a character presented as a child: nudity, a sexual act, or sexualised posing or focus on the body of someone who clearly appears to be under 18 from childlike body proportions, a stated or obvious age, or a childlike framing such as a school-age character in explicit content. Drawings, animation and generated images count."),
		exclusions: "Adults, including youthful-looking adults and drawn characters with adult bodies and no childlike framing; school uniforms or costumes on adults; non-sexual images or mentions of children; reports, prevention or support about child sexual abuse that present no sexual material. A youthful face, small stature or art style alone doesn't establish a child."
	},
	"sexual-solicitation": {
		category: "sexual",
		kind: "harm",
		displayName: msg("Sexual solicitation"),
		description: msg("A request, offer or advert for sexual services, escorting or a sexual encounter, made by the author or by a participant in a conversation."),
		exclusions: "Adult content promotion, such as a subscription page or explicit media for sale; dating, romance, accepting money and vague offers without sexual content; describing someone else's offer; stating a desire without asking anyone for it."
	},
	"sexual-paid": {
		category: "sexual",
		kind: "target",
		displayName: msg("Paid sexual services"),
		description: msg("The solicitation is for paid or commercial sexual services: escorting, prostitution, a sexual encounter offered or sought for money, gifts or other payment, or advertising such services."),
		exclusions: "An unpaid request or offer for a sexual encounter between adults, and adult content promotion such as a subscription page or explicit media for sale."
	},
	"sexual-adult-promotion": {
		category: "sexual",
		kind: "harm",
		displayName: msg("Adult content promotion"),
		description: msg("The author promotes legal adult sexual content: links to, subscriptions for or sales of pornography, explicit photos or videos, or an adult creator's paid page."),
		exclusions: "Offers or requests for sexual services or an encounter, which are Sexual solicitation; dating, romance and non-sexual paid content; describing someone else's promotion."
	},
	"sexual-revealing-clothing": {
		category: "sexual",
		kind: "harm",
		displayName: msg("Revealing clothing"),
		description: msg("People shown in swimwear, underwear or lingerie-style clothing, or other clothing that exposes much of the body, with no exposed sexual anatomy, sexual act or explicit erotic display. Fitness clothing counts only when it exposes much of the body."),
		exclusions: "Exposed sexual anatomy, including clothing pulled down, open or aside, which is Nudity; sexual acts and explicit erotic display; sexual solicitation or adult content promotion; everyday clothing, sportswear and team kits that cover the torso and thighs; costumes or uniforms that aren't revealing.",
		inputs: ["image"]
	},
	"sexual-suggestive": {
		category: "sexual",
		kind: "harm",
		displayName: msg("Suggestive content"),
		description: msg("Flirtation, innuendo, sexual jokes or suggestive romance, such as kissing, caressing or a suggestive pose, with no sexual act, exposed sexual anatomy or explicit sexual language."),
		exclusions: "A sexual act, exposed sexual anatomy or explicit sexual language; sexual solicitation or adult content promotion; affection or romance without sexual suggestion."
	},
	"sexual-non-erotic-nudity": {
		category: "sexual",
		kind: "context",
		displayName: msg("Non-erotic nudity"),
		description: msg("Exposed anatomy in a non-erotic setting: breastfeeding, childbirth, medical or health care such as post-surgery images or self-examination, protest, or fine art such as a painting or sculpture."),
		exclusions: "Erotic posing or sexual focus, including a person posed with clothing pulled down or open to show intimate anatomy; sexual acts; photographs or generated images labelled as art to show nudity; pornographic drawings; anyone who appears to be a minor. An educational or artistic label alone doesn't make erotic nudity non-erotic."
	},
	"sexual-text": {
		category: "sexual",
		kind: "context",
		displayName: msg("Text"),
		description: msg("The content is text, not an image or video. It is set from the input type and never judged from the content."),
		exclusions: "Images and video, including text shown in them.",
		inputs: ["text"],
		fromInput: true
	},
	"sexual-historical": {
		category: "sexual",
		kind: "context",
		displayName: msg("Historical"),
		description: msg("Qualifying content explicitly attributed to a real historical event."),
		exclusions: "A date, past tense, an old-looking setting or a historical topic alone; a separate current threat, request or endorsement."
	},
	"sexual-documentary": {
		category: "sexual",
		kind: "context",
		displayName: msg("Reporting or documentary"),
		description: msg("Qualifying content explicitly framed as factual reporting, testimony or documentation of actual real-world events or utterances, including a person's own incident report or a report to an authority."),
		exclusions: "Neutral wording, third-person narration or quotation marks alone; fiction, invented examples, erotic display and adverts; a separate harmful request, attack or endorsement by the author."
	},
	"sexual-educational": {
		category: "sexual",
		kind: "context",
		displayName: msg("Educational"),
		description: msg("Qualifying content presented to teach or inform: a lesson, course or textbook material, a health, safety or clinical explanation, or academic study of the subject."),
		exclusions: "An educational label on a harmful request, working instructions or an endorsement; erotic, graphic or gratuitous detail beyond what the teaching needs; an academic tone alone."
	},
	"sexual-discussion": {
		category: "sexual",
		kind: "context",
		displayName: msg("Non-graphic discussion"),
		description: msg("Qualifying content referenced non-graphically to make or examine an argument, comparison, ethical question or analysis, rather than to perform, endorse, threaten, eroticise or facilitate the harmful act."),
		exclusions: "Graphic or explicit sexual detail; erotic presentation; threats, victim mockery, endorsement, promotion, harmful assistance or instructions, direct harmful requests and sexual solicitation."
	},
	"sexual-fictional": {
		category: "sexual",
		kind: "context",
		displayName: msg("Fictional"),
		description: msg("Qualifying content clearly attributed to an invented character, fictional story, game, illustration, generated image or reenacted scene."),
		exclusions: "Unclear fictional context, and a real-world threat or actionable harmful request presented as fiction."
	},
	"sexual-support-prevention": {
		category: "sexual",
		kind: "context",
		displayName: msg("Sexual harm support or prevention"),
		description: msg("Qualifying content shared only to seek or give support, prevent harm or aid recovery, such as a survivor describing abuse to get help, or counterspeech that rejects an attack or threat. Someone disclosing current harm or risk counts when they are seeking help."),
		exclusions: "Harmful instructions, assistance, advice on hiding harm, targeting or encouragement, including beside a supportive reply."
	},
	"violence-attack": {
		category: "violence",
		kind: "harm",
		displayName: msg("Physical attack"),
		description: msg("A depicted or described physical attack against another person or animal, including a general or statistical statement that people were attacked or assaulted."),
		exclusions: "An injury or death with no attack; a threat, plan or encouragement alone; harm someone does only to themselves."
	},
	"violence-threat": {
		category: "violence",
		kind: "harm",
		displayName: msg("Threat of violence"),
		description: msg("A direct, conditional or clearly implied threat of physical harm against another person or animal."),
		exclusions: "A completed attack, figurative language and threats only against oneself; a hyperbolic urge to hit someone with no weapon, plan or means, which is a Non-severe wish of harm."
	},
	"violence-preparation": {
		category: "violence",
		kind: "harm",
		displayName: msg("Preparation or instructions"),
		description: msg("A plan or request by the author to physically harm another person, or actionable instructions for doing so."),
		exclusions: "A depiction, threat or praise alone; describing someone else's plan; reporting, prevention and lawful safety advice."
	},
	"violence-encouragement": {
		category: "violence",
		kind: "harm",
		displayName: msg("Encouragement of violence"),
		description: msg("The author urges, endorses, praises or promotes physical violence."),
		exclusions: "Reporting, quoting or depicting an attack without endorsing it; condemnation or prevention; advocating lawful self-defence or a state's lawful military or police defence."
	},
	"violence-wish": {
		category: "violence",
		kind: "harm",
		harmOption: false,
		displayName: msg("Non-severe wish of harm"),
		description: msg("The author wishes or hopes that a real person or group suffers non-severe physical harm, such as falling ill or catching a disease, even a serious one such as cancer, feeling pain or having a minor accident, or voices a hyperbolic urge to hit, slap or punch someone, such as “I'd beat his ass”, with no weapon, plan or credible means, without threatening it, planning it or calling on anyone to cause it."),
		exclusions: "Wishing that someone dies, is attacked with a weapon, is seriously or permanently injured or is sexually assaulted; threats, plans, requests or encouragement for others to cause harm; figurative curses such as telling someone to go choke on something; wishing non-physical misfortune, such as losing a job or an election."
	},
	"violence-coded-incitement": {
		category: "violence",
		kind: "harm",
		harmOption: false,
		displayName: msg("Indirect coded incitement"),
		description: msg("The author indirectly incites physical violence through coded language or an allusion whose violent meaning is clear from the context, without an explicit threat, plan, request or instructions."),
		exclusions: "Names, memes, ambiguous allusions and figures of speech without a clear violent meaning; reporting or condemnation; explicit threats, plans, requests or instructions, even when disguised with euphemisms or censored spelling, which are other forms."
	},
	"violence-extremism": {
		category: "violence",
		kind: "harm",
		harmOption: false,
		displayName: msg("Violent extremism"),
		description: msg("Support for terrorism or violent extremism by the author: propaganda, recruitment, fundraising, instructions or praise for a terrorist or violent extremist organisation, its leaders or its attacks, including glorifying attackers as heroes or martyrs; and perpetrator-produced attack footage or manifestos, however they are presented."),
		exclusions: "News, documentary, research, education, history or counterspeech that reports, explains or condemns terrorism without promoting it or reproducing attackers' material; mentioning a group's name; fiction that doesn't promote a real organisation or attack; lawful political movements, protest and military conflict between states."
	},
	"violence-injury": {
		category: "violence",
		kind: "harm",
		harmOption: false,
		displayName: msg("Injury"),
		description: msg("A bodily injury in content that already counts as Violence, such as an injury from an attack or one shown in explicit, disturbing detail. An injury alone never establishes Violence."),
		exclusions: "An injury or medical condition with no attack, death, threat or graphic depiction, however severe; threats, risks, weapons or pain without an injury; figurative language; self-injury alone."
	},
	"violence-violent-death": {
		category: "violence",
		kind: "harm",
		displayName: msg("Violent death"),
		description: msg("A depicted or described death caused by an attack, killing, accident or other physical trauma, or a dead body showing signs of violence. An attacker or intent to harm is not required."),
		exclusions: "A death from illness, old age or an unstated cause; a sudden or untimely death with no attack, accident or trauma stated; threats, death wishes, risks or abstract discussion; figurative language; suicide alone."
	},
	"violence-natural-death": {
		category: "violence",
		kind: "harm",
		displayName: msg("Natural or non-violent death"),
		description: msg("A depicted or described death from natural causes, illness, old age or an unstated cause, including a statement that someone has died or passed away, or a body with no signs of violence. A death is non-violent when no attack, accident or trauma is stated, even if it was sudden, untimely or unexplained."),
		exclusions: "A death caused by an attack, killing, accident or other physical trauma; death wishes, risks or abstract discussion of mortality; figurative language; suicide alone."
	},
	"violence-graphic": {
		category: "violence",
		kind: "harm",
		displayName: msg("Graphic detail"),
		description: msg("Severe bodily injury or death shown or described with explicit disturbing bodily detail, such as exposed organs, dismemberment or gore. In images, visible open wounds and heavy bleeding are graphic too."),
		exclusions: "Threats or mentions of violence without disturbing bodily detail; in text, bleeding, cuts, bruises or other serious injuries without exposed tissue, bone or organs, mutilation or dismemberment; in images, modest blood or minor wounds; injuries that aren't shown; self-injury or suicide alone."
	},
	"violence-decapitation-act": {
		category: "violence",
		kind: "harm",
		harmOption: false,
		displayName: msg("Act of decapitation"),
		description: msg("Visual footage showing a real person’s head being severed from their body: the act is visibly underway or captured as the head separates. Reporting, historical, educational or documentary framing does not remove that depicted act."),
		exclusions: "Text, captions or mentions; a severed head or body shown only afterwards; an act that happens off screen; fictional, staged, animated or generated scenes; clinical dissection.",
		inputs: ["image"]
	},
	"violence-gore": {
		category: "violence",
		kind: "harm",
		displayName: msg("Excessive gore"),
		description: msg("Gruesome bodily harm beyond graphic detail: dismembered, mutilated or decapitated bodies, exposed internal organs or bones, charred human remains, or an animal tortured or killed in gruesome detail."),
		exclusions: "Visible wounds, blood, burns or injuries without gruesome detail, which are Graphic detail; clinical or surgical images in a medical setting; ordinary hunting, fishing or food processing."
	},
	"violence-weapon": {
		category: "violence",
		kind: "harm",
		displayName: msg("Weapon without an attack"),
		description: msg("A firearm, knife or other weapon shown on its own, or carried, held, drawn or aimed with no person or animal visibly on the receiving end, including action poses, poster and game art, hunting and target shooting."),
		exclusions: "A weapon aimed, fired or swung at a visible or identified person or animal, including two people aiming at each other; a visible victim, injury, death or graphic harm; tools, toys or props with no violent association.",
		inputs: ["image"]
	},
	"violence-sport": {
		category: "violence",
		kind: "harm",
		displayName: msg("Combat sport or training"),
		description: msg("Recognizable consensual combat sport or protective training, such as boxing, martial arts, wrestling, fencing or self-defence practice, without graphic bodily detail or abusive conduct."),
		exclusions: "Graphic bodily detail, death, an attack outside the sport, abusive conduct, or a non-consensual fight presented as sport. A non-graphic sports injury doesn't remove the sport context.",
		inputs: ["image"]
	},
	"violence-text": {
		category: "violence",
		kind: "context",
		displayName: msg("Text"),
		description: msg("The content is text, not an image or video. It is set from the input type and never judged from the content."),
		exclusions: "Images and video, including text shown in them.",
		inputs: ["text"],
		fromInput: true
	},
	"violence-historical": {
		category: "violence",
		kind: "context",
		displayName: msg("Historical"),
		description: msg("Qualifying content explicitly attributed to a real historical event."),
		exclusions: "A date, past tense, an old-looking setting or a historical topic alone; a separate current threat, request or endorsement."
	},
	"violence-documentary": {
		category: "violence",
		kind: "context",
		displayName: msg("Reporting or documentary"),
		description: msg("Qualifying content explicitly framed as factual reporting, testimony or documentation of actual real-world events or utterances, including a person's own incident report or a report to an authority."),
		exclusions: "Neutral wording, third-person narration or quotation marks alone; fiction, invented examples, erotic display and adverts; a separate harmful request, attack or endorsement by the author."
	},
	"violence-educational": {
		category: "violence",
		kind: "context",
		displayName: msg("Educational"),
		description: msg("Qualifying content presented to teach or inform: a lesson, course or textbook material, a health, safety or clinical explanation, or academic study of the subject."),
		exclusions: "An educational label on a harmful request, working instructions or an endorsement; erotic, graphic or gratuitous detail beyond what the teaching needs; an academic tone alone. A request or plan to harm someone or commit a crime is excluded even when a reply answers it informatively."
	},
	"violence-discussion": {
		category: "violence",
		kind: "context",
		displayName: msg("Non-graphic discussion"),
		description: msg("Qualifying content referenced non-graphically to make or examine an argument, comparison, ethical question or analysis, or mentioned in passing, such as recalling that someone was shot, rather than to perform, endorse, threaten, eroticise or facilitate the harmful act."),
		exclusions: "Graphic or explicit sexual detail; erotic presentation; threats, victim mockery, endorsement, promotion, harmful assistance or instructions, direct harmful requests and sexual solicitation. A request or plan to harm someone or commit a crime is excluded even when a reply answers it informatively."
	},
	"violence-fictional": {
		category: "violence",
		kind: "context",
		displayName: msg("Fictional"),
		description: msg("Qualifying content clearly attributed to an invented character, fictional story, game, illustration, generated image or reenacted scene."),
		exclusions: "Unclear fictional context, and a real-world threat or actionable harmful request presented as fiction."
	},
	"violence-fantasy": {
		category: "violence",
		kind: "context",
		displayName: msg("Fantasy or cartoon violence"),
		description: msg("Unrealistic or stylised violence, such as cartoon, fantasy or game combat, slapstick, or defeating creatures, monsters or characters, with no realistic injury or blood."),
		exclusions: "Realistic violence against people, including in a story with clichéd, exaggerated or caricatured characters; realistic blood or injury, torture or sexual violence; any depiction or recreation of a real attack, war crime, genocide, terrorist attack or mass shooting, even when animated or in a game."
	},
	"violence-support-prevention": {
		category: "violence",
		kind: "context",
		displayName: msg("Support or prevention"),
		description: msg("Qualifying content shared only to seek or give support, prevent harm or aid recovery, such as a survivor describing abuse to get help, or counterspeech that rejects an attack or threat. Someone disclosing current harm or risk counts when they are seeking help."),
		exclusions: "Harmful instructions, assistance, advice on hiding harm, targeting or encouragement, including beside a supportive reply."
	},
	"self-harm-thoughts": {
		category: "self-harm",
		kind: "harm",
		displayName: msg("Thoughts or desire"),
		description: msg("Current or recurring thoughts of intentional self-injury or suicide, or an explicitly expressed desire or a stated intention to die by suicide. A hypothetical, conditional or figurative statement, such as I would die for this or I will die on this hill, is not."),
		exclusions: "General sadness, figurative language, statistics, past thoughts that have resolved, and prevention. An image without readable text sharing such thoughts."
	},
	"self-harm-preparation": {
		category: "self-harm",
		kind: "harm",
		displayName: msg("Intent or preparation"),
		description: msg("Expressed intent, preparation or a plan for intentional self-injury or suicide."),
		exclusions: "General distress, an injury without self-directed intent, and reports or prevention without any intent, preparation or plan."
	},
	"self-harm-act": {
		category: "self-harm",
		kind: "harm",
		displayName: msg("Depicted or reported act"),
		description: msg("A depicted or described act of intentional self-injury or suicide."),
		exclusions: "Accidental injuries, healed scars, recovery, and injuries with an unknown cause."
	},
	"self-harm-methods": {
		category: "self-harm",
		kind: "harm",
		displayName: msg("Methods or instructions"),
		description: msg("Actionable methods, requests or practical instructions for intentional self-injury or suicide."),
		exclusions: "Prevention, support, recovery and discussion without harmful methods; naming a means, such as pills or jumping, without how-to detail, an amount, a location or another actionable detail."
	},
	"self-harm-encouragement": {
		category: "self-harm",
		kind: "harm",
		displayName: msg("Encouragement"),
		description: msg("The author urges, endorses, praises or promotes intentional self-injury or suicide."),
		exclusions: "Support, prevention, condemnation, and reporting someone else's encouragement without endorsing it."
	},
	"self-harm-historical": {
		category: "self-harm",
		kind: "context",
		displayName: msg("Historical"),
		description: msg("Qualifying content explicitly attributed to a real historical event."),
		exclusions: "A date, past tense, an old-looking setting or a historical topic alone; a separate current threat, request or endorsement."
	},
	"self-harm-documentary": {
		category: "self-harm",
		kind: "context",
		displayName: msg("Reporting or documentary"),
		description: msg("Qualifying content explicitly framed as factual reporting, testimony or documentation of actual real-world events or utterances, including a person's own incident report or a report to an authority."),
		exclusions: "Neutral wording, third-person narration or quotation marks alone; fiction, invented examples, erotic display and adverts; a separate harmful request, attack or endorsement by the author."
	},
	"self-harm-educational": {
		category: "self-harm",
		kind: "context",
		displayName: msg("Educational"),
		description: msg("Qualifying content presented to teach or inform: a lesson, course or textbook material, a health, safety or clinical explanation, or academic study of the subject."),
		exclusions: "An educational label on a harmful request, working instructions or an endorsement; erotic, graphic or gratuitous detail beyond what the teaching needs; an academic tone alone."
	},
	"self-harm-fictional": {
		category: "self-harm",
		kind: "context",
		displayName: msg("Fictional"),
		description: msg("Qualifying content clearly attributed to an invented character, fictional story, game, illustration, generated image or reenacted scene."),
		exclusions: "Unclear fictional context, and a real-world threat or actionable harmful request presented as fiction."
	},
	"self-harm-support-prevention": {
		category: "self-harm",
		kind: "context",
		displayName: msg("Support or prevention"),
		description: msg("Qualifying content shared only to seek or give support, prevent harm or aid recovery, such as a survivor describing abuse to get help, or counterspeech that rejects an attack or threat. Someone disclosing current harm or risk counts when they are seeking help."),
		exclusions: "Harmful instructions, assistance, advice on hiding harm, targeting or encouragement, including beside a supportive reply."
	},
	"harassment-abuse": {
		category: "harassment",
		kind: "harm",
		displayName: msg("Insults or humiliation"),
		description: msg("Insults, contemptuous name-calling such as idiot, moron, loser or pathetic, swearing at someone to dismiss or attack them, humiliation or degrading treatment aimed at a person or at a group that is not a protected identity group."),
		exclusions: "Dislike or anger without an attack, such as “I hate you”; criticism of an argument, conduct or competence; untargeted profanity and profane praise; remarks with no identifiable target; a made-up quote illustrating a joke; describing an insult someone else holds; insults about a protected identity group as a whole, which are Hate unless a specific person is also attacked. Satire, sarcasm, mocking nicknames, mild name-calling such as fool or dummy, and joking comparisons are Mild mockery or teasing; threats are Threats or intimidation."
	},
	"harassment-mild": {
		category: "harassment",
		kind: "harm",
		displayName: msg("Mild mockery or teasing"),
		description: msg("Light ridicule, teasing, sarcasm, a mocking nickname or mild name-calling such as fool, dummy or silly, aimed at a person, including a public figure, or at a group that is not a protected identity group (a club, a team’s fans, a political party or its members), without contempt, degradation or threats. Hyperbole or satire about a public figure’s character, conduct or followers is included, and so is a meme whose comparison comes from its picture or a pictured character’s line, such as an animal guarding its “garbage”, when no one is directly called an insulting name. It counts so that a policy can allow or restrict it."),
		exclusions: "Contemptuous name-calling such as idiot, moron, loser or pathetic, degrading insults, slurs, threats, sexual remarks, bullying and victim mockery, which are other forms; name-calling of a protected identity group, which is Hate; criticism of an argument, decision or conduct; self-deprecation and untargeted jokes; affectionate teasing between friends or family; telling someone not to call another person a name."
	},
	"harassment-bullying": {
		category: "harassment",
		kind: "harm",
		displayName: msg("Bullying or abuse"),
		description: msg("Repeated or sustained targeting of a person, ganging up on them, excluding or shutting them out, or abuse or coercive control by a partner, family member or someone else in an ongoing relationship."),
		exclusions: "A single insult or remark, including a one-off demand that someone leave, which is Insults or humiliation; a one-off fight or assault by someone with no ongoing relationship to the victim."
	},
	"harassment-public-target": {
		category: "harassment",
		kind: "target",
		displayName: msg("Aimed at a public figure or group"),
		description: msg("The qualifying harassment is aimed at a public figure (an elected official or political candidate, a celebrity, a person with a large public following or a person in the news for their public role), an organisation or institution, or a group that is not a protected identity group (a club, a team’s fans, a political party or its members), rather than at a private individual."),
		exclusions: "Private individuals, including a named or addressed member of the public, another user, a classmate, a colleague or a family member; any minor, even a well-known one; people in the news only because of something that happened to them; protected identity groups, which are Hate."
	},
	"harassment-threat": {
		category: "harassment",
		kind: "harm",
		displayName: msg("Threats or intimidation"),
		description: msg("A direct, conditional or clearly implied personal threat, or serious abusive or coercive intimidation, against an identifiable person or group. Violent rhetoric between groups belongs under Hate or Violence."),
		exclusions: "Figures of speech; curses, religious condemnation and dismissals such as go to hell or get lost; disagreement or criticism; calling for lawful arrest, prosecution or accountability."
	},
	"harassment-sexual": {
		category: "harassment",
		kind: "harm",
		displayName: msg("Sexual harassment"),
		description: msg("Targeted unwanted sexual remarks, sexual humiliation, coercive advances or sexually abusive intimidation."),
		exclusions: "Consensual sexual dialogue, romance, sexual content not aimed at anyone, and vulgar dismissals with no sexual act, sexual attention or coercion."
	},
	"harassment-encouragement": {
		category: "harassment",
		kind: "harm",
		displayName: msg("Encouraging harassment"),
		description: msg("The author urges, organises, praises or endorses targeted abuse of a person."),
		exclusions: "Reporting or condemning abuse, and calling for lawful accountability."
	},
	"harassment-historical": {
		category: "harassment",
		kind: "context",
		displayName: msg("Historical"),
		description: msg("Qualifying content explicitly attributed to a real historical event."),
		exclusions: "A date, past tense, an old-looking setting or a historical topic alone; a separate current threat, request or endorsement."
	},
	"harassment-documentary": {
		category: "harassment",
		kind: "context",
		displayName: msg("Reporting or documentary"),
		description: msg("Qualifying content explicitly framed as factual reporting, testimony or documentation of actual real-world events or utterances, including a person's own incident report or a report to an authority."),
		exclusions: "Neutral wording, third-person narration or quotation marks alone; fiction, invented examples, erotic display and adverts; a separate harmful request, attack or endorsement by the author."
	},
	"harassment-educational": {
		category: "harassment",
		kind: "context",
		displayName: msg("Educational"),
		description: msg("Qualifying content used in a lesson, safety explanation, clinical explanation or academic study."),
		exclusions: "An educational label on a direct harmful request or endorsement. Actionable harmful instructions count as instructions even in teaching material."
	},
	"harassment-fictional": {
		category: "harassment",
		kind: "context",
		displayName: msg("Fictional"),
		description: msg("Qualifying harassment between invented characters in a clearly fictional story, comic, cartoon, game or roleplay, such as one character insulting, threatening, bullying or scheming against another, with no real or addressed person as its target."),
		exclusions: "Unclear fictional context: quotation marks, verse, a fragment or third-person narration alone don't make content fiction. Harassment aimed at a real person, the reader or another participant; a story used to attack someone real, such as one mocking a named classmate; memes, satire, caricatures and generated images about real people or groups; photographs of real people, including staged or stock photos."
	},
	"harassment-support-prevention": {
		category: "harassment",
		kind: "context",
		displayName: msg("Awareness, support or prevention"),
		description: msg("Qualifying content presented solely to raise awareness of bullying or abuse, give prevention or safety guidance, or seek or provide support to someone targeted, such as an anti-bullying campaign or a person asking for help."),
		exclusions: "A separate direct attack, advice to retaliate, or an awareness label on content that itself abuses someone. A reported attack shared to get help or prevent abuse is not a separate attack."
	},
	"hate-abuse": {
		category: "hate",
		kind: "harm",
		displayName: msg("Identity-based insults or slurs"),
		description: msg("Identity-based insults or slurs against people, including ones that are quoted or reported."),
		exclusions: "Mentioning an identity, untargeted profanity, and discussing a word without attacking people."
	},
	"hate-slurs": {
		category: "hate",
		kind: "harm",
		displayName: msg("Offensive slurs"),
		description: msg("Identity-based attacks that use a recognised offensive identity slur, including censored or disguised spellings, whether used, quoted, reported, historical, fictional or taught."),
		exclusions: "Neutral identity words, general insults about a people that aren't slurs, reclaimed or in-group use without contempt, and discussing a slur's history or meaning without attacking anyone."
	},
	"hate-dehumanization": {
		category: "hate",
		kind: "harm",
		displayName: msg("Dehumanization"),
		description: msg("The author claims or endorses that people with a protected identity are subhuman, animals, vermin or objects."),
		exclusions: "Literal descriptions, unrelated metaphors, and reporting or condemning someone else's dehumanizing words."
	},
	"hate-inferiority": {
		category: "hate",
		kind: "harm",
		displayName: msg("Inferiority or harmful stereotypes"),
		description: msg("A claim that people are inherently inferior, or a harmful stereotype or generalisation that they are criminal, violent, dangerous, dishonest or immoral, because of a protected identity, including quoted or reported claims."),
		exclusions: "Criticism of beliefs or conduct, and claims about particular people that don't extend to their group."
	},
	"hate-exclusion": {
		category: "hate",
		kind: "harm",
		displayName: msg("Exclusion or discrimination"),
		description: msg("The author advocates or endorses denying rights to, or excluding, people because of a protected identity."),
		exclusions: "Reporting, criticising a policy, and lawful distinctions that attack no identity."
	},
	"hate-symbol": {
		category: "hate",
		kind: "harm",
		displayName: msg("Hate symbol"),
		description: msg("A recognised hate emblem, slogan or gesture, such as a Nazi swastika, including one shown in a news report or anti-hate material, with no other attack on a protected group."),
		exclusions: "Religious or cultural symbols, similar shapes, ambiguous marks, a colour scheme alone, and discussion that shows no hate emblem; dehumanizing depictions, slurs and other attacks, which are other forms.",
		inputs: ["image"]
	},
	"hate-hostility": {
		category: "hate",
		kind: "harm",
		displayName: msg("Stated hatred"),
		description: msg("Hatred, dislike or hostility stated towards a protected identity group as a whole, such as saying “I hate men”, including religious or moral condemnation of a protected identity, such as calling homosexuality a sin, or denying that an identity exists, with no slur, insult or epithet, dehumanization, inferiority claim or harmful stereotype, exclusion or threat. It counts so that a policy can allow or restrict it."),
		exclusions: "Slurs, identity-based insults such as calling a group disgusting, dehumanization, inferiority claims or stereotypes, exclusion and threats, which are other forms; dislike of particular people or of something a group does; sarcastic praise; criticism of beliefs, ideologies or conduct."
	},
	"hate-threat": {
		category: "hate",
		kind: "harm",
		displayName: msg("Threats or incitement"),
		description: msg("The author threatens or endorses serious harm against people because of a protected identity."),
		exclusions: "Threats with no identity motive, reporting or condemning someone else's threat, and calls for lawful accountability."
	},
	"hate-personal": {
		category: "hate",
		kind: "harm",
		harmOption: false,
		displayName: msg("Aimed at a specific person"),
		description: msg("The identity attack is aimed at a specific, identifiable person, such as the person addressed or replied to, a named individual or someone pictured, rather than at a group in general."),
		exclusions: "Attacks on a group as a whole or on unnamed members of it; quoted, reported or historical attacks with no new attack by the author; insults aimed at invented characters in fiction."
	},
	"hate-historical": {
		category: "hate",
		kind: "context",
		displayName: msg("Historical"),
		description: msg("Qualifying content explicitly attributed to a real historical event."),
		exclusions: "A date, past tense, an old-looking setting or a historical topic alone; a separate current threat, request or endorsement."
	},
	"hate-documentary": {
		category: "hate",
		kind: "context",
		displayName: msg("Reporting or documentary"),
		description: msg("Qualifying content explicitly framed as factual reporting, testimony or documentation of actual real-world events or utterances, including a person's own incident report or a report to an authority."),
		exclusions: "Neutral wording, third-person narration or quotation marks alone; fiction, invented examples, erotic display and adverts; a separate harmful request, attack or endorsement by the author."
	},
	"hate-educational": {
		category: "hate",
		kind: "context",
		displayName: msg("Educational"),
		description: msg("Qualifying content used in a lesson, safety explanation, clinical explanation or academic study."),
		exclusions: "An educational label on a direct harmful request or endorsement. Actionable harmful instructions count as instructions even in teaching material."
	},
	"hate-fictional": {
		category: "hate",
		kind: "context",
		displayName: msg("Fictional"),
		description: msg("Qualifying content clearly attributed to an invented character, fictional story, game, illustration, generated image or reenacted scene."),
		exclusions: "Unclear fictional context, and a real-world threat or actionable harmful request presented as fiction."
	},
	"hate-counterspeech": {
		category: "hate",
		kind: "context",
		displayName: msg("Counterspeech"),
		description: msg("Concrete identity-based attacks quoted, paraphrased or described to reject, challenge or oppose their prejudice, including defending the people targeted and explaining why discriminatory claims are wrong."),
		exclusions: "Quotation, neutral documentation or victim support that doesn't challenge the prejudice; a statement opposing hate beside a separate attack the author makes or endorses."
	},
	"hate-support-prevention": {
		category: "hate",
		kind: "context",
		displayName: msg("Awareness, support or prevention"),
		description: msg("Qualifying content used to raise awareness, give practical prevention or safety guidance, or seek or provide support to people targeted by hate. Challenging a prejudiced claim is assessed separately as Counterspeech; both qualifiers may apply when the material also supports victims or provides prevention guidance."),
		exclusions: "A separate attack or endorsement by the author, or an awareness label on content that itself attacks a protected group. A reported attack used to counter hate is not a separate attack."
	},
	"criminal-activity-demonstration": {
		category: "criminal-activity",
		kind: "harm",
		displayName: msg("Depicted or reported activity"),
		description: msg("A depiction or account of a concrete violent or seriously dangerous criminal act, including a factual report of an actual act. A non-violent offence that endangers no one, such as theft or burglary, does not qualify on its own."),
		exclusions: "Mentioning a topic, everyday objects, policy debate, and accusations or opinions about whether someone committed a crime."
	},
	"criminal-activity-preparation": {
		category: "criminal-activity",
		kind: "harm",
		displayName: msg("Intent or preparation"),
		description: msg("A concrete intent, preparation or plan for a criminal or seriously dangerous act expressed by the author."),
		exclusions: "Vague danger, everyday risk, describing someone else's plan, lawful preparation, and lawful adult alcohol, tobacco, vaping or gambling activity and consensual adult sexual solicitation without separate criminal or seriously dangerous conduct. Threats and wishes of harm without a concrete criminal plan are assessed under Violence."
	},
	"criminal-activity-request": {
		category: "criminal-activity",
		kind: "harm",
		displayName: msg("Requests for assistance"),
		description: msg("A request by the author for help carrying out a concrete criminal or seriously dangerous act, or for help evading detection, consequences or accountability for one, such as how to get away with it. A later refusal does not erase that request."),
		exclusions: "Requests for lawful help, describing someone else's request, prevention, and lawful adult alcohol, tobacco, vaping or gambling activity and consensual adult sexual solicitation without separate criminal or seriously dangerous conduct."
	},
	"criminal-activity-instructions": {
		category: "criminal-activity",
		kind: "harm",
		displayName: msg("Instructions or facilitation"),
		description: msg("Actionable instructions, practical assistance or facilitation for a concrete criminal or seriously dangerous act, including how to evade detection, consequences or accountability for one."),
		exclusions: "Prevention, lawful safety advice, ordinary tools, non-actionable reporting, and lawful adult alcohol, tobacco, vaping or gambling activity and consensual adult sexual solicitation without separate criminal or seriously dangerous conduct."
	},
	"criminal-activity-promotion": {
		category: "criminal-activity",
		kind: "harm",
		displayName: msg("Recruitment or promotion"),
		description: msg("The author recruits for, endorses or promotes a concrete criminal or seriously dangerous act."),
		exclusions: "Reporting, condemnation, lawful advocacy, vague references to danger, and lawful adult alcohol, tobacco, vaping or gambling activity and consensual adult sexual solicitation without separate criminal or seriously dangerous conduct. Threats and wishes of harm without criminal recruitment or a plan are assessed under Violence."
	},
	"criminal-activity-coded-incitement": {
		category: "criminal-activity",
		kind: "harm",
		harmOption: false,
		displayName: msg("Indirect coded incitement"),
		description: msg("The author indirectly incites a concrete violent or seriously dangerous crime through coded language or an allusion whose meaning is clear from the context, without an explicit threat, plan, request or instructions."),
		exclusions: "Ambiguous allusions, bare wishes, reporting and lawful advocacy; explicit threats, plans, requests or instructions, even when disguised with euphemisms or censored spelling, which are other forms."
	},
	"criminal-activity-substances": {
		category: "criminal-activity",
		kind: "harm",
		displayName: msg("Drugs and controlled substances"),
		description: msg("Illegal drugs or controlled substances: their use, preparation, purchase, sale, production or trafficking, including prescription medicines obtained, sold or used outside lawful medical supply."),
		exclusions: "Medication prescribed and used as directed, lawful medical supply, pharmacy, research or educational scenes without illegal-drug use, lawful alcohol and tobacco, and crimes that don't involve drugs. Drug use in reporting, harm reduction or recovery still counts; its context is recorded separately."
	},
	"criminal-activity-grooming": {
		category: "criminal-activity",
		kind: "harm",
		displayName: msg("Grooming and exploitation"),
		description: msg("Manipulation that prepares a child or vulnerable person for sexual exploitation or abuse, such as sexual demands, rewards for sexual compliance, or secrecy, isolation or private-contact tactics with an evident exploitative purpose. Explicit sexual words aren't required. Reported or fictional grooming also counts."),
		exclusions: "Friendly contact, adult relationships, gifts, mentoring, private messages or secrecy alone; general grooming warnings; hair care and animal grooming."
	},
	"criminal-activity-csam": {
		category: "criminal-activity",
		kind: "harm",
		harmOption: false,
		displayName: msg("Child sexual abuse material"),
		description: msg("Child sexual abuse or exploitation material, whether only named or an actual instance of it being created, possessed, viewed, sought, bought, sold, shared, distributed or profited from, including requests and plans. A mention counts so that a policy can restrict it; conduct qualifiers such as Depicted or reported activity and Requests for assistance mark an actual instance. Reported, historical, fictional, educational and preventive instances also count."),
		exclusions: "Adult sexual material and lawful non-sexual images of children. Child abuse that isn't sexual material, and grooming without material, are separate forms.",
		inputs: ["text"]
	},
	"criminal-activity-alcohol": {
		category: "criminal-activity",
		kind: "harm",
		displayName: msg("Alcohol"),
		description: msg("Depicted or concretely described drinking, serving, purchasing, selling, making or advertising alcoholic drinks, including lawful adult activity and actual reported, historical or fictional instances."),
		exclusions: "Crimes involving alcohol, such as drink-driving or supplying minors, which are other forms; the word alcohol alone; health or prevention discussion with no drinking; non-alcoholic drinks, hand sanitiser, disinfectant, laboratory alcohol and medicine; drink names used as names or colours."
	},
	"criminal-activity-tobacco": {
		category: "criminal-activity",
		kind: "harm",
		displayName: msg("Tobacco and vaping"),
		description: msg("Depicted or concretely described smoking, vaping, chewing tobacco, or purchasing, selling, making or advertising tobacco, nicotine or vaping products, including lawful adult activity and actual reported, historical or fictional instances."),
		exclusions: "Crimes involving tobacco, such as selling to minors, which are other forms; health or prevention discussion with no smoking or vaping; nicotine patches or gum used to quit; smoke with no tobacco or vaping source; illegal-drug use without tobacco or vaping."
	},
	"criminal-activity-gambling": {
		category: "criminal-activity",
		kind: "harm",
		displayName: msg("Gambling"),
		description: msg("Depicted or concretely described betting or wagering money or something of real value on an uncertain outcome, casino gambling, paid lotteries, or selling or advertising those services, including lawful adult activity and actual reported, historical or fictional instances."),
		exclusions: "Crimes involving gambling, such as fraud, which are other forms; games, sports, cards or dice without stakes; free competitions; investing; figurative bets; risk or prevention discussion with no gambling."
	},
	"criminal-activity-fraud": {
		category: "criminal-activity",
		kind: "harm",
		displayName: msg("Fraud and scams"),
		description: msg("Fraud, scams or phishing: a deceptive message that seeks money, account access, credentials or personal details, such as an advance-fee or romance scam, a fake prize, invoice or delivery notice, impersonation of a bank or official, or counterfeit goods or payment fraud, whether carried out, planned, requested, taught or promoted."),
		exclusions: "General warnings or prevention advice with no specific scam, genuine requests for payment or details, and crimes without deception for gain. A reported scam or phishing example still counts; its context is recorded separately."
	},
	"criminal-activity-sexual-solicitation": {
		category: "criminal-activity",
		kind: "harm",
		displayName: msg("Sexual solicitation"),
		description: msg("An explicit request, offer or advertisement for consensual adult sexual activity or sexual services, including paid services. This policy category includes solicitation without inferring that it is illegal."),
		exclusions: "Dating, romance, discussion of sex work without solicitation, vague offers without sexual content, and coercion, trafficking, exploitation or sexual activity involving minors."
	},
	"criminal-activity-graffiti": {
		category: "criminal-activity",
		kind: "harm",
		displayName: msg("Graffiti"),
		description: msg("Graffiti, tagging or spray-painted markings on walls, vehicles or other property, or people applying them, shown, planned or requested. Permission is rarely visible, so authorised murals and street art count too."),
		exclusions: "Painting or drawing on canvas, paper or screens; removing or preventing graffiti; other property damage.",
		inputs: ["image"]
	},
	"criminal-activity-historical": {
		category: "criminal-activity",
		kind: "context",
		displayName: msg("Historical"),
		description: msg("Qualifying content explicitly attributed to a real historical event."),
		exclusions: "A date, past tense, an old-looking setting or a historical topic alone; a separate current threat, request or endorsement."
	},
	"criminal-activity-documentary": {
		category: "criminal-activity",
		kind: "context",
		displayName: msg("Reporting or documentary"),
		description: msg("Qualifying content explicitly framed as factual reporting, testimony or documentation of actual real-world events or utterances, including a person's own incident report or a report to an authority."),
		exclusions: "Neutral wording, third-person narration or quotation marks alone; fiction, invented examples, erotic display and adverts; a separate harmful request, attack or endorsement by the author."
	},
	"criminal-activity-educational": {
		category: "criminal-activity",
		kind: "context",
		displayName: msg("Educational"),
		description: msg("Qualifying content used in a lesson, safety explanation, clinical explanation or academic study."),
		exclusions: "A plain factual description with no teaching purpose; an educational label on a direct harmful request or endorsement. Actionable harmful instructions count as instructions even in teaching material. A request or plan to harm someone or commit a crime is excluded even when a reply answers it informatively."
	},
	"criminal-activity-discussion": {
		category: "criminal-activity",
		kind: "context",
		displayName: msg("Non-graphic discussion"),
		description: msg("Qualifying content referenced non-graphically to make or examine an argument, comparison, ethical question or analysis, rather than to perform, endorse, threaten, eroticise or facilitate the harmful act."),
		exclusions: "Graphic or explicit sexual detail; erotic presentation; threats, victim mockery, endorsement, promotion, harmful assistance or instructions, direct harmful requests and sexual solicitation. A request or plan to harm someone or commit a crime is excluded even when a reply answers it informatively."
	},
	"criminal-activity-fictional": {
		category: "criminal-activity",
		kind: "context",
		displayName: msg("Fictional"),
		description: msg("Qualifying content clearly attributed to an invented character, fictional story, game, illustration, generated image or reenacted scene."),
		exclusions: "Unclear fictional context, and a real-world threat or actionable harmful request presented as fiction."
	},
	"criminal-activity-support-prevention": {
		category: "criminal-activity",
		kind: "context",
		displayName: msg("Harm reduction, recovery or prevention"),
		description: msg("Qualifying content shared only to prevent crime or reduce harm, support victims, oppose a crime or threat, or aid recovery, such as anti-scam guidance describing a real scam, support after fraud or stalking, or harm reduction and addiction recovery for illegal drug use. Generic safety advice alone doesn't establish criminal content."),
		exclusions: "Practical help, instructions, concealment advice, promotion or sales that facilitate crime; a supportive label on content that itself carries out, requests or encourages the act. Advice to contact support or report a scam is not criminal help."
	}
};
const MODERATION_QUALIFIERS = Object.keys(MODERATION_QUALIFIER_INFO);
const MODERATION_QUALIFIERS_BY_CATEGORY = MODERATION_QUALIFIERS.reduce((groups, qualifier) => {
	(groups[MODERATION_QUALIFIER_INFO[qualifier].category] ??= []).push(qualifier);
	return groups;
}, {});
function getModerationQualifierInfo(qualifier) {
	return MODERATION_QUALIFIER_INFO[qualifier];
}
const getModerationQualifiers = (category) => MODERATION_QUALIFIERS_BY_CATEGORY[category] ?? [];
// packages/shared/src/PolicyRule.ts
/**
* What a policy does with content: deliver it (`allow`), deliver it but mark it so your app
* reduces its reach (`limit`), keep it off its plain URL so your app limits it to adults
* (`age-restrict`: `viewerClaims.ageConfirmed: true`), stop delivering it
* (`block`), or stop delivering it and delete its stored content (`purge`).
*/
const FLAGGED_CONTENT_ACTION_SCHEMA = zod.enum([
	"allow",
	"limit",
	"age-restrict",
	"block",
	"purge"
]);
const policyRuleSchema = (whenDescription, actionDescription) => zod.object({
	name: zod.string().trim().min(1).max(80).optional(),
	when: zod.array(zod.enum(MODERATION_QUALIFIERS)).min(1).max(MODERATION_QUALIFIERS.length).refine((v) => new Set(v).size === v.length, msg("Qualifiers must be unique")).meta({ description: whenDescription }),
	match: zod.literal("all").optional().meta({ description: "All selected qualifiers must describe the same qualifying instance. If supplied, must be all." }),
	unless: zod.array(zod.enum(MODERATION_QUALIFIERS)).min(1).max(MODERATION_QUALIFIERS.length).refine((v) => new Set(v).size === v.length, msg("Qualifiers must be unique")).optional().meta({ description: "Exclude instances covered by any of these qualifiers from this rule. Does not exempt other content or other categories." }),
	action: FLAGGED_CONTENT_ACTION_SCHEMA.meta({ description: actionDescription })
}).strict().refine((rule) => !rule.unless || !rule.when.some((qualifier) => rule.unless.includes(qualifier)), {
	message: msg("The exclusions prevent this rule from ever matching"),
	path: ["unless"]
});
const POLICY_ALLOWANCE_SCHEMA = policyRuleSchema("Qualifiers describing the content this allowance covers. Every selected qualifier must hold on the same instance. Eligible allowances may jointly cover all qualifying content.", "Softer than the category action: what happens to content the allowance covers.").refine((rule) => !rule.unless?.length, {
	message: msg("Only restrictions can have exclusions"),
	path: ["unless"]
});
/** Acts when one qualifying instance meets every selected qualifier and no exclusion. */
const POLICY_RESTRICTION_SCHEMA = policyRuleSchema("Qualifiers describing restricted content. Every selected qualifier must hold on the same instance. One matching qualifying instance can trigger this restriction.", "Any action except `allow`, including one weaker than the category action.");
// packages/shared/src/TestRegionalActions.ts
/** Authenticated test inputs can add regional delivery restrictions without inventing evidence. */
const TEST_REGIONAL_ACTIONS_SCHEMA = zod.array(zod.object({
	region: JURISDICTION_SCHEMA.exclude(["global"]),
	action: zod.enum([
		"limit",
		"age-restrict",
		"block"
	])
}).strict()).max(7).refine((entries) => new Set(entries.map((entry) => entry.region)).size === entries.length, "Choose each region once");
// packages/shared/src/ProcessingFeatures.ts
/**
* Optional analyses a request can turn on with `processingOptions.features.<id>`. The catalog is
* the single source for the request and result schemas, cache keys and metering. Features are
* chosen per request only; there is no project-level default.
*/
/** How mature a feature is. Beta results may change shape. */
const PROCESSING_FEATURE_STAGES = ["beta", "ga"];
const createFeatureOptionsSchemas = (booleanSchema) => {
	const enabled = booleanSchema.meta(metaStore([docPropertyInfo({ description: "Whether to run the feature. Every feature is off unless this is true." })]));
	return {
		ocr: zod.object({ enabled }).strict().meta(metaStore([docPropertyInfo({
			description: "Extract text onto the image asset and run an additional text moderation pass. Applies to images, including those extracted from multimedia documents and websites.",
			namedType: "OcrFeatureOptions"
		})])),
		personDetection: zod.object({ enabled }).strict().meta(metaStore([docPropertyInfo({
			description: "Preview. Locate people in images, including people whose faces are not visible. Results are informational and never change the moderation decision.",
			namedType: "PersonDetectionFeatureOptions"
		})])),
		faceDetection: zod.object({
			enabled,
			ageEstimation: booleanSchema.optional().meta(metaStore([docPropertyInfo({
				description: "Also estimate an age range for each face",
				defaultValue: false
			})]))
		}).strict().meta(metaStore([docPropertyInfo({
			description: "Preview. Locate faces in images and optionally estimate an age range for each. Faces are not identified or stored as biometric templates. Results are informational and never change the moderation decision.",
			namedType: "FaceDetectionFeatureOptions"
		})])),
		linkDetection: zod.object({ enabled }).strict().meta(metaStore([docPropertyInfo({
			description: "Find QR codes and web links in images. QR code contents are moderated as text. With OCR on, links in the extracted text are listed too. Free.",
			namedType: "LinkDetectionFeatureOptions"
		})])),
		aiGeneratedDetection: zod.object({ enabled }).strict().meta(metaStore([docPropertyInfo({
			description: "Preview. Read the provenance metadata AI image generators attach (C2PA Content Credentials, the IPTC digital source type and generator tool settings) to tell whether an image says it was made or edited with AI. Images whose metadata was stripped, such as screenshots, report no provenance. Results are informational and never change the moderation decision. Free.",
			namedType: "AiGeneratedDetectionFeatureOptions"
		})]))
	};
};
const createProcessingFeaturesSchema = (booleanSchema) => {
	const options = createFeatureOptionsSchemas(booleanSchema);
	return zod.object({
		ocr: options.ocr.nullish(),
		personDetection: options.personDetection.nullish(),
		faceDetection: options.faceDetection.nullish(),
		linkDetection: options.linkDetection.nullish(),
		aiGeneratedDetection: options.aiGeneratedDetection.nullish()
	}).strict().omit({
		personDetection: true,
		faceDetection: true,
		aiGeneratedDetection: true
	}).meta(metaStore([docPropertyInfo({
		description: "Optional analyses to run on this asset, keyed by feature. Unknown features are rejected.",
		namedType: "ProcessingFeatures"
	})]));
};
const PROCESSING_FEATURES_SCHEMA = createProcessingFeaturesSchema(zod.boolean());
/** Position and size as fractions of the image width and height, from 0 to 1. */
const BOUNDING_BOX_SCHEMA = zod.object({
	left: zod.number(),
	top: zod.number(),
	width: zod.number().min(0),
	height: zod.number().min(0)
}).strict().meta(metaStore([docPropertyInfo({
	description: "Position and size as fractions of the image width and height, from 0 to 1. `left` and `top` can be slightly negative when the subject extends past the edge.",
	namedType: "BoundingBox"
})]));
const TEXT_REGION_SCHEMA = zod.object({
	box: BOUNDING_BOX_SCHEMA,
	personalInformation: zod.boolean().describe("Whether the region is personal information, such as an email address, phone number or card number, rather than a paragraph of text")
}).strict().meta(metaStore([docPropertyInfo({
	description: "Where OCR found text in the image",
	namedType: "TextRegion"
})]));
const DETECTION_CONFIDENCE_SCHEMA = zod.number().min(0).max(1).describe("Detection confidence from 0 to 1");
const AGE_RANGE_SCHEMA = zod.object({
	low: zod.number().int().nonnegative(),
	high: zod.number().int().nonnegative()
}).strict().meta(metaStore([docPropertyInfo({
	description: "Estimated age range in years. Estimates can be off by several years.",
	namedType: "AgeRange"
})]));
const DETECTED_PERSON_SCHEMA = zod.object({
	box: BOUNDING_BOX_SCHEMA,
	confidence: DETECTION_CONFIDENCE_SCHEMA
}).strict().meta(metaStore([docPropertyInfo({
	description: "A detected person",
	namedType: "DetectedPerson"
})]));
const DETECTED_FACE_SCHEMA = zod.object({
	box: BOUNDING_BOX_SCHEMA,
	confidence: DETECTION_CONFIDENCE_SCHEMA,
	ageRange: AGE_RANGE_SCHEMA.optional()
}).strict().meta(metaStore([docPropertyInfo({
	description: "A detected face",
	namedType: "DetectedFace"
})]));
const NOT_EVALUATED_FEATURE_RESULT_SCHEMA = zod.object({
	status: zod.literal("not-evaluated"),
	stage: zod.enum(PROCESSING_FEATURE_STAGES),
	reason: zod.enum(["not-supported", "unavailable"])
}).strict();
const createFeatureResultSchema = (shape) => zod.discriminatedUnion("status", [zod.object({
	status: zod.literal("evaluated"),
	stage: zod.enum(PROCESSING_FEATURE_STAGES),
	...shape
}).strict(), NOT_EVALUATED_FEATURE_RESULT_SCHEMA]);
const PERSON_DETECTION_RESULT_SCHEMA = createFeatureResultSchema({ people: zod.array(DETECTED_PERSON_SCHEMA) });
const FACE_DETECTION_RESULT_SCHEMA = createFeatureResultSchema({ faces: zod.array(DETECTED_FACE_SCHEMA) });
const DETECTED_QR_CODE_SCHEMA = zod.object({
	value: zod.string().describe("The text the QR code holds, such as a URL"),
	box: BOUNDING_BOX_SCHEMA
}).strict().meta(metaStore([docPropertyInfo({
	description: "A decoded QR code",
	namedType: "DetectedQrCode"
})]));
const DETECTED_LINK_SCHEMA = zod.object({
	url: zod.string().describe("The link, with `https://` added when the image left it out"),
	source: zod.enum(["qr-code", "text"]).describe("Where the link was found: in a QR code, or in the text OCR extracted")
}).strict().meta(metaStore([docPropertyInfo({
	description: "A web link found in the image",
	namedType: "DetectedLink"
})]));
const LINK_DETECTION_RESULT_SCHEMA = createFeatureResultSchema({
	qrCodes: zod.array(DETECTED_QR_CODE_SCHEMA),
	links: zod.array(DETECTED_LINK_SCHEMA)
});
const PROVENANCE_SIGNAL_SCHEMA = zod.object({
	kind: zod.enum([
		"c2pa",
		"iptc-digital-source-type",
		"generator-metadata"
	]).describe("Where the evidence was found: a C2PA manifest, the IPTC digital source type in XMP, or settings an image generator wrote"),
	value: zod.string().describe("What it says, such as the digital source type or the generator's name")
}).strict().meta(metaStore([docPropertyInfo({
	description: "Provenance metadata found in the image file",
	namedType: "ProvenanceSignal"
})]));
const AI_GENERATED_DETECTION_RESULT_SCHEMA = createFeatureResultSchema({
	provenance: zod.enum([
		"ai-generated",
		"ai-edited",
		"unknown"
	]).describe("What the metadata says: `ai-generated`, `ai-edited` (a composite or edit made with AI), or `unknown` when the file carries no AI provenance. `unknown` doesn't mean a person made it: screenshots and re-saved images lose their metadata."),
	signals: zod.array(PROVENANCE_SIGNAL_SCHEMA)
});
const PROCESSING_FEATURE_RESULTS_SCHEMA = zod.object({
	personDetection: PERSON_DETECTION_RESULT_SCHEMA.optional(),
	faceDetection: FACE_DETECTION_RESULT_SCHEMA.optional(),
	linkDetection: LINK_DETECTION_RESULT_SCHEMA.optional(),
	aiGeneratedDetection: AI_GENERATED_DETECTION_RESULT_SCHEMA.optional()
}).strict().meta(metaStore([docPropertyInfo({
	description: "Results of the optional features requested in `processingOptions.features`, keyed by feature",
	namedType: "ProcessingFeatureResults"
})]));
const CLASSIFICATION_INPUT_TYPE_SCHEMA = zod.enum(["text", "image"]);
const CLASSIFICATION_CATEGORIES = [
	"sexual",
	"violence",
	"self-harm",
	"harassment",
	"hate",
	"criminal-activity",
	"personal-information",
	"profanity"
];
const MODERATION_POLICY_CATEGORIES = CLASSIFICATION_CATEGORIES;
const CLASSIFICATION_CATEGORY_SCHEMA = zod.enum(CLASSIFICATION_CATEGORIES);
const MODERATION_POLICY_CATEGORY_SCHEMA = CLASSIFICATION_CATEGORY_SCHEMA;
zod.object({
	category: CLASSIFICATION_CATEGORY_SCHEMA,
	displayName: saneStringField(),
	description: saneStringField(),
	supportedInputTypes: zod.array(CLASSIFICATION_INPUT_TYPE_SCHEMA).min(1)
});
MODERATION_CATEGORY_DEFINITIONS.sexual.summary, MODERATION_CATEGORY_DEFINITIONS.violence.summary, MODERATION_CATEGORY_DEFINITIONS["self-harm"].summary, MODERATION_CATEGORY_DEFINITIONS.harassment.summary, MODERATION_CATEGORY_DEFINITIONS.hate.summary, MODERATION_CATEGORY_DEFINITIONS["personal-information"].summary, MODERATION_CATEGORY_DEFINITIONS.profanity.summary, MODERATION_CATEGORY_DEFINITIONS["criminal-activity"].summary;
const LIKELIHOOD_SCHEMA = zod.enum([
	"very-unlikely",
	"unlikely",
	"possible",
	"likely",
	"very-likely"
]);
const CLASSIFICATION_NOT_EVALUATED_REASON_SCHEMA = zod.enum(["not-supported", "unavailable"]);
const STRICT_QUALIFIER_RESULTS_SCHEMA = zod.partialRecord(zod.enum(MODERATION_QUALIFIERS), zod.discriminatedUnion("status", [zod.object({
	status: zod.literal("evaluated"),
	/** Evidence that some of the category's qualifying content is this qualifier. */
	someScore: zod.number().min(0).max(1),
	/** Evidence that only this qualifier is in it: all of the qualifying content is one. */
	allScore: zod.number().min(0).max(1).optional(),
	likelihood: LIKELIHOOD_SCHEMA
}).strict().refine(({ someScore, allScore }) => allScore === void 0 || allScore <= someScore, {
	message: "The All score cannot exceed the Some score",
	path: ["allScore"]
}), zod.object({
	status: zod.literal("not-evaluated"),
	reason: CLASSIFICATION_NOT_EVALUATED_REASON_SCHEMA
}).strict()]));
const KNOWN_QUALIFIERS = new Set(MODERATION_QUALIFIERS);
/**
* Qualifier results keyed by qualifier. Keys from removed or renamed qualifiers are dropped rather
* than failing the report; known keys are still validated. Typed as the strict schema: the filter
* changes neither the accepted shape of known keys nor the JSON schema.
*/
const CLASSIFICATION_QUALIFIER_RESULTS_SCHEMA = zod.preprocess((value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => KNOWN_QUALIFIERS.has(key))) : value, STRICT_QUALIFIER_RESULTS_SCHEMA);
const CLASSIFICATION_POLICY_CONDITIONS_SCHEMA = zod.record(zod.string().min(1).max(65536), zod.discriminatedUnion("status", [zod.object({
	status: zod.literal("evaluated"),
	score: zod.number().min(0).max(1)
}).strict(), zod.object({
	status: zod.literal("not-evaluated"),
	reason: CLASSIFICATION_NOT_EVALUATED_REASON_SCHEMA
}).strict()]));
const CLASSIFICATION_CATEGORY_REPORT_SCHEMA = zod.discriminatedUnion("status", [
	zod.object({
		status: zod.literal("evaluated"),
		likelihood: LIKELIHOOD_SCHEMA,
		score: zod.number().min(0).max(1),
		qualifiers: CLASSIFICATION_QUALIFIER_RESULTS_SCHEMA.optional(),
		policyConditions: CLASSIFICATION_POLICY_CONDITIONS_SCHEMA.optional()
	}).strict(),
	zod.object({
		status: zod.literal("partial"),
		likelihood: LIKELIHOOD_SCHEMA,
		score: zod.number().min(0).max(1),
		qualifiers: CLASSIFICATION_QUALIFIER_RESULTS_SCHEMA.optional(),
		policyConditions: CLASSIFICATION_POLICY_CONDITIONS_SCHEMA.optional()
	}).strict(),
	zod.object({
		status: zod.literal("not-evaluated"),
		reason: CLASSIFICATION_NOT_EVALUATED_REASON_SCHEMA,
		qualifiers: CLASSIFICATION_QUALIFIER_RESULTS_SCHEMA.optional(),
		policyConditions: CLASSIFICATION_POLICY_CONDITIONS_SCHEMA.optional()
	}).strict()
]);
const CATEGORIES_SCHEMA = zod.object({
	sexual: CLASSIFICATION_CATEGORY_REPORT_SCHEMA,
	violence: CLASSIFICATION_CATEGORY_REPORT_SCHEMA,
	"self-harm": CLASSIFICATION_CATEGORY_REPORT_SCHEMA,
	harassment: CLASSIFICATION_CATEGORY_REPORT_SCHEMA,
	hate: CLASSIFICATION_CATEGORY_REPORT_SCHEMA,
	"criminal-activity": CLASSIFICATION_CATEGORY_REPORT_SCHEMA,
	"personal-information": CLASSIFICATION_CATEGORY_REPORT_SCHEMA,
	profanity: CLASSIFICATION_CATEGORY_REPORT_SCHEMA
}).strict();
/** What the project's policy made of the report when the asset was decided. */
const CLASSIFICATION_REPORT_POLICY_SCHEMA = zod.object({
	score: zod.number().min(0).max(1).describe("The highest category policy score."),
	categories: zod.partialRecord(CLASSIFICATION_CATEGORY_SCHEMA, zod.object({
		score: zod.number().min(0).max(1).describe("How strongly the content meets the policy, from 0 to 1: the category score, lowered by allowances that cover the content and raised to the presence score of a restriction."),
		action: FLAGGED_CONTENT_ACTION_SCHEMA.describe("What the policy does with this category. `allow` when the policy score is below 0.5."),
		source: zod.discriminatedUnion("kind", [
			zod.object({ kind: zod.literal("default") }).strict(),
			zod.object({ kind: zod.literal("below-threshold") }).strict(),
			zod.object({
				kind: zod.literal("allowance"),
				index: zod.number().int().nonnegative(),
				indexes: zod.array(zod.number().int().nonnegative()).min(2).optional()
			}).strict(),
			zod.object({
				kind: zod.literal("restriction"),
				index: zod.number().int().nonnegative(),
				indexes: zod.array(zod.number().int().nonnegative()).min(2).optional()
			}).strict()
		]).optional(),
		settings: zod.object({
			categoryAction: FLAGGED_CONTENT_ACTION_SCHEMA,
			allowances: zod.array(POLICY_ALLOWANCE_SCHEMA).max(50),
			restrictions: zod.array(POLICY_RESTRICTION_SCHEMA).max(50)
		}).strict().optional().describe("The category's default action and rules in force at decision time.")
	}).strict()).describe("Each assessed category's policy score and action. Unassessed categories are left out."),
	evidence: zod.enum(["decision", "full"]).optional().describe("`decision` when questions that could not change any action were skipped: every action is final, but a category's policy score and the rule credited with its action can differ from a detailed report. `full` (or absent) when every question was answered. Request a detailed report to answer the rest."),
	decision: zod.object({
		source: zod.enum([
			"policy",
			"asset-override",
			"children",
			"hash-list",
			"mandatory-rule"
		]),
		action: FLAGGED_CONTENT_ACTION_SCHEMA.exclude(["allow"]).nullable(),
		rule: zod.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).optional(),
		regions: zod.array(zod.object({
			region: JURISDICTION_SCHEMA.exclude(["global"]),
			action: FLAGGED_CONTENT_ACTION_SCHEMA.exclude(["allow"]),
			rule: zod.string(),
			category: CLASSIFICATION_CATEGORY_SCHEMA.optional()
		}).strict()),
		flaggedCategories: zod.array(CLASSIFICATION_CATEGORY_SCHEMA)
	}).strict().refine((decision) => decision.source === "mandatory-rule" ? Boolean(decision.rule) : decision.rule === void 0, {
		message: "decision/rule-required",
		path: ["rule"]
	}).optional().describe("The base asset decision and stricter outcomes in served jurisdictions. Mandatory-rule decisions identify the matching rule; global mandatory rules apply in every policy.")
}).strict();
const CLASSIFICATION_LABEL_SCHEMA = zod.object({
	description: saneStringField(),
	score: zod.number(),
	topicalityScore: zod.number().nullish(),
	likelihood: LIKELIHOOD_SCHEMA,
	knowledgeBaseId: saneStringField().nullish()
});
const CLASSIFICATION_REPORT_SCHEMA = zod.object({
	testCategoryActions: zod.partialRecord(CLASSIFICATION_CATEGORY_SCHEMA, zod.enum([
		"allow",
		"limit",
		"age-restrict",
		"block"
	])).optional().describe("Explicit category outcomes from an authenticated test scenario; bypass policy evaluation."),
	testRegionalActions: TEST_REGIONAL_ACTIONS_SCHEMA.optional().describe("Explicit regional restrictions from an authenticated test input."),
	processedAt: zod.number(),
	categories: CATEGORIES_SCHEMA,
	score: zod.number(),
	media: zod.object({
		durationSeconds: zod.number().positive(),
		frameIntervalSeconds: zod.number().positive().optional(),
		sampledFrames: zod.number().int().nonnegative(),
		audioTranscribed: zod.boolean(),
		segments: zod.array(zod.object({
			source: zod.enum([
				"frame",
				"speech",
				"frame-text",
				"clip"
			]),
			startSeconds: zod.number().nonnegative(),
			endSeconds: zod.number().nonnegative(),
			categories: CATEGORIES_SCHEMA
		}).strict())
	}).strict().optional(),
	labels: zod.array(CLASSIFICATION_LABEL_SCHEMA).nullish(),
	features: PROCESSING_FEATURE_RESULTS_SCHEMA.optional(),
	textRegions: zod.array(TEXT_REGION_SCHEMA).max(200).optional().describe("Where OCR found text, and personal information within it, in an image. Redaction transforms blur these regions."),
	hashMatches: zod.array(HASH_MATCH_SCHEMA).optional().describe("Entries in the project's hash lists that the image matched, blocking matches first and then the closest. Absent when nothing matched."),
	policy: CLASSIFICATION_REPORT_POLICY_SCHEMA.optional().describe("What the project's moderation policy made of this report when the asset was decided. Absent until then.")
}).strict();
// packages/shared/src/TestTriggers.ts
/** A project's test input key: 32 hexadecimal characters only its members can see. */
const TEST_INPUT_KEY_PATTERN = /^[a-f0-9]{32}$/;
const TEXT_CODE_SIGNALS = [
	...CLASSIFICATION_CATEGORIES,
	"sexual.involving-minors",
	"harassment.insult",
	"sexual.adult",
	"hate.regional-symbol"
];
/** A 128-bit, domain-separated tag; published samples never contain the project key. */
const getTestInputTag = async (kind, signal, testInputKey) => {
	if (!TEST_INPUT_KEY_PATTERN.test(testInputKey)) throw new TypeError("Invalid test input key");
	return (await hmacSha256Hex(testInputKey, `calmlens-test:${kind}:${signal}`)).slice(0, 32);
};
/** Category shortcuts are presets in the same instance-based format. */
function testInputForSignal(signal, kind = "text") {
	switch (signal) {
		case "harassment.insult": return TEST_INPUT_PRESETS.limited;
		case "sexual.adult": return kind === "image" ? TEST_INPUT_PRESETS.adultImage : TEST_INPUT_PRESETS.adultText;
		case "hate.regional-symbol": return TEST_INPUT_PRESETS.germany;
		case "sexual.involving-minors": return { instances: [{
			category: "sexual",
			qualifiers: ["sexual-minors"]
		}] };
		case "violence.graphic": return { instances: [{
			category: "violence",
			qualifiers: ["violence-graphic"]
		}] };
		default: return TEST_INPUT_SCHEMA.parse({ instances: [{
			category: signal,
			qualifiers: []
		}] });
	}
}
const getImageTestCategories = () => [...TEXT_CODE_SIGNALS];
/** Each row is one qualifying instance. Unselected qualifiers are explicitly absent. */
const TEST_INPUT_SCHEMA = zod.object({
	regionalActions: TEST_REGIONAL_ACTIONS_SCHEMA.optional(),
	unassessedCategories: zod.array(zod.enum(CLASSIFICATION_CATEGORIES)).max(CLASSIFICATION_CATEGORIES.length).optional(),
	instances: zod.array(zod.object({
		category: zod.enum(CLASSIFICATION_CATEGORIES),
		score: zod.number().min(0).max(1).optional(),
		action: zod.enum([
			"allow",
			"limit",
			"age-restrict",
			"block"
		]).optional(),
		qualifiers: zod.array(zod.enum(MODERATION_QUALIFIERS)).max(64)
	}).strict().superRefine((instance, context) => {
		if (new Set(instance.qualifiers).size !== instance.qualifiers.length || instance.qualifiers.some((q) => getModerationQualifierInfo(q).category !== instance.category || "fromInput" in getModerationQualifierInfo(q))) context.addIssue({
			code: "custom",
			message: "Choose unique content qualifiers from this category; input-type facts are automatic."
		});
	})).max(128)
}).strict().superRefine((scenario, context) => {
	if (scenario.instances.some((instance) => instance.action !== void 0) && scenario.instances.some((instance) => instance.action === void 0)) context.addIssue({
		code: "custom",
		message: msg("Set an action for every instance or omit all actions.")
	});
	const missing = scenario.unassessedCategories ?? [];
	if (new Set(missing).size !== missing.length || scenario.instances.some((instance) => missing.includes(instance.category))) context.addIssue({
		code: "custom",
		message: msg("An unassessed category cannot also have assessed instances.")
	});
});
const TEST_INPUT_PRESETS = {
	clean: { instances: [] },
	limited: { instances: [{
		category: "harassment",
		qualifiers: ["harassment-abuse"]
	}] },
	adultImage: { instances: [{
		category: "sexual",
		qualifiers: ["sexual-pornographic-media"]
	}] },
	adultText: { instances: [{
		category: "sexual",
		qualifiers: ["sexual-explicit-language"]
	}] },
	regionalDelivery: {
		instances: [],
		regionalActions: [
			{
				region: "DE",
				action: "block"
			},
			{
				region: "GB",
				action: "age-restrict"
			},
			{
				region: "FR",
				action: "limit"
			}
		]
	},
	germany: { instances: [{
		category: "hate",
		qualifiers: ["hate-symbol", "hate-nazi-symbols-public-display"]
	}] },
	mixed: { instances: [{
		category: "harassment",
		qualifiers: ["harassment-abuse", "harassment-documentary"]
	}, {
		category: "harassment",
		qualifiers: ["harassment-threat"]
	}] }
};
const pattern = /<!calmlens-test ([a-f0-9]{32}) ([A-Za-z0-9_-]+)>/g;
const tag = async (payload, key) => (await hmacSha256Hex(key, `calmlens-test:v1:${payload}`)).slice(0, 32);
async function generateTestTextCode(scenario, key) {
	if (!/^[a-f0-9]{32}$/.test(key)) throw new TypeError("Invalid test input key");
	const payload = btoa(JSON.stringify(TEST_INPUT_SCHEMA.parse(typeof scenario === "string" ? testInputForSignal(scenario) : scenario))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
	if (payload.length > 8e3) throw new RangeError("Test scenario is too large");
	return `<!calmlens-test ${await tag(payload, key)} ${payload}>`;
}
async function detectTestTrigger(text, key) {
	if (!/^[a-f0-9]{32}$/.test(key)) return;
	const matches = [...text.matchAll(pattern)];
	if (matches.length !== 1) return;
	const [, signature, payload] = matches[0];
	if (payload.length > 8e3 || !timingSafeEqual(signature, await tag(payload, key))) return;
	try {
		const parsed = TEST_INPUT_SCHEMA.safeParse(JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/"))));
		return parsed.success ? parsed.data : void 0;
	} catch {
		return;
	}
}
/** Category colours are decorative; authenticated instance data determines classification. */
const TEST_INPUT_CATEGORY_COLORS = {
	sexual: [
		232,
		80,
		160
	],
	violence: [
		224,
		56,
		64
	],
	"self-harm": [
		24,
		168,
		152
	],
	harassment: [
		240,
		128,
		48
	],
	hate: [
		144,
		80,
		216
	],
	"criminal-activity": [
		224,
		184,
		40
	],
	"personal-information": [
		48,
		128,
		224
	],
	profanity: [
		136,
		192,
		48
	]
};
/** One byte per 4px cell, stored in the low RGB bits to preserve the category colour. */
async function paintTestImage(scenario, key) {
	const input = TEST_INPUT_SCHEMA.parse(typeof scenario === "string" ? testInputForSignal(scenario, "image") : scenario);
	const bytes = new TextEncoder().encode(await generateTestTextCode(input, key));
	const palette = input.instances.length ? [...new Set(input.instances.map((instance) => instance.category))].map((category) => TEST_INPUT_CATEGORY_COLORS[category]) : [[
		144,
		152,
		160
	]];
	const data = new Uint8Array([
		67,
		76,
		84,
		83,
		2,
		bytes.length >> 8,
		bytes.length & 255,
		...bytes
	]);
	const cells = Math.ceil(Math.sqrt(data.length));
	const width = cells * 4;
	const height = width;
	const rgba = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		const row = Math.floor(i / width / 4);
		const cell = row * cells + Math.floor(i % width / 4);
		const value = data[cell % data.length];
		const x = cell % cells / (cells - 1);
		const y = row / (cells - 1);
		const position = (x * (1 - y) + (1 - x) * y) * (palette.length - 1);
		const start = Math.floor(position);
		const blend = position - start;
		const shade = (value * 73 + 41 & 255) / 255;
		const color = palette[start].map((channel, index) => {
			const mixed = channel + (palette[Math.min(start + 1, palette.length - 1)][index] - channel) * blend;
			return Math.round(mixed * (.65 + shade * .2) + 38 * shade);
		});
		rgba.set([
			color[0] & 248 | value >> 5,
			color[1] & 248 | value >> 2 & 7,
			color[2] & 252 | value & 3,
			255
		], i * 4);
	}
	return {
		width,
		height,
		rgba
	};
}
async function detectTestImage(image, key) {
	if (!Number.isSafeInteger(image.width) || image.width < 4 || image.width % 4 !== 0 || image.height !== image.width || image.height > 512 || image.rgba.length !== image.width * image.height * 4) return;
	const legacy = image.rgba[0] === 67 && image.rgba[1] === 188 && image.rgba[2] === 123;
	const bytes = [];
	for (let y = 0; y < image.height; y += 4) for (let x = 0; x < image.width; x += 4) {
		const offset = (y * image.width + x) * 4;
		const red = image.rgba[offset];
		const green = image.rgba[offset + 1];
		const blue = image.rgba[offset + 2];
		const value = legacy ? red : (red & 7) << 5 | (green & 7) << 2 | blue & 3;
		if (legacy && (green !== 255 - red || blue !== 123)) return;
		for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
			const pos = ((y + dy) * image.width + x + dx) * 4;
			if (image.rgba[pos] !== red || image.rgba[pos + 1] !== green || image.rgba[pos + 2] !== blue || image.rgba[pos + 3] !== 255) return;
		}
		bytes.push(value);
	}
	if (bytes.slice(0, 5).join() !== `67,76,84,83,${legacy ? 1 : 2}`) return;
	const length = bytes[5] << 8 | bytes[6];
	if (length > bytes.length - 7) return;
	return detectTestTrigger(new TextDecoder().decode(new Uint8Array(bytes.slice(7, 7 + length))), key);
}
export { msg as C, updatedAtField as S, POLICY_RESTRICTION_SCHEMA as _, generateTestTextCode as a, createdAtField as b, paintTestImage as c, CLASSIFICATION_REPORT_SCHEMA as d, MODERATION_POLICY_CATEGORIES as f, POLICY_ALLOWANCE_SCHEMA as g, FLAGGED_CONTENT_ACTION_SCHEMA as h, detectTestTrigger as i, testInputForSignal as l, PROCESSING_FEATURES_SCHEMA as m, TEST_INPUT_PRESETS as n, getImageTestCategories as o, MODERATION_POLICY_CATEGORY_SCHEMA as p, detectTestImage as r, getTestInputTag as s, TEST_INPUT_KEY_PATTERN as t, CLASSIFICATION_CATEGORIES as u, getModerationQualifiers as v, docPropertyInfo as w, saneStringField as x, HASH_LIST_ACTION_SCHEMA as y };
