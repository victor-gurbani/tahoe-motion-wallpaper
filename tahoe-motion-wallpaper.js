#!/usr/bin/osascript -l JavaScript

// Rotate Apple's Tahoe aerial wallpapers on the schedule encoded by the
// popular five-frame Tahoe dynamic HEIC: night 00:00, morning 06:00,
// day 10:00, evening 17:00, and night again at 21:00.
//
// This changes Desktop wallpaper choices only. It deliberately leaves the
// user's screen saver and Light/Dark Appearance settings untouched.

ObjC.import("Foundation");

const PROVIDER = "com.apple.wallpaper.choice.aerials";
const PERIODS = ["morning", "day", "evening", "night"];
const LABELS = {
  morning: "Tahoe Morning",
  day: "Tahoe Day",
  evening: "Tahoe Evening",
  night: "Tahoe Night",
};

function environmentValue(name) {
  const value = $.NSProcessInfo.processInfo.environment.objectForKey($(name));
  if (!value || value.isNil()) return null;
  return ObjC.unwrap(value);
}

function paths() {
  const appHome = environmentValue("TAHOE_MOTION_HOME") || ObjC.unwrap($.NSHomeDirectory());
  const wallpaperRoot = appHome + "/Library/Application Support/com.apple.wallpaper";
  const runtimeRoot = appHome + "/Library/Application Support/TahoeMotionWallpaper";
  return {
    home: appHome,
    manifest: wallpaperRoot + "/aerials/manifest/entries.json",
    videos: wallpaperRoot + "/aerials/videos",
    store: wallpaperRoot + "/Store/Index.plist",
    runtime: runtimeRoot,
    state: runtimeRoot + "/state.json",
  };
}

function readText(path) {
  const data = $.NSData.dataWithContentsOfFile($(path));
  if (!data || data.isNil()) throw new Error("Cannot read " + path);
  const string = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
  if (!string || string.isNil()) throw new Error("Cannot decode " + path);
  return ObjC.unwrap(string);
}

function fileExists(path) {
  return Boolean($.NSFileManager.defaultManager.fileExistsAtPath($(path)));
}

function ensureDirectory(path) {
  const manager = $.NSFileManager.defaultManager;
  const ok = manager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
    $(path),
    true,
    $.NSDictionary.dictionary,
    null
  );
  if (!ok) throw new Error("Cannot create " + path);
}

function resolveAssets(requireDownloaded) {
  const p = paths();
  const manifest = JSON.parse(readText(p.manifest));
  const sourceAssets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const result = {};

  PERIODS.forEach(function (period) {
    const label = LABELS[period];
    const candidates = sourceAssets.filter(function (asset) {
      return asset.accessibilityLabel === label;
    });
    if (candidates.length === 0) {
      throw new Error(label + " is missing from Apple's wallpaper manifest");
    }

    let selected = candidates[0];
    let selectedPath = null;
    candidates.some(function (asset) {
      const id = String(asset.id || "");
      return [".mov", ".mp4", ".m4v"].some(function (extension) {
        const candidatePath = p.videos + "/" + id + extension;
        if (!fileExists(candidatePath)) return false;
        selected = asset;
        selectedPath = candidatePath;
        return true;
      });
    });

    const id = String(selected.id || "");
    const url = String(selected["url-4K-SDR-240FPS"] || "");
    if (!id) throw new Error(label + " has no asset ID");
    if (requireDownloaded && !selectedPath) {
      throw new Error(label + " is not downloaded");
    }
    result[period] = {
      period: period,
      label: label,
      id: id,
      url: url,
      downloaded: Boolean(selectedPath),
      path: selectedPath,
    };
  });
  return result;
}

function periodFor(date) {
  const minute = date.getHours() * 60 + date.getMinutes();
  if (minute < 6 * 60 || minute >= 21 * 60) return "night";
  if (minute < 10 * 60) return "morning";
  if (minute < 17 * 60) return "day";
  return "evening";
}

function isFoundationKind(value, foundationClass) {
  return Boolean(
    value &&
      typeof value.isKindOfClass === "function" &&
      value.isKindOfClass(foundationClass)
  );
}

function isDictionary(value) {
  return isFoundationKind(value, $.NSDictionary.class);
}

function isArray(value) {
  return isFoundationKind(value, $.NSArray.class);
}

function isData(value) {
  return isFoundationKind(value, $.NSData.class);
}

function mutablePlist(path) {
  const data = $.NSData.dataWithContentsOfFile($(path));
  if (!data || data.isNil()) throw new Error("Cannot read wallpaper store at " + path);
  const value = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(
    data,
    $.NSPropertyListMutableContainersAndLeaves,
    null,
    null
  );
  if (!value || value.isNil()) throw new Error("Cannot parse wallpaper store at " + path);
  return value;
}

function encodedConfiguration(assetID) {
  const configuration = $.NSMutableDictionary.dictionary;
  configuration.setObjectForKey($(assetID), $("assetID"));
  const data = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError(
    configuration,
    $.NSPropertyListBinaryFormat_v1_0,
    0,
    null
  );
  if (!data || data.isNil()) throw new Error("Cannot encode aerial configuration");
  return data;
}

function currentAssetID(choice) {
  const provider = choice.objectForKey("Provider");
  if (!provider || provider.isNil() || ObjC.unwrap(provider) !== PROVIDER) return null;
  const raw = choice.objectForKey("Configuration");
  if (!isData(raw)) return null;
  try {
    const decoded = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(
      raw,
      $.NSPropertyListImmutable,
      null,
      null
    );
    if (!isDictionary(decoded)) return null;
    const assetID = decoded.objectForKey("assetID");
    if (!assetID || assetID.isNil()) return null;
    return ObjC.unwrap(assetID);
  } catch (_) {
    return null;
  }
}

