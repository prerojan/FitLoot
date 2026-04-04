package com.fitloot.bridge

import android.net.Uri
import com.fitloot.BuildConfig
import org.json.JSONObject
import java.util.Locale

object FitLootWebAppConfig {
    private const val DEFAULT_DEV_WEB_BASE_URL = "http://10.0.2.2:5173"
    private const val PRODUCTION_WEB_BASE_URL = "https://fitloot.vercel.app"
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
    val productionWebAppUrl: String = "$PRODUCTION_WEB_BASE_URL/home"
    val isDevBuild: Boolean = hostBuildType == "dev"
    fun allowedHostsAsText(): String = allowedHosts.joinToString(", ")

    fun resolveInitialWebAppUrl(isEmulator: Boolean): String {
        if (!isDevBuild) {
            return webAppUrl
        }

        if (!isEmulator && webBaseUrl == DEFAULT_DEV_WEB_BASE_URL) {
            return productionWebAppUrl
        }

        return webAppUrl
    }

    fun isTrustedUrl(url: String): Boolean {
        val parsedUrl = runCatching { Uri.parse(url) }.getOrNull() ?: return false
        val host = parsedUrl.host?.trim()?.lowercase(Locale.US) ?: return false
        val scheme = parsedUrl.scheme?.trim()?.lowercase(Locale.US) ?: return false
        val allowHttpForDevHost = isDevBuild && allowedHosts.contains(host)

        if (scheme != "https" && !(allowHttpForDevHost && scheme == "http")) {
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
