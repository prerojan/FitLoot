package com.fitloot

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import com.fitloot.databinding.ActivityMainBinding
import com.fitloot.bridge.FitLootWebAppConfig
import com.fitloot.bridge.FitLootWebViewConfigurator
import com.fitloot.bridge.NativeBridgeContract
import com.fitloot.health.HealthConnectPermissionCoordinator
import com.fitloot.location.ForegroundLocationTracker
import com.fitloot.media.NativeMediaPayloadFactory
import com.fitloot.notification.BackgroundNotificationPoller
import com.fitloot.notification.HostNotificationManager
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant

class MainActivity : AppCompatActivity() {

    companion object {
        private const val RUNTIME_PERMISSIONS_REQUEST_CODE = 100
        private const val TAG = "MainActivity"
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var webAppInterface: WebAppInterface
    private lateinit var locationTracker: ForegroundLocationTracker
    private lateinit var hostNotificationManager: HostNotificationManager
    private lateinit var backgroundNotificationPoller: BackgroundNotificationPoller
    private var webView: WebView? = null
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var pendingWebPermissionRequest: PermissionRequest? = null
    private var pendingGeolocationOrigin: String? = null
    private var pendingGeolocationCallback: GeolocationPermissions.Callback? = null
    private var isNetworkCallbackRegistered = false
    private var hasMainFrameLoadFailed = false
    private var hasRetriedWithProductionHost = false
    private var activeWebAppUrl: String = FitLootWebAppConfig.webAppUrl
    private var pendingNotificationOpenPayload: JSONObject? = null
    private var suppressBackgroundNotificationPolling = false

    private val connectivityManager by lazy {
        getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
    }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            dispatchNetworkStatusChanged(true, "android-online")
        }

