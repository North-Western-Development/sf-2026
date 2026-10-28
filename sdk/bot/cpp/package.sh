#!/bin/sh
# Writes the source release dist/subspace-bot-cpp-<version>.tar.gz and prints its SHA-256.
set -eu
cd "$(dirname "$0")"
version=$(sed -n 's/^project(subspace_bot VERSION \([0-9.]*\).*/\1/p' CMakeLists.txt)
name="subspace-bot-cpp-$version"
mkdir -p dist
tar -czf "dist/$name.tar.gz" --transform "s,^,$name/," \
  CMakeLists.txt README.md vcpkg.json vcpkg-configuration.json cmake include src example tests
if command -v sha256sum >/dev/null 2>&1; then sha256sum "dist/$name.tar.gz"; else shasum -a 256 "dist/$name.tar.gz"; fi
