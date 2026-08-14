use percent_encoding::percent_decode_str;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::http::{Request, Response};
use tauri::{AppHandle, Manager, Runtime};
use zip::ZipArchive;

const GAME_RES_DIR: &str = "gameres";
const GAME_RES_STAGING_DIR: &str = ".gameres-importing";
const GAME_RES_BACKUP_PREFIX: &str = ".gameres-previous-";
const MOD_IMPORT_DIR: &str = "ra2-mod-imports";
const MAX_IMPORTED_FILE_COUNT: usize = 100_000;
const MAX_IMPORTED_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_IMPORTED_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_IMPORTED_PATH_DEPTH: usize = 64;
const MAX_IMPORTED_SEGMENT_LENGTH: usize = 255;
const REQUIRED_GAME_FILES: [&str; 3] = ["language.mix", "multi.mix", "ra2.mix"];

#[derive(Clone, Debug)]
struct SourceFile {
    absolute_path: PathBuf,
    relative_path: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestFile {
    path: String,
    size: u64,
}

#[derive(Serialize)]
struct GameResourceManifest {
    files: Vec<ManifestFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportResult {
    file_count: usize,
    total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModImportResult {
    token: String,
    source_name: String,
    files: Vec<ManifestFile>,
}

fn game_res_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(GAME_RES_DIR))
        .map_err(|error| format!("Could not resolve the app data folder: {error}"))
}

fn mod_import_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(MOD_IMPORT_DIR))
        .map_err(|error| format!("Could not resolve the mod import folder: {error}"))
}

fn safe_import_token(token: &str) -> bool {
    !token.is_empty()
        && token.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

/** Normalize a user-selected folder or ZIP entry without permitting traversal. */
fn normalize_mod_path(raw: &str) -> Result<Option<String>, String> {
    let replaced = raw.replace('\\', "/");
    if replaced.is_empty() || replaced.ends_with('/') {
        return Ok(None);
    }
    if replaced.starts_with('/') || replaced.chars().nth(1) == Some(':') {
        return Err(format!("Unsafe imported path: {raw}"));
    }
    let mut segments = Vec::new();
    for segment in replaced.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".."
            || segment.contains('\0')
            || segment.contains(':')
            || segment.len() > MAX_IMPORTED_SEGMENT_LENGTH
        {
            return Err(format!("Unsafe imported path: {raw}"));
        }
        segments.push(segment);
    }
    if segments.is_empty() {
        return Ok(None);
    }
    if segments.len() > MAX_IMPORTED_PATH_DEPTH {
        return Err(format!("Imported path is too deeply nested: {raw}"));
    }
    Ok(Some(segments.join("/")))
}

fn mod_source_relative_path(path: &Path, root: &Path) -> Result<String, String> {
    let relative = path.strip_prefix(root).map_err(|_| {
        format!(
            "Selected mod file is outside the chosen folder: {}",
            path.display()
        )
    })?;
    let raw = relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/");
    normalize_mod_path(&raw)?
        .ok_or_else(|| format!("Imported file has an empty path: {}", path.display()))
}

