package calmlens

import "net/http"

// errorKind is a kind of *Error, which errors.Is matches: an error of a kind also matches each
// kind above it, such as ErrNotFound and ErrAPI for a 404.
type errorKind struct {
	name   string
	parent *errorKind
}

func (k *errorKind) Error() string { return "calmlens: " + k.name }

// The kinds of *Error, for errors.Is. *Error itself is the root kind: use errors.As to read one.
var (
	// ErrAPI is any non-2xx answer from the API, or a proxy in front of it.
	ErrAPI error = errAPI
	// ErrBadRequest is an HTTP 400: the request was invalid.
	ErrBadRequest error = &errorKind{"bad request", errAPI}
	// ErrAuthentication is an HTTP 401: the API key is missing or invalid.
	ErrAuthentication error = &errorKind{"authentication", errAPI}
	// ErrPermissionDenied is an HTTP 403: the API key lacks a grant.
	ErrPermissionDenied error = &errorKind{"permission denied", errAPI}
	// ErrNotFound is an HTTP 404: the resource doesn't exist.
	ErrNotFound error = &errorKind{"not found", errAPI}
	// ErrConflict is an HTTP 409: the request conflicts with the resource's state.
	ErrConflict error = &errorKind{"conflict", errAPI}
	// ErrPayloadTooLarge is an HTTP 413: the content is over a size limit.
	ErrPayloadTooLarge error = &errorKind{"payload too large", errAPI}
	// ErrUnprocessableEntity is an HTTP 422: the content can't be processed.
	ErrUnprocessableEntity error = &errorKind{"unprocessable entity", errAPI}
	// ErrRateLimit is an HTTP 429: too many requests.
	ErrRateLimit error = &errorKind{"rate limit", errAPI}
	// ErrServer is an HTTP 500 or above: the API failed.
	ErrServer error = &errorKind{"server", errAPI}
	// ErrConnection is a request with no complete response: the connection failed or was cut.
	ErrConnection error = &errorKind{"connection", nil}
	// ErrTimeout is a request that took longer than its timeout, or a wait that reached its
	// deadline.
	ErrTimeout error = &errorKind{"timeout", nil}
	// ErrCancelled is a call the caller cancelled through its context.
	ErrCancelled error = &errorKind{"cancelled", nil}
	// ErrInvalidArgument is a call the SDK refused before sending anything.
	ErrInvalidArgument error = errInvalidArgument
	// ErrConfiguration is an invalid client configuration.
	ErrConfiguration error = &errorKind{"configuration", errInvalidArgument}
	// ErrInvalidResponse is a response that wasn't what the operation returns.
	ErrInvalidResponse error = &errorKind{"invalid response", nil}
	// ErrWebhookVerification is a webhook delivery that couldn't be verified or parsed.
	ErrWebhookVerification error = &errorKind{"webhook verification", nil}
)

var (
	errAPI             = &errorKind{"API", nil}
	errInvalidArgument = &errorKind{"invalid argument", nil}
)

// statusKinds are the API kinds by HTTP status.
var statusKinds = map[int]error{
	http.StatusBadRequest:            ErrBadRequest,
	http.StatusUnauthorized:          ErrAuthentication,
	http.StatusForbidden:             ErrPermissionDenied,
	http.StatusNotFound:              ErrNotFound,
	http.StatusConflict:              ErrConflict,
	http.StatusRequestEntityTooLarge: ErrPayloadTooLarge,
	http.StatusUnprocessableEntity:   ErrUnprocessableEntity,
	http.StatusTooManyRequests:       ErrRateLimit,
}

// sdkKinds are the kinds of the SDK's own codes, apart from CodeSDKHTTPError, whose status
// decides.
var sdkKinds = map[ErrorCode]error{
	CodeSDKTransportError:          ErrConnection,
	CodeSDKTimeout:                 ErrTimeout,
	CodeSDKCancelled:               ErrCancelled,
	CodeSDKInvalidResponse:         ErrInvalidResponse,
	CodeSDKResponseTooLarge:        ErrInvalidResponse,
	CodeSDKInvalidArgument:         ErrInvalidArgument,
	CodeSDKInvalidConfig:           ErrConfiguration,
	CodeSDKInvalidWebhookSignature: ErrWebhookVerification,
	CodeSDKInvalidWebhookPayload:   ErrWebhookVerification,
}

// Kind returns the error's most specific kind, such as ErrNotFound; errors.Is(err, kind) is true
// for it and every kind above it.
func (e *Error) Kind() error {
	if kind, ok := sdkKinds[e.Code]; ok {
		return kind
	}
	if e.Status == 0 {
		if e.Code == CodeSDKHTTPError {
			return ErrAPI
		}
		// An API code the SDK raised before sending, such as upload/unsupported-type.
		return ErrInvalidArgument
	}
	if e.Status >= 500 {
		return ErrServer
	}
	if kind, ok := statusKinds[e.Status]; ok {
		return kind
	}
	return ErrAPI
}

// Is reports whether target is the error's kind or a kind above it, for errors.Is.
func (e *Error) Is(target error) bool {
	want, ok := target.(*errorKind)
	if !ok {
		return false
	}
	for kind := e.Kind().(*errorKind); kind != nil; kind = kind.parent {
		if kind == want {
			return true
		}
	}
	return false
}
