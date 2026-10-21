// sdk-e2e is a JSON-lines adapter for the shared backend SDK tests.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"

	sdk "github.com/CalmLens/sdks/go"
)

type command struct {
	Operation  string
	Options    json.RawMessage
	APIKey     string
	ProjectID  string
	BaseURL    string
	CDNBaseURL string
}

func decode[T any](raw json.RawMessage, call func(T) (any, error)) (any, error) {
	var options T
	if err := json.Unmarshal(raw, &options); err != nil {
		return nil, err
	}
	return call(options)
}

func invoke(c *sdk.ServerClient, cmd command) (any, error) {
	ctx := context.Background()
	switch cmd.Operation {
	case "text.moderate":
		return decode(cmd.Options, func(o sdk.ModerateTextOptions) (any, error) { return c.Text.Moderate(ctx, o) })
	case "assets.create", "assets.moderate":
		return decode(cmd.Options, func(options sdk.SubmitAssetOptions) (any, error) {
			var content struct {
				Content *sdk.Content
				Part    *sdk.Content
			}
			if err := json.Unmarshal(cmd.Options, &content); err != nil {
				return nil, err
			}
			options.Content, options.Part = content.Content, content.Part
			if cmd.Operation == "assets.create" {
				return c.Assets.Create(ctx, options)
			}
			return c.Assets.Moderate(ctx, options)
		})
	case "assets.retrieve":
		return decode(cmd.Options, func(o sdk.AssetIDOptions) (any, error) { return c.Assets.Retrieve(ctx, o) })
	case "assets.search":
		return decode(cmd.Options, func(o sdk.SearchAssetsOptions) (any, error) { return c.Assets.Search(ctx, o) })
	case "assets.list":
		return decode(cmd.Options, func(o sdk.ListAssetsOptions) (any, error) { return pageOutput(c.Assets.List(ctx, o)) })
	case "assets.listChildren":
		return decode(cmd.Options, func(o sdk.ListAssetChildrenOptions) (any, error) { return pageOutput(c.Assets.ListChildren(ctx, o)) })
	case "assets.uploadPart":
		return decode(cmd.Options, func(o sdk.UploadAssetPartOptions) (any, error) { return c.Assets.UploadPart(ctx, o) })
	case "assets.deleteContent":
		return decode(cmd.Options, func(o sdk.AssetIDOptions) (any, error) { return c.Assets.DeleteContent(ctx, o) })
	case "assets.delete":
		return decode(cmd.Options, func(o sdk.AssetIDOptions) (any, error) { return nil, c.Assets.Delete(ctx, o) })
	case "assets.move":
		return decode(cmd.Options, func(o sdk.MoveAssetOptions) (any, error) { return c.Assets.Move(ctx, o) })
	case "assets.createSignedUrl":
		return decode(cmd.Options, func(o sdk.SignedURLOptions) (any, error) {
			var id sdk.AssetIDOptions
			if err := json.Unmarshal(cmd.Options, &id); err != nil {
				return nil, err
			}
			o.AssetID = id.AssetID
			return c.Assets.CreateSignedURL(ctx, o)
		})
	case "folders.create":
		return decode(cmd.Options, func(o sdk.CreateFolderOptions) (any, error) { return c.Folders.Create(ctx, o) })
	case "folders.retrieve":
		return decode(cmd.Options, func(o sdk.FolderIDOptions) (any, error) { return c.Folders.Retrieve(ctx, o) })
	case "folders.list":
		return decode(cmd.Options, func(o sdk.ListFoldersOptions) (any, error) { return c.Folders.List(ctx, o) })
	case "folders.delete":
		return decode(cmd.Options, func(o sdk.FolderIDOptions) (any, error) { return nil, c.Folders.Delete(ctx, o) })
	case "cdn.serve":
		return decode(cmd.Options, func(o sdk.CDNServeOptions) (any, error) {
			response, err := c.CDN.Serve(ctx, o)
			if err != nil {
				return nil, err
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			return map[string]any{"status": response.StatusCode, "body": string(body)}, err
		})
	default:
		return nil, fmt.Errorf("unsupported adapter operation: %s", cmd.Operation)
	}
}

// A page as the API and the other SDKs report it: the SDK's empty NextCursor (no next page) is
// null on the wire.
type page struct {
	*sdk.AssetPage
	NextCursor *string `json:"nextCursor"`
}

func pageOutput(result *sdk.AssetPage, err error) (any, error) {
	if err != nil {
		return nil, err
	}
	output := page{AssetPage: result}
	if result.NextCursor != "" {
		output.NextCursor = &result.NextCursor
	}
	return output, nil
}

func main() {
	scanner := bufio.NewScanner(os.Stdin)
	// Multipart image commands contain up to 20 MiB encoded as base64.
	scanner.Buffer(make([]byte, 4096), 32*1024*1024)
	encoder := json.NewEncoder(os.Stdout)
	var client *sdk.ServerClient
	for scanner.Scan() {
		var cmd command
		err := json.Unmarshal(scanner.Bytes(), &cmd)
		if err == nil && client == nil {
			client, err = sdk.NewServerClient(sdk.Options{APIKey: cmd.APIKey, ProjectID: cmd.ProjectID, BaseURL: cmd.BaseURL, CDNBaseURL: cmd.CDNBaseURL})
		}
		var value any
		if err == nil {
			value, err = invoke(client, cmd)
		}
		output := map[string]any{"ok": true, "value": value}
		if err != nil {
			detail := map[string]any{"message": err.Error(), "kind": "validation"}
			var apiError *sdk.Error
			if errors.As(err, &apiError) {
				detail["code"], detail["status"], detail["details"] = apiError.Code, apiError.Status, apiError.Details
				detail["requestId"] = apiError.RequestID
				// The shared tests compare the cross-SDK message form; Error() adds code and status.
				message := apiError.Message
				if message == "" {
					message = apiError.Code
				}
				detail["message"] = "[calmlens] " + message
				switch {
				case apiError.Status != 0:
					detail["kind"] = "api"
				case apiError.Code == sdk.CodeSDKTransportError || apiError.Code == sdk.CodeSDKTimeout || apiError.Code == sdk.CodeSDKCancelled:
					detail["kind"] = "transport"
				}
			}
			output = map[string]any{"ok": false, "error": detail}
		}
		if err := encoder.Encode(output); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
	if err := scanner.Err(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
