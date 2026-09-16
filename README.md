# Tahoe Motion Wallpaper

Automatically rotate Apple's four animated **Tahoe Morning / Day / Evening /
Night** aerial wallpapers on the same schedule as the five-frame Tahoe dynamic
HEIC:

| Local time | Wallpaper |
|---|---|
| 00:00-05:59 | Tahoe Night |
| 06:00-09:59 | Tahoe Morning |
| 10:00-16:59 | Tahoe Day |
| 17:00-20:59 | Tahoe Evening |
| 21:00-23:59 | Tahoe Night |

No app, Homebrew package, Python installation, login item, or online service is
required. It uses macOS's built-in JavaScript for Automation and a LaunchAgent.

## Install

Paste this into Terminal:

```sh
/bin/bash -c "$(curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/victor-gurbani/tahoe-motion-wallpaper/v1.0.2/install.sh)"
```

The installer:

1. Requires macOS Tahoe 26 or later.
2. Reads the four IDs and download URLs from Apple's local wallpaper manifest.
3. Prompts before downloading missing videos (the full set is about 1.7 GB).
4. Accepts video URLs only from `https://sylvan.apple.com/` and checks the
   downloaded QuickTime container.
5. Saves a timestamped copy of the current wallpaper preference store.
6. Installs a LaunchAgent that runs at login and at the four transition times.

Apple's videos are downloaded directly from Apple and are **not** included in
this repository.

## Native macOS limitation

Apple aerial wallpapers animate when the Mac locks or unlocks and then settle
into a still desktop. This tool rotates the correct animated aerial by time of
day; it does not make video play continuously behind application windows.

## What it does not change

- Screen saver
- Light/Dark Appearance mode
- Lock Screen clock
- Other downloaded Apple wallpapers

The implementation updates only `Desktop` choices in macOS's wallpaper store
and deliberately skips `Idle` (screen-saver) choices.

## Status and manual test

```sh
/usr/bin/osascript -l JavaScript \
  "$HOME/Library/Application Support/TahoeMotionWallpaper/bin/tahoe-motion-wallpaper.js" \
  --status
```

Test a specific variant:

```sh
/usr/bin/osascript -l JavaScript \
  "$HOME/Library/Application Support/TahoeMotionWallpaper/bin/tahoe-motion-wallpaper.js" \
  --period evening
```

## Uninstall

```sh
/bin/bash -c "$(curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/victor-gurbani/tahoe-motion-wallpaper/v1.0.2/uninstall.sh)"
```

Uninstalling removes the automation but preserves the current wallpaper,
Apple's downloaded videos, and the timestamped pre-install backup.

## Notes

- The wallpaper preference store is an undocumented macOS implementation
  detail and may change in future macOS releases.
- The script accepts both Foundation-backed and plain-JavaScript plist container
  shapes exposed by different JXA bridge behavior, and recursively discovers
  `Desktop` sections while excluding screen-saver sections.
- A manual wallpaper selection remains in effect until the next scheduled
  transition while the LaunchAgent is enabled.
- Related independent project: [andmev/tahoe-wallpaper-switcher](https://github.com/andmev/tahoe-wallpaper-switcher),
  which uses solar-position switching and can also synchronize Appearance.

## License

MIT
