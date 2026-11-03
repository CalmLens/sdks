//! Signed test inputs: text codes, test images and media phrases that CalmLens decides as the
//! scenario they carry, for testing a moderation integration end to end without real content.
use super::classification::{CATEGORIES, INPUT_QUALIFIERS, QUALIFIERS};
use super::image_grid;
use crate::error::ErrorCode;
use crate::{Error, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;

/// A test scenario: the qualifying instances CalmLens reports for the input, optionally with
/// regional delivery actions and categories it reports as not assessed.
///
/// An absent list (`None`) is left out of the signed payload; an empty one is written as `[]`.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TestInput {
    /// Delivery actions for regions (`DE`, `AT`, `FR`, `GB`, `EU`, `AU` or `BR`, each at most
    /// once); at most 7.
    #[serde(default)]
    pub regional_actions: Option<Vec<TestRegionalAction>>,
    /// Categories reported as not assessed; unique, and none with instances.
    #[serde(default)]
    pub unassessed_categories: Option<Vec<String>>,
    /// The qualifying instances; at most 128.
    pub instances: Vec<TestInputInstance>,
}

/// One qualifying instance of a category in a [`TestInput`].
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestInputInstance {
    /// The category, e.g. `harassment`.
    pub category: String,
    /// The score from 0 to 1.
    #[serde(default)]
    pub score: Option<f64>,
    /// The policy action: `allow`, `limit`, `age-restrict` or `block`. Set it on every
    /// instance or on none.
    #[serde(default)]
    pub action: Option<String>,
    /// Unique qualifiers of the category, e.g. `harassment-abuse`; at most 64. Qualifiers the
    /// input type sets (such as `sexual-text`) are automatic and cannot be listed.
    pub qualifiers: Vec<String>,
}

/// A regional delivery action in a [`TestInput`].
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestRegionalAction {
    /// The region: `DE`, `AT`, `FR`, `GB`, `EU`, `AU` or `BR`.
    pub region: String,
    /// The action there: `limit`, `age-restrict` or `block`.
    pub action: String,
}

/// What a test input helper encodes: a [`TestInput`] or a signal (see [`test_input_for_signal`]).
#[derive(Clone, Copy, Debug)]
pub enum TestScenario<'a> {
    /// An explicit scenario.
    Input(&'a TestInput),
    /// A signal such as `violence` or `harassment.insult`.
    Signal(&'a str),
}
impl<'a> From<&'a TestInput> for TestScenario<'a> {
    fn from(input: &'a TestInput) -> Self {
        Self::Input(input)
    }
}
impl<'a> From<&'a str> for TestScenario<'a> {
    fn from(signal: &'a str) -> Self {
        Self::Signal(signal)
    }
}
impl<'a> From<&'a String> for TestScenario<'a> {
    fn from(signal: &'a String) -> Self {
        Self::Signal(signal)
    }
}

/// The input a signal shortcut stands for; `sexual.adult` differs between text and images.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TestInputKind {
    /// A text code.
    Text,
    /// An image ([`paint_test_image`]).
    Image,
}

/// Ready-made scenarios.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum TestInputPreset {
    /// No instances.
    Clean,
    /// One abusive harassment instance.
    Limited,
    /// Pornographic sexual media.
    AdultImage,
    /// Sexually explicit language.
    AdultText,
    /// No instances, delivery blocked in `DE`, age-restricted in `GB` and limited in `FR`.
    RegionalDelivery,
    /// A publicly displayed Nazi hate symbol.
    Germany,
    /// Two harassment instances: documentary abuse and a threat.
    Mixed,
}
impl TestInputPreset {
    /// Every preset.
    pub const ALL: [Self; 7] = [
        Self::Clean,
        Self::Limited,
        Self::AdultImage,
        Self::AdultText,
        Self::RegionalDelivery,
        Self::Germany,
        Self::Mixed,
    ];
    /// The preset's scenario.
    pub fn input(self) -> TestInput {
        let one = |category: &str, qualifiers: &[&str]| instance(category, qualifiers);
        let instances = match self {
            Self::Clean | Self::RegionalDelivery => vec![],
            Self::Limited => vec![one("harassment", &["harassment-abuse"])],
            Self::AdultImage => vec![one("sexual", &["sexual-pornographic-media"])],
            Self::AdultText => vec![one("sexual", &["sexual-explicit-language"])],
            Self::Germany => vec![one(
                "hate",
                &["hate-symbol", "hate-nazi-symbols-public-display"],
            )],
            Self::Mixed => vec![
                one(
                    "harassment",
                    &["harassment-abuse", "harassment-documentary"],
                ),
                one("harassment", &["harassment-threat"]),
            ],
        };
        let regional_actions = (self == Self::RegionalDelivery).then(|| {
            [("DE", "block"), ("GB", "age-restrict"), ("FR", "limit")]
                .map(|(region, action)| TestRegionalAction {
                    region: region.to_owned(),
                    action: action.to_owned(),
                })
                .to_vec()
        });
        TestInput {
            regional_actions,
            unassessed_categories: None,
            instances,
        }
    }
}
impl From<TestInputPreset> for TestInput {
    fn from(preset: TestInputPreset) -> Self {
        preset.input()
    }
}

