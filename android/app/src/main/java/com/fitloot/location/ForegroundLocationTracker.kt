package com.fitloot.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import org.json.JSONObject
import java.time.Instant

class ForegroundLocationTracker(
    context: Context,
    private val onLocationUpdated: (JSONObject) -> Unit,
    private val onPermissionChanged: (JSONObject) -> Unit,
) {
    private val appContext = context.applicationContext
    private val fusedLocationClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(appContext)
    private var locationCallback: LocationCallback? = null

    fun hasLocationPermission(): Boolean {
        return hasFineLocationPermission() || hasCoarseLocationPermission()
    }

    fun hasFineLocationPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            appContext,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun hasCoarseLocationPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            appContext,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun emitPermissionStatus() {
        onPermissionChanged(buildPermissionStatusJson())
    }

    fun requestCurrentLocation() {
        if (!hasLocationPermission()) {
            emitPermissionStatus()
            return
        }

        val cancellationTokenSource = CancellationTokenSource()
        val request = CurrentLocationRequest.Builder()
            .setPriority(resolvePriority())
            .setMaxUpdateAgeMillis(10_000)
            .build()

        fusedLocationClient
            .getCurrentLocation(request, cancellationTokenSource.token)
            .addOnSuccessListener { location ->
                if (location != null) {
                    onLocationUpdated(buildLocationJson(location))
                } else {
                    emitPermissionStatus()
                }
            }
            .addOnFailureListener {
                emitPermissionStatus()
            }
    }

    fun startTracking() {
        if (!hasLocationPermission() || locationCallback != null) {
            emitPermissionStatus()
            return
        }

        val request = LocationRequest.Builder(resolvePriority(), 5_000L)
            .setMinUpdateIntervalMillis(2_000L)
            .setWaitForAccurateLocation(hasFineLocationPermission())
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val location = result.lastLocation ?: return
                onLocationUpdated(buildLocationJson(location))
            }
        }

        fusedLocationClient.requestLocationUpdates(
            request,
            locationCallback as LocationCallback,
            Looper.getMainLooper(),
        )
        emitPermissionStatus()
    }

    fun stopTracking() {
        locationCallback?.let { callback ->
            fusedLocationClient.removeLocationUpdates(callback)
        }
        locationCallback = null
    }

    fun buildPermissionStatusJson(): JSONObject {
        val hasFine = hasFineLocationPermission()
        val hasCoarse = hasCoarseLocationPermission()
        val granted = hasFine || hasCoarse
        val precision =
            when {
                hasFine -> "precise"
                hasCoarse -> "approximate"
                else -> "unavailable"
            }

        return JSONObject().apply {
            put("granted", granted)
            put("precise", hasFine)
            put("approximate", !hasFine && hasCoarse)
            put("permission", if (granted) "granted" else "denied")
            put("precision", precision)
            put("timestamp", Instant.now().toString())
        }
    }

    private fun buildLocationJson(location: Location): JSONObject {
        val precision = if (hasFineLocationPermission()) "precise" else "approximate"

        return JSONObject().apply {
            put("latitude", location.latitude)
            put("longitude", location.longitude)
            put("accuracyMeters", location.accuracy.toDouble())
            put("precision", precision)
            put("timestamp", java.time.Instant.ofEpochMilli(location.time).toString())
            put("source", "android-native")
        }
    }

    private fun resolvePriority(): Int {
        return if (hasFineLocationPermission()) {
            Priority.PRIORITY_HIGH_ACCURACY
        } else {
            Priority.PRIORITY_BALANCED_POWER_ACCURACY
        }
    }
}