        override fun onLost(network: Network) {
            dispatchNetworkStatusChanged(isNetworkOnline(), "android-offline")
        }
    }

    private val cameraResultLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        suppressBackgroundNotificationPolling = false
        if (result.resultCode == Activity.RESULT_OK) {
            val imagePath = result.data?.getStringExtra("image_path")
            if (imagePath != null) {
                webAppInterface.sendEventToWebApp(
                    NativeBridgeContract.EVENT_CAMERA_CAPTURED,
                    NativeMediaPayloadFactory.fromCameraPath(imagePath),
                )
            }
            return@registerForActivityResult
        }

        val errorMessage = result.data?.getStringExtra("camera_error")
        if (!errorMessage.isNullOrBlank()) {
            webAppInterface.sendEventToWebApp(
                NativeBridgeContract.EVENT_CAMERA_CAPTURE_ERROR,
                JSONObject().apply {
                    put("message", errorMessage)
                    put("source", "camera")
                },
            )
        }
    }

    private val galleryResultLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        suppressBackgroundNotificationPolling = false
        if (result.resultCode == Activity.RESULT_OK) {
            val imageUri: Uri? = result.data?.data
            if (imageUri != null) {
                webAppInterface.sendEventToWebApp(
                    NativeBridgeContract.EVENT_GALLERY_IMAGE_SELECTED,
                    NativeMediaPayloadFactory.fromGalleryUri(this, imageUri),
                )
            }
        }
    }

    private val fileChooserLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        suppressBackgroundNotificationPolling = false
        val callback = fileChooserCallback
        fileChooserCallback = null

        if (callback == null) {
            return@registerForActivityResult
        }

        val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            ?: result.data?.data?.let { arrayOf(it) }

        callback.onReceiveValue(uris)
    }

    private val healthPermissionsLauncher = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) { _ -> }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ ->
        dispatchNotificationPermissionChanged()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        hostNotificationManager = HostNotificationManager(this)
        backgroundNotificationPoller = BackgroundNotificationPoller(
            readWebAppUrl = { activeWebAppUrl },
            notificationManager = hostNotificationManager,
        )
        captureNotificationIntent(intent)
        binding.webViewRetryButton.setOnClickListener {
            setupWebView()
        }

        setupWebView()
        registerNetworkCallback()
    }

    private fun setupWebView(): Boolean {
        hasMainFrameLoadFailed = false
        hasRetriedWithProductionHost = false
        activeWebAppUrl = FitLootWebAppConfig.resolveInitialWebAppUrl(isProbablyEmulator())
        Log.i(TAG, "Loading FitLoot web shell from $activeWebAppUrl")
        val createdWebView = runCatching { WebView(this) }.getOrElse { error ->
            Log.e(TAG, "Failed to instantiate WebView", error)
            showWebViewUnavailable(error)
            return false
        }

        webView = createdWebView
        binding.webViewContainer.visibility = View.VISIBLE
        binding.webViewFallback.visibility = View.GONE
        binding.webViewContainer.removeAllViews()
        binding.webViewContainer.addView(
            createdWebView,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )

        locationTracker = ForegroundLocationTracker(
            this,
            onLocationUpdated = { payload ->
                if (::webAppInterface.isInitialized) {
                    webAppInterface.sendEventToWebApp(
                        NativeBridgeContract.EVENT_LOCATION_UPDATED,
                        payload,
                    )
                }
            },
            onPermissionChanged = { payload ->
                if (::webAppInterface.isInitialized) {
                    webAppInterface.sendEventToWebApp(
                        NativeBridgeContract.EVENT_LOCATION_PERMISSION_CHANGED,
                        payload,
                    )
                }
            },
        )

        webAppInterface = WebAppInterface(
            this,
            createdWebView,
            onCameraRequest = { intent ->
                suppressBackgroundNotificationPolling = true
                cameraResultLauncher.launch(intent)
            },
            onGalleryRequest = { intent ->
                suppressBackgroundNotificationPolling = true
                galleryResultLauncher.launch(intent)
            },
            onDevicePermissionsRequest = { requestAppPermissions() },
            onLocationPermissionsRequest = {
                requestRuntimePermissions(
                    includeCamera = false,
                    includeActivityRecognition = false,
                    includeLocation = true,
                )
            },
            onReadHostContext = {
                FitLootWebAppConfig.buildHostContextJson(isNetworkOnline())
            },
            onRequestCurrentLocation = {
                if (!locationTracker.hasLocationPermission()) {
                    requestRuntimePermissions(
                        includeCamera = false,
                        includeActivityRecognition = false,
                        includeLocation = true,
                    )
                }
                locationTracker.requestCurrentLocation()
            },
            onStartLocationTracking = {
                if (!locationTracker.hasLocationPermission()) {
                    requestRuntimePermissions(
                        includeCamera = false,
                        includeActivityRecognition = false,
                        includeLocation = true,
                    )
                }
                locationTracker.startTracking()
            },
            onStopLocationTracking = {
                locationTracker.stopTracking()
            },
            onReadLocationPermissionStatus = {
                locationTracker.buildPermissionStatusJson()
            },
            onNotificationPermissionRequest = {
                requestNotificationPermissionIfNeeded()
            },
            onReadNotificationPermissionStatus = {
                hostNotificationManager.buildPermissionStatusJson()
            },
        )

        FitLootWebViewConfigurator.configure(
            webView = createdWebView,
            openExternalUrl = { intent ->
                startActivity(intent)
            },
            onShowFileChooser = { nextCallback, fileChooserParams ->
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = nextCallback

                val chooserIntent = runCatching {
                    fileChooserParams?.createIntent()
                }.getOrNull() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "image/*"
                }

                runCatching {
                    suppressBackgroundNotificationPolling = true
                    fileChooserLauncher.launch(chooserIntent)
                }.isSuccess
            },
            onPermissionRequest = { request ->
                handleWebPermissionRequest(request)
            },
            onGeolocationPermissionRequest = { origin, callback ->
                handleGeolocationPermissionRequest(origin, callback)
            },
            onPageStarted = { url ->
                Log.i(TAG, "WebView started loading $url")
            },
            onPageFinished = { url ->
                Log.i(TAG, "WebView finished loading $url")
                if (!hasMainFrameLoadFailed) {
                    showWebViewReady()
                    dispatchNotificationPermissionChanged()
                    deliverPendingNotificationOpenIfNeeded()
                }
            },
            onPageLoadFailed = { failingUrl, reason ->
                if (tryRecoverFromDevTimeout(createdWebView, failingUrl, reason)) {
                    return@configure
                }
                hasMainFrameLoadFailed = true
                showWebLoadFailed(failingUrl, reason)
            },
        )

        createdWebView.addJavascriptInterface(webAppInterface, NativeBridgeContract.BRIDGE_NAME)
        createdWebView.loadUrl(activeWebAppUrl)
        locationTracker.emitPermissionStatus()
        dispatchNetworkStatusChanged()
        return true
    }

    private fun showWebViewUnavailable(error: Throwable? = null) {
        binding.webViewContainer.visibility = View.GONE
        binding.webViewFallback.visibility = View.VISIBLE
        binding.webViewFallbackMessage.text =
            if (error?.message?.contains("com.google.android.webview") == true) {
                "O provedor do Android System WebView nao esta disponivel neste aparelho. Atualize ou reative o Android System WebView ou o Google Chrome e tente novamente."
            } else {
                "Nao foi possivel iniciar a camada web do FitLoot neste aparelho. Atualize o Android System WebView ou o Google Chrome e tente novamente."
            }
    }

    private fun showWebViewReady() {
        binding.webViewContainer.visibility = View.VISIBLE
        binding.webViewFallback.visibility = View.GONE
    }

    private fun showWebLoadFailed(failingUrl: String?, reason: String) {
        Log.e(TAG, "Displaying fallback for failed web load. url=$failingUrl reason=$reason")
        binding.webViewContainer.visibility = View.GONE
        binding.webViewFallback.visibility = View.VISIBLE

        val normalizedFailingUrl = failingUrl ?: FitLootWebAppConfig.webAppUrl
        val baseMessage = StringBuilder().apply {
            append("Nao foi possivel carregar o FitLoot em ")
            append(normalizedFailingUrl)
            append(". ")
            append(reason)
        }

        if (FitLootWebAppConfig.isDevBuild) {
            baseMessage.append("\n\nNo devDebug em aparelho fisico, confirme que o webapp esta rodando com 'npm run dev -- --host 0.0.0.0' e que o host configurado em FITLOOT_DEV_WEB_BASE_URL aponta para o IP do computador na mesma rede.")
            baseMessage.append("\nHosts permitidos: ")
            baseMessage.append(FitLootWebAppConfig.allowedHostsAsText())
        }

        binding.webViewFallbackMessage.text = baseMessage.toString()
    }

    private fun tryRecoverFromDevTimeout(
        webView: WebView,
        failingUrl: String?,
        reason: String,
    ): Boolean {
        if (!FitLootWebAppConfig.isDevBuild || hasRetriedWithProductionHost) {
            return false
        }

        val normalizedFailingUrl = failingUrl ?: activeWebAppUrl
        val isLocalDevUrl = normalizedFailingUrl.startsWith(FitLootWebAppConfig.webBaseUrl)
        if (!isLocalDevUrl || activeWebAppUrl == FitLootWebAppConfig.productionWebAppUrl) {
            return false
        }

        Log.w(
            TAG,
            "Dev host load failed for $normalizedFailingUrl ($reason). Falling back to ${FitLootWebAppConfig.productionWebAppUrl}",
        )

        hasRetriedWithProductionHost = true
        hasMainFrameLoadFailed = false
        activeWebAppUrl = FitLootWebAppConfig.productionWebAppUrl
        binding.webViewContainer.visibility = View.VISIBLE
        binding.webViewFallback.visibility = View.GONE
        webView.loadUrl(activeWebAppUrl)
        return true
    }

    private fun isProbablyEmulator(): Boolean {
        return Build.FINGERPRINT.startsWith("generic") ||
            Build.FINGERPRINT.startsWith("unknown") ||
            Build.MODEL.contains("google_sdk") ||
            Build.MODEL.contains("Emulator") ||
            Build.MODEL.contains("Android SDK built for x86") ||
            Build.MANUFACTURER.contains("Genymotion") ||
            (Build.BRAND.startsWith("generic") && Build.DEVICE.startsWith("generic")) ||
            "google_sdk" == Build.PRODUCT
    }

    private fun requestAppPermissions() {
        requestRuntimePermissions(
            includeCamera = true,
            includeActivityRecognition = true,
            includeLocation = true,
        )
        requestHealthConnectPermissionsIfNeeded()
    }

    private fun requestRuntimePermissions(
        includeCamera: Boolean,
        includeActivityRecognition: Boolean,
        includeLocation: Boolean,
    ) {
        val permissions = mutableListOf<String>()
        if (includeCamera) {
            permissions.add(Manifest.permission.CAMERA)
        }
        if (includeActivityRecognition) {
            permissions.add(Manifest.permission.ACTIVITY_RECOGNITION)
        }
        if (includeLocation) {
            permissions.add(Manifest.permission.ACCESS_COARSE_LOCATION)
            permissions.add(Manifest.permission.ACCESS_FINE_LOCATION)
        }

        val missingPermissions = permissions.filter { permission ->
            ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED
        }

        if (missingPermissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                missingPermissions.toTypedArray(),
                RUNTIME_PERMISSIONS_REQUEST_CODE,
            )
        }
    }

    private fun handleWebPermissionRequest(request: PermissionRequest) {
        val requestedResources = request.resources.toList()
        val grantedResources = mutableListOf<String>()
        val needsCamera = requestedResources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
        val hasCameraPermission =
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

        if (needsCamera && !hasCameraPermission) {
            pendingWebPermissionRequest = request
            requestRuntimePermissions(
                includeCamera = true,
                includeActivityRecognition = false,
                includeLocation = false,
            )
            return
        }

        if (requestedResources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) && hasCameraPermission) {
            grantedResources.add(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
        }

        if (grantedResources.isEmpty()) {
            request.deny()
            return
        }

        request.grant(grantedResources.toTypedArray())
    }

    private fun handleGeolocationPermissionRequest(
        origin: String,
        callback: GeolocationPermissions.Callback,
    ) {
        if (!FitLootWebAppConfig.isTrustedUrl(origin)) {
            callback.invoke(origin, false, false)
            return
        }

        if (locationTracker.hasLocationPermission()) {
            callback.invoke(origin, true, false)
            locationTracker.emitPermissionStatus()
            return
        }

        pendingGeolocationOrigin = origin
        pendingGeolocationCallback = callback
        requestRuntimePermissions(
            includeCamera = false,
            includeActivityRecognition = false,
            includeLocation = true,
        )
    }

    private fun requestHealthConnectPermissionsIfNeeded() {
        lifecycleScope.launch {
            runCatching {
                HealthConnectPermissionCoordinator.requestIfNeeded(this@MainActivity, healthPermissionsLauncher)
            }
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        hostNotificationManager.requestPermissionIfNeeded(this, notificationPermissionLauncher)
    }

    private fun registerNetworkCallback() {
        if (isNetworkCallbackRegistered) {
            return
        }

        runCatching {
            connectivityManager.registerDefaultNetworkCallback(networkCallback)
            isNetworkCallbackRegistered = true
        }.onFailure { error ->
            Log.w(TAG, "Unable to register network callback", error)
        }
    }

    private fun unregisterNetworkCallback() {
        if (!isNetworkCallbackRegistered) {
            return
        }

        runCatching {
            connectivityManager.unregisterNetworkCallback(networkCallback)
        }.onFailure { error ->
            Log.w(TAG, "Unable to unregister network callback", error)
        }
        isNetworkCallbackRegistered = false
    }

    private fun isNetworkOnline(): Boolean {
        return runCatching {
            val activeNetwork = connectivityManager.activeNetwork ?: return false
            val capabilities = connectivityManager.getNetworkCapabilities(activeNetwork) ?: return false
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        }.getOrElse { error ->
            Log.w(TAG, "Unable to resolve current network state", error)
            false
        }
    }

    private fun dispatchNetworkStatusChanged(
        online: Boolean = isNetworkOnline(),
        type: String = if (online) "android-online" else "android-offline",
    ) {
        if (!::webAppInterface.isInitialized) {
            return
        }

        webAppInterface.sendEventToWebApp(
            NativeBridgeContract.EVENT_NETWORK_STATUS_CHANGED,
            JSONObject().apply {
                put("online", online)
                put("type", type)
                put("timestamp", Instant.now().toString())
            },
        )
    }

    private fun dispatchAppLifecycleChanged(state: String) {
        if (!::webAppInterface.isInitialized) {
            return
        }

        webAppInterface.sendEventToWebApp(
            NativeBridgeContract.EVENT_APP_LIFECYCLE_CHANGED,
            JSONObject().apply {
                put("state", state)
                put("timestamp", Instant.now().toString())
            },
        )
    }

    private fun dispatchNotificationPermissionChanged() {
        if (!::webAppInterface.isInitialized) {
            return
        }

        webAppInterface.sendEventToWebApp(
            NativeBridgeContract.EVENT_NOTIFICATION_PERMISSION_CHANGED,
            hostNotificationManager.buildPermissionStatusJson(),
        )
    }

    private fun captureNotificationIntent(intent: Intent?) {
        pendingNotificationOpenPayload = HostNotificationManager.extractNotificationOpenPayload(intent)
    }

    private fun deliverPendingNotificationOpenIfNeeded() {
        val payload = pendingNotificationOpenPayload ?: return
        if (!::webAppInterface.isInitialized) {
            return
        }

        pendingNotificationOpenPayload = null
        webAppInterface.sendEventToWebApp(
            NativeBridgeContract.EVENT_NOTIFICATION_OPENED,
            payload,
        )
    }

    private fun resolvePendingGeolocationPermissionRequest() {
        val origin = pendingGeolocationOrigin ?: return
        val callback = pendingGeolocationCallback ?: return
        pendingGeolocationOrigin = null
        pendingGeolocationCallback = null

        val granted = locationTracker.hasLocationPermission()
        callback.invoke(origin, granted, false)
        locationTracker.emitPermissionStatus()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)

        if (requestCode != RUNTIME_PERMISSIONS_REQUEST_CODE) {
            return
        }

        webAppInterface.onRuntimePermissionsChanged()

        val request = pendingWebPermissionRequest
        pendingWebPermissionRequest = null

        if (request != null) {
            val cameraGranted =
                ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
            if (cameraGranted) {
                handleWebPermissionRequest(request)
            } else {
                request.deny()
            }
        }

        resolvePendingGeolocationPermissionRequest()
    }

    override fun onResume() {
        super.onResume()
        suppressBackgroundNotificationPolling = false
        if (::webAppInterface.isInitialized) {
            webAppInterface.onRuntimePermissionsChanged()
            dispatchNetworkStatusChanged()
            dispatchAppLifecycleChanged("foreground")
            deliverPendingNotificationOpenIfNeeded()
        }
    }

    override fun onPause() {
        if (::webAppInterface.isInitialized) {
            dispatchAppLifecycleChanged("background")
        }
        super.onPause()
    }

    override fun onStart() {
        super.onStart()
        if (::backgroundNotificationPoller.isInitialized) {
            backgroundNotificationPoller.stop()
        }
    }

    override fun onStop() {
        if (::backgroundNotificationPoller.isInitialized && !suppressBackgroundNotificationPolling) {
            backgroundNotificationPoller.start()
        }
        super.onStop()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        captureNotificationIntent(intent)
        deliverPendingNotificationOpenIfNeeded()
    }

    override fun onBackPressed() {
        val currentWebView = webView
        if (currentWebView?.canGoBack() == true) {
            currentWebView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        unregisterNetworkCallback()
        if (::locationTracker.isInitialized) {
            locationTracker.stopTracking()
        }
        if (::backgroundNotificationPoller.isInitialized) {
            backgroundNotificationPoller.destroy()
        }
        webView?.destroy()
        webView = null
        super.onDestroy()
    }
}
