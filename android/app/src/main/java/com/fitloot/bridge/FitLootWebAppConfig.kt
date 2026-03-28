package com.fitloot.bridge

object FitLootWebAppConfig {
    private const val TRUSTED_BASE_URL = "https://fitloot.vercel.app"
    const val WEB_APP_URL = "$TRUSTED_BASE_URL/home"

    fun isTrustedUrl(url: String): Boolean {
        return url.startsWith(TRUSTED_BASE_URL)
    }
}
