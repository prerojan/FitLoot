package com.fitloot.bridge

import android.net.Uri
import com.fitloot.BuildConfig
import org.json.JSONObject
import java.util.Locale

object FitLootWebAppConfig {
    val webBaseUrl: String = BuildConfig.WEB_BASE_URL.trim().trimEnd('/')
    val webMode: String = BuildConfig.WEB_MODE.trim().lowercase(Locale.US)
    val hostBuildType: String = BuildConfig.HOST_BUILD_TYPE.trim().lowercase(Locale.US)
    private val allowedHosts: Set<String> = BuildConfig.ALLOWED_HOSTS
        .split(',')
        .mapNotNull { host ->
            val normalized = host.trim().lowercase(Locale.US)
            normalized.takeIf { it.isNotEmpty() }
        }
        .toSet()

    val webAppUrl: String = "$webBaseUrl/home"

    fun isTrustedUrl(url: String): Boolean {
        val parsedUrl = runCatching { Uri.parse(url) }.getOrNull() ?: return false
        val host = parsedUrl.host?.trim()?.lowercase(Locale.US) ?: return false
        val scheme = parsedUrl.scheme?.trim()?.lowercase(Locale.US) ?: return false
        val allowHttpForDevHost = host == "10.0.2.2" || host == "localhost"

        if (scheme != "https" && !(allowHttpForDevHost && hostBuildType == "dev" && scheme == "http")) {
            return false
        }

        return allowedHosts.contains(host)
    }

    fun buildHostContextJson(networkOnline: Boolean): JSONObject {
        return JSONObject().apply {
            put("platform", "android")
            put("webMode", if (webMode == "bundled") "bundled" else "remote")
            put(
                "buildType",
                when (hostBuildType) {
                    "dev" -> "dev"
                    "internal" -> "internal"
                    else -> "prod"
                },
            )
            put("networkOnline", networkOnline)
            put(
                "capabilities",
                JSONObject().apply {
                    put("camera", true)
                    put("gallery", true)
                    put("healthMetrics", true)
                    put("offlineQueue", true)
                    put("lifecycleEvents", true)
                    put("location", true)
                },
            )
        }
    }
}
