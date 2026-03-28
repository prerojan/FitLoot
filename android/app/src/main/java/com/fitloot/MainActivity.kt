package com.fitloot

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
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
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var webAppInterface: WebAppInterface
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
        checkPermissions()
    }

    private fun setupWebView() {
        val webView = binding.webView
        webAppInterface = WebAppInterface(
            this,
            webView,
            onCameraRequest = { intent -> cameraResultLauncher.launch(intent) },
            onGalleryRequest = { intent -> galleryResultLauncher.launch(intent) },
            onPermissionsRequest = { checkPermissions() }
        )

        FitLootWebViewConfigurator.configure(
            webView = webView,
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
        webView.addJavascriptInterface(webAppInterface, NativeBridgeContract.BRIDGE_NAME)
        FitLootWebViewConfigurator.loadHome(webView)
    }

    private fun checkPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.CAMERA,
            Manifest.permission.ACTIVITY_RECOGNITION
        )

        val listPermissionsNeeded = ArrayList<String>()
        for (p in permissions) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                listPermissionsNeeded.add(p)
            }
        }
        if (listPermissionsNeeded.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, listPermissionsNeeded.toTypedArray(), RUNTIME_PERMISSIONS_REQUEST_CODE)
        }

        requestHealthConnectPermissionsIfNeeded()
    }

    private fun handleWebPermissionRequest(request: PermissionRequest) {
        val requestedResources = request.resources.toList()
        val grantedResources = mutableListOf<String>()

        val needsCamera = requestedResources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
        val hasCameraPermission = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

        if (needsCamera && !hasCameraPermission) {
            pendingWebPermissionRequest = request
            checkPermissions()
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
        if (binding.webView.canGoBack()) {
            binding.webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
