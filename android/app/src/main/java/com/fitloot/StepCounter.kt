package com.fitloot

import android.content.Context
import com.fitloot.health.HealthConnectMetricsProvider
import com.fitloot.health.SensorStepTracker
import org.json.JSONObject

class StepCounter(context: Context) {

    private val sensorStepTracker = SensorStepTracker(context)
    private val healthConnectMetricsProvider = HealthConnectMetricsProvider(context)

    fun start(): Boolean {
        return sensorStepTracker.start()
    }

    fun stop() {
        sensorStepTracker.stop()
    }

    fun getSessionSteps(): Int {
        return sensorStepTracker.getSessionSteps()
    }

    fun hasActivityRecognitionPermission(): Boolean {
        return sensorStepTracker.hasActivityRecognitionPermission()
    }

    suspend fun getDailyMetrics(): JSONObject {
        return healthConnectMetricsProvider
            .readDailyMetrics(sensorStepTracker.getSessionSteps())
            .toJson()
    }
}
