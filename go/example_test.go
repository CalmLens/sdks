package calmlens_test

// Runnable examples for pkg.go.dev, against calmlenstest's in-memory API, so they run offline.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"calmlens.com/go/calmlens"
	"calmlens.com/go/calmlens/calmlenstest"
)

// newExampleClient is the in-memory API standing in for NewServerClient.
func newExampleClient() *calmlens.ServerClient {
	mock, err := calmlenstest.NewServerClient(calmlenstest.Options{})
	if err != nil {
		log.Fatal(err)
	}
	return mock.ServerClient
}

// Moderate a comment and act on the decision.
func ExampleTextService_Classify() {
	client := newExampleClient()
	asset, err := client.Text.Classify(context.Background(), calmlens.ClassifyTextOptions{Text: "What a lovely photo!"})
	if err != nil {
		log.Fatal(err)
	}
	if decision := asset.Classification.Moderation.Decision; decision != nil && *decision == calmlens.ModerationDecisionAllowed {
		fmt.Println("publish")
	}
	// Output: publish
}

// Tell error kinds apart with errors.Is; read the details with errors.As.
func ExampleError() {
	client := newExampleClient()
	_, err := client.Folders.Retrieve(context.Background(), calmlens.FolderIDOptions{FolderID: "fldr_missing"})
	var apiErr *calmlens.Error
	if errors.Is(err, calmlens.ErrNotFound) && errors.As(err, &apiErr) {
		fmt.Println(apiErr.Code, apiErr.Status, errors.Is(err, calmlens.ErrAPI))
	}
	// Output: folder/not-found 404 true
}

// Change one call's deadline, retries and headers with Params, and read its request ID.
func ExampleParams() {
	client := newExampleClient()
	folder, err := client.Folders.Create(context.Background(), calmlens.CreateFolderOptions{
		Name:   "Uploads",
		Params: calmlens.Params{Timeout: 5 * time.Second, MaxRetries: calmlens.Ptr(0), IdempotencyKey: "create-uploads"},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(folder.Name, folder.LastResponse.StatusCode, folder.LastResponse.RequestID != "")
	// Output: Uploads 201 true
}

// Walk every page of a list with an iterator.
func ExampleFoldersService_ListAll() {
	client := newExampleClient()
	ctx := context.Background()
	for _, name := range []string{"Avatars", "Banners"} {
		if _, err := client.Folders.Create(ctx, calmlens.CreateFolderOptions{Name: name}); err != nil {
			log.Fatal(err)
		}
	}
	for folder, err := range client.Folders.ListAll(calmlens.ListFoldersOptions{PageSize: 1}).All(ctx) {
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println(folder.Name)
	}
	// Output:
	// Avatars
	// Banners
}