fn collect_mod_source_files(
    root: &Path,
    current: &Path,
    output: &mut Vec<SourceFile>,
) -> Result<(), String> {
    let entries = fs::read_dir(current)
        .map_err(|error| format!("Could not read {}: {error}", current.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not inspect mod files: {error}"))?;
        let path = entry.path();
        let file_type = fs::symlink_metadata(&path)
            .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?
            .file_type();
        if file_type.is_symlink() {
            return Err(format!(
                "Symbolic links are not supported in a mod folder: {}",
                path.display()
            ));
        }
        if file_type.is_dir() {
            collect_mod_source_files(root, &path, output)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let relative_path = mod_source_relative_path(&path, root)?;
        let size = fs::metadata(&path)
            .map_err(|error| format!("Could not read the size of {}: {error}", path.display()))?
            .len();
        if size > MAX_IMPORTED_FILE_BYTES {
            return Err(format!("Mod file is larger than 2 GiB: {relative_path}"));
        }
        output.push(SourceFile {
            absolute_path: path,
            relative_path,
            size,
        });
        if output.len() > MAX_IMPORTED_FILE_COUNT {
            return Err("The selected mod contains too many files.".to_string());
        }
    }
    Ok(())
}

fn mod_destination_path(staging_root: &Path, normalized_path: &str) -> PathBuf {
    let mut destination = staging_root.to_path_buf();
    for segment in normalized_path.split('/') {
        destination.push(segment);
    }
    destination
}

fn copy_mod_directory_to_staging(source_path: &Path, staging_root: &Path) -> Result<(), String> {
    let source_root = fs::canonicalize(source_path)
        .map_err(|error| format!("Could not open the selected mod folder: {error}"))?;
    if !source_root.is_dir() {
        return Err("The selected mod path is not a folder.".to_string());
    }
    let mut source_files = Vec::new();
    collect_mod_source_files(&source_root, &source_root, &mut source_files)?;
    if source_files.is_empty() {
        return Err("The selected mod folder contains no readable files.".to_string());
    }
    let total_bytes = source_files.iter().map(|file| file.size).sum::<u64>();
    if total_bytes > MAX_IMPORTED_BYTES {
        return Err("The selected mod folder is larger than 8 GiB.".to_string());
    }
    let mut seen_paths = HashSet::new();
    for source_file in source_files {
        let normalized_path = normalize_mod_path(&source_file.relative_path)?.ok_or_else(|| {
            format!(
                "Imported file has an empty path: {}",
                source_file.relative_path
            )
        })?;
        if !seen_paths.insert(normalized_path.to_ascii_lowercase()) {
            return Err(format!(
                "Case-insensitive filename collision: {normalized_path}"
            ));
        }
        let destination = mod_destination_path(staging_root, &normalized_path);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create mod folder: {error}"))?;
        }
        fs::copy(&source_file.absolute_path, &destination)
            .map_err(|error| format!("Could not copy {}: {error}", source_file.relative_path))?;
    }
    Ok(())
}

fn extract_mod_archives_to_staging(
    source_paths: &[String],
    staging_root: &Path,
) -> Result<String, String> {
    if source_paths.is_empty() {
        return Err("No mod archive was selected.".to_string());
    }
    let mut imported_paths = HashMap::<String, String>::new();
    let mut extracted_bytes = 0u64;
    let mut extracted_entries = 0usize;
    let mut source_name = None;
    for source_path in source_paths {
        let canonical_path = fs::canonicalize(source_path)
            .map_err(|error| format!("Could not open mod archive {source_path}: {error}"))?;
        if !canonical_path.is_file() {
            return Err(format!(
                "The selected mod archive is not a file: {source_path}"
            ));
        }
        source_name.get_or_insert_with(|| {
            canonical_path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| "imported-mod".to_string())
        });
        let archive_file = File::open(&canonical_path).map_err(|error| {
            format!(
                "Could not read mod archive {}: {error}",
                canonical_path.display()
            )
        })?;
        let mut archive = ZipArchive::new(archive_file)
            .map_err(|error| format!("The selected mod archive is not a valid ZIP: {error}"))?;
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|error| format!("Could not read mod archive entry: {error}"))?;
            let raw_name = entry.name().to_string();
            let Some(normalized_path) = normalize_mod_path(&raw_name)? else {
                continue;
            };
            extracted_entries += 1;
            if extracted_entries > MAX_IMPORTED_FILE_COUNT {
                return Err("The selected archives contain too many files.".to_string());
            }
            if entry.size() > MAX_IMPORTED_FILE_BYTES {
                return Err(format!("Mod archive entry is too large: {raw_name}"));
            }
            let path_key = normalized_path.to_ascii_lowercase();
            if let Some(previous_path) = imported_paths.insert(path_key, normalized_path.clone()) {
                let previous_destination = mod_destination_path(staging_root, &previous_path);
                if previous_destination.exists() {
                    fs::remove_file(&previous_destination).map_err(|error| {
                        format!("Could not replace overlaid mod file {previous_path}: {error}")
                    })?;
                }
            }
            let destination = mod_destination_path(staging_root, &normalized_path);
            if destination.exists() && destination.is_dir() {
                return Err(format!(
                    "A mod archive file conflicts with a folder: {normalized_path}"
                ));
            }
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Could not create mod folder: {error}"))?;
            }
            let mut output = File::create(&destination).map_err(|error| {
                format!("Could not create extracted mod file {normalized_path}: {error}")
            })?;
            let mut entry_bytes = 0u64;
            let mut buffer = [0u8; 1024 * 1024];
            loop {
                let read = entry.read(&mut buffer).map_err(|error| {
                    format!("Could not extract mod archive entry {raw_name}: {error}")
                })?;
                if read == 0 {
                    break;
                }
                entry_bytes += read as u64;
                extracted_bytes += read as u64;
                if entry_bytes > MAX_IMPORTED_FILE_BYTES || extracted_bytes > MAX_IMPORTED_BYTES {
                    return Err(
                        "The selected archives exceed the safe extraction limit.".to_string()
                    );
                }
                output.write_all(&buffer[..read]).map_err(|error| {
                    format!("Could not write extracted mod file {normalized_path}: {error}")
                })?;
            }
            if entry.size() != entry_bytes {
                return Err(format!("Truncated mod archive entry: {raw_name}"));
            }
        }
    }
    if imported_paths.is_empty() {
        return Err("The selected archives contain no usable game files.".to_string());
    }
    Ok(source_name.unwrap_or_else(|| "imported-mod".to_string()))
}

