# Calmboard — Python link board

A community link board built with the [CalmLens Python SDK](../../python/README.md).
Members share a link with a short note. CalmLens fetches the linked page and moderates it,
including the text and images it finds there, before anyone can click the link.

1. The note is moderated synchronously with `text.classify`. If it is not `allowed` or `limited`,
   the page is never submitted and the note is never shown; the board lists the categories it
   was flagged for.
2. The page is submitted as a remote URL with `assets.create(url=...)`. CalmLens queues it,
   fetches it and moderates it as a `website` asset, with the page's text and each image as
   child assets. Nothing is retained after processing, because the board never serves the page
   itself.
3. While the page is being checked, the board shows the address as plain text and refreshes
   every few seconds, reading the moderation status (`classification.moderation.status`) with
   `assets.retrieve`. Only an `allowed` or `limited` page becomes a link
   (`rel="noopener noreferrer nofollow ugc"`). A `limited` page is delivered like an allowed one
   but should reach fewer people, so the board folds its link behind **Show link**. An
   `age-restricted` page is delivered only through signed URLs or API keys and belongs behind
   your own age gate; the board has none, so it shows the address as text. `blocked` and
   `purged` pages, and pages whose `classification.status` is `failed`, are never linked.
4. Once a page is decided, the board lists its parts with `assets.iter_children`. The text
   part's name and description give the page's title and description, which the board shows
   for allowed, limited and age-restricted pages (a blocked page shows only its host).
5. For a page the policy acted on, the board explains the decision from the classification
   results (`classification.moderation`). A website is usually decided by its parts
   (`policy.decision.source` is `children`): its own categories are then not evaluated, and the
   board shows each part with the categories that scored at least 40%, so you can see whether
   the page text or an image carried the finding. When the page's own scores decided it, the
   board shows those, and categories that were **not evaluated** as unknown, never as zero.
6. A moderator can change a decision later. Pages that are limited, age-restricted or blocked
   are read again every 60 seconds; a reviewed page shows the reviewer's decision
   (`manualReviews`) and becomes a link if it is now allowed.
7. **Try again** resubmits a page that couldn't be checked as a new asset and deletes the failed
   one. **Remove** deletes the link and the CalmLens records of its page and note with
   `assets.delete`.

Each link is saved before anything is sent to CalmLens, and both of its assets carry an
`externalId` of `<link-id>:note` or `<link-id>:page`. Every asset, and every webhook or feed
event about it, maps back to a link on the board, including links whose note was not allowed.

## Run locally

Python 3.10+; no runtime dependencies beyond the local SDK.

```sh
cd examples/link-board-python
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python app.py --demo
```

Open **http://127.0.0.1:6401**. Without credentials the app refuses to start, so it can never
quietly allow everything. `--demo` (or `CALMLENS_DEMO=1`) asks for a labelled demo mode
instead. Demo mode lives in [demo.py](demo.py) and runs on the SDK's `MockCalmLensServerClient`,
which live mode never imports; every call still goes through the real client's validation and
encoding. The demo board starts with sample links in every state, on reserved example domains; the
newest stays pending for 15 seconds. Choose a demo outcome when sharing: **Allow the page**,
**Limit the page**, **Age-restrict the page**, **Block the page text**, **Block an image on the
page**, **Purge the page**, **Processing error** or **Block the note**. The page stays pending for
two seconds, then the app writes the selected status into the mock with synthetic parts (page
text and images) and reports shaped like a live website decision. These are explicitly selected
fake statuses; nothing is fetched or classified.

The server listens on 127.0.0.1. Use `--port` to change the port.

## Use live moderation

```sh
export CALMLENS_API_KEY='your-project-api-key'
export CALMLENS_PROJECT_ID='proj_8fK2mQx7Lp4NvB3tRz9Y'
python app.py
```

The banner shows **Live** and the demo selector disappears. Each share makes one
synchronous text request and one queued URL submission:

```python
asset = client.assets.create(
    name="Calmboard link",
    url=url,
    external_id=f"{link_id}:page",
    processing_options={"keepContentAfterProcessing": False},
)
```

CalmLens accepts only public HTTP(S) addresses: private IP addresses, localhost names and
URL credentials are rejected, and redirects are checked. The app rejects the obvious cases
before sending them. Pages are limited to 20 MB. Live requests use project quota, and the
project's moderation policy decides each page's moderation status.
`CALMLENS_API_URL` optionally points to a local API. Missing or partial credentials stop the
app at startup.

When a CalmLens request fails, members see a fixed message and the server log records the
error code and the response's request ID. The SDK's error text is never shown on the page, and
redirect notices are fixed keys rather than text taken from the URL.

## Read the code

- `validate_url` in [app.py](app.py): the checks made before a URL is submitted.
- `Moderator` and `create_moderator`: every SDK call, and the fail-closed startup.
- [demo.py](demo.py): the demo plan applied to the mock's stored asset.
- `Board.submit` and `Board.refresh`: the note check, the queued URL submission and the
  polling that only turns an `allowed` or `limited` page into a link.
- `explain`, `decision_source`, `page_preview` and `Board._read_page`: reading the report, the
  page's parts and a moderator's later review.
- `Board.retry` and `Board.remove`: resubmitting a page that couldn't be checked, and deleting
  the assets.
- `make_handler`: bounded form requests (411 without a length, 413 when too large), a form
  token and redirect-after-submit. Requests run on separate threads, and CalmLens calls never
  run while the board's lock is held.
- [test_app.py](test_app.py): decisions, the parts that decided them, page previews, later
  reviews, retries, fail-closed startup, report reading, URL validation, deletion, external IDs,
  form tokens, escaping and transport failures.

```sh
python -m unittest discover -v
```

## Example and production

This is a **single-user learning example**. It keeps the latest 50 links in memory, which
reset on restart, and polls from page loads instead of receiving webhooks. A production board
needs member accounts (so only a link's author can remove it), persistent storage, webhooks
for `asset.allowed`, `asset.limited`, `asset.age-restricted`, `asset.blocked` and `asset.purged` instead of
polling, rate limits per member, an age gate if it should show age-restricted pages, and a
moderator view for links the policy acted on.
