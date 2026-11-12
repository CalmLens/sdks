//! Typed decoding and encoding of nested response and request models.
use calmlens::models::*;
use serde_json::json;

#[test]
fn an_hls_stream_reads_its_status_and_reason() {
    let hls: AssetHls = serde_json::from_value(
        json!({"status":"unavailable","reason":"allowance-used","renditions":[]}),
    )
    .unwrap();
    assert_eq!(hls.status, "unavailable");
    assert_eq!(hls.reason, Some(AssetHlsUnavailableReason::AllowanceUsed));
    assert!(hls.renditions.is_empty());
}

#[test]
fn an_hls_stream_decodes_into_typed_renditions() {
    let hls: AssetHls = serde_json::from_value(json!({"renditions":[{"kind":"video","width":1280,"height":720,"bandwidth":2500000,"codecs":"avc1.64001f"},{"kind":"audio","width":null,"height":null,"bandwidth":128000,"codecs":"mp4a.40.2"}]})).unwrap();
    let summary: Vec<_> = hls
        .renditions
        .iter()
        .map(|r| (&r.kind, r.width, r.height, r.bandwidth, r.codecs.as_str()))
        .collect();
    assert_eq!(
        summary,
        [
            (
                &AssetHlsRenditionKind::Video,
                Some(1280),
                Some(720),
                2_500_000,
                "avc1.64001f"
            ),
            (
                &AssetHlsRenditionKind::Audio,
                None,
                None,
                128_000,
                "mp4a.40.2"
            ),
        ]
    );
}

