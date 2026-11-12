package calmlens

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"sync"
)

// responseJSON keeps a response model's JSON object as the API sent it. Every model the API
// returns embeds it, so each one has RawJSON and ExtraFields.
type responseJSON struct {
	raw   json.RawMessage
	model reflect.Type
}

// RawJSON returns the model's JSON object as the API sent it, including fields this SDK doesn't
// declare, or nil for a model that wasn't decoded from a response.
func (r responseJSON) RawJSON() json.RawMessage { return r.raw }

// ExtraFields returns the fields of RawJSON that the model declares no field for, such as fields
// added to the API after this SDK, or nil when there are none.
func (r responseJSON) ExtraFields() map[string]json.RawMessage {
	var fields map[string]json.RawMessage
	if r.raw == nil || json.Unmarshal(r.raw, &fields) != nil {
		return nil
	}
	for name := range knownFields(r.model) {
		delete(fields, name)
	}
	if len(fields) == 0 {
		return nil
	}
	return fields
}

// decodeModel decodes data into model, a response model's plain type, and keeps a copy of data.
func decodeModel[T any](data []byte, model *T, raw *responseJSON) error {
	if err := decodeJSON(data, model); err != nil {
		return err
	}
	if string(data) != "null" {
		raw.raw, raw.model = bytes.Clone(data), reflect.TypeFor[T]()
	}
	return nil
}

var modelFields sync.Map // reflect.Type -> map[string]bool

// knownFields returns the JSON names a struct type decodes, embedded structs included.
func knownFields(model reflect.Type) map[string]bool {
	if cached, ok := modelFields.Load(model); ok {
		return cached.(map[string]bool)
	}
	names := map[string]bool{}
	var add func(reflect.Type)
	add = func(t reflect.Type) {
		for i := 0; i < t.NumField(); i++ {
			field := t.Field(i)
			name, _, _ := strings.Cut(field.Tag.Get("json"), ",")
			if field.Anonymous && name == "" && field.Type.Kind() == reflect.Struct {
				add(field.Type)
				continue
			}
			if !field.IsExported() || name == "-" {
				continue
			}
			if name == "" {
				name = field.Name
			}
			names[name] = true
		}
	}
	add(model)
	modelFields.Store(model, names)
	return names
}
