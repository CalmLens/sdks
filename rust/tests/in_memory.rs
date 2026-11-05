//! The in-memory mock behind `MockServerClient::in_memory`.
use calmlens::{models::*, testing::*, ErrorCode};
use serde_json::json;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

/// Deterministic IDs (`asset_00000000000000000001`, `rev_00000000000000000002`, ...) and a clock that advances 1 ms per call.
fn options() -> MockOptions {
    let ids = Arc::new(AtomicU64::new(0));
    let clock = Arc::new(AtomicU64::new(1_000));
    MockOptions::new()
        .create_id(move |prefix| format!("{prefix}_{:020}", ids.fetch_add(1, Ordering::SeqCst) + 1))
        .now(move || clock.fetch_add(1, Ordering::SeqCst))
}
fn kept(name: &str, bytes: &'static [u8]) -> SubmitAsset {
    SubmitAsset {
        processing_options: Some(ProcessingOptions {
            keep_content_after_processing: Some(true),
            ..Default::default()
        }),
        ..SubmitAsset::new(name, Content::bytes(bytes, "image/png"))
    }
}
fn named(name: &str) -> SubmitAsset {
    SubmitAsset::new(name, Content::text(name))
}
/// The mock client takes the real client's upload timeout and response size limit, and the
/// limit applies to the mock's answers as to the API's.
#[tokio::test]
async fn applies_the_upload_timeout_and_response_size_limit() {
    let mock = MockServerClient::in_memory(
        options()
            .upload_timeout(std::time::Duration::from_secs(90))
            .max_response_bytes(64),
    )
    .unwrap();
    let error = mock.assets().create(named("note")).await.unwrap_err();
    assert_eq!(error.code(), &ErrorCode::ResponseTooLarge);
}
/// The shared scenarios cover the statuses, recorded review, events and delivery a decision
/// gives; these are the mock's own IDs and the refusal of an unknown asset.
#[tokio::test]
async fn decide_uses_deterministic_ids_and_refuses_unknown_assets() {
    let mock = MockServerClient::in_memory(options()).unwrap();
    let created = mock.assets().create(kept("a.png", b"png")).await.unwrap();
    assert_eq!(created.id, "asset_00000000000000000001");
    let asset = mock
        .decide(&created.id, AssetModerationDecision::Blocked)
        .unwrap();
    assert_eq!(
        asset.classification.moderation.manual_reviews[0].id,
        // After the asset and its `asset.uploaded` event.
        "rev_00000000000000000003"
    );
    assert_eq!(
        mock.decide(
            "asset_00000000000000000000",
            AssetModerationDecision::Allowed
        )
        .unwrap_err()
        .code(),
        &ErrorCode::AssetNotFound
    );
}

/// The shared scenarios cover the content statuses; these are the stored bytes behind them.
#[tokio::test]
async fn storage_keeps_only_kept_content_and_drops_purged_content() {
    let mock = MockServerClient::in_memory(options()).unwrap();
    let asset = mock
        .text()
        .classify(ClassifyText::new("hello"))
        .await
        .unwrap();
    assert_eq!(asset.asset_type, Some(AssetType::PlaintextDocument));
    assert!(!mock.with_storage(|storage| storage.content.contains_key(&asset.id)));

    let stored = mock.assets().classify(kept("b.png", b"png")).await.unwrap();
    assert_eq!(
        mock.with_storage(|storage| storage.content[&stored.id].bytes()),
        b"png"
    );
    mock.decide(&stored.id, AssetModerationDecision::Blocked)
        .unwrap();
    assert!(mock.with_storage(|storage| storage.content.contains_key(&stored.id)));
    mock.decide(&stored.id, AssetModerationDecision::Purged)
        .unwrap();
    assert!(!mock.with_storage(|storage| storage.content.contains_key(&stored.id)));

    let purging = MockServerClient::in_memory(options().moderate(|_| MockOutcome::Purged)).unwrap();
    let purged = purging
        .assets()
        .classify(kept("e.png", b"png"))
        .await
        .unwrap();
    assert!(!purging.with_storage(|storage| storage.content.contains_key(&purged.id)));
}

