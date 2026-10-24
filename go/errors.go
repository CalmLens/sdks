package calmlens

import (
	"context"
	"errors"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

//go:generate go run ./internal/errorcodesgen ../shared/src/PublicErrorCodes.ts errorcodes.go

// Error codes the SDK itself produces, in addition to the API codes in errorcodes.go.
const (
	// CodeSDKTransportError means the request could not be sent or its response could not be
	// read: connection refused or reset, TLS, malformed HTTP, decompression or a truncated body.
	CodeSDKTransportError = "sdk/transport-error"
	// CodeSDKTimeout means a timeout or context deadline expired.
	CodeSDKTimeout = "sdk/timeout"
	// CodeSDKCancelled means the context was cancelled.
	CodeSDKCancelled = "sdk/cancelled"
	// CodeSDKInvalidResponse means a success response was empty, not JSON or unexpected.
	CodeSDKInvalidResponse = "sdk/invalid-response"
	// CodeSDKResponseTooLarge means a response body exceeded Options.MaxResponseBytes.
	CodeSDKResponseTooLarge = "sdk/response-too-large"
	// CodeSDKHTTPError means a non-2xx response had no CalmLens error body.
	CodeSDKHTTPError = "sdk/http-error"
	// CodeSDKInvalidArgument means a method argument was rejected before any request was sent.
	CodeSDKInvalidArgument = "sdk/invalid-argument"
	// CodeSDKInvalidConfig means NewServerClient rejected an option.
	CodeSDKInvalidConfig = "sdk/invalid-config"
	// CodeSDKInvalidWebhookSignature means a webhook delivery failed signature or timestamp
	// verification.
	CodeSDKInvalidWebhookSignature = "sdk/invalid-webhook-signature"
	// CodeSDKInvalidWebhookPayload means a verified webhook body was not a valid event.
	CodeSDKInvalidWebhookPayload = "sdk/invalid-webhook-payload"
)

// Error is the error type every SDK method returns. Use errors.As to read it:
//
//	var apiErr *calmlens.Error
//	if errors.As(err, &apiErr) && apiErr.Code == calmlens.CodeAssetNotFound { ... }
type Error struct {
	// Code is an API error code (see errorcodes.go) or an "sdk/" code produced locally.
	Code string `json:"code"`
	// Message is a human-readable description. Do not match on it.
	Message string `json:"message"`
	// Details holds structured details from the API, with the API's "traceId" when it sent one,
	// or local details such as "cursor" for a repeated iterator cursor. It is nil when there are
	// none, as for transport failures.
	Details JSON `json:"details"`
	// Status is the HTTP status, or 0 when no response was received.
	Status int `json:"-"`
	// RequestID is the X-Request-Id response header; include it when contacting support.
	RequestID string `json:"-"`
	// Header holds the response headers, or nil when no response was received.
	Header http.Header `json:"-"`
	// RetryAfter is the delay from the Retry-After header (seconds or an HTTP date), or nil when
	// the response had none. Zero means retry at once.
	RetryAfter *time.Duration `json:"-"`
	// Cause is the underlying error, if any. It is returned by Unwrap.
	Cause error `json:"-"`
}

// Error formats the code, status, message and request ID.
func (e *Error) Error() string {
	var out strings.Builder
	out.WriteString("[calmlens] ")
	out.WriteString(e.Code)
	if e.Status != 0 {
		out.WriteString(" (HTTP " + strconv.Itoa(e.Status) + ")")
	}
	if e.Message != "" && e.Message != e.Code {
		out.WriteString(": " + e.Message)
	}
	if e.RequestID != "" {
		out.WriteString(" [request " + e.RequestID + "]")
	}
	return out.String()
}

// Unwrap returns Cause so errors.Is and errors.As reach the underlying error.
func (e *Error) Unwrap() error { return e.Cause }

// Retryable reports whether repeating the same request may succeed: transport failures and
// timeouts, 429, 502, 503, 504 and idempotency/request-in-progress. Writes without an
// Idempotency-Key may already have been applied; check before repeating them.
func (e *Error) Retryable() bool {
	switch e.Status {
	case 429, 502, 503, 504:
		return true
	}
	return e.Code == CodeSDKTransportError || e.Code == CodeSDKTimeout || e.Code == CodeIdempotentRequestInProgress
}

// ErrorCode returns the Code of a *Error in err's chain, or "" when there is none.
func ErrorCode(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

// IsNotFound reports whether err is an API 404 (for example asset/not-found or
// folder/not-found).
func IsNotFound(err error) bool {
	var e *Error
	return errors.As(err, &e) && e.Status == http.StatusNotFound
}

// IsRetryable reports whether err is a *Error whose Retryable method returns true.
func IsRetryable(err error) bool {
	var e *Error
	return errors.As(err, &e) && e.Retryable()
}

// PublicErrorStatus returns the HTTP status the API uses for an API error code.
func PublicErrorStatus(code string) (int, bool) {
	status, ok := publicErrorStatuses[code]
	return status, ok
}

// transportError wraps a failure to send a request or read its response (connection,
// TLS, protocol, decompression, truncated body, timeout or cancellation) in *Error,
// keeping the original error reachable through errors.Is/As.
func transportError(cause error) error {
	code := CodeSDKTransportError
	var timeout net.Error
	if errors.Is(cause, context.Canceled) {
		code = CodeSDKCancelled
	} else if errors.Is(cause, context.DeadlineExceeded) || errors.As(cause, &timeout) && timeout.Timeout() {
		code = CodeSDKTimeout
	}
	return &Error{Code: code, Message: cause.Error(), Cause: cause}
}

// invalid returns a local validation error with the given code.
func invalid(code, message string) error { return &Error{Code: code, Message: message} }

// argumentError wraps a local failure (encoding a body or query, building a request) as
// sdk/invalid-argument.
func argumentError(message string, cause error) error {
	return &Error{Code: CodeSDKInvalidArgument, Message: message + ": " + cause.Error(), Cause: cause}
}

// parseRetryAfter reads delay-seconds or an HTTP date (rounded up to whole seconds, and zero
// when it has passed). It returns nil when value is absent or neither.
func parseRetryAfter(value string, now time.Time) *time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if strings.Trim(value, "0123456789") == "" {
		seconds, err := strconv.ParseInt(value, 10, 64)
		if err != nil || seconds > int64(math.MaxInt64/time.Second) {
			seconds = int64(math.MaxInt64 / time.Second)
		}
		delay := time.Duration(seconds) * time.Second
		return &delay
	}
	at, err := http.ParseTime(value)
	if err != nil {
		return nil
	}
	delay := time.Duration(0)
	if remaining := at.Sub(now); remaining > 0 {
		// Sub saturates for far dates; round up without overflowing.
		delay = min(remaining, time.Duration(math.MaxInt64)-time.Second)
		delay = (delay + time.Second - 1).Truncate(time.Second)
	}
	return &delay
}
