package calmlenstest

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/color"
	"image/png"
	"math"
)

// placeholderPNG renders a base64 ThumbHash as the small PNG the CDN serves for the placeholder
// resource (packages/shared/src/PlaceholderHashDecode.ts).
func placeholderPNG(hash string) ([]byte, error) {
	data, err := base64.StdEncoding.DecodeString(hash)
	if err != nil {
		return nil, err
	}
	img, err := thumbHashToImage(data)
	if err != nil {
		return nil, err
	}
	var out bytes.Buffer
	if err = png.Encode(&out, img); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// thumbHashToImage decodes a ThumbHash into an image whose RGB is not premultiplied by alpha.
func thumbHashToImage(hash []byte) (*image.NRGBA, error) {
	if len(hash) < 5 {
		return nil, errors.New("ThumbHash too short")
	}
	at := func(i int) int {
		if i < len(hash) {
			return int(hash[i])
		}
		return 0
	}
	header24 := at(0) | at(1)<<8 | at(2)<<16
	header16 := at(3) | at(4)<<8
	lDC := float64(header24&63) / 63
	pDC := float64((header24>>6)&63)/31.5 - 1
	qDC := float64((header24>>12)&63)/31.5 - 1
	lScale := float64((header24>>18)&31) / 31
	hasAlpha := header24>>23 != 0
	pScale := float64((header16>>3)&63) / 63
	qScale := float64((header16>>9)&63) / 63
	isLandscape := header16>>15 != 0
	pick := func(condition bool, yes, no int) int {
		if condition {
			return yes
		}
		return no
	}
	lx := max(3, pick(isLandscape, pick(hasAlpha, 5, 7), header16&7))
	ly := max(3, pick(isLandscape, header16&7, pick(hasAlpha, 5, 7)))
	aDC, aScale := 1.0, float64(at(5)>>4)/15
	if hasAlpha {
		aDC = float64(at(5)&15) / 15
	}
	acStart := pick(hasAlpha, 6, 5)
	acIndex := 0
	decodeChannel := func(nx, ny int, scale float64) []float64 {
		var ac []float64
		for cy := 0; cy < ny; cy++ {
			for cx := pick(cy > 0, 0, 1); cx*ny < nx*(ny-cy); cx++ {
				value := (at(acStart+acIndex>>1) >> ((acIndex & 1) << 2)) & 15
				acIndex++
				ac = append(ac, (float64(value)/7.5-1)*scale)
			}
		}
		return ac
	}
	lAC := decodeChannel(lx, ly, lScale)
	pAC := decodeChannel(3, 3, pScale*1.25)
	qAC := decodeChannel(3, 3, qScale*1.25)
	var aAC []float64
	if hasAlpha {
		aAC = decodeChannel(5, 5, aScale)
	}
	// The approximate aspect ratio decides the size: 32 pixels on the longer side.
	ratioX := pick(isLandscape, pick(hasAlpha, 5, 7), at(3)&7)
	ratioY := pick(isLandscape, at(3)&7, pick(hasAlpha, 5, 7))
	if ratioY == 0 {
		return nil, errors.New("invalid ThumbHash")
	}
	ratio := float64(ratioX) / float64(ratioY)
	w, h := 32, 32
	if ratio > 1 {
		h = int(math.Round(32 / ratio))
	} else {
		w = int(math.Round(32 * ratio))
	}
	if w < 1 || h < 1 {
		return nil, errors.New("invalid ThumbHash")
	}
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	fx := make([]float64, max(lx, pick(hasAlpha, 5, 3)))
	fy := make([]float64, max(ly, pick(hasAlpha, 5, 3)))
	channel := func(v float64) uint8 { return uint8(math.Max(0, 255*math.Min(1, v))) }
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			l, p, q, a := lDC, pDC, qDC, aDC
			for cx := range fx {
				fx[cx] = math.Cos(math.Pi / float64(w) * (float64(x) + 0.5) * float64(cx))
			}
			for cy := range fy {
				fy[cy] = math.Cos(math.Pi / float64(h) * (float64(y) + 0.5) * float64(cy))
			}
			for cy, j := 0, 0; cy < ly; cy++ {
				for cx, fy2 := pick(cy > 0, 0, 1), fy[cy]*2; cx*ly < lx*(ly-cy); cx, j = cx+1, j+1 {
					l += lAC[j] * fx[cx] * fy2
				}
			}
			for cy, j := 0, 0; cy < 3; cy++ {
				for cx, fy2 := pick(cy > 0, 0, 1), fy[cy]*2; cx < 3-cy; cx, j = cx+1, j+1 {
					f := fx[cx] * fy2
					p += pAC[j] * f
					q += qAC[j] * f
				}
			}
			if hasAlpha {
				for cy, j := 0, 0; cy < 5; cy++ {
					for cx, fy2 := pick(cy > 0, 0, 1), fy[cy]*2; cx < 5-cy; cx, j = cx+1, j+1 {
						a += aAC[j] * fx[cx] * fy2
					}
				}
			}
			b := l - 2.0/3.0*p
			r := (3*l - b + q) / 2
			g := r - q
			img.SetNRGBA(x, y, color.NRGBA{R: channel(r), G: channel(g), B: channel(b), A: channel(a)})
		}
	}
	return img, nil
}
