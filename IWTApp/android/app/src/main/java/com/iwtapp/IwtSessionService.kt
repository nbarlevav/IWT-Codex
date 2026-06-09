package com.iwtapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.core.app.NotificationCompat
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

class IwtSessionService : Service(), TextToSpeech.OnInitListener {
  private val handler = Handler(Looper.getMainLooper())
  private var tts: TextToSpeech? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private var audioManager: AudioManager? = null
  private var ttsReady = false
  private var pendingSpeech: String? = null

  private var fastSeconds = 180
  private var slowSeconds = 180
  private var cycles = 5
  private var startMode = "fast"
  private var soundEnabled = true
  private var vibrationEnabled = true
  private var running = false
  private var paused = false
  private var offsetMs = 0L
  private var startedAtMs = 0L
  private var lastSegment = -1

  override fun onCreate() {
    super.onCreate()
    createChannel()
    audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    tts = TextToSpeech(this, this)
    tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) = Unit
      override fun onError(utteranceId: String?) = releaseAudioFocus()
      override fun onDone(utteranceId: String?) = releaseAudioFocus()
    })
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> startSession(intent)
      ACTION_PAUSE -> pauseSession()
      ACTION_RESUME -> resumeSession()
      ACTION_STOP -> stopSession()
      else -> updateForegroundNotification()
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    releaseAudioFocus()
    tts?.stop()
    tts?.shutdown()
    super.onDestroy()
  }

  override fun onInit(status: Int) {
    if (status == TextToSpeech.SUCCESS) {
      ttsReady = true
      tts?.language = Locale.US
      tts?.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
      )
      pendingSpeech?.let { text ->
        pendingSpeech = null
        handler.postDelayed({ speak(text) }, 250L)
      }
    }
  }

  private fun startSession(intent: Intent) {
    fastSeconds = intent.getIntExtra(EXTRA_FAST_SECONDS, 180)
    slowSeconds = intent.getIntExtra(EXTRA_SLOW_SECONDS, 180)
    cycles = intent.getIntExtra(EXTRA_CYCLES, 5)
    startMode = intent.getStringExtra(EXTRA_START_MODE) ?: "fast"
    soundEnabled = intent.getBooleanExtra(EXTRA_SOUND, true)
    vibrationEnabled = intent.getBooleanExtra(EXTRA_VIBRATION, true)
    running = true
    paused = false
    offsetMs = 0L
    startedAtMs = SystemClock.elapsedRealtime()
    lastSegment = -1
    startForeground(NOTIFICATION_ID, buildNotification(snapshot()))
    cueForMode(startMode)
    scheduleTick()
  }

  private fun pauseSession() {
    if (!running || paused) return
    offsetMs = elapsedMs()
    paused = true
    handler.removeCallbacksAndMessages(null)
    updateForegroundNotification()
  }

  private fun resumeSession() {
    if (!running || !paused) return
    startedAtMs = SystemClock.elapsedRealtime()
    paused = false
    scheduleTick()
    updateForegroundNotification()
  }

  private fun stopSession() {
    running = false
    paused = false
    handler.removeCallbacksAndMessages(null)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun scheduleTick() {
    handler.removeCallbacksAndMessages(null)
    handler.post(object : Runnable {
      override fun run() {
        if (!running || paused) return
        val snap = snapshot()
        if (snap.segment != lastSegment) {
          if (lastSegment != -1) cueForMode(snap.mode)
          lastSegment = snap.segment
        }
        updateForegroundNotification(snap)
        if (snap.remainingMs <= 0L) {
          cueComplete()
          running = false
          handler.postDelayed({ stopSession() }, if (soundEnabled) 4500L else 800L)
          return
        }
        handler.postDelayed(this, 1000L)
      }
    })
  }

  private fun snapshot(): SessionSnapshot {
    val elapsed = min(elapsedMs(), totalMs())
    var cursor = 0L
    val sequence = sequence()
    sequence.forEachIndexed { index, mode ->
      val duration = if (mode == "fast") fastSeconds * 1000L else slowSeconds * 1000L
      if (elapsed < cursor + duration || index == sequence.lastIndex) {
        return SessionSnapshot(
          mode = mode,
          segment = index,
          cycle = min(cycles, index / 2 + 1),
          segmentRemainingMs = max(0L, cursor + duration - elapsed),
          remainingMs = max(0L, totalMs() - elapsed),
        )
      }
      cursor += duration
    }
    return SessionSnapshot(startMode, 0, 1, fastSeconds * 1000L, totalMs())
  }

  private fun elapsedMs(): Long =
    if (!running) 0L else if (paused) offsetMs else offsetMs + SystemClock.elapsedRealtime() - startedAtMs

  private fun totalMs(): Long = (fastSeconds + slowSeconds) * cycles * 1000L

  private fun sequence(): List<String> {
    val second = if (startMode == "fast") "slow" else "fast"
    return List(cycles * 2) { index -> if (index % 2 == 0) startMode else second }
  }

  private fun cueForMode(mode: String) {
    val isFast = mode == "fast"
    if (vibrationEnabled) vibrate(if (isFast) 70L else 45L)
    if (soundEnabled) speak(if (isFast) "Fast pace, speed up" else "Slow pace, slow down")
  }

  private fun cueComplete() {
    if (vibrationEnabled) vibrate(longArrayOf(80L, 60L, 180L))
    if (soundEnabled) speak("Workout complete. Great job.")
  }

  private fun speak(text: String) {
    if (!ttsReady) {
      pendingSpeech = text
      return
    }
    requestDuckFocus()
    tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "iwt-${SystemClock.elapsedRealtime()}")
  }

  private fun requestDuckFocus() {
    val manager = audioManager ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        .setOnAudioFocusChangeListener {}
        .build()
      audioFocusRequest = request
      manager.requestAudioFocus(request)
    } else {
      @Suppress("DEPRECATION")
      manager.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
    }
  }

  private fun releaseAudioFocus() {
    val manager = audioManager ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest?.let { manager.abandonAudioFocusRequest(it) }
      audioFocusRequest = null
    } else {
      @Suppress("DEPRECATION")
      manager.abandonAudioFocus(null)
    }
  }

  private fun vibrate(durationMs: Long) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      vibrator().vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
    } else {
      @Suppress("DEPRECATION")
      vibrator().vibrate(durationMs)
    }
  }

  private fun vibrate(pattern: LongArray) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      vibrator().vibrate(VibrationEffect.createWaveform(pattern, -1))
    } else {
      @Suppress("DEPRECATION")
      vibrator().vibrate(pattern, -1)
    }
  }

  private fun vibrator(): Vibrator =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val manager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
      manager.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }

  private fun updateForegroundNotification(snapshot: SessionSnapshot = snapshot()) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(NOTIFICATION_ID, buildNotification(snapshot))
  }

  private fun buildNotification(snapshot: SessionSnapshot): Notification {
    val openIntent = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    val modeLabel = if (snapshot.mode == "fast") "Fast pace" else "Slow pace"
    val state = if (paused) "Paused" else "${formatMs(snapshot.segmentRemainingMs)} left"
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_iwt_notification)
      .setContentTitle("IWT - $modeLabel")
      .setContentText("Cycle ${snapshot.cycle} of $cycles - $state")
      .setOngoing(running)
      .setOnlyAlertOnce(true)
      .setContentIntent(openIntent)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .build()
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(
      CHANNEL_ID,
      "IWT session",
      NotificationManager.IMPORTANCE_LOW
    ).apply {
      description = "Shows the active interval walking session"
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      setSound(null, null)
    }
    manager.createNotificationChannel(channel)
  }

  private fun formatMs(ms: Long): String {
    val totalSeconds = max(0L, ms / 1000L)
    val minutes = totalSeconds / 60L
    val seconds = totalSeconds % 60L
    return "%02d:%02d".format(minutes, seconds)
  }

  private data class SessionSnapshot(
    val mode: String,
    val segment: Int,
    val cycle: Int,
    val segmentRemainingMs: Long,
    val remainingMs: Long,
  )

  companion object {
    const val ACTION_START = "com.iwtapp.START"
    const val ACTION_PAUSE = "com.iwtapp.PAUSE"
    const val ACTION_RESUME = "com.iwtapp.RESUME"
    const val ACTION_STOP = "com.iwtapp.STOP"
    const val EXTRA_FAST_SECONDS = "fastSeconds"
    const val EXTRA_SLOW_SECONDS = "slowSeconds"
    const val EXTRA_CYCLES = "cycles"
    const val EXTRA_START_MODE = "startMode"
    const val EXTRA_SOUND = "sound"
    const val EXTRA_VIBRATION = "vibration"
    private const val CHANNEL_ID = "iwt_session"
    private const val NOTIFICATION_ID = 101
  }
}
