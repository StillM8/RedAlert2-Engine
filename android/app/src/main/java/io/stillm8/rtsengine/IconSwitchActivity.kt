package io.stillm8.rtsengine

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import java.util.Locale

class IconSwitchActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyLauncherProfile(intent)
        finish()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        applyLauncherProfile(intent)
        finish()
    }

    private fun applyLauncherProfile(intent: Intent?) {
        val uri = intent?.data ?: return
        if (!uri.scheme.equals("ra2launcher", ignoreCase = true)) return
        val profile = uri.host?.lowercase(Locale.ROOT) ?: return
        if (profile != "ra2" && profile != "yr") return

        val ra2 = ComponentName(packageName, "$packageName.LauncherRA2")
        val yr = ComponentName(packageName, "$packageName.LauncherYR")
        val target = if (profile == "yr") yr else ra2
        val other = if (profile == "yr") ra2 else yr

        packageManager.setComponentEnabledSetting(
            target,
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
            PackageManager.DONT_KILL_APP,
        )
        packageManager.setComponentEnabledSetting(
            other,
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP,
        )
    }
}
