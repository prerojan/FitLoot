package com.fitloot.health

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import androidx.core.content.ContextCompat

class SensorStepTracker(context: Context) : SensorEventListener {

    private val appContext = context.applicationContext
    private val sensorManager = appContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val stepSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    private var sessionSteps = 0
    private var initialStepsAtStart = -1
    private var listening = false

    fun start(): Boolean {
        if (!hasActivityRecognitionPermission() || stepSensor == null) {
            return false
        }

        if (listening) {
            return true
        }

        listening = sensorManager.registerListener(this, stepSensor, SensorManager.SENSOR_DELAY_UI)
        return listening
    }

    fun stop() {
        sensorManager.unregisterListener(this)
        listening = false
        initialStepsAtStart = -1
        sessionSteps = 0
    }

    fun getSessionSteps(): Int {
        return sessionSteps
    }

    fun hasActivityRecognitionPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return true
        }

        return ContextCompat.checkSelfPermission(
            appContext,
            Manifest.permission.ACTIVITY_RECOGNITION,
        ) == PackageManager.PERMISSION_GRANTED
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (event != null && event.sensor.type == Sensor.TYPE_STEP_COUNTER) {
            val totalStepsEver = event.values[0].toInt()
            if (initialStepsAtStart == -1) {
                initialStepsAtStart = totalStepsEver
            }
            sessionSteps = totalStepsEver - initialStepsAtStart
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}
