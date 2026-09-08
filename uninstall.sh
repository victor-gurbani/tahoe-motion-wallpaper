#!/bin/bash

set -euo pipefail

LABEL="com.varfield.tahoe-motion-wallpaper"
app_home="${TAHOE_MOTION_HOME:-$HOME}"
runtime_dir="$app_home/Library/Application Support/TahoeMotionWallpaper"
launch_agent="$app_home/Library/LaunchAgents/$LABEL.plist"

if [ "${TAHOE_MOTION_NO_LAUNCHCTL:-0}" != "1" ]; then
  /bin/launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
fi

rm -f -- "$launch_agent"
rm -f -- "$runtime_dir/bin/tahoe-motion-wallpaper.js"
rm -f -- "$runtime_dir/state.json" "$runtime_dir/run.lock"
rm -f -- "$app_home/Library/Logs/TahoeMotionWallpaper.log"
rm -f -- "$app_home/Library/Logs/TahoeMotionWallpaper.error.log"

echo "Tahoe Motion Wallpaper automation removed."
echo "Apple's downloaded videos, the current wallpaper, and backups were preserved."
if [ -d "$runtime_dir/backups" ]; then
  echo "Backups: $runtime_dir/backups"
fi
