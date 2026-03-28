package com.fitloot

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import com.fitloot.bridge.FitLootWebViewConfigurator
import com.fitloot.bridge.NativeBridgeContract
import com.fitloot.health.HealthConnectPermissionCoordinator
import com.fitloot.media.NativeMediaPayloadFactory
import com.fitloot.databinding.ActivityMainBinding
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    companion object {
        private const val RUNTIME_PERMISSIONS_REQUEST_CODE = 100
        private const val TAG = "MainActivity"
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var webAppInterface: WebAppInterface
    private var webView: WebView? = null
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var pendingWebPermissionRequest: PermissionRequest? = null

    private val cameraResultLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupWebView()
    }

    private fun setupWebView(): Boolean {
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

        webAppInterface = WebAppInterface(
            this,
            createdWebView,
            onCameraRequest = { intent -> cameraResultLauncher.launch(intent) },
            onGalleryRequest = { intent -> galleryResultLauncher.launch(intent) },
            onPermissionsRequest = { requestAppPermissions() }
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
                    fileChooserLauncher.launch(chooserIntent)
                }.isSuccess
            },
            onPermissionRequest = { request ->
                handleWebPermissionRequest(request)
            },
        )
        createdWebView.addJavascriptInterface(webAppInterface, NativeBridgeContract.BRIDGE_NAME)
        FitLootWebViewConfigurator.loadHome(createdWebView)
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

    private fun requestAppPermissions() {
        requestRuntimePermissions(includeActivityRecognition = true)
        requestHealthConnectPermissionsIfNeeded()
    }

    private fun requestRuntimePermissions(includeActivityRecognition: Boolean) {
        val permissions = mutableListOf(
            Manifest.permission.CAMERA,
        )
        if (includeActivityRecognition) {
            permissions.add(Manifest.permission.ACTIVITY_RECOGNITION)
        }

        val listPermissionsNeeded = ArrayList<String>()
        for (p in permissions) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                listPermissionsNeeded.add(p)
            }
        }
        if (listPermissionsNeeded.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, listPermissionsNeeded.toTypedArray(), RUNTIME_PERMISSIONS_REQUEST_CODE)
        }
    }

    private fun handleWebPermissionRequest(request: PermissionRequest) {
        val requestedResources = request.resources.toList()
        val grantedResources = mutableListOf<String>()

        val needsCamera = requestedResources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
        val hasCameraPermission = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

        if (needsCamera && !hasCameraPermission) {
            pendingWebPermissionRequest = request
            requestRuntimePermissions(includeActivityRecognition = false)
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

    private fun requestHealthConnectPermissionsIfNeeded() {
        lifecycleScope.launch {
            runCatching {
                HealthConnectPermissionCoordinator.requestIfNeeded(this@MainActivity, healthPermissionsLauncher)
            }
        }
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

        val request = pendingWebPermissionRequest ?: return
        pendingWebPermissionRequest = null

        val cameraGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        if (cameraGranted) {
            handleWebPermissionRequest(request)
        } else {
            request.deny()
        }
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
        webView?.destroy()
        webView = null
        super.onDestroy()
    }
}
