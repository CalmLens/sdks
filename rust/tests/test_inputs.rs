//! Signed test inputs match the shared contract in `testdata/test-inputs.json`.
mod common;
use calmlens::testing::{
    generate_media_test_code, generate_test_text_code, test_input_for_signal, TestInput,
    TestInputKind, TestInputPreset, TestScenario, MEDIA_TEST_SIGNALS, TEST_INPUT_SIGNALS,
};
use calmlens::ErrorCode;
use common::{fixture, typed};
use serde_json::Value;

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
