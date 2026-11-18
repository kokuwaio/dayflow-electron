// Package frames turns raw PipeWire frames into images and picks the screen
// under the mouse.
package frames

import (
	"fmt"
	"image"
	"time"

	"golang.org/x/image/draw"
)

// SPA video formats we accept (spa/param/video/raw.h).
const (
	FormatRGBx = 7
	FormatBGRx = 8
	FormatRGBA = 11
	FormatBGRA = 12
)

// ToRGBA converts a tightly packed frame into img, reusing it when the size matches.
func ToRGBA(img *image.RGBA, buf []byte, w, h int, format uint32) (*image.RGBA, error) {
	if img == nil || img.Rect.Dx() != w || img.Rect.Dy() != h {
		img = image.NewRGBA(image.Rect(0, 0, w, h))
	}
	switch format {
	case FormatBGRx, FormatBGRA:
		for i := 0; i+3 < w*h*4; i += 4 {
			img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = buf[i+2], buf[i+1], buf[i], 255
		}
	case FormatRGBx, FormatRGBA:
		copy(img.Pix, buf[:w*h*4])
		for i := 3; i < w*h*4; i += 4 {
			img.Pix[i] = 255
		}
	default:
		return nil, fmt.Errorf("unsupported SPA video format %d", format)
	}
	return img, nil
}

// ScaleToHeight scales src down to height, keeping the aspect ratio. It never
// upscales.
func ScaleToHeight(src image.Image, height int) image.Image {
	b := src.Bounds()
	if b.Dy() <= height {
		return src
	}
	width := b.Dx() * height / b.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.ApproxBiLinear.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	return dst
}

// CursorReading is what one portal stream's cursor metadata says right now.
// x and y are relative to that stream's screen.
type CursorReading struct {
	Valid         bool
	X, Y          int
	Width, Height int
	Age           time.Duration
}

// PickActiveStream returns the stream whose screen has the mouse, or -1.
// Near a screen border both streams report the cursor, each relative to its
// own screen and possibly just outside it, so only positions inside the
// screen count; of those the newest report wins.
func PickActiveStream(streams []CursorReading) int {
	best, bestAge := -1, time.Duration(1<<62)
	for i, s := range streams {
		inside := s.X >= 0 && s.Y >= 0 && s.X < s.Width && s.Y < s.Height
		if s.Valid && inside && s.Age < bestAge {
			best, bestAge = i, s.Age
		}
	}
	return best
}
