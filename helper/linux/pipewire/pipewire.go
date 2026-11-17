// Package pipewire is a small native PipeWire client for ScreenCast portal
// streams. Compared with gst-launch it negotiates a low maximum frame rate (the
// compositor then sends at most that many frames) and reads the cursor
// metadata, which tells which screen the mouse is on without any
// compositor-specific API.
//
// Needs cgo and libpipewire-0.3; build it inside the Flatpak SDK (see
// Makefile).
package pipewire

/*
#cgo pkg-config: libpipewire-0.3
#include <pipewire/pipewire.h>
#include <spa/param/video/format-utils.h>
#include <spa/param/buffers.h>
#include <spa/buffer/meta.h>
#include <spa/pod/builder.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define DF_MAX_STREAMS 8
#define DF_CURSOR_META(w, h) ((int)(sizeof(struct spa_meta_cursor) + sizeof(struct spa_meta_bitmap) + (w) * (h) * 4))

typedef struct {
	struct pw_stream *stream;
	struct spa_hook listener;
	uint32_t node;
	int index;

	uint8_t *frame;      // latest copied frame, tightly packed rows
	size_t frame_cap;
	int width, height, stride;
	uint32_t format;     // SPA_VIDEO_FORMAT_*
	int64_t frame_ns;    // when the latest frame was copied

	int cursor_valid;    // cursor is on this stream's screen
	int cursor_x, cursor_y;
	int64_t cursor_ns;

	uint64_t buffers, frames_copied, cursor_updates, corrupted;
	int state;           // enum pw_stream_state
	char error[160];
	int data_type;       // SPA_DATA_* of the last buffer
	int want;            // copy the next frame (set by df_request)
} df_stream;

static struct pw_thread_loop *df_loop;
static struct pw_context *df_context;
static struct pw_core *df_core;
static df_stream df_streams[DF_MAX_STREAMS];
static int df_nstreams;

static int64_t df_now(void) {
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (int64_t)ts.tv_sec * 1000000000LL + ts.tv_nsec;
}

static void df_on_process(void *data) {
	df_stream *s = data;
	struct pw_buffer *b = NULL, *n;
	while ((n = pw_stream_dequeue_buffer(s->stream)) != NULL) {
		if (b) pw_stream_queue_buffer(s->stream, b);
		b = n;
	}
	if (!b) return;
	s->buffers++;
	struct spa_buffer *buf = b->buffer;
	int64_t now = df_now();

	struct spa_meta_cursor *mc = spa_buffer_find_meta_data(buf, SPA_META_Cursor, sizeof(*mc));
	if (mc) {
		s->cursor_updates++;
		if (spa_meta_cursor_is_valid(mc)) {
			s->cursor_valid = 1;
			s->cursor_x = mc->position.x;
			s->cursor_y = mc->position.y;
			s->cursor_ns = now;
		} else {
			s->cursor_valid = 0;
		}
	}

	struct spa_data *d = &buf->datas[0];
	s->data_type = d->type;
	if (d->data == NULL || d->chunk == NULL || d->chunk->size == 0) goto done;
	if (d->chunk->flags & SPA_CHUNK_FLAG_CORRUPTED) { s->corrupted++; goto done; }
	if (s->width <= 0 || s->height <= 0) goto done;
	if (!s->want) goto done; // only copy frames someone asked for
	s->want = 0;

	int stride = d->chunk->stride > 0 ? d->chunk->stride : s->width * 4;
	size_t row = (size_t)s->width * 4;
	size_t need = row * (size_t)s->height;
	if ((size_t)d->chunk->offset + (size_t)stride * (size_t)(s->height - 1) + row > d->maxsize) goto done;
	if (s->frame_cap < need) {
		free(s->frame);
		s->frame = malloc(need);
		s->frame_cap = s->frame ? need : 0;
		if (!s->frame) goto done;
	}
	uint8_t *src = (uint8_t *)d->data + d->chunk->offset;
	for (int y = 0; y < s->height; y++) memcpy(s->frame + row * y, src + (size_t)stride * y, row);
	s->stride = (int)row;
	s->frame_ns = now;
	s->frames_copied++;
done:
	pw_stream_queue_buffer(s->stream, b);
}

static void df_on_param_changed(void *data, uint32_t id, const struct spa_pod *param) {
	df_stream *s = data;
	if (param == NULL || id != SPA_PARAM_Format) return;
	struct spa_video_info_raw info;
	if (spa_format_video_raw_parse(param, &info) < 0) return;
	s->width = info.size.width;
	s->height = info.size.height;
	s->format = info.format;

	uint8_t buffer[1024];
	struct spa_pod_builder b = SPA_POD_BUILDER_INIT(buffer, sizeof(buffer));
	const struct spa_pod *params[2];
	params[0] = spa_pod_builder_add_object(&b,
		SPA_TYPE_OBJECT_ParamMeta, SPA_PARAM_Meta,
		SPA_PARAM_META_type, SPA_POD_Id(SPA_META_Cursor),
		SPA_PARAM_META_size, SPA_POD_CHOICE_RANGE_Int(DF_CURSOR_META(64, 64), DF_CURSOR_META(1, 1), DF_CURSOR_META(512, 512)));
	params[1] = spa_pod_builder_add_object(&b,
		SPA_TYPE_OBJECT_ParamBuffers, SPA_PARAM_Buffers,
		SPA_PARAM_BUFFERS_dataType, SPA_POD_CHOICE_FLAGS_Int((1 << SPA_DATA_MemPtr) | (1 << SPA_DATA_MemFd)));
	pw_stream_update_params(s->stream, params, 2);
}

static void df_on_state_changed(void *data, enum pw_stream_state old, enum pw_stream_state state, const char *error) {
	df_stream *s = data;
	s->state = state;
	if (error) {
		strncpy(s->error, error, sizeof(s->error) - 1);
		s->error[sizeof(s->error) - 1] = 0;
	}
}

static const struct pw_stream_events df_stream_events = {
	PW_VERSION_STREAM_EVENTS,
	.state_changed = df_on_state_changed,
	.param_changed = df_on_param_changed,
	.process = df_on_process,
};

// df_start connects to the portal's PipeWire remote and opens one stream per
// node. maxfps caps the frame rate the compositor sends.
static int df_start(int fd, uint32_t *nodes, int n, int maxfps) {
	if (n > DF_MAX_STREAMS) n = DF_MAX_STREAMS;
	pw_init(NULL, NULL);
	df_loop = pw_thread_loop_new("dayflow-pw", NULL);
	if (!df_loop) return -1;
	df_context = pw_context_new(pw_thread_loop_get_loop(df_loop), NULL, 0);
	if (!df_context) return -2;
	if (pw_thread_loop_start(df_loop) < 0) return -3;
	pw_thread_loop_lock(df_loop);
	df_core = pw_context_connect_fd(df_context, fd, NULL, 0);
	if (!df_core) { pw_thread_loop_unlock(df_loop); return -4; }

	for (int i = 0; i < n; i++) {
		df_stream *s = &df_streams[i];
		memset(s, 0, sizeof(*s));
		s->node = nodes[i];
		s->index = i;
		s->stream = pw_stream_new(df_core, "dayflow-capture",
			pw_properties_new(PW_KEY_MEDIA_TYPE, "Video", PW_KEY_MEDIA_CATEGORY, "Capture",
				PW_KEY_MEDIA_ROLE, "Screen", NULL));
		if (!s->stream) { pw_thread_loop_unlock(df_loop); return -5; }
		pw_stream_add_listener(s->stream, &s->listener, &df_stream_events, s);

		uint8_t buffer[1024];
		struct spa_pod_builder b = SPA_POD_BUILDER_INIT(buffer, sizeof(buffer));
		const struct spa_pod *params[1];
		params[0] = spa_pod_builder_add_object(&b,
			SPA_TYPE_OBJECT_Format, SPA_PARAM_EnumFormat,
			SPA_FORMAT_mediaType, SPA_POD_Id(SPA_MEDIA_TYPE_video),
			SPA_FORMAT_mediaSubtype, SPA_POD_Id(SPA_MEDIA_SUBTYPE_raw),
			SPA_FORMAT_VIDEO_format, SPA_POD_CHOICE_ENUM_Id(5,
				SPA_VIDEO_FORMAT_BGRx, SPA_VIDEO_FORMAT_BGRx, SPA_VIDEO_FORMAT_BGRA,
				SPA_VIDEO_FORMAT_RGBx, SPA_VIDEO_FORMAT_RGBA),
			SPA_FORMAT_VIDEO_size, SPA_POD_CHOICE_RANGE_Rectangle(
				&SPA_RECTANGLE(1920, 1080), &SPA_RECTANGLE(1, 1), &SPA_RECTANGLE(16384, 16384)),
			SPA_FORMAT_VIDEO_framerate, SPA_POD_Fraction(&SPA_FRACTION(0, 1)),
			SPA_FORMAT_VIDEO_maxFramerate, SPA_POD_CHOICE_RANGE_Fraction(
				&SPA_FRACTION(maxfps, 1), &SPA_FRACTION(0, 1), &SPA_FRACTION(maxfps, 1)));
		if (pw_stream_connect(s->stream, PW_DIRECTION_INPUT, nodes[i],
				PW_STREAM_FLAG_AUTOCONNECT | PW_STREAM_FLAG_MAP_BUFFERS, params, 1) < 0) {
			pw_thread_loop_unlock(df_loop);
			return -6;
		}
	}
	df_nstreams = n;
	pw_thread_loop_unlock(df_loop);
	return 0;
}

// df_snapshot copies stream i's state and, if dst is not NULL, its latest
// frame. Returns the frame size in bytes (0 if none).
static size_t df_snapshot(int i, df_stream *out, uint8_t *dst, size_t cap) {
	size_t size = 0;
	pw_thread_loop_lock(df_loop);
	df_stream *s = &df_streams[i];
	*out = *s;
	out->frame = NULL;
	if (s->frame && s->frames_copied > 0) {
		size = (size_t)s->stride * (size_t)s->height;
		if (dst && cap >= size) memcpy(dst, s->frame, size);
	}
	pw_thread_loop_unlock(df_loop);
	return size;
}

static int64_t df_now_ns(void) { return df_now(); }

// df_stop destroys all streams and the PipeWire connection (which also closes
// the portal fd), so a new session can start.
static void df_stop(void) {
	if (!df_loop) return;
	pw_thread_loop_lock(df_loop);
	for (int i = 0; i < df_nstreams; i++) {
		if (df_streams[i].stream) pw_stream_destroy(df_streams[i].stream);
		free(df_streams[i].frame);
		memset(&df_streams[i], 0, sizeof(df_streams[i]));
	}
	df_nstreams = 0;
	if (df_core) pw_core_disconnect(df_core);
	df_core = NULL;
	pw_thread_loop_unlock(df_loop);
	pw_thread_loop_stop(df_loop);
	if (df_context) pw_context_destroy(df_context);
	df_context = NULL;
	pw_thread_loop_destroy(df_loop);
	df_loop = NULL;
}

// df_request asks stream i to copy its next frame.
static void df_request(int i) {
	pw_thread_loop_lock(df_loop);
	df_streams[i].want = 1;
	pw_thread_loop_unlock(df_loop);
}
*/
import "C"

