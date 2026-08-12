package com.ammaar.ra2android

import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Log
import android.view.View
import android.view.Window
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.BufferedInputStream
import java.io.FileOutputStream
import java.io.FileInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URL
import java.util.Locale
import java.util.UUID
import java.util.zip.ZipInputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : Activity() {
    companion object {
        private const val TAG = "RA2"
        private const val APP_URL_BASE =
            "https://${Ra2WebViewClient.APP_ASSET_HOST}/index.html?shell=1&platform=android&menuVideoRoot=%2Fnative-media%2Fandroid%2Fmenu-video"
        private const val APP_URL = APP_URL_BASE
        private const val WEBVIEW_STATE_KEY = "ra2.webview.state"
        private const val MAX_RENDERER_RECOVERIES = 3
        private const val RECOVERY_WINDOW_MS = 5 * 60 * 1000L
        private const val FILE_CHOOSER_REQUEST = 4102
        private const val GAME_DIRECTORY_REQUEST = 4103
        private const val MOD_DIRECTORY_REQUEST = 4104
        private const val MOD_ARCHIVE_REQUEST = 4105
        private const val NATIVE_DOWNLOAD_MAX_BYTES = 1024L * 1024L * 1024L
        private const val MAX_IMPORTED_FILE_COUNT = 100_000
        private const val MAX_IMPORTED_BYTES = 8L * 1024L * 1024L * 1024L
        private const val MAX_IMPORTED_FILE_BYTES = 2L * 1024L * 1024L * 1024L
        private const val MAX_IMPORTED_PATH_DEPTH = 64
        private const val MAX_IMPORTED_SEGMENT_LENGTH = 255
        private const val NATIVE_DOWNLOAD_DIR = "ra2-mod-downloads"
        private const val NATIVE_MOD_IMPORT_DIR = "ra2-mod-imports"
        private const val GAME_RES_DIR = "gameres"
        private const val GAME_RES_BACKUP_PREFIX = ".gameres-previous-"
        private val REQUIRED_RA2_GAME_FILES = listOf(
            "language.mix",
            "multi.mix",
            "ra2.mix",
        )
        // The shell only confirms that a usable RA2-family installation was
        // selected. YR and mod-specific requirements are resolved by the
        // shared TypeScript content registry after Menu -> Mods selection.
        private fun requiredGameFiles(): List<String> = REQUIRED_RA2_GAME_FILES

        private fun gameDisplayName(): String = "Red Alert 2 / Yuri's Revenge"
    }

    private lateinit var webView: WebView
    private var rendererRecoveryCount = 0
    private var lastRendererCrashAt = 0L
    private var thermalListener: PowerManager.OnThermalStatusChangedListener? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    @Volatile private var modArchivePickerActive = false
    private val importExecutor = Executors.newSingleThreadExecutor()
    private val downloadExecutor = Executors.newCachedThreadPool()
    private val nativeDownloads = ConcurrentHashMap<String, NativeDownloadJob>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        recoverGameResourceImport()
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        registerPowerState()
        loadApp(restoredState = savedInstanceState?.getBundle(WEBVIEW_STATE_KEY))
    }

    private fun loadApp(crashRecovery: Int? = null, restoredState: Bundle? = null) {
        webView = createWebView()
        setContentView(webView)
        hideSystemUi()
        val url = if (crashRecovery == null) APP_URL else "$APP_URL&crashRecovery=$crashRecovery"
        if (restoredState != null) {
            val restoredHistory = try {
                webView.restoreState(restoredState)
            }
            catch (error: Exception) {
                Log.w(TAG, "Could not restore the WebView session; starting the shell URL", error)
                null
            }
            if (restoredHistory == null) {
                webView.loadUrl(url)
            }
        }
        else {
            webView.loadUrl(url)
        }
    }

    private fun createWebView(): WebView {
        return WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                @Suppress("DEPRECATION")
                allowFileAccessFromFileURLs = false
                @Suppress("DEPRECATION")
                allowUniversalAccessFromFileURLs = false
                mediaPlaybackRequiresUserGesture = false
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                textZoom = 100
                cacheMode = WebSettings.LOAD_DEFAULT
            }
            webViewClient = object : WebViewClient() {
                private val delegate = Ra2WebViewClient(this@MainActivity)

                private fun handleMainFrameNavigation(uri: Uri): Boolean {
                    val isTrustedAppUrl = uri.scheme.equals("https", ignoreCase = true) &&
                        uri.host.equals(Ra2WebViewClient.APP_ASSET_HOST, ignoreCase = true)
                    val isSafeBlankUrl = uri.scheme.equals("about", ignoreCase = true) &&
                        uri.path.equals("blank", ignoreCase = true)
                    if (isTrustedAppUrl || isSafeBlankUrl) return false
                    return try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                        true
                    } catch (error: Exception) {
                        Log.w(TAG, "Blocked unsupported WebView navigation: $uri", error)
                        true
                    }
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: android.webkit.WebResourceRequest,
                ): Boolean {
                    if (!request.isForMainFrame) return false
                    return handleMainFrameNavigation(request.url)
                }

                @Suppress("DEPRECATION")
                override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                    return handleMainFrameNavigation(Uri.parse(url))
                }

                override fun shouldInterceptRequest(
                    view: WebView,
                    request: android.webkit.WebResourceRequest,
                ) = delegate.shouldInterceptRequest(view, request)

                @Suppress("DEPRECATION")
                override fun shouldInterceptRequest(view: WebView, url: String) =
                    delegate.shouldInterceptRequest(view, url)

                override fun onRenderProcessGone(
                    view: WebView,
                    detail: RenderProcessGoneDetail,
                ): Boolean {
                    handleRendererGone(view, detail)
                    return true
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?,
                ): Boolean {
                    this@MainActivity.filePathCallback?.onReceiveValue(null)
                    this@MainActivity.filePathCallback = filePathCallback
                    val chooserIntent = try {
                        fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }
                    } catch (error: Exception) {
                        Log.e(TAG, "Unable to create Android file chooser intent", error)
                        this@MainActivity.filePathCallback = null
                        return false
                    }
                    return try {
                        startActivityForResult(chooserIntent, FILE_CHOOSER_REQUEST)
                        true
                    } catch (error: Exception) {
                        Log.e(TAG, "Unable to launch Android file chooser", error)
                        this@MainActivity.filePathCallback?.onReceiveValue(null)
                        this@MainActivity.filePathCallback = null
                        false
                    }
                }
            }
            addJavascriptInterface(AndroidBridge(), "Ra2Android")
        }
    }

    /** Native folder selection is required because Android maps a webkitdirectory
     * input to file selection, not to a Storage Access Framework tree URI. */
    inner class AndroidBridge {
        @JavascriptInterface
        fun platformReady(): Boolean {
            runOnUiThread {
                val powerManager = getSystemService(PowerManager::class.java)
                if (powerManager != null) pushPowerState(powerManager)
            }
            return true
        }

        @JavascriptInterface
        fun pickGameDirectory(): Boolean {
            runOnUiThread { launchGameDirectoryPicker() }
            return true
        }

        /**
         * Opens Android's folder picker for an already extracted mod. This is
         * the normal Android path because it avoids making the user re-pack a
         * Windows installation just to import it.
         */
        @JavascriptInterface
        fun pickModDirectory(): Boolean {
            if (modArchivePickerActive) return false
            modArchivePickerActive = true
            runOnUiThread { launchModDirectoryPicker() }
            return true
        }

        /**
         * Opens Android's archive picker. Multiple selections are supported so
         * a full mod package and its patch can be overlaid in one import.
         */
        @JavascriptInterface
        fun pickModArchives(): Boolean {
            if (modArchivePickerActive) return false
            modArchivePickerActive = true
            runOnUiThread { launchModArchivePicker() }
            return true
        }

        @JavascriptInterface
        fun deleteNativeModImport(token: String): Boolean {
            if (!isSafeDownloadToken(token)) return false
            return File(filesDir, "$NATIVE_MOD_IMPORT_DIR/$token").deleteRecursively()
        }

        /**
         * Fetches a community mod outside WebView's CORS sandbox. The result
         * is exposed back to the page as a short-lived same-origin URL; the
         * archive bytes never pass through a base64 JavaScript string.
         */
        @JavascriptInterface
        fun startModDownload(url: String, requestId: String): Boolean {
            if (!isAllowedDownloadUrl(url) || requestId.isBlank()) {
                return false
            }
            if (nativeDownloads.containsKey(requestId)) {
                return false
            }
            val job = NativeDownloadJob(requestId)
            nativeDownloads[requestId] = job
            downloadExecutor.execute {
                runNativeModDownload(url, job)
            }
            return true
        }

        @JavascriptInterface
        fun cancelModDownload(requestId: String): Boolean {
            val job = nativeDownloads[requestId] ?: return false
            job.cancelled.set(true)
            job.connection?.disconnect()
            return true
        }

        @JavascriptInterface
        fun deleteModDownload(token: String): Boolean {
            if (!isSafeDownloadToken(token)) return false
            return downloadDirectory(token).deleteRecursively()
        }

    }

    private class NativeDownloadJob(val requestId: String) {
        val cancelled = AtomicBoolean(false)
        @Volatile var connection: HttpURLConnection? = null
        @Volatile var token: String? = null
        @Volatile var lastProgressAt: Long = 0L
        @Volatile var lastProgressBytes: Long = 0L
    }

    private fun isAllowedDownloadUrl(urlString: String): Boolean {
        return try {
            val uri = Uri.parse(urlString)
            uri.scheme.equals("https", ignoreCase = true) &&
                !uri.host.isNullOrBlank() &&
                !isPrivateDownloadHost(uri.host!!)
        } catch (_: Exception) {
            false
        }
    }

    private fun isPrivateDownloadHost(rawHost: String): Boolean {
        val host = rawHost.trim().trimEnd('.').lowercase()
        if (host == "localhost" || host.endsWith(".localhost") || host == "broadcasthost") {
            return true
        }
        return try {
            InetAddress.getAllByName(host).any { address ->
                val firstByte = address.address.firstOrNull()?.toInt()?.and(0xff)
                address.isAnyLocalAddress ||
                    address.isLoopbackAddress ||
                    address.isLinkLocalAddress ||
                    address.isSiteLocalAddress ||
                    address.isMulticastAddress ||
                    firstByte == 252 || firstByte == 253
            }
        } catch (_: Exception) {
            // An unresolved public hostname can still be fetched; the HTTPS
            // connection will fail normally if DNS or TLS cannot resolve it.
            false
        }
    }

    private fun isSafeDownloadToken(token: String): Boolean =
        token.matches(Regex("[A-Za-z0-9_-]{8,80}"))

    private fun downloadRoot(): File = File(cacheDir, NATIVE_DOWNLOAD_DIR)

    private fun downloadDirectory(token: String): File = File(downloadRoot(), token)

    private fun runNativeModDownload(urlString: String, job: NativeDownloadJob) {
        var target: File? = null
        try {
            val token = UUID.randomUUID().toString().replace("-", "")
            job.token = token
            val directory = downloadDirectory(token)
            if (!directory.mkdirs() && !directory.isDirectory) {
                throw IOException("Could not create the temporary mod download directory")
            }
            target = File(directory, "archive")
            downloadHttpUrl(urlString, target, job)
            if (job.cancelled.get()) throw CancellationException("Download cancelled")
            notifyNativeModDownload(
                job.requestId,
                JSONObject()
                    .put("success", true)
                    .put("token", token)
                    .put("url", "https://${Ra2WebViewClient.APP_ASSET_HOST}/native-downloads/$token")
                    .put("size", target.length()),
            )
        } catch (error: CancellationException) {
            target?.parentFile?.deleteRecursively()
            notifyNativeModDownload(job.requestId, JSONObject().put("success", false).put("cancelled", true))
        } catch (error: Exception) {
            target?.parentFile?.deleteRecursively()
            Log.e(TAG, "Native mod download failed: $urlString", error)
            notifyNativeModDownload(
                job.requestId,
                JSONObject()
                    .put("success", false)
                    .put("error", error.message ?: "Mod download failed"),
            )
        } finally {
            nativeDownloads.remove(job.requestId)
        }
    }

    private fun downloadHttpUrl(urlString: String, target: File, job: NativeDownloadJob) {
        var currentUrl = URL(urlString)
        var connection: HttpURLConnection? = null
        try {
            repeat(6) { redirectAttempt ->
                if (job.cancelled.get()) throw CancellationException("Download cancelled")
                connection = (currentUrl.openConnection() as HttpURLConnection).apply {
                    instanceFollowRedirects = false
                    connectTimeout = 20_000
                    readTimeout = 45_000
                    requestMethod = "GET"
                    setRequestProperty("User-Agent", "RedAlert2-Android/0.1")
                    setRequestProperty("Accept", "application/octet-stream,*/*")
                }
                job.connection = connection
                val responseCode = connection!!.responseCode
                if (responseCode in 300..399) {
                    val location = connection!!.getHeaderField("Location")
                        ?: throw IOException("Download redirect did not include a Location header")
                    val redirectUrl = URL(currentUrl, location)
                    if (!isAllowedDownloadUrl(redirectUrl.toString())) {
                        throw IOException("Download redirect was not an allowed HTTPS public URL")
                    }
                    currentUrl = redirectUrl
                    connection?.disconnect()
                    connection = null
                    if (redirectAttempt == 5) throw IOException("Too many download redirects")
                    return@repeat
                }
                if (responseCode !in 200..299) {
                    throw IOException("Download failed with HTTP $responseCode")
                }
                val expectedSize = connection!!.contentLengthLong
                if (expectedSize > NATIVE_DOWNLOAD_MAX_BYTES) {
                    throw IOException("Mod download is larger than the 1 GB safety limit")
                }
                val parent = target.parentFile
                if (parent != null && !parent.isDirectory && !parent.mkdirs()) {
                    throw IOException("Could not create the mod download directory")
                }
                connection!!.inputStream.use { input ->
                    FileOutputStream(target).use { output ->
                        val buffer = ByteArray(1024 * 1024)
                        var downloaded = 0L
                        while (true) {
                            if (job.cancelled.get()) throw CancellationException("Download cancelled")
                            val count = input.read(buffer)
                            if (count < 0) break
                            if (count == 0) continue
                            downloaded += count
                            if (downloaded > NATIVE_DOWNLOAD_MAX_BYTES) {
                                throw IOException("Mod download is larger than the 1 GB safety limit")
                            }
                            output.write(buffer, 0, count)
                            notifyNativeModProgress(job, downloaded, expectedSize)
                        }
                        output.fd.sync()
                        if (expectedSize >= 0 && downloaded != expectedSize) {
                            throw IOException("Mod download ended early ($downloaded/$expectedSize bytes)")
                        }
                    }
                }
                return
            }
        } finally {
            job.connection = null
            connection?.disconnect()
        }
    }

    private fun notifyNativeModProgress(job: NativeDownloadJob, loaded: Long, total: Long) {
        val now = System.currentTimeMillis()
        if (loaded != total && now - job.lastProgressAt < 100L && loaded - job.lastProgressBytes < 256 * 1024L) {
            return
        }
        job.lastProgressAt = now
        job.lastProgressBytes = loaded
        notifyNativeModDownload(
            job.requestId,
            JSONObject()
                .put("event", "progress")
                .put("progress", loaded)
                .put("total", total.coerceAtLeast(0)),
        )
    }

    private fun notifyNativeModDownload(requestId: String, result: JSONObject) {
        if (!::webView.isInitialized) return
        val script = "window.__RA2_NATIVE_MOD_DOWNLOAD_CALLBACK__ && " +
            "window.__RA2_NATIVE_MOD_DOWNLOAD_CALLBACK__(${JSONObject.quote(requestId)},$result);"
        webView.post { webView.evaluateJavascript(script, null) }
    }

    private fun launchGameDirectoryPicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION
                    or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                    or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
            )
            // Do not force an initial URI here. Some Android DocumentsUI
            // builds close ACTION_OPEN_DOCUMENT_TREE immediately when the
            // requested provider location is unavailable, leaving the WebView
            // looking like the picker never opened. The user can still open
            // Download from the standard picker navigation.
        }
        try {
            startActivityForResult(intent, GAME_DIRECTORY_REQUEST)
        }
        catch (error: Exception) {
            Log.e(TAG, "Unable to launch Android folder picker", error)
            notifyGameDirectoryResult(false, error.message ?: "Folder picker unavailable")
        }
    }

    private fun launchModArchivePicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/zip", "application/octet-stream"))
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                putExtra(
                    DocumentsContract.EXTRA_INITIAL_URI,
                    Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADownload"),
                )
            }
        }
        try {
            startActivityForResult(intent, MOD_ARCHIVE_REQUEST)
        }
        catch (error: Exception) {
            modArchivePickerActive = false
            Log.e(TAG, "Unable to launch mod archive picker", error)
            notifyNativeModImport(false, error.message ?: "Archive picker unavailable")
        }
    }

    private fun launchModDirectoryPicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION
                    or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                    or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
            )
        }
        try {
            startActivityForResult(intent, MOD_DIRECTORY_REQUEST)
        }
        catch (error: Exception) {
            modArchivePickerActive = false
            Log.e(TAG, "Unable to launch Android mod folder picker", error)
            notifyNativeModImport(false, error.message ?: "Mod folder picker unavailable")
        }
    }

    private data class ImportedFile(val path: String, val size: Long)

    private fun importModArchives(uris: List<Uri>) {
        importExecutor.execute {
            val token = UUID.randomUUID().toString().replace("-", "")
            val staging = File(filesDir, ".mod-importing-$token")
            try {
                if (!staging.mkdirs() && !staging.isDirectory) {
                    throw IOException("Could not create the mod import directory")
                }
                val orderedUris = uris.sortedBy { queryDisplayName(it).lowercase() }
                val importedPaths = mutableMapOf<String, String>()
                var extractedBytes = 0L
                var entryCount = 0
                for (uri in orderedUris) {
                    val displayName = queryDisplayName(uri)
                    Log.i(TAG, "Extracting mod archive $displayName")
                    val archivePaths = mutableMapOf<String, String>()
                    val input = contentResolver.openInputStream(uri)
                        ?: throw IOException("Could not open selected archive $displayName")
                    input.use { source ->
                        ZipInputStream(BufferedInputStream(source, 1024 * 1024)).use { archive ->
                            val buffer = ByteArray(1024 * 1024)
                            while (true) {
                                val entry = archive.nextEntry ?: break
                                entryCount++
                                if (entryCount > MAX_IMPORTED_FILE_COUNT) {
                                    throw IOException("The selected archives contain too many entries")
                                }
                                val outputName = normalizeArchivePath(entry.name) ?: continue
                                if (entry.size > MAX_IMPORTED_FILE_BYTES) {
                                    throw IOException("Mod archive entry is too large: ${entry.name}")
                                }
                                val destination = File(staging, outputName).canonicalFile
                                val root = staging.canonicalFile
                                if (!destination.path.startsWith(root.path + File.separator)) {
                                    throw IOException("Unsafe mod archive path: ${entry.name}")
                                }
                                val pathKey = outputName.lowercase(Locale.ROOT)
                                if (archivePaths.putIfAbsent(pathKey, outputName) != null) {
                                    throw IOException("Duplicate case-insensitive path in archive: $outputName")
                                }
                                importedPaths[pathKey]?.let { previousPath ->
                                    // Multiple selected archives are an
                                    // intentional overlay. Replace the prior
                                    // file at the same Windows-style path,
                                    // including case-only name differences.
                                    File(staging, previousPath).delete()
                                }
                                importedPaths[pathKey] = outputName
                                destination.parentFile?.mkdirs()
                                var entryBytes = 0L
                                FileOutputStream(destination).use { output ->
                                    while (true) {
                                        val count = archive.read(buffer)
                                        if (count < 0) break
                                        if (count > 0) {
                                            entryBytes += count
                                            extractedBytes += count
                                            if (entryBytes > MAX_IMPORTED_FILE_BYTES || extractedBytes > MAX_IMPORTED_BYTES) {
                                                throw IOException("The selected archives exceed the safe extraction limit")
                                            }
                                            output.write(buffer, 0, count)
                                        }
                                    }
                                }
                                if (entry.size >= 0 && entryBytes != entry.size) {
                                    throw IOException("Truncated mod archive entry: ${entry.name}")
                                }
                                archive.closeEntry()
                            }
                        }
                    }
                }
                val files = collectImportedFiles(staging)
                    .filter { !it.path.equals("manifest.json", ignoreCase = true) }
                    .sortedBy { it.path.lowercase() }
                if (files.isEmpty()) {
                    throw IOException("The selected archives contain no usable game files")
                }
                validateImportedPaths(files)
                validateImportedFileLimits(files)
                val manifestFiles = JSONArray()
                files.forEach { file ->
                    manifestFiles.put(
                        JSONObject()
                            .put("path", file.path)
                            .put("size", file.size),
                    )
                }
                File(staging, "manifest.json").writeText(
                    JSONObject()
                        .put("files", manifestFiles)
                        .put("sourceName", queryDisplayName(orderedUris.firstOrNull() ?: uris.first()))
                        .toString(),
                    Charsets.UTF_8,
                )
                val destination = File(filesDir, "$NATIVE_MOD_IMPORT_DIR/$token")
                destination.parentFile?.mkdirs()
                if (destination.exists() && !destination.deleteRecursively()) {
                    throw IOException("Could not replace the previous native mod import")
                }
                if (!staging.renameTo(destination)) {
                    throw IOException("Could not commit the native mod import")
                }
                notifyNativeModImport(true, token = token)
            }
            catch (error: Exception) {
                staging.deleteRecursively()
                Log.e(TAG, "Mod archive import failed", error)
                notifyNativeModImport(false, error.message ?: "Could not import the selected mod archives")
            }
            finally {
                modArchivePickerActive = false
            }
        }
    }

    /** Copies an extracted mod folder into the native staging area while
     * preserving its complete relative path tree. */
    private fun importModDirectory(treeUri: Uri) {
        importExecutor.execute {
            val token = UUID.randomUUID().toString().replace("-", "")
            val staging = File(filesDir, ".mod-importing-$token")
            try {
                if (!staging.mkdirs() && !staging.isDirectory) {
                    throw IOException("Could not create the mod import directory")
                }
                val files = mutableListOf<ImportedFile>()
                val rootDocumentId = DocumentsContract.getTreeDocumentId(treeUri)
                copyTree(treeUri, rootDocumentId, staging, "", files)
                if (files.isEmpty()) {
                    throw IOException("The selected mod folder contains no readable files")
                }
                validateImportedPaths(files)
                validateImportedFileLimits(files)
                val manifestFiles = JSONArray()
                files.sortedBy { it.path.lowercase() }.forEach { file ->
                    manifestFiles.put(
                        JSONObject()
                            .put("path", file.path)
                            .put("size", file.size),
                    )
                }
                File(staging, "manifest.json").writeText(
                    JSONObject()
                        .put("files", manifestFiles)
                        .put("sourceName", queryTreeDisplayName(treeUri))
                        .toString(),
                    Charsets.UTF_8,
                )
                val destination = File(filesDir, "$NATIVE_MOD_IMPORT_DIR/$token")
                destination.parentFile?.mkdirs()
                if (destination.exists() && !destination.deleteRecursively()) {
                    throw IOException("Could not replace the previous native mod import")
                }
                if (!staging.renameTo(destination)) {
                    throw IOException("Could not commit the native mod import")
                }
                notifyNativeModImport(true, token = token)
            }
            catch (error: Exception) {
                staging.deleteRecursively()
                Log.e(TAG, "Game-resource mod folder import failed", error)
                notifyNativeModImport(false, error.message ?: "Could not import the selected mod folder")
            }
            finally {
                modArchivePickerActive = false
            }
        }
    }

    /** Normalize an archive path without ever allowing it to escape staging. */
    private fun normalizeArchivePath(rawName: String): String? {
        val replaced = rawName.replace('\\', '/')
        if (replaced.isEmpty() || replaced.endsWith('/')) return null
        if (replaced.startsWith('/') || Regex("^[A-Za-z]:([/]|$)").containsMatchIn(replaced)) {
            throw IOException("Unsafe mod archive path: $rawName")
        }
        val segments = replaced.split('/')
        val normalized = mutableListOf<String>()
        for (segment in segments) {
            when {
                segment.isEmpty() || segment == "." -> continue
                segment == ".." || segment.contains('\u0000') || segment.contains(':') ||
                    segment.length > MAX_IMPORTED_SEGMENT_LENGTH ->
                    throw IOException("Unsafe mod archive path: $rawName")
                else -> normalized += segment
            }
        }
        return normalized.takeIf { it.isNotEmpty() }?.joinToString("/")
    }

    private fun safePathSegment(rawName: String): String {
        if (rawName.isEmpty() || rawName == "." || rawName == ".." ||
            rawName.contains('/') || rawName.contains('\\') || rawName.contains('\u0000') ||
            rawName.contains(':') || rawName.length > MAX_IMPORTED_SEGMENT_LENGTH) {
            throw IOException("Unsafe imported filename: $rawName")
        }
        return rawName
    }

    private fun collectImportedFiles(root: File, relativeDirectory: String = ""): List<ImportedFile> {
        val result = mutableListOf<ImportedFile>()
        root.listFiles()?.sortedBy { it.name.lowercase() }?.forEach { child ->
            val relativePath = if (relativeDirectory.isEmpty()) child.name else "$relativeDirectory/${child.name}"
            if (child.isDirectory) {
                result += collectImportedFiles(child, relativePath)
            } else if (child.isFile) {
                result += ImportedFile(relativePath, child.length())
            }
        }
        return result
    }

    private fun validateImportedPaths(files: Collection<ImportedFile>) {
        val paths = mutableMapOf<String, String>()
        for (file in files) {
            val normalized = normalizeArchivePath(file.path)
                ?: throw IOException("Imported file has an empty path")
            if (normalized.count { it == '/' } + 1 > MAX_IMPORTED_PATH_DEPTH) {
                throw IOException("Imported path is too deeply nested: ${file.path}")
            }
            val key = normalized.lowercase(Locale.ROOT)
            val previous = paths.putIfAbsent(key, normalized)
            if (previous != null && previous != normalized) {
                throw IOException("Case-insensitive filename collision: $previous and $normalized")
            }
        }
    }

    private fun validateImportedFileLimits(files: Collection<ImportedFile>) {
        if (files.size > MAX_IMPORTED_FILE_COUNT) {
            throw IOException("The selected mod contains too many files")
        }
        var totalBytes = 0L
        for (file in files) {
            if (file.size > MAX_IMPORTED_FILE_BYTES) {
                throw IOException("Imported file is too large: ${file.path}")
            }
            totalBytes += file.size
            if (totalBytes > MAX_IMPORTED_BYTES) {
                throw IOException("The selected mod exceeds the safe storage limit")
            }
        }
    }

    private fun queryDisplayName(uri: Uri): String {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) return cursor.getString(index) ?: uri.toString()
            }
        }
        return uri.toString()
    }

    private fun queryTreeDisplayName(uri: Uri): String {
        return try {
            DocumentsContract.getTreeDocumentId(uri)
                .substringAfterLast(':')
                .substringAfterLast('/')
                .ifBlank { "imported-mod" }
        }
        catch (_: Exception) {
            "imported-mod"
        }
    }

    private fun importGameDirectory(treeUri: Uri) {
        importExecutor.execute {
            val staging = File(filesDir, ".gameres-importing")
            try {
                if (staging.exists() && !staging.deleteRecursively()) {
                    throw IOException("Could not clear the previous game-resource import")
                }
                if (!staging.mkdirs() && !staging.isDirectory) {
                    throw IOException("Could not create the game-resource import directory")
                }
                val files = mutableListOf<ImportedFile>()
                val rootDocumentId = DocumentsContract.getTreeDocumentId(treeUri)
                copyTree(treeUri, rootDocumentId, staging, "", files)
                if (files.isEmpty()) {
                    throw IOException("The selected folder does not contain any readable files")
                }
                normalizeGameRoot(staging, files)
                validateImportedPaths(files)
                val requiredFiles = requiredGameFiles()
                val missing = requiredFiles.filterNot { required ->
                    files.any { it.path.equals(required, ignoreCase = true) }
                }
                if (missing.isNotEmpty()) {
                    throw IOException("This is not a complete ${gameDisplayName()} folder. Missing: ${missing.joinToString()}")
                }
                val manifestFiles = JSONArray()
                files.sortedBy { it.path }.forEach { file ->
                    manifestFiles.put(
                        JSONObject()
                            .put("path", file.path)
                            .put("size", file.size),
                    )
                }
                File(staging, "manifest.json").writeText(
                    JSONObject().put("files", manifestFiles).toString(1),
                    Charsets.UTF_8,
                )

                commitGameResourceImport(staging)
                notifyGameDirectoryResult(true)
            }
            catch (error: Exception) {
                staging.deleteRecursively()
                Log.e(TAG, "Game-resource folder import failed", error)
                notifyGameDirectoryResult(false, error.message ?: "Could not import the selected folder")
            }
        }
    }

    /**
     * Commit a complete game import without deleting the active installation
     * first. Both directories live under filesDir, so these renames are the
     * closest available atomic commit on Android's private filesystem.
     */
    private fun commitGameResourceImport(staging: File) {
        val destination = File(filesDir, GAME_RES_DIR)
        val backup = File(filesDir, "$GAME_RES_BACKUP_PREFIX${UUID.randomUUID()}")
        if (destination.exists() && !destination.renameTo(backup)) {
            throw IOException("Could not stage the previous game-resource import")
        }
        if (!staging.renameTo(destination)) {
            if (backup.exists() && !backup.renameTo(destination)) {
                Log.e(TAG, "Could not restore the previous game-resource import after commit failure")
            }
            throw IOException("Could not commit the game-resource import")
        }
        if (backup.exists() && !backup.deleteRecursively()) {
            Log.w(TAG, "Could not remove the previous game-resource backup")
        }
    }

    /** Recover a commit interrupted after the old directory was renamed. */
    private fun recoverGameResourceImport() {
        val destination = File(filesDir, GAME_RES_DIR)
        val backups = filesDir.listFiles()
            ?.filter { it.name.startsWith(GAME_RES_BACKUP_PREFIX) && it.isDirectory }
            ?.sortedByDescending { it.lastModified() }
            ?: return
        if (!destination.exists() && backups.isNotEmpty()) {
            if (backups.first().renameTo(destination)) {
                Log.w(TAG, "Recovered the previous game-resource import after an interrupted commit")
            }
            backups.drop(1).forEach { backup ->
                if (backup.exists() && !backup.deleteRecursively()) {
                    Log.w(TAG, "Could not remove stale game-resource backup ${backup.name}")
                }
            }
            return
        }
        backups.forEach { backup ->
            if (backup.exists() && !backup.deleteRecursively()) {
                Log.w(TAG, "Could not remove stale game-resource backup ${backup.name}")
            }
        }
    }

    /**
     * Windows game folders are sometimes copied one level too deep (for
     * example Download/Red Alert 2/Red Alert 2/ with the mix files). If all
     * core archives are in one nested directory, move that directory's
     * contents to the imported root so the web VFS sees the same layout as the
     * desktop game. Other directories remain untouched.
     */
    private fun normalizeGameRoot(destinationRoot: File, files: MutableList<ImportedFile>) {
        val requiredNames = requiredGameFiles()
            .map { it.lowercase() }
            .toSet()
        val rootHasAll = requiredNames.all { required ->
            files.any { it.path.indexOf('/') < 0 && it.path.lowercase() == required }
        }
        if (rootHasAll) return

        val candidateCounts = mutableMapOf<String, Int>()
        files.forEach { imported ->
            val name = imported.path.substringAfterLast('/').lowercase()
            if (name !in requiredNames) return@forEach
            val parent = imported.path.substringBeforeLast('/', "")
            if (parent.isNotEmpty()) {
                candidateCounts[parent] = (candidateCounts[parent] ?: 0) + 1
            }
        }
        val candidate = candidateCounts.maxByOrNull { it.value }
            ?.takeIf { it.value >= 3 }
            ?.key
            ?: return
        val prefix = "$candidate/"
        val nestedFiles = files.filter { it.path.startsWith(prefix) }
        for (imported in nestedFiles) {
            val source = File(destinationRoot, imported.path)
            val flattenedPath = imported.path.removePrefix(prefix)
            val target = File(destinationRoot, flattenedPath)
            if (target.exists()) {
                throw IOException("Duplicate file while flattening imported game folder: $flattenedPath")
            }
            target.parentFile?.mkdirs()
            if (!source.renameTo(target)) {
                source.copyTo(target, overwrite = false)
                if (!source.delete()) {
                    throw IOException("Could not flatten imported game file: ${imported.path}")
                }
            }
        }
        File(destinationRoot, candidate).deleteRecursively()
        files.replaceAll { imported ->
            if (imported.path.startsWith(prefix)) {
                imported.copy(path = imported.path.removePrefix(prefix))
            } else {
                imported
            }
        }
    }

    private fun copyTree(
        treeUri: Uri,
        documentId: String,
        destinationRoot: File,
        relativeDirectory: String,
        files: MutableList<ImportedFile>,
    ) {
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, documentId)
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
        )
        contentResolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
            val idColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
            val nameColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
            val mimeColumn = cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
            while (cursor.moveToNext()) {
                val documentIdValue = cursor.getString(idColumn)
                val displayName = cursor.getString(nameColumn) ?: continue
                val safeName = try {
                    safePathSegment(displayName)
                } catch (_: IOException) {
                    throw IOException("Unsafe imported filename: $displayName")
                }
                val relativePath = if (relativeDirectory.isEmpty()) {
                    safeName
                } else {
                    "$relativeDirectory/$safeName"
                }
                val destination = File(destinationRoot, relativePath).canonicalFile
                val root = destinationRoot.canonicalFile
                if (!destination.path.startsWith(root.path + File.separator)) {
                    throw IOException("Unsafe game-resource path")
                }
                val childUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentIdValue)
                if (cursor.getString(mimeColumn) == DocumentsContract.Document.MIME_TYPE_DIR) {
                    if (!destination.mkdirs() && !destination.isDirectory) {
                        throw IOException("Could not create $relativePath")
                    }
                    copyTree(treeUri, documentIdValue, destinationRoot, relativePath, files)
                } else {
                    copyDocument(childUri, destination)
                    files += ImportedFile(relativePath, destination.length())
                }
            }
        } ?: throw IOException("Could not read the selected folder")
    }

    private fun copyDocument(sourceUri: Uri, destination: File) {
        destination.parentFile?.mkdirs()
        val input = contentResolver.openInputStream(sourceUri)
            ?: throw IOException("Could not open $sourceUri")
        input.use { source ->
            FileOutputStream(destination).use { target ->
                val buffer = ByteArray(1024 * 1024)
                while (true) {
                    val count = source.read(buffer)
                    if (count < 0) break
                    if (count > 0) target.write(buffer, 0, count)
                }
            }
        }
    }

    private fun notifyGameDirectoryResult(success: Boolean, error: String? = null) {
        if (!::webView.isInitialized) return
        val result = JSONObject().put("success", success)
        if (error != null) result.put("error", error)
        val script = "window.__RA2_NATIVE_GAME_RES_CALLBACK__ && " +
            "window.__RA2_NATIVE_GAME_RES_CALLBACK__($result);"
        webView.post { webView.evaluateJavascript(script, null) }
    }

    private fun notifyNativeModImport(success: Boolean, error: String? = null, token: String? = null) {
        if (!::webView.isInitialized) return
        val result = JSONObject().put("success", success)
        if (error != null) result.put("error", error)
        if (token != null) result.put("token", token)
        val script = "window.__RA2_NATIVE_MOD_IMPORT_CALLBACK__ && " +
            "window.__RA2_NATIVE_MOD_IMPORT_CALLBACK__($result);"
        webView.post { webView.evaluateJavascript(script, null) }
    }

    @Deprecated("Use Activity Result APIs when this shell grows more activities")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == GAME_DIRECTORY_REQUEST) {
            val treeUri = data?.data
            if (resultCode != RESULT_OK || treeUri == null) {
                notifyGameDirectoryResult(false)
                return
            }
            try {
                val takeFlags = data.flags and
                    (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                contentResolver.takePersistableUriPermission(treeUri, takeFlags)
            }
            catch (error: Exception) {
                Log.w(TAG, "Could not persist folder permission; copying while the picker grant is live", error)
            }
            importGameDirectory(treeUri)
            return
        }
        if (requestCode == MOD_DIRECTORY_REQUEST) {
            modArchivePickerActive = false
            val treeUri = data?.data
            if (resultCode != RESULT_OK || treeUri == null) {
                notifyNativeModImport(false)
                return
            }
            try {
                val takeFlags = data.flags and
                    (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                contentResolver.takePersistableUriPermission(treeUri, takeFlags)
            }
            catch (error: Exception) {
                Log.w(TAG, "Could not persist mod folder permission; copying while the picker grant is live", error)
            }
            modArchivePickerActive = true
            importModDirectory(treeUri)
            return
        }
        if (requestCode == MOD_ARCHIVE_REQUEST) {
            modArchivePickerActive = false
            val uris = mutableListOf<Uri>()
            if (resultCode == RESULT_OK && data != null) {
                data.clipData?.let { clipData ->
                    for (index in 0 until clipData.itemCount) {
                        clipData.getItemAt(index).uri?.let(uris::add)
                    }
                }
                if (uris.isEmpty()) data.data?.let(uris::add)
            }
            if (uris.isEmpty()) {
                notifyNativeModImport(false)
            }
            else {
                try {
                    uris.forEach { uri ->
                        contentResolver.takePersistableUriPermission(
                            uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION,
                        )
                    }
                }
                catch (error: Exception) {
                    Log.w(TAG, "Could not persist archive permission; importing while picker grant is live", error)
                }
                modArchivePickerActive = true
                importModArchives(uris)
            }
            return
        }
        if (requestCode != FILE_CHOOSER_REQUEST) return
        filePathCallback?.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(resultCode, data),
        )
        filePathCallback = null
    }

    private fun handleRendererGone(view: WebView, detail: RenderProcessGoneDetail) {
        Log.e(TAG, "WebView renderer terminated; didCrash=${detail.didCrash()}")
        val now = System.currentTimeMillis()
        if (now - lastRendererCrashAt > RECOVERY_WINDOW_MS) {
            rendererRecoveryCount = 0
        }
        lastRendererCrashAt = now
        rendererRecoveryCount++

        (view.parent as? android.view.ViewGroup)?.removeView(view)
        view.destroy()
        if (rendererRecoveryCount > MAX_RENDERER_RECOVERIES) {
            showFatalMessage("${gameDisplayName()} ran out of memory and could not recover.\n\nClose other apps and launch again.")
            return
        }

        val delayMs = 1L shl (rendererRecoveryCount - 1)
        window.decorView.postDelayed({ loadApp(rendererRecoveryCount) }, delayMs * 1000L)
    }

    private fun showFatalMessage(message: String) {
        setContentView(TextView(this).apply {
            text = message
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.BLACK)
            textSize = 16f
            gravity = android.view.Gravity.CENTER
            setPadding(48, 32, 48, 32)
        })
    }

    private fun registerPowerState() {
        val powerManager = getSystemService(PowerManager::class.java) ?: return
        pushPowerState(powerManager)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val listener = PowerManager.OnThermalStatusChangedListener { status ->
                pushPowerState(powerManager, status)
            }
            thermalListener = listener
            powerManager.addThermalStatusListener(mainExecutor, listener)
        }
    }

    private fun pushPowerState(
        powerManager: PowerManager,
        status: Int? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            powerManager.currentThermalStatus
        } else {
            null
        },
    ) {
        val thermal = when (status) {
            null -> "unknown"
            PowerManager.THERMAL_STATUS_NONE,
            PowerManager.THERMAL_STATUS_LIGHT,
            PowerManager.THERMAL_STATUS_MODERATE -> "fair"
            PowerManager.THERMAL_STATUS_SEVERE -> "serious"
            PowerManager.THERMAL_STATUS_CRITICAL,
            PowerManager.THERMAL_STATUS_EMERGENCY,
            PowerManager.THERMAL_STATUS_SHUTDOWN -> "critical"
            else -> "unknown"
        }
        val lowPower = powerManager.isPowerSaveMode
        val js = "window.__RA2_POWER__ && window.__RA2_POWER__({thermal:'$thermal',lowPower:$lowPower});"
        if (::webView.isInitialized) {
            webView.post { webView.evaluateJavascript(js, null) }
        }
    }

    private fun hideSystemUi() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Keep the WebView in the same full-display coordinate space as
            // the touch events. Without this, Android fits it between the
            // landscape cutout insets (108px on the test phone), while the
            // game still lays out against the full visual viewport.
            window.setDecorFitsSystemWindows(false)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                window.attributes = window.attributes.apply {
                    layoutInDisplayCutoutMode =
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                }
            }
            window.decorView.windowInsetsController?.let { controller ->
                controller.hide(WindowInsets.Type.systemBars())
                controller.systemBarsBehavior =
                    android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                )
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemUi()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (::webView.isInitialized) {
            try {
                outState.putBundle(WEBVIEW_STATE_KEY, Bundle().also { webView.saveState(it) })
            }
            catch (error: Exception) {
                Log.w(TAG, "Could not save the WebView session", error)
            }
        }
        super.onSaveInstanceState(outState)
    }

    /** Keep the game Activity alive when Android back is used. The task can
     * still be closed from recents, but returning to it resumes the same WebView
     * instead of booting the engine again. */
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        moveTaskToBack(true)
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) {
            webView.onResume()
            val powerManager = getSystemService(PowerManager::class.java)
            if (powerManager != null) pushPowerState(powerManager)
        }
    }

    override fun onPause() {
        if (::webView.isInitialized) {
            webView.onPause()
            // Do not call pauseTimers(): multiplayer uses the WebView event
            // loop for lockstep/network bookkeeping while the Activity is in
            // the background. Single-player stops simulation itself after
            // saving a replay checkpoint on document.visibilitychange.
        }
        super.onPause()
    }

    override fun onDestroy() {
        val powerManager = getSystemService(PowerManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && thermalListener != null) {
            powerManager?.removeThermalStatusListener(thermalListener!!)
        }
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        nativeDownloads.values.forEach { job ->
            job.cancelled.set(true)
            job.connection?.disconnect()
        }
        nativeDownloads.clear()
        downloadExecutor.shutdownNow()
        importExecutor.shutdownNow()
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        super.onDestroy()
    }
}
