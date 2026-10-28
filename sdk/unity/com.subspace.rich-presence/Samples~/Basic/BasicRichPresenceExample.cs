using Subspace.RichPresence;
using UnityEngine;

/// <summary>
/// Put this next to a SubspaceRichPresence component (Add Component > Subspace > Subspace Rich
/// Presence) and set its Application ID. Start the Subspace desktop app, enter Play mode, and the
/// activity shows on your Subspace profile.
/// </summary>
public class BasicRichPresenceExample : MonoBehaviour
{
    [SerializeField] private SubspaceRichPresence presence;

    private void Start()
    {
        if (presence == null) presence = SubspaceRichPresence.Instance;
        if (presence == null)
        {
            Debug.LogWarning("Add a SubspaceRichPresence component to the scene.");
            return;
        }
        presence.onReady.AddListener(() => Debug.Log("Connected to the Subspace desktop app"));
        presence.onDisconnected.AddListener(() => Debug.Log("The Subspace desktop app went away"));

        // Fine to call before the desktop app is found: it is sent once connected.
        presence.SetActivity(new Activity
        {
            Details = "Main menu",
            StartedAt = Activity.Now(),
        });
    }

    /// <summary>Call this from your game when a match starts.</summary>
    public void OnMatchStarted(string map, int partySize, int partyMax)
    {
        presence.SetActivity(new Activity
        {
            Type = ActivityType.Competing,
            Details = "Competitive - " + map,
            State = "In a match",
            StartedAt = Activity.Now(),
            Party = new Party(partySize, partyMax),
            Buttons = new[] { new Button("Watch", "https://example.com/match/123") },
        }, error =>
        {
            if (error != null) Debug.LogWarning("Rich Presence refused: " + error.Message);
        });
    }

    /// <summary>Call this when the player leaves to the menu.</summary>
    public void OnMatchEnded()
    {
        presence.SetActivity("Main menu", null);
    }
}
