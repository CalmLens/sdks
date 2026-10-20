package calmlens

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// TransformTypeImage is the image transform type; its options are ImageTransformOptions.
const TransformTypeImage = "imageTransform"

// LensTransform is one structured transform step. Build image steps with ImageTransform:
//
//	calmlens.ImageTransform(calmlens.ImageTransformOptions{Width: calmlens.Ptr(1024), Format: calmlens.ImageFormatPNG})
//
// Options is any value that encodes as a JSON object, or nil, because each transform type
// defines its own options; use ImageTransformOptions for TransformTypeImage. Nested objects
// become bracketed keys such as border[color], and null values are skipped. Options decoded
// from the API (Lens.Transforms) are map[string]any with json.Number numbers.
type LensTransform struct {
	Type    string `json:"type"`
	Options any    `json:"options,omitempty"`
}

// ImageTransform returns a TransformTypeImage step with options.
func ImageTransform(options ImageTransformOptions) LensTransform {
	return LensTransform{Type: TransformTypeImage, Options: options}
}

// Image formats for ImageTransformOptions.Format.
const (
	ImageFormatJPG  = "jpg"
	ImageFormatPNG  = "png"
	ImageFormatWebP = "webp"
	ImageFormatAVIF = "avif"
	ImageFormatGIF  = "gif"
)

// Image fit modes for ImageTransformOptions.Fit.
const (
	ImageFitScaleDown = "scale-down"
	ImageFitContain   = "contain"
	ImageFitPad       = "pad"
	ImageFitSqueeze   = "squeeze"
	ImageFitCover     = "cover"
	ImageFitCrop      = "crop"
)

// ImageTransformOptions are the options of TransformTypeImage. Unset (nil or empty) fields
// are omitted.
type ImageTransformOptions struct {
	// Format is one of the ImageFormat constants.
	Format string `json:"format,omitempty"`
	// Width and Height are in pixels.
	Width      *int         `json:"width,omitempty"`
	Height     *int         `json:"height,omitempty"`
	Background string       `json:"background,omitempty"`
	Blur       *float64     `json:"blur,omitempty"`
	Border     *ImageBorder `json:"border,omitempty"`
	Brightness *float64     `json:"brightness,omitempty"`
	Contrast   *float64     `json:"contrast,omitempty"`
	// Quality is from 0 to 255.
	Quality *int `json:"quality,omitempty"`
	// Fit is one of the ImageFit constants.
	Fit string `json:"fit,omitempty"`
	// Flip is "h", "v" or "hv".
	Flip  string   `json:"flip,omitempty"`
	Gamma *float64 `json:"gamma,omitempty"`
	// Segment is "foreground" to remove the background.
	Segment string        `json:"segment,omitempty"`
	Gravity *ImageGravity `json:"gravity,omitempty"`
	// Rotate is 0, 90, 180 or 270.
	Rotate     *int       `json:"rotate,omitempty"`
	Saturation *float64   `json:"saturation,omitempty"`
	Sharpen    *float64   `json:"sharpen,omitempty"`
	Trim       *ImageTrim `json:"trim,omitempty"`
}

// ImageBorder adds a border around an image.
type ImageBorder struct {
	Color string   `json:"color,omitempty"`
	Width *float64 `json:"width,omitempty"`
}

// ImageGravity chooses the focal point when cropping. Set Side for a named position ("face",
// "left", "right", "top", "bottom", "center", "auto" or "entropy"), or Mode ("remainder" or
// "box-center") with X and Y for a point.
type ImageGravity struct {
	Side string
	Mode string
	X    *float64
	Y    *float64
}

// MarshalJSON encodes Side as a string, or Mode, X and Y as an object.
func (g ImageGravity) MarshalJSON() ([]byte, error) {
	if g.Side != "" {
		return json.Marshal(g.Side)
	}
	return json.Marshal(struct {
		Mode string   `json:"mode"`
		X    *float64 `json:"x,omitempty"`
		Y    *float64 `json:"y,omitempty"`
	}{g.Mode, g.X, g.Y})
}

