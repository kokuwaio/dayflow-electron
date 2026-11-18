package frames

import (
	"image"
	"image/color"
	"testing"
)

func TestToRGBA(t *testing.T) {
	// One 2x1 frame: a red and a blue pixel, alpha bytes deliberately garbage.
	tests := []struct {
		name   string
		format uint32
		buf    []byte
	}{
		{"BGRx swaps red and blue", FormatBGRx, []byte{0, 0, 255, 7, 255, 0, 0, 9}},
		{"BGRA swaps red and blue", FormatBGRA, []byte{0, 0, 255, 7, 255, 0, 0, 9}},
		{"RGBx is copied", FormatRGBx, []byte{255, 0, 0, 7, 0, 0, 255, 9}},
		{"RGBA is copied", FormatRGBA, []byte{255, 0, 0, 7, 0, 0, 255, 9}},
	}
	red, blue := color.RGBA{255, 0, 0, 255}, color.RGBA{0, 0, 255, 255}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			img, err := ToRGBA(nil, tt.buf, 2, 1, tt.format)
			if err != nil {
				t.Fatal(err)
			}
			if got := img.RGBAAt(0, 0); got != red {
				t.Errorf("pixel 0 = %v, want opaque red", got)
			}
			if got := img.RGBAAt(1, 0); got != blue {
				t.Errorf("pixel 1 = %v, want opaque blue", got)
			}
		})
	}

	t.Run("reuses the image when the size matches", func(t *testing.T) {
		first, _ := ToRGBA(nil, make([]byte, 8), 2, 1, FormatBGRx)
		second, _ := ToRGBA(first, make([]byte, 8), 2, 1, FormatBGRx)
		if first != second {
			t.Error("allocated a new image for the same size")
		}
	})

	t.Run("rejects unknown formats", func(t *testing.T) {
		if _, err := ToRGBA(nil, make([]byte, 8), 2, 1, 99); err == nil {
			t.Error("want an error for SPA format 99")
		}
	})
}

func TestScaleToHeight(t *testing.T) {
	tests := []struct {
		name         string
		w, h, height int
		wantW, wantH int
	}{
		{"1440p down to 1080p keeps 16:9", 2560, 1440, 1080, 1920, 1080},
		{"ultrawide down to 720p", 3440, 1440, 720, 1720, 720},
		{"never upscales", 1280, 720, 1080, 1280, 720},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := ScaleToHeight(image.NewRGBA(image.Rect(0, 0, tt.w, tt.h)), tt.height).Bounds()
			if b.Dx() != tt.wantW || b.Dy() != tt.wantH {
				t.Fatalf("got %dx%d, want %dx%d", b.Dx(), b.Dy(), tt.wantW, tt.wantH)
			}
		})
	}
}
