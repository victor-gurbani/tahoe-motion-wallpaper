#!/bin/bash

set -euo pipefail

VERSION="v1.0.1"
REPOSITORY="victor-gurbani/tahoe-motion-wallpaper"
RAW_BASE="https://raw.githubusercontent.com/${REPOSITORY}/${VERSION}"
EXPECTED_SCRIPT_GIT_SHA1="cb443d663762a796e16c549eeac51104adf428cf"
LABEL="com.varfield.tahoe-motion-wallpaper"

if [ "$(id -u)" -eq 0 ]; then
  echo "Do not run this installer with sudo." >&2
  exit 1
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Tahoe Motion Wallpaper requires macOS." >&2
  exit 1
fi

if [ "${TAHOE_MOTION_ALLOW_UNSUPPORTED:-0}" != "1" ]; then
  macos_major="$(/usr/bin/sw_vers -productVersion | /usr/bin/cut -d. -f1)"
  if [ "$macos_major" -lt 26 ]; then
    echo "Tahoe Motion Wallpaper requires macOS 26 or later." >&2
    exit 1
  fi
fi

app_home="${TAHOE_MOTION_HOME:-$HOME}"
runtime_dir="$app_home/Library/Application Support/TahoeMotionWallpaper"
wallpaper_root="$app_home/Library/Application Support/com.apple.wallpaper"
manifest="$wallpaper_root/aerials/manifest/entries.json"
videos_dir="$wallpaper_root/aerials/videos"
store="$wallpaper_root/Store/Index.plist"
scripts_dir="$runtime_dir/bin"
script_path="$scripts_dir/tahoe-motion-wallpaper.js"
launch_agents="$app_home/Library/LaunchAgents"
launch_agent="$launch_agents/$LABEL.plist"
logs_dir="$app_home/Library/Logs"
stdout_log="$logs_dir/TahoeMotionWallpaper.log"
stderr_log="$logs_dir/TahoeMotionWallpaper.error.log"
backups_dir="$runtime_dir/backups"

mkdir -p "$scripts_dir" "$launch_agents" "$logs_dir" "$backups_dir" "$videos_dir"
chmod 700 "$runtime_dir" "$scripts_dir" "$backups_dir"

script_temporary="$runtime_dir/.tahoe-motion-wallpaper.js.$$"
assets_temporary="$runtime_dir/.assets.$$"
current_download=""
agent_temporary=""

cleanup() {
  [ ! -e "$script_temporary" ] || rm -f -- "$script_temporary"
  [ ! -e "$assets_temporary" ] || rm -f -- "$assets_temporary"
  [ -z "$current_download" ] || [ ! -e "$current_download" ] || rm -f -- "$current_download"
  [ -z "$agent_temporary" ] || [ ! -e "$agent_temporary" ] || rm -f -- "$agent_temporary"
}
trap cleanup EXIT INT TERM

echo "Tahoe Motion Wallpaper ${VERSION}"

if [ -n "${TAHOE_MOTION_SOURCE_DIR:-}" ]; then
  cp "${TAHOE_MOTION_SOURCE_DIR}/tahoe-motion-wallpaper.js" "$script_temporary"
else
  /usr/bin/curl --fail --silent --show-error --location \
    --proto '=https' --tlsv1.2 \
    "$RAW_BASE/tahoe-motion-wallpaper.js" \
    --output "$script_temporary"
fi

script_size="$(/usr/bin/stat -f '%z' "$script_temporary")"
actual_script_git_sha1="$(
  {
    printf 'blob %s\0' "$script_size"
    /bin/cat "$script_temporary"
  } | /usr/bin/shasum -a 1 | /usr/bin/awk '{print $1}'
)"
if [ "$actual_script_git_sha1" != "$EXPECTED_SCRIPT_GIT_SHA1" ]; then
  echo "Installer integrity check failed for tahoe-motion-wallpaper.js." >&2
  exit 1
fi
/usr/bin/install -m 700 "$script_temporary" "$script_path"

if [ ! -f "$manifest" ]; then
  if [ "${TAHOE_MOTION_HOME:-}" = "" ]; then
    /usr/bin/open 'x-apple.systempreferences:com.apple.Wallpaper-Settings.extension' || true
  fi
  echo "Apple's wallpaper manifest is not initialized." >&2
  echo "Open System Settings > Wallpaper once, then run the installer again." >&2
  exit 1
fi

if [ ! -f "$store" ]; then
  echo "Apple's wallpaper preference store is missing at: $store" >&2
  exit 1
fi

TAHOE_MOTION_HOME="$app_home" /usr/bin/osascript -l JavaScript \
  "$script_path" --assets-tsv > "$assets_temporary"

