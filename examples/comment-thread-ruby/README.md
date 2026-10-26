# Calmthread — Ruby pre-moderated discussion thread

A small browser app using the [CalmLens Ruby SDK](../../ruby/README.md).
Calmthread is a **pre-moderated** thread: anything the moderation policy does not allow is
held for a person to review before anyone sees it.

- Each reply has a display name and a message. Both are moderated as separate text assets.
- A clean reply publishes immediately: every field's `classification.moderation.status` is `allowed`
  or `limited`. CalmLens delivers a limited field like an allowed one, and this thread has no
  recommendations or ranking to keep it out of, so it shows as usual.
- A reply with any field `blocked`, `age-restricted` or `purged` is **held**. The thread has no
  age check, so it holds age-restricted fields too. Only its author (the browser that posted it)
  sees a held reply, marked as awaiting review with the categories the moderation report's
  policy decision flagged (`classification.moderation.policy.decision.flaggedCategories`).
  Everyone else sees nothing until it is approved. The **Review queue** beside the thread lists
  held replies by their flagged categories, without their name or text.
- A moderator reviews held assets in the CalmLens portal. Allowing or limiting a held asset
  releases the reply into the thread, marked as approved after review. Blocking, purging or
  age-restricting it keeps the reply out for good, and the app then deletes the reply's stored
  content from CalmLens. The asset record and its moderation report remain. The app forgets the
  reply's name and text too, but keeps a record its author sees: the reply was removed after
  review, and for which categories.
- Pending, unknown and unreachable results, and fields whose `classification.status` is `failed`,
  never publish.

## Run locally

Ruby 3.1+ with Bundler 2.6 or newer. The `Gemfile` loads the sibling SDK by path. WEBrick is
the only runtime dependency.

```sh
cd examples/comment-thread-ruby
bundle install
CALMLENS_DEMO=1 bundle exec ruby app.rb   # or set the live credentials below
```

Open **http://127.0.0.1:6403**. Use `--port 6413` to change the port.

The app refuses to start without credentials unless you ask for demo mode, so a missing
key never silently runs the demo instead of live mode. The server listens on `127.0.0.1` only.

## Demo mode

With `CALMLENS_DEMO=1`, the app loads [demo.rb](demo.rb), which uses the SDK's offline
`CalmLens::MockServerClient`; the header says moderation outcomes are simulated. The live code
path never loads the mock. The demo thread starts with a few replies from other people, posted
through the same submit path; one of them was held and then approved by the simulated reviewer.
Choose a **Demo outcome** under the reply box:

- **Allowed**: both fields are allowed and the reply publishes.
- **Reply flagged**: the reply text comes back blocked for harassment and the reply is held.
- **Display name flagged**: the name comes back blocked for profanity and the reply is held.
- **Processing error**: the reply text ends in `error`, so nothing is posted.
- **CalmLens unavailable**: the request fails, so nothing is posted.

The mock stores each field as an asset, with the status your choice selects, and runs the
real client's validation and encoding. Nothing is classified: there is no keyword matching
and no moderation model.

In the **Review queue**, a held demo reply offers **Approve** and **Reject**. Each button
records a reviewer decision on the stored asset's moderation and adds an `asset.allowed` or
`asset.blocked` event to the mock's events feed. The app then reads the feed, retrieves the
assets and deletes rejected content through the same code it uses in live mode.

## Live mode

Export both variables before starting the app:

```sh
export CALMLENS_API_KEY='your-project-api-key'
export CALMLENS_PROJECT_ID='your-project-id'
bundle exec ruby app.rb
```

The demo note and outcome selector disappear. Missing or partial
credentials fail startup. `CALMLENS_API_URL` optionally points to a
local API. Live SDK requests time out after 30 seconds. No API key is sent to the browser.

Each field is moderated synchronously, with a per-asset policy override:

```ruby
asset = client.text.classify(
  name: 'Calmthread reply',
  external_id: "#{reply_id}:text",
  processing_options: { keep_content_after_processing: true, flagged_content_policy: { action: 'block' } },
  text: text
)
```

The display name goes first. If it fails or cannot be checked, the reply text is never sent.
If the name is held, the text is still moderated so the reviewer sees the whole reply. Each
call uses moderation quota.

### Why the override is per asset

The `block` action makes a flagged asset `blocked`: CalmLens keeps its content but does not
deliver it. Content is removed after processing unless the upload keeps it, so every field is
sent with `keep_content_after_processing: true`: a reviewer can read a held reply in the portal,
and the app deletes the stored text once a reviewer keeps the reply out. Setting the override
on each asset makes this thread hold flagged replies regardless of the project-wide action,
which may be `age-restrict` (deliver only through signed URLs or API keys) or `purge` (delete
the content, leaving nothing to review) for the project's other uploads.

The override changes only what happens to a flagged asset. Your project's moderation policy
still decides what counts as flagged: its allowances and restrictions work as usual. With the
override, a category whose policy score reaches 50% is held even if the project sets that
category's action to `allow`. See the moderation policies guide in the CalmLens docs.