// UnmarshalJSON decodes the string or object form.
func (g *ImageGravity) UnmarshalJSON(data []byte) error {
	*g = ImageGravity{}
	if len(data) > 0 && data[0] == '"' {
		return json.Unmarshal(data, &g.Side)
	}
	var point struct {
		Mode string   `json:"mode"`
		X    *float64 `json:"x"`
		Y    *float64 `json:"y"`
	}
	err := json.Unmarshal(data, &point)
	g.Mode, g.X, g.Y = point.Mode, point.X, point.Y
	return err
}

// ImageTrim trims an image's edges. Border alone (no other field) trims the detected border
// and is sent as "border"; otherwise the edges, size and border options are sent as an object.
type ImageTrim struct {
	Top    *float64
	Bottom *float64
	Left   *float64
	Right  *float64
	Width  *float64
	Height *float64
	Border *ImageTrimBorder
}

// ImageTrimBorder trims a uniform border. With no fields set it is sent as true.
type ImageTrimBorder struct {
	Color     string   `json:"color,omitempty"`
	Tolerance *float64 `json:"tolerance,omitempty"`
	Keep      *float64 `json:"keep,omitempty"`
}

type imageTrimObject struct {
	Top    *float64        `json:"top,omitempty"`
	Bottom *float64        `json:"bottom,omitempty"`
	Left   *float64        `json:"left,omitempty"`
	Right  *float64        `json:"right,omitempty"`
	Width  *float64        `json:"width,omitempty"`
	Height *float64        `json:"height,omitempty"`
	Border json.RawMessage `json:"border,omitempty"`
}

// MarshalJSON encodes "border" for a border-only trim and an object otherwise.
func (t ImageTrim) MarshalJSON() ([]byte, error) {
	object := imageTrimObject{Top: t.Top, Bottom: t.Bottom, Left: t.Left, Right: t.Right, Width: t.Width, Height: t.Height}
	if t.Border != nil {
		if *t.Border == (ImageTrimBorder{}) {
			if t.Top == nil && t.Bottom == nil && t.Left == nil && t.Right == nil && t.Width == nil && t.Height == nil {
				return []byte(`"border"`), nil
			}
			object.Border = json.RawMessage("true")
		} else {
			border, err := json.Marshal(t.Border)
			if err != nil {
				return nil, err
			}
			object.Border = border
		}
	}
	return json.Marshal(object)
}

// UnmarshalJSON decodes the "border" string or the object form.
func (t *ImageTrim) UnmarshalJSON(data []byte) error {
	*t = ImageTrim{}
	if len(data) > 0 && data[0] == '"' {
		var text string
		if err := json.Unmarshal(data, &text); err != nil {
			return err
		}
		t.Border = &ImageTrimBorder{}
		return nil
	}
	var object imageTrimObject
	if err := json.Unmarshal(data, &object); err != nil {
		return err
	}
	t.Top, t.Bottom, t.Left, t.Right, t.Width, t.Height = object.Top, object.Bottom, object.Left, object.Right, object.Width, object.Height
	switch border := string(object.Border); {
	case border == "" || border == "false" || border == "null":
	case border == "true":
		t.Border = &ImageTrimBorder{}
	default:
		t.Border = &ImageTrimBorder{}
		return json.Unmarshal(object.Border, t.Border)
	}
	return nil
}

var transformTypePattern = regexp.MustCompile(`^[A-Za-z0-9_]+$`)

// transformSelector returns the selector string sent to the API for a string or structured
// transform, and whether the transform is set at all. A non-nil TransformSteps, even an
// empty one, counts as set.
func transformSelector(transform string, steps []LensTransform) (string, bool, error) {
	if steps != nil {
		if transform != "" {
			return "", false, invalid(CodeSDKInvalidArgument, "specify either Transform or TransformSteps, not both")
		}
		selector, err := serializeTransform(steps)
		return selector, true, err
	}
	return transform, transform != "", nil
}

