using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace Subspace.RichPresence.Tests;

/// <summary>The HTTP upgrade request a client sent.</summary>
public sealed record Handshake(string Target, IReadOnlyDictionary<string, string> Headers);

/// <summary>
/// A stand-in for the Subspace desktop app's RPC server: a TcpListener with a hand-rolled WebSocket
/// handshake (no HttpListener, so no URL ACL or admin rights are needed on Windows).
/// </summary>
public sealed class FakeDesktop : IDisposable
{
    private readonly ConcurrentBag<TcpClient> _clients = new();
    private TcpListener? _listener;
    private CancellationTokenSource? _cts;

    public FakeDesktop(int port, bool sendReady = true)
    {
        Port = port;
        SendReady = sendReady;
    }

    public int Port { get; }

    /// <summary>Whether to say READY after the handshake (false: something else on the port).</summary>
    public bool SendReady { get; set; }

    /// <summary>How long to wait after the handshake before saying READY.</summary>
    public TimeSpan ReadyDelay { get; set; } = TimeSpan.Zero;

    /// <summary>Builds the reply to a command frame; null sends no reply.</summary>
    public Func<JsonElement, string?> Reply { get; set; } = msg => $"{{\"nonce\":{msg.GetProperty("nonce").GetRawText()},\"ok\":true}}";

    public Channel<Handshake> Handshakes { get; } = Channel.CreateUnbounded<Handshake>();

    /// <summary>Text frames from clients, as received.</summary>
    public Channel<string> Messages { get; } = Channel.CreateUnbounded<string>();

    /// <summary>The same text frames as raw payload bytes, exactly as many as the frame header announced.</summary>
    public Channel<byte[]> RawMessages { get; } = Channel.CreateUnbounded<byte[]>();

    /// <summary>One entry per client connection that ended; true when the client sent a close frame.</summary>
    public Channel<bool> Closed { get; } = Channel.CreateUnbounded<bool>();

    public FakeDesktop Start()
    {
        _cts = new CancellationTokenSource();
        _listener = new TcpListener(IPAddress.Loopback, Port);
        _listener.Start();
        _ = AcceptLoop(_listener, _cts.Token);
        return this;
    }

    /// <summary>Like quitting the desktop app: stop listening and drop every connection.</summary>
    public void Stop()
    {
        _cts?.Cancel();
        _listener?.Stop();
        _listener = null;
        foreach (var client in _clients) client.Close();
        _clients.Clear();
    }

    public void Dispose() => Stop();

    private async Task AcceptLoop(TcpListener listener, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await listener.AcceptTcpClientAsync(ct);
            }
            catch
            {
                return;
            }
            _clients.Add(client);
            _ = Serve(client, ct);
        }
    }

    private async Task Serve(TcpClient client, CancellationToken ct)
    {
        var sentClose = false;
        try
        {
            var stream = client.GetStream();
            var request = await ReadHeaders(stream, ct);
            var lines = request.Split("\r\n");
            var target = lines[0].Split(' ')[1];
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var line in lines.Skip(1))
            {
                var colon = line.IndexOf(':');
                if (colon > 0) headers[line[..colon].Trim()] = line[(colon + 1)..].Trim();
            }
            Handshakes.Writer.TryWrite(new Handshake(target, headers));

            if (headers.ContainsKey("Origin"))
            {
                await stream.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"), ct);
                return;
            }
            var accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(headers["Sec-WebSocket-Key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
            await stream.WriteAsync(Encoding.ASCII.GetBytes(
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n"), ct);
            if (ReadyDelay > TimeSpan.Zero) await Task.Delay(ReadyDelay, ct);
            if (SendReady) await WriteFrame(stream, 1, Encoding.UTF8.GetBytes("{\"evt\":\"READY\",\"v\":1}"), ct);

            while (true)
            {
                var (opcode, payload) = await ReadFrame(stream, ct);
                if (opcode == 8)
                {
                    sentClose = true;
                    await WriteFrame(stream, 8, payload.Length >= 2 ? payload[..2] : payload, ct);
                    return;
                }
                if (opcode == 9)
                {
                    await WriteFrame(stream, 10, payload, ct);
                    continue;
                }
                if (opcode != 1) continue;
                RawMessages.Writer.TryWrite(payload);
                var text = Encoding.UTF8.GetString(payload);
                Messages.Writer.TryWrite(text);
                using var doc = JsonDocument.Parse(text);
                var reply = Reply(doc.RootElement);
                if (reply != null) await WriteFrame(stream, 1, Encoding.UTF8.GetBytes(reply), ct);
            }
        }
        catch
        {
            // Client went away or we were stopped.
        }
        finally
        {
            client.Close();
            Closed.Writer.TryWrite(sentClose);
        }
    }

    private static async Task<string> ReadHeaders(NetworkStream stream, CancellationToken ct)
    {
        var bytes = new List<byte>();
        var one = new byte[1];
        while (true)
        {
            if (await stream.ReadAsync(one, ct) == 0) throw new IOException("closed");
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
        var masked = (head[1] & 0x80) != 0;
        if (!masked) throw new IOException("client frames must be masked");
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

    private static async Task WriteFrame(NetworkStream stream, int opcode, byte[] payload, CancellationToken ct)
    {
        var header = new List<byte> { (byte)(0x80 | opcode) };
        if (payload.Length < 126)
        {
            header.Add((byte)payload.Length);
        }
        else
        {
            header.Add(126);
            header.Add((byte)(payload.Length >> 8));
            header.Add((byte)payload.Length);
        }
        await stream.WriteAsync(header.ToArray(), ct);
        await stream.WriteAsync(payload, ct);
    }
}
