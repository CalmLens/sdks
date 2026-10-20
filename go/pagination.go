package calmlens

import "context"

// AssetIterator walks every asset across pages. It fetches pages lazily:
//
//	it := client.Assets.ListAll(calmlens.ListAssetsOptions{PageSize: 100})
//	for it.Next(ctx) {
//		asset := it.Asset()
//	}
//	if err := it.Err(); err != nil { ... }
//
// On Go 1.23 or later, range over All instead:
//
//	for asset, err := range client.Assets.ListAll(options).All(ctx) { ... }
//
// An iterator is not safe for concurrent use.
type AssetIterator struct {
	fetch func(context.Context, string) (*AssetPage, error)
	index string
	page  *AssetPage
	pos   int
	err   error
	done  bool
}

// ListAll iterates over every asset matching options, starting at options.Cursor.
func (s *AssetsService) ListAll(options ListAssetsOptions) *AssetIterator {
	return &AssetIterator{index: options.Cursor, fetch: func(ctx context.Context, index string) (*AssetPage, error) {
		options.Cursor = index
		return s.List(ctx, options)
	}}
}

// ListChildrenAll iterates over every child of an asset, starting at options.Cursor.
func (s *AssetsService) ListChildrenAll(options ListAssetChildrenOptions) *AssetIterator {
	return &AssetIterator{index: options.Cursor, fetch: func(ctx context.Context, index string) (*AssetPage, error) {
		options.Cursor = index
		return s.ListChildren(ctx, options)
	}}
}

// Next advances to the next asset, fetching the next page when needed. It returns false
// when there are no more assets or a request failed; check Err afterwards.
func (it *AssetIterator) Next(ctx context.Context) bool {
	for {
		if it.err != nil {
			return false
		}
		if it.page != nil && it.pos < len(it.page.Items) {
			it.pos++
			return true
		}
		if it.done || it.page != nil && (!it.page.HasMore || len(it.page.Items) == 0) {
			it.done = true
			return false
		}
		page, err := it.fetch(ctx, it.index)
		if err != nil {
			it.err = err
			return false
		}
		it.page, it.pos = page, 0
		it.index = page.NextCursor
		if it.index == "" {
			it.done = true
		}
	}
}

// Asset returns the current asset. Call it only after Next returned true.
func (it *AssetIterator) Asset() Asset { return it.page.Items[it.pos-1] }

// Page returns the most recently fetched page, or nil before the first fetch.
func (it *AssetIterator) Page() *AssetPage { return it.page }

// Err returns the error that stopped iteration, if any.
func (it *AssetIterator) Err() error { return it.err }

// All returns a range-over-func sequence (Go 1.23+) of assets. A failure is yielded once
// with a zero Asset and ends the sequence.
func (it *AssetIterator) All(ctx context.Context) func(yield func(Asset, error) bool) {
	return func(yield func(Asset, error) bool) {
		for it.Next(ctx) {
			if !yield(it.Asset(), nil) {
				return
			}
		}
		if it.err != nil {
			yield(Asset{}, it.err)
		}
	}
}

// EventIterator follows the event feed cursor until no more events are available.
//
//	it := client.Events.ListAll(calmlens.ListEventsOptions{After: savedCursor})
//	for it.Next(ctx) {
//		handle(it.Event())
//	}
//	savedCursor = it.Cursor() // persist it, even after an error
//
// Without After the feed starts at "now", so the first page is empty and iteration stops
// at once; save Cursor and iterate again later.
type EventIterator struct {
	s       *EventsService
	options ListEventsOptions
	page    *EventsPage
	pos     int
	err     error
	done    bool
}

// ListAll iterates over events after options.After, following the cursor across pages.
func (s *EventsService) ListAll(options ListEventsOptions) *EventIterator {
	return &EventIterator{s: s, options: options}
}

// Next advances to the next event. It returns false when the feed has no more events or
// a request failed; check Err afterwards.
func (it *EventIterator) Next(ctx context.Context) bool {
	for {
		if it.err != nil {
			return false
		}
		if it.page != nil && it.pos < len(it.page.Events) {
			it.pos++
			return true
		}
		if it.done || it.page != nil && (!it.page.HasMore || len(it.page.Events) == 0) {
			it.done = true
			return false
		}
		page, err := it.s.List(ctx, it.options)
		if err != nil {
			it.err = err
			return false
		}
		it.page, it.pos = page, 0
		if page.Cursor != "" {
			it.options.After = page.Cursor
		}
	}
}

// Event returns the current event. Call it only after Next returned true.
func (it *EventIterator) Event() Event { return it.page.Events[it.pos-1] }

// Cursor returns the cursor to resume from: pass it as After to continue after the last
// page fetched.
func (it *EventIterator) Cursor() string { return it.options.After }

// Err returns the error that stopped iteration, if any.
func (it *EventIterator) Err() error { return it.err }

// All returns a range-over-func sequence (Go 1.23+) of events. A failure is yielded once
// with a zero Event and ends the sequence.
func (it *EventIterator) All(ctx context.Context) func(yield func(Event, error) bool) {
	return func(yield func(Event, error) bool) {
		for it.Next(ctx) {
			if !yield(it.Event(), nil) {
				return
			}
		}
		if it.err != nil {
			yield(Event{}, it.err)
		}
	}
}
