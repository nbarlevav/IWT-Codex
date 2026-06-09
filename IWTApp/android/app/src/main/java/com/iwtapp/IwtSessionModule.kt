package com.iwtapp

import android.content.Intent
import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

class IwtSessionModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "IwtSession"

  @ReactMethod
  fun isDisclaimerAccepted(promise: Promise) {
    promise.resolve(preferences().getBoolean(KEY_DISCLAIMER_ACCEPTED, false))
  }

  @ReactMethod
  fun acceptDisclaimer(promise: Promise) {
    preferences().edit().putBoolean(KEY_DISCLAIMER_ACCEPTED, true).apply()
    promise.resolve(null)
  }

  @ReactMethod
  fun start(config: ReadableMap, promise: Promise) {
    val intent = Intent(reactContext, IwtSessionService::class.java).apply {
      action = IwtSessionService.ACTION_START
      putExtra(IwtSessionService.EXTRA_FAST_SECONDS, config.getInt("fastSeconds"))
      putExtra(IwtSessionService.EXTRA_SLOW_SECONDS, config.getInt("slowSeconds"))
      putExtra(IwtSessionService.EXTRA_CYCLES, config.getInt("cycles"))
      putExtra(IwtSessionService.EXTRA_START_MODE, config.getString("startMode") ?: "fast")
      putExtra(IwtSessionService.EXTRA_SOUND, config.getBoolean("sound"))
      putExtra(IwtSessionService.EXTRA_VIBRATION, config.getBoolean("vibration"))
    }
    reactContext.startForegroundService(intent)
    promise.resolve(null)
  }

  @ReactMethod
  fun pause(promise: Promise) {
    sendAction(IwtSessionService.ACTION_PAUSE)
    promise.resolve(null)
  }

  @ReactMethod
  fun resume(promise: Promise) {
    sendAction(IwtSessionService.ACTION_RESUME)
    promise.resolve(null)
  }

  @ReactMethod
  fun stop(promise: Promise) {
    sendAction(IwtSessionService.ACTION_STOP)
    promise.resolve(null)
  }

  private fun sendAction(actionName: String) {
    reactContext.startService(Intent(reactContext, IwtSessionService::class.java).apply {
      action = actionName
    })
  }

  private fun preferences() =
    reactContext.getSharedPreferences("iwt_preferences", Context.MODE_PRIVATE)

  companion object {
    private const val KEY_DISCLAIMER_ACCEPTED = "disclaimerAccepted"
  }
}
