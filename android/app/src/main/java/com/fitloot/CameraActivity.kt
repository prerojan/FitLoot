package com.fitloot

import android.Manifest
import android.animation.ObjectAnimator
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.animation.LinearInterpolator
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
import androidx.core.view.doOnLayout
import com.fitloot.databinding.ActivityCameraBinding
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class CameraActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "CameraActivity"
        private const val PREVIEW_TIMEOUT_MS = 2500L
    }

    private lateinit var binding: ActivityCameraBinding
    private var imageCapture: ImageCapture? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private lateinit var cameraExecutor: ExecutorService
    private val mainHandler = Handler(Looper.getMainLooper())
    private var isCameraReady = false
    private var scannerLineAnimator: ObjectAnimator? = null
    private var previewTimeoutRunnable: Runnable? = null

    private val cameraPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            startCamera()
        } else {
            finishWithError("Permissao de camera negada.")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityCameraBinding.inflate(layoutInflater)
        setContentView(binding.root)

        cameraExecutor = Executors.newSingleThreadExecutor()
        binding.viewFinder.implementationMode = PreviewView.ImplementationMode.PERFORMANCE
        binding.viewFinder.scaleType = PreviewView.ScaleType.FILL_CENTER
        setCaptureEnabled(false)

        binding.captureButtonContainer.setOnClickListener { takePhoto() }
        binding.closeButton.setOnClickListener { finishCanceled() }

        binding.viewFinder.previewStreamState.observe(this) { streamState ->
            val isStreaming = streamState == PreviewView.StreamState.STREAMING
            isCameraReady = isStreaming
            setCaptureEnabled(isStreaming)

            if (isStreaming) {
                clearPreviewTimeout()
                startScannerLineAnimation()
                binding.captureHint.text = "Centralize o alimento no quadro"
            } else {
                stopScannerLineAnimation()
            }
        }

        if (hasCameraPermission()) {
            startCamera()
        } else {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    private fun startCamera() {
        if (!hasCameraPermission()) {
            finishWithError("Permissao de camera nao concedida.")
            return
        }

        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        schedulePreviewTimeout()

        cameraProviderFuture.addListener({
            val provider = runCatching { cameraProviderFuture.get() }.getOrElse { error ->
                Log.e(TAG, "Failed to obtain camera provider", error)
                finishWithError("Nao foi possivel inicializar a camera.")
                return@addListener
            }

            cameraProvider = provider

            val rotation = binding.viewFinder.display?.rotation ?: 0

            val preview = Preview.Builder()
                .setTargetRotation(rotation)
                .build()
                .also { configuredPreview ->
                    configuredPreview.setSurfaceProvider(binding.viewFinder.surfaceProvider)
                }

            imageCapture = ImageCapture.Builder()
                .setTargetRotation(rotation)
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .build()

            try {
                provider.unbindAll()
                provider.bindToLifecycle(
                    this,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    imageCapture,
                )
            } catch (error: Exception) {
                Log.e(TAG, "Use case binding failed", error)
                finishWithError("Nao foi possivel exibir o preview da camera.")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun takePhoto() {
        if (!hasCameraPermission()) {
            finishWithError("Permissao de camera nao concedida.")
            return
        }

        val currentImageCapture = imageCapture ?: run {
            finishWithError("A camera ainda nao esta pronta.")
            return
        }

        if (!isCameraReady) {
            finishWithError("A camera ainda nao esta pronta.")
            return
        }

        setCaptureEnabled(false)

        val photoFile = File(
            externalCacheDir,
            SimpleDateFormat("yyyy-MM-dd-HH-mm-ss-SSS", Locale.US)
                .format(System.currentTimeMillis()) + ".jpg",
        )

        val outputOptions = ImageCapture.OutputFileOptions.Builder(photoFile).build()

        currentImageCapture.takePicture(
            outputOptions,
            ContextCompat.getMainExecutor(this),
            object : ImageCapture.OnImageSavedCallback {
                override fun onError(exc: ImageCaptureException) {
                    Log.e(TAG, "Photo capture failed: ${exc.message}", exc)
                    setCaptureEnabled(true)
                    finishWithError("Nao foi possivel capturar a foto.")
                }

                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                    val resultIntent = Intent().apply {
                        putExtra("image_path", photoFile.absolutePath)
                    }
                    setResult(Activity.RESULT_OK, resultIntent)
                    finish()
                }
            },
        )
    }

    private fun setCaptureEnabled(enabled: Boolean) {
        binding.captureButtonContainer.isEnabled = enabled
        binding.captureButtonContainer.alpha = if (enabled) 1f else 0.5f
        binding.captureHint.alpha = if (enabled) 1f else 0.65f
    }

    private fun schedulePreviewTimeout() {
        clearPreviewTimeout()
        previewTimeoutRunnable = Runnable {
            if (!isCameraReady) {
                finishWithError("Nao foi possivel exibir o preview da camera.")
            }
        }.also { runnable ->
            mainHandler.postDelayed(runnable, PREVIEW_TIMEOUT_MS)
        }
    }

    private fun clearPreviewTimeout() {
        previewTimeoutRunnable?.let(mainHandler::removeCallbacks)
        previewTimeoutRunnable = null
    }

    private fun startScannerLineAnimation() {
        binding.scannerFrameContainer.doOnLayout { frame ->
            val travelDistance = (frame.height - binding.scannerLine.height - 56.dpToPx()).coerceAtLeast(0)
            if (travelDistance <= 0) {
                binding.scannerLine.translationY = 0f
                return@doOnLayout
            }

            if (scannerLineAnimator?.isRunning == true) {
                return@doOnLayout
            }

            scannerLineAnimator?.cancel()
            scannerLineAnimator = ObjectAnimator.ofFloat(binding.scannerLine, View.TRANSLATION_Y, 0f, travelDistance.toFloat()).apply {
                duration = 2600L
                repeatCount = ObjectAnimator.INFINITE
                repeatMode = ObjectAnimator.RESTART
                interpolator = LinearInterpolator()
                start()
            }
        }
    }

    private fun stopScannerLineAnimation() {
        scannerLineAnimator?.cancel()
        scannerLineAnimator = null
        binding.scannerLine.translationY = 0f
    }

    private fun finishCanceled() {
        if (!isFinishing) {
            setResult(Activity.RESULT_CANCELED)
            finish()
        }
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
        clearPreviewTimeout()
        stopScannerLineAnimation()
        cameraProvider?.unbindAll()
        if (::cameraExecutor.isInitialized) {
            cameraExecutor.shutdown()
        }
        super.onDestroy()
    }

    private fun Int.dpToPx(): Int {
        return (this * resources.displayMetrics.density).toInt()
    }
}
