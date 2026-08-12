package com.ammaar.ra2android

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream

/**
 * Serves the Vite output and the locally prepared game resources from a
 * secure, same-origin URL. A custom client is used instead of file:// so
 * fetch(), WebAssembly, OPFS, and cross-origin isolation all see a normal
 * HTTPS origin. It also lets us add COOP/COEP to the packaged build, which
 * Vite only adds in development.
 */
class Ra2WebViewClient(private val context: Context) : WebViewClient() {
    companion object {
        const val APP_ASSET_HOST = "appassets.androidplatform.net"
        private const val WEB_ROOT = "WebDist"
        private const val GAME_RES_ROOT = "GameRes"
        private const val NATIVE_DOWNLOADS_ROOT = "ra2-mod-downloads"
        private const val NATIVE_MOD_IMPORT_ROOT = "ra2-mod-imports"
    }

    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest,
    ): WebResourceResponse? = serve(request.url)

    @Suppress("DEPRECATION")
    override fun shouldInterceptRequest(view: WebView, url: String): WebResourceResponse? =
        serve(Uri.parse(url))

    private fun serve(uri: Uri): WebResourceResponse? {
        if (uri.scheme != "https" || uri.host != APP_ASSET_HOST) {
            return null
        }

        val requestedPath = (uri.path ?: "/index.html").removePrefix("/")
        val path = requestedPath.ifEmpty { "index.html" }
        if (path.contains('\u0000') || path.split('/').any { it == ".." }) {
            return errorResponse(403, "Forbidden")
        }

        // /gameres/ is the user-import mount. The seed probe must use the
        // packaged-only /gameres-bundle/ mount so an existing import is never
        // walked and copied as though it were bundled content.
        val isBundledGameResource = path == "gameres-bundle" || path.startsWith("gameres-bundle/")
        val isGameResource = path == "gameres" || path.startsWith("gameres/")
        val isNativeDownload = path == "native-downloads" || path.startsWith("native-downloads/")
        val isNativeModImport = path == "native-mod-imports" || path.startsWith("native-mod-imports/")
        if (isNativeDownload) {
            val relativeDownloadPath = path.removePrefix("native-downloads/")
            val segments = relativeDownloadPath.split('/')
            if (segments.size != 1 || !segments[0].matches(Regex("[A-Za-z0-9_-]{8,80}"))) {
                return errorResponse(403, "Forbidden")
            }
            val downloadFile = File(context.cacheDir, "$NATIVE_DOWNLOADS_ROOT/${segments[0]}/archive").canonicalFile
            val downloadRoot = File(context.cacheDir, NATIVE_DOWNLOADS_ROOT).canonicalFile
            if (!downloadFile.path.startsWith(downloadRoot.path + File.separator) || !downloadFile.isFile) {
                return errorResponse(404, "Download not found")
            }
            return WebResourceResponse(
                "application/octet-stream",
                null,
                200,
                "OK",
                mapOf(
                    "Cache-Control" to "no-store",
                    "Cross-Origin-Embedder-Policy" to "require-corp",
                    "Cross-Origin-Opener-Policy" to "same-origin",
                    "Cross-Origin-Resource-Policy" to "same-origin",
                ),
                FileInputStream(downloadFile),
            )
        }
        if (isNativeModImport) {
            val relativeImportPath = path.removePrefix("native-mod-imports/")
            val segments = relativeImportPath.split('/')
            val token = segments.firstOrNull()
            val fileSegments = if (segments.size > 1) segments.drop(1) else emptyList()
            if (token == null ||
                !token.matches(Regex("[A-Za-z0-9_-]{8,80}")) ||
                fileSegments.isEmpty() ||
                fileSegments.any { !isSafeRelativeSegment(it) }) {
                return errorResponse(403, "Forbidden")
            }
            val importRoot = File(context.filesDir, NATIVE_MOD_IMPORT_ROOT).canonicalFile
            val relativeFilePath = fileSegments.joinToString(File.separator)
            val importFile = File(importRoot, "$token/$relativeFilePath").canonicalFile
            if (!importFile.path.startsWith(importRoot.path + File.separator) || !importFile.isFile) {
                return errorResponse(404, "Native mod file not found")
            }
            return WebResourceResponse(
                mimeType(relativeFilePath),
                if (isText(relativeFilePath)) "UTF-8" else null,
                200,
                "OK",
                mapOf(
                    "Cache-Control" to "no-store",
                    "Cross-Origin-Embedder-Policy" to "require-corp",
                    "Cross-Origin-Opener-Policy" to "same-origin",
                    "Cross-Origin-Resource-Policy" to "same-origin",
                ),
                FileInputStream(importFile),
            )
        }
        val relativePath = when {
            isBundledGameResource -> path.removePrefix("gameres-bundle/").ifEmpty { "manifest.json" }
            isGameResource -> path.removePrefix("gameres/").ifEmpty { "manifest.json" }
            else -> path
        }
        val assetPath = "${if (isGameResource || isBundledGameResource) GAME_RES_ROOT else WEB_ROOT}/$relativePath"

        val stream = if (isGameResource) {
            openGameResource(relativePath, assetPath)
        } else {
            openPackagedAsset(assetPath)
        } ?: return errorResponse(404, "Not found: /$path")

        val headers = mapOf(
            "Cache-Control" to "no-cache",
            "Cross-Origin-Embedder-Policy" to "require-corp",
            "Cross-Origin-Opener-Policy" to "same-origin",
            "Cross-Origin-Resource-Policy" to "same-origin",
        )
        return WebResourceResponse(
            mimeType(relativePath),
            if (isText(relativePath)) "UTF-8" else null,
            200,
            "OK",
            headers,
            stream,
        )
    }

    private fun openPackagedAsset(assetPath: String): InputStream? = try {
        context.assets.open(assetPath)
    } catch (_: IOException) {
        null
    }

    /**
     * Prefer files copied into the private app directory so future Play Asset
     * Delivery support does not require a web-layer change. Fall back to
     * packaged assets for local debug builds and simple sideloads.
     */
    private fun openGameResource(relativePath: String, assetPath: String): InputStream? {
        val privateRoot = File(context.filesDir, "gameres").canonicalFile
        val privateFile = File(privateRoot, relativePath).canonicalFile
        if (privateFile.path.startsWith(privateRoot.path + File.separator) && privateFile.isFile) {
            return FileInputStream(privateFile)
        }
        return openPackagedAsset(assetPath)
    }

    private fun errorResponse(status: Int, message: String): WebResourceResponse {
        return WebResourceResponse(
            "text/plain",
            "UTF-8",
            status,
            if (status == 403) "Forbidden" else "Not Found",
            mapOf(
                "Cache-Control" to "no-store",
                "Cross-Origin-Embedder-Policy" to "require-corp",
                "Cross-Origin-Opener-Policy" to "same-origin",
            ),
            ByteArrayInputStream(message.toByteArray(Charsets.UTF_8)),
        )
    }

    private fun isText(path: String): Boolean = when (path.substringAfterLast('.', "").lowercase()) {
        "css", "html", "ini", "js", "json", "map", "svg", "txt", "xml" -> true
        else -> false
    }

    private fun isSafeRelativeSegment(segment: String): Boolean =
        segment.isNotEmpty() &&
            segment != "." &&
            segment != ".." &&
            !segment.contains('\\') &&
            !segment.contains('\u0000') &&
            !segment.contains(':')

    private fun mimeType(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
        "css" -> "text/css"
        "html" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "json" -> "application/json"
        "wasm" -> "application/wasm"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "gif" -> "image/gif"
        "svg" -> "image/svg+xml"
        "ico" -> "image/x-icon"
        "mp3" -> "audio/mpeg"
        "wav" -> "audio/wav"
        "webm" -> "video/webm"
        "mp4" -> "video/mp4"
        "woff" -> "font/woff"
        "woff2" -> "font/woff2"
        else -> "application/octet-stream"
    }
}
