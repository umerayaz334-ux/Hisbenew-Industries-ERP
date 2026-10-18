package com.hisbenew.factory.hisbenew_erp

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.media.AudioManager
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Handler
import android.os.Looper
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var pendingMic: MethodChannel.Result? = null
    private var previewRingtone: Ringtone? = null
    private var incomingRingtone: Ringtone? = null
    private var outgoingRingtone: Ringtone? = null

    private fun bundledRing(usage: Int, contentType: Int, streamType: Int, loop: Boolean): Ringtone {
        val ringtone = RingtoneManager.getRingtone(this, Uri.parse("android.resource://$packageName/${R.raw.hisbenew_ring}"))
        ringtone.audioAttributes = AudioAttributes.Builder()
            .setUsage(usage)
            .setContentType(contentType)
            .setLegacyStreamType(streamType)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            ringtone.isLooping = loop
            ringtone.volume = 1f
        }
        return ringtone
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        super.onCreate(savedInstanceState)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "hisbenew/phone").setMethodCallHandler { call, result ->
            if (call.method == "testRingtone") {
                val audio = getSystemService(AUDIO_SERVICE) as AudioManager
                if (audio.ringerMode != AudioManager.RINGER_MODE_NORMAL || audio.getStreamVolume(AudioManager.STREAM_RING) == 0) {
                    result.success(false)
                    return@setMethodCallHandler
                }
                previewRingtone?.stop()
                val ringtone = bundledRing(AudioAttributes.USAGE_NOTIFICATION_RINGTONE, AudioAttributes.CONTENT_TYPE_SONIFICATION, AudioManager.STREAM_RING, loop = false)
                previewRingtone = ringtone
                ringtone.play()
                Handler(Looper.getMainLooper()).postDelayed({ ringtone.stop() }, 4000)
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "startIncomingRing") {
                val audio = getSystemService(AUDIO_SERVICE) as AudioManager
                if (audio.ringerMode == AudioManager.RINGER_MODE_NORMAL && audio.getStreamVolume(AudioManager.STREAM_RING) > 0) {
                    incomingRingtone?.stop()
                    incomingRingtone = bundledRing(AudioAttributes.USAGE_NOTIFICATION_RINGTONE, AudioAttributes.CONTENT_TYPE_SONIFICATION, AudioManager.STREAM_RING, loop = true)
                    incomingRingtone?.play()
                }
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "stopIncomingRing") {
                incomingRingtone?.stop()
                incomingRingtone = null
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "startOutgoingRing") {
                incomingRingtone?.stop()
                incomingRingtone = null
                outgoingRingtone?.stop()
                val audio = getSystemService(AUDIO_SERVICE) as AudioManager
                audio.mode = AudioManager.MODE_IN_COMMUNICATION
                outgoingRingtone = bundledRing(AudioAttributes.USAGE_VOICE_COMMUNICATION, AudioAttributes.CONTENT_TYPE_SPEECH, AudioManager.STREAM_VOICE_CALL, loop = true)
                outgoingRingtone?.play()
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "stopOutgoingRing") {
                outgoingRingtone?.stop()
                outgoingRingtone = null
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "soundSettings") {
                startActivity(Intent(Settings.ACTION_SOUND_SETTINGS))
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "notificationSettings") {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
                } else {
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                }
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "soundSettings") {
                startActivity(Intent(Settings.ACTION_SOUND_SETTINGS))
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "notificationSettings") {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
                } else {
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                }
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "openSettings") {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "startVoiceService") {
                try {
                    ContextCompat.startForegroundService(this, Intent(this, VoiceCallService::class.java))
                    result.success(true)
                } catch (error: Exception) {
                    result.error("voice_service", "Open the app to start microphone audio", null)
                }
                return@setMethodCallHandler
            }
            if (call.method == "stopVoiceService") {
                stopService(Intent(this, VoiceCallService::class.java))
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "microphoneStatus") {
                result.success(
                    ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED,
                )
                return@setMethodCallHandler
            }
            if (call.method != "microphone") {
                result.notImplemented()
                return@setMethodCallHandler
            }
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                result.success(true)
                return@setMethodCallHandler
            }
            if (pendingMic != null) {
                result.error("permission_pending", "Microphone permission is already open", null)
                return@setMethodCallHandler
            }
            pendingMic = result
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), 4101)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 4101) return
        val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        pendingMic?.success(granted)
        pendingMic = null
    }

    override fun onPause() {
        previewRingtone?.stop()
        super.onPause()
    }

    override fun onDestroy() {
        incomingRingtone?.stop()
        outgoingRingtone?.stop()
        super.onDestroy()
    }
}
