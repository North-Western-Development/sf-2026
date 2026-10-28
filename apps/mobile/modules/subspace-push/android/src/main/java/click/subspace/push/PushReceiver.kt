package click.subspace.push

import android.content.Context
import org.json.JSONObject
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

/** Where this install is reachable, as the distributor last reported it. */
object Store {
  private fun prefs(context: Context) = context.getSharedPreferences("subspace.push", Context.MODE_PRIVATE)

  fun save(context: Context, endpoint: String, p256dh: String, auth: String) {
    prefs(context).edit().putString("endpoint", endpoint).putString("p256dh", p256dh).putString("auth", auth).apply()
  }

  fun clear(context: Context) = prefs(context).edit().clear().apply()

  fun endpoint(context: Context): Map<String, String>? {
    val p = prefs(context)
    val endpoint = p.getString("endpoint", null) ?: return null
    return mapOf("endpoint" to endpoint, "p256dh" to (p.getString("p256dh", null) ?: return null), "auth" to (p.getString("auth", null) ?: return null))
  }
}

/**
 * Receives UnifiedPush events from the distributor, also while the app is closed. The instance
 * encrypts every push to this install's keys (RFC 8291); the connector decrypts it here.
 */
class PushReceiver : PushService() {
  override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
    val keys = endpoint.pubKeySet ?: return
    Store.save(this, endpoint.url, keys.pubKey, keys.auth)
    SubspacePushModule.changed()
  }

  override fun onMessage(message: PushMessage, instance: String) {
    // Anything not encrypted to our keys did not come from the instance.
    if (!message.decrypted || SubspacePushModule.foreground) return
    val json = try {
      JSONObject(String(message.content, Charsets.UTF_8))
    } catch (_: Exception) {
      return
    }
    Notifier.show(this, json.optString("title", "Subspace Frequency"), json.optString("body", ""), json.optString("path", ""))
  }

  override fun onRegistrationFailed(reason: FailedReason, instance: String) {
    Store.clear(this)
    SubspacePushModule.changed()
  }

  override fun onUnregistered(instance: String) {
    Store.clear(this)
    SubspacePushModule.changed()
  }
}
