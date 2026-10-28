#nullable enable
using System;
using System.Collections.Generic;

namespace Subspace.RichPresence
{
    /// <summary>Settings for <see cref="RichPresence"/>.</summary>
    public sealed class RichPresenceOptions
    {
        /// <summary>Your Subspace application id (User Settings > Developer Applications). Required.</summary>
        public string ClientId { get; set; } = "";

        /// <summary>
        /// Keep trying to (re)connect while the desktop app is closed, then send the activity again.
        /// Default true.
        /// </summary>
        public bool Reconnect { get; set; } = true;

        /// <summary>
        /// Ports to try. All are tried at once; the first in this order that says READY is used.
        /// Default <see cref="RichPresence.DefaultPorts"/> (6473-6482).
        /// </summary>
        public IList<int>? Ports { get; set; }

        /// <summary>Host of the desktop app's RPC server: "127.0.0.1" (default) or "localhost". Always this computer.</summary>
        public string? Host { get; set; }

        /// <summary>How long to wait between attempts while disconnected. Default 15 seconds.</summary>
        public TimeSpan ReconnectDelay { get; set; } = TimeSpan.FromSeconds(15);

        /// <summary>How long the ports get to say READY; one that has not by then is not the desktop app. Default 3 seconds.</summary>
        public TimeSpan ReadyTimeout { get; set; } = TimeSpan.FromSeconds(3);

        /// <summary>How long to wait for the desktop app to answer a command. Default 10 seconds.</summary>
        public TimeSpan ReplyTimeout { get; set; } = TimeSpan.FromSeconds(10);
    }
}
