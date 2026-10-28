#nullable enable
using System;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Subspace.Bot
{
    /// <summary>A REST call the server refused.</summary>
    public sealed class SubspaceApiException : Exception
    {
        /// <summary>Creates the exception.</summary>
        public SubspaceApiException(string message, int status, string? code = null) : base(message)
        {
            Status = status;
            Code = code;
        }

        /// <summary>The HTTP status.</summary>
        public int Status { get; }

        /// <summary>The server's error code, such as <c>BOT_FORBIDDEN</c> or <c>UNKNOWN_INTERACTION</c>.</summary>
        public string? Code { get; }
    }

    internal static class JsonDefaults
    {
        public static readonly JsonSerializerOptions Options = Create();

        private static JsonSerializerOptions Create()
        {
            var options = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                PropertyNameCaseInsensitive = true,
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            };
            options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
            return options;
        }
    }

    /// <summary>
    /// Interactions delivered to an HTTP endpoint (the application's Interactions Endpoint URL):
    /// check each request's signature, then answer in the response body.
    /// </summary>
    public static class Interactions
    {
        /// <summary>How old a signed request may be.</summary>
        public static readonly TimeSpan MaxAge = TimeSpan.FromMinutes(5);

        /// <summary>
        /// Whether a request really came from Subspace. Pass the raw body exactly as received, the
        /// <c>X-Signature-Ed25519</c> and <c>X-Signature-Timestamp</c> headers, and the application's
        /// public key (hex). Requests more than five minutes old are rejected.
        /// </summary>
        public static bool Verify(string rawBody, string? signature, string? timestamp, string publicKeyHex) =>
            Verify(Encoding.UTF8.GetBytes(rawBody ?? ""), signature, timestamp, publicKeyHex, DateTimeOffset.UtcNow);

        /// <summary>As <see cref="Verify(string, string, string, string)"/>, for a body read as bytes.</summary>
        public static bool Verify(byte[] rawBody, string? signature, string? timestamp, string publicKeyHex) =>
            Verify(rawBody, signature, timestamp, publicKeyHex, DateTimeOffset.UtcNow);

        /// <summary>As <see cref="Verify(string, string, string, string)"/>, checking the age against <paramref name="now"/>.</summary>
        public static bool Verify(string rawBody, string? signature, string? timestamp, string publicKeyHex, DateTimeOffset now) =>
            Verify(Encoding.UTF8.GetBytes(rawBody ?? ""), signature, timestamp, publicKeyHex, now);

        /// <summary>As <see cref="Verify(byte[], string, string, string)"/>, checking the age against <paramref name="now"/>.</summary>
        public static bool Verify(byte[] rawBody, string? signature, string? timestamp, string publicKeyHex, DateTimeOffset now)
        {
            if (rawBody == null || string.IsNullOrEmpty(signature) || string.IsNullOrEmpty(timestamp)) return false;
            if (!double.TryParse(timestamp, NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds)) return false;
            if (double.IsNaN(seconds) || Math.Abs(now.ToUnixTimeMilliseconds() / 1000.0 - seconds) > MaxAge.TotalSeconds) return false;
            var key = FromHex(publicKeyHex);
            var sig = FromHex(signature!);
            if (key == null || sig == null) return false;
            var prefix = Encoding.UTF8.GetBytes(timestamp);
            var message = new byte[prefix.Length + rawBody.Length];
            Buffer.BlockCopy(prefix, 0, message, 0, prefix.Length);
            Buffer.BlockCopy(rawBody, 0, message, prefix.Length, rawBody.Length);
            return Ed25519.Verify(key, message, sig);
        }

        /// <summary>Reads an interaction from a request body.</summary>
        public static InteractionPayload Parse(string rawBody) =>
            JsonSerializer.Deserialize<InteractionPayload>(rawBody, JsonDefaults.Options) ?? throw new FormatException("Empty interaction");

        /// <summary>The JSON response body that answers right away (type 4).</summary>
        public static string RespondWith(Reply reply) =>
            JsonSerializer.Serialize(new CallbackBody(4, reply), JsonDefaults.Options);

        /// <summary>The JSON response body that defers (type 5): follow up within 15 minutes.</summary>
        public static string DeferWith(bool ephemeral = false) =>
            JsonSerializer.Serialize(new CallbackBody(5, new DeferData { Ephemeral = ephemeral }), JsonDefaults.Options);

        internal sealed class CallbackBody
        {
            public CallbackBody(int type, object data)
            {
                Type = type;
                Data = data;
            }

            public int Type { get; }
            public object Data { get; }
        }

        internal sealed class DeferData
        {
            public bool Ephemeral { get; set; }
        }

        private static byte[]? FromHex(string? hex)
        {
            if (hex == null || hex.Length % 2 != 0) return null;
            var bytes = new byte[hex.Length / 2];
            for (var i = 0; i < bytes.Length; i++)
            {
                var hi = Nibble(hex[2 * i]);
                var lo = Nibble(hex[2 * i + 1]);
                if (hi < 0 || lo < 0) return null;
                bytes[i] = (byte)((hi << 4) | lo);
            }
            return bytes;
        }

        private static int Nibble(char c)
        {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            return -1;
        }
    }
}