// serializeTransform turns structured steps into a CDN selector such as
// imageTransform[format=png,width=1024]. Option keys are sorted so equal transforms share a
// URL; keys and values are percent-encoded, so the result is already path-safe.
func serializeTransform(steps []LensTransform) (string, error) {
	if len(steps) == 0 {
		return "", invalid(CodeSDKInvalidArgument, "transform needs at least one step")
	}
	parts := make([]string, 0, len(steps))
	for _, step := range steps {
		if !transformTypePattern.MatchString(step.Type) {
			return "", invalid(CodeSDKInvalidArgument, "transform type must contain only letters, digits and underscores")
		}
		options, err := transformOptions(step.Options)
		if err != nil {
			return "", err
		}
		var pairs []string
		for _, key := range sortedKeys(options) {
			if pairs, err = appendTransformOption(pairs, key, options[key]); err != nil {
				return "", err
			}
		}
		parts = append(parts, step.Type+"["+strings.Join(pairs, ",")+"]")
	}
	return strings.Join(parts, ","), nil
}

// transformOptions normalizes options (a map, struct or nil) to a decoded JSON object.
func transformOptions(options any) (map[string]any, error) {
	if options == nil {
		return map[string]any{}, nil
	}
	raw, err := json.Marshal(options)
	if err != nil {
		return nil, argumentError("Could not encode transform options", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err = decoder.Decode(&value); err != nil {
		return nil, argumentError("Could not encode transform options", err)
	}
	if value == nil {
		return map[string]any{}, nil
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, invalid(CodeSDKInvalidArgument, "transform options must be an object")
	}
	return object, nil
}

func appendTransformOption(pairs []string, key string, value any) ([]string, error) {
	var text string
	switch v := value.(type) {
	case nil:
		return pairs, nil
	case map[string]any:
		var err error
		for _, child := range sortedKeys(v) {
			if pairs, err = appendTransformOption(pairs, key+"["+child+"]", v[child]); err != nil {
				return nil, err
			}
		}
		return pairs, nil
	case string:
		text = v
	case bool:
		text = strconv.FormatBool(v)
	case json.Number:
		f, err := v.Float64()
		if err != nil || math.IsInf(f, 0) || math.IsNaN(f) {
			return nil, invalid(CodeSDKInvalidArgument, fmt.Sprintf("transform option %q must be a finite number", key))
		}
		text = jsNumber(f)
	default:
		return nil, invalid(CodeSDKInvalidArgument, fmt.Sprintf("transform option %q must be a string, number, boolean or object", key))
	}
	return append(pairs, transformComponent(key)+"="+transformComponent(text)), nil
}

func sortedKeys(object map[string]any) []string {
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// jsNumber formats a finite number like JavaScript's String(n).
func jsNumber(f float64) string {
	if f == 0 {
		return "0"
	}
	if abs := math.Abs(f); abs >= 1e21 || abs < 1e-6 {
		mantissa, exponent, _ := strings.Cut(strconv.FormatFloat(f, 'e', -1, 64), "e")
		sign := exponent[:1]
		digits := strings.TrimLeft(exponent[1:], "0")
		return mantissa + "e" + sign + digits
	}
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// transformComponent percent-encodes everything except RFC 3986 unreserved characters.
func transformComponent(value string) string {
	var out strings.Builder
	for _, b := range []byte(value) {
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == '-' || b == '.' || b == '_' || b == '~' {
			out.WriteByte(b)
		} else {
			fmt.Fprintf(&out, "%%%02X", b)
		}
	}
	return out.String()
}

// transformPath encodes a string transform for the CDN path like JavaScript's encodeURI,
// but keeps the literal "[" and "]" the CDN matches.
func transformPath(transform string) (string, error) {
	transform = strings.TrimLeft(transform, "/")
	// The transform keeps its separators, so it must not move up a path or add a query/fragment.
	if strings.Contains(transform, "..") || strings.ContainsAny(transform, "?#") {
		return "", invalid(CodeSDKInvalidArgument, `transform cannot contain "..", "?" or "#"`)
	}
	var escaped strings.Builder
	for _, b := range []byte(transform) {
		if strings.ContainsRune(";/:@&=+$,[]", rune(b)) {
			escaped.WriteByte(b)
		} else {
			escaped.WriteString(component(string([]byte{b})))
		}
	}
	return escaped.String(), nil
}