fn collect_staged_mod_files(staging_root: &Path) -> Result<Vec<ManifestFile>, String> {
    let mut source_files = Vec::new();
    collect_mod_source_files(staging_root, staging_root, &mut source_files)?;
    if source_files.is_empty() {
        return Err("The selected mod contains no readable files.".to_string());
    }
    let mut seen_paths = HashSet::new();
    let mut files = Vec::with_capacity(source_files.len());
    let mut total_bytes = 0u64;
    for source_file in source_files {
        let normalized_path = normalize_mod_path(&source_file.relative_path)?.ok_or_else(|| {
            format!(
                "Imported file has an empty path: {}",
                source_file.relative_path
            )
        })?;
        if !seen_paths.insert(normalized_path.to_ascii_lowercase()) {
            return Err(format!(
                "Case-insensitive filename collision: {normalized_path}"
            ));
        }
        total_bytes += source_file.size;
        if total_bytes > MAX_IMPORTED_BYTES {
            return Err("The selected mod exceeds the safe storage limit.".to_string());
        }
        files.push(ManifestFile {
            path: normalized_path,
            size: source_file.size,
        });
    }
    files.sort_by(|left, right| {
        left.path
            .to_ascii_lowercase()
            .cmp(&right.path.to_ascii_lowercase())
    });
    Ok(files)
}

