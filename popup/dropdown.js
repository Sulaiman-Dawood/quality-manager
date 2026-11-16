// Styled dropdowns for the popup, replacing the browser's native menu (which
// ignores the extension's colours). Each native <select> stays in the page,
// hidden, as the source of truth: choosing an item sets select.value and
// fires 'change', so the rest of the popup works with plain selects.
//
//   QMDropdown.enhance(select)  build the styled control once
//   QMDropdown.refresh(select)  re-read value/option labels after code changed them
(function (root) {
  'use strict';
  let openOne = null;
  let uid = 0;

  function enhance(select) {
    if (select.__qmDropdown) return select.__qmDropdown;
    const id = select.id || 'dd' + (++uid);

    const wrap = document.createElement('div');
    wrap.className = 'dd';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dd-button';
    button.id = id + '-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const text = document.createElement('span');
    text.className = 'dd-text';
    const chev = document.createElement('span');
    chev.className = 'dd-chev';
    chev.setAttribute('aria-hidden', 'true');
    button.append(text, chev);

    const list = document.createElement('ul');
    list.className = 'dd-list';
    list.id = id + '-list';
    list.setAttribute('role', 'listbox');
    list.tabIndex = -1;
    list.hidden = true;
    button.setAttribute('aria-controls', list.id);

    // Labels point at the visible button now.
    for (const label of document.querySelectorAll(`label[for="${id}"]`)) {
      label.htmlFor = button.id;
      if (!label.id) label.id = id + '-label';
      list.setAttribute('aria-labelledby', label.id);
      button.setAttribute('aria-labelledby', label.id + ' ' + button.id);
    }

    wrap.append(button, list);
    select.after(wrap);
    select.hidden = true;
    select.tabIndex = -1;

    let active = -1;
    const items = () => [...list.children];

    function render() {
      const opt = select.options[select.selectedIndex];
      text.textContent = opt ? opt.textContent : '';
    }

    function build() {
      list.textContent = '';
      [...select.options].forEach((opt, i) => {
        const li = document.createElement('li');
        li.id = `${id}-opt-${i}`;
        li.setAttribute('role', 'option');
        li.dataset.value = opt.value;
        li.textContent = opt.textContent;
        const selected = i === select.selectedIndex;
        li.setAttribute('aria-selected', String(selected));
        li.addEventListener('mousemove', () => setActive(i, false));
        li.addEventListener('click', () => choose(i));
        list.append(li);
      });
    }

    function setActive(i, scroll) {
      const all = items();
      if (!all.length) return;
      active = Math.max(0, Math.min(all.length - 1, i));
      all.forEach((li, j) => li.classList.toggle('active', j === active));
      list.setAttribute('aria-activedescendant', all[active].id);
      if (scroll !== false) all[active].scrollIntoView({ block: 'nearest' });
    }

    // Fit the menu inside the popup as it is. The popup window resizes to its
    // content, so a menu poking out would stretch it; instead open on the
    // side with more room (below unless it doesn't fit) and scroll inside.
    function place() {
      list.classList.remove('up');
      list.style.maxHeight = '';
      const r = button.getBoundingClientRect();
      const margin = 8;
      // The popup's real height is its content's height: window.innerHeight
      // can report more (Brave), which would let the menu open past the
      // bottom and stretch the popup. The open menu is absolutely
      // positioned, so it doesn't count towards the body's box.
      const bottom = Math.min(window.innerHeight, document.body.getBoundingClientRect().bottom);
      const below = bottom - r.bottom - 4 - margin;
      const above = r.top - 4 - margin;
      const wanted = list.offsetHeight; // natural height, border included
      const up = wanted > below && above > below;
      if (up) list.classList.add('up');
      list.style.maxHeight = Math.max(0, Math.floor(Math.min(wanted, up ? above : below))) + 'px';
    }

    function open() {
      if (openOne && openOne !== api) openOne.close(false);
      build();
      list.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      wrap.classList.add('open');
      openOne = api;
      place();
      setActive(Math.max(0, select.selectedIndex));
      list.focus();
    }

    function close(focusButton) {
      if (list.hidden) return;
      list.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      wrap.classList.remove('open');
      if (openOne === api) openOne = null;
      if (focusButton) button.focus();
    }

    function choose(i) {
      const changed = i !== select.selectedIndex;
      select.selectedIndex = i;
      render();
      close(true);
      if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    button.addEventListener('click', () => (list.hidden ? open() : close(true)));
    button.addEventListener('keydown', (e) => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
    });
    list.addEventListener('keydown', (e) => {
      const n = items().length;
      if (e.key === 'ArrowDown') setActive(active + 1);
      else if (e.key === 'ArrowUp') setActive(active - 1);
      else if (e.key === 'Home') setActive(0);
      else if (e.key === 'End') setActive(n - 1);
      else if (e.key === 'Enter' || e.key === ' ') choose(active);
      else if (e.key === 'Escape') close(true);
      else if (e.key === 'Tab') { close(false); return; }
      else {
        // Type to jump: first item starting with that letter.
        const ch = e.key.length === 1 ? e.key.toLowerCase() : '';
        const at = ch ? items().findIndex((li, j) => j > active && li.textContent.toLowerCase().startsWith(ch)) : -1;
        const first = ch ? items().findIndex((li) => li.textContent.toLowerCase().startsWith(ch)) : -1;
        if (at >= 0 || first >= 0) setActive(at >= 0 ? at : first);
        else return;
      }
      e.preventDefault();
      e.stopPropagation();
    });

    const api = { refresh: render, close, open, button, list };
    select.__qmDropdown = api;
    render();
    return api;
  }

  function refresh(select) {
    if (select && select.__qmDropdown) select.__qmDropdown.refresh();
  }

  // Click anywhere else closes the open menu.
  document.addEventListener('mousedown', (e) => {
    if (openOne && !openOne.button.parentNode.contains(e.target)) openOne.close(false);
  });

  root.QMDropdown = { enhance, refresh };
})(typeof self !== 'undefined' ? self : globalThis);
