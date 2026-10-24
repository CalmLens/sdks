// Package clock lets calmlenstest replace a client's clock and sleep, so mock waits take no real
// time. It is internal: only packages of this module can use it.
package clock

import (
	"context"
	"time"
)

// Set replaces client's clock and sleep; the calmlens package installs it.
var Set func(client any, now func() time.Time, sleep func(context.Context, time.Duration) error)
