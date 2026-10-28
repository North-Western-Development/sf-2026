#nullable enable
using System;
using System.Collections.Generic;

namespace Subspace.RichPresence
{
    /// <summary>The word shown before your application's name ("Playing", "Watching", ...).</summary>
    public enum ActivityType
    {
        /// <summary>"Playing" (the default when <see cref="Activity.Type"/> is not set).</summary>
        Playing,
        /// <summary>"Streaming".</summary>
        Streaming,
        /// <summary>"Listening to".</summary>
        Listening,
        /// <summary>"Watching".</summary>
        Watching,
        /// <summary>"Competing in".</summary>
        Competing,
    }

    /// <summary>The player's party: shown as "(2 of 5)" after the state.</summary>
    public sealed class Party
    {
        /// <summary>Creates an empty party; set <see cref="Size"/> and <see cref="Max"/>.</summary>
        public Party() { }

        /// <summary>Creates a party of <paramref name="size"/> out of <paramref name="max"/>.</summary>
        public Party(int size, int max)
        {
            Size = size;
            Max = max;
        }

        /// <summary>People in the party now.</summary>
        public int Size { get; set; }

        /// <summary>How many fit in the party.</summary>
        public int Max { get; set; }
    }

    /// <summary>A link button under the activity.</summary>
    public sealed class Button
    {
        /// <summary>Creates an empty button; set <see cref="Label"/> and <see cref="Url"/>.</summary>
        public Button() { }

        /// <summary>Creates a button.</summary>
        public Button(string label, string url)
        {
            Label = label;
            Url = url;
        }

        /// <summary>Up to 32 characters.</summary>
        public string Label { get; set; } = "";

        /// <summary>An https:// link.</summary>
        public string Url { get; set; } = "";
    }

    /// <summary>
    /// What the player is doing. Every field is optional: leave it null and it is not sent.
    /// Anything the desktop app considers invalid is dropped rather than refused (an http:// image
    /// is not shown, a third button is left out).
    /// </summary>
    public sealed class Activity
    {
        /// <summary>Defaults to <see cref="ActivityType.Playing"/>.</summary>
        public ActivityType? Type { get; set; }

        /// <summary>First line under your application's name (up to 128 characters).</summary>
        public string? Details { get; set; }

        /// <summary>Second line (up to 128 characters).</summary>
        public string? State { get; set; }

        /// <summary>Unix time in milliseconds: shows "for 12m". See <see cref="UnixMs(DateTimeOffset)"/>.</summary>
        public long? StartedAt { get; set; }

        /// <summary>Unix time in milliseconds: shows a countdown instead ("3:12 left").</summary>
        public long? EndsAt { get; set; }

        /// <summary>An https:// image URL. Without a large image your application's icon is shown.</summary>
        public string? LargeImage { get; set; }

        /// <summary>Hover text for the large image.</summary>
        public string? LargeText { get; set; }

        /// <summary>An https:// image URL, shown on the corner of the large image.</summary>
        public string? SmallImage { get; set; }

        /// <summary>Hover text for the small image.</summary>
        public string? SmallText { get; set; }

        /// <summary>Shown after the state: "(2 of 4)".</summary>
        public Party? Party { get; set; }

        /// <summary>Up to two link buttons.</summary>
        public IList<Button>? Buttons { get; set; }

        /// <summary>Unix time in milliseconds, for <see cref="StartedAt"/> and <see cref="EndsAt"/>.</summary>
        public static long UnixMs(DateTimeOffset time) => time.ToUnixTimeMilliseconds();

        /// <summary>The current time in Unix milliseconds.</summary>
        public static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }
}
