package calmlens

import (
	"context"
	"iter"
)

// Iterator walks every item of a cursor list across pages. It fetches pages lazily, keeps
// the list's options and follows each page's NextCursor while HasMore is true:
//
//	it := client.Folders.ListAll(calmlens.ListFoldersOptions{PageSize: 100})
//	for it.Next(ctx) {
//		folder := it.Item()
//	}
//	if err := it.Err(); err != nil { ... }
//
// On Go 1.23 or later, range over All instead:
//
//	for folder, err := range client.Folders.ListAll(options).All(ctx) { ... }
//
// A page that says more follow but repeats a cursor already returned fails with
// sdk/invalid-response (Details {"cursor"}). An iterator is not safe for concurrent use.
type Iterator[T any] struct {
	fetch  func(context.Context, string) ([]T, string, bool, error)
	cursor string
	items  []T
	pos    int
	err    error
	done   bool
	// sent holds the cursors returned so far, so a page that repeats one fails instead of
	// looping.
	sent map[string]bool
}

// cursorOf is a page's next cursor, or "" on the last page.
func cursorOf(cursor *string) string {
	if cursor == nil {
		return ""
	}
	return *cursor
}

// newIterator starts at cursor; fetch returns a page's items, NextCursor and HasMore.
func newIterator[T any](cursor string, fetch func(context.Context, string) ([]T, string, bool, error)) *Iterator[T] {
	return &Iterator[T]{cursor: cursor, fetch: fetch}
}

// Next advances to the next item, fetching the next page when needed. It returns false when
// there are no more items or a request failed; check Err afterwards.
func (it *Iterator[T]) Next(ctx context.Context) bool {
	for {
		if it.err != nil {
			return false
		}
		if it.pos < len(it.items) {
			it.pos++
			return true
		}
		if it.done {
			return false
		}
		items, next, hasMore, err := it.fetch(ctx, it.cursor)
		if err != nil {
			it.err = err
			return false
		}
		more := next != "" && hasMore && len(items) > 0
		if more {
			if it.err = repeatedCursor(&it.sent, next); it.err != nil {
				return false
			}
		}
		it.items, it.pos = items, 0
		it.cursor = next
		it.done = !more
	}
}

// Item returns the current item. Call it only after Next returned true.
func (it *Iterator[T]) Item() T { return it.items[it.pos-1] }

// Err returns the error that stopped iteration, if any.
func (it *Iterator[T]) Err() error { return it.err }

// All returns a range-over-func sequence (Go 1.23+) of items. A failure is yielded once with
// a zero item and ends the sequence.
func (it *Iterator[T]) All(ctx context.Context) iter.Seq2[T, error] {
	return func(yield func(T, error) bool) {
		for it.Next(ctx) {
			if !yield(it.Item(), nil) {
				return
			}
		}
		if it.err != nil {
			var zero T
			yield(zero, it.err)
		}
	}
}

// AssetIterator walks every asset across pages, as Iterator does; Asset returns the current
// asset and Page the page it came from:
//
//	it := client.Assets.ListAll(calmlens.ListAssetsOptions{PageSize: 100})
//	for it.Next(ctx) {
//		asset := it.Asset()
//	}
//	if err := it.Err(); err != nil { ... }
type AssetIterator struct {
	Iterator[Asset]
	page *AssetPage
}

func newAssetIterator(cursor string, list func(context.Context, string) (*AssetPage, error)) *AssetIterator {
	it := &AssetIterator{}
	it.Iterator = Iterator[Asset]{cursor: cursor, fetch: func(ctx context.Context, cursor string) ([]Asset, string, bool, error) {
		page, err := list(ctx, cursor)
		if err != nil {
			return nil, "", false, err
		}
		it.page = page
		return page.Items, cursorOf(page.NextCursor), page.HasMore, nil
	}}
	return it
}

// ListAll iterates over every asset matching options, starting at options.Cursor.
func (s *AssetsService) ListAll(options ListAssetsOptions) *AssetIterator {
	return newAssetIterator(options.Cursor, func(ctx context.Context, cursor string) (*AssetPage, error) {
		options.Cursor = cursor
		return s.List(ctx, options)
	})
}

// ListChildrenAll iterates over every child of an asset, starting at options.Cursor.
func (s *AssetsService) ListChildrenAll(options ListAssetChildrenOptions) *AssetIterator {
	return newAssetIterator(options.Cursor, func(ctx context.Context, cursor string) (*AssetPage, error) {
		options.Cursor = cursor
		return s.ListChildren(ctx, options)
	})
}

// ListTimelineAll iterates over every segment of an audio or video asset's findings timeline,
// in time order, starting at options.Cursor.
func (s *AssetsService) ListTimelineAll(options ListAssetTimelineOptions) *Iterator[MediaClassificationSegment] {
	return newIterator(options.Cursor, func(ctx context.Context, cursor string) ([]MediaClassificationSegment, string, bool, error) {
		options.Cursor = cursor
		page, err := s.ListTimeline(ctx, options)
		if err != nil {
			return nil, "", false, err
		}
		return page.Items, cursorOf(page.NextCursor), page.HasMore, nil
	})
}

// ListAll iterates over every child folder of options.ParentID (or the root), starting at
// options.Cursor.
func (s *FoldersService) ListAll(options ListFoldersOptions) *Iterator[Folder] {
	return newIterator(options.Cursor, func(ctx context.Context, cursor string) ([]Folder, string, bool, error) {
		options.Cursor = cursor
		page, err := s.List(ctx, options)
		if err != nil {
			return nil, "", false, err
		}
		return page.Items, cursorOf(page.NextCursor), page.HasMore, nil
	})
}

