//! Typed decoding and encoding of nested response and request models.
use calmlens::models::*;
use serde_json::json;

#[test]
fn asset_nested_fields_decode_into_typed_models() {
    let wire = json!({
      "id": "asset-1",
      "type": "image",
      "processingOptions": {
        "flaggedContentPolicy": {
          "action": "purge"
        }
      },
      "content": {
        "status": "removed",
        "removalReason": "parent-removed",
        "updatedAt": 6,
        "format": "image/png",
        "extension": "png",
        "sizeInBytes": 42,
        "checksums": {
          "sha256": "abc",
          "md5": null
        },
        "image": {
          "width": 10,
          "height": 20,
          "thumbhash": "th",
          "averageColor": "#000",
          "perceptualHash": "ph",
          "perceptualHashQuality": 87
        },
        "safetyHold": {
          "placedAt": 1,
          "reason": "suspected-illegal-content",
          "disposedAt": null
        },
        "extractedText": {
          "type": "document",
          "id": "doc-1"
        }
      },
      "upload": {
        "status": "completed",
        "updatedAt": 5,
        "partsReceived": 3
      },
      "classification": {
        "status": "completed",
        "updatedAt": 5,
        "moderation": {
          "manualReviews": [{"id": "review-1", "decision": "age-restricted", "note": "confirmed", "reviewerUserId": "user-9", "reviewedAt": 7, "appliedToAsset": true}],
          "status": "age-restricted",
          "categories": {
            "sexual": {
              "status": "evaluated",
              "likelihood": "likely",
              "score": 0.9,
              "qualifiers": {
                "sexual-nudity": {
                  "status": "evaluated",
                  "score": 0.8,
                  "likelihood": "possible"
                },
                "sexual-fictional": {
                  "status": "not-evaluated",
                  "reason": "unavailable"
                }
              }
            },
            "violence": {
              "status": "not-evaluated",
              "reason": "not-supported"
            }
          },
          "score": 0.9,
          "hashMatches": [{"source": "hash-list", "listId": "list-1", "entryId": "entry-1", "distance": 4, "action": "block"}],
          "timeline": {
            "durationSeconds": 3,
            "sampledFrames": 1,
            "audioTranscribed": false,
            "segments": [
              {
                "source": "frame-text",
                "startSeconds": 0,
                "endSeconds": 1,
                "categories": {
                  "hate": {
                    "status": "partial",
                    "likelihood": "unlikely",
                    "score": 0.1
                  }
                }
              }
            ]
          }
        },
        "completedAt": 8,
        "linkDetection": {
          "status": "evaluated",
          "stage": "beta",
          "qrCodes": [{"value": "https://example.com", "box": {"left": 0.1, "top": 0.2, "width": 0.3, "height": 0.4}}],
          "links": [{"url": "https://example.com", "source": "qr-code"}]
        },
        "aiGeneratedDetection": {
          "status": "evaluated",
          "stage": "beta",
          "provenance": "ai-edited",
          "signals": [{"kind": "c2pa", "value": "trainedAlgorithmicMedia"}]
        },
        "textRegions": [{"box": {"left": 0.5, "top": 0.5, "width": 0.1, "height": 0.1}, "personalInformation": true}],
        "labels": [
          {
            "description": "beach",
            "score": 0.7,
            "likelihood": "very-likely"
          }
        ]
      }
    });
    let asset: Asset = serde_json::from_value(wire).unwrap();

    assert_eq!(asset.asset_type, Some(AssetType::Image));
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
            moderation.manual_reviews[0].reviewer_user_id.as_deref(),
            Some(moderation.manual_reviews[0].reviewed_at),
            asset.classification.completed_at
        ),
        (
            &AssetModerationStatus::AgeRestricted,
            &AssetModerationDecision::AgeRestricted,
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
        (
            image.width,
            image.height,
            image.thumbhash.as_deref(),
            image.average_color.as_deref(),
            image.perceptual_hash.as_deref(),
            image.perceptual_hash_quality
        ),
        (
            Some(10),
            Some(20),
            Some("th"),
            Some("#000"),
            Some("ph"),
            Some(87)
        )
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

    let report = &asset.classification.moderation;
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
        asset.classification.labels.as_ref().unwrap()[0].likelihood,
        Likelihood::VeryLikely
    );
    let hash_match = &report.hash_matches.as_ref().unwrap()[0];
    assert_eq!(
        (
            hash_match.list_id.as_str(),
            hash_match.entry_id.as_str(),
            hash_match.distance,
            &hash_match.action
        ),
        ("list-1", "entry-1", 4.0, &HashListAction::Block)
    );
    let links = asset.classification.link_detection.as_ref().unwrap();
    assert_eq!(links.qr_codes.as_ref().unwrap()[0].bounding_box.top, 0.2);
    assert_eq!(links.links.as_ref().unwrap()[0].source, LinkSource::QrCode);
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
    let region = &asset.classification.text_regions.as_ref().unwrap()[0];
    assert!(region.personal_information);
    assert_eq!(region.bounding_box.left, 0.5);
    let segment = &report.timeline.as_ref().unwrap().segments[0];
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
      "content": {
        "status": "archived",
        "removalReason": "expired"
      },
      "upload": {
        "status": "completed"
      },
      "classification": {
        "status": "paused",
        "moderation": {
          "manualReviews": [{"id": "review-1", "decision": "deferred", "note": null, "reviewerUserId": null, "reviewedAt": 7, "appliedToAsset": true}],
          "status": "escalated",
          "categories": {
            "spam": {
              "status": "skipped",
              "likelihood": "certain",
              "qualifiers": {
                "bots": {
                  "status": "evaluated"
                }
              }
            }
          }
        },
        "labels": [
          {
            "description": "x",
            "score": 1,
            "likelihood": "certain"
          }
        ]
      }
    });
    let asset: Asset = serde_json::from_value(wire.clone()).unwrap();
    assert_eq!(
        asset.asset_type,
        Some(AssetType::Unknown("hologram".into()))
    );
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
    // Any status other than `pending` is a decision, even one this SDK version does not know.
    assert!(asset.is_decided());
    let spam = &&asset.classification.moderation.categories
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
    assert_eq!(
        reencoded["classification"]["moderation"]["status"],
        "escalated"
    );
    assert_eq!(reencoded["content"]["removalReason"], "expired");
    assert_eq!(
        reencoded["classification"]["moderation"]["categories"]["spam"]["likelihood"],
        "certain"
    );
}

