package com.fitloot

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log

class StepCounter(private val context: Context) : SensorEventListener {

    private var sensorManager: SensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private var stepSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    private var totalStepsSinceStart = 0
    private var initialStepsAtStart = -1

    fun start() {
        if (stepSensor != null) {
            sensorManager.registerListener(this, stepSensor, SensorManager.SENSOR_DELAY_UI)
            Log.d("StepCounter", "Step sensor started")
        } else {
            Log.e("StepCounter", "Step sensor not available")
        }
    }

    fun stop() {
        sensorManager.unregisterListener(this)
        initialStepsAtStart = -1
        Log.d("StepCounter", "Step sensor stopped")
    }

    fun getSteps(): Int {
        return totalStepsSinceStart
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (event != null && event.sensor.type == Sensor.TYPE_STEP_COUNTER) {
            val totalStepsEver = event.values[0].toInt()
            
            if (initialStepsAtStart == -1) {
                initialStepsAtStart = totalStepsEver
            }
            
            totalStepsSinceStart = totalStepsEver - initialStepsAtStart
            Log.d("StepCounter", "Steps: $totalStepsSinceStart (Total: $totalStepsEver)")
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // Not needed for simple step counting
    }
}
