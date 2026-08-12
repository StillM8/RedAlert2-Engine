package com.ammaar.ra2android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps a large Storage Access Framework import alive while the folder picker
 * or another app is in front. The actual copy still runs in MainActivity's
 * process, but the foreground service gives that process foreground priority
 * until the import commits or fails.
 */
class ModImportKeepAliveService : Service() {
    companion object {
        const val ACTION_START = "com.ammaar.ra2android.action.START_MOD_IMPORT"
        const val ACTION_STOP = "com.ammaar.ra2android.action.STOP_MOD_IMPORT"
        const val ACTION_UPDATE = "com.ammaar.ra2android.action.UPDATE_MOD_IMPORT"

        const val EXTRA_PROGRESS_TEXT = "progressText"
        const val EXTRA_COPIED_BYTES = "copiedBytes"
        const val EXTRA_TOTAL_BYTES = "totalBytes"
        const val EXTRA_COPIED_FILES = "copiedFiles"
        const val EXTRA_TOTAL_FILES = "totalFiles"

        private const val CHANNEL_ID = "mod-import"
        private const val NOTIFICATION_ID = 2402
    }

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Mod imports",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Shows when a large game or mod folder is being imported"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        val notification = buildNotification(intent)
        startForegroundWithNotification(notification)
        return START_NOT_STICKY
    }

    private fun buildNotification(intent: Intent?): Notification {
        val copiedBytes = intent?.getLongExtra(EXTRA_COPIED_BYTES, 0L) ?: 0L
        val totalBytes = intent?.getLongExtra(EXTRA_TOTAL_BYTES, 0L) ?: 0L
        val copiedFiles = intent?.getIntExtra(EXTRA_COPIED_FILES, 0) ?: 0
        val totalFiles = intent?.getIntExtra(EXTRA_TOTAL_FILES, 0) ?: 0
        val text = intent?.getStringExtra(EXTRA_PROGRESS_TEXT)
            ?: "Keeping the import running in the background"
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Importing game files")
            .setContentText(text)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_PROGRESS)
        if (totalBytes > 0L) {
            val maxMb = ((totalBytes + 1_048_575L) / 1_048_576L)
                .coerceAtMost(Int.MAX_VALUE.toLong())
                .toInt()
            val progressMb = ((copiedBytes / 1_048_576L).coerceAtMost(maxMb.toLong())).toInt()
            builder.setProgress(maxMb, progressMb, false)
        } else if (totalFiles > 0) {
            builder.setProgress(totalFiles, copiedFiles.coerceAtMost(totalFiles), false)
        } else {
            builder.setProgress(0, 0, true)
        }
        return builder.build()
    }

    private fun startForegroundWithNotification(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
