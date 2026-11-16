// Service worker: turns settings into declarativeNetRequest redirect rules
// (one module per site in ./sites), and adds the "open / save original
// image" context menu items.
importScripts('../shared/config.js', 'sites/x.js', 'sites/reddit.js');

const CONFIG = self.QM_CONFIG;
const DEFAULTS = CONFIG.DEFAULTS;
const SITE_RULES = self.QM_SITE_RULES;

function buildRules(s) {
  if (!s.enabled) return [];
  const rules = [];
  for (const [siteId, mod] of Object.entries(SITE_RULES)) {
    if (s[siteId + '_enabled']) rules.push(...mod.buildRules(s));
  }
  // Unique ids, rebuilt from scratch on every update.
  rules.forEach((r, i) => { r.id = i + 1; });
  return rules;
}

// Ask Chrome whether each regex compiles under its RE2 limits and drop any
// that don't, so one bad rule can't make the whole batch fail.
async function keepSupportedRules(rules) {
  const kept = [];
  for (const rule of rules) {
    const regex = rule.condition.regexFilter;
    if (regex) {
      const { isSupported, reason } = await chrome.declarativeNetRequest.isRegexSupported({
        regex,
        isCaseSensitive: !!rule.condition.isUrlFilterCaseSensitive,
        requireCapturing: !!rule.action.redirect?.regexSubstitution,
      });
      if (!isSupported) {
        console.warn(`[Quality Manager] skipping rule ${rule.id}: regex not supported (${reason}): ${regex}`);
        continue;
      }
    }
    kept.push(rule);
  }
  return kept;
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return Object.assign({}, DEFAULTS, stored);
}

async function replaceRules() {
  const settings = await getSettings();
  const rules = await keepSupportedRules(buildRules(settings));
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  // Also remove the ids we're about to add, in case anything else installed
  // them since getDynamicRules (removing an unknown id is harmless).
  const removeRuleIds = [...new Set([...existing.map((r) => r.id), ...rules.map((r) => r.id)])];
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: rules });
  } catch (err) {
    console.error(`[Quality Manager] failed to update rules: ${err && err.message}\n${JSON.stringify(rules, null, 2)}`);
  }
}

// Updates run one at a time. Several triggers can fire together (on install
// the defaults are written to storage, which fires storage.onChanged), and two
// overlapping updates would both read the old rules and add the same ids.
let ruleQueue = Promise.resolve();
function applyRules() {
  ruleQueue = ruleQueue.then(replaceRules, replaceRules);
  return ruleQueue;
}

// ---- Context menu -------------------------------------------------------
const MENU_OPEN = 'qm-open-orig';
const MENU_SAVE = 'qm-save-orig';
const IMAGE_PATTERNS = Object.values(SITE_RULES).flatMap((m) => m.imagePatterns);

function originalImage(src) {
  for (const mod of Object.values(SITE_RULES)) {
    try {
      const r = mod.originalImageUrl(src);
      if (r) return r;
    } catch (_) { /* not this site's URL */ }
  }
  return null;
}

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_OPEN,
      title: 'Open original-quality image',
      contexts: ['image'],
      targetUrlPatterns: IMAGE_PATTERNS,
    });
    chrome.contextMenus.create({
      id: MENU_SAVE,
      title: 'Save original-quality image',
      contexts: ['image'],
      targetUrlPatterns: IMAGE_PATTERNS,
    });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const img = info.srcUrl && originalImage(info.srcUrl);
  if (!img) return;
  if (info.menuItemId === MENU_OPEN) {
    chrome.tabs.create({ url: img.url, index: tab ? tab.index + 1 : undefined, openerTabId: tab ? tab.id : undefined });
  } else if (info.menuItemId === MENU_SAVE) {
    chrome.downloads.download({ url: img.url, filename: img.filename, saveAs: false });
  }
});

// ---- Lifecycle ------------------------------------------------------------
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(null);
  // Carry over settings from the X-only version, then fill in new defaults
  // without touching the user's existing choices.
  const { set, remove } = CONFIG.migrateLegacy(stored);
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (!(k in stored) && !(k in set)) set[k] = v;
  }
  if (Object.keys(set).length) await chrome.storage.sync.set(set);
  if (remove.length) await chrome.storage.sync.remove(remove);
  createMenus();
  applyRules();
});

chrome.runtime.onStartup.addListener(applyRules);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') applyRules();
});

// Exposed for tests (Node) — harmless in the extension.
self.__QM_BUILD_RULES__ = buildRules;
self.__QM_KEEP_SUPPORTED__ = keepSupportedRules;
self.__QM_ORIGINAL_IMAGE__ = originalImage;
self.__QM_APPLY_RULES__ = applyRules;