import (
	"fmt"
	"time"
	"unsafe"
)

// Start connects to the portal's PipeWire remote fd and opens the given nodes.
func Start(fd int, nodes []uint32, maxfps int) error {
	if len(nodes) == 0 {
		return fmt.Errorf("pipewire: no nodes")
	}
	cn := make([]C.uint32_t, len(nodes))
	for i, n := range nodes {
		cn[i] = C.uint32_t(n)
	}
	if rc := C.df_start(C.int(fd), &cn[0], C.int(len(cn)), C.int(maxfps)); rc != 0 {
		C.df_stop()
		return fmt.Errorf("pipewire start failed (%d)", int(rc))
	}
	return nil
}

// Stop closes all streams and the connection.
func Stop() { C.df_stop() }

// Request asks stream i to copy its next frame.
func Request(i int) { C.df_request(C.int(i)) }

// State is a snapshot of one stream.
type State struct {
	Width, Height   int
	Format          uint32 // SPA video format
	CursorValid     bool
	CursorX         int // relative to the stream's screen
	CursorY         int
	CursorAge       time.Duration
	FrameAge        time.Duration
	Buffers, Copied uint64
	CursorUpdates   uint64
	State           int // pw_stream_state; negative means failed
	Err             string
	DataType        int
}

// Snapshot reads stream i's state and, when dst is large enough, copies its
// latest requested frame into dst. It returns the frame size in bytes.
func Snapshot(i int, dst []byte) (State, int) {
	var out C.df_stream
	var p *C.uint8_t
	if len(dst) > 0 {
		p = (*C.uint8_t)(unsafe.Pointer(&dst[0]))
	}
	n := int(C.df_snapshot(C.int(i), &out, p, C.size_t(len(dst))))
	now := int64(C.df_now_ns())
	st := State{
		Width:         int(out.width),
		Height:        int(out.height),
		Format:        uint32(out.format),
		CursorValid:   out.cursor_valid != 0,
		CursorX:       int(out.cursor_x),
		CursorY:       int(out.cursor_y),
		Buffers:       uint64(out.buffers),
		Copied:        uint64(out.frames_copied),
		CursorUpdates: uint64(out.cursor_updates),
		State:         int(out.state),
		Err:           C.GoString(&out.error[0]),
		DataType:      int(out.data_type),
	}
	if out.cursor_ns > 0 {
		st.CursorAge = time.Duration(now - int64(out.cursor_ns))
	}
	if out.frame_ns > 0 {
		st.FrameAge = time.Duration(now - int64(out.frame_ns))
	}
	return st, n
}
