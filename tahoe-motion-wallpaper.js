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

function isNilLike(value) {
  if (value === null || value === undefined) return true;
  try {
    const marker = value.isNil;
    if (typeof marker === "function") return Boolean(value.isNil());
    if (typeof marker === "boolean") return marker;
  } catch (_) {
    // Plain JavaScript values do not expose NSObject's isNil helper.
  }
  return false;
}

function unwrapValue(value) {
  if (isNilLike(value)) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  try {
    return ObjC.unwrap(value);
  } catch (_) {
    return value;
  }
}

function stringValue(value) {
  const unwrapped = unwrapValue(value);
  if (unwrapped === null || unwrapped === undefined) return null;
  return String(unwrapped);
}

function hasSelector(value, name) {
  if (isNilLike(value)) return false;
  try {
    return value[name] !== undefined && value[name] !== null;
  } catch (_) {
    return false;
  }
}

function isJavaScriptDictionary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch (_) {
    return false;
  }
}

function isDictionary(value) {
  return isJavaScriptDictionary(value) || hasSelector(value, "objectForKey");
}

function isArray(value) {
  return Array.isArray(value) || hasSelector(value, "objectAtIndex");
}

function isData(value) {
  if (isNilLike(value)) return false;
  if (hasSelector(value, "base64EncodedStringWithOptions")) return true;
  try {
    if (hasSelector(value, "isKindOfClass")) {
      return Boolean(value.isKindOfClass($.NSData.class));
    }
  } catch (_) {
    // Some JXA bridge variants do not expose NSObject selectors here.
  }
  return false;
}

function dictionaryGet(dictionary, key) {
  if (isJavaScriptDictionary(dictionary)) return dictionary[key];
  try {
    return dictionary.objectForKey($(key));
  } catch (_) {
    try {
      return dictionary[key];
    } catch (_) {
      return null;
    }
  }
}

function dictionarySet(dictionary, key, value) {
  if (isJavaScriptDictionary(dictionary)) {
    dictionary[key] = value;
    return;
  }
  try {
    dictionary.setObjectForKey(ObjC.wrap(value), $(key));
  } catch (_) {
    dictionary.setObjectForKey(value, $(key));
  }
}

function dictionaryKeys(dictionary) {
  if (isJavaScriptDictionary(dictionary)) return Object.keys(dictionary);
  try {
    let keys = dictionary.allKeys;
    if (typeof keys === "function") keys = dictionary.allKeys();
    return ObjC.deepUnwrap(keys).map(function (key) {
      return String(key);
    });
  } catch (_) {
    return [];
  }
}

function arrayCount(array) {
  if (Array.isArray(array)) return array.length;
  try {
    return Number(array.count);
  } catch (_) {
    return 0;
  }
}

function arrayGet(array, index) {
  if (Array.isArray(array)) return array[index];
  try {
    return array.objectAtIndex(index);
  } catch (_) {
    return null;
  }
}

function environmentValue(name) {
  const value = $.NSProcessInfo.processInfo.environment.objectForKey($(name));
  if (isNilLike(value)) return null;
  return stringValue(value);
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
  if (isNilLike(data)) throw new Error("Cannot read " + path);
  const string = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
  if (isNilLike(string)) throw new Error("Cannot decode " + path);
  return stringValue(string);
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

function mutablePlist(path) {
  const data = $.NSData.dataWithContentsOfFile($(path));
  if (isNilLike(data)) throw new Error("Cannot read wallpaper store at " + path);
  const value = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(
    data,
    $.NSPropertyListMutableContainersAndLeaves,
    null,
    null
  );
  if (isNilLike(value)) throw new Error("Cannot parse wallpaper store at " + path);

  // Test/diagnostic mode that emulates systems where JXA exposes plist
  // containers as ordinary JavaScript objects rather than Foundation proxies.
  if (environmentValue("TAHOE_MOTION_FORCE_JS_PLIST") === "1") {
    return ObjC.deepUnwrap(value);
  }
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
  if (isNilLike(data)) throw new Error("Cannot encode aerial configuration");
  return data;
}

function currentAssetID(choice) {
  const provider = dictionaryGet(choice, "Provider");
  if (isNilLike(provider) || stringValue(provider) !== PROVIDER) return null;
  const raw = dictionaryGet(choice, "Configuration");
  if (!isData(raw)) return null;
  try {
    const decoded = $.NSPropertyListSerialization.propertyListWithDataOptionsFormatError(
      raw,
      $.NSPropertyListImmutable,
      null,
      null
    );
    if (!isDictionary(decoded)) return null;
    const assetID = dictionaryGet(decoded, "assetID");
    return isNilLike(assetID) ? null : stringValue(assetID);
  } catch (_) {
    return null;
  }
}

function updateDesktop(desktop, assetID, encoded, report) {
  const content = dictionaryGet(desktop, "Content");
  if (!isDictionary(content)) return;
  const choices = dictionaryGet(content, "Choices");
  if (!isArray(choices)) return;

  let changedHere = false;
  const count = arrayCount(choices);
  for (let index = 0; index < count; index += 1) {
    const choice = arrayGet(choices, index);
    if (!isDictionary(choice)) continue;
    const current = currentAssetID(choice);
    report.currentAssetIDs.push(current);
    report.choiceCount += 1;
    if (current === assetID) continue;
    dictionarySet(choice, "Provider", PROVIDER);
    dictionarySet(choice, "Configuration", encoded);
    dictionarySet(choice, "Files", []);
    changedHere = true;
    report.changed = true;
  }
  if (changedHere) dictionarySet(desktop, "LastSet", new Date());
}

function normalizedSectionName(key) {
  return String(key).toLowerCase().replace(/[^a-z]/g, "");
}

function walkDesktopTree(value, assetID, encoded, report) {
  if (isDictionary(value)) {
    dictionaryKeys(value).forEach(function (key) {
      const normalized = normalizedSectionName(key);

      // Never descend into screen-saver state.
      if (normalized === "idle" || normalized === "screensaver") return;

      const child = dictionaryGet(value, key);
      if (normalized === "desktop") {
        if (isDictionary(child)) updateDesktop(child, assetID, encoded, report);
        return;
      }
      walkDesktopTree(child, assetID, encoded, report);
    });
    return;
  }

  if (isArray(value)) {
    const count = arrayCount(value);
    for (let index = 0; index < count; index += 1) {
      walkDesktopTree(arrayGet(value, index), assetID, encoded, report);
    }
  }
}

function updateDesktopTree(root, assetID, encoded, report) {
  walkDesktopTree(root, assetID, encoded, report);
}

function savePlist(path, value) {
  let propertyList = value;
  if (isJavaScriptDictionary(value) || Array.isArray(value)) {
    propertyList = ObjC.wrap(value);
  }
  const data = $.NSPropertyListSerialization.dataWithPropertyListFormatOptionsError(
    propertyList,
    $.NSPropertyListBinaryFormat_v1_0,
    0,
    null
  );
  if (isNilLike(data)) throw new Error("Cannot encode wallpaper store");
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
  if (report.choiceCount === 0) {
    const keys = isDictionary(index) ? dictionaryKeys(index).join(", ") : "non-dictionary root";
    throw new Error("No Desktop wallpaper choices were found. Top-level keys: " + keys);
  }

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
