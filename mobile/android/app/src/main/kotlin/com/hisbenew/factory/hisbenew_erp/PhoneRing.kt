package com.hisbenew.factory.hisbenew_erp

import android.app.Application
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Plays the bundled call tone with MediaPlayer. Ringtone.play() shows the
 * incoming screen on Redmi phones and then produces no sound.
 */
object PhoneRing {
    private val handler = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var focusRequest: AudioFocusRequest? = null
    private var previousMode = AudioManager.MODE_NORMAL
    private var previousSpeaker = false
    private var playingKind = ""
    private var callOwnsAudio = false
    private var vibrator: Vibrator? = null
    private val stopLater = Runnable { stop() }

    fun install(@Suppress("UNUSED_PARAMETER") application: Application) = Unit

    fun startIncoming(context: Context) {
        handler.post {
            if (!canRing(context)) {
                if ((context.getSystemService(Context.AUDIO_SERVICE) as AudioManager).ringerMode == AudioManager.RINGER_MODE_VIBRATE) {
                    vibrate(context)
                }
                return@post
            }
            silenceCallKit()
            if (playingKind == "incoming" && player != null) return@post
            start(context, "incoming", AudioAttributes.USAGE_NOTIFICATION_RINGTONE, AudioManager.STREAM_RING, AudioManager.MODE_RINGTONE, speaker = true)
            handler.postDelayed({
                if (playingKind != "incoming") return@postDelayed
                silenceCallKit()
                if (player == null) {
                    start(context, "incoming", AudioAttributes.USAGE_NOTIFICATION_RINGTONE, AudioManager.STREAM_RING, AudioManager.MODE_RINGTONE, speaker = true)
                }
            }, 400)
        }
    }

    fun startOutgoing(context: Context) {
        handler.post {
            silenceCallKit()
            if (playingKind == "outgoing" && player != null) return@post
            // Keep this on the earpiece. Forcing the loudspeaker for the
            // ringback plays a blast, then the call audio pulls it back down.
            start(
                context,
                "outgoing",
                AudioAttributes.USAGE_VOICE_COMMUNICATION,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.MODE_IN_COMMUNICATION,
                speaker = false,
                volume = 0.4f,
            )
        }
    }

    fun preview(context: Context): Boolean {
        if (!canRing(context)) return false
        startIncoming(context)
        handler.postDelayed({ if (playingKind == "incoming") stop() }, 4000)
        return true
    }

    /** Stop the tone and leave the voice-call audio route for WebRTC. */
    fun releaseForCall() {
        onMain {
            handler.removeCallbacks(stopLater)
            playingKind = ""
            releasePlayer()
            vibrator?.cancel()
            vibrator = null
            // A second release happens after WebRTC already owns the focus.
            if (!callOwnsAudio) abandonFocus()
            callOwnsAudio = true
        }
    }

    fun stop() {
        onMain {
            handler.removeCallbacks(stopLater)
            playingKind = ""
            releasePlayer()
            vibrator?.cancel()
            vibrator = null
            // Accepting the call also asks the ringtone to stop. Restoring
            // normal mode here cuts the voice the moment it connects.
            if (callOwnsAudio) return@onMain
            restoreRoute()
        }
    }

    /** Call is over. Give the speaker and mode back to the phone. */
    fun finishCall() {
        onMain {
            callOwnsAudio = false
            handler.removeCallbacks(stopLater)
            playingKind = ""
            releasePlayer()
            vibrator?.cancel()
            vibrator = null
            restoreRoute()
        }
    }

    private fun onMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else handler.post(block)
    }

    private fun restoreRoute() {
        abandonFocus()
        val app = currentContext ?: return
        val audio = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audio.mode = previousMode
        audio.isSpeakerphoneOn = previousSpeaker
    }

    private fun abandonFocus() {
        val app = currentContext ?: return
        val audio = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { audio.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            audio.abandonAudioFocus(null)
        }
        focusRequest = null
    }

    private var currentContext: Context? = null

    private fun canRing(context: Context): Boolean {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        return audio.ringerMode == AudioManager.RINGER_MODE_NORMAL && audio.getStreamVolume(AudioManager.STREAM_RING) > 0
    }

    private fun start(context: Context, kind: String, usage: Int, stream: Int, mode: Int, speaker: Boolean, volume: Float = 1f) {
        val app = context.applicationContext
        currentContext = app
        releasePlayer()
        val audio = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val preserveCallAudio = kind == "outgoing" && callOwnsAudio
        if (!preserveCallAudio) {
            previousMode = audio.mode
            previousSpeaker = audio.isSpeakerphoneOn
            audio.isSpeakerphoneOn = speaker
            audio.mode = mode
        }
        val attributes = AudioAttributes.Builder()
            .setUsage(usage)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setLegacyStreamType(stream)
            .build()
        if (!preserveCallAudio && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes)
                .build()
            focusRequest = request
            audio.requestAudioFocus(request)
        }
        val created = MediaPlayer()
        val file = app.resources.openRawResourceFd(R.raw.hisbenew_ring)
        created.setAudioAttributes(attributes)
        created.setDataSource(file.fileDescriptor, file.startOffset, file.length)
        file.close()
        created.isLooping = true
        created.setVolume(volume, volume)
        created.setOnPreparedListener { ready ->
            if (playingKind == kind) ready.start()
        }
        created.prepareAsync()
        player = created
        playingKind = kind
        handler.removeCallbacks(stopLater)
        handler.postDelayed(stopLater, 55000)
    }

    private fun releasePlayer() {
        player?.run {
            try { stop() } catch (_: Exception) {}
            release()
        }
        player = null
    }

    private fun silenceCallKit() {
        try {
            com.hiennv.flutter_callkit_incoming.FlutterCallkitIncomingPlugin.getInstance()
                ?.getCallkitSoundPlayerManager()
                ?.stop()
        } catch (_: Exception) {}
    }

    private fun vibrate(context: Context) {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (audio.ringerMode == AudioManager.RINGER_MODE_SILENT) return
        vibrator?.cancel()
        val next = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        vibrator = next
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            next.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 800, 600), 0))
        }
    }
}