#[test]
fn asset_nested_fields_decode_into_typed_models() {
    let wire = json!({"id":"asset-1","type":"image","content":{"status":"removed","removalReason":"parent-removed","updatedAt":6,"format":"image/png","extension":"png","sizeInBytes":42,"checksums":{"sha256":"abc","md5":null},"width":10,"height":20,"durationSeconds":null,"pageCount":null,"perceptualHash":"ph","perceptualHashQuality":87,"metadata":{"capturedAt":"2026-05-01T12:30:00","cameraMake":"Canon","cameraModel":null,"lensModel":null,"software":null,"creator":null,"copyright":null,"digitalSourceType":null,"containsLocation":true,"location":null},"rendered":{"kind":"image","format":"image/webp","width":10,"height":20},"preview":{"width":10,"height":20,"thumbhash":"th","averageColor":"#000"},"safetyHold":{"placedAt":1,"reason":"suspected-illegal-content","disposedAt":null},"extractedText":{"type":"document","id":"doc-1"}},"upload":{"status":"completed","updatedAt":5,"partsReceived":3},"classification":{"status":"completed","updatedAt":5,"moderation":{"manualReviews":[{"id":"review-1","decision":"age-restricted","note":"confirmed","decidedBy":{"type":"user","id":"user-1"},"reviewedAt":7,"applied":true}],"status":"age-restricted","automatedStatus":"limited","flaggedCategories":[],"regions":[{"region":"DE","status":"blocked","rule":"de-jmstv","category":"sexual"}],"timeline":{"segmentCount":3},"raw":{"categories":{"sexual":{"status":"evaluated","likelihood":"likely","score":0.9,"qualifiers":{"sexual-nudity":{"status":"evaluated","score":0.8,"likelihood":"possible"},"sexual-fictional":{"status":"not-evaluated","reason":"unavailable"}}},"violence":{"status":"not-evaluated","reason":"not-supported"}},"hashMatches":[{"source":"hash-list","hashListId":"list-1","hashListEntryId":"entry-1","distance":4,"action":"block"}]},"linkSafety":{"action":"age-restrict","links":[{"url":"https://bit.example/x","finalUrl":null,"redirects":2,"source":"text","verdict":"gambling","evidence":[]}],"settings":{"verdictActions":{"gambling":"age-restrict","phishing":"block"},"offPlatformLinks":{"action":"limit","allowedDomains":["example.com"]}}}},"completedAt":8,"linkDetection":{"status":"evaluated","qrCodes":[{"value":"https://example.com","box":{"left":0.1,"top":0.2,"width":0.3,"height":0.4}}],"links":[{"url":"https://example.com","source":"qr-code"}]},"linkSafety":{"status":"evaluated","links":[{"url":"https://example.com","finalUrl":"https://example.com/","redirects":0,"source":"qr-code","verdict":"safe","evidence":[]},{"url":"https://bit.example/x","finalUrl":null,"redirects":2,"source":"text","verdict":"unresolved","evidence":[{"check":"threat-lists","status":"failed","labels":[]},{"check":"domain-categories","status":"checked","labels":["gambling"]}]}]},"aiGeneratedDetection":{"status":"evaluated","provenance":"ai-edited","signals":[{"kind":"c2pa","value":"trainedAlgorithmicMedia"}]},"ocr":{"status":"evaluated","textRegions":[{"box":{"left":0.5,"top":0.5,"width":0.1,"height":0.1},"personalInformation":true}]}}});
    let asset: Asset = serde_json::from_value(wire).unwrap();

    assert_eq!(asset.asset_type, AssetType::Image);
    assert_eq!(
        (
            &asset.classification.status,
            asset.classification.updated_at,
            asset.upload.parts_received
        ),
        (&AssetClassificationStatus::Completed, Some(5), Some(3))
    );
    let moderation = &asset.classification.moderation;
    assert_eq!(
        (
            &moderation.status,
            &moderation.manual_reviews[0].decision,
            moderation.manual_reviews[0].note.as_deref(),
            Some(moderation.manual_reviews[0].reviewed_at),
            asset.classification.completed_at
        ),
        (
            &AssetModerationStatus::AgeRestricted,
            &AssetModerationDecision::AgeRestricted,
            Some("confirmed"),
            Some(7),
            Some(8)
        )
    );
    let review = &moderation.manual_reviews[0];
    assert_eq!(
        (
            &review.decided_by.actor_type,
            review.decided_by.id.as_deref(),
            review.applied
        ),
        (&ReviewActorType::User, Some("user-1"), true)
    );
    assert_eq!(
        moderation.automated_status,
        Some(AssetModerationDecision::Limited)
    );
    let region = &moderation.regions[0];
    assert_eq!(
        (
            region.region.as_str(),
            &region.status,
            region.rule.as_str(),
            &region.category
        ),
        (
            "DE",
            &RegionalDecisionStatus::Blocked,
            "de-jmstv",
            &Some(ClassificationCategory::Sexual)
        )
    );
    assert!(asset.is_decided());
    let content = &asset.content;
    assert_eq!(
        (
            &content.status,
            &content.removal_reason,
            content.updated_at,
            content.format.as_deref(),
            content.extension.as_deref(),
            content.size_in_bytes
        ),
        (
            &AssetContentStatus::Removed,
            &Some(AssetContentRemovalReason::ParentRemoved),
            Some(6),
            Some("image/png"),
            Some("png"),
            Some(42)
        )
    );
    let checksums = content.checksums.as_ref().unwrap();
    assert_eq!(
        (checksums.sha256.as_deref(), checksums.md5.as_deref()),
        (Some("abc"), None)
    );
    assert_eq!(
        (
            content.width,
            content.height,
            content.perceptual_hash.as_deref(),
            content.perceptual_hash_quality
        ),
        (Some(10), Some(20), Some("ph"), Some(87))
    );
    let metadata = content.metadata.as_ref().unwrap();
    assert_eq!(
        (metadata.camera_make.as_deref(), metadata.contains_location),
        (Some("Canon"), true)
    );
    let rendered = content.rendered.as_ref().unwrap();
    assert_eq!(
        (&rendered.kind, rendered.format.as_str(), rendered.width),
        (&AssetRenderedKind::Image, "image/webp", Some(10))
    );
    let preview = content.preview.as_ref().unwrap();
    assert_eq!(
        (
            preview.height,
            preview.thumbhash.as_deref(),
            preview.average_color.as_deref()
        ),
        (Some(20), Some("th"), Some("#000"))
    );
    assert_eq!(
        content.safety_hold.as_ref().unwrap().reason,
        SafetyHoldReason::SuspectedIllegalContent
    );
    let text = content.extracted_text.as_ref().unwrap();
    assert_eq!(
        (&text.extraction_type, text.id.as_deref()),
        (&ExtractedTextType::Document, Some("doc-1"))
    );

    let report = asset.classification.moderation.raw.as_ref().unwrap();
    let sexual = &report.categories[&ClassificationCategory::Sexual];
    assert_eq!(sexual.status, EvaluationStatus::Evaluated);
    assert_eq!(sexual.likelihood, Some(Likelihood::Likely));
    let qualifiers = sexual.qualifiers.as_ref().unwrap();
    assert_eq!(
        qualifiers[&ModerationQualifier::SexualNudity].likelihood,
        Some(Likelihood::Possible)
    );
    assert_eq!(
        qualifiers[&ModerationQualifier::SexualFictional].reason,
        Some(NotEvaluatedReason::Unavailable)
    );
    assert_eq!(
        report.categories[&ClassificationCategory::Violence].reason,
        Some(NotEvaluatedReason::NotSupported)
    );
    let hash_match = &report.hash_matches[0];
    assert_eq!(
        (
            hash_match.hash_list_id.as_str(),
            hash_match.hash_list_entry_id.as_str(),
            hash_match.distance,
            &hash_match.action
        ),
        ("list-1", "entry-1", 4.0, &HashListAction::Block)
    );
    let links = asset.classification.link_detection.as_ref().unwrap();
    assert_eq!(links.qr_codes.as_ref().unwrap()[0].bounding_box.top, 0.2);
    assert_eq!(links.links.as_ref().unwrap()[0].source, LinkSource::QrCode);
    let checked = asset.classification.link_safety.as_ref().unwrap();
    let checked_links = checked.links.as_ref().unwrap();
    assert_eq!(
        (
            checked_links[0].final_url.as_deref(),
            &checked_links[0].verdict,
            checked_links[1].final_url.as_deref(),
            checked_links[1].redirects,
            &checked_links[1].source,
            &checked_links[1].verdict
        ),
        (
            Some("https://example.com/"),
            &LinkSafetyVerdict::Safe,
            None,
            2,
            &LinkSource::Text,
            &LinkSafetyVerdict::Unresolved
        )
    );
    let evidence = &checked_links[1].evidence;
    assert_eq!(
        (
            &evidence[0].check,
            &evidence[0].status,
            &evidence[1].check,
            &evidence[1].status,
            evidence[1].labels.as_slice()
        ),
        (
            &LinkSafetyCheck::ThreatLists,
            &LinkSafetyCheckStatus::Failed,
            &LinkSafetyCheck::DomainCategories,
            &LinkSafetyCheckStatus::Checked,
            ["gambling".to_owned()].as_slice()
        )
    );
    let link_decision = moderation.link_safety.as_ref().unwrap();
    let flagged: Vec<_> = link_decision
        .links
        .iter()
        .map(|link| (link.url.as_str(), link.redirects, &link.verdict))
        .collect();
    assert_eq!(
        (&link_decision.action, flagged.as_slice()),
        (
            &LinkSafetyAction::AgeRestrict,
            [("https://bit.example/x", 2, &LinkSafetyVerdict::Gambling)].as_slice()
        )
    );
    assert_eq!(
        (
            &link_decision.settings.verdict_actions[&LinkSafetyVerdict::Gambling],
            &link_decision.settings.verdict_actions[&LinkSafetyVerdict::Phishing]
        ),
        (&LinkSafetyAction::AgeRestrict, &LinkSafetyAction::Block)
    );
    let off_platform = link_decision.settings.off_platform_links.as_ref().unwrap();
    assert_eq!(
        (
            &off_platform.action,
            off_platform.allowed_domains.as_slice()
        ),
        (
            &LinkSafetyAction::Limit,
            ["example.com".to_owned()].as_slice()
        )
    );
    let provenance = asset
        .classification
        .ai_generated_detection
        .as_ref()
        .unwrap();
    assert_eq!(
        (
            &provenance.provenance,
            &provenance.signals.as_ref().unwrap()[0].kind
        ),
        (&Some(AiProvenance::AiEdited), &AiSignalKind::C2pa)
    );
    let ocr = asset.classification.ocr.as_ref().unwrap();
    assert_eq!(ocr.status, FeatureResultStatus::Evaluated);
    let region = &ocr.text_regions.as_ref().unwrap()[0];
    assert!(region.personal_information);
    assert_eq!(region.bounding_box.left, 0.5);
    assert_eq!(moderation.timeline.as_ref().unwrap().segment_count, 3);
    let page: AssetTimelinePage = serde_json::from_value(json!({"items":[{"source":"frame-text","startSeconds":0,"endSeconds":1,"categories":{"hate":{"status":"partial","likelihood":"unlikely","score":0.1}}}],"nextCursor":null,"hasMore":false})).unwrap();
    let segment = &page.items[0];
    assert_eq!(segment.source, MediaSegmentSource::FrameText);
    assert_eq!(
        segment.categories[&ClassificationCategory::Hate].status,
        EvaluationStatus::Partial
    );
}

