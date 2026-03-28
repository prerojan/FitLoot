package com.fitloot

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.fitloot.databinding.ActivityCameraBinding
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class CameraActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "CameraActivity"
    }

    private lateinit var binding: ActivityCameraBinding
    private var imageCapture: ImageCapture? = null
    private lateinit var cameraExecutor: ExecutorService
    private var isCameraReady = false

    private val cameraPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            startCamera()
        } else {
            finishWithError("Permissão de câmera negada.")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityCameraBinding.inflate(layoutInflater)
        setContentView(binding.root)

        cameraExecutor = Executors.newSingleThreadExecutor()
        binding.viewFinder.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        binding.viewFinder.scaleType = PreviewView.ScaleType.FILL_CENTER
        binding.imageCaptureButton.isEnabled = false

        binding.imageCaptureButton.setOnClickListener { takePhoto() }

        if (hasCameraPermission()) {
            startCamera()
        } else {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    private fun startCamera() {
        if (!hasCameraPermission()) {
            finishWithError("Permissão de câmera não concedida.")
            return
        }

        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)

        cameraProviderFuture.addListener({
            val cameraProvider = runCatching { cameraProviderFuture.get() }.getOrElse { error ->
                Log.e(TAG, "Failed to obtain camera provider", error)
                finishWithError("Não foi possível inicializar a câmera.")
                return@addListener
            }

            val preview = Preview.Builder()
                .build()
                .also {
                    it.setSurfaceProvider(binding.viewFinder.surfaceProvider)
                }

            imageCapture = ImageCapture.Builder().build()

            val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    this, cameraSelector, preview, imageCapture
                )
                isCameraReady = true
                binding.imageCaptureButton.isEnabled = true
            } catch (exc: Exception) {
                Log.e(TAG, "Use case binding failed", exc)
                finishWithError("Não foi possível exibir o preview da câmera.")
            }

        }, ContextCompat.getMainExecutor(this))
    }

    private fun takePhoto() {
        if (!hasCameraPermission()) {
            finishWithError("Permissão de câmera não concedida.")
            return
        }

        val imageCapture = imageCapture ?: run {
            finishWithError("A câmera ainda não está pronta.")
            return
        }
        if (!isCameraReady) {
            finishWithError("A câmera ainda não está pronta.")
            return
        }

        binding.imageCaptureButton.isEnabled = false

        val photoFile = File(
            externalCacheDir,
            SimpleDateFormat("yyyy-MM-dd-HH-mm-ss-SSS", Locale.US)
                .format(System.currentTimeMillis()) + ".jpg"
        )

        val outputOptions = ImageCapture.OutputFileOptions.Builder(photoFile).build()

        imageCapture.takePicture(
            outputOptions,
            ContextCompat.getMainExecutor(this),
            object : ImageCapture.OnImageSavedCallback {
                override fun onError(exc: ImageCaptureException) {
                    Log.e(TAG, "Photo capture failed: ${exc.message}", exc)
                    binding.imageCaptureButton.isEnabled = true
                    finishWithError("Não foi possível capturar a foto.")
                }

                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                    val resultIntent = Intent()
                    resultIntent.putExtra("image_path", photoFile.absolutePath)
                    setResult(Activity.RESULT_OK, resultIntent)
                    finish()
                }
            }
        )
    }

    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
    }

    private fun finishWithError(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
        if (!isFinishing) {
            setResult(Activity.RESULT_CANCELED, Intent().putExtra("camera_error", message))
            finish()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::cameraExecutor.isInitialized) {
            cameraExecutor.shutdown()
        }
    }
}
