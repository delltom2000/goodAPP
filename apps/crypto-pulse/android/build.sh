#!/usr/bin/env bash
# 币市脉搏 · 安卓 APK 构建脚本
# 不依赖 Gradle：aapt2 编译资源 -> javac -> d8 转 dex -> zipalign -> apksigner 签名
set -euo pipefail

# 工具链位置可用环境变量覆盖：TC 指向同时含 JDK 与 android-sdk 的目录，
# 也可以直接给 JAVA_HOME / ANDROID_SDK_ROOT。
TC=${TC:-/f/workbuddy/toolchain}
JDK=${JAVA_HOME:-$TC/jdk-17.0.20.1+1}
SDK=${ANDROID_SDK_ROOT:-$TC/android-sdk}
BT=$SDK/build-tools/34.0.0
PLAT=$SDK/platforms/android-34

ROOT=$(cd "$(dirname "$0")/.." && pwd)
AND=$ROOT/android
SRC=$AND/app/src/main
OUT=$AND/build
JAVA=$JDK/bin/java
JAVAC=$JDK/bin/javac
KEYTOOL=$JDK/bin/keytool
JAR=$JDK/bin/jar
[ -x "$JAVA.exe" ] && { JAVA=$JAVA.exe; JAVAC=$JAVAC.exe; KEYTOOL=$KEYTOOL.exe; JAR=$JAR.exe; } || true

APP_NAME=CryptoPulse
VERSION=1.0.0
DIST=$ROOT/dist
mkdir -p "$DIST"
EXE=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) EXE=".exe";; esac

MIN_SDK=26
TARGET_SDK=34

echo "==> 0/7 同步网页资源"
WWW=$SRC/assets/www
mkdir -p "$WWW"
for f in index.html newcoins.html manifest.webmanifest sw.js; do
  cp -f "$ROOT/$f" "$WWW/$f"
done
for d in css js icons; do
  cp -rf "$ROOT/$d" "$WWW/"
done
echo "    文本 $(find "$WWW" -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' \) | wc -l) 个 / 总 $(find "$WWW" -type f | wc -l) 个文件"

echo "==> 0.5/7 生成内置资源（编进 dex，不依赖 assets）"
( command -v python3 >/dev/null && python3 "$AND/tools/gen_bundle.py" ) || python "$AND/tools/gen_bundle.py"

echo "==> 清理生成物"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"
for d in gen classes dex; do
  find "$OUT/$d" -type f -delete 2>/dev/null || true
done
for f in res.zip base.apk unsigned.apk aligned.apk; do
  [ -f "$OUT/$f" ] && rm -f "$OUT/$f"
done

echo "==> 1/7 编译资源"
"$BT/aapt2$EXE" compile --dir "$SRC/res" -o "$OUT/res.zip"

echo "==> 2/7 链接资源与清单（含 assets）"
"$BT/aapt2$EXE" link \
  -o "$OUT/base.apk" \
  -I "$PLAT/android.jar" \
  --manifest "$SRC/AndroidManifest.xml" \
  -A "$SRC/assets" \
  --java "$OUT/gen" \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK" \
  "$OUT/res.zip"

echo "==> 3/7 编译 Java"
"$JAVAC" -nowarn -source 8 -target 8 -encoding UTF-8 \
  -classpath "$PLAT/android.jar" \
  -d "$OUT/classes" \
  $(find "$OUT/gen" -name '*.java') \
  $(find "$SRC/java" -name '*.java') 2>&1 | grep -v 'bootstrap class path' || true

echo "==> 4/7 转 dex"
"$JAVA" -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 \
  --release --lib "$PLAT/android.jar" --min-api "$MIN_SDK" \
  --output "$OUT/dex" \
  $(find "$OUT/classes" -name '*.class')

echo "==> 5/7 组装并签名"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
"$JAR" ufM "$OUT/unsigned.apk" -C "$OUT/dex" classes.dex

"$BT/zipalign$EXE" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

KS=$AND/release.jks
if [ ! -f "$KS" ]; then
  echo "    生成签名密钥"
  "$KEYTOOL" -genkeypair -v \
    -keystore "$KS" -alias niulai \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass niulai2026 -keypass niulai2026 \
    -dname "CN=NiuLai, OU=Mobile, O=NiuLai, L=Shenzhen, ST=Guangdong, C=CN" 2>&1 | tail -2
fi

APK=$DIST/$APP_NAME-$VERSION.apk
rm -f "$APK"
"$JAVA" -jar "$BT/lib/apksigner.jar" sign \
  --ks "$KS" --ks-key-alias niulai \
  --ks-pass pass:niulai2026 --key-pass pass:niulai2026 \
  --v1-signing-enabled true --v2-signing-enabled true \
  --out "$APK" "$OUT/aligned.apk"

echo "==> 6/7 校验"
"$JAVA" -jar "$BT/lib/apksigner.jar" verify --verbose "$APK" | head -6
echo "--- badging ---"
"$BT/aapt2$EXE" dump badging "$APK" | grep -E "^package|launchable-activity|sdkVersion|targetSdkVersion|application-label|application-icon-320" | head -8

echo "==> 7/7 体检：确认真机要读的东西都在 dex 里"
DEX=$OUT/dex/classes.dex
for c in "Lcom/niulai/crypto/MainActivity;" "Lcom/niulai/crypto/WebBundle;"; do
  if "$BT/dexdump$EXE" -f "$DEX" 2>/dev/null | grep -q "$c"; then echo "    OK  $c"; else echo "    缺失 $c"; exit 1; fi
done
echo "    dex: $(stat -c%s "$DEX") B / APK: $(stat -c%s "$APK") B"
echo "--- 产物 ---"
ls -lh "$APK"