fn instance(category: &str, qualifiers: &[&str]) -> TestInputInstance {
    TestInputInstance {
        category: category.to_owned(),
        qualifiers: qualifiers.iter().map(|q| (*q).to_owned()).collect(),
        ..TestInputInstance::default()
    }
}

/// The signals text codes and test images accept: the categories and
/// `sexual.involving-minors`, `harassment.insult`, `sexual.adult`, `hate.regional-symbol` and
/// `violence.graphic`.
pub const TEST_INPUT_SIGNALS: &[&str] = &[
    "sexual",
    "violence",
    "self-harm",
    "harassment",
    "hate",
    "criminal-activity",
    "personal-information",
    "profanity",
    "sexual.involving-minors",
    "harassment.insult",
    "sexual.adult",
    "hate.regional-symbol",
    "violence.graphic",
];

/// The signals [`generate_media_test_code`] accepts: the categories and `violence.graphic`.
pub const MEDIA_TEST_SIGNALS: &[&str] = &[
    "sexual",
    "violence",
    "self-harm",
    "harassment",
    "hate",
    "criminal-activity",
    "personal-information",
    "profanity",
    "violence.graphic",
];

const REGIONS: &[&str] = &["DE", "AT", "FR", "GB", "EU", "AU", "BR"];
const ACTIONS: &[&str] = &["allow", "limit", "age-restrict", "block"];
const HEX_WORDS: [&str; 16] = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "alpha",
    "bravo", "charlie", "delta", "echo", "foxtrot",
];

/// The scenario a signal stands for. An unknown signal is `sdk/invalid-argument`.
///
/// ```
/// use calmlens::testing::{test_input_for_signal, TestInputKind, TestInputPreset};
/// let input = test_input_for_signal("sexual.adult", TestInputKind::Image).unwrap();
/// assert_eq!(input, TestInputPreset::AdultImage.input());
/// ```
pub fn test_input_for_signal(signal: &str, kind: TestInputKind) -> Result<TestInput> {
    let preset = match (signal, kind) {
        ("harassment.insult", _) => TestInputPreset::Limited,
        ("sexual.adult", TestInputKind::Image) => TestInputPreset::AdultImage,
        ("sexual.adult", TestInputKind::Text) => TestInputPreset::AdultText,
        ("hate.regional-symbol", _) => TestInputPreset::Germany,
        _ => {
            let one = match signal {
                "sexual.involving-minors" => instance("sexual", &["sexual-minors"]),
                "violence.graphic" => instance("violence", &["violence-graphic"]),
                category if CATEGORIES.contains(&category) => instance(category, &[]),
                _ => return Err(invalid_argument("Unknown test input signal")),
            };
            return Ok(TestInput {
                instances: vec![one],
                ..TestInput::default()
            });
        }
    };
    Ok(preset.input())
}

/// A signed text code for a scenario or signal. Put it anywhere in a text input and CalmLens
/// decides the input as that scenario.
///
/// `test_input_key` is the project's secret test input key from the portal (32 lowercase hex
/// characters). An invalid key or scenario, or one too large to encode, is
/// `sdk/invalid-argument`.
///
/// ```
/// use calmlens::testing::{generate_test_text_code, TestInputPreset};
/// # let test_input_key = "1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d";
/// let code = generate_test_text_code(&TestInputPreset::Limited.input(), test_input_key)?;
/// let violent = generate_test_text_code("violence", test_input_key)?;
/// assert!(code.starts_with("<!calmlens-test ") && violent != code);
/// # Ok::<(), calmlens::Error>(())
/// ```
pub fn generate_test_text_code<'a>(
    scenario: impl Into<TestScenario<'a>>,
    test_input_key: &str,
) -> Result<String> {
    let input = resolve(scenario.into(), TestInputKind::Text)?;
    text_code(&input, test_input_key)
}

/// A painted test image: RGBA bytes, row by row, and the same image as PNG.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct TestImage {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// `width * height * 4` bytes of red, green, blue and alpha.
    pub rgba: Vec<u8>,
    /// The image as PNG bytes, ready to upload.
    pub png: Vec<u8>,
}

/// Category colours, carried in a test image's chroma only.
const CATEGORY_COLORS: [(&str, [u8; 3]); 8] = [
    ("sexual", [232, 80, 160]),
    ("violence", [224, 56, 64]),
    ("self-harm", [24, 168, 152]),
    ("harassment", [240, 128, 48]),
    ("hate", [144, 80, 216]),
    ("criminal-activity", [224, 184, 40]),
    ("personal-information", [48, 128, 224]),
    ("profanity", [136, 192, 48]),
];

