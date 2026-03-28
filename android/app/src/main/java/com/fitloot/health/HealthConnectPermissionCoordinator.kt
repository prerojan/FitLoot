package com.fitloot.health

import android.content.Context
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient

object HealthConnectPermissionCoordinator {

    val permissions: Set<String> = HealthConnectMetricsProvider.readPermissions

    suspend fun requestIfNeeded(
        context: Context,
        launcher: ActivityResultLauncher<Set<String>>,
    ) {
        if (!HealthConnectMetricsProvider.isAvailable(context)) {
            return
        }

        val client = HealthConnectClient.getOrCreate(context)
        val granted = client.permissionController.getGrantedPermissions()
        if (!granted.containsAll(permissions)) {
            launcher.launch(permissions)
        }
    }
}