missing_count=0
while IFS=$'\t' read -r period label asset_id asset_url downloaded; do
  [ -n "$period" ] || continue
  if [ "$downloaded" != "yes" ]; then
    missing_count=$((missing_count + 1))
  fi
done < "$assets_temporary"

if [ "$missing_count" -gt 0 ]; then
  echo ""
  echo "$missing_count Tahoe motion wallpaper(s) are missing."
  echo "The complete set is about 1.7 GB and will be downloaded from Apple's CDN."

  available_kb="$(/bin/df -Pk "$videos_dir" | /usr/bin/awk 'NR == 2 {print $4}')"
  required_kb=$((missing_count * 600 * 1024))
  if [ "$available_kb" -lt "$required_kb" ]; then
    echo "Not enough free space for the missing Tahoe videos." >&2
    exit 1
  fi

  consent=""
  if [ "${TAHOE_MOTION_ASSUME_YES:-0}" = "1" ]; then
    consent="y"
  elif [ -t 0 ]; then
    read -r -p "Download the missing Apple wallpapers now? [Y/n] " consent
    consent="${consent:-y}"
  fi
  case "$consent" in
    y|Y|yes|YES) ;;
    *)
      echo "Nothing installed. You can also download all four Tahoe variants in System Settings > Wallpaper." >&2
      exit 1
      ;;
  esac

  while IFS=$'\t' read -r period label asset_id asset_url downloaded; do
    [ -n "$period" ] || continue
    [ "$downloaded" != "yes" ] || continue

    if [[ ! "$asset_id" =~ ^[A-F0-9-]{36}$ ]]; then
      echo "Invalid Apple asset ID for $label." >&2
      exit 1
    fi
    case "$asset_url" in
      https://sylvan.apple.com/*) ;;
      *)
        echo "Refusing non-Apple asset URL for $label." >&2
        exit 1
        ;;
    esac

    destination="$videos_dir/$asset_id.mov"
    current_download="$videos_dir/.$asset_id.download.$$"
    echo "Downloading $label..."
    /usr/bin/curl --fail --location --show-error \
      --proto '=https' --tlsv1.2 --retry 3 \
      "$asset_url" --output "$current_download"

    asset_size="$(/usr/bin/stat -f '%z' "$current_download")"
    asset_magic="$(/usr/bin/od -An -t x1 -j 4 -N 4 "$current_download" | /usr/bin/tr -d ' \n')"
    if [ "$asset_size" -lt 10485760 ] || [ "$asset_magic" != "66747970" ]; then
      echo "Downloaded file for $label is not a valid QuickTime asset." >&2
      exit 1
    fi
    chmod 600 "$current_download"
    mv "$current_download" "$destination"
    current_download=""
  done < "$assets_temporary"
fi

TAHOE_MOTION_HOME="$app_home" /usr/bin/osascript -l JavaScript \
  "$script_path" --dry-run >/dev/null

timestamp="$(/bin/date '+%Y%m%d-%H%M%S')"
backup_path="$backups_dir/Index.before-install.$timestamp.plist"
cp -p "$store" "$backup_path"
chmod 600 "$backup_path"

xml_escape() {
  /usr/bin/sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

script_xml="$(printf '%s' "$script_path" | xml_escape)"
stdout_xml="$(printf '%s' "$stdout_log" | xml_escape)"
stderr_xml="$(printf '%s' "$stderr_log" | xml_escape)"
agent_temporary="$launch_agents/.$LABEL.plist.$$"

cat > "$agent_temporary" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/osascript</string>
    <string>-l</string>
    <string>JavaScript</string>
    <string>$script_xml</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>17</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>$stdout_xml</string>
  <key>StandardErrorPath</key>
  <string>$stderr_xml</string>
</dict>
</plist>
PLIST

/usr/bin/plutil -lint "$agent_temporary" >/dev/null
chmod 600 "$agent_temporary"
mv -f "$agent_temporary" "$launch_agent"
agent_temporary=""

if [ "${TAHOE_MOTION_NO_LAUNCHCTL:-0}" = "1" ]; then
  TAHOE_MOTION_HOME="$app_home" TAHOE_MOTION_NO_RESTART=1 \
    /usr/bin/osascript -l JavaScript "$script_path"
else
  user_id="$(id -u)"
  /bin/launchctl bootout "gui/$user_id/$LABEL" 2>/dev/null || true
  TAHOE_MOTION_HOME="$app_home" /usr/bin/osascript -l JavaScript "$script_path"
  /bin/launchctl bootstrap "gui/$user_id" "$launch_agent"
fi

echo ""
echo "Installed. Tahoe Morning, Day, Evening, and Night will switch at 06:00, 10:00, 17:00, and 21:00."
echo "Screen saver and Light/Dark Appearance settings were not changed."
echo "Backup: $backup_path"
