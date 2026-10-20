package calmlens

import "runtime"

// Version is the SDK version. Go modules are versioned by their release tag, so this
// constant is the single source for the version the SDK reports; it matches the tag of
// each release.
const Version = "0.1.0"

// userAgent identifies the SDK, e.g. "calmlens-go/0.1.0 (go1.22.5; linux/amd64)".
var userAgent = "calmlens-go/" + Version + " (" + runtime.Version() + "; " + runtime.GOOS + "/" + runtime.GOARCH + ")"
