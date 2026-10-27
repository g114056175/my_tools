(() => {
  // src/site-rules.js
  function webUrl(value) {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }
  var hostOf = (url) => url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  function normalizeSiteRule(value) {
    const raw = String(value ?? "").trim();
    if (!raw || raw.length > 2048) throw Error("Enter a domain or full URL");
    if (!raw.includes("://") && !/[/?#*\s]/.test(raw)) {
      const url2 = webUrl("https://" + raw);
      if (!url2 || url2.username || url2.password || url2.port || raw.includes(":") && !/^\[[a-f0-9:]+\]$/i.test(raw)) throw Error("Invalid domain");
      const host = hostOf(url2);
      if (!host) throw Error("Invalid domain");
      return host;
    }
    const url = webUrl(raw);
    if (!url || url.username || url.password) throw Error("Enter an http or https URL");
    if (url.hostname.includes("*") || url.pathname.includes("*") && (!url.pathname.endsWith("/*") || url.pathname.slice(0, -1).includes("*")) || url.search.includes("*")) throw Error("Only a trailing /* path wildcard is supported");
    url.hostname = hostOf(url);
    url.searchParams.sort();
    return url.href;
  }
  function normalizeSiteRules(raw) {
    if (!Array.isArray(raw)) return [];
    const rules = [];
    for (const item of raw.slice(0, 200)) {
      try {
        const rule = normalizeSiteRule(item);
        if (!rules.includes(rule)) rules.push(rule);
      } catch {
      }
    }
    return rules;
  }
  function validateSiteRules(raw) {
    if (!Array.isArray(raw) || raw.length > 200) throw Error("Up to 200 block rules are supported");
    return [...new Set(raw.map(normalizeSiteRule))];
  }
  function normalizeSiteModes(raw, rules) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const modes = {};
    for (const [value, mode] of Object.entries(raw).slice(0, 200)) {
      try {
        const rule = normalizeSiteRule(value);
        if (mode === "default" && rules.includes(rule)) Object.defineProperty(modes, rule, { value: mode, enumerable: true, configurable: true, writable: true });
      } catch {
      }
    }
    return modes;
  }
  function validateSiteModes(raw, rules) {
    if (raw === void 0) return {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).length > 200) throw Error("Invalid exclusion mode");
    for (const [value, mode] of Object.entries(raw)) if (!["full", "default"].includes(mode) || !rules.includes(normalizeSiteRule(value))) throw Error("Invalid exclusion mode");
    return normalizeSiteModes(raw, rules);
  }
  function matchesSiteRule(url, raw) {
    const host = hostOf(url);
    if (!raw.includes("://")) return host === raw || host.endsWith("." + raw);
    const rule = webUrl(raw);
    if (!rule || hostOf(rule) !== host || rule.port !== url.port || rule.hash && rule.hash !== url.hash) return false;
    const prefix = rule.pathname.endsWith("/*");
    if (prefix ? !url.pathname.startsWith(rule.pathname.slice(0, -1)) : rule.pathname !== url.pathname) return false;
    const youtubeVideo = /(^|\.)youtube\.com$/.test(host) && rule.pathname === "/watch" && rule.searchParams.has("v");
    if (!prefix && !youtubeVideo) {
      const actual = new URL(url);
      actual.searchParams.sort();
      return actual.search === rule.search && actual.hash === rule.hash;
    }
    for (const key of new Set(rule.searchParams.keys())) {
      const expected = rule.searchParams.getAll(key), actual = url.searchParams.getAll(key);
      if (expected.length !== actual.length || expected.some((value, index) => value !== actual[index])) return false;
    }
    return true;
  }
  function siteModeOnUrl(value, rules = [], modes = {}) {
    const url = webUrl(value);
    if (!url) return null;
    let result = null;
    for (const rule of rules) {
      if (!matchesSiteRule(url, rule)) continue;
      if (modes[rule] !== "default") return "full";
      result = "default";
    }
    return result;
  }
  function disabledOnUrl(value, rules = [], modes = {}) {
    return siteModeOnUrl(value, rules, modes) === "full";
  }

  // src/settings.js
  var LEGACY_DEFAULT_STEPS = Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4]);
  var DEFAULT_STEPS = Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4]);
  var DEFAULT_SHORTCUTS = Object.freeze({ slower: "<", faster: ">", reset: ":", preferred: '"', fineSlower: "", fineFaster: "" });
  var DEFAULT_SETTINGS = Object.freeze({ schemaVersion: 3, enabled: true, preferredRate: 2, defaultMode: "off", customRate: 2, steps: DEFAULT_STEPS, qualityEnabled: false, preferredQuality: 1080, shortcuts: DEFAULT_SHORTCUTS, disabledSites: Object.freeze([]), siteModes: Object.freeze({}) });
  function validRate(value) {
    return value !== "" && value !== null && Number.isFinite(Number(value)) && Number(value) >= 0.06 && Number(value) <= 16;
  }
  var normalizeRate = (value) => Math.max(0.0625, Math.min(16, Math.round((Number(value) + Number.EPSILON) * 100) / 100));
  var SHORTCUT_MODIFIERS = Object.freeze(["Ctrl", "Alt", "Meta", "Shift"]);
  var MODIFIER_NAMES = Object.freeze({ ctrl: "Ctrl", control: "Ctrl", alt: "Alt", meta: "Meta", shift: "Shift" });
  function normalizeShortcut(value) {
    if (value === "") return "";
    if (typeof value !== "string") return null;
    let key = value, modifiers = [];
    while (true) {
      const match = /^(Ctrl|Control|Alt|Meta|Shift)\+/i.exec(key);
      if (!match) break;
      const modifier = MODIFIER_NAMES[match[1].toLowerCase()];
      if (modifiers.includes(modifier)) return null;
      modifiers.push(modifier);
      key = key.slice(match[0].length);
    }
    if (Array.from(key).length !== 1 || /\s|[\u0000-\u001f\u007f]/u.test(key)) return null;
    if (/^[A-Za-z]$/.test(key)) key = key.toUpperCase();
    else modifiers = modifiers.filter((modifier) => modifier !== "Shift");
    modifiers.sort((a, b) => SHORTCUT_MODIFIERS.indexOf(a) - SHORTCUT_MODIFIERS.indexOf(b));
    return [...modifiers, key].join("+");
  }
  function normalizeShortcuts(raw = {}) {
    const shortcuts = { ...DEFAULT_SHORTCUTS };
    for (const action of Object.keys(shortcuts)) {
      if (raw?.[action] === void 0) continue;
      const normalized = normalizeShortcut(raw[action]);
      if (normalized !== null) shortcuts[action] = normalized;
    }
    const assigned = Object.values(shortcuts).filter(Boolean);
    return new Set(assigned).size === assigned.length ? shortcuts : { ...DEFAULT_SHORTCUTS };
  }
  function hasLegacyDefaultSteps(raw) {
    return Number(raw?.schemaVersion ?? 0) < 3 && Array.isArray(raw?.steps) && raw.steps.length === LEGACY_DEFAULT_STEPS.length && raw.steps.every((value, index) => typeof value === "number" && value === LEGACY_DEFAULT_STEPS[index]);
  }
  function normalizeSteps(value) {
    const values = Array.isArray(value) ? value : String(value ?? "").trim().split(/[\s,，、]+/);
    return [...new Set(values.filter(validRate).map((v) => normalizeRate(v)))].sort((a, b) => a - b).slice(0, 64);
  }
  function normalizeSettings(raw = {}) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
    const steps = normalizeSteps(raw.steps ?? DEFAULT_STEPS), oldPreferred = raw.defaultMode === "preferred", shortcuts = normalizeShortcuts(raw.shortcuts), disabledSites = normalizeSiteRules(raw.disabledSites);
    if (hasLegacyDefaultSteps(raw)) steps.splice(0, steps.length, ...normalizeSteps([...steps, 1.75]));
    return {
      schemaVersion: 3,
      enabled: raw.enabled !== false,
      preferredRate: validRate(raw.preferredRate) ? normalizeRate(raw.preferredRate) : 2,
      defaultMode: ["off", "follow", "custom"].includes(raw.defaultMode) ? raw.defaultMode : oldPreferred ? "custom" : "off",
      customRate: oldPreferred && validRate(raw.preferredRate) ? normalizeRate(raw.preferredRate) : validRate(raw.customRate) ? normalizeRate(raw.customRate) : 2,
      steps: steps.length ? steps : [...DEFAULT_STEPS],
      qualityEnabled: raw.qualityEnabled === true,
      preferredQuality: Number.isInteger(Number(raw.preferredQuality)) && (Number(raw.preferredQuality) === 0 || Number(raw.preferredQuality) >= 100 && Number(raw.preferredQuality) <= 8640) ? Number(raw.preferredQuality) : 1080,
      shortcuts,
      disabledSites,
      siteModes: normalizeSiteModes(raw.siteModes, disabledSites)
    };
  }
  function validateSettings(raw) {
    if (!validRate(raw.preferredRate) || !validRate(raw.customRate)) throw Error("Enter a speed between 0.06 and 16");
    const steps = validateSteps(raw.steps);
    const shortcuts = { ...DEFAULT_SHORTCUTS };
    for (const action of Object.keys(shortcuts)) {
      if (raw.shortcuts?.[action] === void 0) continue;
      const normalized = normalizeShortcut(raw.shortcuts[action]);
      if (normalized === null) throw Error("Use a character key with optional modifiers");
      shortcuts[action] = normalized;
    }
    const keys = Object.values(shortcuts).filter(Boolean);
    if (new Set(keys).size !== keys.length) throw Error("Shortcuts must be unique");
    const disabledSites = validateSiteRules(raw.disabledSites ?? []), siteModes = validateSiteModes(raw.siteModes, disabledSites);
    return normalizeSettings({ ...raw, steps, shortcuts, disabledSites, siteModes });
  }
  function validateSteps(raw) {
    const values = Array.isArray(raw) ? raw : String(raw ?? "").trim().split(/[\s,，、]+/);
    if (!values.length || values.length > 64 || values.some((value) => !validRate(value))) throw Error("Use 1\u201364 ticks between 0.06 and 16");
    return normalizeSteps(values);
  }
  function rankTargets(items, pinned2) {
    const connected = items.filter((item) => item.connected !== false);
    if (connected.length <= 1) return connected;
    return connected.sort((a, b) => Number(b.key === pinned2) - Number(a.key === pinned2) || Number(!!b.playing) - Number(!!a.playing) || (a.playing && b.playing ? Number(!!b.visible) - Number(!!a.visible) : 0) || (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0) || Number(!!b.visible) - Number(!!a.visible) || (b.visibleArea ?? b.area ?? 0) - (a.visibleArea ?? a.area ?? 0));
  }

  // extension/locale-zh.js
  var ZH_MESSAGES = Object.freeze({
    "Prefs": "\u504F\u597D",
    "Keys": "\u5FEB\u6377",
    "Exclude": "\u9664\u5916",
    "Quality": "\u756B\u8CEA\u9396\u5B9A",
    "Preferred": "\u504F\u597D\u901F\u5EA6",
    "Prev tick": "\u4E0A\u4E00\u523B\u5EA6",
    "Fine down": "\u7D30\u8ABF\u6E1B\u901F",
    "Fine up": "\u7D30\u8ABF\u52A0\u901F",
    "Reset 1\xD7": "\u9084\u539F 1\xD7",
    "Loading": "\u8F09\u5165\u4E2D",
    "Loading\u2026": "\u8F09\u5165\u4E2D\u2026",
    "Settings": "\u8A2D\u5B9A",
    "Preferences": "\u504F\u597D",
    "Ticks": "\u523B\u5EA6",
    "Shortcuts": "\u5FEB\u6377\u9375",
    "Exclusions": "\u9664\u5916",
    "Playback options": "\u64AD\u653E\u9078\u9805",
    "Back": "\u8FD4\u56DE",
    "Interface": "\u4ECB\u9762",
    "Appearance": "\u5916\u89C0",
    "Language": "\u8A9E\u8A00",
    "Light": "\u6DFA\u8272",
    "Dark": "\u6DF1\u8272",
    "Chinese": "\u4E2D\u6587",
    "Traditional Chinese": "\u7E41\u9AD4\u4E2D\u6587",
    "Default speed": "\u901F\u5EA6\u9810\u8A2D",
    "Default": "\u901F\u5EA6\u9810\u8A2D",
    "Full": "\u5B8C\u6574\u505C\u7528",
    "Off": "\u95DC\u9589",
    "Last": "\u8DDF\u96A8",
    "Fixed": "\u6307\u5B9A",
    "Fixed speed": "\u6307\u5B9A\u901F\u5EA6",
    "Quality lock": "\u756B\u8CEA\u9396\u5B9A",
    "Preferred speed": "\u504F\u597D\u901F\u5EA6",
    "Playback speed when a video first starts": "\u9996\u6B21\u8F09\u5165\u5F71\u7247\u7684\u64AD\u653E\u901F\u5EA6",
    "Use the last speed from the previous video": "\u8DDF\u96A8\u4E0A\u4E00\u90E8\u5F71\u7247\u6700\u5F8C\u4F7F\u7528\u7684\u901F\u5EA6",
    "Start each video at the fixed speed": "\u6BCF\u90E8\u5F71\u7247\u8F09\u5165\u6642\u4F7F\u7528\u6307\u5B9A\u901F\u5EA6",
    "Use the preferred-speed shortcut to switch to this speed": "\u6309\u4E0B\u504F\u597D\u5FEB\u6377\u9375\uFF0C\u8DF3\u81F3\u504F\u597D\u901F\u5EA6",
    "Switch to dark theme": "\u5207\u63DB\u6DF1\u8272\u5916\u89C0",
    "Switch to light theme": "\u5207\u63DB\u6DFA\u8272\u5916\u89C0",
    "Could not save appearance": "\u5916\u89C0\u4FDD\u5B58\u5931\u6557",
    "Enable VideoSpeed": "\u555F\u7528 VideoSpeed",
    "Disable VideoSpeed": "\u95DC\u9589 VideoSpeed",
    "Disabled": "\u5DF2\u95DC\u9589",
    "Disabled on this site": "\u6B64\u7DB2\u7AD9\u5DF2\u505C\u7528",
    "VideoSpeed (disabled)": "VideoSpeed\uFF08\u5DF2\u95DC\u9589\uFF09",
    "VideoSpeed (disabled on this site)": "VideoSpeed\uFF08\u6B64\u7DB2\u7AD9\u5DF2\u505C\u7528\uFF09",
    "No video found": "\u672A\u53D6\u5F97\u5F71\u7247\u8CC7\u8A0A",
    "Select a video on the page": "\u5728\u7DB2\u9801\u9078\u53D6\u5F71\u7247",
    "Select a video \xB7 Esc to cancel": "\u9EDE\u9078\u5F71\u7247 \xB7 Esc \u53D6\u6D88",
    "Video": "\u5F71\u7247",
    "Video {number}": "\u5F71\u7247 {number}",
    "Refresh video": "\u66F4\u65B0\u5F71\u7247\u8CC7\u8A0A",
    "Playback speed": "\u64AD\u653E\u901F\u5EA6",
    "Current playback speed": "\u76EE\u524D\u64AD\u653E\u901F\u5EA6",
    "Playback speed slider": "\u64AD\u653E\u901F\u5EA6\u62C9\u689D",
    "Settings tabs": "\u8A2D\u5B9A\u5206\u985E",
    "Previous tick": "\u4E0A\u4E00\u500B\u523B\u5EA6",
    "Next tick": "\u4E0B\u4E00\u500B\u523B\u5EA6",
    "Fine decrease": "\u964D\u4F4E\u4E00\u5C0F\u683C",
    "Fine increase": "\u63D0\u9AD8\u4E00\u5C0F\u683C",
    "Previous step": "\u4E0A\u4E00\u523B\u5EA6",
    "Next step": "\u4E0B\u4E00\u523B\u5EA6",
    "Fine slower": "\u7D30\u8ABF\u6E1B\u901F",
    "Fine faster": "\u7D30\u8ABF\u52A0\u901F",
    "Reset to 1\xD7": "\u9084\u539F 1\xD7",
    "Set speed to {rate}\xD7": "\u5957\u7528 {rate} \u500D\u901F",
    "{rate}\xD7": "{rate} \u500D\u901F",
    "Reset defaults": "\u6062\u5FA9\u9810\u8A2D",
    "Cancel": "\u53D6\u6D88",
    "Reset": "\u6062\u5FA9",
    "Reset ticks?": "\u6062\u5FA9\u9810\u8A2D\u523B\u5EA6\uFF1F",
    "Reset shortcuts?": "\u6062\u5FA9\u9810\u8A2D\u5FEB\u6377\u9375\uFF1F",
    "Speed ticks": "\u901F\u5EA6\u523B\u5EA6",
    "Press a key": "\u8ACB\u6309\u6309\u9375",
    "Unbound": "\u672A\u8A2D\u5B9A",
    "Set shortcut: {action}": "\u8A2D\u5B9A{action}\u5FEB\u6377\u9375",
    "Clear shortcut: {action}": "\u6E05\u9664{action}\u5FEB\u6377\u9375",
    "Already assigned to \u201C{action}\u201D": "\u5DF2\u7528\u65BC\u300C{action}\u300D",
    "Domain or video URL": "\u7DB2\u57DF\u6216\u5F71\u7247\u7DB2\u5740",
    "Add a blocked domain or video URL": "\u65B0\u589E\u505C\u7528\u7DB2\u57DF\u6216\u5F71\u7247\u7DB2\u5740",
    "Add block rule": "\u65B0\u589E\u505C\u7528\u898F\u5247",
    "Remove {rule}": "\u79FB\u9664 {rule}",
    "Best": "\u6700\u4F73",
    "Best ({height}p)": "\u6700\u4F73\uFF08{height}p\uFF09",
    "{height}p (Auto)": "{height}p\uFF08\u81EA\u52D5\uFF09",
    "Preferred {wanted}p; this video uses {effective}p": "\u504F\u597D {wanted}p\uFF1B\u6B64\u5F71\u7247\u4F7F\u7528 {effective}p",
    "Could not connect": "\u7121\u6CD5\u9023\u7DDA",
    "Open a page with a video first": "\u8ACB\u5148\u958B\u555F\u6709\u5F71\u7247\u7684\u7DB2\u9801",
    "Video changed; select it again": "\u5F71\u7247\u5DF2\u5207\u63DB\uFF0C\u8ACB\u91CD\u65B0\u9078\u53D6",
    "Return to the video tab first": "\u8ACB\u5148\u5207\u56DE\u5F71\u7247\u5206\u9801",
    "VideoSpeed is disabled": "VideoSpeed \u5DF2\u95DC\u9589",
    "Video did not respond; reload the page": "\u5F71\u7247\u672A\u56DE\u61C9\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u7DB2\u9801",
    "Could not connect to the video": "\u5F71\u7247\u63A7\u5236\u672A\u80FD\u9023\u7DDA",
    "Player did not apply this speed": "\u64AD\u653E\u5668\u672A\u5957\u7528\u6B64\u901F\u5EA6",
    "Player does not accept this speed": "\u64AD\u653E\u5668\u4E0D\u63A5\u53D7\u6B64\u901F\u5EA6",
    "Invalid playback speed": "\u7121\u6548\u7684\u64AD\u653E\u901F\u5EA6",
    "Playback speed unavailable": "\u7121\u6CD5\u8B80\u53D6\u64AD\u653E\u901F\u5EA6",
    "The site keeps overriding playback speed": "\u7DB2\u7AD9\u6301\u7E8C\u6539\u5BEB\u64AD\u653E\u901F\u5EA6",
    "Saved speed unavailable": "\u7121\u6CD5\u8B80\u53D6\u500D\u901F\u8A18\u61B6",
    "Video state unavailable": "\u7121\u6CD5\u8B80\u53D6\u5F71\u7247\u72C0\u614B",
    "Live streams do not support playback speed": "\u6B64\u5373\u6642\u4E32\u6D41\u4E0D\u652F\u63F4\u500D\u901F",
    "Speed range: 0.06\u201316\xD7": "\u901F\u5EA6\u7BC4\u570D\uFF1A0.06\u201316\xD7",
    "Speed range: 0.06\u201316": "\u901F\u5EA6\u7BC4\u570D\uFF1A0.06\u201316",
    "Enter a speed between 0.06 and 16": "\u901F\u5EA6\u8ACB\u586B\u5165 0.06\uFF5E16 \u4E4B\u9593\u7684\u6578\u5B57",
    "Use 1\u201364 ticks between 0.06 and 16": "\u523B\u5EA6\u7BC4\u570D\uFF1A0.06\u201316\uFF0C\u6700\u591A 64 \u500B",
    "Use a character key with optional modifiers": "\u8ACB\u4F7F\u7528\u5B57\u5143\u9375\u6216\u4FEE\u98FE\u9375\u7D44\u5408",
    "Shortcuts must be unique": "\u5DF2\u8A2D\u5B9A\u7684\u5FEB\u6377\u9375\u4E0D\u53EF\u91CD\u8907",
    "Enter a domain or full URL": "\u8ACB\u8F38\u5165\u7DB2\u57DF\u6216\u5B8C\u6574\u7DB2\u5740",
    "Invalid domain": "\u7DB2\u57DF\u683C\u5F0F\u4E0D\u6B63\u78BA",
    "Enter an http or https URL": "\u8ACB\u8F38\u5165 http \u6216 https \u7DB2\u5740",
    "Only a trailing /* path wildcard is supported": "\u50C5\u652F\u63F4\u7DB2\u5740\u8DEF\u5F91\u7D50\u5C3E\u7684 /*",
    "Up to 200 block rules are supported": "\u6700\u591A\u53EF\u8A2D\u5B9A 200 \u689D\u505C\u7528\u898F\u5247",
    "Invalid exclusion mode": "\u7121\u6548\u7684\u9664\u5916\u985E\u578B",
    "Skip automatic speed and quality settings": "\u7565\u904E\u81EA\u52D5\u500D\u901F\u8207\u756B\u8CEA\u8A2D\u5B9A",
    "Disable all features on this site": "\u505C\u7528\u6B64\u7DB2\u7AD9\u6240\u6709\u529F\u80FD",
    "Could not save: {message}": "\u7121\u6CD5\u5132\u5B58\uFF1A{message}",
    "Invalid saved playback speed data": "\u7121\u6548\u7684\u64AD\u653E\u901F\u5EA6\u8A18\u61B6\u8CC7\u6599",
    "Saved speed revision limit reached": "\u64AD\u653E\u901F\u5EA6\u8A18\u61B6\u7248\u672C\u5DF2\u9054\u4E0A\u9650",
    "Saved speed could not be confirmed": "\u64AD\u653E\u901F\u5EA6\u8A18\u61B6\u5C1A\u672A\u78BA\u8A8D",
    "Unsupported action": "\u4E0D\u652F\u63F4\u7684\u64CD\u4F5C",
    "Operation failed": "\u64CD\u4F5C\u5931\u6557",
    "An unexpected error occurred": "\u767C\u751F\u672A\u9810\u671F\u7684\u932F\u8AA4"
  });
  var LEGACY_MESSAGES = Object.freeze({
    "\u7121\u6CD5\u9023\u7DDA": "Could not connect",
    "\u8ACB\u5148\u958B\u555F\u6709\u5F71\u7247\u7684\u7DB2\u9801": "Open a page with a video first",
    "\u5F71\u7247\u5DF2\u5207\u63DB\uFF0C\u8ACB\u91CD\u65B0\u9078\u53D6": "Video changed; select it again",
    "\u8ACB\u5148\u5207\u56DE\u5F71\u7247\u5206\u9801": "Return to the video tab first",
    "VideoSpeed \u5DF2\u95DC\u9589": "VideoSpeed is disabled",
    "\u5F71\u7247\u672A\u56DE\u61C9\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u7DB2\u9801": "Video did not respond; reload the page",
    "\u5F71\u7247\u63A7\u5236\u672A\u80FD\u9023\u7DDA": "Could not connect to the video",
    "\u64AD\u653E\u5668\u672A\u5957\u7528\u6B64\u901F\u5EA6": "Player did not apply this speed",
    "\u64AD\u653E\u5668\u4E0D\u63A5\u53D7\u6B64\u901F\u5EA6": "Player does not accept this speed",
    "\u7121\u6548\u7684\u64AD\u653E\u901F\u5EA6": "Invalid playback speed",
    "\u7121\u6CD5\u8B80\u53D6\u64AD\u653E\u901F\u5EA6": "Playback speed unavailable",
    "\u7DB2\u7AD9\u6301\u7E8C\u6539\u5BEB\u64AD\u653E\u901F\u5EA6": "The site keeps overriding playback speed",
    "\u7121\u6CD5\u8B80\u53D6\u500D\u901F\u8A18\u61B6": "Saved speed unavailable",
    "\u7121\u6CD5\u8B80\u53D6\u5F71\u7247\u72C0\u614B": "Video state unavailable",
    "\u6B64\u5373\u6642\u4E32\u6D41\u4E0D\u652F\u63F4\u500D\u901F": "Live streams do not support playback speed",
    "\u901F\u5EA6\u7BC4\u570D\uFF1A0.06\u201316\xD7": "Speed range: 0.06\u201316\xD7",
    "\u901F\u5EA6\u7BC4\u570D\uFF1A0.06\u201316": "Speed range: 0.06\u201316",
    "\u901F\u5EA6\u8ACB\u586B\u5165 0.06\uFF5E16 \u4E4B\u9593\u7684\u6578\u5B57": "Enter a speed between 0.06 and 16",
    "\u523B\u5EA6\u7BC4\u570D\uFF1A0.06\u201316\uFF0C\u6700\u591A 64 \u500B": "Use 1\u201364 ticks between 0.06 and 16",
    "\u5FEB\u6377\u9375\u8ACB\u4F7F\u7528\u55AE\u4E00\u5B57\u5143\u6216\u4FEE\u98FE\u9375\u7D44\u5408": "Use a character key with optional modifiers",
    "\u8ACB\u4F7F\u7528\u5B57\u5143\u9375\u6216\u4FEE\u98FE\u9375\u7D44\u5408": "Use a character key with optional modifiers",
    "\u5DF2\u8A2D\u5B9A\u7684\u5FEB\u6377\u9375\u4E0D\u53EF\u91CD\u8907": "Shortcuts must be unique",
    "\u8ACB\u8F38\u5165\u7DB2\u57DF\u6216\u5B8C\u6574\u7DB2\u5740": "Enter a domain or full URL",
    "\u7DB2\u57DF\u683C\u5F0F\u4E0D\u6B63\u78BA": "Invalid domain",
    "\u8ACB\u8F38\u5165 http \u6216 https \u7DB2\u5740": "Enter an http or https URL",
    "\u50C5\u652F\u63F4\u7DB2\u5740\u8DEF\u5F91\u7D50\u5C3E\u7684 /*": "Only a trailing /* path wildcard is supported",
    "\u6700\u591A\u53EF\u8A2D\u5B9A 200 \u689D\u505C\u7528\u898F\u5247": "Up to 200 block rules are supported",
    "\u7121\u6548\u7684\u9664\u5916\u985E\u578B": "Invalid exclusion mode",
    "\u4FDD\u5B58\u5931\u6557\uFF1A": "Could not save: ",
    "\u4E0D\u652F\u63F4\u7684\u64CD\u4F5C": "Unsupported action",
    "\u64CD\u4F5C\u5931\u6557": "Operation failed",
    "\u7121\u6548\u7684\u64AD\u653E\u901F\u5EA6\u8A18\u61B6\u8CC7\u6599": "Invalid saved playback speed data",
    "\u64AD\u653E\u901F\u5EA6\u8A18\u61B6\u7248\u672C\u5DF2\u9054\u4E0A\u9650": "Saved speed revision limit reached",
    "\u64AD\u653E\u901F\u5EA6\u8A18\u61B6\u5C1A\u672A\u78BA\u8A8D": "Saved speed could not be confirmed"
  });
  function legacyChineseMessageToEnglish(message) {
    const text = String(message ?? "");
    if (LEGACY_MESSAGES[text]) return LEGACY_MESSAGES[text];
    if (text.startsWith("\u4FDD\u5B58\u5931\u6557\uFF1A")) {
      const detail = text.slice(5), translated = legacyChineseMessageToEnglish(detail);
      return "Could not save: " + (translated ?? (/[\u3400-\u9fff]/u.test(detail) ? "An unexpected error occurred" : detail));
    }
    const used = text.match(/^已用於「(.+)」$/);
    if (used) return "Already assigned to \u201C" + (LEGACY_MESSAGES[used[1]] || ({ \u4E0A\u4E00\u523B\u5EA6: "Previous step", \u4E0B\u4E00\u523B\u5EA6: "Next step", \u7D30\u8ABF\u6E1B\u901F: "Fine slower", \u7D30\u8ABF\u52A0\u901F: "Fine faster", "\u9084\u539F 1\xD7": "Reset to 1\xD7", "\u504F\u597D\u901F\u5EA6": "Preferred speed" }[used[1]] || used[1])) + "\u201D";
    const best = text.match(/^最佳（(\d+)p）$/);
    if (best) return `Best (${best[1]}p)`;
    const automatic = text.match(/^(\d+)p（自動）$/);
    if (automatic) return `${automatic[1]}p (Auto)`;
    const quality = text.match(/^偏好 (\d+)p；此影片使用 (\d+)p$/);
    if (quality) return `Preferred ${quality[1]}p; this video uses ${quality[2]}p`;
    return null;
  }

  // extension/i18n.js
  var UNKNOWN_ERROR = "An unexpected error occurred";
  var containsCjk = (value) => /[\u3400-\u9fff]/u.test(value);
  var interpolate = (text, values = {}) => text.replace(/\{(\w+)\}/g, (match, name) => values[name] === void 0 ? match : String(values[name]));
  function resolveLanguage(value) {
    return value === "zh-Hant" ? "zh-Hant" : "en";
  }
  function translate(language2, key, values = {}) {
    let text = String(key ?? "");
    const legacy = legacyChineseMessageToEnglish(text);
    if (legacy) text = legacy;
    if (language2 !== "zh-Hant" && containsCjk(text)) text = UNKNOWN_ERROR;
    if (language2 === "zh-Hant") text = ZH_MESSAGES[text] ?? text;
    return interpolate(text, values);
  }

  // src/rate-memory.js
  var MIN_RATE = 0.06;
  var MAX_RATE = 16;
  var SOURCES = /* @__PURE__ */ new Set(["command", "default", "native"]);
  var rateValue = (value) => typeof value === "number" && Number.isFinite(value) && value >= MIN_RATE && value <= MAX_RATE;
  var revisionValue = (value) => Number.isSafeInteger(value) && value >= 0;
  var copy = (state) => ({ lastRate: state.lastRate, rateRevision: state.rateRevision });
  var stored = (state) => ({ lastRate: state.lastRate, lastRateRevision: state.rateRevision });
  var writeIdValue = (value) => Number.isSafeInteger(value) && value > 0;
  var sessionIdValue = (value) => typeof value === "string" && value.length > 0 && value.length <= 128;
  var senderKey = (sender, sessionId) => JSON.stringify([sender.tab.id, sender.frameId, String(sender.documentId || ""), sessionId]);
  function validRateWriteMessage(message) {
    return !!message && rateValue(message.rate) && SOURCES.has(message.source) && sessionIdValue(message.rateSessionId) && writeIdValue(message.rateWriteId);
  }
  var RateWriteLedger = class {
    constructor(maxEntries = 512) {
      this.maxEntries = Number.isSafeInteger(maxEntries) && maxEntries > 0 ? maxEntries : 512;
      this.entries = /* @__PURE__ */ new Map();
    }
    begin(message, sender) {
      if (!validRateWriteMessage(message) || !Number.isInteger(sender?.tab?.id) || !Number.isInteger(sender?.frameId)) return null;
      const key = senderKey(sender, message.rateSessionId), writeId = message.rateWriteId;
      let entry = this.entries.get(key);
      if (entry) {
        this.entries.delete(key);
        this.entries.set(key, entry);
      }
      if (entry && writeId < entry.writeId) return { status: "stale", isCurrent: () => false, complete: () => false };
      if (entry && writeId === entry.writeId && (entry.rate !== message.rate || entry.source !== message.source)) return { status: "conflict", isCurrent: () => false, complete: () => false };
      if (!entry || writeId > entry.writeId) {
        entry = { tabId: sender.tab.id, writeId, rate: message.rate, source: message.source, completed: false };
        this.entries.set(key, entry);
        while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
      }
      const current = () => this.entries.get(key) === entry && entry.writeId === writeId;
      return { status: entry.completed ? "completed" : "pending", isCurrent: current, complete() {
        if (!current()) return false;
        entry.completed = true;
        return true;
      } };
    }
    forgetTab(tabId) {
      for (const [key, entry] of this.entries) if (entry.tabId === tabId) this.entries.delete(key);
    }
  };
  var RateMemory = class {
    constructor(storage) {
      this.storage = storage;
      this.state = null;
      this.tail = Promise.resolve();
    }
    enqueue(operation) {
      const result = this.tail.then(operation, operation);
      this.tail = result.then(() => void 0, () => void 0);
      return result;
    }
    async ensureLoaded() {
      if (this.state) return this.state;
      const data = await this.storage.get(["lastRate", "lastRateRevision"]);
      const hasRate = Object.hasOwn(data || {}, "lastRate"), hasRevision = Object.hasOwn(data || {}, "lastRateRevision");
      let state, seed = false;
      if (!hasRate && !hasRevision) {
        state = { lastRate: 1, rateRevision: 0 };
        seed = true;
      } else if (rateValue(data?.lastRate) && !hasRevision) {
        state = { lastRate: data.lastRate, rateRevision: 0 };
        seed = true;
      } else if (rateValue(data?.lastRate) && revisionValue(data?.lastRateRevision)) state = { lastRate: data.lastRate, rateRevision: data.lastRateRevision };
      else throw Error("Invalid saved playback speed data");
      if (seed) await this.storage.set(stored(state));
      this.state = state;
      return state;
    }
    load() {
      return this.enqueue(async () => copy(await this.ensureLoaded()));
    }
    read() {
      return this.enqueue(async () => copy(await this.ensureLoaded()));
    }
    observeChanges(changes, area = "local") {
      const revisionChange = changes?.lastRateRevision, eventRevision = revisionChange?.newValue;
      const rateChange = changes?.lastRate, hasRateChange = Object.hasOwn(changes || {}, "lastRate");
      if (area !== "local" || !revisionChange || !revisionValue(eventRevision) || hasRateChange && !rateValue(rateChange?.newValue)) return Promise.resolve(null);
      return this.enqueue(async () => {
        const current = await this.ensureLoaded();
        if (eventRevision <= current.rateRevision) return copy(current);
        const data = await this.storage.get(["lastRate", "lastRateRevision"]);
        if (!rateValue(data?.lastRate) || !revisionValue(data?.lastRateRevision) || data.lastRateRevision < eventRevision) return copy(current);
        const eventRate = hasRateChange ? rateChange.newValue : current.lastRate;
        if (data.lastRate !== eventRate) return copy(current);
        this.state = { lastRate: data.lastRate, rateRevision: data.lastRateRevision };
        return copy(this.state);
      });
    }
    remember(rate, source, { isCurrent = () => true } = {}) {
      if (!rateValue(rate) || !SOURCES.has(source)) return Promise.resolve(null);
      const stillCurrent = () => {
        try {
          return isCurrent() === true;
        } catch {
          return false;
        }
      };
      return this.enqueue(async () => {
        if (!stillCurrent()) return null;
        const currentState = await this.ensureLoaded();
        if (!stillCurrent()) return null;
        if (currentState.lastRate === rate) return copy(currentState);
        if (currentState.rateRevision >= Number.MAX_SAFE_INTEGER) throw Error("Saved speed revision limit reached");
        const next = { lastRate: rate, rateRevision: currentState.rateRevision + 1 };
        if (!stillCurrent()) return null;
        try {
          await this.storage.set(stored(next));
        } catch (error) {
          this.state = null;
          throw error;
        }
        if (!stillCurrent()) {
          this.state = null;
          return null;
        }
        this.state = next;
        return copy(next);
      });
    }
  };

  // src/tab-activity.js
  var TAB_ACTIVITY_GRACE_MS = 1e4;
  var validId = (value) => Number.isInteger(value) && value >= 0;
  function replayTabActivityEvents(activity, events, { windowIdNone = -1 } = {}) {
    const affected = /* @__PURE__ */ new Set();
    for (const event of events) {
      if (!event || !Number.isFinite(event.at)) continue;
      let changed = [];
      if (event.type === "activated") changed = activity.setActiveTab(event.windowId, event.tabId, event.at);
      else if (event.type === "focus") changed = activity.setFocusedWindow(event.windowId === windowIdNone ? null : event.windowId, event.at);
      for (const tabId of changed) affected.add(tabId);
    }
    return [...affected];
  }
  var TabActivity = class {
    constructor({ now = () => Date.now(), graceMs = TAB_ACTIVITY_GRACE_MS } = {}) {
      this.now = now;
      this.graceMs = graceMs;
      this.focusedWindowId = null;
      this.focusedTabId = null;
      this.revision = 0;
      this.untilByTab = /* @__PURE__ */ new Map();
      this.activeByWindow = /* @__PURE__ */ new Map();
    }
    restore(snapshot) {
      this.focusedWindowId = validId(snapshot?.focusedWindowId) ? snapshot.focusedWindowId : null;
      this.focusedTabId = this.focusedWindowId !== null && validId(snapshot?.focusedTabId) ? snapshot.focusedTabId : null;
      this.revision = Number.isSafeInteger(snapshot?.revision) && snapshot.revision >= 0 ? snapshot.revision : 0;
      this.untilByTab = /* @__PURE__ */ new Map();
      const entries = Object.entries(snapshot?.untilByTab || {});
      for (const [key, value] of entries) {
        const tabId = Number(key);
        if (validId(tabId) && Number.isFinite(value) && value > 0) this.untilByTab.set(tabId, value);
      }
      this.activeByWindow = /* @__PURE__ */ new Map();
      const activeEntries = Object.entries(snapshot?.activeByWindow || {});
      for (const [key, value] of activeEntries) {
        const windowId = Number(key), tabId = Number(value);
        if (validId(windowId) && validId(tabId)) this.activeByWindow.set(windowId, tabId);
      }
      if (this.focusedWindowId !== null && this.focusedTabId !== null) this.activeByWindow.set(this.focusedWindowId, this.focusedTabId);
      if (this.focusedTabId !== null) this.untilByTab.delete(this.focusedTabId);
      return this;
    }
    snapshot(now = this.now()) {
      this.prune(now);
      return { version: 1, focusedWindowId: this.focusedWindowId, focusedTabId: this.focusedTabId, revision: this.revision, untilByTab: Object.fromEntries(this.untilByTab), activeByWindow: Object.fromEntries(this.activeByWindow) };
    }
    activity(tabId, now = this.now()) {
      if (!validId(tabId)) return { focused: false, until: 0, revision: this.revision };
      const focused = this.focusedTabId === tabId;
      const until = focused ? 0 : this.untilByTab.get(tabId) || 0;
      return { focused, until: until > now ? until : 0, revision: this.revision };
    }
    setFocusedWindow(windowId, now = this.now()) {
      const nextWindowId = validId(windowId) ? windowId : null;
      if (nextWindowId === this.focusedWindowId) {
        const cachedTabId2 = nextWindowId === null ? null : this.activeByWindow.get(nextWindowId);
        return this.focusedTabId === null && validId(cachedTabId2) ? this.setActiveTab(nextWindowId, cachedTabId2, now) : [];
      }
      const affected = [];
      this.blurFocusedTab(now, affected);
      this.focusedWindowId = nextWindowId;
      this.focusedTabId = null;
      this.revision++;
      const cachedTabId = nextWindowId === null ? null : this.activeByWindow.get(nextWindowId);
      if (validId(cachedTabId)) for (const tabId of this.setActiveTab(nextWindowId, cachedTabId, now)) affected.push(tabId);
      return affected;
    }
    setActiveTab(windowId, tabId, now = this.now()) {
      if (!validId(windowId) || !validId(tabId)) return [];
      this.rememberActiveTab(windowId, tabId);
      if (windowId !== this.focusedWindowId) return [];
      if (this.focusedTabId === tabId) return [];
      const affected = [];
      this.blurFocusedTab(now, affected);
      this.focusedTabId = tabId;
      this.untilByTab.delete(tabId);
      this.revision++;
      affected.push(tabId);
      return affected;
    }
    rememberActiveTab(windowId, tabId) {
      if (!validId(windowId) || !validId(tabId) || this.activeByWindow.get(windowId) === tabId) return false;
      this.activeByWindow.set(windowId, tabId);
      return true;
    }
    reconcile({ windowId = null, tabId = null } = {}, now = this.now()) {
      const affected = /* @__PURE__ */ new Set();
      if (validId(windowId) && validId(tabId)) this.rememberActiveTab(windowId, tabId);
      for (const changedTabId of this.setFocusedWindow(windowId, now)) affected.add(changedTabId);
      if (validId(windowId) && validId(tabId)) for (const changedTabId of this.setActiveTab(windowId, tabId, now)) affected.add(changedTabId);
      else if (this.focusedTabId !== null) {
        for (const changedTabId of this.setFocusedWindow(null, now)) affected.add(changedTabId);
      }
      return [...affected];
    }
    forget(tabId) {
      if (!validId(tabId)) return false;
      let had = this.untilByTab.delete(tabId);
      for (const [windowId, cachedTabId] of this.activeByWindow) if (cachedTabId === tabId) {
        this.activeByWindow.delete(windowId);
        had = true;
      }
      if (this.focusedTabId === tabId) {
        this.focusedTabId = null;
        this.revision++;
        return true;
      }
      return had;
    }
    forgetWindow(windowId, now = this.now()) {
      if (!validId(windowId)) return [];
      this.activeByWindow.delete(windowId);
      return this.focusedWindowId === windowId ? this.setFocusedWindow(null, now) : [];
    }
    prune(now = this.now()) {
      for (const [tabId, until] of this.untilByTab) if (until <= now || tabId === this.focusedTabId) this.untilByTab.delete(tabId);
      for (const [windowId, tabId] of this.activeByWindow) if (!validId(windowId) || !validId(tabId)) this.activeByWindow.delete(windowId);
      if (this.focusedWindowId !== null && this.focusedTabId !== null) this.activeByWindow.set(this.focusedWindowId, this.focusedTabId);
    }
    blurFocusedTab(now, affected) {
      const tabId = this.focusedTabId;
      if (tabId === null) return;
      this.focusedTabId = null;
      this.untilByTab.set(tabId, now + this.graceMs);
      affected.push(tabId);
    }
  };

  // src/background.js
  var SCOPE = "video-control";
  var VERSION = "0.6.13";
  var frames = /* @__PURE__ */ new Map();
  var pinned = /* @__PURE__ */ new Map();
  var ports = /* @__PURE__ */ new Map();
  var contentPorts = /* @__PURE__ */ new Set();
  var announced = /* @__PURE__ */ new Map();
  var markerQueues = /* @__PURE__ */ new Map();
  var markedTargets = /* @__PURE__ */ new Map();
  var refreshTasks = /* @__PURE__ */ new Map();
  var keyOf = (frame, id) => frame.frameId + ":" + (frame.documentId || "") + ":" + id;
  var optionsOf = (target) => target.documentId ? { documentId: target.documentId } : { frameId: target.frameId };
  var tabGenerations = /* @__PURE__ */ new Map();
  var frameGenerations = /* @__PURE__ */ new Map();
  var navigationSerial = 0;
  function tabGeneration(tabId) {
    if (!tabGenerations.has(tabId)) tabGenerations.set(tabId, ++navigationSerial);
    return tabGenerations.get(tabId);
  }
  var frameGeneration = (tabId, frameId) => frameGenerations.get(tabId)?.get(frameId) || 0;
  var selectionDeliveries = /* @__PURE__ */ new Map();
  function clearSelectionDelivery(tabId) {
    const delivery = selectionDeliveries.get(tabId);
    clearTimeout(delivery?.timer);
    selectionDeliveries.delete(tabId);
  }
  function sendSelection(tabId, message, options) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 1e3);
      Promise.resolve().then(() => chrome.tabs.sendMessage(tabId, message, options)).then((response) => {
        clearTimeout(timer);
        resolve(response);
      }, () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }
  function popupRefresh(task) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 1e3);
      Promise.resolve(task).then(() => {
        clearTimeout(timer);
        resolve();
      }, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  var settingsCache;
  var settingsTask;
  var powerSignature;
  var powerQueue = Promise.resolve();
  var settingsWrites = Promise.resolve();
  var language = resolveLanguage(null);
  var rateMemory = new RateMemory(chrome.storage.local);
  var rateWriteLedger = new RateWriteLedger();
  var tabActivity = new TabActivity();
  var activityNoticeQueues = /* @__PURE__ */ new Map();
  var activityRestoreAttempts = /* @__PURE__ */ new Set();
  var activityRestoreTasks = /* @__PURE__ */ new Map();
  var activityReady;
  var activityInitialized = false;
  var activityEventRevision = 0;
  var activityGeneration = 0;
  var activityEvents = [];
  var activityWrites = Promise.resolve();
  var titleFor = (settings, blocked = false) => translate(language, !settings.enabled ? "VideoSpeed (disabled)" : blocked ? "VideoSpeed (disabled on this site)" : "VideoSpeed");
  async function stored2() {
    if (settingsCache) return settingsCache;
    if (!settingsTask) settingsTask = chrome.storage.local.get(["settings", "popupLanguage"]).then((data) => {
      settingsCache = normalizeSettings(data.settings);
      language = resolveLanguage(data.popupLanguage);
      queueMicrotask(() => syncPower(settingsCache).catch(() => {
      }));
      return settingsCache;
    }).finally(() => {
      settingsTask = null;
    });
    return settingsTask;
  }
  var settingsReady = stored2();
  async function rateState() {
    await stored2();
    return rateMemory.read();
  }
  async function optionalRateState() {
    try {
      return await rateState();
    } catch {
      return null;
    }
  }
  function saveActivity() {
    const snapshot = tabActivity.snapshot();
    activityWrites = activityWrites.catch(() => {
    }).then(() => chrome.storage.session.set({ tabActivity: snapshot }));
    return activityWrites;
  }
  async function readFocusedContext() {
    const window = await chrome.windows.getLastFocused();
    if (!window?.focused || !Number.isInteger(window.id)) return { windowId: null, tabId: null };
    const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
    return { windowId: window.id, tabId: Number.isInteger(tab?.id) ? tab.id : null };
  }
  function queueActivityEvent(event) {
    activityEventRevision++;
    if (!activityInitialized) {
      activityEvents.push(event);
      return;
    }
    applyActivityEvent(event);
  }
  function applyActivityEvent(event) {
    if (event.type === "activated") {
      const cached = tabActivity.rememberActiveTab(event.windowId, event.tabId);
      if (event.windowId === tabActivity.focusedWindowId) activityGeneration++;
      const previousRevision2 = tabActivity.revision;
      const affected2 = tabActivity.setActiveTab(event.windowId, event.tabId, event.at);
      if (cached || tabActivity.revision !== previousRevision2) saveActivity().catch(() => {
      });
      for (const tabId of affected2) notifyActivity(tabId);
      return;
    }
    activityGeneration++;
    const windowId = event.windowId === chrome.windows.WINDOW_ID_NONE ? null : event.windowId;
    const previousRevision = tabActivity.revision;
    const affected = tabActivity.setFocusedWindow(windowId, event.at);
    if (tabActivity.revision !== previousRevision) saveActivity().catch(() => {
    });
    for (const tabId of affected) notifyActivity(tabId);
    if (windowId === null) return;
    const generation = activityGeneration;
    chrome.tabs.query({ active: true, windowId }).then((tabs) => {
      if (generation !== activityGeneration || tabActivity.focusedWindowId !== windowId) return;
      const tabId = tabs.find((tab) => Number.isInteger(tab.id))?.id;
      if (!Number.isInteger(tabId)) return;
      const changed = tabActivity.setActiveTab(windowId, tabId, Date.now());
      if (changed.length) {
        saveActivity().catch(() => {
        });
        for (const id of changed) notifyActivity(id);
      }
    }).catch(() => {
    });
  }
  async function initializeTabActivity() {
    const startedAt = Date.now(), windowAtStart = chrome.windows.getLastFocused().catch(() => null);
    let session = {};
    try {
      session = await chrome.storage.session.get("tabActivity");
    } catch {
    }
    tabActivity.restore(session.tabActivity);
    const initialWindow = await windowAtStart;
    let context;
    const affected = /* @__PURE__ */ new Set(), buffered = [];
    for (; ; ) {
      buffered.push(...activityEvents.splice(0));
      const revision = activityEventRevision;
      try {
        context = await readFocusedContext();
      } catch {
        context = { windowId: null, tabId: null };
      }
      if (revision !== activityEventRevision) continue;
      const firstFocus = buffered.find((event) => event.type === "focus");
      let seedWindow = null;
      if (initialWindow?.focused && Number.isInteger(initialWindow.id)) seedWindow = initialWindow.id;
      else if (firstFocus?.windowId === chrome.windows.WINDOW_ID_NONE && Number.isInteger(initialWindow?.id) && buffered.some((event) => event.type === "activated" && event.windowId === initialWindow.id && event.at <= firstFocus.at)) seedWindow = initialWindow.id;
      if (!firstFocus && Number.isInteger(context.windowId)) seedWindow = context.windowId;
      if (seedWindow !== null && tabActivity.focusedWindowId !== seedWindow) for (const tabId of tabActivity.setFocusedWindow(seedWindow, buffered[0]?.at || startedAt)) affected.add(tabId);
      for (const tabId of replayTabActivityEvents(tabActivity, buffered, { windowIdNone: chrome.windows.WINDOW_ID_NONE })) affected.add(tabId);
      for (const tabId of tabActivity.reconcile(context, Date.now())) affected.add(tabId);
      break;
    }
    if (Number.isInteger(tabActivity.focusedTabId)) affected.add(tabActivity.focusedTabId);
    for (const [tabId, until] of tabActivity.untilByTab) if (until > Date.now()) affected.add(tabId);
    activityInitialized = true;
    await saveActivity().catch(() => {
    });
    return [...affected];
  }
  activityReady = initializeTabActivity();
  activityReady.then((affected) => {
    for (const tabId of affected) notifyActivity(tabId);
  }).catch(() => {
  });
  chrome.tabs.onActivated.addListener((info) => queueActivityEvent({ type: "activated", tabId: info.tabId, windowId: info.windowId, at: Date.now() }));
  chrome.tabs.onCreated?.addListener((tab) => {
    if (tab.active) queueActivityEvent({ type: "activated", tabId: tab.id, windowId: tab.windowId, at: Date.now() });
  });
  chrome.windows.onFocusChanged.addListener((windowId) => queueActivityEvent({ type: "focus", windowId, at: Date.now() }));
  chrome.windows.onRemoved?.addListener((windowId) => {
    const at = Date.now();
    activityReady.then(() => {
      for (const tabId of tabActivity.forgetWindow(windowId, at)) notifyActivity(tabId);
      saveActivity().catch(() => {
      });
    }).catch(() => {
    });
  });
  async function activityFor(tabId) {
    await activityReady;
    return tabActivity.activity(tabId);
  }
  var activityRecheck = null;
  async function ensureStartupActivity(tabId) {
    const activity = await activityFor(tabId);
    if (activity.focused) return;
    if (!activityRecheck) {
      const revision = activityEventRevision;
      activityRecheck = readFocusedContext().then((context) => {
        if (revision !== activityEventRevision) return;
        const changed = tabActivity.reconcile(context, Date.now());
        if (changed.length) {
          saveActivity().catch(() => {
          });
          for (const id of changed) notifyActivity(id);
        }
      }).catch(() => {
      }).finally(() => {
        activityRecheck = null;
      });
    }
    await activityRecheck;
  }
  async function activityFields(tabId, pageUrl) {
    const [settings, rate] = await Promise.all([stored2(), optionalRateState()]);
    if (pageUrl === void 0) try {
      pageUrl = (await chrome.tabs.get(tabId)).url || "";
    } catch {
      pageUrl = "";
    }
    return { activity: await activityFor(tabId), settings, pageUrl, language, ...rate ? { lastRate: rate.lastRate, rateRevision: rate.rateRevision } : {} };
  }
  async function sendActivityUpdate(tabId) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return;
    }
    const fields = await activityFields(tabId, tab.url || ""), message = { scope: SCOPE, action: "activity", ...fields };
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      if (response?.ok === true && response.version === VERSION) return;
    } catch {
    }
    if (tab.status === "loading" || activityRestoreAttempts.has(tabId) || !/^https?:/i.test(tab.url || "")) return;
    activityRestoreAttempts.add(tabId);
    if (!activityRestoreTasks.has(tabId)) {
      const task = restoreOpenTab(tabId).then(() => notifyActivity(tabId)).catch(() => {
      }).finally(() => {
        if (activityRestoreTasks.get(tabId) === task) activityRestoreTasks.delete(tabId);
      });
      activityRestoreTasks.set(tabId, task);
    }
  }
  function notifyActivity(tabId) {
    const pending = activityNoticeQueues.get(tabId);
    if (pending) {
      pending.again = true;
      return pending.task;
    }
    const job = { again: true, task: null };
    activityNoticeQueues.set(tabId, job);
    job.task = (async () => {
      try {
        while (job.again) {
          job.again = false;
          await sendActivityUpdate(tabId);
        }
      } catch {
      } finally {
        if (activityNoticeQueues.get(tabId) === job) activityNoticeQueues.delete(tabId);
      }
    })();
    return job.task;
  }
  async function pausedTarget(tabId) {
    await powerQueue;
    const data = await chrome.storage.session.get("pausedTargets");
    return data.pausedTargets?.[tabId] || null;
  }
  function syncPower(settings) {
    powerQueue = powerQueue.catch(() => {
    }).then(async () => {
      const enabled = settings.enabled, signature = JSON.stringify([enabled, settings.disabledSites, settings.siteModes]);
      if (powerSignature === signature) return;
      powerSignature = signature;
      const cached = await chrome.storage.session.get("pausedTargets"), frozen = { ...cached.pausedTargets };
      const tabs = new Set([...frames.keys(), ...[...contentPorts].map((port) => port.sender?.tab?.id), ...[...ports.values()].map((item) => item.tabId)].filter(Number.isInteger));
      if (!enabled) {
        for (const tabId of selectionDeliveries.keys()) clearSelectionDelivery(tabId);
        for (const tabId of frames.keys()) {
          const target = targetFor(tabId);
          if (target) frozen[tabId] = target;
        }
        await chrome.storage.session.set({ pausedTargets: frozen });
        frames.clear();
        announced.clear();
        pinned.clear();
      }
      const rate = await optionalRateState();
      await Promise.allSettled([...tabs].map((tabId) => applyPagePolicy(tabId, void 0, settings, rate)));
      await chrome.action.setIcon({ path: Object.fromEntries([16, 32, 48, 128].map((size) => [size, "icons/" + (enabled ? "" : "off-") + size + ".png"])) });
      await chrome.action.setTitle({ title: titleFor(settings) });
      for (const [port, item] of ports) try {
        port.postMessage({ action: "updated", tabId: item.tabId });
      } catch {
      }
    });
    return powerQueue;
  }
  async function applyPagePolicy(tabId, pageUrl, settings, rate) {
    settings = settings || await stored2();
    if (pageUrl === void 0) pageUrl = (await chrome.tabs.get(tabId)).url || "";
    const blocked = disabledOnUrl(pageUrl, settings.disabledSites, settings.siteModes), enabled = settings.enabled && !blocked;
    if (!enabled) {
      clearSelectionDelivery(tabId);
      frames.delete(tabId);
      announced.delete(tabId);
      pinned.delete(tabId);
    }
    if (rate === void 0) rate = await optionalRateState();
    const message = { scope: SCOPE, action: "power", settings, pageUrl, language, activity: await activityFor(tabId) };
    if (rate) Object.assign(message, { lastRate: rate.lastRate, rateRevision: rate.rateRevision });
    await chrome.tabs.sendMessage(tabId, message).catch(() => {
    });
    await chrome.action.setIcon({ tabId, path: Object.fromEntries([16, 32, 48, 128].map((size) => [size, "icons/" + (enabled ? "" : "off-") + size + ".png"])) });
    await chrome.action.setTitle({ tabId, title: titleFor(settings, blocked) });
    for (const [port, item] of ports) if (item.tabId === tabId) try {
      port.postMessage({ action: "updated", tabId });
    } catch {
    }
  }
  function itemsFor(tabId) {
    return [...frames.get(tabId)?.values() || []].flatMap((frame) => frame.videos.map((video) => ({ ...video, frameId: frame.frameId, documentId: frame.documentId, key: keyOf(frame, video.id) })));
  }
  function targetFor(tabId) {
    return rankTargets(itemsFor(tabId), pinned.get(tabId))[0] || null;
  }
  function highlight(tabId, scroll = false, clear = false) {
    const previous = markerQueues.get(tabId) || Promise.resolve();
    const next = previous.catch(() => {
    }).then(async () => {
      const target = clear || !(await stored2()).enabled ? null : targetFor(tabId);
      if (!target || markedTargets.get(tabId)?.key !== target.key) await chrome.tabs.sendMessage(tabId, { scope: SCOPE, action: "highlight", options: { clear: true } }).catch(() => {
      });
      if (!target) {
        markedTargets.delete(tabId);
        return;
      }
      const response = await chrome.tabs.sendMessage(tabId, { scope: SCOPE, action: "highlight", options: { mediaKey: target.id, title: target.title, scrollIntoView: scroll } }, optionsOf(target)).catch(() => null);
      if (response?.highlighted) markedTargets.set(tabId, { key: target.key, title: target.title });
      else markedTargets.delete(tabId);
    });
    markerQueues.set(tabId, next);
    return next;
  }
  async function announce(tabId, force = false) {
    if (!(await stored2()).enabled) return;
    const target = targetFor(tabId), key = target?.key || "";
    const recipients = [...frames.get(tabId)?.values() || []], signature = JSON.stringify([key, recipients.map((frame) => [frame.frameId, frame.documentId])]);
    let delivery = selectionDeliveries.get(tabId);
    if (delivery?.signature !== signature) {
      clearTimeout(delivery?.timer);
      delivery = { signature, key, attempts: 0, pending: false, timer: null };
      selectionDeliveries.set(tabId, delivery);
    }
    if ((force || announced.get(tabId) !== key) && !delivery.pending) {
      clearTimeout(delivery.timer);
      delivery.timer = null;
      delivery.pending = true;
      delivery.attempts++;
      try {
        const rate = await optionalRateState();
        if (selectionDeliveries.get(tabId) !== delivery) return;
        const message = { scope: SCOPE, action: "activeTarget", hasTarget: !!target };
        if (rate) Object.assign(message, { lastRate: rate.lastRate, rateRevision: rate.rateRevision });
        const responses = await Promise.allSettled(recipients.map(async (frame) => {
          const id = frame.documentId === target?.documentId && frame.frameId === target?.frameId ? target.id : null;
          const response = await sendSelection(tabId, { ...message, id }, optionsOf(frame));
          return response?.ok === true && response.activeId === id;
        }));
        if (selectionDeliveries.get(tabId) !== delivery) return;
        if (responses.every((response) => response.status === "fulfilled" && response.value === true)) {
          announced.set(tabId, key);
          delivery.attempts = 0;
        } else {
          let live;
          try {
            live = await chrome.webNavigation.getAllFrames({ tabId });
          } catch {
          }
          let removed = false;
          if (Array.isArray(live)) for (let index = 0; index < recipients.length; index++) {
            const response = responses[index], frame = recipients[index];
            if (response.status === "fulfilled" && response.value === true) continue;
            if (frames.get(tabId)?.get(frame.frameId) !== frame) continue;
            if (live.some((item) => item.frameId === frame.frameId && (!item.documentId || !frame.documentId || item.documentId === frame.documentId))) continue;
            frames.get(tabId).delete(frame.frameId);
            removed = true;
          }
          if (removed) {
            clearSelectionDelivery(tabId);
            await announce(tabId, true);
            return;
          }
          if (announced.get(tabId) === key) announced.delete(tabId);
          if (delivery.attempts < 3) delivery.timer = setTimeout(() => {
            delivery.timer = null;
            if (selectionDeliveries.get(tabId) === delivery) announce(tabId, true).catch(() => {
            });
          }, delivery.attempts === 1 ? 100 : 400);
        }
      } finally {
        delivery.pending = false;
      }
    }
    if ([...ports.values()].some((item) => item.tabId === tabId) && (markedTargets.get(tabId)?.key !== key || markedTargets.get(tabId)?.title !== target?.title)) highlight(tabId);
    for (const [port, item] of ports) if (item.tabId === tabId) try {
      port.postMessage({ action: "updated", tabId });
    } catch {
    }
  }
  function record(tabId, frameId, documentId, videos) {
    const items = Array.isArray(videos) ? videos.slice(0, 64) : [];
    if (frameId > 0 && !items.length) {
      if (frames.get(tabId)?.delete(frameId)) announce(tabId, true);
      return;
    }
    if (!frames.has(tabId)) frames.set(tabId, /* @__PURE__ */ new Map());
    const fresh = frames.get(tabId).get(frameId)?.documentId !== documentId;
    frames.get(tabId).set(frameId, { frameId, documentId, videos: items });
    announce(tabId, fresh);
  }
  async function refresh(tabId, force = false) {
    const settings = await stored2();
    if (!settings.enabled || disabledOnUrl((await chrome.tabs.get(tabId)).url, settings.disabledSites, settings.siteModes)) return;
    const pending = refreshTasks.get(tabId);
    if (pending) {
      if (!force || pending.force) return pending.task;
      await pending.task.catch(() => {
      });
      return refresh(tabId, true);
    }
    const task = (async () => {
      const generation = tabGeneration(tabId);
      const target = force ? null : targetFor(tabId);
      if (target) {
        const before = frames.get(tabId)?.get(target.frameId), frameVersion = frameGeneration(tabId, target.frameId);
        try {
          const result = await chrome.tabs.sendMessage(tabId, { scope: SCOPE, action: "refreshTarget" }, optionsOf(target));
          if (result?.ok && Array.isArray(result.videos) && result.videos.some((video) => video.id === target.id && video.connected !== false)) {
            if (tabGenerations.get(tabId) === generation && frameGeneration(tabId, target.frameId) === frameVersion) {
              if (frames.get(tabId)?.get(target.frameId) === before) record(tabId, target.frameId, target.documentId, result.videos);
              return;
            }
          }
        } catch {
        }
      }
      if (await refreshFrames(tabId) === false) await refreshFrames(tabId);
    })();
    const entry = { task, force };
    refreshTasks.set(tabId, entry);
    try {
      return await task;
    } finally {
      if (refreshTasks.get(tabId) === entry) refreshTasks.delete(tabId);
    }
  }
  async function refreshFrames(tabId) {
    const generation = tabGeneration(tabId), before = new Map(frames.get(tabId) || []), frameVersions = new Map(frameGenerations.get(tabId) || []);
    const probes = await chrome.scripting.executeScript({ injectImmediately: true, target: { tabId, allFrames: true }, world: "ISOLATED", func: (version) => {
      if (/(^|\.)challenges\.cloudflare\.com$/i.test(location.hostname)) return "skip";
      const api = globalThis[/* @__PURE__ */ Symbol.for("video-control.api")];
      try {
        if (api?.version === version && api.alive()) return true;
      } catch {
      }
      try {
        api?.dispose?.();
      } catch {
      }
      globalThis[/* @__PURE__ */ Symbol.for("video-control.recovering")] = true;
      return false;
    }, args: [VERSION] });
    const missing = probes.filter((frame) => frame.result === false).map((frame) => frame.frameId);
    if (missing.length) {
      await chrome.scripting.executeScript({ injectImmediately: true, target: { tabId, frameIds: missing }, world: "MAIN", files: ["page-bridge.js"] });
      await chrome.scripting.executeScript({ injectImmediately: true, target: { tabId, frameIds: missing }, world: "ISOLATED", files: ["content.js"] });
    }
    const results = await chrome.scripting.executeScript({ injectImmediately: true, target: { tabId, allFrames: true }, world: "ISOLATED", func: async () => {
      if (/(^|\.)challenges\.cloudflare\.com$/i.test(location.hostname)) return [];
      const api = globalThis[/* @__PURE__ */ Symbol.for("video-control.api")];
      if (!api?.alive?.()) throw Error("Could not connect to the video");
      return await api.refresh();
    } });
    let liveFrames;
    try {
      liveFrames = await chrome.webNavigation.getAllFrames({ tabId });
    } catch {
    }
    if (!(await stored2()).enabled || tabGenerations.get(tabId) !== generation) return false;
    if (Array.isArray(liveFrames)) {
      for (const [frameId, entry] of before) if (!liveFrames.some((frame) => frame.frameId === frameId) && frames.get(tabId)?.get(frameId) === entry) frames.get(tabId).delete(frameId);
    }
    for (const item of results) {
      if (frameGeneration(tabId, item.frameId) !== (frameVersions.get(item.frameId) || 0) || frames.get(tabId)?.get(item.frameId) !== before.get(item.frameId)) continue;
      record(tabId, item.frameId, item.documentId, item.result);
    }
    await announce(tabId);
    return true;
  }
  async function currentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw Error("Open a page with a video first");
    return tab;
  }
  async function dispatch(tabId, message, retry = true) {
    const target = message.key ? itemsFor(tabId).find((item) => item.key === message.key) : targetFor(tabId);
    if (!target) throw Error("Video changed; select it again");
    const settings = await stored2();
    if (!settings.enabled) throw Error("VideoSpeed is disabled");
    if (disabledOnUrl((await chrome.tabs.get(tabId)).url, settings.disabledSites, settings.siteModes)) throw Error("Disabled on this site");
    let result;
    try {
      result = await chrome.tabs.sendMessage(tabId, { scope: SCOPE, action: "control", id: target.id, command: message.command, value: message.value, language }, optionsOf(target));
    } catch (error) {
      if (!retry || message.key) throw error;
      await refresh(tabId, true);
      return dispatch(tabId, message, false);
    }
    if (!result?.ok) throw Error(result?.error || "Video did not respond; reload the page");
    const frame = frames.get(tabId)?.get(target.frameId);
    if (frame?.documentId === target.documentId) {
      const video = frame.videos.find((item) => item.id === target.id);
      if (video) Object.assign(video, result.result);
    }
    return result.result;
  }
  function rateWriteAck(message, state, accepted) {
    return { ...state, rateSessionId: message.rateSessionId, rateWriteId: message.rateWriteId, accepted };
  }
  async function currentRateWriteAck(message, accepted = false) {
    return rateWriteAck(message, await rateState(), accepted);
  }
  async function persistRateMessage(message, token, targetMatches) {
    if (!token) return {};
    if (["stale", "conflict"].includes(token.status)) return currentRateWriteAck(message);
    if (token.status === "completed") return currentRateWriteAck(message, true);
    if (!targetMatches || !(await stored2()).enabled) return currentRateWriteAck(message);
    const state = await rateMemory.remember(message.rate, message.source, { isCurrent: token.isCurrent });
    if (state && token.complete()) return rateWriteAck(message, state, true);
    return currentRateWriteAck(message);
  }
  function changeSettings(patch) {
    settingsWrites = settingsWrites.catch(() => {
    }).then(async () => {
      const settings = validateSettings({ ...await stored2(), ...patch });
      settingsCache = settings;
      await chrome.storage.local.set({ settings });
      await syncPower(settings);
      return settings;
    });
    return settingsWrites;
  }
  async function run(message, sender) {
    await activityReady;
    if (message.action === "repairBridge") {
      const tabId2 = sender.tab?.id;
      if (!Number.isInteger(tabId2)) throw Error("Video page required");
      const settings2 = await stored2(), activity = await activityFor(tabId2);
      const frame = frames.get(tabId2)?.get(sender.frameId || 0), playing = frame?.documentId === sender.documentId && frame?.videos.some((video) => video.playing && video.connected !== false);
      if (!settings2.enabled || disabledOnUrl(sender.tab.url, settings2.disabledSites, settings2.siteModes) || disabledOnUrl(sender.url, settings2.disabledSites, settings2.siteModes) || !activity.focused && activity.until <= Date.now() && !playing) throw Error("Video controls are not active on this page");
      await chrome.scripting.executeScript({ injectImmediately: true, target: { tabId: tabId2, ...sender.documentId ? { documentIds: [sender.documentId] } : { frameIds: [sender.frameId || 0] } }, world: "MAIN", files: ["page-bridge.js"] });
      return {};
    }
    if (message.action === "settings") {
      if (Number.isInteger(sender.tab?.id)) await ensureStartupActivity(sender.tab.id);
      const settings2 = await stored2(), rate = await rateState();
      return { settings: settings2, lastRate: rate.lastRate, rateRevision: rate.rateRevision, pageUrl: sender.tab?.url || "", language, activity: await activityFor(sender.tab?.id) };
    }
    if (message.action === "report") {
      const hint = message.rememberedRate, token = hint ? rateWriteLedger.begin(hint, sender) : null, settings2 = await stored2();
      let targetMatches = false;
      if (settings2.enabled && sender.tab?.id && !disabledOnUrl(sender.tab.url, settings2.disabledSites, settings2.siteModes) && !disabledOnUrl(sender.url, settings2.disabledSites, settings2.siteModes)) {
        record(sender.tab.id, sender.frameId, sender.documentId, message.videos);
        const target = targetFor(sender.tab.id);
        targetMatches = !!hint && target?.id === hint.id && target.frameId === sender.frameId && target.documentId === sender.documentId;
      }
      return token ? persistRateMessage(hint, token, targetMatches) : {};
    }
    if (message.action === "rememberRate") {
      const token = rateWriteLedger.begin(message, sender);
      if (!token) return {};
      const target = targetFor(sender.tab?.id);
      const targetMatches = !!target && target.id === message.id && target.frameId === sender.frameId && target.documentId === sender.documentId;
      return await persistRateMessage(message, token, targetMatches);
    }
    if (message.action === "picked") {
      if (!(await stored2()).enabled) return {};
      if (!sender.tab?.id) return {};
      pinned.set(sender.tab.id, keyOf(sender, message.id));
      await chrome.tabs.sendMessage(sender.tab.id, { scope: SCOPE, action: "cancelPick" }).catch(() => {
      });
      await announce(sender.tab.id);
      if (typeof chrome.action.openPopup === "function") await chrome.action.openPopup().catch(() => {
      });
      return {};
    }
    const fromPage = sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(""));
    const tab = fromPage ? sender.tab : Number.isInteger(message.tabId) ? await chrome.tabs.get(message.tabId) : await currentTab(), tabId = tab.id;
    if (message.action === "activity") return activityFields(tabId, tab.url || "");
    if (message.action === "getState" || message.action === "cachedState") {
      const settings2 = await stored2(), pageUrl = tab.url || "", siteDisabled = disabledOnUrl(pageUrl, settings2.disabledSites, settings2.siteModes);
      if (message.action === "getState" && settings2.enabled && !siteDisabled) await popupRefresh(refresh(tabId, message.refresh === true));
      const target = siteDisabled ? null : settings2.enabled ? targetFor(tabId) : await pausedTarget(tabId), rate = await rateState();
      return { tabId, pageUrl, siteDisabled, settings: settings2, loading: tab.status === "loading", lastRate: rate.lastRate, rateRevision: rate.rateRevision, videos: target ? [target] : [], target };
    }
    if (message.action === "updateSettings") {
      const fields = ["enabled", "preferredRate", "defaultMode", "customRate", "qualityEnabled", "preferredQuality", "steps", "shortcuts", "disabledSites", "siteModes"];
      const patch = Object.fromEntries(Object.entries(message.patch || {}).filter(([key]) => fields.includes(key)));
      return { settings: await changeSettings(patch) };
    }
    if (message.action === "setEnabled") return { settings: await changeSettings({ enabled: message.enabled === true }) };
    if (message.action === "saveSettings") return { settings: await changeSettings(validateSettings(message.settings)) };
    const settings = await stored2();
    if (!settings.enabled) throw Error("VideoSpeed is disabled");
    if (disabledOnUrl(tab.url, settings.disabledSites, settings.siteModes)) throw Error("Disabled on this site");
    if (message.action === "select") {
      if (!itemsFor(tabId).some((item) => item.key === message.key)) throw Error("Video changed; select it again");
      pinned.set(tabId, message.key);
      await announce(tabId);
      await highlight(tabId, true);
      return {};
    }
    if (message.action === "pick") {
      await refresh(tabId, true);
      await chrome.tabs.sendMessage(tabId, { scope: SCOPE, action: "pick", language: resolveLanguage(message.language || language) });
      return {};
    }
    if (message.action === "cancelPick") {
      await chrome.tabs.sendMessage(tabId, { scope: SCOPE, action: "cancelPick" }).catch(() => {
      });
      return {};
    }
    if (message.action === "command") {
      if (!targetFor(tabId)) await refresh(tabId);
      return { result: await dispatch(tabId, message) };
    }
    throw Error("Unsupported action");
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.scope !== SCOPE) return;
    run(message, sender).then((result) => respond({ ok: true, ...result }), (error) => respond({ ok: false, error: error.message || "Operation failed" }));
    return true;
  });
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "video-control-content") {
      contentPorts.add(port);
      port.onDisconnect.addListener(() => contentPorts.delete(port));
      return;
    }
    if (port.name !== "video-control-popup") return;
    const item = { tabId: null };
    ports.set(port, item);
    port.onMessage.addListener((message) => {
      if (message.action === "watch" && Number.isInteger(message.tabId)) {
        const changed = item.tabId !== message.tabId;
        item.tabId = message.tabId;
        if (changed && settingsCache?.enabled) highlight(item.tabId);
      }
      if (message.action === "renew" && item.tabId && settingsCache?.enabled) {
        const target = targetFor(item.tabId);
        if (target) chrome.tabs.sendMessage(item.tabId, { scope: SCOPE, action: "highlight", options: { renew: true } }, optionsOf(target)).then((result) => {
          if (!result?.highlighted) highlight(item.tabId);
        }).catch(() => {
        });
      }
    });
    port.onDisconnect.addListener(() => {
      ports.delete(port);
      if (item.tabId && ![...ports.values()].some((other) => other.tabId === item.tabId)) highlight(item.tabId, false, true);
    });
  });
  function forgetTab(tabId) {
    clearSelectionDelivery(tabId);
    tabGenerations.set(tabId, ++navigationSerial);
    frameGenerations.delete(tabId);
    frames.delete(tabId);
    pinned.delete(tabId);
    announced.delete(tabId);
    markedTargets.delete(tabId);
    markerQueues.delete(tabId);
    rateWriteLedger.forgetTab(tabId);
    powerQueue = powerQueue.catch(() => {
    }).then(async () => {
      const data = await chrome.storage.session.get("pausedTargets"), frozen = { ...data.pausedTargets };
      if (Object.hasOwn(frozen, tabId)) {
        delete frozen[tabId];
        await chrome.storage.session.set({ pausedTargets: frozen });
      }
    });
  }
  function forgetActivityTab(tabId) {
    activityRestoreAttempts.delete(tabId);
    activityRestoreTasks.delete(tabId);
    activityNoticeQueues.delete(tabId);
    if (tabActivity.forget(tabId)) saveActivity().catch(() => {
    });
  }
  chrome.tabs.onRemoved.addListener((tabId) => {
    forgetTab(tabId);
    activityReady.then(() => forgetActivityTab(tabId)).catch(() => {
    });
    tabGenerations.delete(tabId);
  });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === "loading") {
      forgetTab(tabId);
      activityRestoreAttempts.delete(tabId);
    }
    if (change.status === "complete") activityFor(tabId).then((activity) => {
      if (activity.focused || activity.until > Date.now()) notifyActivity(tabId);
    }).catch(() => {
    });
    if (change.url) applyPagePolicy(tabId, change.url).catch(() => {
    });
  });
  async function frameRoute(details) {
    if (details.frameId === 0 || details.tabId < 0) return;
    const settings = await stored2();
    if (!settings.enabled) return;
    const tab = await chrome.tabs.get(details.tabId), blocked = disabledOnUrl(tab.url, settings.disabledSites, settings.siteModes) || disabledOnUrl(details.url, settings.disabledSites, settings.siteModes);
    if (blocked) {
      frames.get(details.tabId)?.delete(details.frameId);
      await announce(details.tabId, true);
    }
    const rate = await optionalRateState(), message = { scope: SCOPE, action: "power", settings, pageUrl: tab.url || "", language, activity: await activityFor(details.tabId) };
    if (rate) Object.assign(message, { lastRate: rate.lastRate, rateRevision: rate.rateRevision });
    await chrome.tabs.sendMessage(details.tabId, message, details.documentId ? { documentId: details.documentId } : { frameId: details.frameId }).catch(() => {
    });
  }
  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => frameRoute(details).catch(() => {
  }));
  chrome.webNavigation.onReferenceFragmentUpdated.addListener((details) => frameRoute(details).catch(() => {
  }));
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId > 0) {
      if (!frameGenerations.has(details.tabId)) frameGenerations.set(details.tabId, /* @__PURE__ */ new Map());
      frameGenerations.get(details.tabId).set(details.frameId, ++navigationSerial);
      frames.get(details.tabId)?.delete(details.frameId);
      announce(details.tabId, true).catch(() => {
      });
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") rateMemory.observeChanges(changes, area).catch(() => {
    });
    if (area === "local" && changes.settings) {
      settingsCache = normalizeSettings(changes.settings.newValue);
      syncPower(settingsCache).catch(() => {
      });
    }
    if (area === "local" && changes.popupLanguage) {
      language = resolveLanguage(changes.popupLanguage.newValue);
      stored2().then(async (settings) => {
        await chrome.action.setTitle({ title: titleFor(settings) });
        const tabs = new Set([...frames.keys(), ...[...contentPorts].map((port) => port.sender?.tab?.id), ...[...ports.values()].map((item) => item.tabId)].filter(Number.isInteger));
        await Promise.allSettled([...tabs].map(async (tabId) => {
          const tab = await chrome.tabs.get(tabId);
          await chrome.action.setTitle({ tabId, title: titleFor(settings, disabledOnUrl(tab.url, settings.disabledSites, settings.siteModes)) });
        }));
      }).catch(() => {
      });
    }
  });
  async function restoreOpenTab(tabId) {
    const frames2 = await chrome.scripting.executeScript({ injectImmediately: true, target: { tabId, allFrames: true }, world: "ISOLATED", func: (version) => {
      if (/(^|\.)challenges\.cloudflare\.com$/i.test(location.hostname)) return false;
      const api = globalThis[/* @__PURE__ */ Symbol.for("video-control.api")];
      try {
        if (api?.version === version && api.alive()) return false;
      } catch {
      }
      try {
        api?.dispose?.();
      } catch {
      }
      document.dispatchEvent(new CustomEvent("video-control:bridge-state-v4", { detail: JSON.stringify({ enabled: false, force: true }) }));
      globalThis[/* @__PURE__ */ Symbol.for("video-control.recovering")] = true;
      return true;
    }, args: [VERSION] });
    const frameIds = frames2.filter((frame) => frame.result === true).map((frame) => frame.frameId);
    if (!frameIds.length) return;
    await chrome.scripting.executeScript({ injectImmediately: true, target: { tabId, frameIds }, world: "MAIN", files: ["page-bridge.js"] });
    await chrome.scripting.executeScript({ injectImmediately: true, target: { tabId, frameIds }, world: "ISOLATED", files: ["content.js"] });
  }
  async function restoreOpenTabs() {
    await stored2();
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (let index = 0; index < tabs.length; index += 4) await Promise.allSettled(tabs.slice(index, index + 4).map((tab) => restoreOpenTab(tab.id)));
  }
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "update") restoreOpenTabs().catch(() => {
    });
  });
  settingsReady.catch(() => {
  });
})();
