#!/usr/bin/env bash
# 币市脉搏 · 模拟器一键运行
# 前提：BIOS 里已开启 Intel Virtual Technology，且 AEHD 驱动已安装
# 用法: bash android/emulator-run.sh
set -uo pipefail

# 工具链位置可用环境变量覆盖：TC 或 ANDROID_SDK_ROOT
TC=${TC:-/f/workbuddy/toolchain}
SDK=${ANDROID_SDK_ROOT:-$TC/android-sdk}
AVD=${AVD:-cp_app}
IMG="system-images;android-30;default;x86_64"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
APK=$(ls -1 "$ROOT"/dist/*.apk 2>/dev/null | head -1)
ADB=$SDK/platform-tools/adb.exe
EMU=$SDK/emulator/emulator.exe
AVDM=$SDK/cmdline-tools/latest/bin/avdmanager.bat
OUT=$ROOT/.logs

export ANDROID_SDK_ROOT=$SDK ANDROID_HOME=$SDK
export ANDROID_AVD_HOME=${ANDROID_AVD_HOME:-$HOME/.android/avd}

mkdir -p "$OUT"

[ -n "$APK" ] || { echo "dist/ 下没有 APK，先运行 bash android/build.sh"; exit 1; }
echo "   待装: $APK"

echo "== 1/7 加速检测 =="
"$EMU" -accel-check 2>&1 | sed 's/^/   /'
CODE=$("$EMU" -accel-check >/dev/null 2>&1; echo $?)
echo "   退出码: $CODE （0 = 可用）"
if [ "$CODE" != "0" ]; then
  echo "   加速不可用，先装 AEHD："
  echo "   $SDK/extras/google/Android_Emulator_Hypervisor_Driver/silent_install.bat"
  echo "   或确认 BIOS 的 Intel Virtual Technology 已开启"
fi

echo "== 2/7 确认镜像 =="
if [ ! -d "$SDK/system-images/android-30/default/x86_64" ]; then
  echo "   缺镜像，正在下载…"
  "$SDK/cmdline-tools/latest/bin/sdkmanager.bat" --sdk_root=$SDK "$IMG" >/dev/null 2>&1
fi
ls "$SDK/system-images/android-30/default/x86_64" >/dev/null 2>&1 \
  && echo "   镜像就绪" || { echo "   镜像缺失，中止"; exit 1; }

echo "== 3/7 创建 AVD =="
if "$EMU" -list-avds 2>/dev/null | grep -qx "$AVD"; then
  echo "   已存在: $AVD"
else
  echo "no" | "$AVDM" create avd -n "$AVD" -k "$IMG" -d pixel_5 --force 2>&1 | sed 's/^/   /'
fi

echo "== 4/7 启动模拟器（无窗口，冷启动）=="
"$ADB" kill-server >/dev/null 2>&1
"$ADB" start-server >/dev/null 2>&1
"$EMU" -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot \
  -gpu swiftshader_indirect -memory 2048 -cores 2 -accel on \
  > "$OUT/emulator.log" 2>&1 &
EMU_PID=$!
echo "   PID $EMU_PID，日志 $OUT/emulator.log"

echo "== 5/7 等待开机完成（最长 8 分钟）=="
for i in $(seq 1 96); do
  sleep 5
  BOOT=$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n ')
  if [ "$BOOT" = "1" ]; then echo "   已开机（$((i*5))s）"; break; fi
  if [ $((i % 12)) -eq 0 ]; then echo "   …${i}0s 仍在启动"; fi
done
if [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n ')" != "1" ]; then
  echo "   开机超时，看日志： tail -40 $OUT/emulator.log"
  exit 1
fi
"$ADB" shell settings put global window_animation_scale 0 >/dev/null 2>&1
"$ADB" shell settings put global transition_animation_scale 0 >/dev/null 2>&1
"$ADB" shell wm size 412x915 >/dev/null 2>&1
"$ADB" shell wm density 420 >/dev/null 2>&1

echo "== 6/7 安装并启动 =="
"$ADB" logcat -c
"$ADB" install -r -t "$APK" 2>&1 | tail -2
"$ADB" shell am start -W -n com.niulai.crypto/.MainActivity 2>&1 | grep -E "Status|Activity|TotalTime|Error" | sed 's/^/   /'

echo "   等 25 秒让行情拉起来…"
sleep 25
"$ADB" exec-out screencap -p > "$OUT/emu-1-home.png"
echo "   截图: $OUT/emu-1-home.png"

echo "== 7/7 关键日志 =="
"$ADB" logcat -d -s NiuLai:V AndroidRuntime:E chromium:E 2>/dev/null | tail -25 | sed 's/^/   /'
echo ""
echo "--- 崩溃/白屏判据 ---"
"$ADB" logcat -d 2>/dev/null | grep -E "FATAL|ANR in com.niulai|页面没能加载|FileNotFoundException" | tail -8 | sed 's/^/   /' || echo "   无"

echo ""
echo "模拟器仍在后台运行（PID $EMU_PID）。"
echo "继续交互: $ADB shell input tap X Y / $ADB exec-out screencap -p > x.png"
echo "收工: kill $EMU_PID"
