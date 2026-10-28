#nullable enable
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Subspace.Bot
{
    /// <summary>A rich embed: up to 10 per message, 6000 characters of text in all.</summary>
    public sealed class Embed
    {
        /// <summary>Up to 256 characters; links to <see cref="Url"/>.</summary>
        public string? Title { get; set; }
        /// <summary>Up to 4096 characters of Markdown.</summary>
        public string? Description { get; set; }
        /// <summary>Where the title links.</summary>
        public string? Url { get; set; }
        /// <summary>The bar on the left: an integer such as <c>0x3353D6</c>, or a <c>"#RRGGBB"</c> string.</summary>
        public object? Color { get; set; }
        /// <summary>An ISO 8601 time shown in the footer.</summary>
        public string? Timestamp { get; set; }
        /// <summary>Shown above the title.</summary>
        public EmbedAuthor? Author { get; set; }
        /// <summary>Small text at the bottom.</summary>
        public EmbedFooter? Footer { get; set; }
        /// <summary>A large image.</summary>
        public EmbedMedia? Image { get; set; }
        /// <summary>A small image at the top right.</summary>
        public EmbedMedia? Thumbnail { get; set; }
        /// <summary>Up to 25 fields; inline ones sit three to a row.</summary>
        public List<EmbedField>? Fields { get; set; }
    }

    /// <summary>An embed's author line.</summary>
    public sealed class EmbedAuthor
    {
        /// <summary>The author's name.</summary>
        public string Name { get; set; } = "";
        /// <summary>Where the name links.</summary>
        public string? Url { get; set; }
    }

    /// <summary>An embed's footer.</summary>
    public sealed class EmbedFooter
    {
        /// <summary>The footer text.</summary>
        public string Text { get; set; } = "";
    }

    /// <summary>An embed image or thumbnail.</summary>
    public sealed class EmbedMedia
    {
        /// <summary>The image URL; viewers load it through the instance's media proxy.</summary>
        public string Url { get; set; } = "";
    }

    /// <summary>One name/value field of an embed.</summary>
    public sealed class EmbedField
    {
        /// <summary>The field's heading.</summary>
        public string Name { get; set; } = "";
        /// <summary>The field's text.</summary>
        public string Value { get; set; } = "";
        /// <summary>Sit next to other inline fields.</summary>
        public bool? Inline { get; set; }
    }

    /// <summary>The kind of value a slash command option takes.</summary>
    public enum CommandOptionType
    {
        /// <summary>Text.</summary>
        String,
        /// <summary>A whole number.</summary>
        Integer,
        /// <summary>Any number.</summary>
        Number,
        /// <summary>True or false.</summary>
        Boolean,
        /// <summary>A member (its id).</summary>
        User,
        /// <summary>A relay (its id).</summary>
        Relay,
        /// <summary>A clearance (its id).</summary>
        Clearance,
    }

    /// <summary>One of the fixed values an option offers.</summary>
    public sealed class CommandChoice
    {
        /// <summary>Creates an empty choice.</summary>
        public CommandChoice() { }

        /// <summary>Creates a choice.</summary>
        public CommandChoice(string name, object value)
        {
            Name = name;
            Value = value;
        }

        /// <summary>What members see.</summary>
        public string Name { get; set; } = "";
        /// <summary>What the bot receives: a string or a number.</summary>
        public object Value { get; set; } = "";
    }

    /// <summary>An option of a slash command.</summary>
    public sealed class CommandOption
    {
        /// <summary>The kind of value.</summary>
        public CommandOptionType Type { get; set; }
        /// <summary>Lowercase letters, digits, <c>-</c> and <c>_</c>.</summary>
        public string Name { get; set; } = "";
        /// <summary>Shown in the command picker.</summary>
        public string Description { get; set; } = "";
        /// <summary>Whether members must give it.</summary>
        public bool? Required { get; set; }
        /// <summary>Fixed values to pick from.</summary>
        public List<CommandChoice>? Choices { get; set; }
    }

    /// <summary>A slash command to register.</summary>
    public class CommandDefinition
    {
        /// <summary>Lowercase letters, digits, <c>-</c> and <c>_</c>, up to 32 characters.</summary>
        public string Name { get; set; } = "";
        /// <summary>Shown in the command picker.</summary>
        public string Description { get; set; } = "";
        /// <summary>The command's options.</summary>
        public List<CommandOption>? Options { get; set; }
        /// <summary>A permission bitfield (decimal string) members need to see and use it.</summary>
        public string? DefaultMemberPermissions { get; set; }
    }

    /// <summary>A command as the server stored it.</summary>
    public sealed class RegisteredCommand : CommandDefinition
    {
        /// <summary>Stays the same as long as the name does.</summary>
        public string Id { get; set; } = "";
    }

    /// <summary>An answer to an interaction.</summary>
    public sealed class Reply
    {
        /// <summary>The text, up to 2000 characters.</summary>
        public string? Content { get; set; }
        /// <summary>Up to 10 embeds.</summary>
        public List<Embed>? Embeds { get; set; }
        /// <summary>Only the person who used the command sees it (never stored).</summary>
        public bool? Ephemeral { get; set; }

        /// <summary>A plain text reply.</summary>
        public static implicit operator Reply(string content) => new Reply { Content = content };
    }

    /// <summary>A message to post.</summary>
    public sealed class NewMessage
    {
        /// <summary>The text, up to 2000 characters.</summary>
        public string? Content { get; set; }
        /// <summary>The transmission this one replies to.</summary>
        public string? ReplyToId { get; set; }

        /// <summary>A plain text message.</summary>
        public static implicit operator NewMessage(string content) => new NewMessage { Content = content };
    }

    /// <summary>Who wrote a message.</summary>
    public sealed class MessageAuthor
    {
        /// <summary>The transmitter's id.</summary>
        public string Id { get; set; } = "";
        /// <summary>Their username.</summary>
        public string Username { get; set; } = "";
        /// <summary>Their display name, if they set one.</summary>
        public string? DisplayName { get; set; }
        /// <summary>"bot" for bots, "webhook" for webhooks, otherwise null.</summary>
        public string? BotKind { get; set; }
    }

    /// <summary>A message (a transmission).</summary>
    public sealed class Message
    {
        /// <summary>The transmission's id.</summary>
        public string Id { get; set; } = "";
        /// <summary>"relay", "thread", "link" or "mesh".</summary>
        public string ChannelType { get; set; } = "";
        /// <summary>The channel's id.</summary>
        public string ChannelId { get; set; } = "";
        /// <summary>Who wrote it.</summary>
        public MessageAuthor Author { get; set; } = new MessageAuthor();
        /// <summary>The text. Empty when the bot lacks the Message Content intent and was not mentioned.</summary>
        public string Content { get; set; } = "";
        /// <summary>Ids of the people it mentions.</summary>
        public List<string> Mentions { get; set; } = new List<string>();
        /// <summary>The message's embeds, as sent by the server.</summary>
        public JsonElement Embeds { get; set; }
        /// <summary>When it was sent (ISO 8601).</summary>
        public string? CreatedAt { get; set; }
        /// <summary>The whole transmission as the server sent it, for fields not modelled here.</summary>
        [JsonIgnore]
        public JsonElement Raw { get; set; }
    }

    /// <summary>The bot account.</summary>
    public sealed class BotUser
    {
        /// <summary>The bot's transmitter id.</summary>
        public string Id { get; set; } = "";
        /// <summary>The bot's username.</summary>
        public string Username { get; set; } = "";
        /// <summary>The application it belongs to.</summary>
        public string AppId { get; set; } = "";
        /// <summary>Beacons it has been added to.</summary>
        public List<string> BeaconIds { get; set; } = new List<string>();
    }

    /// <summary>Who used a command.</summary>
    public sealed class InteractionUser
    {
        /// <summary>Their transmitter id.</summary>
        public string Id { get; set; } = "";
        /// <summary>Their username.</summary>
        public string Username { get; set; } = "";
        /// <summary>Their display name, if any.</summary>
        public string? DisplayName { get; set; }
        /// <summary>Their avatar, if any.</summary>
        public string? AvatarUrl { get; set; }
    }

    /// <summary>Where a command was used.</summary>
    public sealed class InteractionChannel
    {
        /// <summary>"relay" or "thread".</summary>
        public string Type { get; set; } = "";
        /// <summary>The channel's id.</summary>
        public string Id { get; set; } = "";
    }

    /// <summary>An option value someone gave.</summary>
    public sealed class InteractionOption
    {
        /// <summary>The option's name.</summary>
        public string Name { get; set; } = "";
        /// <summary>The option's type ("string", "integer", ...).</summary>
        public string Type { get; set; } = "";
        /// <summary>The value.</summary>
        public JsonElement Value { get; set; }
    }

    /// <summary>The command part of an interaction.</summary>
    public sealed class InteractionData
    {
        /// <summary>The command's id.</summary>
        public string Id { get; set; } = "";
        /// <summary>The command's name.</summary>
        public string Name { get; set; } = "";
        /// <summary>The options given.</summary>
        public List<InteractionOption> Options { get; set; } = new List<InteractionOption>();
    }

    /// <summary>An interaction as the server sends it (gateway INTERACTION_CREATE, or an HTTP POST body).</summary>
    public sealed class InteractionPayload
    {
        /// <summary>2: a slash command.</summary>
        [JsonConverter(typeof(InteractionTypeConverter))]
        public int Type { get; set; } = 2;
        /// <summary>The interaction's id.</summary>
        public string Id { get; set; } = "";
        /// <summary>The credential for answering it.</summary>
        public string Token { get; set; } = "";
        /// <summary>The application the command belongs to.</summary>
        public string ApplicationId { get; set; } = "";
        /// <summary>The beacon it was used in.</summary>
        public string BeaconId { get; set; } = "";
        /// <summary>Where it was used.</summary>
        public InteractionChannel Channel { get; set; } = new InteractionChannel();
        /// <summary>Who used it.</summary>
        public InteractionUser User { get; set; } = new InteractionUser();
        /// <summary>Their permissions in that channel (decimal bitfield).</summary>
        public string MemberPermissions { get; set; } = "0";
        /// <summary>The command and its options.</summary>
        public InteractionData Data { get; set; } = new InteractionData();
    }

    /// <summary>
    /// Reads an interaction's <c>type</c>: a number over HTTP, but over the gateway the event pipeline
    /// currently overwrites it with the event name ("INTERACTION_CREATE"), which means a slash command (2).
    /// </summary>
    internal sealed class InteractionTypeConverter : JsonConverter<int>
    {
        public override int Read(ref Utf8JsonReader reader, System.Type typeToConvert, JsonSerializerOptions options)
        {
            if (reader.TokenType == JsonTokenType.Number && reader.TryGetInt32(out var value)) return value;
            if (reader.TokenType == JsonTokenType.StartObject || reader.TokenType == JsonTokenType.StartArray) reader.Skip();
            return 2;
        }

        public override void Write(Utf8JsonWriter writer, int value, JsonSerializerOptions options) => writer.WriteNumberValue(value);
    }

    /// <summary>Why the gateway connection closed.</summary>
    public sealed class GatewayClose
    {
        /// <summary>Creates a close description.</summary>
        public GatewayClose(int code, string reason)
        {
            Code = code;
            Reason = reason;
        }

        /// <summary>The WebSocket close code (1006 when the connection dropped without one; 4003 for a bad token).</summary>
        public int Code { get; }
        /// <summary>The close reason, if any.</summary>
        public string Reason { get; }
    }
}
