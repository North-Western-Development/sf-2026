#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "SubspaceRichPresenceTypes.h"
#include "SubspaceRichPresenceSubsystem.generated.h"

struct FSubspaceRichPresenceClient;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FSubspaceConnectionChanged, bool, bConnected);

/**
 * Rich Presence through the Subspace desktop app. Starts on its own when an Application ID is set
 * in Project Settings > Plugins > Subspace Rich Presence. Nothing here blocks the game thread: a
 * background thread owns the connection.
 */
UCLASS()
class SUBSPACERICHPRESENCE_API USubspaceRichPresenceSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/** Shows or updates the activity. Sent once connected, and again after the desktop app restarts. */
	UFUNCTION(BlueprintCallable, Category = "Subspace|Rich Presence")
	void SetActivity(const FSubspaceActivity& Activity);

	/** Removes the activity. */
	UFUNCTION(BlueprintCallable, Category = "Subspace|Rich Presence")
	void ClearActivity();

	/** Whether the Subspace desktop app is connected right now. */
	UFUNCTION(BlueprintPure, Category = "Subspace|Rich Presence")
	bool IsConnected() const;

	/** (Re)starts with this Application ID instead of the one in Project Settings. False if it is not a valid id. */
	UFUNCTION(BlueprintCallable, Category = "Subspace|Rich Presence")
	bool StartWithApplicationId(const FString& ApplicationId);

	/** Disconnects; the activity ends with the connection. */
	UFUNCTION(BlueprintCallable, Category = "Subspace|Rich Presence")
	void Stop();

	/** Fired on the game thread when the desktop app connects (true) or goes away (false). */
	UPROPERTY(BlueprintAssignable, Category = "Subspace|Rich Presence")
	FSubspaceConnectionChanged OnConnectionChanged;

private:
	/** Owns the SDK client. Not a UObject; deleted in Stop and Deinitialize. */
	FSubspaceRichPresenceClient* Client = nullptr;

	/** The latest activity, so a restarted client shows it again. */
	TOptional<FSubspaceActivity> CurrentActivity;
};
