using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace Subspace.Bot.Tests;

/// <summary>An HTTP request the bot made.</summary>
public sealed record RecordedRequest(string Method, string Path, IReadOnlyDictionary<string, string> Headers, string Body)
{
    public JsonElement Json => JsonDocument.Parse(Body).RootElement;
}

/// <summary>
/// A stand-in for a Subspace instance on one loopback port: plain HTTP for /api/v1 and a WebSocket
/// gateway on /gateway (HELLO, IDENTIFY with "Bot &lt;token&gt;", READY, then whatever the test dispatches).
/// TcpListener with hand-rolled HTTP and WebSocket framing, so no admin rights or URL ACLs are needed.
/// </summary>
public sealed class FakeServer : IDisposable
{
    private readonly TcpListener _listener = new(IPAddress.Loopback, 0);
    private readonly CancellationTokenSource _cts = new();
    private readonly ConcurrentDictionary<int, GatewayClient> _gateways = new();
    private readonly ConcurrentBag<TcpClient> _clients = new();
    private int _nextId;

    public FakeServer(string token = "secret-token")
    {
        Token = token;
        _listener.Start();
        _ = AcceptLoop();
    }

    public string Token { get; }
    public int Port => ((IPEndPoint)_listener.LocalEndpoint).Port;
    public string BaseUrl => $"http://127.0.0.1:{Port}";

    /// <summary>HELLO's heartbeat_interval.</summary>
    public int HeartbeatInterval { get; set; } = 30000;

    /// <summary>The bot GET /bots/@me returns.</summary>
    public string MeJson { get; set; } = "{\"bot\":{\"id\":\"100\",\"username\":\"dice\",\"appId\":\"200\",\"beaconIds\":[\"300\"]}}";

    /// <summary>Answers a REST request; null falls back to the defaults (GET /bots/@me, else 200 {}).</summary>
    public Func<RecordedRequest, (int Status, string Body)?> Handler { get; set; } = _ => null;

    public Channel<RecordedRequest> Requests { get; } = Channel.CreateUnbounded<RecordedRequest>();

    /// <summary>Text frames clients sent on the gateway.</summary>
    public Channel<JsonElement> GatewayFrames { get; } = Channel.CreateUnbounded<JsonElement>();

    /// <summary>Paths of WebSocket upgrades, one per connection.</summary>
    public Channel<string> GatewayConnections { get; } = Channel.CreateUnbounded<string>();

    /// <summary>One entry per gateway connection that ended; true when the client sent a close frame.</summary>
    public Channel<bool> GatewayClosed { get; } = Channel.CreateUnbounded<bool>();

    public int OpenGateways => _gateways.Count;

    /// <summary>Sends a dispatch (op 0) to every identified gateway client.</summary>
    public async Task DispatchAsync(string type, string dataJson)
    {
        foreach (var client in _gateways.Values.Where(c => c.Identified))
            await client.SendTextAsync($"{{\"op\":0,\"t\":\"{type}\",\"d\":{dataJson}}}");
    }

    /// <summary>Drops every gateway connection without a close frame.</summary>
    public void DropGateways()
    {
        foreach (var client in _gateways.Values) client.Tcp.Close();
    }

    /// <summary>Closes every gateway connection with a close frame.</summary>
    public async Task CloseGatewaysAsync(int code)
    {
        foreach (var client in _gateways.Values) await client.SendCloseAsync(code);
    }

    public void Dispose()
    {
        _cts.Cancel();
        _listener.Stop();
        foreach (var client in _clients) client.Close();
    }

