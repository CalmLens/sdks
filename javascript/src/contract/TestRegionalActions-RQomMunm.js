import { n as JURISDICTION_SCHEMA } from "./Jurisdiction-DF7spSE4.js";
import * as z from "zod";
// packages/shared/src/Messages.ts
/**
* Marks English text in shared, backend and data modules that the portal shows, so the app's
* message catalog (packages/app/vite/messageCatalog.ts) extracts it and the portal can translate it
* where it renders (`useTranslateText()` from `#i18n`). Returns the text unchanged: the API, events,
* emails and logs keep English. Only a string literal argument is extracted.
*/
const msg = (text) => text;
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
	"sexual-strangulation": {
		category: "sexual",
		kind: "harm",
		harmOption: false,
		displayName: msg("Pornographic strangulation or suffocation"),
		description: msg("A pornographic image or video frame showing a person strangling, choking or suffocating another: pressure on the neck from a hand, arm or ligature, or breathing blocked by covering the mouth and nose, smothering or compressing the chest. Realistic staged, generated or computer-made depictions count."),
		exclusions: "A person alone in the image holding their own throat or miming being choked; a hand resting on the shoulder, jaw or chest without gripping the throat; collars and choker jewellery; oral sex, including gagging, without breathing deliberately held off; non-sexual violence, combat sport or medical images; drawings or animation that don't look real; reports, education or support that show no such image.",
		inputs: ["image"]
	},
	"sexual-incest": {
		category: "sexual",
		kind: "harm",
		harmOption: false,
		displayName: msg("Pornographic incest"),
		description: msg("A pornographic image or video frame showing sexual activity between people who are, or are presented as, related as parent, grandparent, child, grandchild, brother, sister, half-brother, half-sister, uncle, aunt, nephew or niece, including by adoption. The relationship can be shown by the image or by its caption, title, dialogue or other accompanying text. Realistic staged, generated or computer-made depictions count."),
		exclusions: "Step, foster and in-law relationships between adults; a family word that is plainly a nickname or fanciful, such as daddy between adult partners; drawings or animation that don't look real; non-sexual family images; reports or discussion that show no such image. Someone presented as under 18 is Sexualised minors.",
		inputs: ["image"]
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
MODERATION_QUALIFIERS.reduce((groups, qualifier) => {
	(groups[MODERATION_QUALIFIER_INFO[qualifier].category] ??= []).push(qualifier);
	return groups;
}, {});
function getModerationQualifierInfo(qualifier) {
	return MODERATION_QUALIFIER_INFO[qualifier];
}
// packages/shared/src/TestRegionalActions.ts
/** Authenticated test inputs can add regional delivery restrictions without inventing evidence. */
const TEST_REGIONAL_ACTIONS_SCHEMA = z.array(z.object({
	region: JURISDICTION_SCHEMA.exclude(["global"]),
	action: z.enum([
		"limit",
		"age-restrict",
		"block"
	])
}).strict()).max(7).refine((entries) => new Set(entries.map((entry) => entry.region)).size === entries.length, "Choose each region once");
export { msg as i, MODERATION_QUALIFIERS as n, getModerationQualifierInfo as r, TEST_REGIONAL_ACTIONS_SCHEMA as t };