#[test]
fn unknown_enum_values_and_keys_still_decode_and_round_trip() {
    let wire = json!({"id":"asset-1","type":"hologram","content":{"status":"archived","removalReason":"expired"},"upload":{"status":"completed"},"classification":{"status":"paused","moderation":{"manualReviews":[{"id":"review-1","decision":"deferred","note":null,"decidedBy":{"type":"assistant","id":null},"reviewedAt":7,"applied":true}],"status":"escalated","flaggedCategories":[],"regions":[],"raw":{"categories":{"spam":{"status":"skipped","likelihood":"certain","qualifiers":{"bots":{"status":"evaluated"}}}}}}}});
    let asset: Asset = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(asset.asset_type, AssetType::Unknown("hologram".into()));
    assert_eq!(
        (
            &asset.classification.status,
            &asset.classification.moderation.status,
            &asset.classification.moderation.manual_reviews[0].decision,
            &asset.content.status,
            &asset.content.removal_reason
        ),
        (
            &AssetClassificationStatus::Unknown("paused".into()),
            &AssetModerationStatus::Unknown("escalated".into()),
            &AssetModerationDecision::Unknown("deferred".into()),
            &AssetContentStatus::Unknown("archived".into()),
            &Some(AssetContentRemovalReason::Unknown("expired".into()))
        )
    );
    assert_eq!(
        asset.classification.moderation.manual_reviews[0]
            .decided_by
            .actor_type,
        ReviewActorType::Unknown("assistant".into())
    );
    // Only `completed` and `failed` settle an asset, so a classification status this SDK version
    // does not know is still waiting, whatever the moderation status says.
    assert!(!asset.is_decided());
    let spam = &&asset
        .classification
        .moderation
        .raw
        .as_ref()
        .unwrap()
        .categories[&ClassificationCategory::Unknown("spam".into())];
    assert_eq!(spam.status, EvaluationStatus::Unknown("skipped".into()));
    assert!(spam
        .qualifiers
        .as_ref()
        .unwrap()
        .contains_key(&ModerationQualifier::Unknown("bots".into())));
    let reencoded = serde_json::to_value(&asset).unwrap();
    assert_eq!(reencoded["type"], "hologram");
    assert_eq!(
        reencoded["classification"]["moderation"]["status"],
        "escalated"
    );
    assert_eq!(reencoded["content"]["removalReason"], "expired");
    assert_eq!(
        reencoded["classification"]["moderation"]["manualReviews"][0]["decidedBy"]["type"],
        "assistant"
    );
    assert_eq!(
        reencoded["classification"]["moderation"]["raw"]["categories"]["spam"]["likelihood"],
        "certain"
    );
}

