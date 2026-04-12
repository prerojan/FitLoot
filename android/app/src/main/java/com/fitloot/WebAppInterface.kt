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
    private val onDevicePermissionsRequest: (() -> Unit)? = null,
    private val onLocationPermissionsRequest: (() -> Unit)? = null,
    private val onReadHostContext: (() -> JSONObject)? = null,
    private val onRequestCurrentLocation: (() -> Unit)? = null,
    private val onStartLocationTracking: (() -> Unit)? = null,
    private val onStopLocationTracking: (() -> Unit)? = null,
    private val onReadLocationPermissionStatus: (() -> JSONObject)? = null,
    private val onNotificationPermissionRequest: (() -> Unit)? = null,
    private val onReadNotificationPermissionStatus: (() -> JSONObject)? = null,
) {

    private val stepCounter = StepCounter(context)
    private val eventDispatcher = WebEventDispatcher(webView)
    private val scope = CoroutineScope(Dispatchers.Main)
    private var pendingStepTrackingStart = false

    @JavascriptInterface
    fun isNativeAvailable(): Boolean {
        return true
    }

    @JavascriptInterface
    fun checkNativeLayer(): String {
        return "available"
    }

    @JavascriptInterface
    fun getHostContext(): String {
        return onReadHostContext?.invoke()?.toString() ?: JSONObject().apply {
            put("platform", "android")
            put("webMode", "remote")
            put("buildType", "prod")
            put("networkOnline", true)
        }.toString()
    }

    @JavascriptInterface
    fun requestPermissions() {
        onDevicePermissionsRequest?.invoke()
    }

    @JavascriptInterface
    fun requestLocationPermission() {
        onLocationPermissionsRequest?.invoke()
    }

    @JavascriptInterface
    fun getLocationPermissionStatus(): String {
        return onReadLocationPermissionStatus?.invoke()?.toString() ?: JSONObject().toString()
    }

    @JavascriptInterface
    fun requestCurrentLocation() {
        onRequestCurrentLocation?.invoke()
    }

    @JavascriptInterface
    fun startLocationTracking() {
        onStartLocationTracking?.invoke()
    }

    @JavascriptInterface
    fun stopLocationTracking() {
        onStopLocationTracking?.invoke()
    }

    @JavascriptInterface
    fun requestNotificationPermission() {
        onNotificationPermissionRequest?.invoke()
    }

    @JavascriptInterface
    fun getNotificationPermissionStatus(): String {
        return onReadNotificationPermissionStatus?.invoke()?.toString() ?: JSONObject().toString()
    }

    @JavascriptInterface
    fun startStepTracking() {
        if (!stepCounter.hasActivityRecognitionPermission()) {
            pendingStepTrackingStart = true
            onDevicePermissionsRequest?.invoke()
            return
        }

        pendingStepTrackingStart = false
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
        if (!stepCounter.hasActivityRecognitionPermission()) {
            onDevicePermissionsRequest?.invoke()
        }
        scope.launch {
            val metrics = stepCounter.getDailyMetrics()
            sendEventToWebApp(NativeBridgeContract.EVENT_NATIVE_METRICS_UPDATED, metrics)
        }
    }

    fun onRuntimePermissionsChanged() {
        if (pendingStepTrackingStart && stepCounter.hasActivityRecognitionPermission()) {
            pendingStepTrackingStart = false
            stepCounter.start()
        }

        onReadLocationPermissionStatus?.invoke()?.let { status ->
            sendEventToWebApp(NativeBridgeContract.EVENT_LOCATION_PERMISSION_CHANGED, status)
        }
        onReadNotificationPermissionStatus?.invoke()?.let { status ->
            sendEventToWebApp(NativeBridgeContract.EVENT_NOTIFICATION_PERMISSION_CHANGED, status)
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
