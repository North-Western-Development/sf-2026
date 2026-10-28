#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "SubspaceRichPresenceTypes.h"
#include "SubspaceRichPresenceLibrary.generated.h"

UCLASS()
class SUBSPACERICHPRESENCE_API USubspaceRichPresenceLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** Milliseconds since the unix epoch (UTC), for an activity's Started At / Ends At. */
	UFUNCTION(BlueprintPure, Category = "Subspace|Rich Presence")
	static int64 GetUnixTimeMs();

	/** A copy of the activity with Started At set to now. */
	UFUNCTION(BlueprintPure, Category = "Subspace|Rich Presence")
	static FSubspaceActivity StartNow(const FSubspaceActivity& Activity);
};
