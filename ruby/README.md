# CalmLens Ruby SDK

Ruby 3.1+ server-side client for [CalmLens](https://calmlens.com) content moderation, uploads, events, webhooks and CDN delivery.

## Installation

```sh
gem install calmlens
```

Or add it to your Gemfile:

```ruby
gem "calmlens"
```

The gem has no runtime dependencies: it uses only the standard library (Net::HTTP, JSON, OpenSSL). It ships YARD documentation and RBS signatures in `sig/`, so Steep and other RBS tools can check your calls and the response keys you read.

Versions follow semantic versioning: see [Versioning and support](https://calmlens.com/docs/sdk#versioning-and-support).

## Quick start

Create an API key and copy your project ID in the CalmLens portal, and keep both on your server.

```ruby
require 'calmlens'

client = CalmLens::ServerClient.new(api_key: ENV.fetch('CALMLENS_API_KEY'), project_id: ENV.fetch('CALMLENS_PROJECT_ID'))

# Classify text and wait for the decision.
asset = client.text.classify(text: 'Great photo!', external_id: 'comment-42')

# Upload a file and queue processing, then wait for its decision.
queued = File.open('photo.jpg', 'rb') do |file|
  client.assets.create(name: 'photo.jpg', content: {data: file, type: 'image/jpeg'})
end
decided = client.assets.wait_for_decision(asset_id: queued['id'], timeout: 30)

if %w[allowed limited].include?(decided['classification']['moderation']['status'])
  puts "Show #{decided['id']}"
end

client.close
```

Options are keyword arguments in snake_case (camelCase also works, at any depth). Responses are Hashes with the API's camelCase String keys.

`asset['classification']['moderation']['status']` decides what to do with the content:

| Status           | What to do                                                                           |
| ---------------- | ------------------------------------------------------------------------------------ |
| `pending`        | Not decided yet. Wait, poll or listen for a webhook.                                 |
| `allowed`        | Show it to everyone.                                                                 |
| `limited`        | Show it, but reduce its reach, such as keeping it out of recommendations.            |
| `age-restricted` | Show it only behind your own age check, with `viewer_claims: {age_confirmed: true}`. |
| `blocked`        | Don't show it. The content is kept but not delivered.                                |
| `purged`         | Don't show it. The content was deleted.                                              |

New statuses and fields may appear in later API versions. The SDK returns them unchanged, so treat a status you don't recognise as not ready.

## What you can do

- [Moderate text, images, documents, audio, video and websites](https://calmlens.com/docs/sdk/ruby#moderate-content), and [read classification results](https://calmlens.com/docs/guides/classification-results).
- [Wait for a queued decision](https://calmlens.com/docs/sdk/ruby#waiting-for-a-decision) or [receive it by webhook](https://calmlens.com/docs/guides/webhooks).
- [Stream uploads from any IO](https://calmlens.com/docs/sdk/ruby/reference#upload-content). Content larger than `part_size_bytes:` (8 MiB) that can be read again, such as a String or a File, goes in [parts](https://calmlens.com/docs/guides/multipart-uploads) automatically, each retried on its own and resumable with the same idempotency key.
- [Moderate replies with their conversation](https://calmlens.com/docs/sdk/ruby/reference#conversation-context).
- [Sign upload tokens for browser uploads](https://calmlens.com/docs/sdk/ruby/reference#upload-tokens) through [upload presets](https://calmlens.com/docs/guides/upload-presets).
- [Record reviewer decisions](https://calmlens.com/docs/sdk/ruby/reference#reviewer-decisions) and [explain a decision](https://calmlens.com/docs/sdk/ruby#methods).
- [Serve content from the CDN](https://calmlens.com/docs/sdk/ruby#cdn-methods), with [lenses, transforms and signed URLs](https://calmlens.com/docs/sdk/ruby/reference#cdn-urls) and [age-restricted delivery](https://calmlens.com/docs/guides/delivering-assets#age-restricted-assets).
- [Organise assets in folders](https://calmlens.com/docs/sdk/ruby/reference#folders), [search them](https://calmlens.com/docs/guides/search) and [page through lists](https://calmlens.com/docs/sdk/ruby#pagination).
- [Match images against hash lists](https://calmlens.com/docs/sdk/ruby/reference#hash-lists).
- [Read the events feed](https://calmlens.com/docs/sdk/ruby#pagination) and [verify webhooks in Rails or Rack](https://calmlens.com/docs/sdk/ruby#webhooks).
- [Handle errors](https://calmlens.com/docs/sdk/ruby/reference#errors) with automatic [retries, timeouts and idempotency keys](https://calmlens.com/docs/sdk/ruby/reference#retries-and-timeouts).
- [Type-check your code with RBS signatures](https://calmlens.com/docs/sdk/ruby/reference#types).

Every method is listed in the [Ruby SDK documentation](https://calmlens.com/docs/sdk/ruby#methods).

## Testing

`CalmLens::MockServerClient` from `calmlens/testing` runs the real client against an in-memory stand-in for the API and CDN, so you can test your integration offline. See [Ruby testing](https://calmlens.com/docs/sdk/ruby/testing).

`CalmLens::TestInputs` signs test inputs with your project's test input key from the portal: `generate_text_code` turns a scenario, preset or signal into a text code, `paint_image` paints it as a test image, and `generate_media_code` gives a phrase for audio and video, so the real API returns the scenario you declared. Submit a text code as the whole text and a test image as the whole upload.

## Links

- [Documentation](https://calmlens.com/docs/sdk/ruby)
- [SDK reference](https://calmlens.com/docs/sdk/ruby/reference)
- [API reference](https://calmlens.com/docs/api)
- [Changelog](https://github.com/CalmLens/sdks/blob/main/ruby/CHANGELOG.md)
- [License (MIT)](https://github.com/CalmLens/sdks/blob/main/ruby/LICENSE)
