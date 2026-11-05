package calmlens

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

const mib = 1 << 20

// fileOf returns distinct bytes, so a part sent from the wrong offset shows.
func fileOf(length int) []byte {
	out := make([]byte, length)
	for i := range out {
		out[i] = byte(i * 7 % 251)
	}
	return out
}

func uploadReply(status string, parts any) reply {
	return reply{status: 200, result: JSON{"id": "asset-1", "upload": JSON{"status": status, "partsReceived": parts}}}
}

func apiErrorReply(code string, status int, details JSON) reply {
	return reply{status: status, result: JSON{"code": code, "message": code, "requestId": "req", "details": details}}
}

// splitClient is a scripted client that splits content over partSize bytes.
func splitClient(t *testing.T, partSize int64, replies ...reply) (*ServerClient, *harness) {
	t.Helper()
	c, h := setup(t)
	c.options.PartSizeBytes = partSize
	c.maxRetries = 1
	h.next = replies
	return c, h
}

func sentQuery(h *harness, name string) []string {
	var values []string
	for _, call := range h.calls {
		values = append(values, call.URL.Query().Get(name))
	}
	return values
}

func sentKeys(h *harness) []string {
	var keys []string
	for _, call := range h.calls {
		keys = append(keys, call.Header.Get("Idempotency-Key"))
	}
	return keys
}

func equal(t *testing.T, name string, got, want []string) {
	t.Helper()
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("%s = %q, want %q", name, got, want)
	}
}

func TestContentLargerThanPartSizeIsSentInPartsWithDerivedKeys(t *testing.T) {
	c, h := splitClient(t, 5*mib, uploadReply("uploading", 1), uploadReply("uploading", 2), uploadReply("completed", nil))
	file := fileOf(11 * mib)
	asset, err := c.Assets.Classify(context.Background(), SubmitAssetOptions{Name: "clip.mp4", Content: &Content{Type: "video/mp4", Bytes: file}, IdempotencyKey: "upload-1"})
	if err != nil || asset.Upload.Status != "completed" {
		t.Fatal(asset, err)
	}
	var paths []string
	for _, call := range h.calls {
		paths = append(paths, call.URL.EscapedPath())
	}
	equal(t, "paths", paths, []string{"/v1/projects/p%20%2F%3F/assets", "/v1/assets/asset-1/part", "/v1/assets/asset-1/part"})
	equal(t, "keys", sentKeys(h), []string{"upload-1", "upload-1:part-2", "upload-1:part-3"})
	equal(t, "partNumber", sentQuery(h, "partNumber"), []string{"1", "2", "3"})
	equal(t, "isFinal", sentQuery(h, "isFinal"), []string{"false", "false", "true"})
	equal(t, "sizeInBytes", sentQuery(h, "sizeInBytes"), []string{"5242880", "5242880", "1048576"})
	equal(t, "totalSizeInBytes", sentQuery(h, "totalSizeInBytes"), []string{"11534336", "", ""})
	// The queue choice goes with the first part, which saves it for the upload.
	equal(t, "queue", sentQuery(h, "queue"), []string{"false", "", ""})
	if h.calls[0].Header.Get("X-CalmLens-Upload") != "part" || h.calls[0].Header.Get("Content-Type") != "video/mp4" {
		t.Fatal(h.calls[0].Header)
	}
	if !bytes.Equal(bytes.Join(h.bodies, nil), file) {
		t.Fatal("the parts do not join into the file")
	}
}

// onlySeeker hides bytes.Reader's ReadAt, as a file wrapper might.
type onlySeeker struct{ io.ReadSeeker }

