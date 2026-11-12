package calmlens

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode"

	"calmlens.com/go/calmlens/internal/contract"
)

// payload validates content and returns its reader and size (nil when unknown).
func payload(content Content, multipart bool) (io.Reader, *int64, error) {
	count := 0
	for _, present := range []bool{content.PlainText != nil, content.Base64 != nil, content.Bytes != nil, content.Data != nil} {
		if present {
			count++
		}
	}
	if count != 1 {
		return nil, nil, invalid(CodeInvalidUploadPayload, "Supply exactly one payload representation")
	}
	var raw []byte
	var reader io.Reader
	switch {
	case content.PlainText != nil:
		raw = []byte(*content.PlainText)
	case content.Base64 != nil:
		text := *content.Base64
		if i := strings.Index(text, ";base64,"); i >= 0 {
			text = text[i+8:]
		}
		text = strings.Map(func(r rune) rune {
			if unicode.IsSpace(r) {
				return -1
			}
			return r
		}, text)
		if multipart && len(text)%4 != 0 {
			return nil, nil, invalid(CodeInvalidUploadPayload, "Split bytes before base64-encoding each part")
		}
		text += strings.Repeat("=", (4-len(text)%4)%4)
		var err error
		raw, err = base64.StdEncoding.DecodeString(text)
		if err != nil {
			return nil, nil, invalid(CodeInvalidUploadPayload, "Invalid base64")
		}
	case content.Bytes != nil:
		raw = content.Bytes
	case content.Data != nil:
		reader = content.Data
	}
	size := content.SizeInBytes
	if reader == nil {
		actual := int64(len(raw))
		if size != nil && *size != actual {
			return nil, nil, invalid(CodeInvalidUploadPayload, "sizeInBytes must match the payload byte length")
		}
		size = &actual
		reader = bytes.NewReader(raw)
	}
	if size != nil && *size < 0 {
		return nil, nil, invalid(CodeInvalidUploadPayload, "sizeInBytes cannot be negative")
	}
	if multipart && size == nil {
		return nil, nil, invalid(CodeInvalidUploadPayload, "Multipart streams require sizeInBytes")
	}
	return reader, size, nil
}

// partSize refuses a non-final multipart part under 5 MiB.
func partSize(content Content, size *int64) error {
	if !content.IsFinal && *size < 5*1024*1024 {
		return invalid(CodeInvalidUploadPayload, "Multipart upload parts must be at least 5MiB except the final part.")
	}
	return nil
}

// The API's upload limits: in one request, images up to 10 MiB (larger ones are uploaded in
// parts), audio and video up to 50 MiB and other files up to 5,000 MiB. Sent in parts, images
// can be up to 20 MiB and audio and video up to 2 GiB; the API holds free uploads, made before billing is set up, to 50 MiB
// itself.
const (
	maxDirectImageBytes    = 10 * 1024 * 1024
	maxMultipartImageBytes = 20 * 1024 * 1024
	maxMediaBytes          = 50 * 1024 * 1024
	maxLongMediaBytes      = 2 * 1024 * 1024 * 1024
	maxFileBytes           = 5000 * 1024 * 1024
)

// uploadSize refuses content whose known size is over the API's limit for its type, before any
// of it is sent: inParts selects the limits for content sent in parts. Images in parts are
// checked by imageSize.
func uploadSize(mime string, size *int64, inParts bool) error {
	if size == nil {
		return nil
	}
	limit, message := int64(maxFileBytes), "Files can be at most 5,000 MiB"
	switch {
	case strings.HasPrefix(mime, "image/"):
		limit, message = maxDirectImageBytes, "Images uploaded in one request can be at most 10 MiB; upload larger images in parts"
	case strings.HasPrefix(mime, "audio/") || strings.HasPrefix(mime, "video/"):
		limit, message = maxMediaBytes, "Audio and video files can be at most 50 MiB in one request, or 2 GiB in parts"
		if inParts {
			limit = maxLongMediaBytes
		}
	}
	if *size > limit {
		return tooLarge(message, limit)
	}
	return nil
}

// imageSize checks a multipart image total: images in parts can be any size up to 20 MiB.
func imageSize(size *int64, final bool) error {
	if size != nil && *size > maxMultipartImageBytes {
		return tooLarge("Multipart image uploads cannot exceed 20 MiB", maxMultipartImageBytes)
	}
	return nil
}

