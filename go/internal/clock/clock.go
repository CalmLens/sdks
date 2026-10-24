// Package clock lets calmlenstest replace a client's clock and sleep, so mock waits take no real
// time, sign upload tokens at a fixed time and leave multipart size checks to its in-memory API.
// It is internal: only packages of this module can use it.
package clock

import (
	"context"
	"time"
)

// Set replaces client's clock and sleep; the calmlens package installs it.
var Set func(client any, now func() time.Time, sleep func(context.Context, time.Duration) error)

// SignUploadToken signs an upload token (options is a calmlens.SignUploadTokenOptions) at now
// with nonce, returning a *calmlens.SignedUploadToken; the calmlens package installs it.
var SignUploadToken func(apiKey string, options any, now time.Time, nonce string) (any, error)

// DeferUploadChecks makes client leave multipart size checks to the API, so the in-memory API
// answers them in the API's order; the calmlens package installs it.
var DeferUploadChecks func(client any)
