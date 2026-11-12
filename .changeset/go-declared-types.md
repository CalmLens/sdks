---
"@calmlens/sdk-go": minor
---

Match the Go types to what the API sends and accepts. A page's `NextCursor` is a `*string`, nil on
the last page, except `EventsPage.NextCursor`, which is always set. `Policy.UpdatedAt` and
`UploadPreset.UpdatedAt` are `*int64`. `ProjectSettingsInput.HumanReview` takes a
`HumanReviewSettingsInput`, whose fields left nil return to their defaults. Classification feature
results (`OCR`, `PersonDetection`, `FaceDetection` and `LinkDetection`) encode as null when absent.
New constants cover the `asset.hash-matched`, `asset.review-requested` and `asset.review-completed`
event types and every registered event fact key.
