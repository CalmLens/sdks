# CalmLens Python SDK

Server-side Python SDK for [CalmLens](https://calmlens.com) content moderation, storage and CDN delivery.
It requires Python 3.10 or later, has no runtime dependencies and is fully typed (`py.typed`, checked with `mypy --strict`).

## Install

```sh
python -m pip install calmlens
```

Versions follow semantic versioning: see [Versioning and support](https://calmlens.com/docs/sdk#versioning-and-support).

## Quick start

Create an API key and copy your project ID as described in
[Authentication](https://calmlens.com/docs/guides/authentication). Keep both on your server.

```python
from calmlens import CalmLensServerClient

# Reads CALMLENS_API_KEY and CALMLENS_PROJECT_ID from the environment when not passed.
client = CalmLensServerClient()

asset = client.text.classify(text="Great photo!", external_id="comment-42")
if asset["classification"]["moderation"]["status"] == "allowed":
    print("Allowed: safe to show")

with open("photo.jpg", "rb") as file:  # streamed, not read into memory
    queued = client.assets.create(name="photo.jpg", content={"data": file, "type": "image/jpeg"})

decided = client.assets.wait_for_decision(asset_id=queued["id"], timeout=30)
```

Methods take snake_case keyword arguments, or one options dict with the API's camelCase keys
(`client.assets.retrieve({"assetId": "..."})`). Responses are plain dicts with the API's camelCase
field names, typed as `TypedDict`s in `calmlens.types`.

`assets.create` returns without waiting for the decision; `assets.classify` and `text.classify` wait for it.
Act on `classification.moderation.status`:

| Status           | What to do                                                                    |
| ---------------- | ----------------------------------------------------------------------------- |
| `pending`        | Moderation hasn't decided yet: wait, poll or handle a webhook.                |
| `allowed`        | Show the content.                                                             |
| `limited`        | Show it with reduced reach: keep it out of recommendations and notifications. |
| `age-restricted` | Show it only to viewers your app has age-checked.                             |
| `blocked`        | Don't show it. The content is kept for review.                                |
| `purged`         | Don't show it. The stored content has been deleted.                           |

Treat a status you don't recognise, and a failed request, as not allowed.

## What you can do

- [Moderate text, images, audio and video](https://calmlens.com/docs/sdk/python#moderate-content) and
  [read the classification report](https://calmlens.com/docs/guides/classification-results).
- [Stream uploads](https://calmlens.com/docs/sdk/python/reference#uploads), including
  [multipart uploads](https://calmlens.com/docs/sdk/python/reference#multipart-uploads) and uploads from a URL.
- [Moderate replies with their conversation](https://calmlens.com/docs/sdk/python/reference#replies-in-a-conversation).
- [Sign upload tokens](https://calmlens.com/docs/sdk/python/reference#upload-tokens) for
  [upload presets](https://calmlens.com/docs/guides/upload-presets) used from browsers.
- [Manage assets](https://calmlens.com/docs/sdk/python/reference#assets): list, search, update, move, retry,
  page through an audio or video asset's findings timeline, record reviewer decisions, explain decisions and delete content.
- [Organise assets in folders](https://calmlens.com/docs/sdk/python/reference#folders) and
  [compare uploads with hash lists](https://calmlens.com/docs/sdk/python/reference#hash-lists).
- [Manage the organisation's moderation policies](https://calmlens.com/docs/sdk/python/reference#policies)
  and choose the one each project uses.
- [Deliver content through the CDN](https://calmlens.com/docs/sdk/python/reference#cdn) with
  [lenses and transforms](https://calmlens.com/docs/sdk/python/reference#lenses), signed URLs and
  [viewer claims](https://calmlens.com/docs/sdk/python/reference#viewer-claims).
- [Verify and parse webhooks](https://calmlens.com/docs/sdk/python/reference#webhooks) from Flask, Django or
  FastAPI, or [poll the events feed](https://calmlens.com/docs/sdk/python/reference#events-feed).
- [Handle errors](https://calmlens.com/docs/sdk/python/reference#errors) with stable error codes, and rely on
  [safe retries and idempotency keys](https://calmlens.com/docs/sdk/python/reference#retries-and-idempotency).
- [Configure the client](https://calmlens.com/docs/sdk/python/reference#configuration): timeouts, proxies,
  connection reuse across threads and forked workers, and use from `asyncio`.

## Testing

`MockCalmLensServerClient` from `calmlens.testing` is the real client with an in-memory API behind it,
for offline tests. Its `generate_test_text_code`, `paint_test_image` and `generate_media_test_code` make signed test inputs that the real API answers with the scenario you choose, using your project's test
input key, once "Recognise test inputs" is turned on in the project's settings. Submit a text code as
the whole text and a test image as the whole upload. Codes and images expire, by default one day after
they are made (set `expires_at` to choose), so generate them when tests run. See
[Python testing](https://calmlens.com/docs/sdk/python/testing).

## Command-line tool

Use the standalone [CalmLens CLI](https://calmlens.com/docs/guides/local-development) to forward signed
webhook events to your machine and trigger test uploads.

## Links

- [Documentation](https://calmlens.com/docs/sdk/python)
- [SDK reference](https://calmlens.com/docs/sdk/python/reference)
- [API reference](https://calmlens.com/docs/api)
- [Changelog](https://github.com/CalmLens/sdks/blob/main/python/CHANGELOG.md)
- [License (MIT)](https://github.com/CalmLens/sdks/blob/main/python/LICENSE)