/// Paints a scenario or signal as a test image that CalmLens decides as that scenario. The image
/// survives lossy formats and resizing: upload its `png` bytes, or encode its `rgba` in any format.
///
/// `test_input_key` is the project's secret test input key from the portal. An invalid key or
/// scenario, or one too large for a test image, is `sdk/invalid-argument`.
///
/// ```
/// use calmlens::testing::paint_test_image;
/// # let test_input_key = "1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d";
/// let image = paint_test_image("violence", test_input_key)?;
/// assert!(image.png.starts_with(b"\x89PNG"));
/// # Ok::<(), calmlens::Error>(())
/// ```
pub fn paint_test_image<'a>(
    scenario: impl Into<TestScenario<'a>>,
    test_input_key: &str,
) -> Result<TestImage> {
    let input = resolve(scenario.into(), TestInputKind::Image)?;
    let code = text_code(&input, test_input_key)?;
    let tag = &code.split(' ').nth(1).expect("a text code has a tag");
    let content = canonical_json(&input);
    let mut data = vec![(content.len() >> 8) as u8, content.len() as u8];
    data.extend(
        (0..tag.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&tag[i..i + 2], 16).expect("the tag is hexadecimal")),
    );
    data.extend_from_slice(content.as_bytes());
    let mut palette: Vec<[u8; 3]> = Vec::new();
    for instance in &input.instances {
        let color = CATEGORY_COLORS
            .iter()
            .find(|(category, _)| *category == instance.category)
            .map(|(_, color)| *color)
            .expect("validated category");
        if !palette.contains(&color) {
            palette.push(color);
        }
    }
    if palette.is_empty() {
        palette.push([144, 152, 160]);
    }
    let (width, rgba) = image_grid::paint(&data, &palette)
        .ok_or_else(|| invalid_argument("Test scenario is too large for a test image"))?;
    let png = image_grid::png(width, width, &rgba);
    Ok(TestImage {
        width,
        height: width,
        rgba,
        png,
    })
}

/// The phrase that makes an audio or video input a test of `signal` (one of
/// [`MEDIA_TEST_SIGNALS`]): read it aloud, or show it as large, high-contrast text in a frame.
///
/// `test_input_key` is the project's secret test input key from the portal. An invalid key or
/// signal is `sdk/invalid-argument`.
pub fn generate_media_test_code(signal: &str, test_input_key: &str) -> Result<String> {
    if !MEDIA_TEST_SIGNALS.contains(&signal) {
        return Err(invalid_argument("Unsupported media test signal"));
    }
    check_key(test_input_key)?;
    let tag = tag(test_input_key, &format!("calmlens-test:media:{signal}"));
    let words: Vec<&str> = tag
        .chars()
        .map(|digit| HEX_WORDS[digit.to_digit(16).expect("hex digit") as usize])
        .collect();
    Ok(format!(
        "Calm Lens test {} {} end test",
        words.join(" "),
        signal.replace(['.', '-'], " ")
    ))
}

fn resolve(scenario: TestScenario<'_>, kind: TestInputKind) -> Result<TestInput> {
    let input = match scenario {
        TestScenario::Input(input) => input.clone(),
        TestScenario::Signal(signal) => test_input_for_signal(signal, kind)?,
    };
    validate(&input)?;
    Ok(input)
}

fn text_code(input: &TestInput, key: &str) -> Result<String> {
    check_key(key)?;
    let payload = URL_SAFE_NO_PAD.encode(canonical_json(input));
    if payload.len() > 8000 {
        return Err(invalid_argument("Test scenario is too large"));
    }
    let tag = tag(key, &format!("calmlens-test:v1:{payload}"));
    Ok(format!("<!calmlens-test {tag} {payload}>"))
}

fn check_key(key: &str) -> Result<()> {
    let valid = key.len() == 32 && key.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    if valid {
        Ok(())
    } else {
        Err(invalid_argument("Invalid test input key"))
    }
}

/// The first 32 lowercase hex characters of HMAC-SHA256 keyed with the key string's bytes.
fn tag(key: &str, message: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(key.as_bytes()).expect("HMAC accepts any key");
    mac.update(message.as_bytes());
    let digest = mac.finalize().into_bytes();
    digest[..16].iter().map(|b| format!("{b:02x}")).collect()
}

