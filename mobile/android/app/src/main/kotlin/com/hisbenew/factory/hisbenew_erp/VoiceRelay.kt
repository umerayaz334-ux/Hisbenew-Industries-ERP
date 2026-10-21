package com.hisbenew.factory.hisbenew_erp

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioFocusRequest
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.content.Context
import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.EventChannel
import kotlin.math.max
import java.util.concurrent.LinkedBlockingQueue

/**
 * Captures and plays 16 kHz mono PCM for the office voice line.
 * The Dart side carries the frames to the server.
 */
object VoiceRelay {
    private const val RATE = 16000
    private const val FRAME = 640
    private var recorder: AudioRecord? = null
    private var player: AudioTrack? = null
    private var echo: AcousticEchoCanceler? = null
    private var noise: NoiseSuppressor? = null
    private var gain: AutomaticGainControl? = null
    private var capture: Thread? = null
    private var audioFocus: AudioFocusRequest? = null
    private var previousMode = AudioManager.MODE_NORMAL
    private var previousSpeaker = false
    private var audioContext: Context? = null
    @Volatile private var running = false
    @Volatile private var events: EventChannel.EventSink? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var speakerOn = true
    private val playbackFrames = LinkedBlockingQueue<ByteArray>(32)
    private var playbackThread: Thread? = null

    fun setEvents(sink: EventChannel.EventSink?) {
        events = sink
    }

    fun start(context: Context): Boolean {
        stop()
        audioContext = context.applicationContext
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        previousMode = audio.mode
        previousSpeaker = audio.isSpeakerphoneOn
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener { }
                .build()
            audioFocus = request
            audio.requestAudioFocus(request)
        } else {
            @Suppress("DEPRECATION")
            audio.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN)
        }
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        audio.isSpeakerphoneOn = speakerOn
        val captureSize = max(AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT), FRAME * 4)
        val playSize = max(AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT), FRAME * 8)
        if (captureSize <= 0 || playSize <= 0) {
            restoreAudio(context)
            audioContext = null
            return false
        }
        val format = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(RATE)
            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
            .build()
        val record = AudioRecord.Builder()
            .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
            .setAudioFormat(format)
            .setBufferSizeInBytes(captureSize)
            .build()
        if (record.state != AudioRecord.STATE_INITIALIZED) {
            record.release()
            restoreAudio(context)
            audioContext = null
            return false
        }
        if (record.state != AudioRecord.STATE_INITIALIZED) {
            record.release()
            restoreAudio(context)
            audioContext = null
            return false
        }
        val playback = AudioTrack(
            attributes,
            AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(RATE)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build(),
            playSize,
            AudioTrack.MODE_STREAM,
            AudioManager.AUDIO_SESSION_ID_GENERATE,
        )
        if (playback.state != AudioTrack.STATE_INITIALIZED) {
            playback.release()
            record.release()
            restoreAudio(context)
            audioContext = null
            return false
        }
        if (AcousticEchoCanceler.isAvailable()) {
            echo = AcousticEchoCanceler.create(record.audioSessionId)?.also { it.enabled = true }
        }
        if (NoiseSuppressor.isAvailable()) {
            noise = NoiseSuppressor.create(record.audioSessionId)?.also { it.enabled = true }
        }
        if (AutomaticGainControl.isAvailable()) {
            gain = AutomaticGainControl.create(record.audioSessionId)?.also { it.enabled = true }
        }
        recorder = record
        player = playback
        running = true
        record.startRecording()
        playback.play()
        playbackFrames.clear()
        playbackThread = Thread({
            while (running) {
                val frame = try { playbackFrames.take() } catch (_: InterruptedException) { break }
                if (running) {
                    try { playback.write(frame, 0, frame.size) } catch (_: Exception) { }
                }
            }
        }, "hisbenew-playback").also { it.start() }
        capture = Thread({
            val frame = ByteArray(FRAME)
            while (running) {
                var filled = 0
                while (running && filled < FRAME) {
                    val read = record.read(frame, filled, FRAME - filled)
                    if (read <= 0) break
                    filled += read
                }
                if (!running || filled < FRAME) continue
                if (events == null) continue
                val copy = frame.copyOf()
                // EventChannel's binary messenger belongs to Flutter's platform
                // thread. Keep AudioRecord's capture loop independent of it.
                mainHandler.post { events?.success(copy) }
            }
        }, "hisbenew-voice")
        capture?.start()
        return true
    }

    fun play(frame: ByteArray) {
        if (!running || frame.isEmpty()) return
        if (!playbackFrames.offer(frame.copyOf())) {
            playbackFrames.poll()
            playbackFrames.offer(frame.copyOf())
        }
    }

    fun setSpeaker(context: Context, enabled: Boolean) {
        speakerOn = enabled
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        audio.isSpeakerphoneOn = enabled
    }

    fun stop() {
        running = false
        playbackFrames.clear()
        playbackThread?.interrupt()
        if (playbackThread !== Thread.currentThread()) playbackThread?.join(700)
        playbackThread = null
        try { recorder?.stop() } catch (_: Exception) {}
        if (capture !== Thread.currentThread()) capture?.join(700)
        capture = null
        echo?.release()
        noise?.release()
        gain?.release()
        echo = null
        noise = null
        gain = null
        recorder?.run {
            try { stop() } catch (_: Exception) {}
            release()
        }
        player?.run {
            try { stop() } catch (_: Exception) {}
            release()
        }
        recorder = null
        player = null
        audioContext?.let(::restoreAudio)
        audioContext = null
    }

    private fun restoreAudio(context: Context) {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            audioFocus?.let { audio.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION")
            audio.abandonAudioFocus(null)
        }
        audioFocus = null
        audio.mode = previousMode
        audio.isSpeakerphoneOn = previousSpeaker
    }
}
