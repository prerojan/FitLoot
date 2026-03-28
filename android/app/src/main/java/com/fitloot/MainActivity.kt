package com.fitloot

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import com.fitloot.bridge.FitLootWebViewConfigurator
import com.fitloot.bridge.NativeBridgeContract
import com.fitloot.health.HealthConnectPermissionCoordinator
import com.fitloot.media.NativeMediaPayloadFactory
import com.fitloot.databinding.ActivityMainBinding
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var webAppInterface: WebAppInterface

    private val cameraResultLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val imagePath = result.data?.getStringExtra("image_path")
            if (imagePath != null) {
                webAppInterface.sendEventToWebApp(
                    NativeBridgeContract.EVENT_CAMERA_CAPTURED,
                    NativeMediaPayloadFactory.fromCameraPath(imagePath),
                )
            }
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

        FitLootWebViewConfigurator.configure(webView) { intent ->
            startActivity(intent)
        }
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
            ActivityCompat.requestPermissions(this, listPermissionsNeeded.toTypedArray(), 100)
        }

        requestHealthConnectPermissionsIfNeeded()
    }

    private fun requestHealthConnectPermissionsIfNeeded() {
        lifecycleScope.launch {
            runCatching {
                HealthConnectPermissionCoordinator.requestIfNeeded(this@MainActivity, healthPermissionsLauncher)
            }
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
