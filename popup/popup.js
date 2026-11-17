(function () {
  'use strict';
  const CONFIG = self.QM_CONFIG;
  const DEFAULTS = CONFIG.DEFAULTS;
  const SITE_IDS = Object.keys(CONFIG.SITES);
  const main = document.getElementById('options');
  const status = document.getElementById('status');
  const Dropdown = self.QMDropdown;

  // Current settings; filled from storage below.
  let s = Object.assign({}, DEFAULTS);

  // ---- Quality dropdowns (same list for every site) ----------------------
  const QUALITY_OPTIONS = [
    ['max', 'Highest'],
    ['1080', 'Up to 1080p'],
    ['720', 'Up to 720p'],
    ['480', 'Up to 480p'],
    ['min', 'Data saver'],
    ['auto', 'Site default'],
  ];
  for (const select of document.querySelectorAll('select[data-quality]')) {
    for (const [value, text] of QUALITY_OPTIONS) select.add(new Option(text, value));
  }
  // Every <select> gets the extension's own styled menu.
  for (const select of document.querySelectorAll('select')) Dropdown.enhance(select);

  // ---- Site picker: one dropdown chooses which page is shown ---------------
  const picker = document.getElementById('site-picker');
  const pages = [...document.querySelectorAll('.page')];
  const PICK_KEY = 'qm-popup-site';
  const SITE_NAMES = {};
  for (const opt of picker.options) SITE_NAMES[opt.value] = opt.textContent;

  function showPage(name) {
    if (!document.getElementById('page-' + name)) name = picker.options[0].value;
    picker.value = name;
    Dropdown.refresh(picker);
    for (const page of pages) page.hidden = page.id !== 'page-' + name;
  }

  picker.addEventListener('change', () => {
    showPage(picker.value);
    try { localStorage.setItem(PICK_KEY, picker.value); } catch (_) {}
  });

  // Open on the current site when there is one; otherwise the last pick.
  let initial = 'x';
  try { initial = localStorage.getItem(PICK_KEY) || initial; } catch (_) {}
  showPage(initial);
  if (chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ active: true, currentWindow: true }, (result) => {
      const url = result && result[0] && result[0].url; // only visible on supported sites
      if (!url) return;
      try {
        const site = CONFIG.siteForHost(new URL(url).hostname);
        if (site) showPage(site);
      } catch (_) {}
    });
  }

  // ---- Settings -------------------------------------------------------------
  const allButtons = [...document.querySelectorAll('[data-all]')];

  function reflectState() {
    main.classList.toggle('disabled', !s.enabled);
    for (const site of SITE_IDS) {
      const on = !!s[site + '_enabled'];
      const page = document.getElementById('page-' + site);
      if (page) page.classList.toggle('site-off', !on);
      // The dropdown shows which sites are switched off.
      const opt = [...picker.options].find((o) => o.value === site);
      if (opt) opt.textContent = SITE_NAMES[site] + (on ? '' : ' (off)');
    }
    Dropdown.refresh(picker);
    // "All sites" shows Highest/Lowest as active when every site matches.
    for (const btn of allButtons) {
      const all = SITE_IDS.every((site) => s[site + '_videoQuality'] === btn.dataset.all);
      btn.setAttribute('aria-pressed', String(all));
    }
  }

  // Put a stored value into its control (checkbox or dropdown).
  function show(key) {
    const el = document.getElementById(key);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!s[key];
    else { el.value = String(s[key]); Dropdown.refresh(el); }
  }

  function save(changes, message) {
    Object.assign(s, changes);
    chrome.storage.sync.set(changes, () => { status.textContent = message || 'Saved. Reload the tab to apply.'; });
    reflectState();
  }

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    s = Object.assign({}, DEFAULTS, stored);
    for (const key of Object.keys(DEFAULTS)) {
      const el = document.getElementById(key);
      if (!el) continue;
      show(key);
      el.addEventListener('change', () => {
        save({ [key]: el.type === 'checkbox' ? el.checked : el.value });
      });
    }
    reflectState();
  });

  // Highest / Lowest everywhere: video on every site, plus images (largest
  // available, or data saver where the site allows it).
  for (const btn of allButtons) {
    btn.addEventListener('click', () => {
      const highest = btn.dataset.all === 'max';
      const changes = {
        x_feedImages: highest ? 'orig' : 'small',
        reddit_images: highest ? 'orig' : 'small',
        instagram_images: highest ? 'default' : 'small',
        linkedin_images: highest ? 'large' : 'small',
        threads_images: highest ? 'large' : 'small',
        bluesky_images: highest ? 'orig' : 'default',
      };
      for (const site of SITE_IDS) changes[site + '_videoQuality'] = btn.dataset.all;
      save(changes, highest ? 'All sites set to Highest. Reload to apply.' : 'All sites set to Data saver. Reload to apply.');
      for (const key of Object.keys(changes)) show(key);
    });
  }

  document.getElementById('reload').addEventListener('click', () => {
    chrome.tabs.reload();
    window.close();
  });
})();