## Review decisions

The app follows reviewer decisions: `asset.allowed`, `asset.limited`, `asset.age-restricted`,
`asset.blocked` and `asset.purged` events whose `decided-by` fact is `reviewer`. CalmLens also sends these
events for automated moderation (`decided-by` is `automated`); the app skips those, because it
already acted on the automated result when the reply was posted. Other events, such as
`asset.classified`, are skipped.

For each decision about a local reply, the app retrieves the asset with
`client.assets.retrieve` and acts on its **current** `classification.moderation.status`, not on
the event's snapshot:

- Status `allowed` or `limited`: the app also retrieves the reply's other field. The reply is
  published only when every field is allowed or limited.
- Status `age-restricted`, `blocked` or `purged` after an event other than `asset.allowed` or
  `asset.limited`: the
  app calls `client.assets.delete_content(asset_id:)` for each field, then forgets the reply. A
  later `allowed` decision on the same asset cannot bring it back.
- Anything else, or a response for a different asset or another reply's field (checked with
  its `externalId`): nothing changes.

**Events feed (pull).** Click **Check for decisions** in the review queue. The app calls
`client.events.list(after: cursor, limit: 50)` and follows `hasMore`. The first call without
a cursor returns a cursor for "now". The app takes it before its first moderation request,
so only later events count. Pages are read with `client.events.each_page`. The cursor advances
only after a whole page is applied, so a failed retrieval or deletion retries the page.
Events already applied are skipped. A check that starts while another is running returns at
once instead of waiting.

**Webhooks (push).** Set the same secret on this app and on the
[CalmLens CLI](https://calmlens.com/docs/guides/local-development) listener, then forward events here:

```sh
export CALMLENS_WEBHOOK_SECRET='a-local-development-secret'
# Start or restart the app in this terminal after setting the secret.
bundle exec ruby app.rb
```

In another terminal:

```sh
export CALMLENS_API_KEY='your-project-api-key'
export CALMLENS_PROJECT_ID='your-project-id'
export CALMLENS_WEBHOOK_SECRET='a-local-development-secret'
npx calmlens listen --forward-to http://127.0.0.1:6403/webhooks/calmlens
```

The handler passes the **exact raw body** to `CalmLens.parse_webhook_event`, which
verifies the signature and timestamp before parsing. It answers 204 straight away and applies
the delivery's `data` afterwards, on a background thread, through the same code as the events
feed, so a slow CalmLens request never delays the acknowledgement. A repeated
`x-calmlens-delivery` ID is acknowledged and skipped. If applying fails after three
attempts, the next events-feed check applies the same event. Webhooks need live mode.

The **Moderation log** shows each decision with how it arrived (events feed, verified webhook
or, in demo mode, a simulated decision) and its registered facts, such as **Reviewer** and
**Note**. Labels follow the event catalog. The hidden reviewer ID and unknown keys are not
shown. Only absolute HTTP(S) fact URLs become links. A test send (fact
`{ key: "test", value: true }`) is logged and changes nothing.

## Read the code

- `Moderator#moderate_reply` in [app.rb](app.rb): the SDK calls, the per-asset override, the
  external IDs and the field order. [demo.rb](demo.rb) holds the demo mode.
- `Calmthread.decision` and `Discussion#submit`: clean, held and failed results. Held replies
  are logged without their name or text.
- `ReviewFeed#sync` and `#apply`: events cursor, authoritative refresh, release, content
  deletion and replay handling. `WebhookInbox` and `App#webhook`: verification, fast
  acknowledgement and delivery deduplication.
- `App`: a Rack-compatible `call(env)` with bounded form bodies, a per-browser form token in a
  `SameSite=Strict` cookie, notices chosen from a fixed list (never text from the URL) and
  redirect-after-submit, so refreshing the page does not post again. `Calmthread.server`
  serves it with WEBrick, one thread per connection.
- `Discussion#visible_to`: published replies for everyone, held and removed replies only for
  their author. Authors are identified by a digest of the browser's form-token cookie.
- [index.html.erb](index.html.erb): server-rendered UI with no JavaScript or external
  assets. Every dynamic value goes through `h`. CalmLens
  [text test inputs](https://calmlens.com/docs/guides/testing) in a reply are shown as a short
  marker rather than their full code.
- [app_test.rb](app_test.rb): the override on every request, holding and blocking flagged
  replies, release and removal rules, content deletion, retries, replays, webhook
  tampering, test sends, fail-closed states, form tokens, request limits and the server.

```sh
bundle exec ruby -W app_test.rb
```

## Local example versus production

This is a **local, single-user learning example**. It keeps the latest 100 replies and 50
activity entries in memory and resets on restart. Held reply text is kept in this process's
memory until a decision arrives. Restarting the app does **not** delete live assets; manage
them in the portal. A production deployment needs authentication, persistent storage for
replies and the events cursor, a durable record of applied event and delivery IDs, a durable
job queue for webhook work, a background poller or webhook endpoint reachable by CalmLens, and a retention plan for content held in your
own database as well as in CalmLens.
