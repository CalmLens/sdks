// Package contract lets calmlenstest apply the calmlens package's own copies of the API's rules,
// so its in-memory API refuses what the API and CDN refuse: transform selectors and options, and
// upload MIME types. It is internal: only packages of this module can use it.
package contract

// CheckTransformOptions returns the dotted keys of options the transform schema doesn't know and
// those whose values it refuses (or that are required and missing); the calmlens package installs it.
var CheckTransformOptions func(options map[string]any) (unknownKeys, invalidKeys []string)

// ParseTransformSelector reads a CDN selector (the path after the resource, still
// percent-encoded) as the CDN does, returning its lens and options (nil when it has none), or ok
// false when the CDN refuses it as asset/invalid-transform; the calmlens package installs it.
var ParseTransformSelector func(selector string) (lens string, options map[string]any, ok bool)

// AcceptedUploadMimeType reports whether the API accepts an upload of mimeType; the calmlens
// package installs it.
var AcceptedUploadMimeType func(mimeType string) bool
