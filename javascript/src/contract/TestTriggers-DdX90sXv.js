import { a as primaryIdField, c as createMetaType, l as metaStore, n as idField, s as updatedAt } from "./Ids-aHyP9ZcF.js";
import "./SharedConstants-CyiUWW66.js";
import { r as timingSafeEqual, t as hmacSha256Hex } from "./CryptoUtils-B_x8lMIx.js";
import * as zod from "zod";
// packages/shared/src/DocMetaTypes.ts
const docPropertyInfo = createMetaType({ id: "docPropertyInfo" });
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
const PDQ_HASH_SCHEMA = zod.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/, "Use a PDQ hash of 64 hexadecimal characters");
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
	createdByUserId: idField("user").nullish().describe("ID of the user who created the list"),
	createdAt: createdAtField().describe("When the list was created, in milliseconds since the Unix epoch"),
	updatedAt: updatedAtField().describe("When the list was last updated, in milliseconds since the Unix epoch")
});
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
	createdByUserId: idField("user").nullish().describe("ID of the user who added the entry"),
	createdAt: createdAtField().describe("When the entry was added, in milliseconds since the Unix epoch")
});
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
		summary: "Sexual acts, explicit sexual anatomy, sexual services, sexual assault depictions and clearly erotic material.",
		definition: "covers sexual acts, explicit sexual anatomy, sexual services and clearly erotic material. Actual exposed adult breasts or nipples, genitals or buttocks, and descriptions of masturbation, oral sex, ejaculation or orgasm count in clinical, educational and non-erotic material too. Descriptions of sexual assault can qualify without erotic intent. Fictional, illustrated and generated depictions can also qualify. Flirtation, innuendo and sexual jokes, and in images people shown in swimwear or other revealing clothing, also count, so that a policy can allow or restrict them.",
		exclusions: "Ordinary affection, diagrams without exposed sexual anatomy or acts, and general sexual-health education without a qualifying sexual description do not qualify on their own. Clinical, medical or educational framing does not erase actual sexual anatomy or activity; educational qualifiers control allowances.",
		docsHref: "/docs/guides/moderation-categories#sexual-content"
	},
	violence: {
		summary: "Physical attacks, graphic bodily harm, death, threats against others, and planning or encouraging physical violence.",
		definition: "covers physical attacks, sexual assault, graphic bodily harm, death and threats against others. Non-consensual sexual touching and coerced sexual acts count even without a separately described injury. Graphic bodily detail and natural death also count without an attacker; a non-graphic injury or medical condition alone does not. It also includes planning, requesting, encouraging or praising physical violence. A depicted or described act can qualify in fiction or news reporting even when the author condemns it. In images, a weapon shown without an attack and consensual combat sport or training also count, so that a policy can allow or restrict them.",
		exclusions: "Solely intentional self-injury or suicide belongs under self-harm. Property damage alone, figurative language and abstract discussion of violence, injury or death do not establish violence. Non-graphic injuries and medical states alone do not qualify, regardless of severity: fractures, wounds, bruises, scars, coma, treatment and recovery do not establish an attack. Explicit disturbing bodily detail such as exposed bone, organs or mutilation can qualify even after an accident or during medical treatment.",
		docsHref: "/docs/guides/moderation-categories#violence"
	},
	"self-harm": {
		summary: "Intentional self-injury, suicide, preparation, methods or encouragement; text also includes current or recurring self-harm thoughts.",
		definition: "covers intentional self-injury, suicide, current self-harm risk, preparation, methods and encouragement. For text, it also includes current or recurring self-harm thoughts and an explicitly expressed desire to die. Asking for support does not cancel a separate disclosure of current risk or behavior.",
		exclusions: "An injury or covered body does not establish that harm was self-inflicted. General sadness, neutral statistics and healed scars alone are excluded. Prevention or recovery without a concrete described act, current risk or harmful methods is insufficient; reported or historical acts still count.",
		docsHref: "/docs/guides/moderation-categories#self-harm"
	},
	harassment: {
		summary: "Attacks on an identifiable person or a non-protected group: insults and humiliation, threats and intimidation, bullying and exclusion, sexual harassment and abuse, abuse within a relationship, and encouraging others to do these.",
		definition: "covers content that attacks an identifiable person, or a group that is not a protected identity group, or asks others to. Attacks are insults and contemptuous name-calling, demeaning or humiliating treatment, threats and intimidation, bullying and exclusion, sexual harassment, sexual abuse or objectification, and abuse or coercive control by a partner, family member or someone else in an ongoing relationship. Mild mockery and teasing, including mild or jokey name-calling such as fool, dummy, silly or clowns, sarcasm and mocking nicknames, are a lighter form of their own rather than insults, so that a policy can allow or restrict them. The target can be named, addressed, implied or invented, and need not have a protected identity. Attacks that are quoted, reported, shown in fiction, taught or condemned still count; qualifiers record their framing, their severity and whether the target is a public figure or group.",
		exclusions: "Not harassment on its own: dislike or anger without an attack, such as \"I hate you\"; disagreement or criticism of an idea, argument, decision, conduct or work, however blunt; untargeted profanity; affectionate teasing between people on good terms; telling someone not to call another person a name. An attack on a protected identity group is Hate, and a one-off physical attack is Violence; either is also Harassment when the content separately attacks a person in one of the ways above.",
		docsHref: "/docs/guides/moderation-categories#harassment-and-bullying"
	},
	hate: {
		summary: "Identity-based abuse, dehumanization, discriminatory exclusion or threats against people because of protected characteristics.",
		definition: "covers attacks on people because of race, ethnicity, nationality, religion, caste, sex, gender identity, sexual orientation or disability. It includes dehumanization, claims that a group is inferior, harmful stereotypes and generalisations such as saying a group is criminal, violent, dangerous or immoral, discriminatory exclusion, identity-based slurs and abuse, and threats. Images that show a hate symbol or attack to counter or prevent hate, such as anti-hate education, also count, so that a policy can allow or restrict them.",
		exclusions: "Not hate on its own: mentioning an identity, cultural clothing or religious imagery; describing differences in outcomes or treatment between groups without claiming that a group is inferior; criticism of beliefs, ideologies, political movements or conduct; reclaimed identity language used without contempt; discussing a slur as a word; an insult about someone’s conduct where a protected trait only identifies them; everyday insults such as dummy or fool. Attacks that are quoted, reported, condemned or taught still count, and qualifiers record that framing.",
		docsHref: "/docs/guides/moderation-categories#hate-and-identity-abuse"
	},
	"personal-information": {
		summary: "Private contact details, precise personal location, sensitive identifiers or credentials, and requests to disclose them.",
		definition: "covers supplied private personal contact details such as personal email addresses and phone numbers, precise home or current location, government or financial identifiers, account credentials and authentication secrets. Explicit requests to disclose those details also count even when no value is supplied. Own details and other people's details both count; qualifiers distinguish them. Concrete quoted, reported or educational instances remain present; framing does not erase them. Readable details in images count, but do not infer identity or unseen details from a face or setting.",
		exclusions: "Ordinary names alone, ages alone, broad locations such as a city, public business or official contact details, clearly fictional examples or placeholders such as example.com addresses, redacted values, generic privacy advice and descriptions of omitted details do not qualify.",
		docsHref: "/docs/guides/moderation-categories#personal-information"
	},
	profanity: {
		summary: "Actual swear words, vulgar language or offensive slurs, including clearly recognisable obfuscations.",
		definition: "covers actual swear words, vulgar expletives and offensive slurs in the supplied language, including mild and strong forms and clearly recognisable censored or obfuscated spellings. It does not require a target, abusive intent or an attack. Quoted, reclaimed, historical, fictional, educational and supportive uses still contain the language; qualifiers distinguish its form and framing. Readable words in images count.",
		exclusions: "Descriptions such as the character swears or the passage contains a slur without the actual wording, ordinary anatomical or medical terminology, insults or dehumanising words that are neither swear words nor conventional slurs (such as vermin, pests, idiot or clown), words with innocent literal meanings, names containing a swear-word substring, and ambiguous abbreviations or symbols without supported profane meaning do not qualify.",
		docsHref: "/docs/guides/moderation-categories#profanity"
	},
	"criminal-activity": {
		summary: "Concrete criminal or seriously dangerous acts, plans, assistance or instructions; fraud, scams, grooming, illegal drugs and contraband, plus policy-controlled alcohol, tobacco/vaping and gambling.",
		definition: "covers concrete criminal or seriously dangerous acts and their planning, requests for assistance, instructions, encouragement or facilitation, including help evading detection, consequences or accountability for them, and concrete acts depicted or described in reporting, fiction, education or prevention. A request can qualify even when no act occurs and a later reply refuses it. Dangerous activity requires a concrete serious risk of physical harm. It also covers fraud, scams and phishing aimed at the reader, illegal drug use, dealing, production or trafficking, and contraband such as stolen goods, counterfeit money or documents and smuggled or illegally traded weapons. Consensual adult sexual solicitation, including paid services, also counts so that a policy can allow or restrict it; this does not establish illegality. Concrete grooming for sexual exploitation or abuse also counts, including evidenced manipulation before explicit sexual content. Child sexual abuse material counts whenever it is supplied, sought, traded or merely named or referred to, so that a policy can restrict even a bare mention; conduct qualifiers distinguish an actual instance from a mention. Depicted or concretely described alcohol drinking or trade, tobacco or vaping use or trade, and gambling with real-value stakes count for policy control even when lawful; this does not assert illegality. In images, graffiti on property counts. Harm-reduction, recovery or prevention material about illegal drug use counts in text and images. A policy can allow or restrict each.",
		exclusions: `Solely self-directed harm, suicidal thoughts, self-harm risk or help-seeking belongs under self-harm, not criminal activity; require separate criminal conduct or serious endangerment of others. A depiction or report of a non-violent offence that endangers no one, such as theft, burglary, shoplifting, trespass, vandalism or a past fraud, does not qualify on its own, even when it shows the act in progress; it qualifies only with an actual plan, request, instructions, facilitation, promotion or encouragement, or as an offer to sell stolen or counterfeit goods. Violent acts, threats, coercion such as blackmail, and acts that seriously endanger people still qualify when depicted or reported. A topic mention, lawful safety advice without a concrete criminal act, or vague dangerous reference does not qualify. Lawful medical, pharmaceutical, clinical and research activity is not criminal, including prescriptions, dosages, side effects, controlled medicines used as prescribed, pharmacies, hospitals and lawful pharmaceutical manufacturing. Framing something as reporting, education or prevention does not erase an actual qualifying criminal act or harmful instructions. Generic alcohol, tobacco, gambling or drug-policy discussion without a concrete qualifying instance does not qualify. Non-alcoholic drinks, disinfectant, prescribed cessation treatment and games without real-value stakes do not qualify. Masks, computers, payment cards, detention or ordinary tools do not establish criminal facilitation by themselves. A clear visual demonstration of how to carry out a crime can qualify.`,
		docsHref: "/docs/guides/moderation-categories#criminal-and-dangerous-activity"
	}
};
// packages/shared/src/ModerationPolicyDimensions.ts
const MODERATION_QUALIFIER_INFO = {
	"personal-information-contact": {
		category: "personal-information",
		kind: "harm",
		displayName: "Private contact details",
		description: "Supplied private personal email addresses, phone numbers or other direct personal contact details, or direct requests to reveal those kinds of details.",
		exclusions: "Public business or official contacts, ordinary names, broad locations, placeholders, redacted values."
	},
	"personal-information-email": {
		category: "personal-information",
		kind: "harm",
		displayName: "Private email addresses",
		description: "A supplied private personal email address, or a direct request to reveal one.",
		exclusions: "Public business or official email addresses, example.com placeholders, redacted addresses."
	},
	"personal-information-phone": {
		category: "personal-information",
		kind: "harm",
		displayName: "Private phone numbers",
		description: "A supplied private personal telephone or mobile number, or a direct request to reveal one.",
		exclusions: "Public business or official phone numbers, redacted values, ordinary numbers."
	},
	"personal-information-government-id": {
		category: "personal-information",
		kind: "harm",
		displayName: "Government identifiers",
		description: "A supplied personal passport, national identity, national insurance, social security or similar government-issued identifier, or a direct request to reveal one.",
		exclusions: "Public organisation identifiers, ordinary names or numbers, redacted identifiers, clearly fictional placeholders."
	},
	"personal-information-financial": {
		category: "personal-information",
		kind: "harm",
		displayName: "Financial identifiers",
		description: "A supplied private personal bank account, payment-card or other sensitive financial account identifier, or a direct request to reveal one.",
		exclusions: "Public business payment destinations without a personal privacy link, prices, ordinary numbers, redacted values, clear placeholders."
	},
	"personal-information-location": {
		category: "personal-information",
		kind: "harm",
		displayName: "Precise personal location",
		description: "A supplied precise home address or current personal location, including coordinates or a live location tied to a person, or a direct request to reveal those kinds of locations.",
		exclusions: "Broad locations, public venues without a private or current-person link, fictional placeholders, redaction and generic requests without a precise personal-location target."
	},
	"personal-information-identifiers": {
		category: "personal-information",
		kind: "harm",
		displayName: "Sensitive identifiers",
		description: "Supplied government IDs, national insurance or social security numbers, passport numbers, bank account or payment-card identifiers tied to a person, or direct requests to reveal those kinds of identifiers.",
		exclusions: "Ordinary names, dates or numbers without identifier context, public organisation identifiers, redacted values and clear placeholders."
	},
	"personal-information-credentials": {
		category: "personal-information",
		kind: "harm",
		displayName: "Credentials and secrets",
		description: "Supplied private passwords, access tokens, API secrets, authentication codes or recovery credentials for an account, or direct requests to reveal those kinds of credentials.",
		exclusions: "Public usernames alone, instructions to create a strong password without a supplied secret, redacted values and explicitly non-functional sample credentials."
	},
	"personal-information-request": {
		category: "personal-information",
		kind: "harm",
		displayName: "Requests for private details",
		description: "The message or a supplied chat turn explicitly asks someone to disclose private contact details, precise personal location, sensitive identifiers or credentials.",
		exclusions: "Generic privacy discussion, public business contacts, a narrator merely recording someone else's request, and requests for an ordinary name or broad location alone."
	},
	"personal-information-self-disclosure": {
		category: "personal-information",
		kind: "target",
		displayName: "Own details",
		description: "The speaker supplies private personal details and presents them as their own.",
		exclusions: "Details whose owner isn't stated, other people's details, and requests without supplied values."
	},
	"personal-information-third-party": {
		category: "personal-information",
		kind: "target",
		displayName: "Other people’s details",
		description: "The supplied private details belong to someone other than the speaker, or their owner isn't stated, such as a filled-in form or record.",
		exclusions: "Details the speaker presents as their own, and requests without supplied values."
	},
	"personal-information-historical": {
		category: "personal-information",
		kind: "context",
		displayName: "Historical",
		description: "Actual qualifying content explicitly attributed to a historical event.",
		exclusions: "A date or past tense alone, or a separate current instance."
	},
	"personal-information-documentary": {
		category: "personal-information",
		kind: "context",
		displayName: "Reporting or documentary",
		description: "Private details explicitly framed as factual reporting or documentation of an actual real-world event, such as a news report, court record or public notice that contains them.",
		exclusions: "Stating, passing on or sharing someone's details, however accurate or matter-of-fact; telling people to contact, visit or find someone; third-person narration or quotation marks alone; fictional or invented examples."
	},
	"personal-information-educational": {
		category: "personal-information",
		kind: "context",
		displayName: "Educational",
		description: "Actual qualifying content used in a supported lesson, clinical explanation or academic study.",
		exclusions: "Neutral description alone or an unsupported educational label on a separate active harmful request."
	},
	"personal-information-fictional": {
		category: "personal-information",
		kind: "context",
		displayName: "Fictional",
		description: "Actual qualifying content explicitly represented in fiction, a story, game or illustration.",
		exclusions: "No actual qualifying content, generic references to an omitted passage, or an unsupported claim of fiction."
	},
	"personal-information-support-prevention": {
		category: "personal-information",
		kind: "context",
		displayName: "Support and prevention",
		description: "Actual qualifying content presented solely to seek or provide support, prevent harm, explicitly oppose abuse or aid recovery.",
		exclusions: "A separate active harmful request or attack, generic safety advice without qualifying content, or neutral description without a supported prevention or support purpose."
	},
	"profanity-mild": {
		category: "profanity",
		kind: "harm",
		displayName: "Mild profanity",
		description: "Actual mild swear words or exclamations, such as damn or hell when used profanely, judged in the supplied language.",
		exclusions: "Innocent literal or religious meanings, strong profanity, generic references to swearing and ambiguous abbreviations."
	},
	"profanity-strong": {
		category: "profanity",
		kind: "harm",
		displayName: "Strong profanity",
		description: "Actual strong swear words or vulgar expressions, including clearly recognisable obfuscated forms, judged in the supplied language.",
		exclusions: "Mild exclamations alone, formal medical or anatomical terms, innocent substrings, generic references to profanity and ambiguous symbols."
	},
	"profanity-slurs": {
		category: "profanity",
		kind: "harm",
		displayName: "Offensive slurs",
		description: "Actual conventional offensive identity slurs, including quoted or reclaimed uses; this lexical finding does not itself establish an identity attack.",
		exclusions: "An omitted or unspecified slur, neutral identity terms without a conventional offensive meaning and ambiguous words without supported slur meaning."
	},
	"profanity-obfuscated": {
		category: "profanity",
		kind: "harm",
		displayName: "Obfuscated profanity",
		description: "A swear word or offensive slur that remains clearly recognisable despite masking, spacing, character substitutions or deliberate misspelling.",
		exclusions: "Uninterpretable symbols, innocent abbreviations, ordinary words or names with accidental substrings, and an unspecified censored passage."
	},
	"profanity-historical": {
		category: "profanity",
		kind: "context",
		displayName: "Historical",
		description: "Actual qualifying content explicitly attributed to a historical event.",
		exclusions: "A date or past tense alone, or a separate current instance."
	},
	"profanity-documentary": {
		category: "profanity",
		kind: "context",
		displayName: "Reporting or documentary",
		description: "Actual qualifying content explicitly presented as factual reporting, testimony or documentation of a real-world event or utterance.",
		exclusions: "Neutral wording, third-person narration or quotation marks alone; fictional or invented teaching examples without real-world reporting."
	},
	"profanity-educational": {
		category: "profanity",
		kind: "context",
		displayName: "Educational",
		description: "Actual qualifying content used in a supported lesson, clinical explanation or academic study.",
		exclusions: "Neutral description alone or an unsupported educational label on a separate active harmful request."
	},
	"profanity-fictional": {
		category: "profanity",
		kind: "context",
		displayName: "Fictional",
		description: "Actual qualifying content explicitly represented in fiction, a story, game or illustration.",
		exclusions: "No actual qualifying content, generic references to an omitted passage, or an unsupported claim of fiction."
	},
	"profanity-support-prevention": {
		category: "profanity",
		kind: "context",
		displayName: "Support and prevention",
		description: "Actual qualifying content presented solely to seek or provide support, prevent harm, explicitly oppose abuse or aid recovery.",
		exclusions: "A separate active harmful request or attack, generic safety advice without qualifying content, or neutral description without a supported prevention or support purpose."
	},
	"sexual-nudity": {
		category: "sexual",
		kind: "harm",
		displayName: "Nudity",
		description: "Explicitly exposed intimate sexual anatomy, including partially exposed breasts, genitals or buttocks and a pubic area or pubic hair exposed by clothing pulled down or open. Drawn, animated and generated characters count, including creature or anthropomorphic characters drawn with genitals or other sexual anatomy.",
		exclusions: "Swimwear, revealing clothing and diagrams without exposed sexual anatomy; ordinary animals and cartoon characters without drawn sexual anatomy. Actual exposed sexual anatomy in a clinical or medical diagram still qualifies; educational framing is separate."
	},
	"sexual-activity": {
		category: "sexual",
		kind: "harm",
		displayName: "Sexual activity",
		description: "A depicted or described sexual act, including sexual assault. Solo acts count: masturbation, touching or stimulating one's own genitals, and using a sex toy. So do explicitly sexual fetish acts and sexual acts by drawn, animated, generated, creature or anthropomorphic characters.",
		exclusions: "Ordinary affection, non-sexual touching and general sexual-health education alone."
	},
	"sexual-explicit-language": {
		category: "sexual",
		kind: "harm",
		displayName: "Explicit sexual language",
		description: "Graphic sexual descriptions or explicitly erotic dialogue.",
		exclusions: "Untargeted profanity, anatomical terms and non-erotic medical or educational language alone."
	},
	"sexual-non-consensual": {
		category: "sexual",
		kind: "harm",
		displayName: "Non-consensual sexual content",
		description: "Sexual content depicting or describing non-consensual sexual activity, such as sexual assault, rape or coerced sex presented as sexual or erotic material, including fiction, animation and generated images.",
		exclusions: "Factual reports, survivor accounts, support, prevention or non-graphic discussion of sexual assault that do not present it as sexual material; consensual sexual activity. A real person's intimate images shared without consent are intimate image abuse."
	},
	"sexual-intimate-image-abuse": {
		category: "sexual",
		kind: "harm",
		harmOption: false,
		displayName: "Intimate image abuse",
		description: "Intimate images of a real, identifiable person shared, offered, sought or traded without their consent, or threatened to be shared: nudity, sexual acts or sexualised images, including hidden-camera, upskirt, leaked or hacked images, sextortion threats, and sexual deepfakes or digitally undressed images of real people.",
		exclusions: "Consensual adult content, including people sharing their own images or professional adult content; fictional, drawn or invented characters with no real person depicted; non-sexual images; factual reports, survivor accounts, prevention or support that share no such image and make no threat; mentioning a leak without sharing, offering or seeking the images."
	},
	"sexual-minors": {
		category: "sexual",
		kind: "harm",
		harmOption: false,
		displayName: "Sexualised minors",
		description: "Sexual content involving a child or a character presented as a child: nudity, a sexual act, or sexualised posing or focus on the body of someone who clearly appears to be under 18 from childlike body proportions, a stated or obvious age, or a childlike framing such as a school-age character in explicit content. Drawings, animation and generated images count.",
		exclusions: "Adults, including youthful-looking adults and drawn characters with adult bodies and no childlike framing; school uniforms or costumes on clearly adult people; non-sexual images or mentions of children; factual reports, prevention or support about child sexual abuse that present no sexual material. Do not infer a child from a youthful face, small stature or art style alone."
	},
	"sexual-solicitation": {
		category: "sexual",
		kind: "harm",
		displayName: "Sexual solicitation",
		description: "A request, offer or advertisement for sexual services, escorting or a sexual encounter, performed by the message itself or a supplied chat turn.",
		exclusions: "Promotion of adult content, such as a subscription page or explicit media for sale, which is adult content promotion; dating, ordinary romance, accepting money or vague offers without sexual content."
	},
	"sexual-adult-promotion": {
		category: "sexual",
		kind: "harm",
		displayName: "Adult content promotion",
		description: "Promotion of legal adult sexual content performed by the message itself: links to, subscriptions for, or sales of pornography, explicit photos or videos, or an adult creator's paid page.",
		exclusions: "Offers or requests for sexual services, escorting or a sexual encounter, which are sexual solicitation; dating, ordinary romance and non-sexual paid content."
	},
	"sexual-revealing-clothing": {
		category: "sexual",
		kind: "harm",
		displayName: "Revealing clothing",
		description: "People shown in swimwear, underwear or lingerie-style clothing, or other clothing that exposes much of the body, with no exposed sexual anatomy, sexual act or explicit erotic display. Fitness clothing counts only when it exposes much of the body.",
		exclusions: "Exposed sexual anatomy, including a pubic area, buttocks or genitals exposed by clothing pulled down, open or pushed aside, which is nudity; a sexual act or an explicit erotic display; sexual solicitation or adult content promotion, such as an adult cam or paid adult-creator page; ordinary clothing, sportswear and team kits that cover the torso and thighs; costumes or uniforms that are not revealing.",
		inputs: ["image"]
	},
	"sexual-suggestive": {
		category: "sexual",
		kind: "harm",
		displayName: "Suggestive content",
		description: "Flirtation, innuendo, sexual jokes or suggestive romance, such as kissing, caressing or a suggestive pose, with no sexual act, exposed sexual anatomy or explicit sexual language.",
		exclusions: "A sexual act, exposed sexual anatomy or explicit sexual language; sexual solicitation or adult content promotion; ordinary affection or romance without sexual suggestion."
	},
	"sexual-non-erotic-nudity": {
		category: "sexual",
		kind: "context",
		displayName: "Non-erotic nudity",
		description: "Exposed anatomy in a non-erotic setting: breastfeeding, childbirth, medical or health care such as post-surgery images or self-examination, protest, or fine art such as a painting or sculpture.",
		exclusions: "Erotic posing, sexual focus or arousal, including a person posed on a bed or in a private setting with clothing pulled down, open or pushed aside to show the pubic area, buttocks or genitals; a sexual act; photographs or generated images presented as art to show nudity; pornographic drawings; any person who appears to be a minor. An educational or artistic label alone does not make erotic nudity non-erotic."
	},
	"sexual-text": {
		category: "sexual",
		kind: "context",
		displayName: "Text",
		description: "The content is text, not an image or video. It is set from the input type and never judged from the content.",
		exclusions: "Images and video, including readable text shown in them.",
		inputs: ["text"],
		fromInput: true
	},
	"sexual-historical": {
		category: "sexual",
		kind: "context",
		displayName: "Historical",
		description: "Qualifying content explicitly attributed to a supported past historical event.",
		exclusions: "An ordinary past-tense account, date, old-looking setting or historical topic alone; an unrelated current threat or request."
	},
	"sexual-documentary": {
		category: "sexual",
		kind: "context",
		displayName: "Reporting or documentary",
		description: "Qualifying content explicitly framed as factual reporting, testimony or documentation of actual real-world events or utterances, including a person's own incident report or a report to an authority.",
		exclusions: "Unframed descriptions, third-person narration or quotation marks alone; fictional stories, invented classroom examples, erotic display or advertisements. A separate direct harmful request, attack or endorsement cannot receive this allowance."
	},
	"sexual-educational": {
		category: "sexual",
		kind: "context",
		displayName: "Educational",
		description: "Qualifying content presented to teach or inform: a lesson, course or textbook material, a health, safety or clinical explanation, or academic study of the subject.",
		exclusions: "An educational label on a harmful request, working instructions or an endorsement; erotic, gratuitous or graphic detail beyond what the teaching needs; an academic tone alone."
	},
	"sexual-discussion": {
		category: "sexual",
		kind: "context",
		displayName: "Non-graphic discussion",
		description: "Qualifying content referenced non-graphically to make or examine an argument, comparison, ethical question or analysis, rather than to perform, endorse, threaten, eroticise or facilitate the harmful act.",
		exclusions: "Graphic bodily or explicit sexual detail; erotic presentation; actual threats, victim mockery, endorsement, promotion, practical harmful assistance or instructions, direct harmful requests or sexual solicitation."
	},
	"sexual-fictional": {
		category: "sexual",
		kind: "context",
		displayName: "Fictional",
		description: "Qualifying content clearly attributed to an invented character, fictional story, game, illustration, generated image or reenacted scene.",
		exclusions: "Missing or ambiguous fictional context; claiming fiction for a real-world threat or actionable harmful request."
	},
	"sexual-support-prevention": {
		category: "sexual",
		kind: "context",
		displayName: "Sexual harm support or prevention",
		description: "Qualifying content presented solely to seek or provide non-harmful support, prevention or recovery, including a survivor describing abuse to obtain help and counterspeech that explicitly rejects a represented attack or threat. A disclosure of current harm or risk can count when it is presented to seek help.",
		exclusions: "Harmful instructions, assistance, concealment advice, targeting or encouragement."
	},
	"violence-attack": {
		category: "violence",
		kind: "harm",
		displayName: "Physical attack",
		description: "A depicted or described physical attack against another person or animal, including a general or statistical statement that people were attacked or assaulted.",
		exclusions: "An injury or death without evidence of an attack; a threat, plan or encouragement alone; solely intentional self-injury."
	},
	"violence-threat": {
		category: "violence",
		kind: "harm",
		displayName: "Threat of violence",
		description: "A direct, conditional or clearly implied threat of physical harm against another person or animal.",
		exclusions: "A completed attack, figurative language or solely self-directed threats."
	},
	"violence-preparation": {
		category: "violence",
		kind: "harm",
		displayName: "Preparation or instructions",
		description: "A concrete plan or request to physically harm another person made by the author, or actionable harmful instructions actually supplied in the material.",
		exclusions: "A depiction, threat or praise alone; neutral reporting, prevention or lawful safety advice."
	},
	"violence-encouragement": {
		category: "violence",
		kind: "harm",
		displayName: "Encouragement of violence",
		description: "The author urges, endorses, praises or promotes physical violence.",
		exclusions: "Reporting or depicting an attack without endorsement; condemnation or prevention."
	},
	"violence-wish": {
		category: "violence",
		kind: "harm",
		harmOption: false,
		displayName: "Non-severe wish of harm",
		description: "The author wishes or hopes that a real person or group suffers non-severe physical harm, such as falling ill or catching a disease, even a serious one such as cancer, feeling pain or having a minor accident, without threatening it, planning it or calling on anyone to cause it.",
		exclusions: "Wishes that someone dies, is killed, attacked, seriously or permanently injured or sexually assaulted; threats, plans, requests or encouragement for others to cause harm; figurative curses such as telling someone to go choke on something; wishes of non-physical misfortune alone, such as losing a job or an election."
	},
	"violence-extremism": {
		category: "violence",
		kind: "harm",
		harmOption: false,
		displayName: "Violent extremism",
		description: "Support for terrorism or violent extremism by the author: propaganda, recruitment, fundraising, instructions or praise for a terrorist or violent extremist organisation, its leaders or its attacks, including glorifying attackers as heroes or martyrs; and perpetrator-produced attack footage or manifestos, however they are presented.",
		exclusions: "News, documentary, research, education, history or counterspeech that reports, explains or condemns terrorism without promoting it or reproducing perpetrator material; neutral mention of a group's name; fiction that does not promote a real organisation or attack; lawful political movements, protest and military conflict between states."
	},
	"violence-injury": {
		category: "violence",
		kind: "harm",
		harmOption: false,
		displayName: "Injury",
		description: "An actual bodily injury within independently qualifying Violence, such as an injury inflicted in an attack or shown with explicit disturbing bodily detail. Injury is descriptive and never establishes the parent category on its own.",
		exclusions: "An injury or medical condition without an independently qualifying attack, death, threat or graphic bodily depiction, regardless of severity; threats, plans, risks, weapons or pain without an actual injury; figurative language; solely intentional self-injury."
	},
	"violence-violent-death": {
		category: "violence",
		kind: "harm",
		displayName: "Violent death",
		description: "A depicted or described death caused by an attack, killing, accident or other physical trauma, or a dead body showing signs of violence. An attacker or intent to harm is not required.",
		exclusions: "A death from illness, old age or an unstated cause; a sudden or untimely death with no attack, accident or trauma stated; threats, plans, death wishes, risks or abstract discussion alone; figurative language; solely suicide."
	},
	"violence-natural-death": {
		category: "violence",
		kind: "harm",
		displayName: "Natural or non-violent death",
		description: "A depicted or described death from natural causes, illness, old age or an unstated cause, including a statement that someone has died or passed away, or a body with no signs of violence. A death is non-violent when no attack, accident or trauma is stated, even if it was sudden, untimely or unexplained.",
		exclusions: "A death that is stated to be caused by an attack, killing, accident or other physical trauma; death wishes, risks or abstract discussion of mortality alone; figurative language; solely suicide."
	},
	"violence-graphic": {
		category: "violence",
		kind: "harm",
		displayName: "Graphic detail",
		description: "Severe bodily injury or death shown or described with explicit disturbing bodily detail, such as exposed organs, dismemberment or gore. In images, visible open wounds and heavy bleeding are graphic too.",
		exclusions: "A threat or mention of violence without explicit disturbing bodily detail; in text, heavy bleeding, gashes, cuts, bruises or other serious injuries described without exposed tissue, bone or organs, mutilation or dismemberment; in images, modest blood or minor wounds; inferred or unseen injuries; solely intentional self-injury or suicide."
	},
	"violence-gore": {
		category: "violence",
		kind: "harm",
		displayName: "Excessive gore",
		description: "Gruesome bodily harm beyond graphic detail: dismembered, mutilated or decapitated bodies, exposed internal organs or bones, charred human remains, or an animal tortured or killed in gruesome detail.",
		exclusions: "Visible wounds, blood, burns or injuries without gruesome detail, which are Graphic detail; clinical or surgical images in a medical setting; ordinary hunting, fishing or food processing."
	},
	"violence-weapon": {
		category: "violence",
		kind: "harm",
		displayName: "Weapon without an attack",
		description: "A firearm, knife or other weapon shown as an object, or carried, held, drawn or aimed by people with no person or animal visibly on the receiving end: action poses, cover and poster art, game art, hunting and target shooting included. Aiming out of frame or at nothing visible is this kind, however tense the scene looks. When nothing else in the image is violent, the weapon is the whole of what the image shows.",
		exclusions: "A weapon aimed, fired or swung at a visible or identified person or animal, including two parties visibly aiming at each other; a visible victim, injury, death or graphic harm; ordinary tools, toys or props with no violent association.",
		inputs: ["image"]
	},
	"violence-sport": {
		category: "violence",
		kind: "harm",
		displayName: "Combat sport or training",
		description: "Recognizable consensual combat sport or protective training, such as boxing, martial arts, wrestling, fencing or self-defence practice, without graphic bodily detail or abusive conduct.",
		exclusions: "Graphic bodily detail, death, an attack outside the sport, abusive conduct or a non-consensual fight dressed as sport. A non-graphic sports injury alone does not invalidate the sport context.",
		inputs: ["image"]
	},
	"violence-text": {
		category: "violence",
		kind: "context",
		displayName: "Text",
		description: "The content is text, not an image or video. It is set from the input type and never judged from the content.",
		exclusions: "Images and video, including readable text shown in them.",
		inputs: ["text"],
		fromInput: true
	},
	"violence-historical": {
		category: "violence",
		kind: "context",
		displayName: "Historical",
		description: "Qualifying content explicitly attributed to a supported past historical event.",
		exclusions: "An ordinary past-tense account, date, old-looking setting or historical topic alone; an unrelated current threat or request."
	},
	"violence-documentary": {
		category: "violence",
		kind: "context",
		displayName: "Reporting or documentary",
		description: "Qualifying content explicitly framed as factual reporting, testimony or documentation of actual real-world events or utterances, including a person's own incident report or a report to an authority.",
		exclusions: "Unframed descriptions, third-person narration or quotation marks alone; fictional stories, invented classroom examples, erotic display or advertisements. A separate direct harmful request, attack or endorsement cannot receive this allowance."
	},
	"violence-educational": {
		category: "violence",
		kind: "context",
		displayName: "Educational",
		description: "Qualifying content presented to teach or inform: a lesson, course or textbook material, a health, safety or clinical explanation, or academic study of the subject.",
		exclusions: "An educational label on a harmful request, working instructions or an endorsement; erotic, gratuitous or graphic detail beyond what the teaching needs; an academic tone alone. A direct request, plan or question seeking to harm someone or commit a crime stays outside this kind even when a reply in the same conversation answers it informatively."
	},
	"violence-discussion": {
		category: "violence",
		kind: "context",
		displayName: "Non-graphic discussion",
		description: "Qualifying content referenced non-graphically to make or examine an argument, comparison, ethical question or analysis, or mentioned in passing, such as recalling that someone was shot, rather than to perform, endorse, threaten, eroticise or facilitate the harmful act.",
		exclusions: "Graphic bodily or explicit sexual detail; erotic presentation; actual threats, victim mockery, endorsement, promotion, practical harmful assistance or instructions, direct harmful requests or sexual solicitation. A direct request, plan or question seeking to harm someone or commit a crime stays outside this kind even when a reply in the same conversation answers it informatively."
	},
	"violence-fictional": {
		category: "violence",
		kind: "context",
		displayName: "Fictional",
		description: "Qualifying content clearly attributed to an invented character, fictional story, game, illustration, generated image or reenacted scene.",
		exclusions: "Missing or ambiguous fictional context; claiming fiction for a real-world threat or actionable harmful request."
	},
	"violence-fantasy": {
		category: "violence",
		kind: "context",
		displayName: "Fantasy or cartoon violence",
		description: "Unrealistic or stylised violence, such as cartoon, fantasy or game combat, slapstick, or defeating creatures, monsters or characters, with no realistic injury or blood.",
		exclusions: "Realistic violence against people, including shootings or killings in a story whose plot or characters are clichéd, exaggerated or caricatured, since only the violence itself being unrealistic makes it fantasy; realistic blood or injury, killing presented realistically, torture or sexual violence, and any depiction or recreation of a real-world attack, war crime, genocide, terrorist attack or mass shooting, even when animated or in a game."
	},
	"violence-support-prevention": {
		category: "violence",
		kind: "context",
		displayName: "Support or prevention",
		description: "Qualifying content presented solely to seek or provide non-harmful support, prevention or recovery, including a survivor describing abuse to obtain help and counterspeech that explicitly rejects a represented attack or threat. A disclosure of current harm or risk can count when it is presented to seek help.",
		exclusions: "Harmful instructions, assistance, concealment advice, targeting or encouragement."
	},
	"self-harm-thoughts": {
		category: "self-harm",
		kind: "harm",
		displayName: "Thoughts or desire",
		description: "Current or recurring thoughts of intentional self-injury or suicide, or an explicitly expressed desire to die.",
		exclusions: "General sadness, figurative language, neutral statistics, resolved past thoughts or prevention alone. An image without readable disclosure does not establish thoughts."
	},
	"self-harm-preparation": {
		category: "self-harm",
		kind: "harm",
		displayName: "Intent or preparation",
		description: "Expressed intent, preparation or a plan for intentional self-injury or suicide.",
		exclusions: "General distress, an injury without self-directed intent or a report or prevention discussion without any represented intent, preparation or plan."
	},
	"self-harm-act": {
		category: "self-harm",
		kind: "harm",
		displayName: "Depicted or reported act",
		description: "A depicted or described act of intentional self-injury or suicide.",
		exclusions: "Accidental injuries, healed scars, recovery or an injury with unknown cause alone."
	},
	"self-harm-methods": {
		category: "self-harm",
		kind: "harm",
		displayName: "Methods or instructions",
		description: "Actionable methods, requests or practical instructions for intentional self-injury or suicide.",
		exclusions: "Prevention, support, recovery or non-actionable discussion without harmful methods."
	},
	"self-harm-encouragement": {
		category: "self-harm",
		kind: "harm",
		displayName: "Encouragement",
		description: "The author urges, endorses, praises or promotes intentional self-injury or suicide.",
		exclusions: "Support, prevention, condemnation or reporting without endorsement."
	},
	"self-harm-historical": {
		category: "self-harm",
		kind: "context",
		displayName: "Historical",
		description: "Qualifying content explicitly attributed to a supported historical event.",
		exclusions: "Ordinary past tense, a date or an old-looking setting alone; a separate current harmful request or endorsement."
	},
	"self-harm-documentary": {
		category: "self-harm",
		kind: "context",
		displayName: "Reporting or documentary",
		description: "Qualifying content explicitly framed as factual reporting, testimony or documentation of actual real-world events or utterances, including a person's own incident report or a report to an authority.",
		exclusions: "Unframed descriptions, third-person narration or quotation marks alone; fictional stories, invented classroom examples, erotic display or advertisements. A separate direct harmful request, attack or endorsement cannot receive this allowance."
	},
	"self-harm-educational": {
		category: "self-harm",
		kind: "context",
		displayName: "Educational",
		description: "Qualifying content presented to teach or inform: a lesson, course or textbook material, a health, safety or clinical explanation, or academic study of the subject.",
		exclusions: "An educational label on a harmful request, working instructions or an endorsement; erotic, gratuitous or graphic detail beyond what the teaching needs; an academic tone alone."
	},
	"self-harm-fictional": {
		category: "self-harm",
		kind: "context",
		displayName: "Fictional",
		description: "Qualifying content clearly attributed to an invented character, fictional story, game, illustration, generated image or reenacted scene.",
		exclusions: "Missing or ambiguous fictional context; claiming fiction for a real-world threat or actionable harmful request."
	},
	"self-harm-support-prevention": {
		category: "self-harm",
		kind: "context",
		displayName: "Support or prevention",
		description: "Qualifying content presented solely to seek or provide non-harmful support, prevention or recovery, including a survivor describing abuse to obtain help and counterspeech that explicitly rejects a represented attack or threat. A disclosure of current harm or risk can count when it is presented to seek help.",
		exclusions: "Harmful instructions, assistance, concealment advice, targeting or encouragement."
	},
	"harassment-abuse": {
		category: "harassment",
		kind: "harm",
		displayName: "Insults or humiliation",
		description: "Insults, contemptuous name-calling such as idiot, moron, loser or pathetic, swearing at someone to dismiss or attack them, humiliation or degrading treatment aimed at a person or at a group that is not a protected identity group.",
		exclusions: "Dislike or anger without an attack, such as “I hate you”; disagreement or criticism of conduct or competence; untargeted profanity and profane praise; a remark with no identifiable or addressed target, such as an unnamed “someone”; a made-up or hypothetical quote illustrating a joke or observation, aimed at no real person; describing a view or insult someone else holds, such as “you think they are traitors”, which is not the speaker insulting anyone; an insult or generalisation about a protected identity group as a whole, such as women, Muslims or Africans, which is Hate unless a specific person is also attacked. Hyperbole or satire about a public figure’s character, conduct or followers, such as saying they would sell their own mother, without contemptuous name-calling, is Mild mockery or teasing. Sarcasm, mocking nicknames, mild name-calling such as fool or dummy, and a joking comparison such as likening people to an animal in a funny photo or meme, without insulting words or a claim that they are worthless or subhuman, are Mild mockery or teasing, and threats are Threats or intimidation."
	},
	"harassment-mild": {
		category: "harassment",
		kind: "harm",
		displayName: "Mild mockery or teasing",
		description: "Light ridicule, teasing, sarcasm, a mocking nickname or mild name-calling such as fool, dummy or silly, aimed at a person, including a public figure, or at a group that is not a protected identity group (a club, a team’s fans, a political party or its members), without contempt, degradation or threats. Hyperbole or satire about a public figure’s character, conduct or followers is included, and so is a meme whose comparison comes from its picture or a pictured character’s line, such as an animal guarding its “garbage”, when no one is directly called an insulting name. It counts so that a policy can allow or restrict it.",
		exclusions: "Contemptuous name-calling such as idiot, moron, loser or pathetic, degrading insults, slurs, threats, sexual remarks, bullying or victim mockery, which are other forms; name-calling of a protected identity group, which is Hate; criticism of an argument, decision or conduct without mocking the people; self-deprecation and untargeted jokes; affectionate teasing between people on good terms; telling someone not to call another person a name."
	},
	"harassment-bullying": {
		category: "harassment",
		kind: "harm",
		displayName: "Bullying or abuse",
		description: "Repeated or sustained targeting of a person, ganging up on them, excluding or shutting them out, or abuse or coercive control by a partner, family member or someone else in an ongoing relationship.",
		exclusions: "A single insult or remark without repeated targeting, exclusion or an ongoing abusive relationship, which is Insults or humiliation; a one-off fight or assault by someone with no ongoing relationship to the victim."
	},
	"harassment-public-target": {
		category: "harassment",
		kind: "target",
		displayName: "Aimed at a public figure or group",
		description: "The qualifying harassment is aimed at a public figure (an elected official or political candidate, a celebrity, a person with a large public following or a person in the news for their public role), an organisation or institution, or a group that is not a protected identity group (a club, a team’s fans, a political party or its members), rather than at a private individual.",
		exclusions: "Private individuals, including a named or addressed member of the public, a fellow user, a classmate, a colleague or a family member; any minor, even a well-known one; people known only for an involuntary moment in the news; protected identity groups, which belong under Hate."
	},
	"harassment-threat": {
		category: "harassment",
		kind: "harm",
		displayName: "Threats or intimidation",
		description: "A direct, conditional or clearly implied personal threat, or serious abusive or coercive intimidation, against an identifiable person or group. Violent rhetoric between groups belongs under Hate or Violence.",
		exclusions: "Figures of speech; ordinary disagreement or criticism; lawful arrest, prosecution or accountability without abusive intimidation."
	},
	"harassment-sexual": {
		category: "harassment",
		kind: "harm",
		displayName: "Sexual harassment",
		description: "Targeted unwanted sexual remarks, sexual humiliation, coercive advances or sexually abusive intimidation.",
		exclusions: "Consensual sexual dialogue, ordinary romance or sexual content without targeted harassment."
	},
	"harassment-encouragement": {
		category: "harassment",
		kind: "harm",
		displayName: "Encouraging harassment",
		description: "The author urges, organises, praises or endorses targeted abuse of a person.",
		exclusions: "Reporting or condemning abuse, or lawfully asking for accountability, without endorsing abuse."
	},
	"harassment-historical": {
		category: "harassment",
		kind: "context",
		displayName: "Historical",
		description: "Qualifying content explicitly attributed to a supported historical event.",
		exclusions: "Ordinary past tense, a date or an old-looking setting alone; a separate current harmful request or endorsement."
	},
	"harassment-documentary": {
		category: "harassment",
		kind: "context",
		displayName: "Reporting or documentary",
		description: "Qualifying content explicitly framed as factual reporting, testimony or documentation of actual real-world events or utterances, including a person's own incident report or a report to an authority.",
		exclusions: "Unframed descriptions, third-person narration or quotation marks alone; fictional stories, invented classroom examples, erotic display or advertisements. A separate direct harmful request, attack or endorsement cannot receive this allowance."
	},
	"harassment-educational": {
		category: "harassment",
		kind: "context",
		displayName: "Educational",
		description: "Qualifying content used in a lesson, safety explanation, clinical explanation or academic study.",
		exclusions: "An educational label on a direct harmful request or endorsement; actual actionable harmful instructions remain instructions even inside teaching material."
	},
	"harassment-fictional": {
		category: "harassment",
		kind: "context",
		displayName: "Fictional",
		description: "Qualifying harassment between invented characters in a clearly fictional story, comic, cartoon, game or roleplay, such as one character insulting, threatening, bullying or scheming against another, with no real or addressed person as its target.",
		exclusions: "Missing or ambiguous fictional context: quotation marks, verse, an unattributed fragment or third-person narration alone do not make content fiction. Harassment aimed at a real person, the reader or an addressed participant rather than their character; sexual harassment of a real or addressed participant; a thin fictional cover for attacking someone real, such as a story mocking a named classmate. Memes, satire, caricatures and generated images about a real person, public figure or group, and photographs of real people, including staged or stock photos, are not fiction."
	},
	"harassment-support-prevention": {
		category: "harassment",
		kind: "context",
		displayName: "Awareness, support or prevention",
		description: "Qualifying content presented solely to raise awareness of bullying or abuse, give prevention or safety guidance, or seek or provide support to someone targeted, such as an anti-bullying campaign or a person asking for help.",
		exclusions: "A separate direct abusive attack, advice to retaliate, or an awareness label on content that itself abuses a person. A reported abusive instance used to seek help or prevent abuse is not a separate direct attack."
	},
	"hate-abuse": {
		category: "hate",
		kind: "harm",
		displayName: "Identity-based insults or slurs",
		description: "Identity-based insults or slurs against people, including ones that are quoted or reported.",
		exclusions: "Mentioning an identity, untargeted profanity, or discussing a word without attacking people."
	},
	"hate-slurs": {
		category: "hate",
		kind: "harm",
		displayName: "Offensive slurs",
		description: "Identity-based attacks that use a recognised offensive identity slur, including censored or disguised spellings, whether used, quoted, reported, historical, fictional or taught.",
		exclusions: "Neutral identity words, general insults about a people that are not slurs, and discussing a slur’s history or meaning without attacking anyone."
	},
	"hate-dehumanization": {
		category: "hate",
		kind: "harm",
		displayName: "Dehumanization",
		description: "The author claims or endorses that people with a protected identity are subhuman, animals, vermin or objects.",
		exclusions: "Literal descriptions, unrelated metaphors, and reporting or condemning someone else’s dehumanizing words."
	},
	"hate-inferiority": {
		category: "hate",
		kind: "harm",
		displayName: "Inferiority or harmful stereotypes",
		description: "A claim that people are inherently inferior, or a harmful stereotype or generalisation that they are criminal, violent, dangerous, dishonest or immoral, because of a protected identity, including quoted or reported claims.",
		exclusions: "Describing differences in income, opportunity, treatment, representation or outcomes between groups without claiming a group is inferior; criticism of beliefs or conduct; a claim about particular people that does not extend to their group."
	},
	"hate-exclusion": {
		category: "hate",
		kind: "harm",
		displayName: "Exclusion or discrimination",
		description: "The author advocates or endorses denying rights to, or excluding, people because of a protected identity.",
		exclusions: "Reporting, criticising a policy, or lawful distinctions that attack no identity."
	},
	"hate-symbol": {
		category: "hate",
		kind: "harm",
		displayName: "Hate symbol",
		description: "A recognised hate emblem, slogan or gesture with supported hateful meaning, such as a Nazi swastika, including one shown in a factual report or counter-hate material, with no other attack on a protected group.",
		exclusions: "Ordinary religious or cultural symbols, similar shapes, ambiguous marks, a colour scheme alone or a discussion displaying no actual hate emblem; a Confederate flag on its own, without slurs, threats, other hate emblems or an identity-based attack; a dehumanizing depiction, slur or other attack, which are other forms.",
		inputs: ["image"]
	},
	"hate-hostility": {
		category: "hate",
		kind: "harm",
		displayName: "Stated hatred",
		description: "Hatred, dislike or hostility stated towards a protected identity group as a whole, such as saying “I hate men”, with no slur, insult or epithet, dehumanization, inferiority claim or harmful stereotype, exclusion or threat. It counts so that a policy can allow or restrict it.",
		exclusions: "Slurs, identity-based insults or epithets such as calling a group disgusting or repulsive, dehumanization, inferiority claims or harmful stereotypes, exclusion and threats, which are other forms; dislike of particular people; dislike of something a group does, such as “I hate how they …”; sarcastic or ironic praise; criticism of beliefs, ideologies or conduct."
	},
	"hate-threat": {
		category: "hate",
		kind: "harm",
		displayName: "Threats or incitement",
		description: "The author threatens or endorses serious harm against people because of a protected identity.",
		exclusions: "Threats unrelated to identity, an unsupported identity motive, reporting or condemning someone else’s threat, and lawful accountability."
	},
	"hate-historical": {
		category: "hate",
		kind: "context",
		displayName: "Historical",
		description: "Qualifying content explicitly attributed to a supported past historical event.",
		exclusions: "An ordinary past-tense account, date, old-looking setting or historical topic alone; an unrelated current threat or request."
	},
	"hate-documentary": {
		category: "hate",
		kind: "context",
		displayName: "Reporting or documentary",
		description: "Qualifying content explicitly framed as factual reporting, testimony or documentation of actual real-world events or utterances, including a person's own incident report or a report to an authority.",
		exclusions: "Unframed descriptions, third-person narration or quotation marks alone; fictional stories, invented classroom examples, erotic display or advertisements. A separate direct harmful request, attack or endorsement cannot receive this allowance."
	},
	"hate-educational": {
		category: "hate",
		kind: "context",
		displayName: "Educational",
		description: "Qualifying content used in a lesson, safety explanation, clinical explanation or academic study.",
		exclusions: "An educational label on a direct harmful request or endorsement; actual actionable harmful instructions remain instructions even inside teaching material."
	},
	"hate-fictional": {
		category: "hate",
		kind: "context",
		displayName: "Fictional",
		description: "Qualifying content clearly attributed to an invented character, fictional story, game, illustration, generated image or reenacted scene.",
		exclusions: "Missing or ambiguous fictional context; claiming fiction for a real-world threat or actionable harmful request."
	},
	"hate-counterspeech": {
		category: "hate",
		kind: "context",
		displayName: "Counterspeech",
		description: "Concrete identity-based attacks quoted, paraphrased or described to reject, challenge or oppose their prejudice, including defending the people targeted and explaining why discriminatory claims are wrong.",
		exclusions: "Mere quotation, neutral documentation or victim support without challenging the represented prejudice; an unrelated statement opposing hate that leaves a separate identity-based attack endorsed or directly expressed."
	},
	"hate-support-prevention": {
		category: "hate",
		kind: "context",
		displayName: "Awareness, support or prevention",
		description: "Qualifying content used to raise awareness, give practical prevention or safety guidance, or seek or provide support to people targeted by hate. Challenging a prejudiced claim is assessed separately as Counterspeech; both qualifiers may apply when the material also supports victims or provides prevention guidance.",
		exclusions: "A separate directly expressed identity attack or endorsement, or an awareness label on content that itself attacks a protected group. A concrete reported or condemned attack used to counter hate is not a separate direct attack."
	},
	"criminal-activity-demonstration": {
		category: "criminal-activity",
		kind: "harm",
		displayName: "Depicted or reported activity",
		description: "A depiction or account of a concrete violent or seriously dangerous criminal act, including a factual report of an actual act. A non-violent offence that endangers no one, such as theft or burglary, does not qualify on its own.",
		exclusions: "A topic mention, ordinary objects, abstract policy debate or unsupported inference without a concrete criminal or seriously dangerous act."
	},
	"criminal-activity-preparation": {
		category: "criminal-activity",
		kind: "harm",
		displayName: "Intent or preparation",
		description: "A concrete intent, preparation or plan for a criminal or seriously dangerous act expressed by the author.",
		exclusions: "Vague danger, ordinary activities with incidental risk, neutral reporting or lawful preparation. Lawful adult alcohol, tobacco/vaping or gambling activity without separate criminal or seriously dangerous conduct. Consensual adult sexual solicitation alone, without separate criminal or seriously dangerous conduct."
	},
	"criminal-activity-request": {
		category: "criminal-activity",
		kind: "harm",
		displayName: "Requests for assistance",
		description: "A request by the author for help carrying out a concrete criminal or seriously dangerous act, or for help evading detection, consequences or accountability for one, such as how to get away with it. A later refusal does not erase that request.",
		exclusions: "Lawful assistance, neutral reporting, prevention or requests without a concrete criminal or seriously dangerous act. Lawful adult alcohol, tobacco/vaping or gambling activity without separate criminal or seriously dangerous conduct. Consensual adult sexual solicitation alone, without separate criminal or seriously dangerous conduct."
	},
	"criminal-activity-instructions": {
		category: "criminal-activity",
		kind: "harm",
		displayName: "Instructions or facilitation",
		description: "Actionable instructions, practical assistance or facilitation for a concrete criminal or seriously dangerous act, including how to evade detection, consequences or accountability for one.",
		exclusions: "Prevention, lawful safety advice, ordinary tools or non-actionable reporting alone. Lawful adult alcohol, tobacco/vaping or gambling activity without separate criminal or seriously dangerous conduct. Consensual adult sexual solicitation alone, without separate criminal or seriously dangerous conduct."
	},
	"criminal-activity-promotion": {
		category: "criminal-activity",
		kind: "harm",
		displayName: "Recruitment or promotion",
		description: "The author recruits for, endorses or promotes a concrete criminal or seriously dangerous act.",
		exclusions: "Neutral reporting, condemnation, lawful advocacy or vague dangerous references. Lawful adult alcohol, tobacco/vaping or gambling activity without separate criminal or seriously dangerous conduct. Consensual adult sexual solicitation alone, without separate criminal or seriously dangerous conduct."
	},
	"criminal-activity-substances": {
		category: "criminal-activity",
		kind: "harm",
		displayName: "Drugs and controlled substances",
		description: "Illegal drugs or controlled substances: their use, preparation, purchase, sale, production or trafficking, including prescription medicines obtained, sold or used outside lawful medical supply.",
		exclusions: "Medication prescribed and used as directed, lawful medical supply, ordinary pharmacy, research or educational scenes without an actual illegal-drug instance, lawful alcohol and tobacco, and crimes that do not involve drugs. An actual illegal-drug instance remains detectable in reporting, harm reduction or recovery; framing is separate."
	},
	"criminal-activity-grooming": {
		category: "criminal-activity",
		kind: "harm",
		displayName: "Grooming and exploitation",
		description: "Concrete manipulation to prepare a child or vulnerable person for sexual exploitation or abuse, including sexual demands, rewards conditional on sexual compliance, or secrecy, isolation or private-contact tactics with a supported exploitative purpose. Explicit sexual words are not required when that purpose is evidenced. Actual reported or fictional grooming also counts.",
		exclusions: "Ordinary friendly contact, consensual adult relationships, gifts, mentoring, private messaging or secrecy alone. Generic grooming warnings or references to an omitted case without concrete exploitative conduct. Hair care and animal grooming."
	},
	"criminal-activity-csam": {
		category: "criminal-activity",
		kind: "harm",
		harmOption: false,
		displayName: "Child sexual abuse material",
		description: "Child sexual abuse material or child sexual exploitation material, whether merely named or referred to or present as an actual instance of it being created, possessed, viewed, sought, bought, sold, shared, distributed or profited from, including requests and plans. A bare mention counts so that a policy can restrict it; conduct qualifiers such as Demonstration or Request record an actual instance. Reported, historical, fictional, educational and preventive instances also count.",
		exclusions: "Adult sexual material. Lawful non-sexual images of children. Child abuse that is not sexual material, and grooming conduct without material, are separate forms. The words must refer to sexual material involving children.",
		inputs: ["text"]
	},
	"criminal-activity-alcohol": {
		category: "criminal-activity",
		kind: "harm",
		displayName: "Alcohol",
		description: "Depicted or concretely described drinking, serving, purchasing, selling, making or advertising alcoholic drinks, including lawful adult activity and actual reported, historical or fictional instances.",
		exclusions: "A separate crime or seriously dangerous act, even if it involves these products or activities, does not meet this form: e.g. impaired driving, supplying minors illegally, fraud, coercion or exploitation. The word alcohol alone, generic health or prevention discussion without an actual qualifying instance, non-alcoholic drinks, hand sanitiser, disinfectants, laboratory alcohol and ordinary medicine."
	},
	"criminal-activity-tobacco": {
		category: "criminal-activity",
		kind: "harm",
		displayName: "Tobacco and vaping",
		description: "Depicted or concretely described smoking, vaping, chewing tobacco, or purchasing, selling, making or advertising tobacco, nicotine or vaping products, including lawful adult activity and actual reported, historical or fictional instances.",
		exclusions: "A separate crime or seriously dangerous act, even if it involves these products or activities, does not meet this form: e.g. impaired driving, supplying minors illegally, fraud, coercion or exploitation. Generic health or prevention discussion without an actual qualifying instance, cessation treatment such as nicotine patches or gum used as directed, smoke without a supported tobacco or vaping source, and illegal-drug use without a separate tobacco or vaping instance."
	},
	"criminal-activity-gambling": {
		category: "criminal-activity",
		kind: "harm",
		displayName: "Gambling",
		description: "Depicted or concretely described betting or wagering money or something of real value on an uncertain outcome, casino gambling, paid lotteries, or selling or advertising those services, including lawful adult activity and actual reported, historical or fictional instances.",
		exclusions: "A separate crime or seriously dangerous act, even if it involves these products or activities, does not meet this form: e.g. impaired driving, supplying minors illegally, fraud, coercion or exploitation. Ordinary games, sports, playing cards or dice without stakes, free competitions without a wager, investing without gambling conduct, figurative bets and generic risk or prevention discussion without an actual gambling instance."
	},
	"criminal-activity-fraud": {
		category: "criminal-activity",
		kind: "harm",
		displayName: "Fraud and scams",
		description: "Fraud, scams or phishing: a deceptive message that seeks money, account access, credentials or personal details, such as an advance-fee or romance scam, a fake prize, invoice or delivery notice, impersonation of a bank or official, or counterfeit goods or payment fraud, whether carried out, planned, requested, taught or promoted.",
		exclusions: "Generic warnings or prevention advice without a concrete scam, a genuine request for payment or details, or crimes without deception for gain. A concrete reported scam or a displayed phishing example retains this form; framing is separate."
	},
	"criminal-activity-sexual-solicitation": {
		category: "criminal-activity",
		kind: "harm",
		displayName: "Sexual solicitation",
		description: "An explicit request, offer or advertisement for consensual adult sexual activity or sexual services, including paid services. This policy category includes solicitation without inferring that it is illegal.",
		exclusions: "Dating, ordinary romance, discussion of sex work without solicitation, vague offers without sexual content, coercion, trafficking, exploitation or sexual activity involving minors. Separate criminal assistance is not covered by this qualifier."
	},
	"criminal-activity-graffiti": {
		category: "criminal-activity",
		kind: "harm",
		displayName: "Graffiti",
		description: "Graffiti, tagging or spray-painted markings on walls, vehicles or other property, or people applying them, shown, planned or requested. Permission is rarely visible, so authorised murals and street art count too.",
		exclusions: "Painting or drawing on canvas, paper or screens; removal, cleaning or prevention of graffiti; other property damage.",
		inputs: ["image"]
	},
	"criminal-activity-historical": {
		category: "criminal-activity",
		kind: "context",
		displayName: "Historical",
		description: "Qualifying content explicitly attributed to a supported historical event.",
		exclusions: "Ordinary past tense, a date or an old-looking setting alone; a separate current harmful request or endorsement."
	},
	"criminal-activity-documentary": {
		category: "criminal-activity",
		kind: "context",
		displayName: "Reporting or documentary",
		description: "Qualifying content explicitly framed as factual reporting, testimony or documentation of actual real-world events or utterances, including a person's own incident report or a report to an authority.",
		exclusions: "Unframed descriptions, third-person narration or quotation marks alone; fictional stories, invented classroom examples, erotic display or advertisements. A separate direct harmful request, attack or endorsement cannot receive this allowance."
	},
	"criminal-activity-educational": {
		category: "criminal-activity",
		kind: "context",
		displayName: "Educational",
		description: "Qualifying content used in a lesson, safety explanation, clinical explanation or academic study.",
		exclusions: "A plain factual description or text card without a supported teaching, clinical or academic purpose. An educational label on a direct harmful request or endorsement; actual actionable harmful instructions remain instructions even inside teaching material. A direct request, plan or question seeking to harm someone or commit a crime stays outside this kind even when a reply in the same conversation answers it informatively."
	},
	"criminal-activity-discussion": {
		category: "criminal-activity",
		kind: "context",
		displayName: "Non-graphic discussion",
		description: "Qualifying content referenced non-graphically to make or examine an argument, comparison, ethical question or analysis, rather than to perform, endorse, threaten, eroticise or facilitate the harmful act.",
		exclusions: "Graphic bodily or explicit sexual detail; erotic presentation; actual threats, victim mockery, endorsement, promotion, practical harmful assistance or instructions, direct harmful requests or sexual solicitation. A direct request, plan or question seeking to harm someone or commit a crime stays outside this kind even when a reply in the same conversation answers it informatively."
	},
	"criminal-activity-fictional": {
		category: "criminal-activity",
		kind: "context",
		displayName: "Fictional",
		description: "Qualifying content clearly attributed to an invented character, fictional story, game, illustration, generated image or reenacted scene.",
		exclusions: "Missing or ambiguous fictional context; claiming fiction for a real-world threat or actionable harmful request."
	},
	"criminal-activity-support-prevention": {
		category: "criminal-activity",
		kind: "context",
		displayName: "Harm reduction, recovery or prevention",
		description: "Qualifying content presented solely to prevent crime or reduce harm, seek or provide victim support, explicitly oppose a represented criminal attack or threat, or aid recovery: for example anti-scam guidance describing an actual scam, support after fraud or stalking, and harm reduction or addiction recovery describing illegal drug use. The underlying qualifying act must be present; generic safety advice alone does not create criminal content.",
		exclusions: "Practical assistance, instructions, concealment advice, promotion or sales facilitating crime or harmful acts; a supportive label on content that itself carries out, requests or encourages the act. Protective steps such as contacting support or reporting a scam are not criminal assistance."
	}
};
const MODERATION_QUALIFIERS = Object.keys(MODERATION_QUALIFIER_INFO);
const MODERATION_QUALIFIERS_BY_CATEGORY = MODERATION_QUALIFIERS.reduce((groups, qualifier) => {
	(groups[MODERATION_QUALIFIER_INFO[qualifier].category] ??= []).push(qualifier);
	return groups;
}, {});
const getModerationQualifiers = (category) => MODERATION_QUALIFIERS_BY_CATEGORY[category] ?? [];
// packages/shared/src/PolicyRule.ts
/**
* What a policy does with content: deliver it (`allow`), deliver it but mark it so your app
* reduces its reach (`limit`), keep it off its plain URL so your app limits it to adults
* (`age-restrict`: signed URLs, API keys or `allowAgeRestricted=true`), stop delivering it
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
	when: zod.array(zod.enum(MODERATION_QUALIFIERS)).min(1).max(MODERATION_QUALIFIERS.length).refine((v) => new Set(v).size === v.length, "Qualifiers must be unique").meta({ description: whenDescription }),
	match: zod.literal("all").optional().meta({ description: "All selected qualifiers must describe the same qualifying instance. If supplied, must be all." }),
	unless: zod.array(zod.enum(MODERATION_QUALIFIERS)).min(1).max(MODERATION_QUALIFIERS.length).refine((v) => new Set(v).size === v.length, "Qualifiers must be unique").optional().meta({ description: "Exclude instances covered by any of these qualifiers from this rule. Does not exempt other content or other categories." }),
	action: FLAGGED_CONTENT_ACTION_SCHEMA.meta({ description: actionDescription })
}).strict().refine((rule) => !rule.unless || !rule.when.some((qualifier) => rule.unless.includes(qualifier)), {
	message: "The exclusions prevent this rule from ever matching",
	path: ["unless"]
});
const POLICY_ALLOWANCE_SCHEMA = policyRuleSchema("Qualifiers describing the content this allowance covers. Every selected qualifier must hold on the same instance. Eligible allowances may jointly cover all qualifying content.", "Softer than the category action: what happens to content the allowance covers.").refine((rule) => !rule.unless?.length, {
	message: "Only restrictions can have exclusions",
	path: ["unless"]
});
/** Acts when one qualifying instance meets every selected qualifier and no exclusion. */
const POLICY_RESTRICTION_SCHEMA = policyRuleSchema("Qualifiers describing restricted content. Every selected qualifier must hold on the same instance. One matching qualifying instance can trigger this restriction.", "Any action except `allow`, including one weaker than the category action.");
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
			zod.object({ kind: zod.literal("disabled") }).strict(),
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
			enabled: zod.boolean().optional(),
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
			"platform-restriction"
		]),
		action: FLAGGED_CONTENT_ACTION_SCHEMA.exclude(["allow"]).nullable(),
		flaggedCategories: zod.array(CLASSIFICATION_CATEGORY_SCHEMA)
	}).strict().optional().describe("The automatic asset decision, including a per-asset action override, a decision inherited from children, a block from a hash list match, or a block from a platform restriction that every policy includes.")
}).strict();
const CLASSIFICATION_LABEL_SCHEMA = zod.object({
	description: saneStringField(),
	score: zod.number(),
	topicalityScore: zod.number().nullish(),
	likelihood: LIKELIHOOD_SCHEMA,
	knowledgeBaseId: saneStringField().nullish()
});
const CLASSIFICATION_REPORT_SCHEMA = zod.object({
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
const TEST_IMAGE_PALETTES = {
	"personal-information": [
		[
			8,
			145,
			178,
			255
		],
		[
			6,
			182,
			212,
			255
		],
		[
			14,
			116,
			144,
			255
		],
		[
			103,
			232,
			249,
			255
		]
	],
	profanity: [
		[
			194,
			65,
			12,
			255
		],
		[
			234,
			88,
			12,
			255
		],
		[
			249,
			115,
			22,
			255
		],
		[
			253,
			186,
			116,
			255
		]
	],
	sexual: [
		[
			255,
			20,
			147,
			255
		],
		[
			255,
			105,
			180,
			255
		],
		[
			199,
			21,
			133,
			255
		],
		[
			255,
			69,
			0,
			255
		]
	],
	violence: [
		[
			139,
			0,
			0,
			255
		],
		[
			220,
			20,
			60,
			255
		],
		[
			178,
			34,
			34,
			255
		],
		[
			255,
			0,
			0,
			255
		]
	],
	harassment: [
		[
			180,
			83,
			9,
			255
		],
		[
			217,
			119,
			6,
			255
		],
		[
			245,
			158,
			11,
			255
		],
		[
			251,
			191,
			36,
			255
		]
	],
	hate: [
		[
			30,
			64,
			175,
			255
		],
		[
			37,
			99,
			235,
			255
		],
		[
			59,
			130,
			246,
			255
		],
		[
			96,
			165,
			250,
			255
		]
	],
	"criminal-activity": [
		[
			6,
			95,
			70,
			255
		],
		[
			5,
			150,
			105,
			255
		],
		[
			16,
			185,
			129,
			255
		],
		[
			52,
			211,
			153,
			255
		]
	],
	"self-harm": [
		[
			75,
			0,
			130,
			255
		],
		[
			138,
			43,
			226,
			255
		],
		[
			72,
			61,
			139,
			255
		],
		[
			147,
			112,
			219,
			255
		]
	]
};
/** A project's test input key: 32 hexadecimal characters only its members can see. */
const TEST_INPUT_KEY_PATTERN = /^[a-f0-9]{32}$/;
const TEXT_CODE_SIGNALS = [...CLASSIFICATION_CATEGORIES, "sexual.involving-minors"];
/** A 128-bit, domain-separated tag; published samples never contain the project key. */
const getTestInputTag = async (kind, signal, testInputKey) => {
	if (!TEST_INPUT_KEY_PATTERN.test(testInputKey)) throw new TypeError("Invalid test input key");
	return (await hmacSha256Hex(testInputKey, `calmlens-test:${kind}:${signal}`)).slice(0, 32);
};
/** A category-specific text code authenticated with the project's secret key. */
const generateTestTextCode = async (category, testInputKey) => TEXT_CODE_SIGNALS.includes(category) ? `<!calmlens-test ${await getTestInputTag("text", category, testInputKey)} ${category}>` : "";
const TEST_TRIGGER_PATTERN = /<!calmlens-test\s+([a-f0-9]{32})\s+(sexual|violence|self-harm|harassment|hate|criminal-activity|personal-information|profanity|sexual\.involving-minors)\s*>/gi;
/** Accept only category tags authenticated by this project's key. */
const detectTestTrigger = async (text, testInputKey) => {
	const signals = [];
	if (!TEST_INPUT_KEY_PATTERN.test(testInputKey)) return {
		isTestTrigger: false,
		signals
	};
	for (const [, tag, signal] of text.matchAll(TEST_TRIGGER_PATTERN)) {
		const testSignal = signal.toLowerCase();
		if (timingSafeEqual(tag.toLowerCase(), await getTestInputTag("text", testSignal, testInputKey)) && !signals.includes(testSignal)) signals.push(testSignal);
	}
	return {
		isTestTrigger: signals.length > 0,
		signals
	};
};
/** Sixty-four cells encode a 128-bit tag using the category's four colours. */
const getTestImageKeyCells = (width, height) => {
	return Array.from({ length: 64 }, (_, index) => {
		const column = index % 8;
		const row = Math.floor(index / 8);
		const x = Math.floor(column * width / 8);
		const y = Math.floor(row * height / 8);
		return {
			x,
			y,
			width: Math.floor((column + 1) * width / 8) - x,
			height: Math.floor((row + 1) * height / 8) - y
		};
	});
};
const getTestImageKeyColors = async (signal, testInputKey) => {
	const colors = TEST_IMAGE_PALETTES[signal];
	if (!colors || !TEST_INPUT_KEY_PATTERN.test(testInputKey)) throw new Error("Invalid image test signal or key");
	return [...await getTestInputTag("image", signal, testInputKey)].flatMap((character) => {
		const value = Number.parseInt(character, 16);
		return [colors[value >> 2], colors[value & 3]];
	});
};
/**
* Gets all test trigger categories that support images
*/
const getImageTestCategories = () => {
	return Object.keys(TEST_IMAGE_PALETTES);
};
/** Paint a full-image 8×8 grid as RGBA pixels; callers choose their image encoder. */
const paintTestImage = async (signal, testInputKey, width = 512, height = width) => {
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 24 || height < 24) throw new RangeError("Test image dimensions must be integers of at least 24 pixels");
	const colors = await getTestImageKeyColors(signal, testInputKey);
	const rgba = new Uint8Array(width * height * 4);
	getTestImageKeyCells(width, height).forEach((cell, index) => {
		for (let y = cell.y; y < cell.y + cell.height; y++) for (let x = cell.x; x < cell.x + cell.width; x++) rgba.set(colors[index], (y * width + x) * 4);
	});
	return rgba;
};
/** Decode the public image tag, then authenticate it without comparing secret cells. */
const detectTestImage = async (image, testInputKey) => {
	const { width, height, rgba } = image;
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 24 || height < 24 || rgba.length !== width * height * 4 || !TEST_INPUT_KEY_PATTERN.test(testInputKey)) return void 0;
	const cells = getTestImageKeyCells(width, height);
	for (const category of getImageTestCategories()) {
		const symbols = [];
		for (const cell of cells) {
			const sample = [
				0,
				0,
				0
			];
			let count = 0;
			let opaque = true;
			for (let y = cell.y + Math.ceil(cell.height / 4); y < cell.y + cell.height * 3 / 4; y++) for (let x = cell.x + Math.ceil(cell.width / 4); x < cell.x + cell.width * 3 / 4; x++) {
				const offset = (y * width + x) * 4;
				if (rgba[offset + 3] < 250) opaque = false;
				for (let c = 0; c < 3; c++) sample[c] += rgba[offset + c];
				count++;
			}
			if (!opaque || !count) break;
			const distances = TEST_IMAGE_PALETTES[category].map((color) => sample.reduce((sum, value, c) => sum + (value / count - color[c]) ** 2, 0));
			const nearest = distances.indexOf(Math.min(...distances));
			if (distances[nearest] > 900) break;
			symbols.push(nearest);
		}
		if (symbols.length !== 64) continue;
		const tag = Array.from({ length: 32 }, (_, i) => (symbols[i * 2] << 2 | symbols[i * 2 + 1]).toString(16)).join("");
		if (timingSafeEqual(tag, await getTestInputTag("image", category, testInputKey))) return category;
	}
};
export { updatedAtField as C, saneStringField as S, POLICY_ALLOWANCE_SCHEMA as _, generateTestTextCode as a, HASH_LIST_ACTION_SCHEMA as b, getTestImageKeyColors as c, CLASSIFICATION_CATEGORIES as d, CLASSIFICATION_REPORT_SCHEMA as f, FLAGGED_CONTENT_ACTION_SCHEMA as g, PROCESSING_FEATURES_SCHEMA as h, detectTestTrigger as i, getTestInputTag as l, MODERATION_POLICY_CATEGORY_SCHEMA as m, TEST_INPUT_KEY_PATTERN as n, getImageTestCategories as o, MODERATION_POLICY_CATEGORIES as p, detectTestImage as r, getTestImageKeyCells as s, TEST_IMAGE_PALETTES as t, paintTestImage as u, POLICY_RESTRICTION_SCHEMA as v, docPropertyInfo as w, createdAtField as x, getModerationQualifiers as y };
