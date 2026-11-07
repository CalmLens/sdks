//! Signed test inputs: text codes, test images and media phrases that CalmLens decides as the
//! scenario they carry, for testing a moderation integration end to end without real content, in
//! projects with "Recognise test inputs" turned on.
use super::classification::{
    CATEGORIES, INPUT_QUALIFIERS, QUALIFIERS, TEST_DETECTIONS_MAX, TEST_DETECTION_BOX_MAX,
    TEST_FACE_AGE_MAX, TEST_FACE_AGE_PRESETS,
};
use super::image_grid;
use crate::error::ErrorCode;
use crate::{Error, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use serde::de::{self, value::MapAccessDeserializer, Deserializer, MapAccess, SeqAccess, Visitor};
use serde::Deserialize;
use sha2::Sha256;
use std::fmt;
use std::marker::PhantomData;
use std::time::{SystemTime, UNIX_EPOCH};

/// How long a text code or test image stays valid when [`TestInputCodeOptions::expires_at`] is
/// `None`: one day, in seconds.
pub const TEST_INPUT_DEFAULT_LIFETIME_SECONDS: i64 = 24 * 60 * 60;

/// The longest a code may still have to run when CalmLens reads it, in seconds: CalmLens ignores
/// a code or test image that expires more than seven days after it arrives.
pub const TEST_INPUT_MAX_LIFETIME_SECONDS: i64 = 7 * 24 * 60 * 60;

/// Options for [`generate_test_text_code`] and [`paint_test_image`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TestInputCodeOptions {
    /// When the code or image stops being recognised, in Unix seconds from 0 to 4294967295;
    /// defaults to [`TEST_INPUT_DEFAULT_LIFETIME_SECONDS`] from now.
    pub expires_at: Option<i64>,
}

/// A test scenario: the qualifying instances CalmLens reports for the input, optionally with
/// regional delivery actions, categories it reports as not assessed and person and face
/// detection results.
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
    /// Person and face detection results for an input whose upload turns those features on.
    #[serde(default, deserialize_with = "present_object")]
    pub detections: Option<TestDetections>,
}

/// Person and face detection results in a [`TestInput`]. A list left out (`None`) reports no
/// result for the feature.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestDetections {
    /// The people found, or [`TestDetectionList::Unavailable`].
    #[serde(default, deserialize_with = "present")]
    pub people: Option<TestDetectionList<TestPerson>>,
    /// The faces found, or [`TestDetectionList::Unavailable`].
    #[serde(default, deserialize_with = "present")]
    pub faces: Option<TestDetectionList<TestFace>>,
}

/// A detection feature's result in [`TestDetections`]: what it found, or that it was not
/// evaluated (`"unavailable"` on the wire).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TestDetectionList<T> {
    /// What the feature found; at most 32 entries, and empty when it found nothing.
    Detected(Vec<T>),
    /// The feature reports that it could not run.
    Unavailable,
}
impl<T> Default for TestDetectionList<T> {
    fn default() -> Self {
        Self::Detected(Vec::new())
    }
}
impl<T> From<Vec<T>> for TestDetectionList<T> {
    fn from(entries: Vec<T>) -> Self {
        Self::Detected(entries)
    }
}
impl<'de, T: Deserialize<'de>> Deserialize<'de> for TestDetectionList<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        struct ListVisitor<T>(PhantomData<T>);
        impl<'de, T: Deserialize<'de>> Visitor<'de> for ListVisitor<T> {
            type Value = TestDetectionList<T>;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str(r#"a list of detections or "unavailable""#)
            }
            fn visit_str<E: de::Error>(self, value: &str) -> std::result::Result<Self::Value, E> {
                match value {
                    "unavailable" => Ok(TestDetectionList::Unavailable),
                    _ => Err(E::invalid_value(de::Unexpected::Str(value), &self)),
                }
            }
            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut entries = Vec::new();
                while let Some(Object(entry)) = seq.next_element()? {
                    entries.push(entry);
                }
                Ok(TestDetectionList::Detected(entries))
            }
        }
        deserializer.deserialize_any(ListVisitor(PhantomData))
    }
}

