# CalmLens Go SDK

Go client for the [CalmLens](https://calmlens.com) content moderation and delivery API. It requires Go 1.22 or later and uses only the standard library.

## Installation

```sh
go get github.com/CalmLens/sdks/go@latest
```

| Package        | Import path                                | Use                                                      |
| -------------- | ------------------------------------------ | -------------------------------------------------------- |
| `calmlens`     | `github.com/CalmLens/sdks/go`              | The server client, webhook verification and CDN helpers. |
| `calmlenstest` | `github.com/CalmLens/sdks/go/calmlenstest` | An in-memory mock client for offline tests.              |

Versions follow semantic versioning: see [Versioning and support](https://calmlens.com/docs/sdk#versioning-and-support).

## Quick start

Create an API key and copy your project ID as described in [Authentication](https://calmlens.com/docs/guides/authentication), and keep them on your server.

```go
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	calmlens "github.com/CalmLens/sdks/go"
)

func main() {
	client, err := calmlens.NewServerClient(calmlens.Options{
		APIKey:    os.Getenv("CALMLENS_API_KEY"),
		ProjectID: os.Getenv("CALMLENS_PROJECT_ID"),
	})
	if err != nil {
		log.Fatal(err)
	}
	asset, err := client.Text.Classify(context.Background(), calmlens.ClassifyTextOptions{
		Text:       "Great photo!",
		ExternalID: calmlens.Ptr("comment-42"),
	})
	if err != nil {
		log.Fatal(err)
	}
	switch asset.Classification.Moderation.Status {
	case calmlens.ModerationStatusAllowed:
		fmt.Println("publish")
	case calmlens.ModerationStatusLimited:
		fmt.Println("publish with reduced reach")
	case calmlens.ModerationStatusAgeRestricted:
		fmt.Println("publish behind your age check")
	default:
		fmt.Println("don't show it") // pending, blocked, purged or a status added later
	}
}
```

| Moderation status   | What to do                                                 |
| ------------------- | ---------------------------------------------------------- |
| `allowed`           | Publish normally.                                          |
| `limited`           | Publish, but keep it out of recommendations and trending.  |
| `age-restricted`    | Show it only to viewers your app has confirmed may see it. |
| `pending`           | Wait for the decision before showing it.                   |
| `blocked`, `purged` | Don't show it.                                             |

Treat a status you don't recognise as not allowed. `Assets.Create` queues processing, while `Assets.Classify` and `Text.Classify` wait for the decision; every network method takes a `context.Context` and returns a `*calmlens.Error` on failure.

## What you can do

- [Moderate text, images, audio, video and websites](https://calmlens.com/docs/sdk/go#moderate-content), and [wait for a decision](https://calmlens.com/docs/sdk/go/reference#queued-uploads-and-decisions) or receive it by [webhook](https://calmlens.com/docs/guides/webhooks).
- [Stream large uploads](https://calmlens.com/docs/sdk/go/reference#content-sources) from an `io.Reader`, send content over 8 MiB in resumable [multipart uploads](https://calmlens.com/docs/sdk/go/reference#multipart-uploads) automatically and apply [upload presets](https://calmlens.com/docs/sdk/go/reference#upload-tokens).
- [Read typed classification results](https://calmlens.com/docs/sdk/go/reference#classification-results), including categories, qualifiers and fields added after your SDK version.
- [Moderate replies in their conversation](https://calmlens.com/docs/sdk/go/reference#conversation-context).
- Manage assets, [folders](https://calmlens.com/docs/sdk/go/reference#folders), [hash lists](https://calmlens.com/docs/sdk/go/reference#hash-lists) and [lenses](https://calmlens.com/docs/sdk/go/reference#lenses), with [pagination iterators](https://calmlens.com/docs/sdk/go/reference#pagination).
- [Poll the project event feed](https://calmlens.com/docs/sdk/go/reference#events-feed) and decode each event's typed facts.
- [Verify webhook deliveries](https://calmlens.com/docs/sdk/go/reference#webhooks) with `net/http`, chi or gin.
- [Deliver content from the CDN](https://calmlens.com/docs/sdk/go/reference#cdn) with signed URLs, lenses, image transforms and [viewer claims](https://calmlens.com/docs/sdk/go/reference#viewer-claims).
- Rely on [safe automatic retries and idempotency keys](https://calmlens.com/docs/sdk/go/reference#retries-and-idempotency), [configurable timeouts](https://calmlens.com/docs/sdk/go/reference#client-options) and [structured errors](https://calmlens.com/docs/sdk/go/reference#errors).
- Forward webhooks during local development with the [CalmLens CLI](https://calmlens.com/docs/guides/local-development).

## Testing

The `calmlenstest` package runs the real client over an in-memory backend, with simulated moderation decisions, recorded requests and queued failures. To test against a real project, `GenerateTestTextCode`, `PaintTestImage` and `GenerateMediaTestCode` sign test inputs with the project's test input key from the portal. See [Go testing](https://calmlens.com/docs/sdk/go/testing).

## Links

- [Documentation](https://calmlens.com/docs/sdk/go)
- [Go SDK reference](https://calmlens.com/docs/sdk/go/reference)
- [API reference](https://calmlens.com/docs/api)
- [Changelog](https://github.com/CalmLens/sdks/blob/main/go/CHANGELOG.md)
- [License](https://github.com/CalmLens/sdks/blob/main/go/LICENSE)
