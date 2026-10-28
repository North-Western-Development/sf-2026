#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Subspace.Bot
{
    /// <summary>How to reach the instance.</summary>
    public sealed class SubspaceBotOptions
    {
        /// <summary>The bot token (without the <c>Bot </c> prefix).</summary>
        public string Token { get; set; } = "";

        /// <summary>The instance, e.g. <c>https://subspace.click</c>.</summary>
        public string BaseUrl { get; set; } = "";

        /// <summary>The gateway's WebSocket URL; by default <c>&lt;BaseUrl&gt;/gateway</c> with ws(s).</summary>
        public string? GatewayUrl { get; set; }

        /// <summary>An HttpClient to use for REST calls; the bot makes its own when null.</summary>
        public HttpClient? HttpClient { get; set; }

        /// <summary>Reconnect when the gateway connection drops (default true).</summary>
        public bool AutoReconnect { get; set; } = true;

        /// <summary>How long to wait before reconnecting (default 2 seconds).</summary>
        public TimeSpan ReconnectDelay { get; set; } = TimeSpan.FromSeconds(2);
    }

    /// <summary>
    /// A Subspace Frequency bot: the REST API (as <c>Authorization: Bot &lt;token&gt;</c>) and the gateway.
    /// <code>
    /// var bot = new SubspaceBot(new SubspaceBotOptions { Token = token, BaseUrl = "https://subspace.click" });
    /// await bot.RegisterCommandsAsync(new[] { new CommandDefinition { Name = "ping", Description = "Check the bot is alive" } });
    /// bot.InteractionReceived += i => i.ReplyAsync("Pong!");
    /// await bot.ConnectAsync();
    /// </code>
    /// Event handlers run on the gateway's receive loop up to their first await; the loop does not wait
    /// for the rest. Exceptions they throw are reported through <see cref="Error"/>.
    /// </summary>
    public sealed class SubspaceBot : IDisposable
    {
        private const int InvalidTokenCloseCode = 4003;
        private static readonly HttpMethod Patch = new HttpMethod("PATCH");

        private readonly SubspaceBotOptions _options;
        private readonly HttpClient _http;
        private readonly bool _ownsHttp;
        private readonly object _gate = new object();
        private Connection? _connection;
        private TaskCompletionSource<bool>? _ready;
        private volatile bool _closing;
        private bool _disposed;

        /// <summary>Creates a bot for a token and instance.</summary>
        public SubspaceBot(string token, string baseUrl) : this(new SubspaceBotOptions { Token = token, BaseUrl = baseUrl }) { }

        /// <summary>Creates a bot.</summary>
        public SubspaceBot(SubspaceBotOptions options)
        {
            _options = options ?? throw new ArgumentNullException(nameof(options));
            if (string.IsNullOrEmpty(options.Token)) throw new ArgumentException("A bot token is required", nameof(options));
            if (string.IsNullOrEmpty(options.BaseUrl)) throw new ArgumentException("A base URL is required", nameof(options));
            _http = options.HttpClient ?? new HttpClient();
            _ownsHttp = options.HttpClient == null;
        }

        /// <summary>Who the bot is, once connected or after <see cref="MeAsync"/>.</summary>
        public BotUser? User { get; private set; }

        /// <summary>Whether the gateway connection is open and identified.</summary>
        public bool IsConnected
        {
            get
            {
                lock (_gate) return _connection != null && _connection.Identified;
            }
        }

        /// <summary>Connected (the READY payload).</summary>
        public event Func<JsonElement, Task>? Ready;

        /// <summary>A message in a beacon the bot is in.</summary>
        public event Func<Message, Task>? MessageReceived;

        /// <summary>A message was edited.</summary>
        public event Func<Message, Task>? MessageUpdated;

        /// <summary>A message was deleted (the TRANSMISSION_DELETE payload).</summary>
        public event Func<JsonElement, Task>? MessageDeleted;

        /// <summary>Someone used one of the bot's commands.</summary>
        public event Func<Interaction, Task>? InteractionReceived;

        /// <summary>Every gateway event, as (type, data).</summary>
        public event Func<string, JsonElement, Task>? Dispatch;

        /// <summary>The gateway connection closed (the bot reconnects unless told to stop or the token is invalid).</summary>
        public event Action<GatewayClose>? Disconnected;

        /// <summary>Something failed in the background: a handler threw, or reconnecting failed.</summary>
        public event Action<Exception>? Error;

        private string ApiBase => _options.BaseUrl.TrimEnd('/') + "/api/v1";

        /// <summary>The gateway URL used by <see cref="ConnectAsync"/>.</summary>
        public string GatewayUrl
        {
            get
            {
                if (!string.IsNullOrEmpty(_options.GatewayUrl)) return _options.GatewayUrl!;
                var baseUrl = _options.BaseUrl.TrimEnd('/');
                if (baseUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) baseUrl = "wss://" + baseUrl.Substring(8);
                else if (baseUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) baseUrl = "ws://" + baseUrl.Substring(7);
                return baseUrl + "/gateway";
            }
        }

        // ---- REST ------------------------------------------------------------------------------

        /// <summary>
        /// A REST call to <c>/api/v1{path}</c>. <paramref name="body"/> is serialized as JSON (camelCase).
        /// <paramref name="asBot"/> false leaves out the bot token (the interaction endpoints, where the URL's
        /// token is the credential). Returns the response JSON, or an Undefined element for 204.
        /// </summary>
        /// <exception cref="SubspaceApiException">The server answered with an error.</exception>
        public async Task<JsonElement> RestAsync(HttpMethod method, string path, object? body = null, bool asBot = true, CancellationToken cancellationToken = default)
        {
            using (var request = new HttpRequestMessage(method, ApiBase + path))
            {
                if (asBot) request.Headers.TryAddWithoutValidation("Authorization", "Bot " + _options.Token);
                if (body != null)
                {
                    var json = JsonSerializer.Serialize(body, body.GetType(), JsonDefaults.Options);
                    request.Content = new StringContent(json, Encoding.UTF8, "application/json");
                }
                using (var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false))
                {
                    var status = (int)response.StatusCode;
                    if (status == 204) return default;
                    var text = response.Content == null ? "" : await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                    JsonElement data = default;
                    if (!string.IsNullOrWhiteSpace(text))
                    {
                        try
                        {
                            using (var doc = JsonDocument.Parse(text)) data = doc.RootElement.Clone();
                        }
                        catch (JsonException)
                        {
                            data = default;
                        }
                    }
                    if (!response.IsSuccessStatusCode)
                    {
                        string? message = null, code = null;
                        if (data.ValueKind == JsonValueKind.Object)
                        {
                            if (data.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String) message = e.GetString();
                            if (data.TryGetProperty("code", out var c) && c.ValueKind == JsonValueKind.String) code = c.GetString();
                        }
                        throw new SubspaceApiException(string.IsNullOrEmpty(message) ? response.ReasonPhrase ?? ("HTTP " + status) : message!, status, code);
                    }
                    return data;
                }
            }
        }

        /// <summary>A REST call whose response is converted to <typeparamref name="T"/>.</summary>
        public async Task<T> RestAsync<T>(HttpMethod method, string path, object? body = null, bool asBot = true, CancellationToken cancellationToken = default)
        {
            var data = await RestAsync(method, path, body, asBot, cancellationToken).ConfigureAwait(false);
            return Convert<T>(data);
        }

        private static T Convert<T>(JsonElement element) =>
            element.ValueKind == JsonValueKind.Undefined ? default! : JsonSerializer.Deserialize<T>(element.GetRawText(), JsonDefaults.Options)!;

        private static JsonElement Property(JsonElement element, string name) =>
            element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) ? value : default;

        /// <summary>The bot account (<c>GET /bots/@me</c>); also sets <see cref="User"/>.</summary>
        public async Task<BotUser> MeAsync(CancellationToken cancellationToken = default)
        {
            var data = await RestAsync(HttpMethod.Get, "/bots/@me", null, true, cancellationToken).ConfigureAwait(false);
            var bot = Convert<BotUser>(Property(data, "bot")) ?? throw new SubspaceApiException("Unexpected /bots/@me response", 500);
            User = bot;
            return bot;
        }

        /// <summary>Post in a relay or thread the bot can see. A string is a plain text message.</summary>
        public async Task<Message> SendAsync(string channelType, string channelId, NewMessage message, CancellationToken cancellationToken = default)
        {
            var data = await RestAsync(HttpMethod.Post, $"/channels/{channelType}/{channelId}/transmissions", message, true, cancellationToken).ConfigureAwait(false);
            var transmission = Property(data, "transmission");
            var result = ToMessage(transmission);
            if (string.IsNullOrEmpty(result.ChannelType)) result.ChannelType = channelType;
            if (string.IsNullOrEmpty(result.ChannelId)) result.ChannelId = channelId;
            return result;
        }

        /// <summary>Change one of the bot's messages.</summary>
        public Task EditAsync(string transmissionId, string content, CancellationToken cancellationToken = default) =>
            RestAsync(Patch, $"/transmissions/{transmissionId}", new NewMessage { Content = content }, true, cancellationToken);

        /// <summary>Delete a message.</summary>
        public Task DeleteAsync(string transmissionId, CancellationToken cancellationToken = default) =>
            RestAsync(HttpMethod.Delete, $"/transmissions/{transmissionId}", null, true, cancellationToken);

        /// <summary>React to a message with an emoji.</summary>
        public Task ReactAsync(string transmissionId, string emoji, CancellationToken cancellationToken = default) =>
            RestAsync(HttpMethod.Put, $"/transmissions/{transmissionId}/reactions/{Uri.EscapeDataString(emoji)}/@me", null, true, cancellationToken);

        /// <summary>Replace the bot's commands: everywhere, or in one beacon.</summary>
        public async Task<IReadOnlyList<RegisteredCommand>> RegisterCommandsAsync(IEnumerable<CommandDefinition> commands, string? beaconId = null, CancellationToken cancellationToken = default)
        {
            var appId = (User ?? await MeAsync(cancellationToken).ConfigureAwait(false)).AppId;
            var path = beaconId == null ? $"/applications/{appId}/commands" : $"/applications/{appId}/beacons/{beaconId}/commands";
            var list = commands.ToList();
            var data = await RestAsync(HttpMethod.Put, path, list, true, cancellationToken).ConfigureAwait(false);
            return Convert<List<RegisteredCommand>>(Property(data, "commands")) ?? new List<RegisteredCommand>();
        }

        /// <summary>Wraps an interaction received over HTTP so it can be answered later (follow-ups, edits).</summary>
        public Interaction ParseInteraction(string rawBody) => new Interaction(this, Interactions.Parse(rawBody));

        private static Message ToMessage(JsonElement transmission)
        {
            var message = Convert<Message>(transmission) ?? new Message();
            message.Raw = transmission;
            return message;
        }

        // ---- Gateway -----------------------------------------------------------------------------

        /// <summary>
        /// Connects to the gateway and completes on READY. Throws <see cref="SubspaceApiException"/> (401,
        /// <c>INVALID_BOT_TOKEN</c>) when the gateway refuses the token. Afterwards the bot reconnects on
        /// its own until <see cref="DisconnectAsync"/>.
        /// </summary>
        public async Task ConnectAsync(CancellationToken cancellationToken = default)
        {
            if (_disposed) throw new ObjectDisposedException(nameof(SubspaceBot));
            if (User == null) await MeAsync(cancellationToken).ConfigureAwait(false);
            _closing = false;
            var ready = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            lock (_gate) _ready = ready;
            await OpenAsync(cancellationToken).ConfigureAwait(false);
            using (cancellationToken.Register(() => ready.TrySetCanceled()))
            {
                await ready.Task.ConfigureAwait(false);
            }
        }

        /// <summary>Closes the gateway connection and stops reconnecting.</summary>
        public async Task DisconnectAsync()
        {
            _closing = true;
            Connection? connection;
            lock (_gate)
            {
                connection = _connection;
                _ready?.TrySetCanceled();
            }
            if (connection == null) return;
            await connection.CloseAsync().ConfigureAwait(false);
            // Wait for the server's close frame (the connection gives up on it after 5 seconds).
            await Task.WhenAny(connection.Completion, Task.Delay(TimeSpan.FromSeconds(6))).ConfigureAwait(false);
        }

        /// <summary>Disconnects, and disposes the HttpClient if the bot made it.</summary>
        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            try
            {
                DisconnectAsync().Wait(TimeSpan.FromSeconds(5));
            }
            catch
            {
                // Already gone.
            }
            if (_ownsHttp) _http.Dispose();
        }

        private async Task OpenAsync(CancellationToken cancellationToken)
        {
            var socket = new ClientWebSocket();
            try
            {
                await socket.ConnectAsync(new Uri(GatewayUrl), cancellationToken).ConfigureAwait(false);
            }
            catch
            {
                socket.Dispose();
                throw;
            }
            var connection = new Connection(this, socket);
            lock (_gate)
            {
                if (_closing)
                {
                    socket.Dispose();
                    return;
                }
                _connection = connection;
            }
            connection.Completion = connection.RunAsync();
        }

        private void OnClosed(Connection connection, GatewayClose close)
        {
            lock (_gate)
            {
                if (_connection == connection) _connection = null;
            }
            try
            {
                Disconnected?.Invoke(close);
            }
            catch (Exception e)
            {
                RaiseError(e);
            }
            if (close.Code == InvalidTokenCloseCode)
            {
                lock (_gate) _ready?.TrySetException(new SubspaceApiException("Invalid bot token", 401, "INVALID_BOT_TOKEN"));
                return;
            }
            if (!_closing && !_disposed && _options.AutoReconnect) _ = ReconnectAsync();
            else lock (_gate) _ready?.TrySetException(new WebSocketException($"The gateway closed the connection ({close.Code} {close.Reason})"));
        }

        private async Task ReconnectAsync()
        {
            while (!_closing && !_disposed)
            {
                await Task.Delay(_options.ReconnectDelay).ConfigureAwait(false);
                if (_closing || _disposed) return;
                try
                {
                    await OpenAsync(CancellationToken.None).ConfigureAwait(false);
                    return;
                }
                catch (Exception e)
                {
                    RaiseError(e);
                }
            }
        }

        private void RaiseError(Exception error)
        {
            try
            {
                Error?.Invoke(error);
            }
            catch
            {
                // An error handler that throws has nowhere left to report to.
            }
        }

        private void Raise<T>(Func<T, Task>? handlers, T arg)
        {
            if (handlers == null) return;
            foreach (var handler in handlers.GetInvocationList().Cast<Func<T, Task>>())
            {
                Task task;
                try
                {
                    task = handler(arg);
                }
                catch (Exception e)
                {
                    RaiseError(e);
                    continue;
                }
                Observe(task);
            }
        }

        private void Observe(Task? task)
        {
            if (task == null) return;
            task.ContinueWith(t => RaiseError(t.Exception!.GetBaseException()), CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);
        }

        private void HandleDispatch(string type, JsonElement data)
        {
            try
            {
                switch (type)
                {
                    case "READY":
                        lock (_gate) _ready?.TrySetResult(true);
                        Raise(Ready, data);
                        break;
                    case "TRANSMISSION_CREATE":
                    case "TRANSMISSION_UPDATE":
                        var transmission = Property(data, "transmission");
                        if (transmission.ValueKind == JsonValueKind.Object)
                        {
                            var message = ToMessage(transmission);
                            var channelType = Property(data, "channelType");
                            var channelId = Property(data, "channelId");
                            if (channelType.ValueKind == JsonValueKind.String) message.ChannelType = channelType.GetString()!;
                            if (channelId.ValueKind == JsonValueKind.String) message.ChannelId = channelId.GetString()!;
                            Raise(type == "TRANSMISSION_CREATE" ? MessageReceived : MessageUpdated, message);
                        }
                        break;
                    case "TRANSMISSION_DELETE":
                        Raise(MessageDeleted, data);
                        break;
                    case "INTERACTION_CREATE":
                        var payload = Convert<InteractionPayload>(data);
                        if (payload != null) Raise(InteractionReceived, new Interaction(this, payload));
                        break;
                }
            }
            catch (Exception e)
            {
                RaiseError(e);
            }

            var dispatch = Dispatch;
            if (dispatch == null) return;
            foreach (var handler in dispatch.GetInvocationList().Cast<Func<string, JsonElement, Task>>())
            {
                try
                {
                    Observe(handler(type, data));
                }
                catch (Exception e)
                {
                    RaiseError(e);
                }
            }
        }

        /// <summary>One WebSocket connection to the gateway.</summary>
        private sealed class Connection
        {
            private readonly SubspaceBot _bot;
            private readonly ClientWebSocket _socket;
            private readonly SemaphoreSlim _sendLock = new SemaphoreSlim(1, 1);
            private readonly CancellationTokenSource _stop = new CancellationTokenSource();

            public Connection(SubspaceBot bot, ClientWebSocket socket)
            {
                _bot = bot;
                _socket = socket;
            }

            public volatile bool Identified;

            public Task Completion { get; set; } = Task.CompletedTask;

            public async Task RunAsync()
            {
                var close = new GatewayClose(1006, "");
                try
                {
                    while (_socket.State == WebSocketState.Open)
                    {
                        var text = await ReceiveAsync().ConfigureAwait(false);
                        if (text == null) break;
                        await HandleAsync(text).ConfigureAwait(false);
                    }
                    if (_socket.CloseStatus.HasValue) close = new GatewayClose((int)_socket.CloseStatus.Value, _socket.CloseStatusDescription ?? "");
                }
                catch (Exception e) when (!(e is OperationCanceledException))
                {
                    if (_socket.CloseStatus.HasValue) close = new GatewayClose((int)_socket.CloseStatus.Value, _socket.CloseStatusDescription ?? "");
                    else if (!_bot._closing) _bot.RaiseError(e);
                }
                catch (OperationCanceledException)
                {
                    // Closed by us.
                }
                finally
                {
                    Identified = false;
                    _stop.Cancel();
                    _socket.Dispose();
                }
                _bot.OnClosed(this, close);
            }

            private async Task<string?> ReceiveAsync()
            {
                var buffer = new byte[16 * 1024];
                using (var stream = new MemoryStream())
                {
                    while (true)
                    {
                        var result = await _socket.ReceiveAsync(new ArraySegment<byte>(buffer), _stop.Token).ConfigureAwait(false);
                        if (result.MessageType == WebSocketMessageType.Close)
                        {
                            if (_socket.State == WebSocketState.CloseReceived)
                            {
                                try
                                {
                                    await _socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None).ConfigureAwait(false);
                                }
                                catch
                                {
                                    // The peer is gone already.
                                }
                            }
                            return null;
                        }
                        stream.Write(buffer, 0, result.Count);
                        if (stream.Length > 64L * 1024 * 1024) throw new InvalidDataException("Gateway message too large");
                        if (result.EndOfMessage)
                        {
                            if (result.MessageType != WebSocketMessageType.Text)
                            {
                                stream.SetLength(0);
                                continue;
                            }
                            return Encoding.UTF8.GetString(stream.GetBuffer(), 0, (int)stream.Length);
                        }
                    }
                }
            }

            private async Task HandleAsync(string text)
            {
                int op;
                string? type = null;
                JsonElement data = default;
                try
                {
                    using (var doc = JsonDocument.Parse(text))
                    {
                        var root = doc.RootElement;
                        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("op", out var opElement) || !opElement.TryGetInt32(out op)) return;
                        if (root.TryGetProperty("t", out var t) && t.ValueKind == JsonValueKind.String) type = t.GetString();
                        if (root.TryGetProperty("d", out var d)) data = d.Clone();
                    }
                }
                catch (JsonException)
                {
                    return;
                }

                switch (op)
                {
                    case 10: // HELLO
                        var every = 30000;
                        var interval = Property(data, "heartbeat_interval");
                        if (interval.ValueKind == JsonValueKind.Number && interval.TryGetInt32(out var ms) && ms > 0) every = ms;
                        _ = HeartbeatAsync(every);
                        await SendAsync("{\"op\":2,\"d\":{\"token\":" + JsonSerializer.Serialize("Bot " + _bot._options.Token) + "}}").ConfigureAwait(false);
                        break;
                    case 7: // RECONNECT: drop this connection and open a new one.
                        await CloseAsync(WebSocketCloseStatus.NormalClosure).ConfigureAwait(false);
                        break;
                    case 0: // DISPATCH
                        if (type == null) return;
                        if (type == "READY") Identified = true;
                        _bot.HandleDispatch(type, data);
                        break;
                }
            }

            private async Task HeartbeatAsync(int everyMs)
            {
                try
                {
                    while (!_stop.IsCancellationRequested)
                    {
                        await Task.Delay(everyMs, _stop.Token).ConfigureAwait(false);
                        if (_socket.State != WebSocketState.Open) return;
                        await SendAsync("{\"op\":1}").ConfigureAwait(false);
                    }
                }
                catch
                {
                    // Stopped, or the connection dropped (the receive loop reports that).
                }
            }

            private async Task SendAsync(string text)
            {
                var bytes = Encoding.UTF8.GetBytes(text);
                await _sendLock.WaitAsync(_stop.Token).ConfigureAwait(false);
                try
                {
                    await _socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, _stop.Token).ConfigureAwait(false);
                }
                finally
                {
                    _sendLock.Release();
                }
            }

            public Task CloseAsync() => CloseAsync(WebSocketCloseStatus.NormalClosure);

            private async Task CloseAsync(WebSocketCloseStatus status)
            {
                if (_socket.State != WebSocketState.Open && _socket.State != WebSocketState.CloseReceived)
                {
                    _stop.Cancel();
                    return;
                }
                try
                {
                    await _sendLock.WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false);
                    try
                    {
                        using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5)))
                        {
                            await _socket.CloseOutputAsync(status, "", timeout.Token).ConfigureAwait(false);
                        }
                        _stop.CancelAfter(TimeSpan.FromSeconds(5));
                    }
                    finally
                    {
                        _sendLock.Release();
                    }
                }
                catch
                {
                    _stop.Cancel();
                }
            }
        }
    }
}
