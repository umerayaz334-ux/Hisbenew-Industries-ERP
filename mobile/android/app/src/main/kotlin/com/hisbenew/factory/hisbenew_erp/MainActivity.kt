package com.hisbenew.factory.hisbenew_erp

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ResultReceiver
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var pendingMic: MethodChannel.Result? = null
    private var activityResumed = false

    override fun onResume() { super.onResume(); activityResumed = true }
    override fun onPause() {
        activityResumed = false
        super.onPause()
    }
    override fun onDestroy() {
        pendingMic?.success(false)
        pendingMic = null
        super.onDestroy()
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
        EventChannel(flutterEngine.dartExecutor.binaryMessenger, "hisbenew/voice_frames")
            .setStreamHandler(object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    VoiceRelay.setEvents(events)
                }

                override fun onCancel(arguments: Any?) {
                    VoiceRelay.setEvents(null)
                }
            })
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "hisbenew/phone").setMethodCallHandler { call, result ->
            if (call.method == "testRingtone") {
                result.success(PhoneRing.preview(this))
                return@setMethodCallHandler
            }
            if (call.method == "startIncomingRing") {
                PhoneRing.startIncoming(this)
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "stopIncomingRing") {
                PhoneRing.stop()
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "releaseCallTone") {
                PhoneRing.releaseForCall()
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "startOutgoingRing") {
                PhoneRing.startOutgoing(this)
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "stopOutgoingRing") {
                PhoneRing.releaseForCall()
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
                if (!activityResumed || ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    result.error("voice_permission", "Open the app and allow microphone access before starting audio", null)
                    return@setMethodCallHandler
                }
                val handler = Handler(Looper.getMainLooper())
                var completed = false
                val timeout = Runnable {
                    if (!completed) {
                        completed = true
                        stopService(Intent(this, VoiceCallService::class.java))
                        result.error("voice_service_timeout", "Microphone service did not become ready", null)
                    }
                }
                val ready = object : ResultReceiver(handler) {
                    override fun onReceiveResult(code: Int, data: Bundle?) {
                        if (completed) return
                        completed = true
                        handler.removeCallbacks(timeout)
                        if (code == 1) result.success(true)
                        else result.error("voice_service", "Android could not enable the microphone service", null)
                    }
                }
                try {
                    handler.postDelayed(timeout, 8000)
                    ContextCompat.startForegroundService(this, Intent(this, VoiceCallService::class.java).putExtra("ready", ready))
                } catch (error: Exception) {
                    completed = true
                    handler.removeCallbacks(timeout)
                    result.error("voice_service", "Open the app to start microphone audio", null)
                }
                return@setMethodCallHandler
            }
            if (call.method == "stopVoiceService") {
                PhoneRing.finishCall()
                stopService(Intent(this, VoiceCallService::class.java))
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "startVoiceRelay") {
                if (!activityResumed || ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    result.error("voice_permission", "Open the app and allow microphone access before starting audio", null)
                    return@setMethodCallHandler
                }
                try {
                    result.success(VoiceRelay.start(this))
                } catch (_: Exception) {
                    VoiceRelay.stop()
                    result.error("voice_relay", "Android could not start call audio", null)
                }
                return@setMethodCallHandler
            }
            if (call.method == "stopVoiceRelay") {
                VoiceRelay.stop()
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "playVoice") {
                val frame = call.arguments as? ByteArray
                if (frame == null) result.error("voice_frame", "Invalid audio frame", null)
                else {
                    VoiceRelay.play(frame)
                    result.success(true)
                }
                return@setMethodCallHandler
            }
            if (call.method == "setVoiceSpeaker") {
                VoiceRelay.setSpeaker(this, call.arguments as? Boolean == true)
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
}
