#!/bin/bash

set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
test_home="$(mktemp -d /tmp/tahoe-motion-test.XXXXXX)"
trap 'rm -rf -- "$test_home"' EXIT

wallpaper_root="$test_home/Library/Application Support/com.apple.wallpaper"
manifest_dir="$wallpaper_root/aerials/manifest"
videos_dir="$wallpaper_root/aerials/videos"
store_dir="$wallpaper_root/Store"
mkdir -p "$manifest_dir" "$videos_dir" "$store_dir"
cp "$repository_root/tests/fixtures/entries.json" "$manifest_dir/entries.json"
cp "$repository_root/tests/fixtures/Index.plist" "$store_dir/Index.plist"

for asset_id in \
  AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA \
  BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB \
  CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC \
  DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD; do
  /usr/bin/touch "$videos_dir/$asset_id.mov"
done

idle_before="$(/usr/bin/plutil -extract AllSpacesAndDisplays.Idle xml1 -o - "$store_dir/Index.plist" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')"

TAHOE_MOTION_HOME="$test_home" \
TAHOE_MOTION_SOURCE_DIR="$repository_root" \
TAHOE_MOTION_ALLOW_UNSUPPORTED=1 \
TAHOE_MOTION_ASSUME_YES=1 \
TAHOE_MOTION_NO_LAUNCHCTL=1 \
  /bin/bash "$repository_root/install.sh"

installed_script="$test_home/Library/Application Support/TahoeMotionWallpaper/bin/tahoe-motion-wallpaper.js"
installed_agent="$test_home/Library/LaunchAgents/com.varfield.tahoe-motion-wallpaper.plist"
test -x "$installed_script"
/usr/bin/plutil -lint "$installed_agent"

TAHOE_MOTION_HOME="$test_home" TAHOE_MOTION_NO_RESTART=1 \
  /usr/bin/osascript -l JavaScript "$installed_script" --period night

provider="$(/usr/bin/plutil -extract AllSpacesAndDisplays.Desktop.Content.Choices.0.Provider raw "$store_dir/Index.plist")"
configuration="$(/usr/bin/plutil -extract AllSpacesAndDisplays.Desktop.Content.Choices.0.Configuration raw "$store_dir/Index.plist")"
asset_id="$(printf '%s' "$configuration" | /usr/bin/base64 -D | /usr/bin/plutil -extract assetID raw -)"
idle_after="$(/usr/bin/plutil -extract AllSpacesAndDisplays.Idle xml1 -o - "$store_dir/Index.plist" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')"

test "$provider" = "com.apple.wallpaper.choice.aerials"
test "$asset_id" = "DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD"
test "$idle_before" = "$idle_after"
test -n "$(find "$test_home/Library/Application Support/TahoeMotionWallpaper/backups" -type f -name 'Index.before-install.*.plist' -print -quit)"

# Emulate the bridge behavior seen on some Macs, where Foundation plist
# containers arrive in JXA as plain JavaScript objects. Also use a deliberately
# different store layout to verify recursive Desktop discovery.
cp "$repository_root/tests/fixtures/Index-alternate.plist" "$store_dir/Index.plist"
alternate_idle_before="$(/usr/bin/plutil -extract WallpaperSets.display-1.Idle xml1 -o - "$store_dir/Index.plist" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')"

TAHOE_MOTION_HOME="$test_home" \
TAHOE_MOTION_NO_RESTART=1 \
TAHOE_MOTION_FORCE_JS_PLIST=1 \
  /usr/bin/osascript -l JavaScript "$installed_script" --period morning

alternate_provider="$(/usr/bin/plutil -extract WallpaperSets.display-1.Desktop.Content.Choices.0.Provider raw "$store_dir/Index.plist")"
alternate_configuration="$(/usr/bin/plutil -extract WallpaperSets.display-1.Desktop.Content.Choices.0.Configuration raw "$store_dir/Index.plist")"
alternate_asset_id="$(printf '%s' "$alternate_configuration" | /usr/bin/base64 -D | /usr/bin/plutil -extract assetID raw -)"
alternate_idle_after="$(/usr/bin/plutil -extract WallpaperSets.display-1.Idle xml1 -o - "$store_dir/Index.plist" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')"

test "$alternate_provider" = "com.apple.wallpaper.choice.aerials"
test "$alternate_asset_id" = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"
test "$alternate_idle_before" = "$alternate_idle_after"

TAHOE_MOTION_HOME="$test_home" TAHOE_MOTION_NO_LAUNCHCTL=1 \
  /bin/bash "$repository_root/uninstall.sh"
test ! -e "$installed_script"
test ! -e "$installed_agent"
test -n "$(find "$test_home/Library/Application Support/TahoeMotionWallpaper/backups" -type f -name 'Index.before-install.*.plist' -print -quit)"

echo "All isolated installer tests passed."