fn import_mod_source_blocking<R: Runtime>(
    app: &AppHandle<R>,
    source_paths: Vec<String>,
    source_kind: &str,
) -> Result<ModImportResult, String> {
    if source_paths.is_empty() {
        return Err("No mod content was selected.".to_string());
    }
    if source_kind == "directory" && source_paths.len() != 1 {
        return Err("Select exactly one mod folder.".to_string());
    }
    if source_kind != "directory" && source_kind != "archives" {
        return Err(format!("Unsupported mod import type: {source_kind}"));
    }
    let import_root = mod_import_root(app)?;
    fs::create_dir_all(&import_root)
        .map_err(|error| format!("Could not create the mod import folder: {error}"))?;
    let token = format!("{}-{}", unique_suffix(), std::process::id());
    let staging_root = import_root.join(format!(".importing-{token}"));
    fs::create_dir_all(&staging_root)
        .map_err(|error| format!("Could not create the mod import staging folder: {error}"))?;
    let result = (|| {
        let source_name = if source_kind == "directory" {
            let source = fs::canonicalize(&source_paths[0])
                .map_err(|error| format!("Could not open the selected mod folder: {error}"))?;
            source
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| "imported-mod".to_string())
        } else {
            extract_mod_archives_to_staging(&source_paths, &staging_root)?
        };
        if source_kind == "directory" {
            copy_mod_directory_to_staging(Path::new(&source_paths[0]), &staging_root)?;
        }
        let files = collect_staged_mod_files(&staging_root)?;
        let destination = import_root.join(&token);
        if destination.exists() {
            fs::remove_dir_all(&destination)
                .map_err(|error| format!("Could not replace the previous mod import: {error}"))?;
        }
        fs::rename(&staging_root, &destination)
            .map_err(|error| format!("Could not commit the mod import: {error}"))?;
        Ok(ModImportResult {
            token,
            source_name,
            files,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging_root);
    }
    result
}

fn source_relative_path(path: &Path, root: &Path) -> Result<String, String> {
    let relative = path.strip_prefix(root).map_err(|_| {
        format!(
            "Selected game file is outside the chosen folder: {}",
            path.display()
        )
    })?;
    let mut segments = Vec::new();
    for component in relative.components() {
        let segment = component.as_os_str().to_string_lossy();
        if segment.is_empty() || segment == "." || segment == ".." || segment.contains('\0') {
            return Err(format!("Unsafe game-resource path: {}", path.display()));
        }
        let normalized_segment = segment.replace('\\', "/");
        if normalized_segment.split('/').any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || part.contains(':')
                || part.len() > MAX_IMPORTED_SEGMENT_LENGTH
        }) {
            return Err(format!("Unsafe game-resource path: {}", path.display()));
        }
        segments.push(normalized_segment);
    }
    if segments.is_empty() || segments.len() > MAX_IMPORTED_PATH_DEPTH {
        return Err(format!("Invalid game-resource path: {}", path.display()));
    }
    Ok(segments.join("/"))
}

fn collect_source_files(
    root: &Path,
    current: &Path,
    output: &mut Vec<SourceFile>,
) -> Result<(), String> {
    let entries = fs::read_dir(current)
        .map_err(|error| format!("Could not read {}: {error}", current.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not inspect game files: {error}"))?;
        let path = entry.path();
        let file_type = fs::symlink_metadata(&path)
            .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?
            .file_type();
        if file_type.is_symlink() {
            return Err(format!(
                "Symbolic links are not supported in the game folder: {}",
                path.display()
            ));
        }
        if file_type.is_dir() {
            collect_source_files(root, &path, output)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let relative_path = source_relative_path(&path, root)?;
        // The export helper writes a manifest for its own use. The native
        // desktop manifest is generated below and must not contain itself.
        if relative_path.eq_ignore_ascii_case("manifest.json") {
            continue;
        }
        let size = fs::metadata(&path)
            .map_err(|error| format!("Could not read the size of {}: {error}", path.display()))?
            .len();
        if size > MAX_IMPORTED_FILE_BYTES {
            return Err(format!("Game file is larger than 2 GiB: {relative_path}"));
        }
        output.push(SourceFile {
            absolute_path: path,
            relative_path,
            size,
        });
        if output.len() > MAX_IMPORTED_FILE_COUNT {
            return Err("The selected game folder contains too many files.".to_string());
        }
    }
    Ok(())
}

fn path_segments(path: &str) -> Vec<&str> {
    path.split('/')
        .filter(|segment| !segment.is_empty())
        .collect()
}

fn normalized_import_path(path: &str, prefix: &[String]) -> String {
    let segments = path_segments(path);
    if prefix.len() <= segments.len()
        && prefix
            .iter()
            .zip(segments.iter())
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
    {
        segments[prefix.len()..].join("/")
    } else {
        path.to_string()
    }
}

fn find_required_file<'a>(files: &'a [SourceFile], name: &str) -> Option<&'a SourceFile> {
    files.iter().find(|file| {
        path_segments(&file.relative_path)
            .last()
            .is_some_and(|leaf| leaf.eq_ignore_ascii_case(name))
    })
}

