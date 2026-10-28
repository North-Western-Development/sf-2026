#nullable enable
using System;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Subspace.Bot
{
    /// <summary>
    /// A slash command someone used: read its options, then answer within 3 seconds (or defer and
    /// follow up within 15 minutes). The answering calls use the interaction's own token, not the bot token.
    /// </summary>
    public sealed class Interaction
    {
        private static readonly HttpMethod Patch = new HttpMethod("PATCH");
        private readonly SubspaceBot _bot;

        /// <summary>Wraps a payload: from the gateway, or from an HTTP request body (see <see cref="Interactions.Parse"/>).</summary>
        public Interaction(SubspaceBot bot, InteractionPayload payload)
        {
            _bot = bot ?? throw new ArgumentNullException(nameof(bot));
            Payload = payload ?? throw new ArgumentNullException(nameof(payload));
        }

        /// <summary>The interaction as the server sent it.</summary>
        public InteractionPayload Payload { get; }

        /// <summary>The interaction's id.</summary>
        public string Id => Payload.Id;

        /// <summary>The command's name.</summary>
        public string CommandName => Payload.Data.Name;

        /// <summary>Who used it.</summary>
        public InteractionUser User => Payload.User;

        /// <summary>Where it was used.</summary>
        public InteractionChannel Channel => Payload.Channel;

        /// <summary>The beacon it was used in.</summary>
        public string BeaconId => Payload.BeaconId;

        /// <summary>An option's value, or null when it was not given.</summary>
        public JsonElement? Option(string name)
        {
            foreach (var option in Payload.Data.Options)
            {
                if (option.Name == name) return option.Value;
            }
            return null;
        }

        /// <summary>An option's value converted to <typeparamref name="T"/>, or <paramref name="fallback"/> when it was not given.</summary>
        public T GetOption<T>(string name, T fallback)
        {
            var value = Option(name);
            if (value == null || value.Value.ValueKind == JsonValueKind.Null || value.Value.ValueKind == JsonValueKind.Undefined) return fallback;
            var converted = JsonSerializer.Deserialize<T>(value.Value.GetRawText(), JsonDefaults.Options);
            return converted == null ? fallback : converted;
        }

        /// <summary>Whether the option was given; if so, its value converted to <typeparamref name="T"/>.</summary>
        public bool TryGetOption<T>(string name, out T value)
        {
            var raw = Option(name);
            if (raw == null || raw.Value.ValueKind == JsonValueKind.Null || raw.Value.ValueKind == JsonValueKind.Undefined)
            {
                value = default!;
                return false;
            }
            value = JsonSerializer.Deserialize<T>(raw.Value.GetRawText(), JsonDefaults.Options)!;
            return true;
        }

        private string Path(string suffix) => $"/interactions/{Payload.Id}/{Payload.Token}/{suffix}";

        /// <summary>Answer now. A string is a plain text reply.</summary>
        public Task ReplyAsync(Reply reply, CancellationToken cancellationToken = default) =>
            _bot.RestAsync(HttpMethod.Post, Path("callback"), new Interactions.CallbackBody(4, reply), asBot: false, cancellationToken);

        /// <summary>"Thinking…": send the answer later with <see cref="FollowUpAsync"/> (within 15 minutes).</summary>
        public Task DeferAsync(bool ephemeral = false, CancellationToken cancellationToken = default) =>
            _bot.RestAsync(HttpMethod.Post, Path("callback"), new Interactions.CallbackBody(5, new Interactions.DeferData { Ephemeral = ephemeral }), asBot: false, cancellationToken);

        /// <summary>Send the answer after deferring, or another message after replying.</summary>
        public Task FollowUpAsync(Reply reply, CancellationToken cancellationToken = default) =>
            _bot.RestAsync(HttpMethod.Post, Path("followup"), reply, asBot: false, cancellationToken);

        /// <summary>Change the first answer.</summary>
        public Task EditReplyAsync(Reply reply, CancellationToken cancellationToken = default) =>
            _bot.RestAsync(Patch, Path("original"), reply, asBot: false, cancellationToken);
    }
}