#[test]
fn events_decode_typed_type_severity_and_asset_snapshot() {
    let page: EventsPage = serde_json::from_value(json!({
      "items": [
        {
          "id": "e1",
          "projectId": "p1",
          "createdAt": 1,
          "type": "asset.blocked",
          "severity": "high",
          "title": "t",
          "asset": {
            "id": "a1",
            "externalId": "x1",
            "content": {
              "status": "removed"
            },
            "upload": {
              "status": "completed"
            },
            "classification": {
              "status": "completed",
              "testInput": true,
              "moderation": {
                "status": "blocked"
              }
            }
          },
          "facts": [
            {
              "key": "flagged-categories",
              "value": [
                "sexual"
              ]
            }
          ]
        },
        {
          "id": "e2",
          "projectId": "p1",
          "createdAt": 2,
          "type": "billing.charged",
          "severity": "critical",
          "title": "t",
          "facts": []
        }
      ],
      "nextCursor": "c",
      "hasMore": false
    }))
    .unwrap();
    let blocked = &page.items[0];
    assert_eq!(blocked.event_type, EventType::AssetBlocked);
    assert_eq!(blocked.severity, EventSeverity::High);
    let asset = blocked.asset.as_ref().unwrap();
    assert_eq!(
        (
            asset.id(),
            asset.external_id(),
            asset.classification_status(),
            asset.test_input(),
            asset.moderation_status(),
            asset.content_status()
        ),
        (
            "a1",
            Some("x1"),
            Some(AssetClassificationStatus::Completed),
            Some(true),
            Some(AssetModerationStatus::Blocked),
            Some(AssetContentStatus::Removed)
        )
    );
    let future = &page.items[1];
    assert_eq!(
        future.event_type,
        EventType::Unknown("billing.charged".into())
    );
    assert_eq!(future.severity, EventSeverity::Unknown("critical".into()));

    let payload = WebhookEventPayload::from_event(blocked);
    assert_eq!(payload.event_type, EventType::AssetBlocked);
    assert_eq!(payload.asset.as_ref(), Some(asset));
}