fn choose_nested_root(files: &[SourceFile]) -> Vec<String> {
    let Some(first) = find_required_file(files, REQUIRED_GAME_FILES[0]) else {
        return Vec::new();
    };
    let first_segments = path_segments(&first.relative_path);
    let first_parent: Vec<String> = first_segments[..first_segments.len().saturating_sub(1)]
        .iter()
        .map(|segment| (*segment).to_string())
        .collect();
    if REQUIRED_GAME_FILES.iter().skip(1).all(|required| {
        find_required_file(files, required).is_some_and(|file| {
            let segments = path_segments(&file.relative_path);
            let parent = &segments[..segments.len().saturating_sub(1)];
            parent.len() == first_parent.len()
                && parent
                    .iter()
                    .zip(first_parent.iter())
                    .all(|(left, right)| left.eq_ignore_ascii_case(right))
        })
    }) {
        first_parent
    } else {
        Vec::new()
    }
}

fn ensure_required_files(files: &[String]) -> Result<(), String> {
    let missing: Vec<&str> = REQUIRED_GAME_FILES
        .iter()
        .copied()
        .filter(|required| !files.iter().any(|path| path.eq_ignore_ascii_case(required)))
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "This is not a complete Red Alert 2 / Yuri's Revenge folder. Missing: {}",
            missing.join(", ")
        ))
    }
}