fn validate(input: &TestInput) -> Result<()> {
    let fail = |message: &str| Err(invalid_argument(message));
    if input.instances.len() > 128 {
        return fail("A test input has at most 128 instances");
    }
    for instance in &input.instances {
        let Some((_, allowed)) = QUALIFIERS.iter().find(|(c, _)| *c == instance.category) else {
            return fail("Unknown test input category");
        };
        if instance
            .score
            .is_some_and(|s| !(s.is_finite() && (0.0..=1.0).contains(&s)))
        {
            return fail("A test input score is from 0 to 1");
        }
        if instance
            .action
            .as_deref()
            .is_some_and(|a| !ACTIONS.contains(&a))
        {
            return fail("Unknown test input action");
        }
        let qualifiers = &instance.qualifiers;
        if qualifiers.len() > 64
            || qualifiers.iter().enumerate().any(|(index, qualifier)| {
                !allowed.contains(&qualifier.as_str())
                    || INPUT_QUALIFIERS.contains(&qualifier.as_str())
                    || qualifiers[..index].contains(qualifier)
            })
        {
            return fail("Choose unique content qualifiers from the instance's category");
        }
    }
    let with_action = input
        .instances
        .iter()
        .filter(|i| i.action.is_some())
        .count();
    if with_action != 0 && with_action != input.instances.len() {
        return fail("Set an action for every instance or omit all actions");
    }
    let unassessed = input.unassessed_categories.as_deref().unwrap_or_default();
    if unassessed.len() > CATEGORIES.len()
        || unassessed.iter().enumerate().any(|(index, category)| {
            !CATEGORIES.contains(&category.as_str())
                || unassessed[..index].contains(category)
                || input.instances.iter().any(|i| i.category == *category)
        })
    {
        return fail("Unassessed categories are unique and have no instances");
    }
    let regional = input.regional_actions.as_deref().unwrap_or_default();
    if regional.len() > REGIONS.len()
        || regional.iter().enumerate().any(|(index, entry)| {
            !REGIONS.contains(&entry.region.as_str())
                || !ACTIONS[1..].contains(&entry.action.as_str())
                || regional[..index].iter().any(|e| e.region == entry.region)
        })
    {
        return fail("Choose each region once with a limit, age-restrict or block action");
    }
    Ok(())
}

/// The payload JSON, keys in the order the backend signs; validated strings need no escaping.
fn canonical_json(input: &TestInput) -> String {
    let strings = |values: &[String]| {
        let quoted: Vec<String> = values.iter().map(|v| format!("\"{v}\"")).collect();
        format!("[{}]", quoted.join(","))
    };
    let mut fields = Vec::new();
    if let Some(regional) = &input.regional_actions {
        let entries: Vec<String> = regional
            .iter()
            .map(|e| format!(r#"{{"region":"{}","action":"{}"}}"#, e.region, e.action))
            .collect();
        fields.push(format!(r#""regionalActions":[{}]"#, entries.join(",")));
    }
    if let Some(unassessed) = &input.unassessed_categories {
        fields.push(format!(r#""unassessedCategories":{}"#, strings(unassessed)));
    }
    let instances: Vec<String> = input
        .instances
        .iter()
        .map(|instance| {
            let mut parts = vec![format!(r#""category":"{}""#, instance.category)];
            if let Some(score) = instance.score {
                parts.push(format!(r#""score":{}"#, js_number(score)));
            }
            if let Some(action) = &instance.action {
                parts.push(format!(r#""action":"{action}""#));
            }
            parts.push(format!(r#""qualifiers":{}"#, strings(&instance.qualifiers)));
            format!("{{{}}}", parts.join(","))
        })
        .collect();
    fields.push(format!(r#""instances":[{}]"#, instances.join(",")));
    format!("{{{}}}", fields.join(","))
}

/// JavaScript's `JSON.stringify` of a finite score from 0 to 1: Rust's shortest round-trip
/// digits, in exponent form below 1e-6 as JavaScript writes them.
fn js_number(value: f64) -> String {
    if value == 0.0 {
        "0".to_owned()
    } else if value < 1e-6 {
        format!("{value:e}")
    } else {
        format!("{value}")
    }
}

fn invalid_argument(message: &str) -> Error {
    Error::new(ErrorCode::InvalidArgument, message)
}

#[cfg(test)]
mod tests {
    use super::{INPUT_QUALIFIERS, QUALIFIERS};
    use serde_json::{json, Map, Value};

    /// The qualifiers a scenario may list match the contract's `qualifiers` in
    /// `testdata/test-inputs.json`.
    #[test]
    fn scenario_qualifiers_match_the_contract() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/test-inputs.json");
        let fixture: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let allowed: Map<String, Value> = QUALIFIERS
            .iter()
            .map(|(category, qualifiers)| {
                let listed: Vec<&&str> = qualifiers
                    .iter()
                    .filter(|q| !INPUT_QUALIFIERS.contains(q))
                    .collect();
                ((*category).to_owned(), json!(listed))
            })
            .collect();
        assert_eq!(Value::Object(allowed), fixture["qualifiers"]);
    }
}
