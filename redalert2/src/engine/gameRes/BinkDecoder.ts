const BINK_DECODER_URL = "/bink/bink_decoder.wasm";

interface BinkWasmExports {
    memory: WebAssembly.Memory;
    bink_alloc: (length: number) => number;
    bink_dealloc: (pointer: number, capacity: number) => void;
    bink_reset: () => void;
    bink_rewind: () => number;
    bink_open: (pointer: number, length: number) => number;
    bink_width: () => number;
    bink_height: () => number;
    bink_frame_count: () => number;
    bink_frame_duration_us: () => number;
    bink_frame_ptr: () => number;
    bink_frame_len: () => number;
    bink_error_ptr: () => number;
    bink_error_len: () => number;
    bink_next_frame: () => number;
}

export interface BinkVideoMetadata {
    width: number;
    height: number;
    frameCount: number;
    frameDurationUs: number;
}

function getWasmExports(instance: WebAssembly.Instance): BinkWasmExports {
    const exports = instance.exports as unknown as Partial<BinkWasmExports>;
    if (!exports.memory || typeof exports.bink_open !== "function") {
        throw new Error("The Bink WebAssembly module is missing its decoder exports");
    }
    return exports as BinkWasmExports;
}

function readWasmString(exports: BinkWasmExports): string {
    const pointer = exports.bink_error_ptr();
    const length = exports.bink_error_len();
    if (!length) {
        return "Unknown Bink decoder error";
    }
    return new TextDecoder().decode(new Uint8Array(exports.memory.buffer, pointer, length));
}

export function isBinkSource(source: string | File | undefined): boolean {
    if (!source) {
        return false;
    }
    const filename = typeof source === "string" ? source.split("?")[0] : source.name;
    return filename.toLowerCase().endsWith(".bik");
}

export class BinkDecoder {
    private constructor(private readonly wasm: BinkWasmExports) {}

    static async open(bytes: Uint8Array): Promise<BinkDecoder> {
        const wasmBytes = await (await fetch(BINK_DECODER_URL)).arrayBuffer();
        const module = await WebAssembly.compile(wasmBytes);
        const instance = await WebAssembly.instantiate(module, {});
        const decoder = new BinkDecoder(getWasmExports(instance));
        decoder.open(bytes);
        return decoder;
    }

    open(bytes: Uint8Array): BinkVideoMetadata {
        this.wasm.bink_reset();
        const pointer = this.wasm.bink_alloc(bytes.byteLength);
        if (!pointer) {
            throw new Error("Unable to allocate memory for the Bink video");
        }
        try {
            new Uint8Array(this.wasm.memory.buffer, pointer, bytes.byteLength).set(bytes);
            if (this.wasm.bink_open(pointer, bytes.byteLength) !== 0) {
                throw new Error(readWasmString(this.wasm));
            }
        }
        finally {
            this.wasm.bink_dealloc(pointer, bytes.byteLength);
        }
        return this.metadata;
    }

    get metadata(): BinkVideoMetadata {
        return {
            width: this.wasm.bink_width(),
            height: this.wasm.bink_height(),
            frameCount: this.wasm.bink_frame_count(),
            frameDurationUs: this.wasm.bink_frame_duration_us(),
        };
    }

    nextFrame(): Uint8ClampedArray | undefined {
        const result = this.wasm.bink_next_frame();
        if (result < 0) {
            throw new Error(readWasmString(this.wasm));
        }
        if (result === 0) {
            return undefined;
        }
        const pointer = this.wasm.bink_frame_ptr();
        const length = this.wasm.bink_frame_len();
        // The Rust decoder reuses its RGBA buffer. Copy the frame before the
        // next decode so canvas painting never observes a partially-written frame.
        const frameBuffer = new ArrayBuffer(length);
        new Uint8Array(frameBuffer).set(new Uint8Array(this.wasm.memory.buffer, pointer, length));
        return new Uint8ClampedArray(frameBuffer) as Uint8ClampedArray<ArrayBuffer>;
    }

    rewind(): void {
        if (this.wasm.bink_rewind() !== 0) {
            throw new Error(readWasmString(this.wasm));
        }
    }

    close(): void {
        this.wasm.bink_reset();
    }
}

async function loadBinkBytes(source: string | File): Promise<Uint8Array> {
    if (typeof source !== "string") {
        return new Uint8Array(await source.arrayBuffer());
    }
    const response = await fetch(source);
    if (!response.ok) {
        throw new Error(`Unable to load Bink video (${response.status} ${response.statusText})`);
    }
    return new Uint8Array(await response.arrayBuffer());
}

/**
 * Canvas playback keeps the original Bink file intact and gives every shell
 * the same decoder path: browser, Tauri, Android WebView, and WKWebView.
 */
export class BinkCanvasPlayer {
    private decoder?: BinkDecoder;
    private timer?: number;
    private generation = 0;

    async start(source: string | File, canvas: HTMLCanvasElement): Promise<void> {
        this.stop();
        const generation = this.generation;
        const bytes = await loadBinkBytes(source);
        if (generation !== this.generation) {
            return;
        }
        const decoder = await BinkDecoder.open(bytes);
        if (generation !== this.generation) {
            decoder.close();
            return;
        }
        const metadata = decoder.metadata;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) {
            decoder.close();
            throw new Error("The browser could not create a 2D canvas context for Bink playback");
        }
        canvas.width = metadata.width;
        canvas.height = metadata.height;
        this.decoder = decoder;

        const renderFrame = (): void => {
            if (generation !== this.generation || this.decoder !== decoder) {
                return;
            }
            try {
                let frame = decoder.nextFrame();
                if (!frame) {
                    decoder.rewind();
                    frame = decoder.nextFrame();
                }
                if (!frame) {
                    throw new Error("The Bink video did not contain a decodable frame");
                }
                context.putImageData(new ImageData(frame as ImageDataArray, metadata.width, metadata.height), 0, 0);
                const delay = Math.max(10, metadata.frameDurationUs / 1000);
                this.timer = window.setTimeout(renderFrame, delay);
            }
            catch (error) {
                console.error("[BinkCanvasPlayer] Bink playback stopped:", error);
                this.stop();
            }
        };
        renderFrame();
    }

    stop(): void {
        this.generation += 1;
        if (this.timer !== undefined) {
            window.clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.decoder?.close();
        this.decoder = undefined;
    }
}
