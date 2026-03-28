package com.fitloot

import android.content.Context
import android.content.Intent
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.fitloot.bridge.NativeBridgeContract
import com.fitloot.bridge.WebEventDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject

class WebAppInterface(
    private val context: Context,
    private val webView: WebView,
    private val onCameraRequest: (Intent) -> Unit,
    private val onGalleryRequest: (Intent) -> Unit,
    private val onPermissionsRequest: (() -> Unit)? = null
) {

    private val stepCounter = StepCounter(context)
    private val eventDispatcher = WebEventDispatcher(webView)
    private val scope = CoroutineScope(Dispatchers.Main)

    @JavascriptInterface
    fun isNativeAvailable(): Boolean {
        return true
    }

    @JavascriptInterface
    fun checkNativeLayer(): String {
        return "available"
    }

    @JavascriptInterface
    fun requestPermissions() {
        onPermissionsRequest?.invoke()
    }

    @JavascriptInterface
    fun startStepTracking() {
        onPermissionsRequest?.invoke()
        stepCounter.start()
    }

    @JavascriptInterface
    fun startStepCounter() {
        startStepTracking()
    }

    @JavascriptInterface
    fun stopStepTracking() {
        stepCounter.stop()
    }

    @JavascriptInterface
    fun stopStepCounter() {
        stopStepTracking()
    }

    @JavascriptInterface
    fun getStepCount(): Int {
        return stepCounter.getSessionSteps()
    }

    @JavascriptInterface
    fun getStepMetrics() {
        onPermissionsRequest?.invoke()
        scope.launch {
            val metrics = stepCounter.getDailyMetrics()
            sendEventToWebApp(NativeBridgeContract.EVENT_NATIVE_METRICS_UPDATED, metrics)
        }
    }

    @JavascriptInterface
    fun openCamera() {
        val intent = Intent(context, CameraActivity::class.java)
        onCameraRequest(intent)
    }

    @JavascriptInterface
    fun openGallery() {
        val intent = Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI)
        onGalleryRequest(intent)
    }

    fun sendEventToWebApp(eventName: String, data: JSONObject) {
        eventDispatcher.dispatch(eventName, data)
    }
}
