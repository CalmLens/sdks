package calmlenstest

import (
	"bytes"
	"context"
	"testing"

	calmlens "github.com/CalmLens/sdks/go"
)

const mib = 1 << 20

// keep keeps uploaded content after processing, so the test can read what the mock stored.
var keep = &calmlens.ProcessingOptions{KeepContentAfterProcessing: calmlens.Ptr(true)}

func distinctBytes(length int) []byte {
	out := make([]byte, length)
	for i := range out {
		out[i] = byte(i * 7 % 251)
	}
	return out
}

func TestMockJoinsAnUploadTheClientSplits(t *testing.T) {
	var moderated [][]byte
	c, err := NewServerClient(Options{PartSizeBytes: 5 * mib, Moderate: func(input ModerationInput) *Decision {
		moderated = append(moderated, input.Content.Bytes)
		return NewDecision(calmlens.ModerationStatusAllowed)
	}})
	if err != nil {
		t.Fatal(err)
	}
	file := distinctBytes(11 * mib)
	// An image over the 10 MiB one-request limit goes in parts.
	asset, err := c.Assets.Classify(context.Background(), calmlens.SubmitAssetOptions{Name: "photo.png", Content: &calmlens.Content{Type: "image/png", Bytes: file}, ProcessingOptions: keep})
	if err != nil || asset.Upload.Status != "completed" || *asset.Content.SizeInBytes != int64(len(file)) {
		t.Fatal(asset, err)
	}
	stored := c.ImageStorage.Content[asset.ID]
	if len(stored.Parts) != 3 || !bytes.Equal(bytes.Join([][]byte{stored.Parts[1], stored.Parts[2], stored.Parts[3]}, nil), file) {
		t.Fatal("stored parts", len(stored.Parts))
	}
	if len(moderated) != 1 || !bytes.Equal(moderated[0], file) {
		t.Fatal("moderated", len(moderated))
	}
}

func TestMockResumesAnUploadWithTheSameKeyAfterAPartFails(t *testing.T) {
	moderations := 0
	c, err := NewServerClient(Options{PartSizeBytes: 5 * mib, Moderate: func(ModerationInput) *Decision {
		moderations++
		return NewDecision(calmlens.ModerationStatusAllowed)
	}})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	file := distinctBytes(12 * mib)
	options := calmlens.SubmitAssetOptions{Name: "archive.zip", Content: &calmlens.Content{Type: "application/zip", Bytes: file}, ProcessingOptions: keep, IdempotencyKey: "upload-3"}
	if err = c.FailNextRequest(RequestFailure{Code: FailureTransportError, Operation: "assets.uploadPart"}); err != nil {
		t.Fatal(err)
	}
	if _, err = c.Assets.Classify(ctx, options); calmlens.ErrorCode(err) != calmlens.CodeSDKTransportError {
		t.Fatal(err)
	}
	asset, err := c.Assets.Classify(ctx, options)
	if err != nil || asset.Upload.Status != "completed" || *asset.Content.SizeInBytes != int64(len(file)) {
		t.Fatal(asset, err)
	}
	page, err := c.Assets.List(ctx, calmlens.ListAssetsOptions{})
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != asset.ID {
		t.Fatal(page, err)
	}
	stored := c.ImageStorage.Content[asset.ID]
	if !bytes.Equal(bytes.Join([][]byte{stored.Parts[1], stored.Parts[2], stored.Parts[3]}, nil), file) || moderations != 1 {
		t.Fatal("stored parts", len(stored.Parts), "moderations", moderations)
	}
}