// tooLarge is the upload/too-large failure for content over the plan's limit of limitBytes.
func tooLarge(message string, limitBytes int64) error {
	return &Error{Code: CodeUploadTooLarge, Message: message, Details: JSON{"limitBytes": limitBytes, "source": "plan"}}
}

// maxSplitIdempotencyKeyLength is the longest IdempotencyKey of an upload sent in parts: each
// part's key adds ":part-<n>", and the API takes keys of up to 255 characters.
const maxSplitIdempotencyKeyLength = 240

// source is content the SDK can read again in parts: size bytes of at from base.
type source struct {
	at         io.ReaderAt
	base, size int64
}

// part returns part n (from 1) of partSize bytes, re-readable for a retry.
func (src *source) part(n int, partSize int64) *io.SectionReader {
	offset := int64(n-1) * partSize
	return io.NewSectionReader(src.at, src.base+offset, min(partSize, src.size-offset))
}

// seekReaderAt reads an io.ReadSeeker at an offset. The SDK sends parts one at a time, so the
// seeks never interleave.
type seekReaderAt struct{ io.ReadSeeker }

func (r seekReaderAt) ReadAt(p []byte, offset int64) (int, error) {
	if _, err := r.Seek(offset, io.SeekStart); err != nil {
		return 0, err
	}
	n, err := io.ReadFull(r.ReadSeeker, p)
	if err == io.ErrUnexpectedEOF {
		err = io.EOF
	}
	return n, err
}

// readAgain returns raw as a source when the SDK can read it again from its current position:
// an io.ReaderAt or an io.ReadSeeker (bytes and base64 are a bytes.Reader). One-shot streams
// give nil.
func readAgain(raw io.Reader, size int64) *source {
	base := int64(0)
	seeker, isSeeker := raw.(io.Seeker)
	if isSeeker {
		current, err := seeker.Seek(0, io.SeekCurrent)
		if err != nil {
			return nil
		}
		base = current
	}
	if at, ok := raw.(io.ReaderAt); ok {
		return &source{at: at, base: base, size: size}
	}
	if rs, ok := raw.(io.ReadSeeker); ok {
		return &source{at: seekReaderAt{rs}, base: base, size: size}
	}
	return nil
}

