package calmlens

import (
	"runtime"
	"strings"
)

// Version is the SDK version. Go modules are versioned by their release tag, so this
// constant is the single source for the version the SDK reports; it matches the tag of
// each release.
const Version = "0.1.1"

// userAgent identifies the SDK and its runtime, e.g. "calmlens-go/0.1.0 (go/1.22.5)".
var userAgent = "calmlens-go/" + Version + " (" + runtimeName(runtime.Version()) + ")"

// runtimeName is "go/<version>" for a release toolchain and "go" for a development build.
func runtimeName(version string) string {
	release, ok := strings.CutPrefix(version, "go")
	if !ok || release == "" || strings.ContainsAny(release, " ()") {
		return "go"
	}
	return "go/" + release
}