#[test]
fn lens_transform_decodes_typed_image_options() {
    let lens: Lens = serde_json::from_value(json!({
        "identifier": "card",
        "type": "image",
        "transform": {
            "format": "webp", "fit": "cover", "flip": "hv", "segment": "foreground",
            "border": { "color": "#000", "width": 2 },
            "gravity": { "mode": "box-center", "x": 0.5 },
            "trim": { "top": 4, "border": { "tolerance": 0.2 } },
            "fps": 12
        }
    }))
    .unwrap();
    assert_eq!(lens.lens_type, LensType::Image);
    let options = lens.transform.unwrap();
    assert_eq!(options.format, Some(ImageFormat::Webp));
    assert_eq!(options.fit, Some(ImageFit::Cover));
    assert_eq!(options.flip, Some(ImageFlip::Hv));
    assert_eq!(options.segment, Some(ImageSegment::Foreground));
    assert_eq!(
        options
            .border
            .as_ref()
            .map(|b| (b.color.as_deref(), b.width)),
        Some((Some("#000"), Some(2.0)))
    );
    assert_eq!(
        options.gravity,
        Some(Gravity::Point(GravityPoint {
            mode: GravityMode::BoxCenter,
            x: Some(0.5),
            y: None
        }))
    );
    let Some(Trim::Edges(edges)) = &options.trim else {
        panic!("expected trim edges, got {:?}", options.trim);
    };
    assert_eq!(edges.top, Some(4.0));
    assert_eq!(
        edges.border,
        Some(TrimBorder::Options(TrimBorderOptions {
            tolerance: Some(0.2),
            ..Default::default()
        }))
    );
    // An option this SDK version does not know is kept as received.
    assert_eq!(options.extra.get("fps"), Some(&json!(12)));

    let modes: ImageTransformOptions =
        serde_json::from_value(json!({ "gravity": "face", "trim": "border" })).unwrap();
    assert_eq!(modes.gravity, Some(GravityPosition::Face.into()));
    assert_eq!(modes.trim, Some(TrimMode::Border.into()));
}

