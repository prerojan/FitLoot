package com.fitloot.notification

import android.util.Log
import android.webkit.CookieManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

class BackgroundNotificationPoller(
    private val readWebAppUrl: () -> String,
    private val notificationManager: HostNotificationManager,
) {

    companion object {
        private const val TAG = "BgNotificationPoller"
        private const val POLL_INTERVAL_MS = 30_000L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var pollJob: Job? = null

    fun start() {
        if (pollJob?.isActive == true) {
            return
        }

        pollJob = scope.launch {
            while (isActive) {
                runCatching { pollOnce() }
                    .onFailure { error -> Log.w(TAG, "Background notification poll failed", error) }
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    fun stop() {
        pollJob?.cancel()
        pollJob = null
    }

    fun destroy() {
        stop()
        scope.cancel()
    }

    private fun pollOnce() {
        if (!notificationManager.hasPermission()) {
            return
        }

        val apiBaseUrl = resolveApiBaseUrl(readWebAppUrl())
        if (apiBaseUrl.isNullOrBlank()) {
            return
        }

        val socialNotifications = requestJsonArray(apiBaseUrl, "/api/social/notifications/pending?limit=10")
        if (socialNotifications.length() > 0) {
            val consumeItems = JSONArray()
            for (index in 0 until socialNotifications.length()) {
                val item = socialNotifications.optJSONObject(index) ?: continue
                notificationManager.showSocialNotification(item)

                val conversationId = item.optInt("conversation_id", 0)
                val messageId = item.optInt("message_id", 0)
                if (conversationId > 0 && messageId > 0) {
                    consumeItems.put(
                        JSONObject().apply {
                            put("conversation_id", conversationId)
                            put("message_id", messageId)
                        },
                    )
                }
            }

            if (consumeItems.length() > 0) {
                postJson(
                    apiBaseUrl,
                    "/api/social/notifications/consume",
                    JSONObject().apply { put("items", consumeItems) },
                )
            }
        }

        val rewardNotifications = requestJsonArray(apiBaseUrl, "/api/reward-notifications/pending")
        if (rewardNotifications.length() > 0) {
            val rewardIds = JSONArray()
            for (index in 0 until rewardNotifications.length()) {
                val item = rewardNotifications.optJSONObject(index) ?: continue
                notificationManager.showRewardNotification(item)

                val rewardId = item.optInt("id", 0)
                if (rewardId > 0) {
                    rewardIds.put(rewardId)
                }
            }

            if (rewardIds.length() > 0) {
                postJson(
                    apiBaseUrl,
                    "/api/reward-notifications/consume",
                    JSONObject().apply { put("ids", rewardIds) },
                )
            }
        }
    }

    private fun requestJsonArray(apiBaseUrl: String, path: String): JSONArray {
        val connection = openConnection(apiBaseUrl, path, "GET")
        connection.connectTimeout = 12_000
        connection.readTimeout = 12_000

        return connection.use { opened ->
            val status = opened.responseCode
            if (status == HttpURLConnection.HTTP_UNAUTHORIZED || status == HttpURLConnection.HTTP_FORBIDDEN) {
                return JSONArray()
            }
            if (status !in 200..299) {
                throw IllegalStateException("Request failed for $path with status $status")
            }

            val payload = opened.inputStream.bufferedReader().use(BufferedReader::readText)
            if (payload.isBlank()) {
                return JSONArray()
            }
            return JSONArray(payload)
        }
    }

    private fun postJson(apiBaseUrl: String, path: String, payload: JSONObject) {
        val connection = openConnection(apiBaseUrl, path, "POST")
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        connection.connectTimeout = 12_000
        connection.readTimeout = 12_000

        connection.use { opened ->
            OutputStreamWriter(opened.outputStream).use { writer ->
                writer.write(payload.toString())
                writer.flush()
            }

            val status = opened.responseCode
            if (status !in 200..299) {
                throw IllegalStateException("POST failed for $path with status $status")
            }
        }
    }

    private fun openConnection(
        apiBaseUrl: String,
        path: String,
        method: String,
    ): HttpURLConnection {
        val url = URL(apiBaseUrl + path)
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            setRequestProperty("Accept", "application/json")
            setRequestProperty("X-FitLoot-Timezone", "America/Sao_Paulo")
            useCaches = false
        }

        CookieManager.getInstance().getCookie(apiBaseUrl)?.takeIf { it.isNotBlank() }?.let { cookies ->
            connection.setRequestProperty("Cookie", cookies)
        }

        return connection
    }

    private fun resolveApiBaseUrl(webAppUrl: String): String? {
        if (webAppUrl.isBlank()) {
            return null
        }

        return runCatching {
            val uri = URI(webAppUrl)
            val port = if (uri.port > 0) ":${uri.port}" else ""
            "${uri.scheme}://${uri.host}$port"
        }.getOrNull()
    }

    private inline fun <T : HttpURLConnection, R> T.use(block: (T) -> R): R {
        return try {
            block(this)
        } finally {
            disconnect()
        }
    }
}
