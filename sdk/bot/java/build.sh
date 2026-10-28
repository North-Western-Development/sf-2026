#!/usr/bin/env bash
# Build and test the Java SDK with only a JDK (no Maven/Gradle needed):
#   compile (--release 17) -> run tests -> jar, sources jar, javadoc jar, pom
#   -> a static Maven repository layout in target/repo (with .sha1/.md5 checksums).
#
#   JAVA_HOME=/path/to/jdk ./build.sh            # JAVA_HOME optional if javac is on PATH
#   SKIP_TESTS=1 ./build.sh
set -euo pipefail

cd "$(dirname "$0")"
GROUP_PATH=click/subspace
ARTIFACT=subspace-bot
VERSION=$(sed -n 's:.*<version>\(.*\)</version>.*:\1:p' pom.xml | head -1)

if [[ -n "${JAVA_HOME:-}" ]]; then BIN="$JAVA_HOME/bin/"; else BIN=""; fi
JAVAC="${BIN}javac"; JAVA="${BIN}java"; JAR="${BIN}jar"; JAVADOC="${BIN}javadoc"

rm -rf target
mkdir -p target/classes target/test-classes

echo "== compile (release 17)"
find src/main/java -name '*.java' > target/main-sources.txt
"$JAVAC" --release 17 -encoding UTF-8 -Xlint:all,-serial -Werror -d target/classes @target/main-sources.txt

if [[ -z "${SKIP_TESTS:-}" ]]; then
  echo "== test"
  find src/test/java -name '*.java' > target/test-sources.txt
  "$JAVAC" --release 17 -encoding UTF-8 -cp target/classes -d target/test-classes @target/test-sources.txt
  SEP=":"
  if [[ "${OS:-}" == Windows_NT ]]; then
    SEP=";"
    # On Windows the JDK's NIO selector uses an AF_UNIX socket in %TEMP%; that fails ("Unable to
    # establish loopback connection") when %TEMP% is an 8.3 short path or contains spaces.
    # Point it at a plain directory unless the caller chose one.
    if [[ -z "${JAVA_TEST_OPTS:-}" ]]; then
      UDTMP="${PUBLIC:-C:\Users\Public}\subspace-bot-jtmp"
      mkdir -p "$UDTMP" 2>/dev/null || true
      JAVA_TEST_OPTS="-Djdk.net.unixdomain.tmpdir=$UDTMP"
    fi
  fi
  # shellcheck disable=SC2086
  "$JAVA" ${JAVA_TEST_OPTS:-} -cp "target/classes${SEP}target/test-classes" click.subspace.bot.SdkTests
fi

echo "== package $ARTIFACT-$VERSION"
"$JAR" --create --file "target/$ARTIFACT-$VERSION.jar" -C target/classes .
"$JAR" --create --file "target/$ARTIFACT-$VERSION-sources.jar" -C src/main/java .
mkdir -p target/apidocs
"$JAVADOC" --release 17 -encoding UTF-8 -quiet -Xdoclint:none -d target/apidocs @target/main-sources.txt >/dev/null
"$JAR" --create --file "target/$ARTIFACT-$VERSION-javadoc.jar" -C target/apidocs .
cp pom.xml "target/$ARTIFACT-$VERSION.pom"

echo "== static Maven repository layout"
REPO="target/repo/$GROUP_PATH/$ARTIFACT/$VERSION"
mkdir -p "$REPO"
cp "target/$ARTIFACT-$VERSION.jar" "target/$ARTIFACT-$VERSION-sources.jar" "target/$ARTIFACT-$VERSION-javadoc.jar" "target/$ARTIFACT-$VERSION.pom" "$REPO/"
cat > "target/repo/$GROUP_PATH/$ARTIFACT/maven-metadata.xml" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <groupId>click.subspace</groupId>
  <artifactId>$ARTIFACT</artifactId>
  <versioning>
    <latest>$VERSION</latest>
    <release>$VERSION</release>
    <versions>
      <version>$VERSION</version>
    </versions>
    <lastUpdated>$(date -u +%Y%m%d%H%M%S)</lastUpdated>
  </versioning>
</metadata>
EOF
for f in "$REPO"/* "target/repo/$GROUP_PATH/$ARTIFACT/maven-metadata.xml"; do
  sha1sum "$f" | cut -d' ' -f1 | tr -d '\n' > "$f.sha1"
  md5sum "$f" | cut -d' ' -f1 | tr -d '\n' > "$f.md5"
done

echo "== done"
ls -1 target/*.jar target/*.pom
echo "repository: target/repo (upload its contents to the registry root)"