#[test]
fn typed_image_transform_serializes_to_wire_options_and_selector() {
    let options = ImageTransformOptions {
        format: Some(ImageFormat::Avif),
        gravity: Some(GravityPosition::Entropy.into()),
        trim: Some(Trim::Edges(TrimEdges {
            left: Some(3.0),
            border: Some(TrimBorder::Enabled(true)),
            ..Default::default()
        })),
        ..Default::default()
    };
    assert_eq!(
        serde_json::to_value(&options).unwrap(),
        json!({ "format": "avif", "gravity": "entropy", "trim": { "left": 3.0, "border": true } })
    );
    assert_eq!(
        CdnTransform::from(options).selector().unwrap(),
        "format=avif,gravity=entropy,trim.border=true,trim.left=3"
    );
    let quality = CdnTransform::from(ImageTransformOptions {
        dpr: Some(2.0),
        anim: Some(false),
        quality: Some(ImageQualityLevel::High.into()),
        background: Some("#FFAA00".into()),
        ..Default::default()
    });
    assert_eq!(
        quality.selector().unwrap(),
        "anim=false,background=ffaa00,dpr=2,quality=high"
    );
    let options: ImageTransformOptions =
        serde_json::from_value(json!({ "quality": 80, "dpr": 1.5 })).unwrap();
    assert_eq!(options.quality, Some(ImageQuality::Value(80)));
    let upper_case: ImageTransformOptions = serde_json::from_value(json!({ "Width": 1 })).unwrap();
    assert_eq!(
        CdnTransform::from(upper_case)
            .selector()
            .unwrap_err()
            .code(),
        &"sdk/invalid-argument"
    );
}

#[test]
fn search_models_use_typed_mode_status_and_fields() {
    let response: AssetSearchResponse = serde_json::from_value(json!({
        "query": "beach",
        "items": [{ "asset": { "id": "a1" }, "score": 1, "matchedFields": ["externalId", "visual", "audio"] }],
        "semanticStatus": "indexing"
    }))
    .unwrap();
    assert_eq!(response.semantic_status, SemanticStatus::Indexing);
    assert_eq!(
        response.items[0].matched_fields,
        vec![
            SearchMatchField::ExternalId,
            SearchMatchField::Visual,
            SearchMatchField::Unknown("audio".into())
        ]
    );
    let request = SearchAssets {
        query: "beach".into(),
        mode: Some(SearchMode::Semantic),
        page_size: None,
    };
    assert_eq!(
        serde_json::to_value(request).unwrap(),
        json!({ "query": "beach", "mode": "semantic" })
    );
}

#[test]
fn newer_event_types_decode_to_their_own_variants() {
    let decode = |wire: &str| serde_json::from_value::<EventType>(json!(wire)).unwrap();
    assert_eq!(decode("asset.limited"), EventType::AssetLimited);
    assert_eq!(decode("asset.deleted"), EventType::AssetDeleted);
    assert_eq!(
        decode("asset.content-removed"),
        EventType::AssetContentRemoved
    );
    assert_eq!(decode("asset.retried"), EventType::AssetRetried);
    assert_eq!(
        decode("asset.rerun-requested"),
        EventType::AssetRerunRequested
    );
    assert_eq!(
        decode("usage.uploads-paused"),
        EventType::UsageUploadsPaused
    );
    assert_eq!(
        decode("usage.free-uploads-exhausted"),
        EventType::UsageFreeUploadsExhausted
    );
    assert_eq!(
        decode("asset.progress-updated"),
        EventType::AssetProgressUpdated
    );
    assert_eq!(decode("connector.disabled"), EventType::ConnectorDisabled);
    assert_eq!(decode("project.member-left"), EventType::ProjectMemberLeft);
    assert_eq!(decode("api-key.deleted"), EventType::ApiKeyDeleted);
    assert_eq!(
        decode("usage.spend-limit-reached"),
        EventType::Unknown("usage.spend-limit-reached".into())
    );
    assert_eq!(
        decode("upload-preset.daily-limit-reached"),
        EventType::UploadPresetDailyLimitReached
    );
    assert_eq!(
        decode("project.member-removed"),
        EventType::ProjectMemberRemoved
    );
    assert_eq!(
        decode("project.member-role-changed"),
        EventType::ProjectMemberRoleChanged
    );
    assert_eq!(
        decode("project.invitation-sent"),
        EventType::ProjectInvitationSent
    );
    assert_eq!(decode("api-key.created"), EventType::ApiKeyCreated);
    assert_eq!(decode("api-key.revoked").as_str(), "api-key.revoked");
    assert_eq!(
        decode("api-key.rotated"),
        EventType::Unknown("api-key.rotated".into())
    );
}

