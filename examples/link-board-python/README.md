# Calmboard — Python link board

A community link board built with the [CalmLens Python SDK](../../python/README.md).
Members share a link with a short note. CalmLens fetches the linked page and moderates it,
including the text and images it finds there, before anyone can click the link.

1. The note is moderated synchronously with `text.moderate`. If it is not approved, the page
   is never submitted.
2. The page is submitted as a remote URL with `assets.create(url=...)`. CalmLens queues it,
   fetches it and moderates it as a `website` asset. Nothing is retained after processing,
   because the board never serves the page itself.
3. While the page is being checked, the board shows the address as plain text and refreshes
   every few seconds, reading the decision (`moderation.status`) with `assets.retrieve`. Only an
   `approved` page becomes a link (`rel="noopener noreferrer nofollow ugc"`); a page whose
   `processing.status` is `failed` is never linked.
4. For a rejected or flagged page (one the policy took an action on, so `moderation.action` is
   set), the board explains the decision from the moderation report (`moderation.report`):
   the categories that scored at least 40%, and the categories that were **not evaluated**,
   which are shown as unknown rather than as a zero score. It lists the page's extracted parts
   with `assets.iter_children`, so you can see whether the page text or an image carried the
   finding.
5. **Remove** deletes the link and the CalmLens records of its page and note with `assets.delete`.

Each link is saved before anything is sent to CalmLens, and both of its assets carry an
`externalId` of `<link-id>:note` or `<link-id>:page`. Every asset, and every webhook or feed
event about it, maps back to a link on the board, including links whose note was rejected.

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
quietly approve everything. `--demo` (or `CALMLENS_DEMO=1`) asks for a labelled demo mode
instead. Demo mode lives in [demo.py](demo.py) and runs on the SDK's `MockCalmLensServerClient`,
which live mode never imports; every call still goes through the real client's validation and
encoding. Choose a demo outcome: **Approve the page**, **Approve the page, but flag it**,
**Reject the page**, **Processing error** or **Reject the note**. The page stays pending for
two seconds, then the app writes the selected decision, a synthetic report and two synthetic
parts (page text and an image) into the mock. These are explicitly selected fake decisions;
nothing is fetched or classified.

The server listens on 127.0.0.1. Use `--port` to change the port.

## Use live moderation

```sh
export CALMLENS_API_KEY='your-project-api-key'
export CALMLENS_PROJECT_ID='your-project-id'
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
project's moderation policy decides what is approved, flagged or rejected.
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
  polling that only turns an `approved` page into a link.
- `explain` and `Board._child_findings`: reading the report and the page's parts.
- `Board.remove`: deleting the assets.
- `make_handler`: bounded form requests (411 without a length, 413 when too large), a form
  token and redirect-after-submit. Requests run on separate threads, and CalmLens calls never
  run while the board's lock is held.
- [test_app.py](test_app.py): decisions, fail-closed startup, report reading, URL validation,
  deletion, external IDs, form tokens, escaping and transport failures.

```sh
python -m unittest discover -v
```

## Example and production

This is a **single-user learning example**. It keeps the latest 50 links in memory, which
reset on restart, and polls from page loads instead of receiving webhooks. A production board
needs member accounts (so only a link's author can remove it), persistent storage, webhooks
for `asset.approved` and `asset.rejected` instead of polling, rate limits per member, and a
moderator view for flagged links.