/// A person in [`TestDetections::people`].
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestPerson {
    /// Where the person is (`box` on the wire): `[left, top, width, height]` in basis points of
    /// the image, each from 0 to 10000, within the image.
    #[serde(rename = "box")]
    pub bounding_box: [u32; 4],
    /// The confidence from 0 to 100.
    #[serde(default, deserialize_with = "present")]
    pub confidence: Option<u32>,
}

/// A face in [`TestDetections::faces`].
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestFace {
    /// Where the face is (`box` on the wire): `[left, top, width, height]` in basis points of
    /// the image, each from 0 to 10000, within the image.
    #[serde(rename = "box")]
    pub bounding_box: [u32; 4],
    /// The confidence from 0 to 100.
    #[serde(default, deserialize_with = "present")]
    pub confidence: Option<u32>,
    /// The estimated age.
    #[serde(default, deserialize_with = "present")]
    pub age: Option<TestFaceAge>,
}

/// The estimated age of a [`TestFace`]: a preset or a range of years.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TestFaceAge {
    /// An adult's age range (`"adult"`).
    Adult,
    /// A minor's age range (`"minor"`).
    Minor,
    /// An age range in years, each from 0 to 120 with `low` at most `high`.
    Range(TestAgeRange),
}
impl TestFaceAge {
    /// The presets, in the order of their names in `TEST_FACE_AGE_PRESETS`.
    const PRESETS: [Self; 2] = [Self::Adult, Self::Minor];
    /// A preset by its name on the wire.
    fn preset(name: &str) -> Option<Self> {
        let index = TEST_FACE_AGE_PRESETS.iter().position(|n| *n == name)?;
        Self::PRESETS.get(index).copied()
    }
    /// A preset's name on the wire; `None` for a range.
    fn preset_name(self) -> Option<&'static str> {
        let index = Self::PRESETS.iter().position(|age| *age == self)?;
        TEST_FACE_AGE_PRESETS.get(index).copied()
    }
}
impl From<TestAgeRange> for TestFaceAge {
    fn from(range: TestAgeRange) -> Self {
        Self::Range(range)
    }
}
impl<'de> Deserialize<'de> for TestFaceAge {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        struct AgeVisitor;
        impl<'de> Visitor<'de> for AgeVisitor {
            type Value = TestFaceAge;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("an age preset or an age range")
            }
            fn visit_str<E: de::Error>(self, value: &str) -> std::result::Result<Self::Value, E> {
                TestFaceAge::preset(value)
                    .ok_or_else(|| E::invalid_value(de::Unexpected::Str(value), &self))
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                map: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                TestAgeRange::deserialize(MapAccessDeserializer::new(map)).map(TestFaceAge::Range)
            }
        }
        deserializer.deserialize_any(AgeVisitor)
    }
}

/// An age range in years in a [`TestFaceAge`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestAgeRange {
    /// The youngest age, from 0 to 120.
    pub low: u32,
    /// The oldest age, from `low` to 120.
    pub high: u32,
}

/// A field that is `None` only when left out: `null` is refused.
fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> std::result::Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
}

/// Like [`present`], for a struct that must be given as an object rather than a list.
fn present_object<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> std::result::Result<Option<T>, D::Error> {
    Object::deserialize(deserializer).map(|Object(value)| Some(value))
}

