package calmlens

import "encoding/json"

type patchState uint8

const (
	patchUnset patchState = iota
	patchValue
	patchNull
)

// Patch is one field of a partial update. The zero value leaves the field unchanged, Set
// changes it and Null clears it:
//
//	calmlens.UpdateAssetOptions{AssetID: id, Description: calmlens.Null[string](), Tags: calmlens.Set([]string{"reviewed"})}
type Patch[T any] struct {
	value T
	state patchState
}

// Set returns a Patch that changes the field to value.
func Set[T any](value T) Patch[T] { return Patch[T]{value: value, state: patchValue} }

// Null returns a Patch that clears the field (sends null).
func Null[T any]() Patch[T] { return Patch[T]{state: patchNull} }

// IsSet reports whether the field is sent, either as a value or as null.
func (p Patch[T]) IsSet() bool { return p.state != patchUnset }

// IsNull reports whether the field is cleared.
func (p Patch[T]) IsNull() bool { return p.state == patchNull }

// Value returns the new value and whether one is set (false when unset or null).
func (p Patch[T]) Value() (T, bool) { return p.value, p.state == patchValue }

// MarshalJSON encodes the value, or null when the field is cleared or unset.
func (p Patch[T]) MarshalJSON() ([]byte, error) {
	if p.state != patchValue {
		return []byte("null"), nil
	}
	return json.Marshal(p.value)
}

// UnmarshalJSON decodes null as Null and anything else as Set. A key that is absent leaves
// the Patch unset.
func (p *Patch[T]) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		*p = Null[T]()
		return nil
	}
	var value T
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*p = Set(value)
	return nil
}

// put adds the field to body when it is set.
func (p Patch[T]) put(body map[string]any, key string) {
	if p.state != patchUnset {
		body[key] = p
	}
}
