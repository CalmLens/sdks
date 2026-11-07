//! Signed test inputs match the shared contract in `testdata/test-inputs.json`.
mod common;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use calmlens::testing::{
    generate_media_test_code, generate_test_text_code, paint_test_image, test_input_for_signal,
    TestImage, TestInput, TestInputCodeOptions, TestInputKind, TestInputPreset, TestPerson,
    TestScenario, MEDIA_TEST_SIGNALS, TEST_INPUT_DEFAULT_LIFETIME_SECONDS,
    TEST_INPUT_MAX_LIFETIME_SECONDS, TEST_INPUT_SIGNALS,
};
use calmlens::ErrorCode;
use common::{fixture, typed};
use serde_json::Value;
use sha2::{Digest, Sha256};

/// A case's `input` decoded into the typed scenario, or its `signal`.
fn scenario(case: &Value) -> (Option<TestInput>, Option<&str>) {
    match case.get("input") {
        Some(input) => (Some(typed(input.clone())), None),
        None => (None, Some(case["signal"].as_str().unwrap())),
    }
}
fn with_scenario<T>(case: &Value, run: impl FnOnce(TestScenario<'_>) -> T) -> T {
    match scenario(case) {
        (Some(input), _) => run((&input).into()),
        (_, Some(signal)) => run(signal.into()),
        _ => unreachable!(),
    }
}
fn key(case: &Value) -> &str {
    case["key"].as_str().unwrap()
}
/// The case's recorded expiry; every generated case has one.
fn options(case: &Value) -> TestInputCodeOptions {
    TestInputCodeOptions {
        expires_at: Some(case["expiresAt"].as_i64().unwrap()),
    }
}

#[test]
fn presets_and_signal_shortcuts_match_the_contract() {
    let fixtures = fixture("test-inputs");
    let presets = fixtures["presets"].as_object().unwrap();
    assert_eq!(presets.len(), TestInputPreset::ALL.len());
    for (name, expected) in presets {
        let preset = match name.as_str() {
            "clean" => TestInputPreset::Clean,
            "limited" => TestInputPreset::Limited,
            "adultImage" => TestInputPreset::AdultImage,
            "adultText" => TestInputPreset::AdultText,
            "regionalDelivery" => TestInputPreset::RegionalDelivery,
            "germany" => TestInputPreset::Germany,
            "mixed" => TestInputPreset::Mixed,
            "oneFace" => TestInputPreset::OneFace,
            "noFace" => TestInputPreset::NoFace,
            "adultFace" => TestInputPreset::AdultFace,
            "minorFace" => TestInputPreset::MinorFace,
            "group" => TestInputPreset::Group,
            other => panic!("unknown preset {other}"),
        };
        assert_eq!(
            preset.input(),
            typed::<TestInput>(expected.clone()),
            "{name}"
        );
    }
    assert_eq!(
        typed::<Vec<String>>(fixtures["signals"]["text"].clone()),
        TEST_INPUT_SIGNALS
    );
    assert_eq!(
        typed::<Vec<String>>(fixtures["signals"]["media"].clone()),
        MEDIA_TEST_SIGNALS
    );
    for case in fixtures["signalInputs"].as_array().unwrap() {
        let kind = match case["kind"].as_str().unwrap() {
            "text" => TestInputKind::Text,
            "image" => TestInputKind::Image,
            other => panic!("unknown kind {other}"),
        };
        let signal = case["signal"].as_str().unwrap();
        assert_eq!(
            test_input_for_signal(signal, kind).unwrap(),
            typed::<TestInput>(case["input"].clone()),
            "{signal} {kind:?}"
        );
    }
}

#[test]
fn text_codes_match_the_contract() {
    for case in fixture("test-inputs")["text"].as_array().unwrap() {
        let code = with_scenario(case, |s| {
            generate_test_text_code(s, key(case), options(case))
        })
        .unwrap();
        assert_eq!(code, case["code"].as_str().unwrap(), "{}", case["name"]);
    }
}

#[test]
fn media_phrases_match_the_contract() {
    for case in fixture("test-inputs")["media"].as_array().unwrap() {
        let signal = case["signal"].as_str().unwrap();
        let phrase = generate_media_test_code(signal, key(case)).unwrap();
        assert_eq!(phrase, case["code"].as_str().unwrap(), "{signal}");
    }
}

/// Each cell's level as `packages/sdk-contract/testInputs.ts` records it: "r" for the outer ring,
/// else the data level (0-3) nearest the luma of the cell's top-left pixel.
fn fixture_levels(image: &TestImage, cells: usize) -> String {
    let levels: [i32; 4] = [72, 128, 184, 240];
    let width = image.width as usize;
    let size = width / cells;
    (0..cells * cells)
        .map(|cell| {
            let (row, column) = (cell / cells, cell % cells);
            if row == 0 || column == 0 || row == cells - 1 || column == cells - 1 {
                return "r".to_string();
            }
            let offset = (row * size * width + column * size) * 4;
            let [red, green, blue] =
                [0, 1, 2].map(|channel| i32::from(image.rgba[offset + channel]));
            let luma = (77 * red + 150 * green + 29 * blue) >> 8;
            (0..levels.len())
                .min_by_key(|&index| (levels[index] - luma).abs())
                .unwrap()
                .to_string()
        })
        .collect()
}

/// The RGBA rows of an unfiltered 8-bit RGBA PNG in stored deflate blocks, checking its header.
fn png_rgba(png: &[u8], width: u32, height: u32) -> Vec<u8> {
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    let (mut offset, mut header, mut zlib) = (8, Vec::new(), Vec::new());
    while offset < png.len() {
        let length = u32::from_be_bytes(png[offset..offset + 4].try_into().unwrap()) as usize;
        let body = &png[offset + 8..offset + 8 + length];
        match &png[offset + 4..offset + 8] {
            b"IHDR" => header = body.to_vec(),
            b"IDAT" => zlib.extend_from_slice(body),
            _ => {}
        }
        offset += 12 + length;
    }
    let mut expected = width.to_be_bytes().to_vec();
    expected.extend_from_slice(&height.to_be_bytes());
    expected.extend_from_slice(&[8, 6, 0, 0, 0]);
    assert_eq!(header, expected);
    let (mut raw, mut at) = (Vec::new(), 2);
    loop {
        let length = usize::from(u16::from_le_bytes([zlib[at + 1], zlib[at + 2]]));
        raw.extend_from_slice(&zlib[at + 5..at + 5 + length]);
        if zlib[at] == 1 {
            break;
        }
        at += 5 + length;
    }
    let stride = width as usize * 4 + 1;
    raw.chunks(stride)
        .flat_map(|row| {
            assert_eq!(row[0], 0);
            row[1..].to_vec()
        })
        .collect()
}

#[test]
fn test_images_match_the_contract() {
    let fixtures = fixture("test-inputs");
    for case in fixtures["images"].as_array().unwrap() {
        let name = &case["name"];
        let image = with_scenario(case, |s| paint_test_image(s, key(case), options(case))).unwrap();
        assert_eq!(
            (u64::from(image.width), u64::from(image.height)),
            (
                case["width"].as_u64().unwrap(),
                case["height"].as_u64().unwrap()
            ),
            "{name}"
        );
        let digest: String = Sha256::digest(&image.rgba)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        assert_eq!(digest, case["rgbaSha256"].as_str().unwrap(), "{name}");
        let cells = case["cells"].as_u64().unwrap() as usize;
        assert_eq!(
            fixture_levels(&image, cells),
            case["levels"].as_str().unwrap(),
            "{name}"
        );
        assert!(
            png_rgba(&image.png, image.width, image.height) == image.rgba,
            "{name}: PNG"
        );
    }
    for case in fixtures["imageRejections"].as_array().unwrap() {
        let error =
            with_scenario(case, |s| paint_test_image(s, key(case), options(case))).unwrap_err();
        assert_eq!(
            error.code(),
            &ErrorCode::InvalidArgument,
            "{}",
            case["name"]
        );
    }
}

/// Whether `value` holds a negative number, which the scenario's unsigned detection values
/// cannot hold.
fn has_negative(value: &Value) -> bool {
    match value {
        Value::Number(number) => number.as_f64().is_some_and(|n| n < 0.0),
        Value::Array(values) => values.iter().any(has_negative),
        Value::Object(fields) => fields.values().any(has_negative),
        _ => false,
    }
}

#[test]
fn expiry_lifetimes_match_the_contract() {
    let expiry = &fixture("test-inputs")["expiry"];
    assert_eq!(
        (
            TEST_INPUT_DEFAULT_LIFETIME_SECONDS,
            TEST_INPUT_MAX_LIFETIME_SECONDS
        ),
        (
            expiry["defaultLifetimeSeconds"].as_i64().unwrap(),
            expiry["maxLifetimeSeconds"].as_i64().unwrap()
        )
    );
}

/// A code generated without an expiry carries one a day from now in its signed payload.
#[test]
fn text_codes_expire_in_a_day_by_default() {
    let now = || {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
    };
    let before = now();
    let code = generate_test_text_code(
        "violence",
        "1a2b3c4d1a2b3c4d1a2b3c4d1a2b3c4d",
        Default::default(),
    )
    .unwrap();
    let after = now();
    let payload = code.trim_end_matches('>').rsplit(' ').next().unwrap();
    let signed = URL_SAFE_NO_PAD.decode(payload).unwrap();
    let expires_at = i64::from(u32::from_be_bytes(signed[..4].try_into().unwrap()));
    assert!(
        (before + 86400..=after + 86400).contains(&expires_at),
        "expires at {expires_at}, generated between {before} and {after}"
    );
}

/// Expiries outside 0 to 4294967295 are refused; a fractional one cannot be expressed in `i64`.
#[test]
fn out_of_range_expiries_are_invalid_arguments() {
    let fixtures = fixture("test-inputs");
    let cases: Vec<&Value> = fixtures["rejections"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case.get("expiresAt").is_some_and(Value::is_i64))
        .collect();
    assert_eq!(cases.len(), 2, "integral expiry rejections");
    for case in cases {
        let error = with_scenario(case, |s| {
            generate_test_text_code(s, key(case), options(case))
        })
        .unwrap_err();
        assert_eq!(
            error.code(),
            &ErrorCode::InvalidArgument,
            "{}",
            case["name"]
        );
    }
}

/// Untyped cases (unknown fields, wrong value types) cannot be expressed in the typed scenario;
/// neither can negative detection values, which its unsigned fields refuse when decoding.
#[test]
fn invalid_test_inputs_are_invalid_arguments() {
    let fixtures = fixture("test-inputs");
    let cases = fixtures["rejections"].as_array().unwrap();
    for case in cases.iter().filter(|case| case["typed"] == true) {
        let name = format!("{} ({})", case["name"], case["kind"]);
        if let Some(input) = case
            .get("input")
            .filter(|input| has_negative(&input["detections"]))
        {
            let decoded = serde_json::from_value::<TestInput>(input.clone());
            assert!(decoded.is_err(), "{name}: decoded");
            continue;
        }
        let error = match case["kind"].as_str().unwrap() {
            "text" => with_scenario(case, |s| {
                generate_test_text_code(s, key(case), Default::default())
            }),
            "media" => generate_media_test_code(case["signal"].as_str().unwrap(), key(case)),
            other => panic!("unknown kind {other}"),
        }
        .unwrap_err();
        assert_eq!(error.code(), &ErrorCode::InvalidArgument, "{name}");
    }
}

/// Detection scenarios the typed fields cannot express (fractional, missing or unknown values,
/// other spellings, `null`) are refused when decoding.
#[test]
fn untyped_detection_inputs_are_refused_when_decoding() {
    let fixtures = fixture("test-inputs");
    let cases: Vec<&Value> = fixtures["rejections"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["typed"] == false && case["input"].get("detections").is_some())
        .collect();
    assert!(cases.len() >= 10, "{} untyped detection cases", cases.len());
    for case in cases {
        let decoded = serde_json::from_value::<TestInput>(case["input"].clone());
        assert!(decoded.is_err(), "{}", case["name"]);
    }
}

/// A detection key given twice in a JSON scenario is refused rather than the last one winning;
/// each scenario is valid with either copy alone.
#[test]
fn duplicated_detection_keys_are_refused() {
    let valid = r#"{"instances":[],"detections":{"people":[{"box":[0,0,1,1],"confidence":5}],"faces":[{"box":[0,0,1,1],"age":{"low":1,"high":2}}]}}"#;
    let decoded: TestInput = serde_json::from_str(valid).unwrap();
    assert_eq!(
        decoded.detections.unwrap().people.unwrap(),
        vec![TestPerson {
            bounding_box: [0, 0, 1, 1],
            confidence: Some(5),
        }]
        .into()
    );
    for duplicated in [
        r#"{"instances":[],"detections":{},"detections":{}}"#,
        r#"{"instances":[],"detections":{"people":[],"people":[]}}"#,
        r#"{"instances":[],"detections":{"faces":[],"faces":"unavailable"}}"#,
        r#"{"instances":[],"detections":{"people":[{"box":[0,0,1,1],"box":[0,0,2,2]}]}}"#,
        r#"{"instances":[],"detections":{"people":[{"box":[0,0,1,1],"confidence":1,"confidence":2}]}}"#,
        r#"{"instances":[],"detections":{"faces":[{"box":[0,0,1,1],"age":"adult","age":"minor"}]}}"#,
        r#"{"instances":[],"detections":{"faces":[{"box":[0,0,1,1],"age":{"low":1,"low":2,"high":3}}]}}"#,
        r#"{"instances":[],"detections":{"faces":[{"box":[0,0,1,1],"age":{"low":1,"high":2,"high":3}}]}}"#,
    ] {
        assert!(
            serde_json::from_str::<TestInput>(duplicated).is_err(),
            "{duplicated}"
        );
    }
}

/// Detection objects given as lists of their values are refused.
#[test]
fn detection_objects_given_as_lists_are_refused() {
    for listed in [
        r#"{"instances":[],"detections":[[]]}"#,
        r#"{"instances":[],"detections":{"people":[[[0,0,1,1]]]}}"#,
        r#"{"instances":[],"detections":{"faces":[[[0,0,1,1],5]]}}"#,
        r#"{"instances":[],"detections":{"faces":[{"box":[0,0,1,1],"age":[1,2]}]}}"#,
    ] {
        assert!(
            serde_json::from_str::<TestInput>(listed).is_err(),
            "{listed}"
        );
    }
}
