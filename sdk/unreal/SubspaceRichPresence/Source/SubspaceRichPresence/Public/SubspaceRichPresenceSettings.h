#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "SubspaceRichPresenceSettings.generated.h"

/** Project Settings > Plugins > Subspace Rich Presence. Saved to DefaultGame.ini. */
UCLASS(Config = Game, DefaultConfig, meta = (DisplayName = "Subspace Rich Presence"))
class SUBSPACERICHPRESENCE_API USubspaceRichPresenceSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	USubspaceRichPresenceSettings();

	/** Your application id from Subspace: User Settings > Developer Applications (digits only). */
	UPROPERTY(Config, EditAnywhere, Category = "Rich Presence", meta = (DisplayName = "Application ID"))
	FString ApplicationId;

	/** Connect to the Subspace desktop app when the game instance starts. */
	UPROPERTY(Config, EditAnywhere, Category = "Rich Presence", meta = (DisplayName = "Enabled"))
	bool bEnabled = true;

	/** Keep looking for the desktop app (every 15 seconds) while it is closed, and send the activity again when it comes back. */
	UPROPERTY(Config, EditAnywhere, Category = "Rich Presence", AdvancedDisplay)
	bool bReconnect = true;
};