// ListAll iterates over every hash list of the project, starting at options.Cursor.
func (s *HashListsService) ListAll(options ListHashListsOptions) *Iterator[HashList] {
	return newIterator(options.Cursor, func(ctx context.Context, cursor string) ([]HashList, string, bool, error) {
		options.Cursor = cursor
		page, err := s.List(ctx, options)
		if err != nil {
			return nil, "", false, err
		}
		return page.Items, cursorOf(page.NextCursor), page.HasMore, nil
	})
}

// ListEntriesAll iterates over every entry of a hash list, starting at options.Cursor.
func (s *HashListsService) ListEntriesAll(options ListHashListEntriesOptions) *Iterator[HashListEntry] {
	return newIterator(options.Cursor, func(ctx context.Context, cursor string) ([]HashListEntry, string, bool, error) {
		options.Cursor = cursor
		page, err := s.ListEntries(ctx, options)
		if err != nil {
			return nil, "", false, err
		}
		return page.Items, cursorOf(page.NextCursor), page.HasMore, nil
	})
}

// ListAll iterates over every lens of the project, starting at options.Cursor.
func (s *LensesService) ListAll(options ListLensesOptions) *Iterator[Lens] {
	return newIterator(options.Cursor, func(ctx context.Context, cursor string) ([]Lens, string, bool, error) {
		options.Cursor = cursor
		page, err := s.List(ctx, options)
		if err != nil {
			return nil, "", false, err
		}
		return page.Items, cursorOf(page.NextCursor), page.HasMore, nil
	})
}

// repeatedCursor records cursor in sent and fails with sdk/invalid-response (Details
// {"cursor"}) when a page with more to follow hands back a cursor already returned.
func repeatedCursor(sent *map[string]bool, cursor string) error {
	if *sent == nil {
		*sent = map[string]bool{}
	}
	if (*sent)[cursor] {
		return &Error{Code: CodeSDKInvalidResponse, Message: "The API returned a cursor it had already returned, with more pages to follow", Details: JSON{"cursor": cursor}}
	}
	(*sent)[cursor] = true
	return nil
}

// Asset returns the current asset. Call it only after Next returned true.
func (it *AssetIterator) Asset() Asset { return it.Item() }

// Page returns the most recently fetched page, or nil before the first fetch.
func (it *AssetIterator) Page() *AssetPage { return it.page }

// EventIterator follows the event feed cursor until no more events are available.
//
//	it := client.Events.ListAll(calmlens.ListEventsOptions{Cursor: savedCursor})
//	for it.Next(ctx) {
//		handle(it.Event())
//	}
//	savedCursor = it.Cursor() // persist it, even after an error
//
// Without Cursor the feed starts at "now", so the first page is empty and iteration stops
// at once; save Cursor and iterate again later. NextPage walks the same feed a page at a time.
type EventIterator struct {
	s       *EventsService
	options ListEventsOptions
	page    *EventsPage
	pos     int
	err     error
	done    bool
	sent    map[string]bool
}

// ListAll iterates over events after options.Cursor, following each page's NextCursor.
func (s *EventsService) ListAll(options ListEventsOptions) *EventIterator {
	it := &EventIterator{s: s, options: options}
	if options.Cursor != "" {
		it.sent = map[string]bool{options.Cursor: true}
	}
	return it
}

// NextPage fetches the next page of events, which may be empty. It returns false when the
// previous page said no more events follow or a request failed; check Err afterwards. A page
// that says more follow but repeats a cursor already sent fails with sdk/invalid-response
// (Details {"cursor"}) and is not returned. Do not mix NextPage and Next on one iterator.
func (it *EventIterator) NextPage(ctx context.Context) bool {
	if it.err != nil || it.done {
		return false
	}
	page, err := it.s.List(ctx, it.options)
	if err != nil {
		it.err = err
		return false
	}
	if page.HasMore {
		if it.err = repeatedCursor(&it.sent, page.NextCursor); it.err != nil {
			return false
		}
	}
	it.page, it.pos = page, 0
	if page.NextCursor != "" {
		it.options.Cursor = page.NextCursor
	}
	it.done = !page.HasMore
	return true
}

// Page returns the page NextPage (or Next) fetched last, or nil before the first fetch.
func (it *EventIterator) Page() *EventsPage { return it.page }

// Next advances to the next event. It returns false when the feed has no more events or
// a request failed; check Err afterwards.
func (it *EventIterator) Next(ctx context.Context) bool {
	for {
		if it.page != nil && it.pos < len(it.page.Items) {
			it.pos++
			return true
		}
		if !it.NextPage(ctx) {
			return false
		}
	}
}

// Event returns the current event. Call it only after Next returned true.
func (it *EventIterator) Event() Event { return it.page.Items[it.pos-1] }

// Cursor returns the cursor to resume from: pass it as ListEventsOptions.Cursor, with the same
// Types and AssetID, to continue after the last page fetched.
func (it *EventIterator) Cursor() string { return it.options.Cursor }

// Err returns the error that stopped iteration, if any.
func (it *EventIterator) Err() error { return it.err }

// All returns a range-over-func sequence (Go 1.23+) of events. A failure is yielded once
// with a zero Event and ends the sequence.
func (it *EventIterator) All(ctx context.Context) iter.Seq2[Event, error] {
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
