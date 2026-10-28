#nullable enable
using System;
using System.Collections.Concurrent;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Events;

namespace Subspace.RichPresence
{
    /// <summary>
    /// Shows what the player is doing on their Subspace profile, through the Subspace desktop app
    /// on the same computer. Add it to a GameObject in your first scene, set the Application ID, and
    /// call <see cref="SetActivity(Activity)"/> from game code.
    /// </summary>
    /// <remarks>
    /// Everything here is meant to be called from the main thread, and <see cref="onReady"/>,
    /// <see cref="onDisconnected"/> and the completion callbacks run on the main thread (they are
    /// queued by the SDK's thread-pool events and run in <c>Update</c>, so they wait while the
    /// component is disabled). In WebGL builds the component does nothing: browsers are refused
    /// by the desktop app by design.
    /// </remarks>
    [AddComponentMenu("Subspace/Subspace Rich Presence")]
    [DisallowMultipleComponent]
    public sealed class SubspaceRichPresence : MonoBehaviour
    {
        [Tooltip("Your application id from Subspace: User Settings > Developer Applications.")]
        [SerializeField] private string applicationId = "";

        [Tooltip("Look for the desktop app in Start. Otherwise call Connect() yourself.")]
        [SerializeField] private bool connectOnStart = true;

        [Tooltip("Keep this object (and the connection) across scene loads. Extra copies in later scenes are destroyed.")]
        [SerializeField] private bool dontDestroyOnLoad = true;

        [Tooltip("Keep looking for the desktop app while it is closed, and send the activity again when it comes back.")]
        [SerializeField] private bool reconnect = true;

        [Tooltip("Log failed commands as warnings when no callback was given.")]
        [SerializeField] private bool logErrors = true;

        /// <summary>Connected to the desktop app. Runs on the main thread.</summary>
        public UnityEvent onReady = new UnityEvent();

        /// <summary>The desktop app went away (it was closed or restarted). Runs on the main thread.</summary>
        public UnityEvent onDisconnected = new UnityEvent();

        private readonly ConcurrentQueue<Action> _mainThread = new ConcurrentQueue<Action>();
        private bool _shutDown;

#if !UNITY_WEBGL || UNITY_EDITOR
        private RichPresence? _client;
#endif

        /// <summary>The live component, when <c>dontDestroyOnLoad</c> is on (or the first one awake).</summary>
        public static SubspaceRichPresence? Instance { get; private set; }

        /// <summary>Your Subspace application id. Changing it only affects the next connection.</summary>
        public string ApplicationId
        {
            get => applicationId;
            set => applicationId = value;
        }

