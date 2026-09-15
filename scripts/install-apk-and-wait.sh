#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 APK_PATH" >&2
  exit 2
fi

apk_path=$1
if [ ! -f "$apk_path" ]; then
  echo "APK does not exist: $apk_path" >&2
  exit 1
fi

# `adb install` is synchronous: it returns only after Package Manager has
# accepted or rejected the APK. Require both a successful exit and its
# documented terminal result so CI cannot pass on a partial installation.
set +e
install_output=$(adb -s "${ANDROID_SERIAL:?ANDROID_SERIAL is required}" install --user 0 -r "$apk_path" 2>&1)
install_status=$?
set -e

printf '%s\n' "$install_output"

if [ "$install_status" -ne 0 ] || ! printf '%s\n' "$install_output" | grep -qx 'Success'; then
  echo "AnyAPK installation did not finish with Success." >&2
  exit 1
fi

echo "AnyAPK installation completed successfully on $ANDROID_SERIAL."
