//! Signed test inputs match the shared contract in `testdata/test-inputs.json`.
mod common;
use calmlens::testing::{
    generate_media_test_code, generate_test_text_code, paint_test_image, test_input_for_signal,
    TestImage, TestInput, TestInputKind, TestInputPreset, TestScenario, MEDIA_TEST_SIGNALS,
    TEST_INPUT_SIGNALS,
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
        let code = with_scenario(case, |s| generate_test_text_code(s, key(case))).unwrap();
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

/// Each cell's level as `packages/sdk-contract/testInputs.ts` records it: the index of the cell's
/// first red value among the data levels, or -1.
fn fixture_levels(image: &TestImage, cells: usize) -> String {
    let levels = [72, 128, 184, 240];
    let width = image.width as usize;
    let size = width / cells;
    (0..cells * cells)
        .map(|cell| {
            let red = image.rgba[((cell / cells) * size * width + (cell % cells) * size) * 4];
            levels
                .iter()
                .position(|&level| level == red)
                .map_or(-1, |index| index as i32)
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
        let image = with_scenario(case, |s| paint_test_image(s, key(case))).unwrap();
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
        let error = with_scenario(case, |s| paint_test_image(s, key(case))).unwrap_err();
        assert_eq!(
            error.code(),
            &ErrorCode::InvalidArgument,
            "{}",
            case["name"]
        );
    }
}

/// Untyped cases (unknown fields, wrong value types) cannot be expressed in the typed scenario.
#[test]
fn invalid_test_inputs_are_invalid_arguments() {
    let fixtures = fixture("test-inputs");
    let cases = fixtures["rejections"].as_array().unwrap();
    for case in cases.iter().filter(|case| case["typed"] == true) {
        let name = format!("{} ({})", case["name"], case["kind"]);
        let error = match case["kind"].as_str().unwrap() {
            "text" => with_scenario(case, |s| generate_test_text_code(s, key(case))),
            "media" => generate_media_test_code(case["signal"].as_str().unwrap(), key(case)),
            other => panic!("unknown kind {other}"),
        }
        .unwrap_err();
        assert_eq!(error.code(), &ErrorCode::InvalidArgument, "{name}");
    }
}
