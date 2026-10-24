//! The in-memory mock behind `MockServerClient::in_memory`.
use calmlens::{models::*, testing::*, ErrorCode};
use serde_json::json;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

/// Deterministic IDs (`id-1`, `id-2`, ...) and a clock that advances 1 ms per call.
fn options() -> MockOptions {
    let ids = Arc::new(AtomicU64::new(0));
    let clock = Arc::new(AtomicU64::new(1_000));
    MockOptions::new()
        .create_id(move || format!("id-{}", ids.fetch_add(1, Ordering::SeqCst) + 1))
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
fn cdn(asset_identifier: &str) -> CdnRequest {
    CdnRequest {
        asset_identifier: asset_identifier.into(),
        resource: Some(CdnResource::Original),
        ..Default::default()
    }
}
async fn cdn_code(mock: &MockServerClient, request: CdnRequest) -> (u16, String) {
    let response = mock.cdn().serve(request).await.unwrap();
    let status = response.status().as_u16();
    let body: serde_json::Value = serde_json::from_slice(&response.bytes().await.unwrap()).unwrap();
    (status, body["code"].as_str().unwrap().to_owned())
}

#[tokio::test]
async fn created_asset_stays_pending_until_a_reviewer_blocks_it() {
    let mock = MockServerClient::in_memory(options()).unwrap();
    let start = mock.events().list(ListEvents::default()).await.unwrap();
    let created = mock.assets().create(kept("a.png", b"png")).await.unwrap();
    assert_eq!(created.id, "id-1");
    assert_eq!(
        created.classification.status,
        AssetClassificationStatus::Processing
    );
    assert_eq!(
        created.classification.moderation.status,
        AssetModerationStatus::Pending
    );
    let error = mock
        .assets()
        .wait_for_decision(
            WaitForDecision::new(&created.id).timeout(std::time::Duration::from_millis(1)),
        )
        .await
        .unwrap_err();
    assert!(error.is_timeout());

    mock.decide(&created.id, AssetModerationDecision::Blocked)
        .unwrap();
    let asset = mock
        .assets()
        .retrieve(AssetId::new(&created.id))
        .await
        .unwrap();
    assert_eq!(
        asset.classification.moderation.status,
        AssetModerationStatus::Blocked
    );
    assert_eq!(
        asset.classification.status,
        AssetClassificationStatus::Completed
    );
    let reviews = &asset.classification.moderation.manual_reviews;
    assert_eq!(reviews.len(), 1);
    assert_eq!(reviews[0].decision, AssetModerationDecision::Blocked);
    let waited = mock
        .assets()
        .wait_for_decision(WaitForDecision::new(&created.id))
        .await
        .unwrap();
    assert_eq!(
        waited.classification.moderation.status,
        AssetModerationStatus::Blocked
    );

    let page = mock
        .events()
        .list(ListEvents {
            after: Some(start.cursor.clone()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(page.events.len(), 1);
    let event = &page.events[0];
    assert_eq!(event.event_type, Some(EventType::AssetBlocked));
    assert_eq!(event.asset_id.as_deref(), Some(created.id.as_str()));
    let snapshot = event.asset.as_ref().unwrap();
    assert_eq!(
        snapshot.classification.moderation.status,
        AssetModerationStatus::Blocked
    );
    assert_eq!(
        event.facts,
        vec![EventFact {
            key: "decided-by".into(),
            value: json!("reviewer"),
            url: None
        }]
    );
    let later = mock
        .events()
        .list(ListEvents {
            after: Some(page.cursor),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(later.events.is_empty());

    // Blocked content is kept but not delivered, even with the download permission.
    assert!(mock.with_storage(|storage| storage.content.contains_key(&created.id)));
    assert_eq!(
        cdn_code(&mock, cdn(&created.id)).await,
        (403, "asset/not-available".into())
    );
    assert_eq!(
        mock.decide("missing", AssetModerationDecision::Allowed)
            .unwrap_err()
            .code(),
        &ErrorCode::AssetNotFound
    );
}

#[tokio::test]
async fn classify_uses_the_analyzed_outcome_and_removes_temporary_content() {
    let mock = MockServerClient::in_memory(options().analyzed_outcome(MockOutcome::AgeRestricted))
        .unwrap();
    let asset = mock
        .text()
        .classify(ClassifyText::new("hello"))
        .await
        .unwrap();
    assert_eq!(
        asset.classification.moderation.status,
        AssetModerationStatus::AgeRestricted
    );
    assert_eq!(
        asset.classification.status,
        AssetClassificationStatus::Completed
    );
    assert_eq!(asset.asset_type, Some(AssetType::PlaintextDocument));
    assert_eq!(asset.content.status, AssetContentStatus::Removed);
    assert_eq!(
        asset.content.removal_reason,
        Some(AssetContentRemovalReason::Retention)
    );
    assert!(!mock.with_storage(|storage| storage.content.contains_key(&asset.id)));

    let kept = mock.assets().classify(kept("b.png", b"png")).await.unwrap();
    assert_eq!(kept.content.status, AssetContentStatus::Stored);
    assert_eq!(
        mock.with_storage(|storage| storage.content[&kept.id].bytes()),
        b"png"
    );
    // `create` still uses the queued outcome.
    let queued = mock.assets().create(named("later")).await.unwrap();
    assert_eq!(
        queued.classification.moderation.status,
        AssetModerationStatus::Pending
    );
    assert_eq!(queued.content.status, AssetContentStatus::Temporary);
}

#[tokio::test]
async fn cdn_needs_the_download_permission_for_private_and_age_restricted_assets() {
    let denied =
        MockServerClient::in_memory(options().analyzed_outcome(MockOutcome::AgeRestricted))
            .unwrap();
    let asset = denied
        .assets()
        .classify(kept("c.png", b"bytes"))
        .await
        .unwrap();
    assert_eq!(
        cdn_code(&denied, cdn(&asset.id)).await,
        (403, "asset/api-key-missing-permission".into())
    );
    // Public, but age-restricted: only with allow_age_restricted.
    denied.with_storage(|storage| {
        storage.assets.get_mut(&asset.id).unwrap()["visibility"] = json!("public")
    });
    assert_eq!(
        cdn_code(&denied, cdn(&asset.id)).await,
        (403, "asset/api-key-missing-permission".into())
    );
    let opted_in = denied
        .cdn()
        .serve(CdnRequest {
            allow_age_restricted: Some(true),
            ..cdn(&asset.id)
        })
        .await
        .unwrap();
    assert_eq!(opted_in.status().as_u16(), 200);
    assert_eq!(opted_in.headers()["content-type"], "image/png");
    assert_eq!(opted_in.bytes().await.unwrap().as_ref(), b"bytes");

    let allowed = MockServerClient::in_memory(
        options().api_key(create_mock_api_key(&[MockApiKeyGrant::download()])),
    )
    .unwrap();
    let private = allowed
        .assets()
        .classify(kept("d.png", b"0123456789"))
        .await
        .unwrap();
    let response = allowed.cdn().serve(cdn(&private.id)).await.unwrap();
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(response.bytes().await.unwrap().as_ref(), b"0123456789");
    let range = allowed
        .cdn()
        .serve(CdnRequest {
            init: Some(HttpOptions {
                headers: [("range".to_string(), "bytes=2-4".to_string())].into(),
                ..Default::default()
            }),
            ..cdn(&private.id)
        })
        .await
        .unwrap();
    assert_eq!(range.status().as_u16(), 206);
    assert_eq!(range.headers()["content-range"], "bytes 2-4/10");
    assert_eq!(range.bytes().await.unwrap().as_ref(), b"234");
    assert_eq!(
        cdn_code(&allowed, cdn("missing")).await,
        (404, "asset/not-found".into())
    );
}

#[tokio::test]
async fn purged_outcomes_and_decisions_remove_the_content() {
    let mock =
        MockServerClient::in_memory(options().analyzed_outcome(MockOutcome::Purged)).unwrap();
    let asset = mock.assets().classify(kept("e.png", b"png")).await.unwrap();
    assert_eq!(
        asset.classification.moderation.status,
        AssetModerationStatus::Purged
    );
    assert_eq!(asset.content.status, AssetContentStatus::Removed);
    assert_eq!(
        asset.content.removal_reason,
        Some(AssetContentRemovalReason::Policy)
    );
    assert!(!mock.with_storage(|storage| storage.content.contains_key(&asset.id)));

    let allowed = mock.assets().create(kept("f.png", b"png")).await.unwrap();
    let purged = mock
        .decide(&allowed.id, AssetModerationDecision::Purged)
        .unwrap();
    assert_eq!(
        purged.content.removal_reason,
        Some(AssetContentRemovalReason::Policy)
    );
    assert!(!mock.with_storage(|storage| storage.content.contains_key(&allowed.id)));
    assert_eq!(
        cdn_code(&mock, cdn(&allowed.id)).await,
        (403, "asset/not-available".into())
    );
}

#[tokio::test]
async fn explain_completes_evidence_and_rerun_moderates_again() {
    let mock = MockServerClient::in_memory(options()).unwrap();
    let asset = mock.assets().classify(kept("e.png", b"png")).await.unwrap();
    mock.with_storage(|storage| {
        storage.assets.get_mut(&asset.id).unwrap()["classification"]["moderation"]["policy"] =
            json!({"score": 0.1, "categories": {}, "evidence": "decision"});
    });
    let explain = |rerun| ExplainAsset {
        asset_id: asset.id.clone(),
        rerun,
    };
    let explained = mock.assets().explain(explain(false)).await.unwrap();
    let policy = explained.classification.moderation.policy.unwrap();
    assert_eq!(policy.evidence.as_deref(), Some("full"));
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
    let mock = MockServerClient::in_memory(options().queued_outcome(MockOutcome::Failed)).unwrap();
    let asset = mock.assets().create(kept("g.png", b"png")).await.unwrap();
    assert_eq!(
        asset.classification.status,
        AssetClassificationStatus::Failed
    );
    let retried = mock.assets().retry(AssetId::new(&asset.id)).await.unwrap();
    assert_eq!(
        retried.classification.status,
        AssetClassificationStatus::Processing
    );
    let error = mock
        .assets()
        .retry(AssetId::new(&asset.id))
        .await
        .unwrap_err();
    assert_eq!(error.code(), &ErrorCode::AssetNotRetryable);
    assert_eq!(error.status(), Some(409));

    let removed = mock
        .assets()
        .delete_content(AssetId::new(&asset.id))
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
    let mock =
        MockServerClient::in_memory(options().analyzed_outcome(MockOutcome::Blocked)).unwrap();
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

    let signed = mock
        .assets()
        .create_signed_url(SignedUrlOptions {
            asset_id: asset.id.clone(),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(
        signed.url,
        format!(
            "https://mock.calmlens.invalid/assets/{}/rendered?expiresInSeconds=900",
            asset.id
        )
    );
}

#[tokio::test]
async fn idempotency_keys_replay_and_queued_responses_come_first() {
    let mock = MockServerClient::in_memory(options()).unwrap();
    let upload = || SubmitAsset {
        idempotency_key: Some("key-1".into()),
        external_id: Some("ext".into()),
        ..named("x")
    };
    let first = mock.assets().create(upload()).await.unwrap();
    let replayed = mock.assets().create(upload()).await.unwrap();
    assert_eq!(replayed.id, first.id);
    assert_eq!(mock.with_storage(|storage| storage.assets.len()), 1);
    let reused = mock
        .assets()
        .create(SubmitAsset {
            idempotency_key: Some("key-1".into()),
            ..named("different")
        })
        .await
        .unwrap_err();
    assert_eq!(reused.code(), &ErrorCode::IdempotencyKeyReused);
    let duplicate = mock
        .assets()
        .create(SubmitAsset {
            external_id: Some("ext".into()),
            ..named("x")
        })
        .await
        .unwrap_err();
    assert_eq!(duplicate.code(), &ErrorCode::DuplicateExternalId);

    mock.enqueue_api_error(ErrorCode::SpendLimitReached, "limit");
    let error = mock
        .assets()
        .retrieve(AssetId::new(&first.id))
        .await
        .unwrap_err();
    assert_eq!(error.code(), &ErrorCode::SpendLimitReached);
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
    let start = mock.events().list(ListEvents::default()).await.unwrap();
    let asset = mock.assets().create(named("x")).await.unwrap();
    let mut event = Event::new("", EventType::AssetUploaded);
    event.asset_id = Some(asset.id.clone());
    let event = mock.enqueue_event(event);
    assert_eq!(event.project_id.as_deref(), Some("mock-project"));
    assert_eq!(
        event.asset.as_ref().unwrap().classification.status,
        AssetClassificationStatus::Processing
    );
    let page = mock
        .events()
        .list(ListEvents {
            after: Some(start.cursor),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(page.events, vec![event]);
    let error = mock
        .events()
        .list(ListEvents {
            after: Some("bogus".into()),
            ..Default::default()
        })
        .await
        .unwrap_err();
    assert_eq!(error.code(), &ErrorCode::InvalidEventCursor);
}
