/**
 * Builds the game-resource tree the app ships from your own retail Red Alert 2
 * files — the offline equivalent of the engine's in-browser importer.
 *
 *   RA2_RETAIL_DIR=/path/to/steam-retail bun scripts/prepare-gameres.ts
 *
 * Produces:
 *   gameres-export/            retail core/profile MIX files, music/*.mp3,
 *                              ra2ts_l*.bik (menu video), glsl.png (splash)
 *   redalert2/public/general.csf   English in-game strings (from language.mix)
 *
 * Requires ffmpeg on PATH (brew install ffmpeg) for optional music conversion.
 * No game assets are committed to this repo — this script exists so a fresh
 * clone plus a legally-owned copy of the game can produce a working build.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join } from "node:path";
import { MixFile } from "../redalert2/src/data/MixFile";
import { ShpFile } from "../redalert2/src/data/ShpFile";
import { Palette } from "../redalert2/src/data/Palette";
import { IniFile } from "../redalert2/src/data/IniFile";
import { VirtualFile } from "../redalert2/src/data/vfs/VirtualFile";
import { ImageUtils } from "../redalert2/src/engine/gfx/ImageUtils";
import { mixDatabase } from "../redalert2/src/engine/mixDatabase";

const RETAIL = process.env.RA2_RETAIL_DIR ?? "";
if (!RETAIL) {
    console.error(
        "RA2_RETAIL_DIR is not set.\n\n" +
            "Point it at your own Red Alert 2 install (the folder containing ra2.mix), e.g.:\n" +
            '  RA2_RETAIL_DIR="/path/to/steamapps/common/Command & Conquer Red Alert 2" bun scripts/prepare-gameres.ts\n\n' +
            "Or use the friendly wrapper: ./scripts/setup.sh <path>",
    );
    process.exit(1);
}
const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "gameres-export");
const TMP = join(OUT, ".tmp");

type ResourceProfile = "ra2" | "yr" | "mental-omega";

function hasRetailFile(name: string): boolean {
    return [name, name.toUpperCase(), name.toLowerCase()].some((candidate) => existsSync(join(RETAIL, candidate)));
}

function detectResourceProfile(): ResourceProfile {
    const requested = process.env.RA2_GAME_PROFILE?.trim().toLocaleLowerCase("en-US");
    if (requested === "mo") return "mental-omega";
    if (requested === "ra2" || requested === "yr" || requested === "mental-omega") return requested;
    const entries = readdirSync(RETAIL);
    if (entries.some((name) => /^expandmo\d{2}\.mix$/i.test(name))) return "mental-omega";
    if (hasRetailFile("ra2md.mix") && hasRetailFile("langmd.mix")) return "yr";
    return "ra2";
}

function hasFfmpeg(): boolean {
    try {
        execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
        return true;
    }
    catch {
        return false;
    }
}

function retailFile(name: string): string {
    for (const candidate of [name, name.toUpperCase(), name.toLowerCase()]) {
        const path = join(RETAIL, candidate);
        if (existsSync(path)) return path;
    }
    throw new Error(`"${name}" not found in ${RETAIL} — point RA2_RETAIL_DIR at your RA2 install`);
}

function copyMatchingMixes(pattern: RegExp, description: string): void {
    const matches = readdirSync(RETAIL)
        .filter((name) => pattern.test(name))
        .sort((left, right) => left.localeCompare(right));
    for (const name of matches) {
        copyFileSync(join(RETAIL, name), join(OUT, name));
        console.log(`   ${name}`);
    }
    if (matches.length === 0) {
        console.warn(`   (skip) no ${description} found`);
    }
}

function copyMatchingRootFiles(pattern: RegExp, description: string): void {
    const matches = readdirSync(RETAIL)
        .filter((name) => pattern.test(name))
        .sort((left, right) => left.localeCompare(right));
    for (const name of matches) {
        copyFileSync(join(RETAIL, name), join(OUT, name.toLowerCase()));
        console.log(`   ${name}`);
    }
    if (matches.length === 0) {
        console.warn(`   (skip) no ${description} found`);
    }
}

function openMix(path: string): MixFile {
    const bytes = new Uint8Array(readFileSync(path));
    return new MixFile(VirtualFile.fromBytes(bytes, path).stream as any);
}

function extractTo(mix: MixFile, entry: string, outPath: string): void {
    const file = mix.openFile(entry);
    const stream = file.stream as any;
    writeFileSync(outPath, new Uint8Array(stream.buffer, stream.byteOffset, stream.byteLength));
}

// --- Minimal PNG encoder (RGBA8, zlib, filter 0) --------------------------
function crc32(data: Uint8Array): number {
    let crc = ~0;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return ~crc >>> 0;
}
function pngChunk(type: string, payload: Uint8Array): Uint8Array {
    const chunk = new Uint8Array(12 + payload.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, payload.length);
    for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
    chunk.set(payload, 8);
    view.setUint32(8 + payload.length, crc32(chunk.subarray(4, 8 + payload.length)));
    return chunk;
}
function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
    const raw = new Uint8Array(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
        raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
    }
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const parts = [signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", new Uint8Array(deflateSync(raw))), pngChunk("IEND", new Uint8Array(0))];
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const png = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { png.set(part, offset); offset += part.length; }
    return png;
}
// --------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, "music"), { recursive: true });
mkdirSync(TMP, { recursive: true });

const RESOURCE_PROFILE = detectResourceProfile();
const MEDIA_CONVERSION_AVAILABLE = hasFfmpeg();
console.log(`== Preparing ${RESOURCE_PROFILE} game resources`);
if (!MEDIA_CONVERSION_AVAILABLE) {
    console.warn("== ffmpeg is unavailable; skipping optional music conversion");
}

console.log("== Copying core mixes");
for (const name of ["ra2.mix", "language.mix", "multi.mix"]) {
    copyFileSync(retailFile(name), join(OUT, name));
    console.log(`   ${name}`);
}

console.log("== Extracting English strings -> redalert2/public/general.csf");
const langMix = openMix(retailFile("language.mix"));
extractTo(langMix, "ra2.csf", join(ROOT, "redalert2", "public", "general.csf"));

console.log("== Converting music (theme.mix -> music/*.mp3)");
if (MEDIA_CONVERSION_AVAILABLE) {
    const themeMix = openMix(retailFile("theme.mix"));
    const trackNames = mixDatabase.get("theme.mix") ?? [];
    for (const wavName of trackNames) {
        if (!themeMix.containsFile(wavName)) {
            console.warn(`   (skip) ${wavName} not in theme.mix`);
            continue;
        }
        const wavPath = join(TMP, wavName);
        extractTo(themeMix, wavName, wavPath);
        const mp3Name = wavName.replace(/\.wav$/i, ".mp3");
        execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wavPath, "-vn", "-ar", "22050", "-q:a", "5", join(OUT, "music", mp3Name)]);
        console.log(`   ${mp3Name}`);
    }
}

console.log("== Keeping original menu video (.bik)");
let menuVideoMix = langMix;
let menuVideoOutput = "ra2ts_l.bik";
if (RESOURCE_PROFILE === "yr" && hasRetailFile("langmd.mix")) {
    const yurisLanguageMix = openMix(retailFile("langmd.mix"));
    if (yurisLanguageMix.containsFile("ra2ts_l.bik")) {
        menuVideoMix = yurisLanguageMix;
        menuVideoOutput = "ra2ts_l_yr.bik";
    }
}
if (menuVideoMix.containsFile("ra2ts_l.bik")) {
    extractTo(menuVideoMix, "ra2ts_l.bik", join(OUT, menuVideoOutput));
    console.log(`   ${menuVideoOutput}`);
} else {
    console.warn("   (skip) ra2ts_l.bik not found in the selected language mix");
}

console.log("== Extracting splash image (ra2.mix -> glsl.png)");
const ra2Mix = openMix(retailFile("ra2.mix"));
const localMix = new MixFile(ra2Mix.openFile("local.mix").stream);
const shp = new ShpFile(localMix.openFile("glsl.shp"));
const pal = new Palette(localMix.openFile("gls.pal"));
const bitmap = ImageUtils.convertShpToBitmap(shp, pal);
const rgba = new Uint8Array(bitmap.width * bitmap.height * 4);
for (let i = 0; i < bitmap.data.length; i++) {
    const paletteIndex = bitmap.data[i];
    const color = pal.colors[paletteIndex];
    rgba[i * 4] = color?.r ?? 0;
    rgba[i * 4 + 1] = color?.g ?? 0;
    rgba[i * 4 + 2] = color?.b ?? 0;
    rgba[i * 4 + 3] = paletteIndex === 0 ? 0 : 255;
}
writeFileSync(join(OUT, "glsl.png"), encodePng(bitmap.width, bitmap.height, rgba));
console.log(`   glsl.png (${bitmap.width}x${bitmap.height})`);

// --- Yuri's Revenge (md) content ------------------------------------------
console.log("== Copying YR mixes");
for (const name of ["ra2md.mix", "langmd.mix", "multimd.mix"]) {
    try {
        copyFileSync(retailFile(name), join(OUT, name));
        console.log(`   ${name}`);
    } catch {
        console.warn(`   (skip) ${name} not found — YR content unavailable`);
    }
}

// MIX filenames are hashes inside the archive, so the runtime can only mount
// profile extension archives when the importer preserves their container
// names. Keep this profile-driven: ordinary RA2/YR exports get their own
// extension layers, while a selected or detected MO install also carries the
// expandmo## layer that defines its rules, art, sounds, and units.
console.log("== Copying profile extension mixes");
copyMatchingMixes(/^(?:ecache|expand|elocal)(?:md|mo)?\d{2}\.mix$/i, "profile extension MIX files");
if (RESOURCE_PROFILE === "mental-omega") {
    copyMatchingMixes(/^mapsmo\d{2}\.mix$/i, "Mental Omega map MIX files");
    copyMatchingMixes(/^movmo\d{2}\.mix$/i, "Mental Omega movie MIX files");
    copyMatchingMixes(/^multimo\.mix$/i, "Mental Omega multiplayer MIX");
}

// Ares can add audio outside the retail audio.mix/audiomd.mix containers.
// Preserve these root resources so the runtime can discover the matching
// IDX/BAG pair and any loose WAV samples without a profile-specific branch.
console.log("== Copying loose audio resources");
copyMatchingRootFiles(/^(?:audio|ares)(?:\d{2})?\.(?:bag|idx)$/i, "Ares audio BAG/IDX files");
copyMatchingRootFiles(/\.wav$/i, "loose WAV resources");

console.log("== Copying bonus map packs (*.mmx, *.yro)");
for (const entry of readdirSync(RETAIL)) {
    if (/\.(mmx|yro)$/i.test(entry)) {
        copyFileSync(join(RETAIL, entry), join(OUT, entry.toLowerCase()));
        console.log(`   ${entry.toLowerCase()}`);
    }
}

console.log("== Extracting YR strings -> redalert2/public/generalmd.csf");
try {
    const langmdMix = openMix(retailFile("langmd.mix"));
    extractTo(langmdMix, "ra2md.csf", join(ROOT, "redalert2", "public", "generalmd.csf"));
} catch {
    console.warn("   (skip) langmd.mix/ra2md.csf not found");
}

console.log("== Converting YR music (thememd.mix -> music/*.mp3)");
try {
    if (!MEDIA_CONVERSION_AVAILABLE) throw new Error("ffmpeg is unavailable");
    // Track list comes from thememd.ini (inside ra2md.mix -> localmd.mix):
    // MIX archives store hashed names, so the ini is the only name source.
    const ra2mdMix = openMix(retailFile("ra2md.mix"));
    const localmd = new MixFile(ra2mdMix.openFile("localmd.mix").stream);
    const themeIni = new IniFile(localmd.openFile("thememd.ini"));
    const yrTracks = new Set<string>();
    for (const section of themeIni.getOrderedSections()) {
        const sound = section.getString("Sound");
        if (sound) yrTracks.add(sound.toLowerCase() + ".wav");
    }
    const thememdMix = openMix(retailFile("thememd.mix"));
    for (const wavName of yrTracks) {
        if (!thememdMix.containsFile(wavName)) continue;
        const mp3Name = wavName.replace(/\.wav$/i, ".mp3");
        if (existsSync(join(OUT, "music", mp3Name))) continue;
        const wavPath = join(TMP, wavName);
        extractTo(thememdMix, wavName, wavPath);
        execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wavPath, "-vn", "-ar", "22050", "-q:a", "5", join(OUT, "music", mp3Name)]);
        console.log(`   ${mp3Name}`);
    }
} catch (e) {
    console.warn("   (skip) YR music conversion failed:", (e as Error).message);
}
// --------------------------------------------------------------------------

console.log("== Copying multiplayer taunts (Taunts/*.wav)");
// Keep the optional namespace in the generated tree even when a particular
// retail installation does not ship loose taunt WAVs. Empty directories are
// useful to storage adapters that otherwise cannot represent this namespace.
mkdirSync(join(OUT, "Taunts"), { recursive: true });
try {
    const tauntsSrc = retailFile("Taunts");
    let tauntCount = 0;
    for (const entry of readdirSync(tauntsSrc)) {
        if (/\.wav$/i.test(entry)) {
            copyFileSync(join(tauntsSrc, entry), join(OUT, "Taunts", entry.toLowerCase()));
            tauntCount++;
        }
    }
    console.log(`   ${tauntCount} taunt files`);
} catch {
    console.warn("   (skip) Taunts folder not found");
}

rmSync(TMP, { recursive: true, force: true });

console.log("== Writing manifest.json");
const manifestFiles: { path: string; size: number }[] = [];
const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir).sort()) {
        if (name === ".DS_Store" || name === "manifest.json") continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
        else manifestFiles.push({ path: `${prefix}${name}`, size: statSync(full).size });
    }
};
walk(OUT, "");
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ files: manifestFiles }, null, 1));

console.log("== Done. Now run scripts/build-ios.sh to bundle everything.");
