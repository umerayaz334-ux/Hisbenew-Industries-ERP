package com.hisbenew.factory.hisbenew_erp

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.provider.Settings
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
            if (call.method == "startOutgoingRing") {
                PhoneRing.startOutgoing(this)
                result.success(true)
                return@setMethodCallHandler
            }
            if (call.method == "stopOutgoingRing") {
                PhoneRing.stop()
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
}