fn copy_game_directory(
    source_path: &Path,
    destination_root: &Path,
) -> Result<ImportResult, String> {
    let source_root = fs::canonicalize(source_path)
        .map_err(|error| format!("Could not open the selected game folder: {error}"))?;
    if !source_root.is_dir() {
        return Err("The selected game path is not a folder.".to_string());
    }

    let mut source_files = Vec::new();
    collect_source_files(&source_root, &source_root, &mut source_files)?;
    if source_files.is_empty() {
        return Err("The selected game folder contains no readable files.".to_string());
    }
    let total_bytes = source_files.iter().map(|file| file.size).sum::<u64>();
    if total_bytes > MAX_IMPORTED_BYTES {
        return Err("The selected game folder is larger than 8 GiB.".to_string());
    }

    // Match Android's one-level-deep normalization. This accepts both the
    // actual RA2 install folder and a folder such as Downloads/Red Alert 2/
    // Red Alert 2/ containing the same core files.
    let nested_root = choose_nested_root(&source_files);
    let mut normalized_files = Vec::with_capacity(source_files.len());
    let mut seen_paths = HashSet::new();
    for source_file in source_files {
        let normalized_path = normalized_import_path(&source_file.relative_path, &nested_root);
        if normalized_path.is_empty() {
            continue;
        }
        let key = normalized_path.to_ascii_lowercase();
        if !seen_paths.insert(key) {
            return Err(format!("Duplicate game-resource path: {normalized_path}"));
        }
        normalized_files.push((source_file, normalized_path));
    }
    let normalized_paths: Vec<String> = normalized_files
        .iter()
        .map(|(_, path)| path.clone())
        .collect();
    ensure_required_files(&normalized_paths)?;

    let staging_root = destination_root
        .parent()
        .ok_or_else(|| "Could not resolve the app data folder.".to_string())?
        .join(GAME_RES_STAGING_DIR);
    if staging_root.exists() {
        fs::remove_dir_all(&staging_root)
            .map_err(|error| format!("Could not clear the interrupted game import: {error}"))?;
    }
    fs::create_dir_all(&staging_root)
        .map_err(|error| format!("Could not create the game import staging folder: {error}"))?;

    let copy_result = (|| {
        for (source_file, normalized_path) in &normalized_files {
            let destination =
                staging_root.join(normalized_path.replace('/', std::path::MAIN_SEPARATOR_STR));
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Could not create game-resource folder: {error}"))?;
            }
            fs::copy(&source_file.absolute_path, &destination).map_err(|error| {
                format!("Could not copy {}: {error}", source_file.relative_path)
            })?;
        }
        let manifest = GameResourceManifest {
            files: normalized_files
                .iter()
                .map(|(source_file, normalized_path)| ManifestFile {
                    path: normalized_path.clone(),
                    size: source_file.size,
                })
                .collect(),
        };
        let manifest_bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("Could not create the game-resource manifest: {error}"))?;
        fs::write(staging_root.join("manifest.json"), manifest_bytes)
            .map_err(|error| format!("Could not write the game-resource manifest: {error}"))?;
        Ok::<(), String>(())
    })();
    if let Err(error) = copy_result {
        let _ = fs::remove_dir_all(&staging_root);
        return Err(error);
    }

    let backup_root = destination_root
        .parent()
        .ok_or_else(|| "Could not resolve the app data folder.".to_string())?
        .join(format!("{GAME_RES_BACKUP_PREFIX}{}", unique_suffix()));
    if destination_root.exists() {
        fs::rename(destination_root, &backup_root)
            .map_err(|error| format!("Could not stage the previous game import: {error}"))?;
    }
    if let Err(error) = fs::rename(&staging_root, destination_root) {
        if backup_root.exists() {
            let _ = fs::rename(&backup_root, destination_root);
        }
        let _ = fs::remove_dir_all(&staging_root);
        return Err(format!("Could not commit the game import: {error}"));
    }
    if backup_root.exists() {
        let _ = fs::remove_dir_all(&backup_root);
    }

    Ok(ImportResult {
        file_count: normalized_files.len(),
        total_bytes,
    })
}

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

fn recover_game_resource_import<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let destination = game_res_root(app)?;
    let parent = destination
        .parent()
        .ok_or_else(|| "Could not resolve the app data folder.".to_string())?;
    let staging = parent.join(GAME_RES_STAGING_DIR);
    if staging.exists() {
        fs::remove_dir_all(&staging)
            .map_err(|error| format!("Could not clear interrupted game import: {error}"))?;
    }
    if !parent.exists() {
        return Ok(());
    }

    let mut backups: Vec<PathBuf> = fs::read_dir(parent)
        .map_err(|error| format!("Could not inspect the app data folder: {error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(GAME_RES_BACKUP_PREFIX))
                && path.is_dir()
        })
        .collect();
    backups.sort_by_key(|path| {
        fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .unwrap_or(UNIX_EPOCH)
    });
    backups.reverse();

    if !destination.exists() {
        if let Some(recovery_backup) = backups.first() {
            fs::rename(recovery_backup, &destination)
                .map_err(|error| format!("Could not recover the previous game import: {error}"))?;
            log::warn!(
                "Recovered the previous desktop game-resource import after an interrupted commit"
            );
            backups.remove(0);
        }
    }
    for backup in backups {
        if backup.exists() {
            let _ = fs::remove_dir_all(backup);
        }
    }
    Ok(())
}

fn plain_response(status: u16, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("content-type", content_type)
        .header("access-control-allow-origin", "*")
        .header("access-control-allow-methods", "GET, HEAD, OPTIONS")
        .header("cross-origin-resource-policy", "cross-origin")
        .header("cache-control", "no-store")
        .body(body)
        .expect("game-resource response builder should accept static headers")
}