/// A struct decoded only from an object: derived structs also accept a list of their fields.
struct Object<T>(T);
impl<'de, T: Deserialize<'de>> Deserialize<'de> for Object<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        struct ObjectVisitor<T>(PhantomData<T>);
        impl<'de, T: Deserialize<'de>> Visitor<'de> for ObjectVisitor<T> {
            type Value = T;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("an object")
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                map: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                T::deserialize(MapAccessDeserializer::new(map))
            }
        }
        deserializer
            .deserialize_map(ObjectVisitor(PhantomData))
            .map(Object)
    }
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
    /// No instances, one person and their face with no estimated age.
    OneFace,
    /// No instances, and person and face detection found nobody.
    NoFace,
    /// No instances, one person and their face with an adult's age.
    AdultFace,
    /// No instances, one person and their face with a minor's age.
    MinorFace,
    /// No instances, three people side by side and their faces.
    Group,
}
impl TestInputPreset {
    /// Every preset.
    pub const ALL: [Self; 12] = [
        Self::Clean,
        Self::Limited,
        Self::AdultImage,
        Self::AdultText,
        Self::RegionalDelivery,
        Self::Germany,
        Self::Mixed,
        Self::OneFace,
        Self::NoFace,
        Self::AdultFace,
        Self::MinorFace,
        Self::Group,
    ];
    /// The preset's scenario.
    pub fn input(self) -> TestInput {
        let one = |category: &str, qualifiers: &[&str]| instance(category, qualifiers);
        let instances = match self {
            Self::Clean
            | Self::RegionalDelivery
            | Self::OneFace
            | Self::NoFace
            | Self::AdultFace
            | Self::MinorFace
            | Self::Group => vec![],
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
            detections: self.detections(),
        }
    }

    fn detections(self) -> Option<TestDetections> {
        let person = |bounding_box| TestPerson {
            bounding_box,
            confidence: None,
        };
        let face = |bounding_box, age| TestFace {
            bounding_box,
            confidence: None,
            age,
        };
        let one = |age| TestDetections {
            people: Some(vec![person([2500, 1500, 5000, 8500])].into()),
            faces: Some(vec![face([3500, 2000, 3000, 3500], age)].into()),
        };
        Some(match self {
            Self::OneFace => one(None),
            Self::AdultFace => one(Some(TestFaceAge::Adult)),
            Self::MinorFace => one(Some(TestFaceAge::Minor)),
            Self::NoFace => TestDetections {
                people: Some(vec![].into()),
                faces: Some(vec![].into()),
            },
            Self::Group => {
                let lefts = [500, 3600, 6700];
                TestDetections {
                    people: Some(
                        lefts
                            .map(|left| person([left, 2000, 2800, 8000]))
                            .to_vec()
                            .into(),
                    ),
                    faces: Some(
                        lefts
                            .map(|left| face([left + 700, 2500, 1400, 2000], None))
                            .to_vec()
                            .into(),
                    ),
                }
            }
            _ => return None,
        })
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
                "violence.graphic" => {
                    instance("violence", &["violence-injury", "violence-graphic"])
                }
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

/// A signed text code for a scenario or signal. CalmLens decides a text input as that scenario
/// only when the code is the whole text (surrounding whitespace aside); text with anything else
/// around it is moderated as ordinary content.
///
/// The code expires at `options.expires_at`, or a day from now, so generate it when the test runs
/// rather than storing it. `test_input_key` is the project's secret test input key from the portal
/// (32 lowercase hex characters). An invalid key, scenario or expiry, or a scenario too large to
/// encode, is `sdk/invalid-argument`.
///
/// ```
/// use calmlens::testing::{generate_test_text_code, TestInputCodeOptions, TestInputPreset};
/// # let test_input_key = "1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d";
/// let code = generate_test_text_code(&TestInputPreset::Limited.input(), test_input_key, Default::default())?;
/// let until_2030 = TestInputCodeOptions { expires_at: Some(1_893_456_000) };
/// let violent = generate_test_text_code("violence", test_input_key, until_2030)?;
/// assert!(code.starts_with("<!calmlens-test ") && violent != code);
/// # Ok::<(), calmlens::Error>(())
/// ```
pub fn generate_test_text_code<'a>(
    scenario: impl Into<TestScenario<'a>>,
    test_input_key: &str,
    options: TestInputCodeOptions,
) -> Result<String> {
    let input = resolve(scenario.into(), TestInputKind::Text)?;
    text_code(&input, test_input_key, options)
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

/// Paints a scenario or signal as a test image that CalmLens decides as that scenario when it is
/// the whole upload (a plain single-colour border aside). The image survives lossy formats and
/// resizing: upload its `png` bytes, or encode its `rgba` in any format.
///
/// Like a text code, it expires at `options.expires_at`, or a day from now. `test_input_key` is the
/// project's secret test input key from the portal. An invalid key, scenario or expiry, or a
/// scenario too large for a test image, is `sdk/invalid-argument`.
///
/// ```
/// use calmlens::testing::paint_test_image;
/// # let test_input_key = "1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d";
/// let image = paint_test_image("violence", test_input_key, Default::default())?;
/// assert!(image.png.starts_with(b"\x89PNG"));
/// # Ok::<(), calmlens::Error>(())
/// ```
pub fn paint_test_image<'a>(
    scenario: impl Into<TestScenario<'a>>,
    test_input_key: &str,
    options: TestInputCodeOptions,
) -> Result<TestImage> {
    let input = resolve(scenario.into(), TestInputKind::Image)?;
    let code = text_code(&input, test_input_key, options)?;
    let mut parts = code[..code.len() - 1].split(' ').skip(1);
    let tag = parts.next().expect("a text code has a tag");
    let signed = URL_SAFE_NO_PAD
        .decode(parts.next().expect("a text code has a payload"))
        .expect("the payload is base64url");
    let mut data = vec![(signed.len() >> 8) as u8, signed.len() as u8];
    data.extend(
        (0..tag.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&tag[i..i + 2], 16).expect("the tag is hexadecimal")),
    );
    data.extend_from_slice(&signed);
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

/// The signed bytes are the expiry (four bytes, big-endian Unix seconds), then the scenario's
/// canonical JSON.
fn text_code(input: &TestInput, key: &str, options: TestInputCodeOptions) -> Result<String> {
    check_key(key)?;
    let expires_at = match options.expires_at {
        Some(expires_at) => u32::try_from(expires_at).map_err(|_| {
            invalid_argument("Test input expiry must be Unix seconds from 0 to 4294967295")
        })?,
        None => {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_secs());
            (now + TEST_INPUT_DEFAULT_LIFETIME_SECONDS as u64) as u32
        }
    };
    let mut signed = expires_at.to_be_bytes().to_vec();
    signed.extend_from_slice(canonical_json(input).as_bytes());
    let payload = URL_SAFE_NO_PAD.encode(signed);
    if payload.len() > 8000 {
        return Err(invalid_argument("Test scenario is too large"));
    }
    let tag = tag(key, &format!("calmlens-test:v2:{payload}"));
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
    if let Some(detections) = &input.detections {
        validate_detections(detections)?;
    }
    Ok(())
}