#[test]
fn report_policy_snapshot_decodes_into_typed_models() {
    let policy: AssetModeration = serde_json::from_str(r#"{"categories":{"violence":{"score":0.9,"action":"block","source":{"kind":"allowance","indexes":[0,1]},"settings":{"action":"block","allowances":[],"restrictions":[{"name":"snapshot-rule","when":["violence-graphic","violence-injury"],"unless":["violence-documentary"],"action":"block"}]}}},"explanationComplete":true,"source":"hash-list","flaggedCategories":["violence"],"automatedStatus":"purged"}"#).unwrap();
    let category = &policy.categories.as_ref().unwrap()[&ClassificationCategory::Violence];
    let settings = category.settings.as_ref().unwrap();
    assert_eq!(settings.action, "block");
    assert_eq!(
        settings.restrictions[0].name.as_deref(),
        Some("snapshot-rule")
    );
    assert_eq!(
        settings.restrictions[0].unless.as_deref(),
        Some([ModerationQualifier::from("violence-documentary")].as_slice())
    );
    assert_eq!(
        category.source.as_ref().unwrap().indexes.as_deref(),
        Some([0, 1].as_slice())
    );
    let decision = &policy;
    assert_eq!(decision.source, Some(ModerationSource::HashList));
    assert_eq!(
        decision.automated_status,
        Some(AssetModerationDecision::Purged)
    );
    assert_eq!(
        decision.flagged_categories,
        vec![ClassificationCategory::Violence]
    );
}

#[test]
fn an_over_long_newest_post_is_kept_alone_for_the_api_to_reject() {
    let newest = ModerationContextItem::new("n".repeat(MODERATION_CONTEXT_USED_CHARACTERS + 1))
        .author_id("user-2");
    let items = vec![ModerationContextItem::new("earlier"), newest.clone()];
    assert_eq!(select_moderation_context_items(&items), vec![newest]);
    assert_eq!(select_moderation_context_items(&[]), Vec::new());
}

/// Updating settings replaces them, so sending back those read must keep every one, including
/// clearing what is unset and a setting this SDK version doesn't know.
#[test]
fn settings_read_convert_to_a_definition_holding_every_setting() {
    let read = json!({
        "retainContent": true,
        "optOutJurisdictions": ["EU"],
        "blockUnmoderatedAssets": false,
        "storeSensitiveMetadata": true,
        "streamingEnabled": true,
        "aiMediaSearchEnabled": true,
        "linkCheckingEnabled": true,
        "remoteUrlRule": null,
        "websiteSubmissionsPerMinute": 5,
        "humanReview": {
            "allowedSamplePercent": 1.5,
            "restrictedSamplePercent": 2.5,
            "uncertaintyMarginPercent": 3.5,
            "reviewMissingEvidence": true,
        },
        "futureSetting": "kept",
    });
    let settings: ProjectSettings = serde_json::from_value(read.clone()).unwrap();
    let definition = ProjectSettingsDefinition::from(settings);
    assert_eq!(serde_json::to_value(definition).unwrap(), read);
}