fn mime_type(path: &str) -> &'static str {
    let extension = path
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "json" => "application/json",
        "ini" | "txt" | "csf" => "text/plain; charset=utf-8",
        "png" => "image/png",
        "bik" => "application/octet-stream",
        _ => "application/octet-stream",
    }
}

fn serve_game_resource<R: Runtime>(
    app: &AppHandle<R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if request.method().as_str().eq_ignore_ascii_case("OPTIONS") {
        return plain_response(204, "text/plain", Vec::new());
    }
    let root = match game_res_root(app) {
        Ok(root) => root,
        Err(error) => return plain_response(500, "text/plain; charset=utf-8", error.into_bytes()),
    };
    let encoded_path = request.uri().path().trim_start_matches('/');
    let decoded_path = match percent_decode_str(encoded_path).decode_utf8() {
        Ok(path) => path,
        Err(_) => {
            return plain_response(
                400,
                "text/plain; charset=utf-8",
                b"Invalid resource path".to_vec(),
            )
        }
    };
    let mut relative = PathBuf::new();
    for segment in decoded_path.split('/') {
        if segment.is_empty() {
            continue;
        }
        if segment == "."
            || segment == ".."
            || segment.contains('\\')
            || segment.contains(':')
            || segment.contains('\0')
        {
            return plain_response(403, "text/plain; charset=utf-8", b"Forbidden".to_vec());
        }
        relative.push(segment);
    }
    if relative.as_os_str().is_empty() {
        relative.push("manifest.json");
    }
    let canonical_root = match fs::canonicalize(&root) {
        Ok(root) => root,
        Err(_) => {
            return plain_response(
                404,
                "text/plain; charset=utf-8",
                b"Game resources are not imported".to_vec(),
            )
        }
    };
    let file_path = match fs::canonicalize(root.join(&relative)) {
        Ok(path) if path.starts_with(&canonical_root) && path.is_file() => path,
        _ => {
            return plain_response(
                404,
                "text/plain; charset=utf-8",
                b"Game resource not found".to_vec(),
            )
        }
    };
    match fs::read(&file_path) {
        Ok(bytes) => plain_response(200, mime_type(file_path.to_string_lossy().as_ref()), bytes),
        Err(error) => plain_response(
            500,
            "text/plain; charset=utf-8",
            error.to_string().into_bytes(),
        ),
    }
}

fn serve_mod_resource<R: Runtime>(
    app: &AppHandle<R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if request.method().as_str().eq_ignore_ascii_case("OPTIONS") {
        return plain_response(204, "text/plain", Vec::new());
    }
    let encoded_path = request.uri().path().trim_start_matches('/');
    let decoded_path = match percent_decode_str(encoded_path).decode_utf8() {
        Ok(path) => path,
        Err(_) => {
            return plain_response(
                400,
                "text/plain; charset=utf-8",
                b"Invalid resource path".to_vec(),
            )
        }
    };
    let mut segments = decoded_path
        .split('/')
        .filter(|segment| !segment.is_empty());
    let Some(token) = segments.next() else {
        return plain_response(
            404,
            "text/plain; charset=utf-8",
            b"Mod import not found".to_vec(),
        );
    };
    if !safe_import_token(token) {
        return plain_response(403, "text/plain; charset=utf-8", b"Forbidden".to_vec());
    }
    let mut relative = PathBuf::new();
    for segment in segments {
        if segment == "."
            || segment == ".."
            || segment.contains('\\')
            || segment.contains(':')
            || segment.contains('\0')
        {
            return plain_response(403, "text/plain; charset=utf-8", b"Forbidden".to_vec());
        }
        relative.push(segment);
    }
    if relative.as_os_str().is_empty() {
        return plain_response(
            404,
            "text/plain; charset=utf-8",
            b"Mod file not found".to_vec(),
        );
    }
    let root = match mod_import_root(app) {
        Ok(root) => root,
        Err(error) => return plain_response(500, "text/plain; charset=utf-8", error.into_bytes()),
    };
    let import_root = root.join(token);
    let canonical_root = match fs::canonicalize(&import_root) {
        Ok(root) => root,
        Err(_) => {
            return plain_response(
                404,
                "text/plain; charset=utf-8",
                b"Mod import not found".to_vec(),
            )
        }
    };
    let file_path = match fs::canonicalize(canonical_root.join(&relative)) {
        Ok(path) if path.starts_with(&canonical_root) && path.is_file() => path,
        _ => {
            return plain_response(
                404,
                "text/plain; charset=utf-8",
                b"Mod file not found".to_vec(),
            )
        }
    };
    match fs::read(&file_path) {
        Ok(bytes) => plain_response(200, mime_type(file_path.to_string_lossy().as_ref()), bytes),
        Err(error) => plain_response(
            500,
            "text/plain; charset=utf-8",
            error.to_string().into_bytes(),
        ),
    }
}