fn validate_detections(detections: &TestDetections) -> Result<()> {
    fn entries<T>(list: &Option<TestDetectionList<T>>) -> Result<&[T]> {
        match list {
            Some(TestDetectionList::Detected(entries)) if entries.len() > TEST_DETECTIONS_MAX => {
                Err(invalid_argument(&format!(
                    "A detection list has at most {TEST_DETECTIONS_MAX} entries"
                )))
            }
            Some(TestDetectionList::Detected(entries)) => Ok(entries),
            _ => Ok(&[]),
        }
    }
    let valid_box = |[left, top, width, height]: [u32; 4]| {
        [left, top, width, height]
            .iter()
            .all(|value| *value <= TEST_DETECTION_BOX_MAX)
            && left + width <= TEST_DETECTION_BOX_MAX
            && top + height <= TEST_DETECTION_BOX_MAX
    };
    let valid = |bounding_box: [u32; 4], confidence: Option<u32>| {
        valid_box(bounding_box) && confidence.is_none_or(|c| c <= 100)
    };
    let people = entries(&detections.people)?;
    let faces = entries(&detections.faces)?;
    if !people.iter().all(|p| valid(p.bounding_box, p.confidence))
        || !faces.iter().all(|f| valid(f.bounding_box, f.confidence))
    {
        return Err(invalid_argument(&format!(
            "A detection box lies within the image in basis points (0 to {TEST_DETECTION_BOX_MAX}), and a confidence is from 0 to 100"
        )));
    }
    let valid_age = |age: &Option<TestFaceAge>| match age {
        Some(TestFaceAge::Range(TestAgeRange { low, high })) => {
            low <= high && *high <= TEST_FACE_AGE_MAX
        }
        _ => true,
    };
    if !faces.iter().all(|face| valid_age(&face.age)) {
        return Err(invalid_argument(&format!(
            "An age range is from 0 to {TEST_FACE_AGE_MAX} years, with low at most high"
        )));
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
    if let Some(detections) = &input.detections {
        fields.push(format!(r#""detections":{}"#, detections_json(detections)));
    }
    format!("{{{}}}", fields.join(","))
}

fn detections_json(detections: &TestDetections) -> String {
    fn list<T>(name: &str, list: &TestDetectionList<T>, entry: impl Fn(&T) -> String) -> String {
        match list {
            TestDetectionList::Unavailable => format!(r#""{name}":"unavailable""#),
            TestDetectionList::Detected(entries) => {
                let entries: Vec<String> = entries.iter().map(entry).collect();
                format!(r#""{name}":[{}]"#, entries.join(","))
            }
        }
    }
    let located = |[left, top, width, height]: [u32; 4], confidence: Option<u32>| {
        let mut parts = vec![format!(r#""box":[{left},{top},{width},{height}]"#)];
        if let Some(confidence) = confidence {
            parts.push(format!(r#""confidence":{confidence}"#));
        }
        parts
    };
    let mut fields = Vec::new();
    if let Some(people) = &detections.people {
        fields.push(list("people", people, |person| {
            format!(
                "{{{}}}",
                located(person.bounding_box, person.confidence).join(",")
            )
        }));
    }
    if let Some(faces) = &detections.faces {
        fields.push(list("faces", faces, |face| {
            let mut parts = located(face.bounding_box, face.confidence);
            match face.age {
                Some(TestFaceAge::Range(TestAgeRange { low, high })) => {
                    parts.push(format!(r#""age":{{"low":{low},"high":{high}}}"#));
                }
                Some(preset) => {
                    let name = preset.preset_name().expect("an age preset has a name");
                    parts.push(format!(r#""age":"{name}""#));
                }
                None => {}
            }
            format!("{{{}}}", parts.join(","))
        }));
    }
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
    use super::{
        TestFaceAge, INPUT_QUALIFIERS, QUALIFIERS, TEST_DETECTIONS_MAX, TEST_DETECTION_BOX_MAX,
        TEST_FACE_AGE_MAX, TEST_FACE_AGE_PRESETS,
    };
    use serde_json::{json, Map, Value};

    fn fixture() -> Value {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/test-inputs.json");
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    /// The detection limits and age preset names match the contract's `detections`, and every
    /// preset name decodes to its own age.
    #[test]
    fn detection_limits_match_the_contract() {
        let detections = &fixture()["detections"];
        assert_eq!(
            (
                detections["maxEntries"].as_u64(),
                detections["boxMax"].as_u64(),
                detections["ageMax"].as_u64()
            ),
            (
                Some(TEST_DETECTIONS_MAX as u64),
                Some(u64::from(TEST_DETECTION_BOX_MAX)),
                Some(u64::from(TEST_FACE_AGE_MAX))
            )
        );
        let mut names: Vec<&str> = detections["agePresets"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        let mut expected = TEST_FACE_AGE_PRESETS.to_vec();
        names.sort_unstable();
        expected.sort_unstable();
        assert_eq!(names, expected);
        assert_eq!(TestFaceAge::PRESETS.len(), TEST_FACE_AGE_PRESETS.len());
        for age in TestFaceAge::PRESETS {
            let name = age.preset_name().unwrap();
            assert_eq!(TestFaceAge::preset(name), Some(age), "{name}");
        }
    }

    /// The qualifiers a scenario may list match the contract's `qualifiers` in
    /// `testdata/test-inputs.json`.
    #[test]
    fn scenario_qualifiers_match_the_contract() {
        let fixture = fixture();
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