function updateDesktop(desktop, assetID, encoded, report) {
  const content = desktop.objectForKey("Content");
  if (!isDictionary(content)) return;
  const choices = content.objectForKey("Choices");
  if (!isArray(choices)) return;

  let changedHere = false;
  const count = Number(choices.count);
  for (let index = 0; index < count; index += 1) {
    const choice = choices.objectAtIndex(index);
    if (!isDictionary(choice)) continue;
    const current = currentAssetID(choice);
    report.currentAssetIDs.push(current);
    report.choiceCount += 1;
    if (current === assetID) continue;
    choice.setObjectForKey($(PROVIDER), $("Provider"));
    choice.setObjectForKey(encoded, $("Configuration"));
    choice.setObjectForKey($.NSMutableArray.array, $("Files"));
    changedHere = true;
    report.changed = true;
  }
  if (changedHere) desktop.setObjectForKey($.NSDate.date, $("LastSet"));
}

function updateContainer(container, assetID, encoded, report) {
  if (!isDictionary(container)) return;
  const desktop = container.objectForKey("Desktop");
  if (isDictionary(desktop)) updateDesktop(desktop, assetID, encoded, report);
}

function updateDesktopTree(root, assetID, encoded, report) {
  ["AllSpacesAndDisplays", "SystemDefault"].forEach(function (key) {
    updateContainer(root.objectForKey($(key)), assetID, encoded, report);
  });

  ["Displays", "Spaces"].forEach(function (key) {
    const collection = root.objectForKey($(key));
    if (!isDictionary(collection)) return;
    const identifiers = ObjC.deepUnwrap(collection.allKeys);
    identifiers.forEach(function (identifier) {
      updateContainer(collection.objectForKey($(identifier)), assetID, encoded, report);
    });
  });
}

function savePlist(path, value) {
  const data = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError(
    value,
    $.NSPropertyListBinaryFormat_v1_0,
    0,
    null
  );
  if (!data || data.isNil()) throw new Error("Cannot encode wallpaper store");
  if (!data.writeToFileAtomically($(path), true)) {
    throw new Error("Cannot atomically write wallpaper store at " + path);
  }
}

function writeState(path, value) {
  const string = $(JSON.stringify(value, null, 2) + "\n");
  const ok = string.writeToFileAtomicallyEncodingError(
    $(path),
    true,
    $.NSUTF8StringEncoding,
    null
  );
  if (!ok) throw new Error("Cannot write state at " + path);
}

function parseArguments(argv) {
  const options = { dryRun: false, assetsTSV: false, period: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index]);
    if (argument === "--dry-run" || argument === "--status") {
      options.dryRun = true;
    } else if (argument === "--assets-tsv") {
      options.assetsTSV = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--period") {
      index += 1;
      if (index >= argv.length) throw new Error("--period needs a value");
      options.period = String(argv[index]);
      if (PERIODS.indexOf(options.period) === -1) {
        throw new Error("Invalid period: " + options.period);
      }
    } else {
      throw new Error("Unknown argument: " + argument);
    }
  }
  return options;
}

function run(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    return [
      "Usage: tahoe-motion-wallpaper.js [--dry-run|--status] [--period PERIOD]",
      "       tahoe-motion-wallpaper.js --assets-tsv",
      "Periods: morning, day, evening, night",
    ].join("\n");
  }

  if (options.assetsTSV) {
    const assets = resolveAssets(false);
    return PERIODS.map(function (period) {
      const asset = assets[period];
      return [asset.period, asset.label, asset.id, asset.url, asset.downloaded ? "yes" : "no"].join("\t");
    }).join("\n");
  }

  const p = paths();
  const now = new Date();
  const desiredPeriod = options.period || periodFor(now);
  const assets = resolveAssets(true);
  const desired = assets[desiredPeriod];
  const index = mutablePlist(p.store);
  const report = {
    period: desiredPeriod,
    label: desired.label,
    asset_id: desired.id,
    currentAssetIDs: [],
    choiceCount: 0,
    changed: false,
    schedule: "00:00 night; 06:00 morning; 10:00 day; 17:00 evening; 21:00 night",
  };
  const encoded = encodedConfiguration(desired.id);
  updateDesktopTree(index, desired.id, encoded, report);
  if (report.choiceCount === 0) throw new Error("No Desktop wallpaper choices were found");

  if (options.dryRun) return JSON.stringify(report, null, 2);

  try {
    ensureDirectory(p.runtime);
  } catch (error) {
    throw new Error("Runtime directory: " + error);
  }
  if (report.changed) {
    try {
      savePlist(p.store, index);
    } catch (error) {
      throw new Error("Wallpaper store write: " + error);
    }
  }
  report.changed_at = now.toISOString();
  try {
    writeState(p.state, report);
  } catch (error) {
    throw new Error("State write: " + error);
  }

  if (report.changed && environmentValue("TAHOE_MOTION_NO_RESTART") !== "1") {
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    try {
      app.doShellScript("/usr/bin/killall WallpaperAgent");
    } catch (_) {
      // WallpaperAgent may not be running yet; launchd starts it when needed.
    }
  }

  return report.changed
    ? "Tahoe motion wallpaper set to " + desired.label
    : "Tahoe motion wallpaper already set to " + desired.label;
}
