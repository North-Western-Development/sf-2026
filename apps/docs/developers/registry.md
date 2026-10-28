# Package registry

Every SDK is published to the instance's own package registry:

**https://subspace.click/packages/**

That page lists each package with its versions and install line. Under it, one URL per ecosystem:

| Ecosystem | URL | Packages |
| --- | --- | --- |
| npm (npm, pnpm, Yarn, Bun, Deno) | `https://subspace.click/packages/npm/` | `@subspace/bot-sdk`, `@subspace/rich-presence` |
| Unity (scoped registry) | `https://subspace.click/packages/npm/` | `com.subspace.rich-presence` |
| Python (PEP 503) | `https://subspace.click/packages/pypi/simple/` | `subspace-bot` |
| Maven and Gradle | `https://subspace.click/packages/maven/` | `click.subspace:subspace-bot` |
| NuGet v3 | `https://subspace.click/packages/nuget/index.json` | `Subspace.Bot`, `Subspace.RichPresence` |
| Files (C++, Unreal Engine) | `https://subspace.click/packages/files/` | `subspace-bot-cpp-<version>.tar.gz`, `subspace-rich-presence-cpp-<version>.tar.gz`, `SubspaceRichPresence-unreal-<version>.zip` |

The registry only serves packages from this repository, under their own names, so it sits **next to** your usual registries rather than replacing them: dependencies such as `ws`, `aiohttp` or `System.Text.Json` still come from npm, PyPI and nuget.org. Publishing only adds files, so a version you pin stays installable.

## npm, pnpm and Yarn

Point the `@subspace` scope at the registry, then install as usual:

```bash
npm config set @subspace:registry https://subspace.click/packages/npm/
npm install @subspace/bot-sdk
```

Or, per project, in an `.npmrc` next to `package.json` (npm, pnpm, Yarn 1 and Bun read it):

```ini
@subspace:registry=https://subspace.click/packages/npm/
```

Yarn 2 and later use `.yarnrc.yml` instead:

```yaml
npmScopes:
  subspace:
    npmRegistryServer: "https://subspace.click/packages/npm/"
```

## Deno

Deno reads the same `.npmrc` line, but **only in a project with a `deno.json`**, and only from the folder that holds it:

```
my-bot/
  deno.json
  .npmrc        @subspace:registry=https://subspace.click/packages/npm/
  main.ts       import { SubspaceBot } from 'npm:@subspace/bot-sdk';
```

See [Deno](/developers/sdk/deno).

## Unity

Add the registry as a scoped registry for `com.subspace` in your project's `Packages/manifest.json`, and the package to its dependencies:

```json
{
  "scopedRegistries": [
    { "name": "Subspace", "url": "https://subspace.click/packages/npm/", "scopes": ["com.subspace"] }
  ],
  "dependencies": {
    "com.subspace.rich-presence": "0.1.0"
  }
}
```

Unity fetches it from the registry when the project opens; change the version there to update. See [Unity](/developers/rich-presence/unity).

## Python

Use `--extra-index-url`, not `--index-url`: `subspace-bot`'s dependencies (`aiohttp`, `cryptography`) come from PyPI.

```bash
pip install --extra-index-url https://subspace.click/packages/pypi/simple/ subspace-bot
```

In a `requirements.txt`:

```
--extra-index-url https://subspace.click/packages/pypi/simple/
subspace-bot==0.1.0
```

## Maven and Gradle

Maven, in `pom.xml`:

```xml
<repositories>
  <repository>
    <id>subspace</id>
    <url>https://subspace.click/packages/maven/</url>
  </repository>
</repositories>

<dependencies>
  <dependency>
    <groupId>click.subspace</groupId>
    <artifactId>subspace-bot</artifactId>
    <version>0.1.0</version>
  </dependency>
</dependencies>
```

Gradle (Kotlin DSL):

```kotlin
repositories {
    mavenCentral()
    maven { url = uri("https://subspace.click/packages/maven/") }
}

dependencies {
    implementation("click.subspace:subspace-bot:0.1.0")
}
```

Every file has `.sha1`, `.md5` and `.sha256` checksums, and each artifact a `maven-metadata.xml`.

## NuGet (.NET)

```bash
dotnet nuget add source https://subspace.click/packages/nuget/index.json --name subspace
dotnet add package Subspace.Bot
```

Or in a `nuget.config` next to your solution:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
    <add key="subspace" value="https://subspace.click/packages/nuget/index.json" />
  </packageSources>
</configuration>
```

Visual Studio and Rider take the same URL as a package source.

## C++ and Unreal Engine

These are source archives. Each has a `.sha256` file next to it (`https://subspace.click/packages/files/<archive>.sha256`), and the registry page shows the hash.

With CMake's `FetchContent`, pin the archive by its hash:

```cmake
include(FetchContent)
FetchContent_Declare(
  subspace_bot
  URL      https://subspace.click/packages/files/subspace-bot-cpp-0.1.0.tar.gz
  URL_HASH SHA256=<the sha256 from the .sha256 file>
)
FetchContent_MakeAvailable(subspace_bot)

target_link_libraries(my_bot PRIVATE subspace::bot)
```

The bot SDK needs libcurl (with WebSocket support) and OpenSSL installed where CMake can find them; see [C++ bots](/developers/sdk/cpp#install). The Rich Presence SDK has no dependencies, and is the same with `subspace-rich-presence-cpp-<version>.tar.gz` and the target `subspace::rich_presence`. The Unreal plugin is a zip: unzip it into your project's `Plugins` folder. See [C++ bots](/developers/sdk/cpp), [C++ Rich Presence](/developers/rich-presence/cpp) and [Unreal Engine](/developers/rich-presence/unreal).

## Publishing (instance operators)

`deploy/server/publish-packages.sh` collects the SDKs from the repository (`scripts/registry/collect.mjs`), uploads them to `/var/www/packages` on the server, and rewrites the indexes (`deploy/server/registry-index.mjs`). nginx serves `/packages/` as plain files. Build the Python wheel (`sdk/bot/python/dist`) and the Java jar (`sdk/bot/java/target`) first; the collector skips them otherwise.
