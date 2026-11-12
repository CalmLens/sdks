package calmlens

import (
	"context"
	"net/http"
	"time"
)

// Params are the per-call options every method's options embed, such as
//
//	client.Folders.Retrieve(ctx, calmlens.FolderIDOptions{FolderID: id, Params: calmlens.Params{Timeout: 5 * time.Second}})
//
// Zero fields keep the client's settings.
type Params struct {
	// Headers are added to each request of the call. They can't replace the headers the SDK
	// sets itself (X-Api-Key, User-Agent, Accept, Content-Type and Idempotency-Key).
	Headers http.Header
	// Extra holds fields this SDK doesn't declare, such as a field added to the API after it: they
	// are added to the JSON body, or to the query of a request without one. Uploads, whose
	// options travel in the request body or form, refuse them.
	Extra map[string]any
	// Timeout replaces Options.Timeout, or Options.UploadTimeout for binary uploads, for each
	// attempt of the call. Negative values are rejected.
	Timeout time.Duration
	// MaxRetries replaces Options.MaxRetries for the call. Use Ptr(0) to disable retries;
	// negative values are rejected.
	MaxRetries *int
	// IdempotencyKey is sent as the Idempotency-Key header, which makes a POST, PUT, PATCH or
	// DELETE safe to retry; the API runs a repeated key once. Uploads generate one when it is
	// empty, and calling again with the same key resumes a split upload.
	IdempotencyKey string
}

type paramsKey struct{}

// withParams carries a call's Params to the requests it sends.
func withParams(ctx context.Context, params Params) (context.Context, error) {
	if params.Timeout < 0 || params.MaxRetries != nil && *params.MaxRetries < 0 {
		return ctx, invalid(CodeSDKInvalidArgument, "Params.Timeout and Params.MaxRetries cannot be negative")
	}
	return context.WithValue(ctx, paramsKey{}, &params), nil
}

// paramsOf returns the Params of the call ctx belongs to.
func paramsOf(ctx context.Context) *Params {
	if params, ok := ctx.Value(paramsKey{}).(*Params); ok {
		return params
	}
	return &Params{}
}

// APIResponse is the HTTP response a model was decoded from.
type APIResponse struct {
	// StatusCode is the HTTP status, such as 200.
	StatusCode int
	// Header holds the response headers.
	Header http.Header
	// RequestID is the X-Request-Id header; include it when contacting support.
	RequestID string
	// IdempotencyKey is the Idempotency-Key the request was sent with, or empty.
	IdempotencyKey string
}

// APIResource is embedded in every model a method returns, as stripe-go's resources do.
type APIResource struct {
	// LastResponse is the response the model came from, or nil for a model listed inside another
	// one, built in code or returned by calmlenstest without a request.
	LastResponse *APIResponse `json:"-"`
}

func (r *APIResource) setLastResponse(response *APIResponse) { r.LastResponse = response }

type lastResponseSetter interface{ setLastResponse(*APIResponse) }

// timeout is the call's Params.Timeout, or Options.Timeout.
func (c *ServerClient) timeout(ctx context.Context) time.Duration {
	if params := paramsOf(ctx); params.Timeout > 0 {
		return params.Timeout
	}
	return c.options.Timeout
}

// withoutIdempotencyKey keeps a call's Params for a method that sends several requests, each
// with its own idempotency key, or none.
func withoutIdempotencyKey(ctx context.Context) context.Context {
	params := *paramsOf(ctx)
	params.IdempotencyKey = ""
	return context.WithValue(ctx, paramsKey{}, &params)
}
