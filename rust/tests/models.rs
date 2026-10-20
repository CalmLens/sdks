//! Typed decoding and encoding of nested response and request models.
use calmlens::models::*;
use serde_json::json;

#[test]
fn asset_nested_fields_decode_into_typed_models() {
    let wire = json!({
        "id": "asset-1",
        "type": "image",
        "processingOptions": { "flaggedContentPolicy": { "action": "purge" } },
        "processing": { "status": "done", "updatedAt": 5, "uploadPartsReceived": 3 },
        "content": {
            "status": "removed",
            "removalReason": "parent-removed",
            "updatedAt": 6,
            "format": "image/png",
            "extension": "png",
            "sizeInBytes": 42,
            "checksums": { "sha256": "abc", "md5": null },
            "image": { "perceptualHash": "ph", "width": 10, "height": 20 },
            "previewImage": { "fileFormat": "webp", "thumbhash": "th", "averageColor": "#000", "width": 4, "height": 8 },
            "safetyHold": { "placedAt": 1, "reason": "suspected-illegal-content", "disposedAt": null },
            "extractedText": { "type": "document", "id": "doc-1" }
        },
        "moderation": {
        "status": "rejected",
        "action": "hide",
        "note": null,
        "reviewerAction": "rejected",
        "reviewerNote": "confirmed",
        "reviewerUserId": "user-9",
        "reviewedAt": 7,
        "decidedAt": 8,
        "report": {
            "processedAt": 1,
            "score": 0.9,
            "categories": {
                "sexual": {
                    "status": "evaluated",
                    "likelihood": "likely",
                    "score": 0.9,
                    "qualifiers": {
                        "sexual-nudity": { "status": "evaluated", "score": 0.8, "likelihood": "possible" },
                        "sexual-fictional": { "status": "not-evaluated", "reason": "unavailable" }
                    }
                },
                "violence": { "status": "not-evaluated", "reason": "not-supported" }
            },
            "labels": [{ "description": "beach", "score": 0.7, "likelihood": "very-likely" }],
            "media": {
                "durationSeconds": 3,
                "sampledFrames": 1,
                "audioTranscribed": false,
                "segments": [{
                    "source": "frame-text",
                    "startSeconds": 0,
                    "endSeconds": 1,
                    "categories": { "hate": { "status": "partial", "likelihood": "unlikely", "score": 0.1 } }
                }]
            }
        }
        }
    });
    let asset: Asset = serde_json::from_value(wire).unwrap();

    assert_eq!(asset.asset_type, Some(AssetType::Image));
    assert_eq!(
        (
            &asset.processing.status,
            asset.processing.updated_at,
            asset.processing.upload_parts_received
        ),
        (&AssetProcessingStatus::Done, Some(5), Some(3))
    );
    let moderation = &asset.moderation;
    assert_eq!(
        (
            &moderation.status,
            &moderation.action,
            moderation.note.as_deref(),
            &moderation.reviewer_action,
            moderation.reviewer_note.as_deref(),
            moderation.reviewer_user_id.as_deref(),
            moderation.reviewed_at,
            moderation.decided_at
        ),
        (
            &AssetModerationStatus::Rejected,
            &Some(AssetModerationAction::Hide),
            None,
            &Some(AssetReviewerAction::Rejected),
            Some("confirmed"),
            Some("user-9"),
            Some(7),
            Some(8)
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
    let image = content.image.as_ref().unwrap();
    assert_eq!(
        (image.perceptual_hash.as_deref(), image.width, image.height),
        (Some("ph"), Some(10), Some(20))
    );
    let preview = content.preview_image.as_ref().unwrap();
    assert_eq!(
        (
            preview.file_format.as_deref(),
            preview.thumbhash.as_deref(),
            preview.average_color.as_deref(),
            preview.width,
            preview.height
        ),
        (Some("webp"), Some("th"), Some("#000"), Some(4), Some(8))
    );
    assert_eq!(
        content.safety_hold.as_ref().unwrap().reason,
        Some(SafetyHoldReason::SuspectedIllegalContent)
    );
    let text = content.extracted_text.as_ref().unwrap();
    assert_eq!(
        (&text.extraction_type, text.id.as_deref()),
        (&ExtractedTextType::Document, Some("doc-1"))
    );
    assert_eq!(
        asset
            .processing_options
            .as_ref()
            .unwrap()
            .flagged_content_policy
            .as_ref()
            .unwrap()
            .action,
        FlaggedContentAction::Purge
    );

    let report = moderation.report.as_ref().unwrap();
    let sexual = &report.categories[&ClassificationCategory::Sexual];
    assert_eq!(sexual.status, Some(EvaluationStatus::Evaluated));
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
    assert_eq!(
        report.labels.as_ref().unwrap()[0].likelihood,
        Likelihood::VeryLikely
    );
    let segment = &report.media.as_ref().unwrap().segments[0];
    assert_eq!(segment.source, MediaSegmentSource::FrameText);
    assert_eq!(
        segment.categories[&ClassificationCategory::Hate].status,
        Some(EvaluationStatus::Partial)
    );
}

#[test]
fn unknown_enum_values_and_keys_still_decode_and_round_trip() {
    let wire = json!({
        "id": "asset-1",
        "type": "hologram",
        "processing": { "status": "paused" },
        "content": { "status": "archived", "removalReason": "expired" },
        "moderation": {
            "status": "escalated",
            "action": "quarantine",
            "reviewerAction": "deferred",
            "report": {
                "categories": {
                    "spam": { "status": "skipped", "likelihood": "certain", "qualifiers": { "bots": { "status": "evaluated" } } }
                },
                "labels": [{ "description": "x", "score": 1, "likelihood": "certain" }]
            }
        }
    });
    let asset: Asset = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(
        asset.asset_type,
        Some(AssetType::Unknown("hologram".into()))
    );
    assert_eq!(
        (
            &asset.processing.status,
            &asset.moderation.status,
            &asset.moderation.action,
            &asset.moderation.reviewer_action,
            &asset.content.status,
            &asset.content.removal_reason
        ),
        (
            &AssetProcessingStatus::Unknown("paused".into()),
            &AssetModerationStatus::Unknown("escalated".into()),
            &Some(AssetModerationAction::Unknown("quarantine".into())),
            &Some(AssetReviewerAction::Unknown("deferred".into())),
            &AssetContentStatus::Unknown("archived".into()),
            &Some(AssetContentRemovalReason::Unknown("expired".into()))
        )
    );
    assert!(!asset.is_decided());
    let spam = &asset.moderation.report.as_ref().unwrap().categories
        [&ClassificationCategory::Unknown("spam".into())];
    assert_eq!(
        spam.status,
        Some(EvaluationStatus::Unknown("skipped".into()))
    );
    assert!(spam
        .qualifiers
        .as_ref()
        .unwrap()
        .contains_key(&ModerationQualifier::Unknown("bots".into())));
    let reencoded = serde_json::to_value(&asset).unwrap();
    assert_eq!(reencoded["type"], "hologram");
    assert_eq!(reencoded["moderation"]["action"], "quarantine");
    assert_eq!(reencoded["content"]["removalReason"], "expired");
    assert_eq!(
        reencoded["moderation"]["report"]["categories"]["spam"]["likelihood"],
        "certain"
    );
}

#[test]
fn flagged_content_policy_encodes_as_an_object() {
    let options = ProcessingOptions {
        flagged_content_policy: Some(FlaggedContentPolicy::new(FlaggedContentAction::Alert)),
        ..Default::default()
    };
    assert_eq!(
        serde_json::to_value(options).unwrap(),
        json!({ "flaggedContentPolicy": { "action": "alert" } })
    );
}

#[test]
fn events_decode_typed_type_severity_and_asset_snapshot() {
    let page: EventsPage = serde_json::from_value(json!({
        "events": [
            {
                "id": "e1", "type": "asset.flagged", "severity": "high", "title": "t",
                "asset": {
                    "id": "a1", "externalId": "x1",
                    "processing": { "status": "done" },
                    "moderation": { "status": "rejected", "action": "hide" },
                    "content": { "status": "removed" }
                },
                "facts": [{ "key": "flagged-categories", "value": ["sexual"] }]
            },
            { "id": "e2", "type": "billing.charged", "severity": "critical", "title": "t", "facts": [] }
        ],
        "cursor": "c",
        "hasMore": false
    }))
    .unwrap();
    let flagged = &page.events[0];
    assert_eq!(flagged.event_type, Some(EventType::AssetFlagged));
    assert_eq!(flagged.severity, Some(EventSeverity::High));
    let asset = flagged.asset.as_ref().unwrap();
    assert_eq!(
        (
            asset.id.as_str(),
            asset.external_id.as_deref(),
            &asset.processing.status,
            &asset.moderation.status,
            &asset.moderation.action,
            &asset.content.status
        ),
        (
            "a1",
            Some("x1"),
            &AssetProcessingStatus::Done,
            &AssetModerationStatus::Rejected,
            &Some(AssetModerationAction::Hide),
            &AssetContentStatus::Removed
        )
    );
    let future = &page.events[1];
    assert_eq!(
        future.event_type,
        Some(EventType::Unknown("billing.charged".into()))
    );
    assert_eq!(
        future.severity,
        Some(EventSeverity::Unknown("critical".into()))
    );

    let payload = WebhookEventPayload::from_event(flagged);
    assert_eq!(payload.event_type, EventType::AssetFlagged);
    assert_eq!(payload.data.asset.as_ref(), Some(asset));
}

#[test]
fn lens_transforms_decode_typed_image_options() {
    let lens: Lens = serde_json::from_value(json!({
        "identifier": "card",
        "type": "image",
        "transforms": [
            { "type": "imageTransform", "options": {
                "format": "webp", "fit": "cover", "flip": "hv", "segment": "foreground",
                "border": { "color": "#000", "width": 2 },
                "gravity": { "mode": "box-center", "x": 0.5 },
                "trim": { "top": 4, "border": { "tolerance": 0.2 } }
            } },
            { "type": "imageTransform", "options": { "gravity": "face", "trim": "border" } },
            { "type": "videoTransform", "options": { "fps": 12 } }
        ]
    }))
    .unwrap();
    assert_eq!(lens.lens_type, Some(LensType::Image));
    let transforms = lens.transforms.unwrap();
    let Transform::Image(first) = &transforms[0] else {
        panic!("expected an image transform, got {:?}", transforms[0]);
    };
    assert_eq!(first.format, Some(ImageFormat::Webp));
    assert_eq!(first.fit, Some(ImageFit::Cover));
    assert_eq!(first.flip, Some(ImageFlip::Hv));
    assert_eq!(first.segment, Some(ImageSegment::Foreground));
    assert_eq!(
        first.border.as_ref().map(|b| (b.color.as_deref(), b.width)),
        Some((Some("#000"), Some(2.0)))
    );
    assert_eq!(
        first.gravity,
        Some(Gravity::Point(GravityPoint {
            mode: GravityMode::BoxCenter,
            x: Some(0.5),
            y: None
        }))
    );
    let Some(Trim::Edges(edges)) = &first.trim else {
        panic!("expected trim edges, got {:?}", first.trim);
    };
    assert_eq!(edges.top, Some(4.0));
    assert_eq!(
        edges.border,
        Some(TrimBorder::Options(TrimBorderOptions {
            tolerance: Some(0.2),
            ..Default::default()
        }))
    );

    let Transform::Image(second) = &transforms[1] else {
        panic!("expected an image transform, got {:?}", transforms[1]);
    };
    assert_eq!(second.gravity, Some(GravityPosition::Face.into()));
    assert_eq!(second.trim, Some(TrimMode::Border.into()));

    assert_eq!(
        transforms[2],
        Transform::Unknown {
            transform_type: "videoTransform".into(),
            options: json!({ "fps": 12 })
        }
    );
    assert_eq!(
        serde_json::to_value(&transforms[2]).unwrap(),
        json!({ "type": "videoTransform", "options": { "fps": 12 } })
    );
}

#[test]
fn typed_image_transform_serializes_to_wire_options_and_selector() {
    let transform = Transform::image(ImageTransformOptions {
        format: Some(ImageFormat::Avif),
        gravity: Some(GravityPosition::Entropy.into()),
        trim: Some(Trim::Edges(TrimEdges {
            left: Some(3.0),
            border: Some(TrimBorder::Enabled(true)),
            ..Default::default()
        })),
        ..Default::default()
    });
    assert_eq!(
        serde_json::to_value(&transform).unwrap(),
        json!({ "type": "imageTransform", "options": {
            "format": "avif", "gravity": "entropy", "trim": { "left": 3.0, "border": true }
        } })
    );
    assert_eq!(
        CdnTransform::from(transform).selector().unwrap(),
        "imageTransform[format=avif,gravity=entropy,trim%5Bborder%5D=true,trim%5Bleft%5D=3]"
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
        limit: None,
    };
    assert_eq!(
        serde_json::to_value(request).unwrap(),
        json!({ "query": "beach", "mode": "semantic" })
    );
}

#[test]
fn newer_event_types_decode_to_their_own_variants() {
    let decode = |wire: &str| serde_json::from_value::<EventType>(json!(wire)).unwrap();
    assert_eq!(decode("asset.deleted"), EventType::AssetDeleted);
    assert_eq!(
        decode("asset.content-removed"),
        EventType::AssetContentRemoved
    );
    assert_eq!(decode("asset.retried"), EventType::AssetRetried);
    assert_eq!(
        decode("usage.spend-limit-reached"),
        EventType::UsageSpendLimitReached
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