// Create submits an asset and returns without waiting for its decision (it sends wait=false):
// the asset is usually ClassificationStatusQueued. Supply exactly one of Content, Part or URL.
//
// Content larger than Options.PartSizeBytes whose size is known and that the SDK can read
// again (Bytes, Base64, or Data that is an io.ReaderAt or io.Seeker with SizeInBytes) is
// uploaded in parts: part n after the first carries the Idempotency-Key "<key>:part-<n>" and is
// retried on its own, and calling again with the same IdempotencyKey (at most 240 characters)
// resumes an interrupted upload. Streams and text go in one request.
//
// The asset's fields always travel in the request body, never in the URL: text goes as JSON,
// and other content as a multipart/form-data upload whose options part holds the fields and
// whose file part holds the bytes.
func (s *AssetsService) Create(ctx context.Context, options SubmitAssetOptions) (*Asset, error) {
	ctx, paramsErr := withCall(ctx, "assets.create", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	return s.submit(ctx, options, false)
}

// Classify submits an asset and waits for classification where supported (audio and video
// always return pending).
func (s *AssetsService) Classify(ctx context.Context, options SubmitAssetOptions) (*Asset, error) {
	ctx, paramsErr := withCall(ctx, "assets.classify", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	if options.Content != nil && options.Content.PlainText != nil && strings.TrimSpace(*options.Content.PlainText) == "" {
		return nil, invalid(CodeInvalidUploadPayload, "Text to classify must be a non-empty string")
	}
	return s.submit(ctx, options, true)
}

func idempotencyKey(key string) string {
	if key == "" {
		return newIdempotencyKey()
	}
	return key
}

// submit uploads an asset; wait says whether the response waits for its decision. A multipart
// upload saves the choice with its first part.
func (s *AssetsService) submit(ctx context.Context, options SubmitAssetOptions, wait bool) (*Asset, error) {
	// The upload's requests each send their own key, derived from options.IdempotencyKey.
	ctx = withoutIdempotencyKey(ctx)
	if options.Name == "" {
		return nil, invalid(CodeInvalidUploadPayload, "Asset name is required")
	}
	count := 0
	for _, present := range []bool{options.Content != nil, options.Part != nil, options.URL != ""} {
		if present {
			count++
		}
	}
	if count != 1 {
		return nil, invalid(CodeInvalidUploadPayload, "Supply exactly one of content, part, or URL")
	}
	if options.TotalSizeInBytes != nil && (options.Part == nil || *options.TotalSizeInBytes <= 0) {
		return nil, invalid(CodeSDKInvalidArgument, "TotalSizeInBytes must be positive and is only used with Part")
	}
	// Only the posts CalmLens uses are sent.
	options.Context = selectedContext(options.Context)
	key := idempotencyKey(options.IdempotencyKey)
	var result Asset
	if options.URL != "" {
		err := s.c.send(ctx, call{method: "POST", path: s.c.project("assets"), params: url.Values{"wait": {strconv.FormatBool(wait)}}, body: options, idempotencyKey: key}, &result)
		if err != nil {
			return nil, err
		}
		return uploaded(&result)
	}
	multipart := options.Part != nil
	content := options.Content
	if multipart {
		content = options.Part
	}
	mime := normalizeUploadMimeType(content.Type)
	if !acceptedUploadMimeType(content.Type) {
		return nil, &Error{
			Code:    CodeUnsupportedUploadType,
			Message: mime + " is not a valid upload file type. Uploads must use a concrete file MIME type that CalmLens can store and process, such as image/png, image/jpeg, application/pdf, or text/plain.",
			Details: JSON{"mimeType": content.Type, "source": "calmlens"},
		}
	}
	if multipart && content.PartNumber > 1 {
		return nil, invalid(CodeUseUploadPart, "Use uploadPart for multipart upload parts after the first part")
	}
	if multipart && content.PartNumber < 0 {
		return nil, invalid(CodeInvalidUploadPartNumber, "Part number must be positive")
	}
	image := multipart && strings.HasPrefix(mime, "image/") && !s.c.deferUploadChecks
	// Like the API: a declared image total is checked first, then a single final part as the
	// whole image, then the part's own size.
	if image && options.TotalSizeInBytes != nil {
		if err := imageSize(options.TotalSizeInBytes, true); err != nil {
			return nil, err
		}
	}
	raw, size, err := payload(*content, multipart)
	if err != nil {
		return nil, err
	}
	// Content the SDK can read again is split into parts when it is larger than one part.
	var split *source
	if !multipart && content.PlainText == nil && size != nil && *size > s.c.options.PartSizeBytes {
		split = readAgain(raw, *size)
	}
	if split != nil && len(options.IdempotencyKey) > maxSplitIdempotencyKeyLength {
		return nil, invalid(CodeSDKInvalidArgument, fmt.Sprintf("IdempotencyKey can have at most %d characters for content uploaded in parts", maxSplitIdempotencyKeyLength))
	}
	if split != nil && strings.HasPrefix(mime, "image/") {
		// Images in parts can be up to 20 MiB rather than one request's 10 MiB.
		if !s.c.deferUploadChecks {
			if err = imageSize(size, true); err != nil {
				return nil, err
			}
		}
	} else if !multipart && !s.c.deferUploadChecks {
		if err = uploadSize(mime, size, split != nil); err != nil {
			return nil, err
		}
	}
	// A declared whole-file size over the limit for parts can never finish.
	if multipart && !s.c.deferUploadChecks && !strings.HasPrefix(mime, "image/") {
		if err = uploadSize(mime, options.TotalSizeInBytes, true); err != nil {
			return nil, err
		}
	}
	if image && options.TotalSizeInBytes == nil {
		if err = imageSize(size, content.IsFinal); err != nil {
			return nil, err
		}
	}
	if multipart && !s.c.deferUploadChecks {
		if err = partSize(*content, size); err != nil {
			return nil, err
		}
	}
	fields := uploadFieldsOf(options)
	params := url.Values{"wait": {strconv.FormatBool(wait)}}
	if content.PlainText != nil {
		// Text is small: it goes as JSON with the asset's fields and keeps the API timeout.
		body := textUpload{uploadFields: fields}
		if multipart {
			body.Part = &textPart{PlainText: *content.PlainText, Type: content.Type, PartNumber: 1, IsFinal: content.IsFinal}
			body.SizeInBytes, body.TotalSizeInBytes = content.SizeInBytes, options.TotalSizeInBytes
		} else {
			body.Content = &textContent{PlainText: *content.PlainText, Type: content.Type}
		}
		err = s.c.send(ctx, call{method: "POST", path: s.c.project("assets"), params: params, body: body, idempotencyKey: key}, &result)
		if err != nil {
			return nil, err
		}
		return uploaded(&result)
	}
	params.Set("contentType", content.Type)
	if split != nil {
		return s.submitInParts(ctx, params, fields, content.Type, split, key, options.IdempotencyKey != "")
	}
	mode := "content"
	if size != nil {
		params.Set("sizeInBytes", strconv.FormatInt(*size, 10))
	}
	if multipart {
		mode = "part"
		params.Set("partNumber", "1")
		params.Set("isFinal", strconv.FormatBool(content.IsFinal))
		if options.TotalSizeInBytes != nil {
			params.Set("totalSizeInBytes", strconv.FormatInt(*options.TotalSizeInBytes, 10))
		}
	}
	form, err := newUploadForm(fields, content.Type, raw, size)
	if err != nil {
		return nil, err
	}
	err = s.c.send(ctx, form.call(s.c.project("assets"), params, mode, key), &result)
	if err != nil {
		return nil, err
	}
	return uploaded(&result)
}

// uploadFields are the asset fields an upload carries in its body, never in the query string,
// which proxies and servers log: the JSON body of text, or the options part of an upload form.
type uploadFields struct {
	Name              string             `json:"name"`
	Description       *string            `json:"description,omitempty"`
	ProcessingOptions *ProcessingOptions `json:"processingOptions,omitempty"`
	Visibility        Visibility         `json:"visibility,omitempty"`
	Metadata          []MetadataItem     `json:"metadata,omitempty"`
	Tags              []string           `json:"tags,omitempty"`
	AuthorID          *string            `json:"authorId,omitempty"`
	Context           *ModerationContext `json:"context,omitempty"`
	ExternalID        *string            `json:"externalId,omitempty"`
	ExternalURL       *string            `json:"externalUrl,omitempty"`
	FolderID          *string            `json:"folderId,omitempty"`
	UploadPresetID    *string            `json:"uploadPresetId,omitempty"`
}

func uploadFieldsOf(o SubmitAssetOptions) uploadFields {
	return uploadFields{Name: o.Name, Description: o.Description, ProcessingOptions: o.ProcessingOptions, Visibility: o.Visibility, Metadata: o.Metadata, Tags: o.Tags, AuthorID: o.AuthorID, Context: o.Context, ExternalID: o.ExternalID, ExternalURL: o.ExternalURL, FolderID: o.FolderID, UploadPresetID: o.UploadPresetID}
}

// textUpload is the JSON body of a plain-text upload: the asset's fields and its text, as the
// whole content or as the first part of a multipart upload.
type textUpload struct {
	uploadFields
	Content          *textContent `json:"content,omitempty"`
	Part             *textPart    `json:"part,omitempty"`
	SizeInBytes      *int64       `json:"sizeInBytes,omitempty"`
	TotalSizeInBytes *int64       `json:"totalSizeInBytes,omitempty"`
}

type textContent struct {
	PlainText string `json:"plainText"`
	Type      string `json:"type"`
}

type textPart struct {
	PlainText  string `json:"plainText"`
	Type       string `json:"type"`
	PartNumber int    `json:"partNumber"`
	IsFinal    bool   `json:"isFinal"`
}

// uploadForm is a multipart/form-data upload body: the asset's fields as the JSON options part,
// then the file part with the file's own type. The file is streamed between head and tail.
type uploadForm struct {
	boundary   string
	head, tail []byte
	file       io.Reader
	// length is the whole body's byte length, -1 when the file's size is unknown.
	length int64
}

func newUploadForm(fields uploadFields, contentType string, file io.Reader, size *int64) (*uploadForm, error) {
	options, err := encodeJSON(fields)
	if err != nil {
		return nil, argumentError("Could not encode the upload's fields", err)
	}
	boundary := "calmlens-" + newIdempotencyKey()
	fileType := strings.NewReplacer("\r", "", "\n", "").Replace(contentType)
	head := "--" + boundary + "\r\nContent-Disposition: form-data; name=\"options\"\r\nContent-Type: application/json\r\n\r\n" + string(options) +
		"\r\n--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"\r\nContent-Type: " + fileType + "\r\n\r\n"
	tail := "\r\n--" + boundary + "--\r\n"
	form := &uploadForm{boundary: boundary, head: []byte(head), tail: []byte(tail), file: file, length: -1}
	if size != nil {
		form.length = int64(len(head)) + *size + int64(len(tail))
	}
	return form, nil
}

// call is the create request that sends the form: mode is "content" for a whole file and "part"
// for a multipart upload's first part.
func (f *uploadForm) call(path string, params url.Values, mode, key string) call {
	headers := http.Header{"Content-Type": {"multipart/form-data; boundary=" + f.boundary}, "X-Calmlens-Upload": {mode}}
	return call{method: "POST", path: path, params: params, raw: f.body(), size: f.length, headers: headers, idempotencyKey: key, binary: true}
}

// body reads the form. It can be sent again only when the file can be (an io.Seeker), so a
// one-shot stream is never retried.
func (f *uploadForm) body() io.Reader {
	reader := io.MultiReader(bytes.NewReader(f.head), f.file, bytes.NewReader(f.tail))
	seeker, ok := f.file.(io.Seeker)
	if !ok {
		return reader
	}
	start, err := seeker.Seek(0, io.SeekCurrent)
	if err != nil {
		return reader
	}
	return &rewindableForm{form: f, seeker: seeker, start: start, reader: reader}
}

// rewindableForm is a form whose file can be read again from where it started. Its Seek only
// reports and returns to the start, which is all a retry needs.
type rewindableForm struct {
	form   *uploadForm
	seeker io.Seeker
	start  int64
	reader io.Reader
	read   int64
}

func (r *rewindableForm) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	r.read += int64(n)
	return n, err
}

func (r *rewindableForm) Seek(offset int64, whence int) (int64, error) {
	switch {
	case offset == 0 && whence == io.SeekCurrent:
		return r.read, nil
	case offset == 0 && whence == io.SeekStart:
		if _, err := r.seeker.Seek(r.start, io.SeekStart); err != nil {
			return 0, err
		}
		r.read = 0
		r.reader = io.MultiReader(bytes.NewReader(r.form.head), r.form.file, bytes.NewReader(r.form.tail))
		return 0, nil
	}
	return 0, errors.New("calmlens: an upload form can only be rewound to its start")
}

// submitInParts uploads src in parts of Options.PartSizeBytes and returns the final part's
// asset. Part 1 starts the upload as a form with the upload's fields, its transport query
// (params) and key; part n after it carries "<key>:part-<n>", so a repeated call with the same
// explicit key first checks current progress with an empty file part and sends only missing parts.
func (s *AssetsService) submitInParts(ctx context.Context, params url.Values, fields uploadFields, contentType string, src *source, key string, checkExisting bool) (*Asset, error) {
	partSize := s.c.options.PartSizeBytes
	count := int((src.size + partSize - 1) / partSize)
	first := src.part(1, partSize)
	firstSize := first.Size()
	params.Set("sizeInBytes", strconv.FormatInt(firstSize, 10))
	params.Set("partNumber", "1")
	params.Set("isFinal", "false")
	params.Set("totalSizeInBytes", strconv.FormatInt(src.size, 10))
	var result Asset
	if checkExisting {
		zero := int64(0)
		probe, err := newUploadForm(fields, contentType, bytes.NewReader(nil), &zero)
		if err != nil {
			return nil, err
		}
		request := probe.call(s.c.project("assets"), params, "part", key)
		request.headers.Set("Idempotency-Replay-Only", "true")
		request.binary = false
		if err := s.c.send(ctx, request, &result); err != nil {
			return nil, err
		}
	}
	if result.ID == "" {
		form, err := newUploadForm(fields, contentType, first, &firstSize)
		if err != nil {
			return nil, err
		}
		if err := s.c.send(ctx, form.call(s.c.project("assets"), params, "part", key), &result); err != nil {
			return nil, err
		}
	}
	asset, err := uploaded(&result)
	if err != nil {
		return nil, err
	}
	if asset.Upload.Status == "completed" {
		return asset, nil
	}
	nextPart := 2
	if received := asset.Upload.PartsReceived; received != nil && *received >= 2 && *received < count {
		nextPart = *received + 1
	}
	for n := nextPart; n <= count; {
		final := n == count
		piece := src.part(n, partSize)
		size := piece.Size()
		next, err := s.uploadPart(ctx, UploadAssetPartOptions{AssetID: asset.ID, Part: Content{Data: piece, SizeInBytes: &size, PartNumber: n, IsFinal: final}, Params: Params{IdempotencyKey: fmt.Sprintf("%s:part-%d", key, n)}})
		var apiErr *Error
		if err != nil && errors.As(err, &apiErr) {
			// The API already has the parts before the one it expects: their responses were lost.
			if expected, ok := partNumber(apiErr.Details["expectedPartNumber"]); ok && apiErr.Code == CodeInvalidUploadPartNumber && expected > n && expected <= count {
				n = expected
				continue
			}
			// The final part already arrived and completed the upload.
			if final && apiErr.Code == CodeUploadNotOpen {
				return s.Retrieve(ctx, AssetIDOptions{AssetID: asset.ID})
			}
		}
		if err != nil {
			return nil, err
		}
		asset = next
		n++
	}
	return asset, nil
}

// partNumber reads a whole part number from error details.
func partNumber(value any) (int, bool) {
	switch number := value.(type) {
	case float64:
		if number == float64(int(number)) {
			return int(number), true
		}
	case int:
		return number, true
	case json.Number:
		if n, err := strconv.Atoi(string(number)); err == nil {
			return n, true
		}
	}
	return 0, false
}

// UploadPart sends part 2 or later of a multipart upload. Send parts sequentially. Whether the
// final part waits for the decision was chosen when the upload started and is saved by CalmLens;
// Wait overrides it.
func (s *AssetsService) UploadPart(ctx context.Context, options UploadAssetPartOptions) (*Asset, error) {
	ctx, paramsErr := withCall(ctx, "assets.uploadPart", options.Params)
	if paramsErr != nil {
		return nil, paramsErr
	}
	return s.uploadPart(ctx, options)
}

func (s *AssetsService) uploadPart(ctx context.Context, options UploadAssetPartOptions) (*Asset, error) {
	path, err := resourcePath("assets", options.AssetID, "/part")
	if err != nil {
		return nil, err
	}
	part := options.Part
	if part.PartNumber < 1 {
		return nil, invalid(CodeInvalidUploadPartNumber, "Part number must be positive")
	}
	raw, size, err := payload(part, true)
	if err != nil {
		return nil, err
	}
	if !s.c.deferUploadChecks {
		if err = partSize(part, size); err != nil {
			return nil, err
		}
	}
	params := url.Values{"partNumber": {strconv.Itoa(part.PartNumber)}, "isFinal": {strconv.FormatBool(part.IsFinal)}, "sizeInBytes": {strconv.FormatInt(*size, 10)}}
	if options.Wait != nil {
		params.Set("wait", strconv.FormatBool(*options.Wait))
	}
	var result Asset
	err = s.c.send(ctx, call{method: "POST", path: path, params: params, raw: raw, size: *size, headers: http.Header{"X-Calmlens-Upload": {"part"}}, idempotencyKey: idempotencyKey(options.IdempotencyKey), binary: true}, &result)
	if err != nil {
		return nil, err
	}
	return uploaded(&result)
}

// uploaded checks that an upload was answered with an asset.
func uploaded(asset *Asset) (*Asset, error) {
	if asset.ID == "" {
		return nil, &Error{Code: CodeSDKInvalidResponse, Message: "Expected an uploaded asset response", Status: http.StatusOK}
	}
	return asset, nil
}

// normalizeUploadMimeType lower-cases a MIME type and drops its parameters, as the API compares it.
func normalizeUploadMimeType(mimeType string) string {
	return strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
}

// acceptedUploadMimeType reports whether the API accepts an upload of this MIME type: an image,
// audio, video, text, document or website type, not a container such as
// application/octet-stream. The API refuses any other type with upload/unsupported-type.
func acceptedUploadMimeType(mimeType string) bool {
	mime := normalizeUploadMimeType(mimeType)
	for _, rejected := range uploadMimeRejected {
		if mime == rejected {
			return false
		}
	}
	for _, prefix := range uploadMimePrefixes {
		if strings.HasPrefix(mime, prefix) {
			return true
		}
	}
	for _, suffix := range uploadMimeSuffixes {
		if strings.HasSuffix(mime, suffix) {
			return true
		}
	}
	for _, accepted := range uploadMimeTypes {
		if mime == accepted {
			return true
		}
	}
	return false
}

func init() { contract.AcceptedUploadMimeType = acceptedUploadMimeType }
