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
import java.time.LocalDate

class SensorStepTracker(context: Context) : SensorEventListener {

    private val appContext = context.applicationContext
    private val sensorManager = appContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val stepSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
    private val sharedPreferences =
        appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private var sessionSteps = 0
    private var initialStepsAtStart = -1
    private var accumulatedStepsBeforeReset = 0
    private var lastRawTotal = -1
    private var listening = false

    fun start(): Boolean {
        if (!hasActivityRecognitionPermission() || stepSensor == null) {
            return false
        }

        restorePersistedState()

        if (listening) {
            return true
        }

        listening = sensorManager.registerListener(this, stepSensor, SensorManager.SENSOR_DELAY_UI)
        return listening
    }

    fun stop() {
        sensorManager.unregisterListener(this)
        listening = false
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

            val todayKey = currentDateKey()
            val storedDate = sharedPreferences.getString(KEY_TRACKING_DATE, null)
            if (storedDate != todayKey) {
                initialStepsAtStart = totalStepsEver
                accumulatedStepsBeforeReset = 0
                sessionSteps = 0
            } else {
                if (initialStepsAtStart == -1) {
                    initialStepsAtStart = totalStepsEver
                }

                if (lastRawTotal >= 0 && totalStepsEver < lastRawTotal) {
                    accumulatedStepsBeforeReset = sessionSteps
                    initialStepsAtStart = totalStepsEver
                }
            }

            val liveStepsSinceBaseline = if (initialStepsAtStart >= 0) {
                maxOf(0, totalStepsEver - initialStepsAtStart)
            } else {
                0
            }

            sessionSteps = accumulatedStepsBeforeReset + liveStepsSinceBaseline
            lastRawTotal = totalStepsEver
            persistState(todayKey)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private fun restorePersistedState() {
        val todayKey = currentDateKey()
        val storedDate = sharedPreferences.getString(KEY_TRACKING_DATE, null)
        if (storedDate != todayKey) {
            sessionSteps = 0
            initialStepsAtStart = -1
            accumulatedStepsBeforeReset = 0
            lastRawTotal = -1
            return
        }

        sessionSteps = sharedPreferences.getInt(KEY_LAST_DAY_STEPS, 0)
        initialStepsAtStart = sharedPreferences.getInt(KEY_BASELINE_TOTAL, -1)
        accumulatedStepsBeforeReset = sharedPreferences.getInt(KEY_ACCUMULATED_STEPS, 0)
        lastRawTotal = sharedPreferences.getInt(KEY_LAST_RAW_TOTAL, -1)
    }

    private fun persistState(todayKey: String) {
        sharedPreferences.edit()
            .putString(KEY_TRACKING_DATE, todayKey)
            .putInt(KEY_BASELINE_TOTAL, initialStepsAtStart)
            .putInt(KEY_ACCUMULATED_STEPS, accumulatedStepsBeforeReset)
            .putInt(KEY_LAST_RAW_TOTAL, lastRawTotal)
            .putInt(KEY_LAST_DAY_STEPS, sessionSteps)
            .apply()
    }

    private fun currentDateKey(): String {
        return LocalDate.now().toString()
    }

    private companion object {
        const val PREFS_NAME = "fitloot_sensor_step_tracker"
        const val KEY_TRACKING_DATE = "tracking_date"
        const val KEY_BASELINE_TOTAL = "baseline_total"
        const val KEY_ACCUMULATED_STEPS = "accumulated_steps"
        const val KEY_LAST_RAW_TOTAL = "last_raw_total"
        const val KEY_LAST_DAY_STEPS = "last_day_steps"
    }
}
