import WebKit
import UniformTypeIdentifiers

/// Serves the built web app (WebDist) and the imported game assets (GameRes)
/// out of the app bundle under the custom scheme `ra2app://app/...`.
///
/// Layout:
///   ra2app://app/<path>            -> Resources/WebDist/<path>
///   ra2app://app/gameres/<path>         -> legacy game-resource path
///   ra2app://app/gameres-bundle/<path>  -> Resources/GameRes/<path>
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "ra2app"

    /// Files larger than this stream in chunks instead of a single didReceive —
    /// a one-shot 280MB payload is a peak-memory spike that can jetsam the web
    /// content process on iPhones during the first-launch seed.
    private static let streamThreshold = 8 * 1024 * 1024
    private static let chunkSize = 4 * 1024 * 1024

    private let webRoot: URL
    private let gameResRoot: URL
    private let ioQueue = DispatchQueue(label: "ra2.scheme.io", qos: .userInitiated)
    /// One-way cancellation flag, one per streaming task. The I/O block holds
    /// the object directly, so cleanup can never "un-cancel" a task ahead of an
    /// already-queued callback, and a recycled task address can never make a
    /// fresh task look pre-cancelled.
    private final class StreamState { var cancelled = false }
    private var streamStates = [ObjectIdentifier: StreamState]()
    private let cancelLock = NSLock()

    override init() {
        let bundle = Bundle.main.resourceURL!
        webRoot = bundle.appendingPathComponent("WebDist", isDirectory: true)
        gameResRoot = bundle.appendingPathComponent("GameRes", isDirectory: true)
        super.init()
    }

    private func register(_ task: WKURLSchemeTask) -> StreamState {
        let state = StreamState()
        cancelLock.lock(); defer { cancelLock.unlock() }
        // Overwrite unconditionally: ObjectIdentifier is the task's address and
        // a previously freed task may have occupied it.
        streamStates[ObjectIdentifier(task)] = state
        return state
    }

    private func unregister(_ task: WKURLSchemeTask, _ state: StreamState) {
        cancelLock.lock(); defer { cancelLock.unlock() }
        if streamStates[ObjectIdentifier(task)] === state {
            streamStates.removeValue(forKey: ObjectIdentifier(task))
        }
    }

    private func isCancelled(_ state: StreamState) -> Bool {
        cancelLock.lock(); defer { cancelLock.unlock() }
        return state.cancelled
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        // Strip query strings vite appends for cache busting (?v=...)
        let relative = String(path.dropFirst())

        // Reject any traversal attempt before touching the filesystem: a
        // request like /gameres/../../Documents/x would otherwise escape the
        // bundle roots and serve arbitrary app-container files.
        if relative.split(separator: "/").contains("..") {
            respond(urlSchemeTask, url: url, status: 403, mime: "text/plain", data: Data("forbidden".utf8))
            return
        }

        let fileURL: URL
        let isNativeMenuVideo = relative.hasPrefix("native-media/ios/menu-video/")
        if isNativeMenuVideo {
            let filename = String(relative.dropFirst("native-media/ios/menu-video/".count))
            guard !filename.isEmpty,
                  !filename.contains("/"),
                  ["ra2ts_l.bik", "ra2ts_l_yr.bik"].contains(where: { $0.caseInsensitiveCompare(filename) == .orderedSame }),
                  let nativeFile = nativeMenuVideoFile(named: filename) else {
                respond(urlSchemeTask, url: url, status: 404, mime: "text/plain", data: Data("native menu video not found".utf8))
                return
            }
            fileURL = nativeFile
        } else if relative == "gameres-bundle" || relative.hasPrefix("gameres-bundle/") {
            let bundledPath = relative == "gameres-bundle"
                ? "manifest.json"
                : String(relative.dropFirst("gameres-bundle/".count))
            // This branch is intentionally bundle-only. It must not be
            // redirected to any future private import directory: the web
            // seed uses it only to detect optional packaged resources.
            fileURL = gameResRoot.appendingPathComponent(bundledPath)
        } else if relative.hasPrefix("gameres/") {
            fileURL = gameResRoot.appendingPathComponent(String(relative.dropFirst("gameres/".count)))
        } else {
            fileURL = webRoot.appendingPathComponent(relative)
        }

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            respond(urlSchemeTask, url: url, status: 404, mime: "text/plain", data: Data("not found: \(relative)".utf8))
            return
        }

        let size = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int) ?? nil
        let mime = mimeType(for: fileURL.pathExtension)

        if isNativeMenuVideo && url.query?.split(separator: "&").contains(where: { $0 == "probe=1" }) == true {
            respond(urlSchemeTask, url: url, status: 200, mime: mime, data: Data())
            return
        }

        if let size, size > Self.streamThreshold {
            streamFile(urlSchemeTask, url: url, fileURL: fileURL, size: size, mime: mime)
            return
        }

        do {
            let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
            respond(urlSchemeTask, url: url, status: 200, mime: mime, data: data)
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // WebKit delivers scheme-handler callbacks on the main thread; the
        // check-then-call inside the streaming main.sync blocks relies on that
        // to be atomic against this method.
        dispatchPrecondition(condition: .onQueue(.main))
        cancelLock.lock()
        // Mark AND unregister: the flag survives on the I/O block's captured
        // reference, so the address is free to be reused by a later task.
        streamStates.removeValue(forKey: ObjectIdentifier(urlSchemeTask))?.cancelled = true
        cancelLock.unlock()
    }

    private func nativeMenuVideoFile(named filename: String) -> URL? {
        let allowed = ["ra2ts_l.bik", "ra2ts_l_yr.bik"]
        guard allowed.contains(where: { $0.caseInsensitiveCompare(filename) == .orderedSame }) else {
            return nil
        }
        let direct = gameResRoot.appendingPathComponent(filename)
        if FileManager.default.fileExists(atPath: direct.path) {
            return direct
        }
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: gameResRoot,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else {
            return nil
        }
        return entries.first(where: { $0.lastPathComponent.caseInsensitiveCompare(filename) == .orderedSame })
    }

    /// Deliver a large file in bounded chunks. WebKit is only ever holding one
    /// chunk of IPC payload at a time instead of the whole archive.
    private func streamFile(_ task: WKURLSchemeTask, url: URL, fileURL: URL, size: Int, mime: String) {
        let headers: [String: String] = [
            "Content-Type": mime,
            "Content-Length": String(size),
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.badServerResponse))
            return
        }
        task.didReceive(response)

        let state = register(task)
        ioQueue.async { [weak self] in
            guard let self else { return }
            defer { self.unregister(task, state) }
            guard let handle = try? FileHandle(forReadingFrom: fileURL) else {
                DispatchQueue.main.sync {
                    if !self.isCancelled(state) { task.didFailWithError(URLError(.cannotOpenFile)) }
                }
                return
            }
            defer { try? handle.close() }
            var delivered = 0
            var stopped = false
            while delivered < size && !stopped {
                if self.isCancelled(state) { return }
                guard let chunk = try? handle.read(upToCount: Self.chunkSize), !chunk.isEmpty else { break }
                delivered += chunk.count
                let done = delivered >= size
                DispatchQueue.main.sync {
                    if self.isCancelled(state) { stopped = true; return }
                    task.didReceive(chunk)
                    if done { task.didFinish() }
                }
            }
            if stopped { return }
            if delivered < size {
                // main.SYNC under the state flag: an async block here outlives
                // the defer'd cleanup, and calling into a task WebKit already
                // stopped raises an uncatchable ObjC exception.
                DispatchQueue.main.sync {
                    if !self.isCancelled(state) { task.didFailWithError(URLError(.cannotLoadFromNetwork)) }
                }
            }
        }
    }

    private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, mime: String, data: Data) {
        let headers: [String: String] = [
            "Content-Type": mime,
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.badServerResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html"
        case "js", "mjs": return "text/javascript"
        case "css": return "text/css"
        case "json": return "application/json"
        case "wasm": return "application/wasm"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "svg": return "image/svg+xml"
        case "ico": return "image/x-icon"
        case "mp3": return "audio/mpeg"
        case "wav": return "audio/wav"
        case "webm": return "video/webm"
        case "mp4": return "video/mp4"
        case "bik": return "application/octet-stream"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "ini", "csf", "mix", "map", "mpr": return "application/octet-stream"
        default:
            if let ut = UTType(filenameExtension: ext), let mime = ut.preferredMIMEType {
                return mime
            }
            return "application/octet-stream"
        }
    }
}
