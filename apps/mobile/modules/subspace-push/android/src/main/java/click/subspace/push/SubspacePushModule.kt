package click.subspace.push

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.unifiedpush.android.connector.UnifiedPush

/** Android push for the mobile shell: UnifiedPush registration and native notifications. */
class SubspacePushModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext)

  override fun definition() = ModuleDefinition {
    Name("SubspacePush")
    Events("onEndpoint", "onOpen")

    OnCreate {
      active = this@SubspacePushModule
      Notifier.ensureChannel(context)
    }
    OnDestroy { if (active === this@SubspacePushModule) active = null }
    OnActivityEntersForeground { foreground = true }
    OnActivityEntersBackground { foreground = false }
    OnActivityDestroys { foreground = false }

    /** Installed distributors (package names), such as io.heckel.ntfy. */
    Function("distributors") { UnifiedPush.getDistributors(context) }

    /** "registering" (the endpoint arrives as onEndpoint), or "no-distributor". */
    AsyncFunction("register") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null || UnifiedPush.getDistributors(context).isEmpty()) {
        promise.resolve("no-distributor")
        return@AsyncFunction
      }
      UnifiedPush.tryUseCurrentOrDefaultDistributor(activity) { ok ->
        if (ok) UnifiedPush.register(context, messageForDistributor = "Subspace Frequency")
        promise.resolve(if (ok) "registering" else "no-distributor")
      }
    }

    Function("endpoint") { Store.endpoint(context) }

    Function("notify") { title: String, body: String, path: String? -> Notifier.show(context, title, body, path) }

    /** The path of the notification that opened the app, once. */
    Function("takeLaunchPath") {
      val intent = appContext.currentActivity?.intent
      val path = Notifier.safePath(intent?.getStringExtra(Notifier.EXTRA_PATH))
      intent?.removeExtra(Notifier.EXTRA_PATH)
      path
    }

    OnNewIntent { intent ->
      Notifier.safePath(intent.getStringExtra(Notifier.EXTRA_PATH))?.let {
        intent.removeExtra(Notifier.EXTRA_PATH)
        sendEvent("onOpen", mapOf("path" to it))
      }
    }
  }

  companion object {
    @Volatile private var active: SubspacePushModule? = null

    /** While the app is on screen the open page shows notifications itself. */
    @Volatile var foreground = false

    /** The endpoint changed (or went away): tell the running app, if any. */
    fun changed() {
      val module = active ?: return
      val endpoint = module.appContext.reactContext?.let { Store.endpoint(it) }
      module.sendEvent("onEndpoint", mapOf("endpoint" to endpoint))
    }
  }
}
