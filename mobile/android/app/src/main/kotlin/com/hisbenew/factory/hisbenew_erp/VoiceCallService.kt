package com.hisbenew.factory.hisbenew_erp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/** Started from the visible call screen, before opening the microphone. */
class VoiceCallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(NotificationChannel("hisbenew_voice", "Ongoing calls", NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(this, 7012,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, "hisbenew_voice")
            .setSmallIcon(R.drawable.ic_stat_hisbenew)
            .setContentTitle("Hisbenew voice call")
            .setContentText("Tap to return to your call")
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setSilent(true)
            .build()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                startForeground(7012, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            } else {
                startForeground(7012, notification)
            }
        } catch (error: SecurityException) {
            stopSelf()
        }
        return START_NOT_STICKY
    }
}
