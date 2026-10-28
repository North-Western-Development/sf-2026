#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Subspace.RichPresence
{
    /// <summary>The desktop app refused a command, did not answer, or could not be reached.</summary>
    public sealed class RichPresenceException : Exception
    {
        /// <summary>Creates the exception.</summary>
        public RichPresenceException(string message) : base(message) { }

        /// <summary>Creates the exception with the error that caused it.</summary>
        public RichPresenceException(string message, Exception? inner) : base(message, inner) { }
    }

    /// <summary>
    /// Subspace Frequency Rich Presence: show what a player is doing in your game ("Competitive -
    /// Mirage", "In a party of 3 of 5") on their Subspace profile. It talks to the Subspace desktop
    /// app on the same computer over its local RPC server; the desktop app must be running.
    /// </summary>
    /// <remarks>
    /// All members are thread-safe. <see cref="Ready"/> and <see cref="Disconnected"/> are raised on
    /// a thread-pool thread, never on the thread that called <see cref="ConnectAsync"/>, and every
    /// await inside the SDK uses ConfigureAwait(false). The activity ends when you call
    /// <see cref="ClearActivityAsync"/>, <see cref="Dispose"/> or <see cref="CloseAsync"/>, or when
    /// your process exits.
    /// </remarks>
    public sealed class RichPresence : IDisposable
    {
        /// <summary>The ports the desktop app may listen on: it takes the first free one of 6473-6482.</summary>
        public static readonly IReadOnlyList<int> DefaultPorts = new[] { 6473, 6474, 6475, 6476, 6477, 6478, 6479, 6480, 6481, 6482 };

        /// <summary>The desktop app refuses frames larger than this (in UTF-8 bytes).</summary>
        public const int MaxFrameBytes = 16 * 1024;

        private const int MaxIncomingBytes = 64 * 1024;

        private readonly string _clientId;
        private readonly int[] _ports;
        private readonly string _host;
        private readonly bool _reconnect;
        private readonly TimeSpan _reconnectDelay;
        private readonly TimeSpan _readyTimeout;
        private readonly TimeSpan _replyTimeout;

        private readonly object _gate = new object();
        private readonly SemaphoreSlim _sendLock = new SemaphoreSlim(1, 1);
        private readonly Dictionary<string, TaskCompletionSource<bool>> _pending = new Dictionary<string, TaskCompletionSource<bool>>(StringComparer.Ordinal);

        private ClientWebSocket? _socket;
        private string? _activityJson;
        private long _nonce;
        private CancellationTokenSource? _runCts;
        private Task? _run;
        private TaskCompletionSource<bool>? _firstSweep;
        private bool _disposed;

        /// <summary>Connected to the desktop app (after READY). Raised on a thread-pool thread.</summary>
        public event EventHandler? Ready;

        /// <summary>
        /// The desktop app went away (it was closed or restarted). Raised on a thread-pool thread. Not
        /// raised by <see cref="Dispose"/> or <see cref="CloseAsync"/>.
        /// </summary>
        public event EventHandler? Disconnected;

        /// <summary>Creates a client. Nothing happens until <see cref="ConnectAsync"/>.</summary>
        /// <exception cref="ArgumentException">The client id or another option is invalid.</exception>
        public RichPresence(RichPresenceOptions options)
        {
            if (options == null) throw new ArgumentNullException(nameof(options));
            if (!IsApplicationId(options.ClientId))
                throw new ArgumentException("ClientId must be your Subspace application id", nameof(options));
            var ports = options.Ports != null ? new List<int>(options.Ports).ToArray() : new List<int>(DefaultPorts).ToArray();
            if (ports.Length == 0) throw new ArgumentException("Ports must not be empty", nameof(options));
            foreach (var port in ports)
            {
                if (port < 1 || port > 65535) throw new ArgumentException("Ports must be between 1 and 65535", nameof(options));
            }
            var host = options.Host ?? "127.0.0.1";
            if (host != "127.0.0.1" && host != "localhost")
                throw new ArgumentException("Host must be 127.0.0.1 or localhost: the desktop app only listens on this computer", nameof(options));
            if (options.ReconnectDelay <= TimeSpan.Zero || options.ReadyTimeout <= TimeSpan.Zero || options.ReplyTimeout <= TimeSpan.Zero)
                throw new ArgumentException("Timeouts must be positive", nameof(options));

            _clientId = options.ClientId;
            _ports = ports;
            _host = host;
            _reconnect = options.Reconnect;
            _reconnectDelay = options.ReconnectDelay;
            _readyTimeout = options.ReadyTimeout;
            _replyTimeout = options.ReplyTimeout;
        }

        /// <summary>Whether the desktop app is connected right now.</summary>
        public bool IsConnected
        {
            get
            {
                lock (_gate) return _socket != null && _socket.State == WebSocketState.Open;
            }
        }

        /// <summary>
        /// Finds the desktop app. Every port is tried at once and the first in
        /// <see cref="RichPresenceOptions.Ports"/> order that says READY is used. Completes once
        /// connected, or when no port answered (within <see cref="RichPresenceOptions.ReadyTimeout"/>).
        /// With <see cref="RichPresenceOptions.Reconnect"/> on (the default) it never throws for a
        /// missing desktop app: it keeps looking in the background and the activity is sent once it
        /// is found. With it off, it throws <see cref="RichPresenceException"/> when the app is not
        /// running. Calling it again while connected or still looking does nothing.
        /// </summary>
        public Task ConnectAsync()
        {
            lock (_gate)
            {
                if (_disposed) throw new ObjectDisposedException(nameof(RichPresence));
                if (_run != null && !_run.IsCompleted && _firstSweep != null) return _firstSweep.Task;
                var cts = new CancellationTokenSource();
                var first = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                _runCts = cts;
                _firstSweep = first;
                _run = Task.Run(() => RunAsync(first, cts.Token));
                return first.Task;
            }
        }

        /// <summary>
        /// Shows (or updates) the activity. It is remembered and sent again on every reconnect, so
        /// it can be called before the desktop app is found.
        /// </summary>
        /// <returns>True when the desktop app accepted it; false when not connected (it is sent on connect).</returns>
        /// <exception cref="RichPresenceException">The desktop app refused it, did not answer, or went away meanwhile.</exception>
        /// <exception cref="ArgumentException">The activity is larger than the desktop app accepts.</exception>
        public async Task<bool> SetActivityAsync(Activity activity)
        {
            if (activity == null) throw new ArgumentNullException(nameof(activity));
            var json = Json.WriteActivity(activity);
            var args = "{\"activity\":" + json + "}";
            // The command wrapper adds well under 64 bytes.
            if (Encoding.UTF8.GetByteCount(args) + 64 > MaxFrameBytes)
                throw new ArgumentException("The activity is larger than the desktop app accepts (16 KB)", nameof(activity));
            lock (_gate)
            {
                if (_disposed) throw new ObjectDisposedException(nameof(RichPresence));
                _activityJson = json;
                if (_socket == null) return false;
            }
            await RequestAsync("SET_ACTIVITY", args).ConfigureAwait(false);
            return true;
        }

        /// <summary>Removes the activity.</summary>
        /// <returns>True when the desktop app accepted it; false when not connected.</returns>
        /// <exception cref="RichPresenceException">The desktop app refused it, did not answer, or went away meanwhile.</exception>
        public async Task<bool> ClearActivityAsync()
        {
            lock (_gate)
            {
                if (_disposed) throw new ObjectDisposedException(nameof(RichPresence));
                _activityJson = null;
                if (_socket == null) return false;
            }
            await RequestAsync("CLEAR_ACTIVITY", null).ConfigureAwait(false);
            return true;
        }

        /// <summary>
        /// Disconnects at once (the connection is aborted) and stops looking for the desktop app; the
        /// activity ends with the connection. Pending commands fail. Safe to call more than once.
        /// </summary>
        public void Dispose()
        {
            var socket = Shutdown();
            if (socket == null) return;
            socket.Abort();
            socket.Dispose();
        }

        /// <summary>
        /// Like <see cref="Dispose"/>, but says goodbye with a WebSocket close frame first, waiting at
        /// most <paramref name="timeout"/> (default one second) for it to go out.
        /// </summary>
        public async Task CloseAsync(TimeSpan? timeout = null)
        {
            var socket = Shutdown();
            if (socket == null) return;
            try
            {
                using (var cts = new CancellationTokenSource(timeout ?? TimeSpan.FromSeconds(1)))
                {
                    await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", cts.Token).ConfigureAwait(false);
                }
            }
            catch (Exception)
            {
                // Aborted below either way.
            }
            socket.Abort();
            socket.Dispose();
        }

        private ClientWebSocket? Shutdown()
        {
            ClientWebSocket? socket;
            CancellationTokenSource? cts;
            List<TaskCompletionSource<bool>> pending;
            lock (_gate)
            {
                if (_disposed) return null;
                _disposed = true;
                socket = _socket;
                _socket = null;
                cts = _runCts;
                _runCts = null;
                pending = new List<TaskCompletionSource<bool>>(_pending.Values);
                _pending.Clear();
            }
            try
            {
                cts?.Cancel();
            }
            catch (AggregateException)
            {
                // A callback threw; nothing of ours is registered that can.
            }
            foreach (var waiter in pending) waiter.TrySetException(new RichPresenceException("Closed"));
            return socket;
        }

        private static bool IsApplicationId(string? id)
        {
            if (string.IsNullOrEmpty(id) || id!.Length > 19 || id[0] == '0') return false;
            foreach (var c in id)
            {
                if (c < '0' || c > '9') return false;
            }
            return true;
        }

        // ---- Connection ------------------------------------------------------------------------

        private async Task RunAsync(TaskCompletionSource<bool> first, CancellationToken ct)
        {
            try
            {
                while (!ct.IsCancellationRequested)
                {
                    ClientWebSocket? socket = null;
                    Exception? error = null;
                    try
                    {
                        socket = await SweepAsync(ct).ConfigureAwait(false);
                    }
                    catch (Exception e)
                    {
                        error = e;
                    }

                    if (socket == null)
                    {
                        if (ct.IsCancellationRequested) return;
                        if (!_reconnect)
                        {
                            first.TrySetException(error as RichPresenceException ?? new RichPresenceException("The Subspace desktop app is not running", error));
                            return;
                        }
                        first.TrySetResult(false);
                    }
                    else
                    {
                        bool attached;
                        lock (_gate)
                        {
                            attached = !_disposed;
                            if (attached) _socket = socket;
                        }
                        if (!attached)
                        {
                            socket.Abort();
                            socket.Dispose();
                            return;
                        }
                        var receive = ReceiveLoopAsync(socket);
                        Raise(Ready);
                        string? json;
                        lock (_gate) json = _activityJson;
                        if (json != null)
                        {
                            try
                            {
                                await RequestAsync("SET_ACTIVITY", "{\"activity\":" + json + "}").ConfigureAwait(false);
                            }
                            catch (Exception)
                            {
                                // Reported again by the next setActivity; the connection carries on.
                            }
                        }
                        first.TrySetResult(true);
                        await receive.ConfigureAwait(false);
                        if (!_reconnect) return;
                    }

                    try
                    {
                        await Task.Delay(_reconnectDelay, ct).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException)
                    {
                        return;
                    }
                }
            }
            finally
            {
                // Closed while looking: let ConnectAsync finish.
                first.TrySetResult(false);
            }
        }

        /// <summary>
        /// Tries every port at once (a refused loopback connection takes about 2 s on Windows, so
        /// one at a time would take 20 s) and takes the first port in <see cref="_ports"/> order
        /// that says READY: once one answers, it only waits for the ports before it that are still
        /// in flight. Every other connection is closed.
        /// </summary>
        private async Task<ClientWebSocket> SweepAsync(CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            var sweep = CancellationTokenSource.CreateLinkedTokenSource(ct);
            var attempts = new Task<ClientWebSocket>[_ports.Length];
            for (var i = 0; i < _ports.Length; i++) attempts[i] = TryPortAsync(_ports[i], sweep.Token);

            Exception? last = null;
            var winner = -1;
            try
            {
                for (var i = 0; i < attempts.Length && winner < 0; i++)
                {
                    try
                    {
                        await attempts[i].ConfigureAwait(false);
                        winner = i;
                    }
                    catch (Exception e) when (!ct.IsCancellationRequested)
                    {
                        last = e;
                    }
                }
            }
            finally
            {
                // Abort the attempts still in flight, and close any that got through anyway.
                sweep.Cancel();
                for (var j = winner + 1; j < attempts.Length; j++)
                {
                    _ = attempts[j].ContinueWith(t =>
                    {
                        if (t.Status == TaskStatus.RanToCompletion)
                        {
                            t.Result.Abort();
                            t.Result.Dispose();
                        }
                        else
                        {
                            _ = t.Exception; // observed
                        }
                    }, TaskScheduler.Default);
                }
                _ = Task.WhenAll(attempts).ContinueWith(_ => sweep.Dispose(), TaskScheduler.Default);
            }
            if (winner >= 0) return attempts[winner].Result;
            ct.ThrowIfCancellationRequested();
            throw new RichPresenceException("The Subspace desktop app is not running (" + (last?.Message ?? "no answer") + ")", last);
        }

        private async Task<ClientWebSocket> TryPortAsync(int port, CancellationToken ct)
        {
            var socket = new ClientWebSocket();
            try
            {
                // Never route the loopback connection through a proxy. ClientWebSocket sends no Origin
                // header unless asked to, which is what the desktop app requires.
                socket.Options.Proxy = null;
            }
            catch (Exception)
            {
                // Some runtimes do not support proxy settings; there is nothing to turn off there.
            }
            var uri = new Uri("ws://" + _host + ":" + port.ToString(CultureInfo.InvariantCulture) + "/?v=1&client_id=" + _clientId);
            try
            {
                // Something else on the port that never says READY is not the desktop app.
                using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct))
                {
                    timeout.CancelAfter(_readyTimeout);
                    await socket.ConnectAsync(uri, timeout.Token).ConfigureAwait(false);
                    while (true)
                    {
                        var text = await ReceiveTextAsync(socket, timeout.Token).ConfigureAwait(false);
                        if (text == null) throw new RichPresenceException("port " + port.ToString(CultureInfo.InvariantCulture) + ": closed");
                        var msg = Json.ParseObject(text);
                        if (msg != null && msg.TryGetValue("evt", out var evt) && evt is string name && name == "READY") return socket;
                    }
                }
            }
            catch (Exception e)
            {
                socket.Abort();
                socket.Dispose();
                if (ct.IsCancellationRequested) throw new OperationCanceledException(ct);
                if (e is RichPresenceException) throw;
                var why = e is OperationCanceledException ? "no READY" : e.Message;
                throw new RichPresenceException("port " + port.ToString(CultureInfo.InvariantCulture) + ": " + why, e);
            }
        }

        private async Task ReceiveLoopAsync(ClientWebSocket socket)
        {
            try
            {
                while (true)
                {
                    var text = await ReceiveTextAsync(socket, CancellationToken.None).ConfigureAwait(false);
                    if (text == null) break;
                    HandleMessage(text);
                }
            }
            catch (Exception)
            {
                // The connection dropped.
            }

            bool current;
            List<TaskCompletionSource<bool>>? pending = null;
            lock (_gate)
            {
                current = ReferenceEquals(_socket, socket);
                if (current)
                {
                    _socket = null;
                    pending = new List<TaskCompletionSource<bool>>(_pending.Values);
                    _pending.Clear();
                }
            }
            socket.Abort();
            socket.Dispose();
            if (!current) return;
            foreach (var waiter in pending!) waiter.TrySetException(new RichPresenceException("Disconnected from the Subspace desktop app"));
            Raise(Disconnected);
        }

        /// <summary>The next text message, or null when the connection closed.</summary>
        private static async Task<string?> ReceiveTextAsync(ClientWebSocket socket, CancellationToken ct)
        {
            var buffer = new byte[4096];
            using (var message = new MemoryStream())
            {
                while (true)
                {
                    var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), ct).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close) return null;
                    message.Write(buffer, 0, result.Count);
                    if (message.Length > MaxIncomingBytes) throw new RichPresenceException("Message too large");
                    if (!result.EndOfMessage) continue;
                    if (result.MessageType == WebSocketMessageType.Text)
                        return Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length);
                    message.SetLength(0); // Binary: not part of the protocol.
                }
            }
        }

        private void HandleMessage(string text)
        {
            var msg = Json.ParseObject(text);
            if (msg == null || !msg.TryGetValue("nonce", out var rawNonce) || rawNonce == null) return;
            var nonce = rawNonce is double number ? number.ToString("R", CultureInfo.InvariantCulture) : rawNonce.ToString();
            if (nonce == null) return;
            TaskCompletionSource<bool>? waiter;
            lock (_gate)
            {
                if (!_pending.TryGetValue(nonce, out waiter)) return;
                _pending.Remove(nonce);
            }
            if (msg.TryGetValue("ok", out var ok) && ok is bool accepted && accepted)
            {
                waiter.TrySetResult(true);
            }
            else
            {
                var error = msg.TryGetValue("error", out var e) && e is string s && s.Length > 0 ? s : "Refused";
                waiter.TrySetException(new RichPresenceException(error));
            }
        }

        private async Task RequestAsync(string cmd, string? argsJson)
        {
            ClientWebSocket? socket;
            var nonce = Interlocked.Increment(ref _nonce).ToString(CultureInfo.InvariantCulture);
            var waiter = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            lock (_gate)
            {
                socket = _socket;
                if (socket == null) throw new RichPresenceException("Not connected");
                _pending[nonce] = waiter;
            }
            var frame = "{\"cmd\":" + Json.Quote(cmd) + ",\"nonce\":" + Json.Quote(nonce) + (argsJson != null ? ",\"args\":" + argsJson : "") + "}";
            var bytes = Encoding.UTF8.GetBytes(frame);
            try
            {
                using (var timer = new CancellationTokenSource(_replyTimeout))
                using (timer.Token.Register(() => waiter.TrySetException(new RichPresenceException(cmd + " timed out"))))
                {
                    await _sendLock.WaitAsync().ConfigureAwait(false);
                    try
                    {
                        await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None).ConfigureAwait(false);
                    }
                    catch (Exception e)
                    {
                        waiter.TrySetException(new RichPresenceException("Could not reach the Subspace desktop app: " + e.Message, e));
                    }
                    finally
                    {
                        _sendLock.Release();
                    }
                    await waiter.Task.ConfigureAwait(false);
                }
            }
            finally
            {
                lock (_gate) _pending.Remove(nonce);
            }
        }

        private void Raise(EventHandler? handler)
        {
            if (handler == null) return;
            foreach (EventHandler fn in handler.GetInvocationList())
            {
                try
                {
                    fn(this, EventArgs.Empty);
                }
                catch (Exception)
                {
                    // A throwing handler must not break the connection.
                }
            }
        }
    }
}
