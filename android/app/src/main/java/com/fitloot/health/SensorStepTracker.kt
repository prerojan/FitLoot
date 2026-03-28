package com.fitloot.health

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager

class SensorStepTracker(context: Context) : SensorEventListener {

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val stepSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    private var sessionSteps = 0
    private var initialStepsAtStart = -1

    fun start() {
        if (stepSensor != null) {
            sensorManager.registerListener(this, stepSensor, SensorManager.SENSOR_DELAY_UI)
        }
    }

    fun stop() {
        sensorManager.unregisterListener(this)
        initialStepsAtStart = -1
        sessionSteps = 0
    }

    fun getSessionSteps(): Int {
        return sessionSteps
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
