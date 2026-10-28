package click.subspace.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

/** Shows notifications: pushes from the instance, and the web app's own while it is open. */
object Notifier {
  const val EXTRA_PATH = "click.subspace.push.PATH"
  private const val CHANNEL = "transmissions"
  private const val BRAND = 0xFF3B8EF2.toInt()

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL) != null) return
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "Transmissions", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Direct links, mentions and calls"
    })
  }

  /** Only paths on the instance itself: tapping must never open somewhere else. */
  fun safePath(path: String?): String? = path?.takeIf { it.startsWith("/") && !it.startsWith("//") && !it.contains('\\') }

  fun show(context: Context, title: String, body: String, path: String?) {
    ensureChannel(context)
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      safePath(path)?.let { putExtra(EXTRA_PATH, it) }
    }
    val id = (System.currentTimeMillis() and 0x7fffffff).toInt()
    val tap = launch?.let { PendingIntent.getActivity(context, id, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) android.app.Notification.Builder(context, CHANNEL) else android.app.Notification.Builder(context)
    val notification = builder
      .setSmallIcon(R.drawable.subspace_notification)
      .setColor(BRAND)
      .setContentTitle(title.take(120))
      .setContentText(body.take(240))
      .setStyle(android.app.Notification.BigTextStyle().bigText(body.take(240)))
      .setAutoCancel(true)
      .apply { tap?.let { setContentIntent(it) } }
      .build()
    try {
      context.getSystemService(NotificationManager::class.java).notify(id, notification)
    } catch (_: SecurityException) {
      // Notifications are turned off for the app: nothing to show.
    }
  }
}
