package calmlens

import (
	"context"
	"log/slog"
	"os"
	"strings"
	"time"
)

// AppInfo names your application in the User-Agent header, as " name/version (url)" after the
// SDK's own name. Version and URL are optional.
type AppInfo struct {
	Name    string
	Version string
	URL     string
}

// userAgent is the User-Agent suffix for info, or "" without it.
func (info *AppInfo) userAgent() (string, error) {
	if info == nil {
		return "", nil
	}
	for _, value := range []string{info.Name, info.Version, info.URL} {
		for _, char := range value {
			if char < 0x20 || char > 0x7e || strings.ContainsRune("()", char) {
				return "", invalid(CodeSDKInvalidConfig, "AppInfo can only hold printable ASCII without parentheses")
			}
		}
	}
	if strings.TrimSpace(info.Name) == "" || strings.ContainsAny(info.Name+info.Version, " /") {
		return "", invalid(CodeSDKInvalidConfig, "AppInfo.Name is required, and Name and Version can't hold spaces or slashes")
	}
	agent := " " + info.Name
	if info.Version != "" {
		agent += "/" + info.Version
	}
	if info.URL != "" {
		agent += " (" + info.URL + ")"
	}
	return agent, nil
}

// environmentLogger is the logger CALMLENS_LOG asks for: "info" or "debug" logs to standard
// error, and "" none.
func environmentLogger(level string) (*slog.Logger, error) {
	var minimum slog.Level
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "":
		return nil, nil
	case "info":
		minimum = slog.LevelInfo
	case "debug":
		minimum = slog.LevelDebug
	default:
		return nil, invalid(CodeSDKInvalidConfig, `CALMLENS_LOG must be "info" or "debug"`)
	}
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: minimum})), nil
}

// Attempt describes one attempt of an API request, for Options.OnAttempt. It never holds the API
// key, bodies or query parameters.
type Attempt struct {
	// Operation is the method that sent the request, named as in the API reference, such as
	// "assets.retrieve", or "request" for ServerClient.Request.
	Operation string
	// Method and Path are the request's, such as "GET" and "/assets/asset_1"; Path has no query.
	Method, Path string
	// Attempt counts from 1; a retry is attempt 2 or later.
	Attempt int
	// Delay is the wait before the retry that follows, or 0 when none does.
	Delay time.Duration
	// Status is the response's HTTP status, or 0 when none arrived.
	Status int
	// RequestID is the response's X-Request-Id, or empty.
	RequestID string
	// Duration is how long the attempt took.
	Duration time.Duration
	// Err is the attempt's error, or nil when it succeeded.
	Err error
}

type operationKey struct{}

// withCall carries a call's operation name and Params to the requests it sends.
func withCall(ctx context.Context, operation string, params Params) (context.Context, error) {
	ctx, err := withParams(ctx, params)
	if err != nil {
		return ctx, err
	}
	return context.WithValue(ctx, operationKey{}, operation), nil
}

// operationOf is the name of the method a request belongs to.
func operationOf(ctx context.Context) string {
	operation, _ := ctx.Value(operationKey{}).(string)
	return operation
}

// observe reports an attempt to Options.OnAttempt and the logger.
func (c *ServerClient) observe(ctx context.Context, attempt Attempt, final bool) {
	if c.options.OnAttempt != nil {
		c.options.OnAttempt(attempt)
	}
	if c.logger == nil {
		return
	}
	attrs := []slog.Attr{
		slog.String("operation", attempt.Operation), slog.String("method", attempt.Method),
		slog.String("path", attempt.Path), slog.Int("attempt", attempt.Attempt),
		slog.Int("status", attempt.Status), slog.String("request_id", attempt.RequestID),
		slog.Duration("duration", attempt.Duration),
	}
	if attempt.Err != nil {
		attrs = append(attrs, slog.String("code", string(CodeOf(attempt.Err))))
	}
	if !final {
		c.logger.LogAttrs(ctx, slog.LevelDebug, "calmlens request will be retried", append(attrs, slog.Duration("retry_in", attempt.Delay))...)
		return
	}
	level, message := slog.LevelInfo, "calmlens request"
	if attempt.Err != nil {
		level, message = slog.LevelWarn, "calmlens request failed"
	}
	c.logger.LogAttrs(ctx, level, message, attrs...)
}
