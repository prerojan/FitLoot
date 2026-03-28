package com.fitloot.health

import android.content.Context
import android.util.Log
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.LocalTime
import java.time.ZonedDateTime

class HealthConnectMetricsProvider(private val context: Context) {

    suspend fun readDailyMetrics(sessionSteps: Int): NativeMetricsSnapshot = withContext(Dispatchers.IO) {
        val timestamp = Instant.now().toString()

        try {
            if (!isAvailable(context)) {
                return@withContext NativeMetricsSnapshot(
                    sessionSteps = sessionSteps,
                    source = "sensor",
                    confidence = "derived",
                    timestamp = timestamp,
                )
            }

            val client = HealthConnectClient.getOrCreate(context)
            val granted = client.permissionController.getGrantedPermissions()
            if (!granted.containsAll(readPermissions)) {
                return@withContext NativeMetricsSnapshot(
                    sessionSteps = sessionSteps,
                    source = "sensor",
                    confidence = "derived",
                    timestamp = timestamp,
                    error = "missing_health_permissions",
                )
            }

            val now = ZonedDateTime.now()
            val response = client.aggregate(
                AggregateRequest(
                    metrics = setOf(
                        StepsRecord.COUNT_TOTAL,
                        DistanceRecord.DISTANCE_TOTAL,
                        ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL,
                        TotalCaloriesBurnedRecord.ENERGY_TOTAL,
                    ),
                    timeRangeFilter = TimeRangeFilter.between(
                        now.with(LocalTime.MIDNIGHT).toInstant(),
                        now.toInstant(),
                    ),
                )
            )

            return@withContext NativeMetricsSnapshot(
                sessionSteps = sessionSteps,
                stepsToday = response[StepsRecord.COUNT_TOTAL] ?: 0,
                distanceMeters = response[DistanceRecord.DISTANCE_TOTAL]?.inMeters ?: 0.0,
                activeCalories = response[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories ?: 0.0,
                totalCalories = response[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories ?: 0.0,
                source = "health_connect",
                confidence = "official",
                timestamp = timestamp,
            )
        } catch (error: Exception) {
            Log.e("HealthConnectMetrics", "Error fetching Health Connect metrics", error)
            return@withContext NativeMetricsSnapshot(
                sessionSteps = sessionSteps,
                source = "sensor",
                confidence = "derived",
                timestamp = timestamp,
                error = error.message,
            )
        }
    }

    companion object {
        val readPermissions: Set<String> = setOf(
            HealthPermission.getReadPermission(StepsRecord::class),
            HealthPermission.getReadPermission(DistanceRecord::class),
            HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
            HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
        )

        fun isAvailable(context: Context): Boolean {
            return HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE
        }
    }
}
