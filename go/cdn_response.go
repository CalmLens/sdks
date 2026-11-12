package calmlens

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// CDNResponse is a streaming response from CDNService.Serve.
type CDNResponse struct{ *http.Response }

// ServedAssetInfo holds the pixel dimensions of the representation served by the CDN.
type ServedAssetInfo struct {
	Width  int64
	Height int64
}

var (
	assetInfoDelimiter = regexp.MustCompile(`"(?:[^"\\]|\\.)*"|[",]`)
	assetInfoDimension = regexp.MustCompile(`^(?:width|height)=([0-9]{1,15})$`)
)

// GetAssetInfo reads the served image dimensions without consuming the body.
// It returns nil when either dimension is missing or invalid.
func (r *CDNResponse) GetAssetInfo() *ServedAssetInfo {
	header := strings.Join(r.Header.Values("X-CalmLens-Asset-Info"), ",") + ","
	var info ServedAssetInfo
	start := 0
	for _, delimiter := range assetInfoDelimiter.FindAllStringIndex(header, -1) {
		switch header[delimiter[0]:delimiter[1]] {
		case `"`:
			return nil
		case ",":
			member := strings.TrimSpace(header[start:delimiter[0]])
			start = delimiter[1]
			key, _, _ := strings.Cut(member, "=")
			if index := strings.IndexAny(key, "; \t"); index >= 0 {
				key = key[:index]
			}
			var dimension *int64
			switch key {
			case "width":
				dimension = &info.Width
			case "height":
				dimension = &info.Height
			default:
				continue
			}
			match := assetInfoDimension.FindStringSubmatch(member)
			if match == nil || *dimension != 0 {
				return nil
			}
			*dimension, _ = strconv.ParseInt(match[1], 10, 64)
			if *dimension == 0 {
				return nil
			}
		}
	}
	if info.Width == 0 || info.Height == 0 {
		return nil
	}
	return &info
}
