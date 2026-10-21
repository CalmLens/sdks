package calmlens

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode"
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
	if multipart && !content.IsFinal && *size < 5*1024*1024 {
		return nil, nil, invalid(CodeInvalidUploadPayload, "Multipart upload parts must be at least 5MiB except the final part.")
	}
	return reader, size, nil
}

// imageSize checks a multipart image total; final also enforces the minimum.
func imageSize(size *int64, final bool) error {
	if size != nil && *size > 20*1024*1024 {
		return invalid(CodeMultipartImageTooLarge, "Multipart image uploads cannot exceed 20MB")
	}
	if final && size != nil && *size < 10*1024*1024 {
		return invalid(CodeMultipartImageTooSmall, "Multipart image uploads must total at least 10MB")
	}
	return nil
}

// Create submits an asset and queues processing: the result is usually pending. Supply
// exactly one of Content, Part or URL.
func (s *AssetsService) Create(ctx context.Context, options SubmitAssetOptions) (*Asset, error) {
	return s.submit(ctx, options, true)
}

// Classify submits an asset and waits for classification where supported (audio and video
// always return pending).
func (s *AssetsService) Classify(ctx context.Context, options SubmitAssetOptions) (*Asset, error) {
	if options.Content != nil && options.Content.PlainText != nil && strings.TrimSpace(*options.Content.PlainText) == "" {
		return nil, invalid(CodeInvalidUploadPayload, "Text to classify must be a non-empty string")
	}
	return s.submit(ctx, options, false)
}

func idempotencyKey(key string) string {
	if key == "" {
		return newIdempotencyKey()
	}
	return key
}

func (s *AssetsService) submit(ctx context.Context, options SubmitAssetOptions, queue bool) (*Asset, error) {
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
	key := idempotencyKey(options.IdempotencyKey)
	var result Asset
	if options.URL != "" {
		err := s.c.send(ctx, call{method: "POST", path: s.c.project("assets"), params: url.Values{"queue": {strconv.FormatBool(queue)}}, body: options, idempotencyKey: key, transfer: true}, &result)
		if err != nil {
			return nil, err
		}
		return &result, nil
	}
	multipart := options.Part != nil
	content := options.Content
	if multipart {
		content = options.Part
	}
	mime := strings.ToLower(strings.TrimSpace(strings.Split(content.Type, ";")[0]))
	if mime == "" || mime == "application/octet-stream" || strings.HasPrefix(mime, "multipart/") {
		return nil, invalid(CodeInvalidUploadMimeType, mime+" is not a valid upload file type. Uploads must use a concrete file MIME type that CalmLens can store and process, such as image/png, image/jpeg, application/pdf, or text/plain.")
	}
	if multipart && content.PartNumber > 1 {
		return nil, invalid(CodeUseUploadPart, "Use uploadPart for multipart upload parts after the first part")
	}
	if multipart && content.PartNumber < 0 {
		return nil, invalid(CodeInvalidUploadPartNumber, "Part number must be positive")
	}
	raw, size, err := payload(*content, multipart)
	if err != nil {
		return nil, err
	}
	if multipart && strings.HasPrefix(mime, "image/") {
		total := size
		if options.TotalSizeInBytes != nil {
			total = options.TotalSizeInBytes
		}
		if err = imageSize(total, content.IsFinal || options.TotalSizeInBytes != nil); err != nil {
			return nil, err
		}
	}
	params, err := query(options)
	if err != nil {
		return nil, err
	}
	params.Set("queue", strconv.FormatBool(queue))
	params.Set("contentType", content.Type)
	headers := http.Header{"Content-Type": {content.Type}, "X-Calmlens-Upload": {"content"}}
	length := int64(-1)
	if size != nil {
		length = *size
		params.Set("sizeInBytes", strconv.FormatInt(*size, 10))
	}
	if multipart {
		headers.Set("X-CalmLens-Upload", "part")
		params.Set("partNumber", "1")
		params.Set("isFinal", strconv.FormatBool(content.IsFinal))
	}
	err = s.c.send(ctx, call{method: "POST", path: s.c.project("assets"), params: params, raw: raw, size: length, headers: headers, idempotencyKey: key, transfer: true}, &result)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// UploadPart sends part 2 or later of a multipart upload. Send parts sequentially. The queue
// mode chosen when the upload started is saved by CalmLens and applies to the final part
// unless Queue overrides it.
func (s *AssetsService) UploadPart(ctx context.Context, options UploadAssetPartOptions) (*Asset, error) {
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
	params := url.Values{"partNumber": {strconv.Itoa(part.PartNumber)}, "isFinal": {strconv.FormatBool(part.IsFinal)}, "sizeInBytes": {strconv.FormatInt(*size, 10)}}
	if options.Queue != nil {
		params.Set("queue", strconv.FormatBool(*options.Queue))
	}
	var result Asset
	err = s.c.send(ctx, call{method: "POST", path: path, params: params, raw: raw, size: *size, headers: http.Header{"X-Calmlens-Upload": {"part"}}, idempotencyKey: idempotencyKey(options.IdempotencyKey), transfer: true}, &result)
	if err != nil {
		return nil, err
	}
	return &result, nil
}
