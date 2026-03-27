package com.fitloot

import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import org.json.JSONObject

class WebAppInterface(
    private val context: Context, 
    private val webView: WebView,
    private val onCameraRequest: (Intent) -> Unit
) {

    private val stepCounter = StepCounter(context)

    @JavascriptInterface
    fun checkNativeLayer(): String {
        return "available"
    }

    @JavascriptInterface
    fun requestPermissions() {
        Toast.makeText(context, "Permissions requested via Bridge", Toast.LENGTH_SHORT).show()
    }

    @JavascriptInterface
    fun startStepCounter() {
        stepCounter.start()
    }

    @JavascriptInterface
    fun stopStepCounter() {
        stepCounter.stop()
    }

    @JavascriptInterface
    fun getStepCount(): Int {
        return stepCounter.getSteps()
    }

    @JavascriptInterface
    fun openCamera() {
        val intent = Intent(context, CameraActivity::class.java)
        onCameraRequest(intent)
    }

    fun sendEventToWebApp(eventName: String, data: JSONObject) {
        webView.post {
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('$eventName', { detail: $data }));", null)
        }
    }
}
