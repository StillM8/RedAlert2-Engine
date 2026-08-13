use infinitier_bik_decoder::{parse_header, BikHeader, Plane, VideoDecoder, VideoFrame};
use std::alloc::{alloc_zeroed, dealloc, Layout};
use std::cell::RefCell;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::ptr::null_mut;
use std::slice;

struct Player {
    source: Cursor<Vec<u8>>,
    header: BikHeader,
    video: VideoDecoder,
    frame_index: usize,
    packet: Vec<u8>,
    rgba: Vec<u8>,
    frame_duration_us: u32,
}

thread_local! {
    static PLAYER: RefCell<Option<Player>> = const { RefCell::new(None) };
    static LAST_ERROR: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn set_error(message: impl std::fmt::Display) {
    LAST_ERROR.with(|error| {
        let mut error = error.borrow_mut();
        error.clear();
        error.extend_from_slice(message.to_string().as_bytes());
    });
}

fn clear_error() {
    LAST_ERROR.with(|error| error.borrow_mut().clear());
}

fn with_player<T>(callback: impl FnOnce(&Player) -> T) -> T
where
    T: Default,
{
    PLAYER.with(|player| player.borrow().as_ref().map(callback).unwrap_or_default())
}

#[no_mangle]
pub extern "C" fn bink_alloc(length: usize) -> *mut u8 {
    if length == 0 {
        return null_mut();
    }
    let Ok(layout) = Layout::array::<u8>(length) else {
        return null_mut();
    };
    unsafe { alloc_zeroed(layout) }
}

#[no_mangle]
pub unsafe extern "C" fn bink_dealloc(pointer: *mut u8, capacity: usize) {
    if !pointer.is_null() && capacity > 0 {
        if let Ok(layout) = Layout::array::<u8>(capacity) {
            dealloc(pointer, layout);
        }
    }
}

#[no_mangle]
pub extern "C" fn bink_reset() {
    PLAYER.with(|player| *player.borrow_mut() = None);
    clear_error();
}

#[no_mangle]
pub extern "C" fn bink_rewind() -> i32 {
    clear_error();
    PLAYER.with(|slot| {
        let mut slot = slot.borrow_mut();
        let Some(player) = slot.as_mut() else {
            set_error("Bink decoder is not open");
            return -1;
        };
        player.frame_index = 0;
        player.packet.clear();
        player.rgba.clear();
        player.video = match VideoDecoder::new(&player.header) {
            Ok(video) => video,
            Err(error) => {
                set_error(error);
                return -1;
            }
        };
        0
    })
}

#[no_mangle]
pub unsafe extern "C" fn bink_open(pointer: *const u8, length: usize) -> i32 {
    clear_error();
    if pointer.is_null() || length == 0 {
        set_error("Bink input is empty");
        return -1;
    }
    // A menu movie should be small. This also prevents a malformed input from
    // forcing an unbounded copy into the WebAssembly heap.
    if length > 256 * 1024 * 1024 {
        set_error("Bink input is too large");
        return -1;
    }
    let bytes = slice::from_raw_parts(pointer, length).to_vec();
    let mut source = Cursor::new(bytes);
    let header = match parse_header(&mut source) {
        Ok(header) => header,
        Err(error) => {
            set_error(error);
            return -1;
        }
    };
    let video = match VideoDecoder::new(&header) {
        Ok(video) => video,
        Err(error) => {
            set_error(error);
            return -1;
        }
    };
    let frame_duration_us =
        (header.fps_den as u64 * 1_000_000 / header.fps_num.max(1) as u64) as u32;
    let player = Player {
        source,
        packet: Vec::with_capacity(header.max_frame_size as usize),
        rgba: Vec::new(),
        frame_index: 0,
        frame_duration_us,
        header,
        video,
    };
    PLAYER.with(|slot| *slot.borrow_mut() = Some(player));
    0
}

#[no_mangle]
pub extern "C" fn bink_width() -> u32 {
    with_player(|player| player.header.width)
}

#[no_mangle]
pub extern "C" fn bink_height() -> u32 {
    with_player(|player| player.header.height)
}

#[no_mangle]
pub extern "C" fn bink_frame_count() -> u32 {
    with_player(|player| player.header.frame_count)
}

#[no_mangle]
pub extern "C" fn bink_frame_duration_us() -> u32 {
    with_player(|player| player.frame_duration_us)
}

#[no_mangle]
pub extern "C" fn bink_frame_ptr() -> *const u8 {
    with_player(|player| player.rgba.as_ptr())
}

#[no_mangle]
pub extern "C" fn bink_frame_len() -> usize {
    with_player(|player| player.rgba.len())
}

#[no_mangle]
pub extern "C" fn bink_error_ptr() -> *const u8 {
    LAST_ERROR.with(|error| error.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn bink_error_len() -> usize {
    LAST_ERROR.with(|error| error.borrow().len())
}

#[no_mangle]
pub extern "C" fn bink_next_frame() -> i32 {
    clear_error();
    PLAYER.with(|slot| {
        let mut slot = slot.borrow_mut();
        let Some(player) = slot.as_mut() else {
            set_error("Bink decoder is not open");
            return -1;
        };
        if player.frame_index >= player.header.frames.len() {
            return 0;
        }

        let frame_entry = player.header.frames[player.frame_index];
        player.packet.resize(frame_entry.size as usize, 0);
        if let Err(error) = player.source.seek(SeekFrom::Start(frame_entry.pos as u64)) {
            set_error(error);
            return -1;
        }
        if let Err(error) = player.source.read_exact(&mut player.packet) {
            set_error(error);
            return -1;
        }

        // Bink puts the audio packet length in front of each video packet when
        // audio tracks exist. The menu player intentionally ignores that PCM;
        // the original browser path also encoded the menu video with -an.
        let video_packet = if player.header.audio_tracks.is_empty() {
            player.packet.as_slice()
        } else {
            if player.packet.len() < 4 {
                set_error("Bink audio packet header is truncated");
                return -1;
            }
            let audio_length = u32::from_le_bytes([
                player.packet[0],
                player.packet[1],
                player.packet[2],
                player.packet[3],
            ]) as usize;
            let video_start = match 4usize.checked_add(audio_length) {
                Some(video_start) if video_start <= player.packet.len() => video_start,
                _ => {
                    set_error("Bink audio packet length is invalid");
                    return -1;
                }
            };
            &player.packet[video_start..]
        };

        let decoded = match player.video.decode_frame(video_packet) {
            Ok(frame) => frame,
            Err(error) => {
                set_error(error);
                return -1;
            }
        };
        convert_yuv_to_rgba(decoded, &mut player.rgba);
        player.frame_index += 1;
        1
    })
}

fn convert_yuv_to_rgba(frame: &VideoFrame, rgba: &mut Vec<u8>) {
    let width = frame.y.width as usize;
    let height = frame.y.height as usize;
    rgba.resize(width.saturating_mul(height).saturating_mul(4), 0);
    for row in 0..height {
        let y_row = row * frame.y.stride;
        let chroma_row = (row / 2) * frame.u.stride;
        for column in 0..width {
            let y = frame.y.data[y_row + column] as f32;
            let chroma_column = column / 2;
            let u = frame.u.data[chroma_row + chroma_column] as f32 - 128.0;
            let v = frame.v.data[chroma_row + chroma_column] as f32 - 128.0;
            let red = (y + 1.402 * v).clamp(0.0, 255.0) as u8;
            let green = (y - 0.344_136 * u - 0.714_136 * v).clamp(0.0, 255.0) as u8;
            let blue = (y + 1.772 * u).clamp(0.0, 255.0) as u8;
            let alpha = frame
                .alpha
                .as_ref()
                .map(|plane| plane.data[row * plane.stride + column])
                .unwrap_or(255);
            let offset = (row * width + column) * 4;
            rgba[offset] = red;
            rgba[offset + 1] = green;
            rgba[offset + 2] = blue;
            rgba[offset + 3] = alpha;
        }
    }
}

#[allow(dead_code)]
fn _plane_dimensions(plane: &Plane) -> (u32, u32) {
    (plane.width, plane.height)
}
