import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** The Unity package and the Unreal plugin carry copies of the C# and C++ SDKs; they must not drift. */
const PAIRS: Array<[string, string]> = [
  ...['Activity.cs', 'Json.cs', 'RichPresence.cs', 'RichPresenceOptions.cs'].map((f): [string, string] => [
    `sdk/csharp/src/Subspace.RichPresence/${f}`,
    `sdk/unity/com.subspace.rich-presence/Runtime/Sdk/${f}`,
  ]),
  ['sdk/cpp/src/rich_presence.cpp', 'sdk/unreal/SubspaceRichPresence/Source/SubspaceRichPresence/Private/ThirdParty/rich_presence.cpp'],
  ['sdk/cpp/include/subspace/rich_presence.h', 'sdk/unreal/SubspaceRichPresence/Source/SubspaceRichPresence/Private/ThirdParty/subspace/rich_presence.h'],
];

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('SDK copies in the engine packages', () => {
  it.each(PAIRS)('%s matches its copy', (source, copy) => {
    expect(read(copy)).toBe(read(source));
  });
});
