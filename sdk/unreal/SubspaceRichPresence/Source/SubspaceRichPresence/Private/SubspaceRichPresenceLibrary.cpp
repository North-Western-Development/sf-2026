#include "SubspaceRichPresenceLibrary.h"

#include "subspace/rich_presence.h"

FSubspaceActivity& FSubspaceActivity::StartNow()
{
	StartedAt = static_cast<int64>(subspace::UnixTimeMs());
	return *this;
}

int64 USubspaceRichPresenceLibrary::GetUnixTimeMs()
{
	return static_cast<int64>(subspace::UnixTimeMs());
}

FSubspaceActivity USubspaceRichPresenceLibrary::StartNow(const FSubspaceActivity& Activity)
{
	FSubspaceActivity Result = Activity;
	Result.StartNow();
	return Result;
}