    private async Task AcceptLoop()
    {
        while (!_cts.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await _listener.AcceptTcpClientAsync(_cts.Token);
            }
            catch
            {
                return;
            }
            _clients.Add(client);
            _ = Serve(client);
        }
    }

    private async Task Serve(TcpClient tcp)
    {
        try
        {
            var stream = tcp.GetStream();
            while (true)
            {
                var head = await ReadHeaders(stream, _cts.Token);
                if (head == null) return;
                var lines = head.Split("\r\n");
                var parts = lines[0].Split(' ');
                var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var line in lines.Skip(1))
                {
                    var colon = line.IndexOf(':');
                    if (colon > 0) headers[line[..colon].Trim()] = line[(colon + 1)..].Trim();
                }
                if (headers.TryGetValue("Upgrade", out var upgrade) && upgrade.Equals("websocket", StringComparison.OrdinalIgnoreCase))
                {
                    await ServeGateway(tcp, stream, parts[1], headers);
                    return;
                }
                var length = headers.TryGetValue("Content-Length", out var cl) ? int.Parse(cl) : 0;
                var body = new byte[length];
                await ReadExactly(stream, body, _cts.Token);
                var request = new RecordedRequest(parts[0], parts[1], headers, Encoding.UTF8.GetString(body));
                Requests.Writer.TryWrite(request);
                var (status, responseBody) = Handler(request) ?? Default(request);
                var payload = Encoding.UTF8.GetBytes(responseBody);
                var reason = status switch { 200 => "OK", 201 => "Created", 202 => "Accepted", 204 => "No Content", 401 => "Unauthorized", 403 => "Forbidden", 404 => "Not Found", _ => "Status" };
                var response = $"HTTP/1.1 {status} {reason}\r\n" +
                               (status == 204 ? "" : $"Content-Type: application/json\r\nContent-Length: {payload.Length}\r\n") +
                               "Connection: keep-alive\r\n\r\n";
                await stream.WriteAsync(Encoding.ASCII.GetBytes(response), _cts.Token);
                if (status != 204) await stream.WriteAsync(payload, _cts.Token);
            }
        }
        catch
        {
            // Client went away or we were stopped.
        }
        finally
        {
            tcp.Close();
        }
    }

    private (int, string) Default(RecordedRequest request)
    {
        if (request.Method == "GET" && request.Path == "/api/v1/bots/@me")
        {
            return request.Headers.TryGetValue("Authorization", out var auth) && auth == "Bot " + Token
                ? (200, MeJson)
                : (401, "{\"error\":\"Invalid bot token\",\"code\":\"INVALID_BOT_TOKEN\"}");
        }
        return (200, "{}");
    }

    private async Task ServeGateway(TcpClient tcp, NetworkStream stream, string path, Dictionary<string, string> headers)
    {
        var id = Interlocked.Increment(ref _nextId);
        var client = new GatewayClient(tcp, stream);
        var sentClose = false;
        _gateways[id] = client;
        try
        {
            var accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(headers["Sec-WebSocket-Key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
            await client.WriteRawAsync(Encoding.ASCII.GetBytes(
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n"));
            GatewayConnections.Writer.TryWrite(path);
            await client.SendTextAsync($"{{\"op\":10,\"d\":{{\"heartbeat_interval\":{HeartbeatInterval}}}}}");
            while (true)
            {
                var (opcode, payload) = await ReadFrame(stream, _cts.Token);
                if (opcode == 8)
                {
                    sentClose = true;
                    if (!client.SentClose) await client.SendFrameAsync(8, payload.Length >= 2 ? payload[..2] : payload);
                    return;
                }
                if (opcode == 9)
                {
                    await client.SendFrameAsync(10, payload);
                    continue;
                }
                if (opcode != 1) continue;
                var frame = JsonDocument.Parse(Encoding.UTF8.GetString(payload)).RootElement;
                GatewayFrames.Writer.TryWrite(frame);
                var op = frame.GetProperty("op").GetInt32();
                if (op == 1) await client.SendTextAsync("{\"op\":11}");
                if (op == 2)
                {
                    if (frame.GetProperty("d").GetProperty("token").GetString() != "Bot " + Token)
                    {
                        await client.SendCloseAsync(4003, "Invalid or expired authentication ticket");
                        continue;
                    }
                    client.Identified = true;
                    await client.SendTextAsync("{\"op\":0,\"t\":\"READY\",\"d\":{\"transmitter\":{\"id\":\"100\",\"username\":\"dice\"},\"session_id\":\"s1\"}}");
                }
            }
        }
        catch
        {
            // Dropped.
        }
        finally
        {
            _gateways.TryRemove(id, out _);
            tcp.Close();
            GatewayClosed.Writer.TryWrite(sentClose);
        }
    }

    private sealed class GatewayClient
    {
        private readonly SemaphoreSlim _lock = new(1, 1);

        public GatewayClient(TcpClient tcp, NetworkStream stream)
        {
            Tcp = tcp;
            Stream = stream;
        }

        public TcpClient Tcp { get; }
        public NetworkStream Stream { get; }
        public volatile bool Identified;
        public volatile bool SentClose;

        public async Task WriteRawAsync(byte[] bytes)
        {
            await _lock.WaitAsync();
            try { await Stream.WriteAsync(bytes); } finally { _lock.Release(); }
        }

        public Task SendTextAsync(string text) => SendFrameAsync(1, Encoding.UTF8.GetBytes(text));

        public Task SendCloseAsync(int code, string reason = "")
        {
            SentClose = true;
            var r = Encoding.UTF8.GetBytes(reason);
            var payload = new byte[2 + r.Length];
            payload[0] = (byte)(code >> 8);
            payload[1] = (byte)code;
            r.CopyTo(payload, 2);
            return SendFrameAsync(8, payload);
        }

        public async Task SendFrameAsync(int opcode, byte[] payload)
        {
            var header = new List<byte> { (byte)(0x80 | opcode) };
            if (payload.Length < 126) header.Add((byte)payload.Length);
            else if (payload.Length <= 0xFFFF)
            {
                header.Add(126);
                header.Add((byte)(payload.Length >> 8));
                header.Add((byte)payload.Length);
            }
            else
            {
                header.Add(127);
                for (var i = 7; i >= 0; i--) header.Add((byte)((long)payload.Length >> (8 * i)));
            }
            await WriteRawAsync(header.Concat(payload).ToArray());
        }
    }

    private static async Task<string?> ReadHeaders(NetworkStream stream, CancellationToken ct)
    {
        var bytes = new List<byte>();
        var one = new byte[1];
        while (true)
        {
            if (await stream.ReadAsync(one, ct) == 0)
            {
                if (bytes.Count == 0) return null;
                throw new IOException("closed");
            }
            bytes.Add(one[0]);
            var n = bytes.Count;
            if (n >= 4 && bytes[n - 4] == '\r' && bytes[n - 3] == '\n' && bytes[n - 2] == '\r' && bytes[n - 1] == '\n')
                return Encoding.ASCII.GetString(bytes.ToArray(), 0, n - 4);
            if (n > 16 * 1024) throw new IOException("headers too large");
        }
    }

    private static async Task ReadExactly(NetworkStream stream, byte[] buffer, CancellationToken ct)
    {
        var read = 0;
        while (read < buffer.Length)
        {
            var n = await stream.ReadAsync(buffer.AsMemory(read), ct);
            if (n == 0) throw new IOException("closed");
            read += n;
        }
    }

    private static async Task<(int Opcode, byte[] Payload)> ReadFrame(NetworkStream stream, CancellationToken ct)
    {
        var head = new byte[2];
        await ReadExactly(stream, head, ct);
        var opcode = head[0] & 0x0F;
        if ((head[1] & 0x80) == 0) throw new IOException("client frames must be masked");
        long length = head[1] & 0x7F;
        if (length == 126)
        {
            var ext = new byte[2];
            await ReadExactly(stream, ext, ct);
            length = (ext[0] << 8) | ext[1];
        }
        else if (length == 127)
        {
            var ext = new byte[8];
            await ReadExactly(stream, ext, ct);
            length = 0;
            foreach (var b in ext) length = (length << 8) | b;
        }
        var mask = new byte[4];
        await ReadExactly(stream, mask, ct);
        var payload = new byte[length];
        await ReadExactly(stream, payload, ct);
        for (var i = 0; i < payload.Length; i++) payload[i] ^= mask[i % 4];
        return (opcode, payload);
    }
}