#[test]
fn flagged_content_policy_encodes_as_an_object() {
    let options = ProcessingOptions {
        flagged_content_policy: Some(FlaggedContentPolicy::new(FlaggedContentAction::AgeRestrict)),
        ..Default::default()
    };
    assert_eq!(
        serde_json::to_value(options).unwrap(),
        json!({ "flaggedContentPolicy": { "action": "age-restrict" } })
    );
    assert_eq!(
        serde_json::to_value(FlaggedContentPolicy::new(FlaggedContentAction::Limit)).unwrap(),
        json!({ "action": "limit" })
    );
}

#[test]
fn events_decode_typed_type_severity_and_asset_snapshot() {
    let page: EventsPage = serde_json::from_value(json!({
      "events": [
        {
          "id": "e1",
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
          "type": "billing.charged",
          "severity": "critical",
          "title": "t",
          "facts": []
        }
      ],
      "cursor": "c",
      "hasMore": false
    }))
    .unwrap();
    let blocked = &page.events[0];
    assert_eq!(blocked.event_type, Some(EventType::AssetBlocked));
    assert_eq!(blocked.severity, Some(EventSeverity::High));
    let asset = blocked.asset.as_ref().unwrap();
    assert_eq!(
        (
            asset.id(),
            asset.external_id(),
            asset.classification_status(),
            asset.moderation_status(),
            asset.content_status()
        ),
        (
            "a1",
            Some("x1"),
            Some(AssetClassificationStatus::Completed),
            Some(AssetModerationStatus::Blocked),
            Some(AssetContentStatus::Removed)
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

    let payload = WebhookEventPayload::from_event(blocked);
    assert_eq!(payload.event_type, EventType::AssetBlocked);
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
        "format=avif,gravity=entropy,trim.border=true,trim.left=3"
    );
    let quality = Transform::image(ImageTransformOptions {
        dpr: Some(2.0),
        anim: Some(false),
        quality: Some(ImageQualityLevel::High.into()),
        background: Some("#FFAA00".into()),
        ..Default::default()
    });
    assert_eq!(
        CdnTransform::from(quality).selector().unwrap(),
        "anim=false,background=ffaa00,dpr=2,quality=high"
    );
    let options: ImageTransformOptions =
        serde_json::from_value(json!({ "quality": 80, "dpr": 1.5 })).unwrap();
    assert_eq!(options.quality, Some(ImageQuality::Value(80)));
    for options in [
        json!({ "Width": 1 }),
        json!({ "border": { "bad-name": 1 } }),
    ] {
        let step = Transform::Unknown {
            transform_type: "imageTransform".into(),
            options,
        };
        assert_eq!(
            CdnTransform::from(step).selector().unwrap_err().code(),
            &"sdk/invalid-argument"
        );
    }
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
    assert_eq!(decode("asset.limited"), EventType::AssetLimited);
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

#[test]
fn report_policy_snapshot_decodes_into_typed_models() {
    let policy: ReportPolicy = serde_json::from_str(r#"{"score":0.9,"categories":{"violence":{"score":0.9,"action":"block","source":{"kind":"allowance","index":0,"indexes":[0,1]},"settings":{"enabled":true,"categoryAction":"block","allowances":[],"restrictions":[{"name":"snapshot-rule","when":["violence-graphic","violence-injury"],"match":"all","unless":["violence-documentary"],"action":"block"}]}}},"decision":{"source":"asset-override","action":"purge","flaggedCategories":["violence"]}}"#).unwrap();
    let category = &policy.categories[&ClassificationCategory::Violence];
    let settings = category.settings.as_ref().unwrap();
    assert_eq!(settings.category_action, "block");
    assert_eq!(
        settings.restrictions[0].name.as_deref(),
        Some("snapshot-rule")
    );
    assert_eq!(category.source.as_ref().unwrap().index, Some(0));
    assert_eq!(settings.enabled, Some(true));
    assert_eq!(settings.restrictions[0].r#match.as_deref(), Some("all"));
    assert_eq!(
        settings.restrictions[0].unless.as_deref(),
        Some(["violence-documentary".to_string()].as_slice())
    );
    assert_eq!(
        category.source.as_ref().unwrap().indexes.as_deref(),
        Some([0, 1].as_slice())
    );
    let finding: CategoryResult = serde_json::from_value(json!({"status": "evaluated", "score": 0.9, "policyConditions": {"some:opaque": {"status": "evaluated", "score": 0.8}}})).unwrap();
    let evidence = &finding.policy_conditions.as_ref().unwrap()["some:opaque"];
    assert_eq!(evidence.status, Some(EvaluationStatus::Evaluated));
    assert_eq!(evidence.score, Some(0.8));
    let decision = policy.decision.as_ref().unwrap();
    assert_eq!(decision.source, "asset-override");
    assert_eq!(decision.action.as_deref(), Some("purge"));
    assert_eq!(
        decision.flagged_categories,
        vec![ClassificationCategory::Violence]
    );
}