        /// <summary>Whether the desktop app is connected right now. Always false in WebGL builds.</summary>
        public bool IsConnected
        {
            get
            {
#if !UNITY_WEBGL || UNITY_EDITOR
                return _client != null && _client.IsConnected;
#else
                return false;
#endif
            }
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetStatics() => Instance = null;

        private void Awake()
        {
            if (dontDestroyOnLoad)
            {
                if (Instance != null && Instance != this)
                {
                    _shutDown = true;
                    Destroy(gameObject);
                    return;
                }
                DontDestroyOnLoad(transform.root.gameObject);
            }
            if (Instance == null) Instance = this;
        }

        private void Start()
        {
            if (connectOnStart && !_shutDown) Connect();
        }

        private void Update()
        {
            while (_mainThread.TryDequeue(out var action))
            {
                try
                {
                    action();
                }
                catch (Exception e)
                {
                    Debug.LogException(e, this);
                }
            }
        }

        private void OnApplicationQuit() => Shutdown();

        private void OnDestroy()
        {
            Shutdown();
            if (Instance == this) Instance = null;
        }

        /// <summary>Starts looking for the desktop app. Does nothing if already connected or looking.</summary>
        public void Connect()
        {
#if !UNITY_WEBGL || UNITY_EDITOR
            var client = EnsureClient();
            if (client == null) return;
            Task connecting;
            try
            {
                connecting = client.ConnectAsync();
            }
            catch (ObjectDisposedException)
            {
                return;
            }
            Observe(connecting, null, "connect");
#else
            _ = reconnect;
#endif
        }

        /// <summary>Shows (or updates) the activity. Can be called before the desktop app is found.</summary>
        public void SetActivity(Activity activity) => SetActivity(activity, null);

        /// <summary>
        /// Shows (or updates) the activity. <paramref name="done"/> runs on the main thread with null
        /// once the desktop app accepted it (or it was stored for when it connects), or with the error.
        /// In WebGL builds it runs with null straight away.
        /// </summary>
        public void SetActivity(Activity activity, Action<Exception?>? done)
        {
            if (activity == null) throw new ArgumentNullException(nameof(activity));
#if !UNITY_WEBGL || UNITY_EDITOR
            var client = EnsureClient();
            if (client == null)
            {
                done?.Invoke(new InvalidOperationException("Subspace Rich Presence is not available: no valid Application ID, or the component was destroyed"));
                return;
            }
            Task sending;
            try
            {
                sending = client.SetActivityAsync(activity);
            }
            catch (Exception e)
            {
                Finish(e, done, "set the activity");
                return;
            }
            Observe(sending, done, "set the activity");
#else
            done?.Invoke(null);
#endif
        }

        /// <summary>Shorthand for an activity with just the two lines under your application's name.</summary>
        public void SetActivity(string details, string? state) => SetActivity(new Activity { Details = details, State = state }, null);

        /// <summary>Removes the activity. <paramref name="done"/> runs on the main thread, like SetActivity's.</summary>
        public void ClearActivity(Action<Exception?>? done)
        {
#if !UNITY_WEBGL || UNITY_EDITOR
            if (_client == null)
            {
                done?.Invoke(null);
                return;
            }
            Task clearing;
            try
            {
                clearing = _client.ClearActivityAsync();
            }
            catch (Exception e)
            {
                Finish(e, done, "clear the activity");
                return;
            }
            Observe(clearing, done, "clear the activity");
#else
            done?.Invoke(null);
#endif
        }

        /// <summary>Removes the activity.</summary>
        public void ClearActivity() => ClearActivity(null);

#if !UNITY_WEBGL || UNITY_EDITOR
        /// <summary>
        /// The underlying SDK client (null until the first Connect or SetActivity, and in WebGL
        /// builds where this member does not exist). Its events run on the thread pool.
        /// </summary>
        public RichPresence? Client => _client;

        private RichPresence? EnsureClient()
        {
            if (_client != null || _shutDown) return _client;
            try
            {
                _client = new RichPresence(new RichPresenceOptions { ClientId = (applicationId ?? "").Trim(), Reconnect = reconnect });
            }
            catch (ArgumentException)
            {
                Debug.LogError("Subspace Rich Presence: set the Application ID to your application's id from User Settings > Developer Applications.", this);
                return null;
            }
            _client.Ready += (sender, args) => _mainThread.Enqueue(() => onReady.Invoke());
            _client.Disconnected += (sender, args) => _mainThread.Enqueue(() => onDisconnected.Invoke());
            return _client;
        }

        private void Observe(Task task, Action<Exception?>? done, string what)
        {
            task.ContinueWith(
                t => _mainThread.Enqueue(() => Finish(t.Exception?.GetBaseException(), done, what)),
                TaskScheduler.Default);
        }
#endif

        private void Finish(Exception? error, Action<Exception?>? done, string what)
        {
            if (done != null)
            {
                done(error);
                return;
            }
            if (error != null && logErrors && !(error is ObjectDisposedException))
                Debug.LogWarning("Subspace Rich Presence: could not " + what + ": " + error.Message, this);
        }

        private void Shutdown()
        {
            _shutDown = true;
#if !UNITY_WEBGL || UNITY_EDITOR
            _client?.Dispose();
            _client = null;
#endif
        }
    }
}