fn recover_mod_imports<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let root = mod_import_root(app)?;
    if !root.exists() {
        fs::create_dir_all(&root)
            .map_err(|error| format!("Could not create the mod import folder: {error}"))?;
        return Ok(());
    }
    for entry in fs::read_dir(&root)
        .map_err(|error| format!("Could not inspect the mod import folder: {error}"))?
    {
        let path = entry
            .map_err(|error| format!("Could not inspect a previous mod import: {error}"))?
            .path();
        if path.is_dir() {
            fs::remove_dir_all(&path)
                .map_err(|error| format!("Could not clear a previous mod import: {error}"))?;
        } else if path.is_file() {
            fs::remove_file(&path)
                .map_err(|error| format!("Could not clear a previous mod import file: {error}"))?;
        }
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn import_game_directory(app: AppHandle, source_path: String) -> Result<ImportResult, String> {
    let destination_root = game_res_root(&app)?;
    if let Some(parent) = destination_root.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create the app data folder: {error}"))?;
    }
    log::info!("Importing desktop game resources from {source_path}");
    let result = copy_game_directory(Path::new(&source_path), &destination_root)?;
    log::info!(
        "Imported {} game files ({} bytes) into {}",
        result.file_count,
        result.total_bytes,
        destination_root.display()
    );
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
async fn import_mod_source(
    app: AppHandle,
    source_paths: Vec<String>,
    source_kind: String,
) -> Result<ModImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        import_mod_source_blocking(&app, source_paths, &source_kind)
    })
    .await
    .map_err(|error| format!("Desktop mod import task failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
fn delete_mod_import(app: AppHandle, token: String) -> Result<(), String> {
    if !safe_import_token(&token) {
        return Err("Invalid mod import token".to_string());
    }
    let root = mod_import_root(&app)?;
    let destination = root.join(token);
    if destination.exists() {
        fs::remove_dir_all(&destination)
            .map_err(|error| format!("Could not clean up the desktop mod import: {error}"))?;
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("gameres", |_context, request, responder| {
            let app = _context.app_handle().clone();
            std::thread::spawn(move || responder.respond(serve_game_resource(&app, request)));
        })
        .register_asynchronous_uri_scheme_protocol("modres", |_context, request, responder| {
            let app = _context.app_handle().clone();
            std::thread::spawn(move || responder.respond(serve_mod_resource(&app, request)));
        })
        .invoke_handler(tauri::generate_handler![
            import_game_directory,
            import_mod_source,
            delete_mod_import
        ])
        .setup(|app| {
            if let Ok(root) = game_res_root(app.handle()) {
                if let Some(parent) = root.parent() {
                    fs::create_dir_all(parent)?;
                }
            }
            recover_game_resource_import(app.handle()).map_err(std::io::Error::other)?;
            recover_mod_imports(app.handle()).map_err(std::io::Error::other)?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Open RTS Engine desktop application");
}
