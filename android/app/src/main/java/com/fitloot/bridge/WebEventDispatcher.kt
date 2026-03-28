package com.fitloot.bridge

import android.webkit.WebView
import org.json.JSONObject

class WebEventDispatcher(private val webView: WebView) {

    fun dispatch(eventName: String, data: JSONObject) {
        val safeEventName = JSONObject.quote(eventName)
        val payload = data.toString()

        webView.post {
            webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent($safeEventName, { detail: $payload }));",
                null
            )
        }
    }
}