/// The shared scenarios cover an empty timeline and opaque cursors; these are the page size
/// bound and a safety hold, which withholds the timeline, every CDN resource (the public
/// placeholder too) and the rendered file and preview a later decision would make.
#[tokio::test]
async fn a_safety_hold_withholds_the_timeline_resources_and_rendering() {
    let mock = MockServerClient::in_memory(options()).unwrap();
    let decided = mock.assets().classify(kept("v.png", b"png")).await.unwrap();
    assert_eq!(
        decided
            .content
            .preview
            .as_ref()
            .unwrap()
            .average_color
            .as_deref(),
        Some("#7f7f7f")
    );
    let error = mock
        .assets()
        .list_timeline(ListTimeline {
            asset_id: decided.id.clone(),
            page_size: Some(101),
            ..Default::default()
        })
        .await
        .unwrap_err();
    assert_eq!(error.code(), &ErrorCode::InvalidRequest);
    assert_eq!(
        (
            &error.details()["issues"][0]["path"],
            &error.details()["issues"][0]["code"]
        ),
        (&json!("pageSize"), &json!(ErrorCode::TooBig.as_str()))
    );
    let hold = json!({"placedAt": 1, "reason": "suspected-illegal-content", "disposedAt": null});
    mock.with_storage(|storage| {
        storage.assets.get_mut(&decided.id).unwrap()["content"]["safetyHold"] = hold.clone();
    });
    let error = mock
        .assets()
        .list_timeline(ListTimeline {
            asset_id: decided.id.clone(),
            ..Default::default()
        })
        .await
        .unwrap_err();
    assert_eq!(error.code(), &ErrorCode::AssetHeld);
    assert_eq!(error.details().get("hold"), Some(&json!("safety")));
    for resource in [
        CdnResource::Original,
        CdnResource::Rendered,
        CdnResource::Preview,
        CdnResource::Hls,
        CdnResource::Embed,
        CdnResource::Placeholder,
    ] {
        let response = mock
            .cdn()
            .serve(CdnRequest {
                asset_id: Some(decided.id.clone()),
                resource: Some(resource.clone()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), 403, "{resource:?}");
        let body: serde_json::Value =
            serde_json::from_slice(&response.bytes().await.unwrap()).unwrap();
        assert_eq!(body["code"], "asset/not-available", "{resource:?}");
    }

    let queued = mock
        .assets()
        .create(SubmitAsset {
            processing_options: Some(ProcessingOptions {
                keep_content_after_processing: Some(true),
                ..Default::default()
            }),
            ..SubmitAsset::new("song.mp3", Content::bytes(&b"mp3"[..], "audio/mpeg"))
        })
        .await
        .unwrap();
    assert_eq!(
        queued.content.rendered.as_ref().map(|r| r.format.as_str()),
        Some("audio/mpeg")
    );
    mock.with_storage(|storage| {
        storage.assets.get_mut(&queued.id).unwrap()["content"]["safetyHold"] = hold.clone();
    });
    let held = mock.complete_processing(&queued.id, None).unwrap();
    assert_eq!(
        held.classification.status,
        AssetClassificationStatus::Completed
    );
    assert_eq!(
        (&held.content.rendered, &held.content.preview),
        (&None, &None)
    );
}

/// The shared scenarios cover a video's embed page and missing stream; this is audio's embed page
/// and stream, a text file's embed page, and blocked content's embed page.
#[tokio::test]
async fn serves_the_embed_page_of_any_asset_and_no_hls_stream_until_it_is_blocked() {
    let mock = MockServerClient::in_memory(options()).unwrap();
    let asset = mock
        .assets()
        .classify(SubmitAsset {
            processing_options: Some(ProcessingOptions {
                keep_content_after_processing: Some(true),
                features: Some(ProcessingFeatures {
                    streaming: Some(FeatureOptions::enabled()),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            visibility: Some(Visibility::Public),
            ..SubmitAsset::new("song.wav", Content::bytes(&b"wav"[..], "audio/wav"))
        })
        .await
        .unwrap();
    assert_eq!(
        (
            &asset.content.rendered.as_ref().unwrap().kind,
            &asset.content.hls
        ),
        (&AssetRenderedKind::Audio, &None)
    );
    let cdn = mock.cdn();
    let serve = |resource: CdnResource| {
        cdn.serve(CdnRequest {
            asset_id: Some(asset.id.clone()),
            resource: Some(resource),
            ..Default::default()
        })
    };
    let note = mock
        .assets()
        .classify(SubmitAsset {
            processing_options: Some(ProcessingOptions {
                keep_content_after_processing: Some(true),
                ..Default::default()
            }),
            visibility: Some(Visibility::Public),
            ..SubmitAsset::new("note.txt", Content::text("hello"))
        })
        .await
        .unwrap();
    for identifier in [&asset.id, &note.id] {
        let embed = cdn
            .serve(CdnRequest {
                asset_id: Some(identifier.clone()),
                resource: Some(CdnResource::Embed),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(embed.status().as_u16(), 200, "{identifier}");
        assert_eq!(embed.headers()["content-type"], "text/html; charset=utf-8");
        assert!(embed.bytes().await.unwrap().starts_with(b"<!doctype html>"));
    }
    let stream = serve(CdnResource::Hls).await.unwrap();
    assert_eq!(stream.status().as_u16(), 404);
    let body: serde_json::Value = serde_json::from_slice(&stream.bytes().await.unwrap()).unwrap();
    assert_eq!(body["code"], "asset/no-rendered-version");
    mock.decide(&asset.id, AssetModerationDecision::Blocked)
        .unwrap();
    assert_eq!(
        serve(CdnResource::Embed).await.unwrap().status().as_u16(),
        403
    );
}

/// Raw uploads send tags as URL-encoded JSON in the query and URL uploads in the body, and the
/// asset keeps them. Like the API, the asset doesn't return the processing options it was
/// uploaded with.
#[tokio::test]
async fn uploads_send_tags_and_the_asset_keeps_them() {
    let mock = MockServerClient::in_memory(options()).unwrap();
    let tags = vec!["catalogue".to_owned(), "backpacks".to_owned()];
    let raw = mock
        .assets()
        .create(SubmitAsset {
            tags: Some(tags.clone()),
            ..kept("bag.png", b"png")
        })
        .await
        .unwrap();
    let text = mock
        .text()
        .classify(ClassifyText {
            tags: Some(tags.clone()),
            ..ClassifyText::new("hello")
        })
        .await
        .unwrap();
    let linked = mock
        .assets()
        .create(SubmitAsset {
            tags: Some(tags.clone()),
            ..SubmitAsset::from_url("page", "https://example.com/bag")
        })
        .await
        .unwrap();
    let requests = mock.requests();
    assert_eq!(
        (
            requests[0].query_param("tags"),
            requests[1].query_param("tags"),
            requests[2].json().unwrap()["tags"].clone()
        ),
        (
            Some(r#"["catalogue","backpacks"]"#),
            Some(r#"["catalogue","backpacks"]"#),
            json!(["catalogue", "backpacks"])
        )
    );
    for asset in [&raw, &text, &linked] {
        let stored = mock
            .assets()
            .retrieve(AssetId::new(asset.id.clone()))
            .await
            .unwrap();
        assert_eq!(stored.tags.as_ref(), Some(&tags), "{}", asset.id);
        assert!(!stored.extra.contains_key("processingOptions"));
    }
}

#[tokio::test]
async fn explain_completes_evidence_and_rerun_moderates_again() {
    let mock = MockServerClient::in_memory(options()).unwrap();
    let asset = mock.assets().classify(kept("e.png", b"png")).await.unwrap();
    mock.with_storage(|storage| {
        storage.assets.get_mut(&asset.id).unwrap()["classification"]["moderation"]
            ["explanationComplete"] = json!(false);
    });
    let explain = |rerun| ExplainAsset {
        asset_id: asset.id.clone(),
        rerun,
    };
    let explained = mock.assets().explain(explain(false)).await.unwrap();
    assert_eq!(
        explained.classification.moderation.explanation_complete,
        Some(true)
    );
    assert_eq!(
        explained.classification.status,
        AssetClassificationStatus::Completed
    );

    mock.with_storage(|storage| {
        storage.assets.get_mut(&asset.id).unwrap()["classification"]["moderation"]
            ["manualReviews"] = json!([{"decision": "allowed"}]);
    });
    let error = mock.assets().explain(explain(true)).await.unwrap_err();
    assert_eq!(error.code(), &ErrorCode::AssetReviewed);
    mock.with_storage(|storage| {
        storage.assets.get_mut(&asset.id).unwrap()["classification"]["moderation"]
            ["manualReviews"] = json!([]);
    });

    let rerun = mock.assets().explain(explain(true)).await.unwrap();
    assert_eq!(
        rerun.classification.status,
        AssetClassificationStatus::Processing
    );
    let error = mock.assets().explain(explain(false)).await.unwrap_err();
    assert_eq!(error.code(), &ErrorCode::AssetNotDecided);
}

#[tokio::test]
async fn failed_processing_can_be_retried_and_deleted_content_cannot() {
    let mock = MockServerClient::in_memory(options().moderate(|input: &MockModerationInput| {
        match input.trigger {
            MockModerationTrigger::Upload => MockOutcome::Failed.into(),
            _ => input.default_decision(),
        }
    }))
    .unwrap();
    let asset = mock.assets().create(kept("g.png", b"png")).await.unwrap();
    assert_eq!(
        asset.classification.status,
        AssetClassificationStatus::Failed
    );
    assert_eq!(
        asset.classification.failure_reason,
        Some(AssetFailureReason::ProcessingError)
    );
    let retried = mock.assets().retry(AssetId::new(&asset.id)).await.unwrap();
    assert_eq!(
        retried.classification.status,
        AssetClassificationStatus::Processing
    );
    assert_eq!(retried.classification.failure_reason, None);
    let error = mock
        .assets()
        .retry(AssetId::new(&asset.id))
        .await
        .unwrap_err();
    assert_eq!(error.code(), &ErrorCode::AssetNotRetryable);
    assert_eq!(error.status(), Some(409));

    let removed = mock
        .assets()
        .remove_content(AssetId::new(&asset.id))
        .await
        .unwrap();
    assert_eq!(
        removed.content.removal_reason,
        Some(AssetContentRemovalReason::Requested)
    );
    mock.assets().delete(AssetId::new(&asset.id)).await.unwrap();
    let error = mock
        .assets()
        .retrieve(AssetId::new(&asset.id))
        .await
        .unwrap_err();
    assert_eq!(error.code(), &ErrorCode::AssetNotFound);
    assert_eq!(error.status(), Some(404));
    assert!(error.request_id().unwrap().starts_with("mock-request-"));
}

#[tokio::test]
async fn list_filters_orders_and_pages_with_cursors() {
    let mock = MockServerClient::in_memory(options().moderate(|input: &MockModerationInput| {
        if input.queued {
            input.default_decision()
        } else {
            MockOutcome::Blocked.into()
        }
    }))
    .unwrap();
    let folder = mock
        .folders()
        .create(CreateFolder {
            name: "Inbox".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    let mut ids = Vec::new();
    for name in ["one", "two", "three"] {
        ids.push(mock.assets().create(named(name)).await.unwrap().id);
    }
    let blocked = mock.assets().classify(named("four")).await.unwrap();
    mock.assets()
        .move_asset(MoveAsset {
            asset_id: ids[2].clone(),
            folder_id: Some(folder.id.clone()),
        })
        .await
        .unwrap();

    let ascending = vec![Order {
        field: "createdAt".into(),
        direction: SortDirection::Asc,
    }];
    let first = mock
        .assets()
        .list(ListAssets {
            page_size: Some(2),
            filter: Some("classification.moderation.status==pending".into()),
            ordering: Some(ascending.clone()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(
        first.items.iter().map(|a| a.id.clone()).collect::<Vec<_>>(),
        ids[..2]
    );
    assert_eq!(first.has_more, Some(true));
    let second = mock
        .assets()
        .list(ListAssets {
            page_size: Some(2),
            cursor: first.next_cursor,
            filter: Some("classification.moderation.status==pending".into()),
            ordering: Some(ascending),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(
        second
            .items
            .iter()
            .map(|a| a.id.clone())
            .collect::<Vec<_>>(),
        ids[2..]
    );
    assert_eq!(second.has_more, Some(false));

    let either = mock
        .assets()
        .list(ListAssets {
            filter: Some(format!("name==fo*,id=in=({})", ids[0])),
            ..Default::default()
        })
        .await
        .unwrap();
    let mut found: Vec<_> = either.items.iter().map(|a| a.id.clone()).collect();
    found.sort();
    assert_eq!(found, vec![ids[0].clone(), blocked.id.clone()]);
    let in_folder = mock
        .assets()
        .list(ListAssets {
            folder_id: Some(folder.id.clone()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(in_folder.items.len(), 1);
    assert_eq!(in_folder.items[0].id, ids[2]);
    let error = mock
        .folders()
        .delete(FolderId::new(&folder.id))
        .await
        .unwrap_err();
    assert_eq!(error.code(), &ErrorCode::FolderNotEmpty);
}

#[tokio::test]
async fn update_patches_and_search_matches_keywords() {
    let mock = MockServerClient::in_memory(options()).unwrap();
    let asset = mock
        .assets()
        .create(SubmitAsset {
            description: Some("old".into()),
            ..named("holiday photo")
        })
        .await
        .unwrap();
    mock.assets().create(named("other")).await.unwrap();
    let updated = mock
        .assets()
        .update(UpdateAsset {
            asset_id: asset.id.clone(),
            description: Patch::Null,
            tags: Patch::Value(vec!["beach".into()]),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(updated.description, None);
    assert_eq!(updated.name.as_deref(), Some("holiday photo"));
    assert_eq!(updated.tags, Some(vec!["beach".to_string()]));

    let results = mock
        .assets()
        .search(SearchAssets {
            query: "Holiday beach".into(),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(results.items.len(), 1);
    assert_eq!(results.items[0].asset.id, asset.id);
    assert_eq!(
        results.items[0].matched_fields,
        vec![SearchMatchField::Name, SearchMatchField::Tags]
    );
    assert_eq!(results.semantic_status, SemanticStatus::Disabled);
}

#[tokio::test]
async fn queued_responses_come_before_the_in_memory_state() {
    let mock = MockServerClient::in_memory(options()).unwrap();
    let first = mock.assets().create(named("x")).await.unwrap();
    mock.enqueue_api_error(ErrorCode::UploadsPaused, "limit");
    let error = mock
        .assets()
        .retrieve(AssetId::new(&first.id))
        .await
        .unwrap_err();
    assert_eq!(error.code(), &ErrorCode::UploadsPaused);
    assert_eq!(mock.remaining_responses(), 0);
    assert_eq!(
        mock.assets()
            .retrieve(AssetId::new(&first.id))
            .await
            .unwrap()
            .id,
        first.id
    );
}

#[tokio::test]
async fn enqueued_events_carry_the_asset_snapshot() {
    let mock = MockServerClient::in_memory(options()).unwrap();
    let asset = mock.assets().create(named("x")).await.unwrap();
    let start = mock.events().list(ListEvents::default()).await.unwrap();
    let mut event = Event::new("", EventType::AssetUploaded);
    event.asset_id = Some(asset.id.clone());
    let event = mock.enqueue_event(event);
    assert_eq!(event.project_id, "project-1");
    // An event built without an actor is the mock API key's, which has no ID.
    assert_eq!(event.actor, Actor::new(ActorType::ApiKey, None));
    assert_eq!(
        event.asset.as_ref().unwrap().classification_status(),
        Some(AssetClassificationStatus::Processing)
    );
    let page = mock
        .events()
        .list(ListEvents {
            cursor: Some(start.next_cursor),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(page.items, vec![event]);
    let error = mock
        .events()
        .list(ListEvents {
            cursor: Some("bogus".into()),
            ..Default::default()
        })
        .await
        .unwrap_err();
    assert_eq!(error.code(), &ErrorCode::InvalidCursor);
}

/// The shared scenarios cover filtering by type and asset and cursors bound to their filters;
/// these are the types the API refuses and an empty `types` list, which filters nothing.
#[tokio::test]
async fn the_events_feed_refuses_unknown_types_and_an_empty_types_list_filters_nothing() {
    let mock = MockServerClient::in_memory(options()).unwrap();
    for types in [
        vec![EventType::Unknown("asset.exploded".into())],
        vec![
            EventType::AssetBlocked,
            EventType::Unknown("blocked".into()),
        ],
    ] {
        let error = mock
            .events()
            .list(ListEvents {
                types: Some(types.clone()),
                ..Default::default()
            })
            .await
            .unwrap_err();
        assert_eq!(error.code(), &ErrorCode::InvalidRequest, "{types:?}");
        assert_eq!(
            (
                &error.details()["issues"][0]["path"],
                &error.details()["issues"][0]["code"]
            ),
            (&json!("types"), &json!(ErrorCode::InvalidValue.as_str())),
            "{types:?}"
        );
    }
    let start = mock
        .events()
        .list(ListEvents {
            types: Some(Vec::new()),
            ..Default::default()
        })
        .await
        .unwrap();
    let sent = mock.requests().last().unwrap().query.clone();
    assert!(sent.iter().all(|(key, _)| key != "types"), "{sent:?}");
    let asset = mock.assets().create(named("x")).await.unwrap();
    // The empty list's cursor continues the unfiltered feed.
    let page = mock
        .events()
        .list(ListEvents {
            cursor: Some(start.next_cursor),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(
        page.items
            .iter()
            .map(|event| (&event.event_type, event.asset_id.as_deref()))
            .collect::<Vec<_>>(),
        [(&EventType::AssetUploaded, Some(asset.id.as_str()))]
    );
}

#[tokio::test]
async fn mock_options_set_the_base_urls() {
    let mock = MockServerClient::in_memory(
        MockOptions::new()
            .api_base_url("http://localhost:8787/api/v1")
            .cdn_base_url("http://localhost:8788/cdn/v1"),
    )
    .unwrap();
    let asset = mock
        .assets()
        .create(SubmitAsset::text("hello"))
        .await
        .unwrap();
    let response = mock
        .cdn()
        .serve(CdnRequest {
            asset_id: Some(asset.id.clone()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 403);
    // Recorded paths are relative to the base URL each request went to.
    let paths: Vec<_> = mock.requests().into_iter().map(|r| r.path).collect();
    assert_eq!(paths[0], "/projects/project-1/assets");
    assert!(
        paths[1].starts_with(&format!("/assets/project-1/{}/", asset.id)),
        "{paths:?}"
    );
    let urls: Vec<_> = mock
        .requests()
        .into_iter()
        .map(|request| request.url)
        .collect();
    assert!(
        urls[0].starts_with("http://localhost:8787/api/v1/projects/project-1/assets?"),
        "{urls:?}"
    );
    assert!(
        urls[1].starts_with(&format!(
            "http://localhost:8788/cdn/v1/assets/project-1/{}/",
            asset.id
        )),
        "{urls:?}"
    );
}

/// The shared scenario covers the list lifecycle; these are entries taken from an asset's
/// perceptual hash, repeated hashes, entry paging and the entries a deleted list takes with it.
#[tokio::test]
async fn hash_list_entries_come_from_assets_and_go_with_their_list() {
    let mock = MockServerClient::in_memory(options()).unwrap();
    let hashed = mock.assets().create(kept("a.png", b"png")).await.unwrap();
    let unhashed = mock.assets().create(kept("b.png", b"png")).await.unwrap();
    let perceptual = "ab".repeat(32);
    mock.with_storage(|storage| {
        let content = &mut storage.assets.get_mut(&hashed.id).unwrap()["content"];
        content["perceptualHash"] = json!(perceptual);
        content["perceptualHashQuality"] = json!(87);
    });
    let lists = mock.hash_lists();
    let list = lists
        .create(CreateHashList {
            name: "Removed".into(),
            action: HashListAction::Block,
            ..Default::default()
        })
        .await
        .unwrap();

    let from_asset = AddHashListEntry {
        hash_list_id: list.id.clone(),
        asset_id: Some(hashed.id.clone()),
        label: Some("Report 1".into()),
        ..Default::default()
    };
    let entry = lists.add_entry(from_asset.clone()).await.unwrap();
    assert_eq!(
        (
            entry.hash.as_str(),
            entry.quality,
            entry.asset_id.as_deref()
        ),
        (perceptual.as_str(), Some(87), Some(hashed.id.as_str()))
    );
    assert_eq!(mock.requests().last().unwrap().response_status, Some(201));
    let again = lists.add_entry(from_asset).await.unwrap();
    assert_eq!(again.id, entry.id);
    assert_eq!(mock.requests().last().unwrap().response_status, Some(200));

    let not_hashed = lists
        .add_entry(AddHashListEntry {
            hash_list_id: list.id.clone(),
            asset_id: Some(unhashed.id.clone()),
            ..Default::default()
        })
        .await
        .unwrap_err();
    assert_eq!(not_hashed.code(), &ErrorCode::HashListAssetNotHashed);

    let newest = lists
        .add_entry(AddHashListEntry {
            hash_list_id: list.id.clone(),
            hash: Some("0".repeat(64)),
            ..Default::default()
        })
        .await
        .unwrap();
    let first = lists
        .list_entries(ListHashListEntries {
            hash_list_id: list.id.clone(),
            page_size: Some(1),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(first.items[0].id, newest.id);
    assert_eq!(first.has_more, Some(true));
    let second = lists
        .list_entries(ListHashListEntries {
            hash_list_id: list.id.clone(),
            page_size: Some(1),
            cursor: first.next_cursor,
        })
        .await
        .unwrap();
    assert_eq!(second.items[0].id, entry.id);
    assert_eq!(second.has_more, Some(false));

    lists.delete(HashListId::new(&list.id)).await.unwrap();
    let removed = lists
        .remove_entry(HashListEntryId::new(&entry.id))
        .await
        .unwrap_err();
    assert_eq!(removed.code(), &ErrorCode::HashListEntryNotFound);
    assert!(mock.with_storage(|storage| storage.hash_list_entries.is_empty()));
}

/// An error the `moderate` callback returns fails the request that triggered it, as the
/// client would report it, and leaves no asset behind.
#[tokio::test]
async fn a_moderate_error_fails_the_triggering_request() {
    let mock = MockServerClient::in_memory(options().moderate(|_: &MockModerationInput| {
        MockDecision::new(MockOutcome::Blocked).flag("spam", 0.9, &[])
    }))
    .unwrap();
    let error = mock.assets().classify(named("x")).await.unwrap_err();
    assert_eq!(error.code(), &ErrorCode::InvalidArgument);
    assert_eq!(mock.requests()[0].response_status, None);
    assert!(mock.with_storage(|storage| storage.assets.is_empty() && storage.content.is_empty()));
}

/// A stored asset that is not a valid asset fails moderation with `sdk/invalid-response`
/// instead of reaching the callback as a default asset.
#[tokio::test]
async fn an_undecodable_stored_asset_never_reaches_moderate() {
    let calls = Arc::new(AtomicU64::new(0));
    let counted = calls.clone();
    let mock =
        MockServerClient::in_memory(options().moderate(move |input: &MockModerationInput| {
            counted.fetch_add(1, Ordering::SeqCst);
            input.default_decision()
        }))
        .unwrap();
    let asset = mock.assets().create(named("x")).await.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    mock.with_storage(|storage| {
        storage.assets.get_mut(&asset.id).unwrap()["createdAt"] = json!("yesterday");
    });
    let error = mock.complete_processing(&asset.id, None).unwrap_err();
    assert_eq!(error.code(), &ErrorCode::InvalidResponse);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}
