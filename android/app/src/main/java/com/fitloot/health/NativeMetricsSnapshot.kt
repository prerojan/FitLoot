package com.fitloot.health

import org.json.JSONObject

data class NativeMetricsSnapshot(
    val sessionSteps: Int,
    val stepsToday: Long? = null,
    val distanceMeters: Double? = null,
    val activeCalories: Double? = null,
    val totalCalories: Double? = null,
    val source: String,
    val confidence: String,
    val timestamp: String,
    val error: String? = null,
) {
    fun toJson(): JSONObject {
        return JSONObject().apply {
            put("sessionSteps", sessionSteps)
            put("timestamp", timestamp)
            put("stepsToday", stepsToday)
            put("distanceMeters", distanceMeters)
            put("activeCalories", activeCalories)
            put("calories", totalCalories)
            put("source", source)
            put("confidence", confidence)
            if (!error.isNullOrBlank()) {
                put("error", error)
            }
        }
    }
}
