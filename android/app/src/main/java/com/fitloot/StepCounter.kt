package com.fitloot

import android.content.Context
import com.fitloot.health.HealthConnectMetricsProvider
import com.fitloot.health.SensorStepTracker
import org.json.JSONObject

class StepCounter(context: Context) {

    private val sensorStepTracker = SensorStepTracker(context)
    private val healthConnectMetricsProvider = HealthConnectMetricsProvider(context)

    fun start() {
        sensorStepTracker.start()
    }

    fun stop() {
        sensorStepTracker.stop()
    }

    fun getSessionSteps(): Int {
        return sensorStepTracker.getSessionSteps()
    }

    suspend fun getDailyMetrics(): JSONObject {
        return healthConnectMetricsProvider
            .readDailyMetrics(sensorStepTracker.getSessionSteps())
            .toJson()
    }
}
