package calmlenstest

import (
	"bytes"
	"encoding/json"
	"mime"
	"net/http"
	"net/url"
	"strings"

	calmlens "github.com/CalmLens/sdks/go"
)

// uploadOptionKeys are the asset fields an upload carries in its body: the JSON body of text and
// URLs, or the options part of an upload form. The API refuses them in the query string.
var uploadOptionKeys = []string{"name", "description", "processingOptions", "visibility", "metadata", "tags", "authorId", "context", "externalId", "externalUrl", "folderId", "uploadPresetId"}

// optionsInQuery is the API's refusal of a create that names asset fields in its query.
func optionsInQuery(q url.Values) error {
	var fields []any
	for _, key := range uploadOptionKeys {
		if q.Has(key) {
			fields = append(fields, key)
		}
	}
	if len(fields) == 0 {
		return nil
	}
	return &apiError{code: calmlens.CodeUploadOptionsInQuery, status: http.StatusBadRequest, details: calmlens.JSON{"fields": fields}}
}

// isUploadForm reports a raw upload (X-CalmLens-Upload) sent as multipart/form-data.
func isUploadForm(headers http.Header) bool {
	upload := headers.Get("X-CalmLens-Upload")
	media, _, _ := mime.ParseMediaType(headers.Get("Content-Type"))
	return (upload == "content" || upload == "part") && media == "multipart/form-data"
}

// readUploadForm reads a raw upload's multipart/form-data body like the API: an options part,
// then a file part, then the closing boundary. It returns the options part's JSON text and the
// file's bytes. A body that isn't a form is refused with request/unsupported-content-type, and
// any other form with upload-payload/invalid.
func readUploadForm(headers http.Header, raw []byte) (options string, file []byte, err error) {
	contentType := headers.Get("Content-Type")
	media, params, _ := mime.ParseMediaType(contentType)
	if media != "multipart/form-data" {
		declared := any(nil)
		if base := strings.TrimSpace(strings.Split(contentType, ";")[0]); base != "" {
			declared = base
		}
		return "", nil, &apiError{code: calmlens.CodeUnsupportedContentType, status: http.StatusUnsupportedMediaType, details: calmlens.JSON{"contentType": declared}}
	}
	invalid := fail(calmlens.CodeInvalidUploadPayload)
	if params["boundary"] == "" {
		return "", nil, invalid
	}
	delimiter := []byte("\r\n--" + params["boundary"])
	body := append([]byte("\r\n"), raw...)
	type part struct {
		name    string
		content []byte
	}
	var parts []part
	at := bytes.Index(body, delimiter)
	for at != -1 {
		start := at + len(delimiter)
		if bytes.HasPrefix(body[start:], []byte("--")) {
			break
		}
		headerEnd := bytes.Index(body[start:], []byte("\r\n\r\n"))
		if headerEnd == -1 {
			return "", nil, invalid
		}
		headerEnd += start
		next := bytes.Index(body[headerEnd+4:], delimiter)
		if next == -1 {
			return "", nil, invalid
		}
		next += headerEnd + 4
		var p part
		for _, line := range strings.Split(string(body[start:headerEnd]), "\r\n") {
			name, value, _ := strings.Cut(line, ":")
			if strings.EqualFold(strings.TrimSpace(name), "content-disposition") {
				if _, disposition, err := mime.ParseMediaType(value); err == nil {
					p.name = disposition["name"]
				}
			}
		}
		p.content = body[headerEnd+4 : next]
		parts = append(parts, p)
		at = next
	}
	if at == -1 || len(parts) != 2 || parts[0].name != "options" || parts[1].name != "file" {
		return "", nil, invalid
	}
	return string(parts[0].content), parts[1].content, nil
}

// formOptions decodes an upload form's options part as the API does: a JSON object holding only
// the asset's fields, with a string name.
func formOptions(text string) (calmlens.JSON, error) {
	var options calmlens.JSON
	if err := json.Unmarshal([]byte(text), &options); err != nil || options == nil {
		return nil, fail(calmlens.CodeInvalidUploadPayload)
	}
	for key := range options {
		known := false
		for _, allowed := range uploadOptionKeys {
			known = known || key == allowed
		}
		if !known {
			return nil, validation("validation/unknown-field", key)
		}
	}
	if _, ok := options["name"].(string); !ok {
		return nil, validation("validation/invalid-type", "name")
	}
	return options, nil
}
