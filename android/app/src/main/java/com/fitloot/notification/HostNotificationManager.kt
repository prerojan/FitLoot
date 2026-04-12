package com.fitloot.notification

import android.Manifest
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.result.ActivityResultLauncher
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.fitloot.MainActivity
import com.fitloot.R
import org.json.JSONObject
import java.time.Instant

class HostNotificationManager(
    private val context: Context,
) {

    companion object {
        private const val SOCIAL_CHANNEL_ID = "fitloot_social"
        private const val REWARDS_CHANNEL_ID = "fitloot_rewards"
        const val EXTRA_NOTIFICATION_ROUTE = "fitloot_notification_route"
        const val EXTRA_NOTIFICATION_TYPE = "fitloot_notification_type"

        fun extractNotificationOpenPayload(intent: Intent?): JSONObject? {
            val route = intent?.getStringExtra(EXTRA_NOTIFICATION_ROUTE)?.trim()
            if (route.isNullOrBlank()) {
                return null
            }

            val notificationType = intent.getStringExtra(EXTRA_NOTIFICATION_TYPE)?.trim()
            return JSONObject().apply {
                put("route", route)
                put("notification_type", if (notificationType == "reward") "reward" else "social")
                put("timestamp", Instant.now().toString())
            }
        }
    }

    init {
        ensureChannels()
    }

    fun requestPermissionIfNeeded(
        activity: Activity,
        launcher: ActivityResultLauncher<String>,
    ) {
        if (hasPermission()) {
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    fun hasPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return true
        }

        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
    }

    fun buildPermissionStatusJson(): JSONObject {
        val granted = hasPermission()
        return JSONObject().apply {
            put("granted", granted)
            put("permission", if (granted) "granted" else "prompt")
            put("timestamp", Instant.now().toString())
        }
    }

    fun showSocialNotification(notification: JSONObject) {
        if (!hasPermission()) return

        val conversationId = notification.optInt("conversation_id", 0)
        val messageId = notification.optInt("message_id", 0)
        val senderName = notification.optString("sender_full_name")
            .ifBlank { notification.optString("sender_username") }
            .ifBlank { "Nova mensagem" }
        val messageText = notification.optString("message_text")
            .ifBlank { "Voce recebeu uma nova mensagem." }
        val conversationTitle = notification.optString("conversation_title")
            .ifBlank { "Social Hub" }
        val route = if (conversationId > 0) "/friends?conversationId=$conversationId" else "/friends"
        val requestCode = if (messageId > 0) messageId else conversationId

        NotificationManagerCompat.from(context).notify(
            20_000 + requestCode,
            NotificationCompat.Builder(context, SOCIAL_CHANNEL_ID)
                .setSmallIcon(R.mipmap.fitloot_round)
                .setContentTitle(senderName)
                .setContentText(messageText)
                .setSubText(conversationTitle)
                .setStyle(NotificationCompat.BigTextStyle().bigText(messageText))
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(buildContentIntent(route, "social", requestCode))
                .build(),
        )
    }

    fun showRewardNotification(notification: JSONObject) {
        if (!hasPermission()) return

        val notificationId = notification.optInt("id", 0)
        val type = notification.optString("type").trim().lowercase()
        val title = when (type) {
            "achievement_unlocked" -> notification.optString("name").ifBlank { "Nova conquista" }
            "title_unlocked" -> notification.optString("name").ifBlank { "Novo titulo" }
            else -> "Level up"
        }
        val message = when (type) {
            "achievement_unlocked" -> "Sua nova conquista ja esta disponivel."
            "title_unlocked" -> "Voce liberou um novo titulo."
            else -> {
                val level = notification.optInt("level", 0)
                if (level > 0) "Voce alcancou o nivel $level." else "Voce subiu de nivel."
            }
        }
        val route = when (type) {
            "achievement_unlocked", "title_unlocked" -> "/achievements"
            else -> "/dashboard"
        }
        val requestCode = if (notificationId > 0) notificationId else title.hashCode()

        NotificationManagerCompat.from(context).notify(
            40_000 + requestCode,
            NotificationCompat.Builder(context, REWARDS_CHANNEL_ID)
                .setSmallIcon(R.mipmap.fitloot_round)
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(message))
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(buildContentIntent(route, "reward", requestCode))
                .build(),
        )
    }

    private fun ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }

        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channels = listOf(
            NotificationChannel(
                SOCIAL_CHANNEL_ID,
                "Mensagens",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Mensagens recebidas no Social Hub enquanto o app estiver em segundo plano."
            },
            NotificationChannel(
                REWARDS_CHANNEL_ID,
                "Conquistas",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Conquistas e progresso relevantes enquanto o app estiver em segundo plano."
            },
        )
        manager.createNotificationChannels(channels)
    }

    private fun buildContentIntent(
        route: String,
        notificationType: String,
        requestCode: Int,
    ): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_NOTIFICATION_ROUTE, route)
            putExtra(EXTRA_NOTIFICATION_TYPE, notificationType)
        }

        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