func TestADroppedPartIsRetriedWithItsKeyAndAPartTheAPIHasIsSkipped(t *testing.T) {
	c, h := splitClient(t, 5*mib,
		uploadReply("uploading", 1),
		reply{err: errors.New("connection reset")},
		uploadReply("uploading", 2),
		// Part 3's response was lost before: the API asks for part 4.
		apiErrorReply(CodeInvalidUploadPartNumber, 409, JSON{"expectedPartNumber": 4, "receivedPartNumber": 3}),
		uploadReply("completed", nil),
	)
	file := fileOf(16 * mib)
	size := int64(len(file))
	reader := bytes.NewReader(append([]byte("skipped"), file...))
	if _, err := reader.Seek(7, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	asset, err := c.Assets.Create(context.Background(), SubmitAssetOptions{Name: "report.pdf", Content: &Content{Type: "application/pdf", Data: onlySeeker{reader}, SizeInBytes: &size}, IdempotencyKey: "upload-2"})
	if err != nil || asset.Upload.Status != "completed" {
		t.Fatal(asset, err)
	}
	equal(t, "keys", sentKeys(h), []string{"upload-2", "upload-2:part-2", "upload-2:part-2", "upload-2:part-3", "upload-2:part-4"})
	equal(t, "isFinal", sentQuery(h, "isFinal"), []string{"false", "false", "false", "false", "true"})
	if !bytes.Equal(h.bodies[1], file[5*mib:10*mib]) || !bytes.Equal(h.bodies[2], h.bodies[1]) || !bytes.Equal(h.bodies[4], file[15*mib:]) {
		t.Fatal("a part was read from the wrong offset")
	}
}

func TestAFinalPartThatFindsTheUploadCompletedReadsTheAssetBack(t *testing.T) {
	c, h := splitClient(t, DefaultPartSizeBytes,
		uploadReply("uploading", 1),
		apiErrorReply(CodeUploadNotOpen, 409, JSON{}),
		uploadReply("completed", nil),
	)
	asset, err := c.Assets.Create(context.Background(), SubmitAssetOptions{Name: "clip.mp4", Content: &Content{Type: "video/mp4", Bytes: fileOf(9 * mib)}})
	if err != nil || asset.Upload.Status != "completed" {
		t.Fatal(asset, err)
	}
	if len(h.calls) != 3 || h.calls[2].Method != http.MethodGet || h.calls[2].URL.Path != "/v1/assets/asset-1" {
		t.Fatal(h.calls)
	}
	// Without a caller's key, the parts share a generated one.
	if keys := sentKeys(h); keys[1] != keys[0]+":part-2" {
		t.Fatal(keys)
	}
}

func TestContentOfOnePartAndStreamsGoInOneRequest(t *testing.T) {
	c, h := splitClient(t, DefaultPartSizeBytes)
	ctx := context.Background()
	if _, err := c.Assets.Create(ctx, SubmitAssetOptions{Name: "exact.pdf", Content: &Content{Type: "application/pdf", Bytes: fileOf(8 * mib)}}); err != nil {
		t.Fatal(err)
	}
	stream := fileOf(9 * mib)
	size := int64(len(stream))
	if _, err := c.Assets.Create(ctx, SubmitAssetOptions{Name: "stream.pdf", Content: &Content{Type: "application/pdf", Data: io.MultiReader(bytes.NewReader(stream)), SizeInBytes: &size}}); err != nil {
		t.Fatal(err)
	}
	equal(t, "partNumber", sentQuery(h, "partNumber"), []string{"", ""})
	if len(h.bodies[0]) != 8*mib || !bytes.Equal(h.bodies[1], stream) {
		t.Fatal("content was not sent whole")
	}
}

func TestPartSizeAndSplitUploadLimits(t *testing.T) {
	for _, size := range []int64{MinPartSizeBytes - 1, MaxPartSizeBytes + 1, -1} {
		if _, err := NewServerClient(Options{APIKey: "key", ProjectID: "p", PartSizeBytes: size}); ErrorCode(err) != CodeSDKInvalidConfig {
			t.Fatal(size, err)
		}
	}
	c, h := splitClient(t, DefaultPartSizeBytes)
	ctx := context.Background()
	_, err := c.Assets.Create(ctx, SubmitAssetOptions{Name: "clip.mp4", Content: &Content{Type: "video/mp4", Bytes: fileOf(9 * mib)}, IdempotencyKey: strings.Repeat("k", 241)})
	if ErrorCode(err) != CodeSDKInvalidArgument {
		t.Fatal(err)
	}
	// An image over 20 MiB cannot be sent at all; one over 10 MiB can, in parts.
	if _, err = c.Assets.Create(ctx, SubmitAssetOptions{Name: "huge.png", Content: &Content{Type: "image/png", Bytes: fileOf(21 * mib)}}); ErrorCode(err) != CodeUploadTooLarge {
		t.Fatal(err)
	}
	if len(h.calls) != 0 {
		t.Fatal("sent", len(h.calls))
	}
	h.next = []reply{uploadReply("uploading", 1), uploadReply("completed", nil)}
	if _, err = c.Assets.Create(ctx, SubmitAssetOptions{Name: "large.png", Content: &Content{Type: "image/png", Bytes: fileOf(15 * mib)}}); err != nil {
		t.Fatal(err)
	}
	equal(t, "partNumber", sentQuery(h, "partNumber"), []string{"1", "2"})
}
