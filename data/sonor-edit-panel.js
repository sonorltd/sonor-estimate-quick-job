/* =====================================================================
   sonor-edit-panel.js — shared "standard edit window" primitive
   =====================================================================
   Spine: v1.2.2 §15 sibling (SonorEdit is inline; SonorEditPanel is modal).
   Contract owner: S-4.15 companion — modal edit surface used by every app
   that needs "click a thing → open a tab/panel → edit fields → save".

   Master lives at: $SONOR_ROOT/sonor-edit-panel.js (+ sonor-edit-panel.css)
   Synced to:       data/sonor-edit-panel.{js,css} in every live app via
                    sync-everything.sh. Per-app edits are forbidden (S-4.2).

   Why SonorEditPanel and not SonorEdit?
   ------------------------------------
   SonorEdit (sonor-edit-ui.js) is inline, in-place editing — dblclick a
   label, type, commit. Great for quick tweaks on canvas/list surfaces.
   SonorEditPanel is a FULL modal — slide-out panel with typed fields,
   validation, sections, and a Save/Cancel contract. Used when the thing
   being edited has >3 fields, or needs structured typing (colour picker,
   pill-group service selector, select dropdown, textarea, toggle).

   Namespace:   window.SonorEditPanel
   API version: window.SONOR_EDIT_PANEL_VERSION (semver; bump on breaking)
   ===================================================================== */

(function (global) {
  'use strict';

  if (global.SonorEditPanel && global.SonorEditPanel.__loaded) {
    // Already loaded (sync hot-reload / duplicate script tag). Bail.
    return;
  }

  var VERSION = '0.2.0';
  // v0.2.0 — (1) pill-group fix: renderer now toggles `.is-selected` (the
  // class the CSS actually styles — v0.1.x toggled `.is-active`, so active
  // pills never highlighted); CSS upgraded to honour per-option
  // `--pill-accent`. (2) Library-style themed section banners: a section
  // entry may be an object `{ section, icon, iconHtml, pill, tint }` —
  // renders icon + tinted uppercase label + pill chip + rule line (plain
  // string sections unchanged). (3) v0.1.1 carried the is-open visibility
  // fix + reader-normalised dirty baseline.

  // --------------------------------------------------------------------
  // DOM helpers
  // --------------------------------------------------------------------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class' || k === 'className') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function deepGet(obj, path) {
    if (!path) return undefined;
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function deepSet(obj, path, value) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') {
        cur[parts[i]] = {};
      }
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    return obj;
  }

  function shallowEqual(a, b) {
    // JSON-equal check — good enough for record diffing (records are plain data)
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }

  function dispatch(name, detail) {
    try {
      document.dispatchEvent(new CustomEvent('sonor-edit-panel:' + name, { detail: detail || {} }));
    } catch (e) { /* no-op */ }
  }

  // --------------------------------------------------------------------
  // State (single modal at a time — stack would be overkill for now)
  // --------------------------------------------------------------------
  var state = {
    open: false,
    backdrop: null,
    panel: null,
    initialRecord: null,  // snapshot at open time (for dirty check)
    workingRecord: null,  // live mutable copy
    schema: null,
    opts: null,
    fieldInputs: {},       // key -> input element
    errors: {}             // key -> error string
  };

  // --------------------------------------------------------------------
  // Field renderers (one per type)
  // --------------------------------------------------------------------
  var renderers = {

    text: function (field, value) {
      var input = el('input', {
        class: 'sonor-edit-input',
        type: 'text',
        'data-key': field.key,
        maxlength: field.maxLength || null,
        placeholder: field.placeholder || '',
        value: value == null ? '' : String(value)
      });
      return input;
    },

    textarea: function (field, value) {
      var ta = el('textarea', {
        class: 'sonor-edit-textarea',
        'data-key': field.key,
        rows: field.rows || 3,
        maxlength: field.maxLength || null,
        placeholder: field.placeholder || ''
      });
      ta.value = value == null ? '' : String(value);
      return ta;
    },

    number: function (field, value) {
      var input = el('input', {
        class: 'sonor-edit-input',
        type: 'number',
        'data-key': field.key,
        step: field.step || 'any',
        min: field.min != null ? field.min : null,
        max: field.max != null ? field.max : null,
        value: value == null ? '' : String(value)
      });
      return input;
    },

    select: function (field, value) {
      var sel = el('select', { class: 'sonor-edit-select', 'data-key': field.key });
      (field.options || []).forEach(function (opt) {
        var o = typeof opt === 'string' ? { value: opt, label: opt } : opt;
        var optNode = el('option', { value: o.value, text: o.label });
        if (String(o.value) === String(value)) optNode.selected = true;
        sel.appendChild(optNode);
      });
      return sel;
    },

    toggle: function (field, value) {
      var id = 'sonor-edit-toggle-' + field.key.replace(/[^a-z0-9]/gi, '-');
      var wrap = el('label', { class: 'sonor-edit-toggle', for: id });
      var input = el('input', {
        type: 'checkbox',
        id: id,
        'data-key': field.key,
        class: 'sonor-edit-toggle-input'
      });
      if (value) input.checked = true;
      var knob = el('span', { class: 'sonor-edit-toggle-knob' });
      var lbl = el('span', { class: 'sonor-edit-toggle-label', text: value ? 'On' : 'Off' });
      input.addEventListener('change', function () {
        lbl.textContent = input.checked ? 'On' : 'Off';
      });
      wrap.appendChild(input);
      wrap.appendChild(knob);
      wrap.appendChild(lbl);
      // Register the real input for later reads
      wrap.__input = input;
      return wrap;
    },

    colour: function (field, value) {
      // Colour = <input type=color> + text hex input side-by-side, synced.
      var hex = value || '#999999';
      var wrap = el('div', { class: 'sonor-edit-colour' });
      var swatch = el('input', {
        type: 'color',
        class: 'sonor-edit-colour-swatch',
        'data-key': field.key,
        value: hex
      });
      var text = el('input', {
        type: 'text',
        class: 'sonor-edit-colour-text',
        'data-key': field.key + '::text',
        maxlength: 7,
        value: hex
      });
      swatch.addEventListener('input', function () { text.value = swatch.value; markDirty(); });
      text.addEventListener('input', function () {
        var v = text.value.trim();
        if (/^#[0-9a-f]{6}$/i.test(v)) swatch.value = v;
        markDirty();
      });
      wrap.appendChild(swatch);
      wrap.appendChild(text);
      wrap.__input = swatch; // read value from swatch (always 7-char hex)
      return wrap;
    },

    'pill-group': function (field, value) {
      var wrap = el('div', { class: 'sonor-edit-pill-group', 'data-key': field.key });
      var current = value;
      var buttons = [];
      (field.options || []).forEach(function (opt) {
        var o = typeof opt === 'string' ? { value: opt, label: opt } : opt;
        var btn = el('button', {
          type: 'button',
          class: 'sonor-edit-pill' + (String(o.value) === String(current) ? ' is-selected' : ''),
          'data-value': o.value,
          text: o.label
        });
        if (o.colour) btn.style.setProperty('--pill-accent', o.colour);
        btn.addEventListener('click', function () {
          current = o.value;
          buttons.forEach(function (b) { b.classList.toggle('is-selected', b.getAttribute('data-value') === String(current)); });
          markDirty();
        });
        buttons.push(btn);
        wrap.appendChild(btn);
      });
      wrap.__read = function () { return current; };
      return wrap;
    },

    readonly: function (field, value) {
      return el('div', {
        class: 'sonor-edit-readonly',
        'data-key': field.key,
        text: value == null ? '—' : String(value)
      });
    }
  };

  // --------------------------------------------------------------------
  // Field reader — maps DOM element back to a scalar value
  // --------------------------------------------------------------------
  function readField(field, node) {
    var type = field.type || 'text';
    if (type === 'toggle' && node.__input) return !!node.__input.checked;
    if (type === 'colour' && node.__input) return node.__input.value;
    if (type === 'pill-group' && typeof node.__read === 'function') return node.__read();
    if (type === 'number') {
      var n = node.value;
      if (n === '') return null;
      var f = parseFloat(n);
      return isNaN(f) ? null : f;
    }
    if (type === 'readonly') return deepGet(state.workingRecord, field.key);
    return node.value == null ? '' : node.value;
  }

  // --------------------------------------------------------------------
  // Validation
  // --------------------------------------------------------------------
  function validate() {
    state.errors = {};
    var ok = true;
    (state.schema || []).forEach(function (field) {
      if (!field.key) return; // section markers
      var v = readField(field, state.fieldInputs[field.key]);
      if (field.required && (v == null || v === '')) {
        state.errors[field.key] = (field.label || field.key) + ' is required';
        ok = false;
      } else if (typeof field.validate === 'function') {
        var result = field.validate(v, state.workingRecord);
        if (result && typeof result === 'string') {
          state.errors[field.key] = result;
          ok = false;
        }
      }
    });
    // Paint validation state
    (state.schema || []).forEach(function (field) {
      if (!field.key) return;
      var wrap = state.panel && state.panel.querySelector('.sonor-edit-field[data-key="' + field.key + '"]');
      if (!wrap) return;
      if (state.errors[field.key]) {
        wrap.setAttribute('data-invalid', '1');
        var msg = wrap.querySelector('.sonor-edit-field-error');
        if (msg) msg.textContent = state.errors[field.key];
      } else {
        wrap.removeAttribute('data-invalid');
        var m2 = wrap.querySelector('.sonor-edit-field-error');
        if (m2) m2.textContent = '';
      }
    });
    return ok;
  }

  // --------------------------------------------------------------------
  // Dirty-state tracking
  // --------------------------------------------------------------------
  function collectCurrent() {
    var out = JSON.parse(JSON.stringify(state.initialRecord || {}));
    (state.schema || []).forEach(function (field) {
      if (!field.key) return;
      var input = state.fieldInputs[field.key];
      if (!input) return;
      deepSet(out, field.key, readField(field, input));
    });
    return out;
  }

  function markDirty() {
    if (!state.open) return;
    var current = collectCurrent();
    state.workingRecord = current;
    var dirty = !shallowEqual(current, state.initialRecord);
    if (state.panel) state.panel.setAttribute('data-dirty', dirty ? '1' : '0');
    var saveBtn = state.panel && state.panel.querySelector('.sonor-edit-btn-save');
    if (saveBtn) {
      var valid = validate();
      saveBtn.disabled = !dirty || !valid;
    }
  }

  // --------------------------------------------------------------------
  // Render the schema into the panel body
  // --------------------------------------------------------------------
  function renderBody(body, schema, record) {
    body.innerHTML = '';
    state.fieldInputs = {};

    (schema || []).forEach(function (field) {
      // Section marker — plain string label, or themed banner object
      // { section, icon, iconHtml, pill, tint } (v0.2.0, Library-style).
      if (field.section) {
        var sec = el('div', { class: 'sonor-edit-section' });
        if (field.tint) sec.style.setProperty('--sec-tint', field.tint);
        if (field.iconHtml) sec.appendChild(el('span', { class: 'sonor-edit-section-icon', html: field.iconHtml }));
        else if (field.icon) sec.appendChild(el('span', { class: 'sonor-edit-section-icon', text: field.icon }));
        sec.appendChild(el('span', { class: 'sonor-edit-section-label', text: field.section }));
        if (field.pill) sec.appendChild(el('span', { class: 'sonor-edit-section-pill', text: field.pill }));
        sec.appendChild(el('span', { class: 'sonor-edit-section-rule' }));
        body.appendChild(sec);
        return;
      }
      if (!field.key) return;

      var type = field.type || 'text';
      var renderer = renderers[type] || renderers.text;
      var rawVal = deepGet(record, field.key);
      var inputNode = renderer(field, rawVal);

      var wrap = el('div', {
        class: 'sonor-edit-field',
        'data-key': field.key,
        'data-type': type,
        'data-required': field.required ? '1' : null
      });
      if (field.label) {
        wrap.appendChild(el('label', { class: 'sonor-edit-label', text: field.label }));
      }
      wrap.appendChild(inputNode);
      if (field.help) {
        wrap.appendChild(el('div', { class: 'sonor-edit-help', text: field.help }));
      }
      wrap.appendChild(el('div', { class: 'sonor-edit-field-error', text: '' }));

      body.appendChild(wrap);
      state.fieldInputs[field.key] = inputNode;

      // Wire change/input listeners for dirty tracking
      var listen = inputNode;
      if (listen.__input) listen = listen.__input; // toggle, colour
      if (type !== 'pill-group' && type !== 'readonly') {
        listen.addEventListener('input', markDirty);
        listen.addEventListener('change', markDirty);
      }
    });
  }

  // --------------------------------------------------------------------
  // Build the panel shell (header + body + footer)
  // --------------------------------------------------------------------
  function buildPanel(opts) {
    var panel = el('aside', {
      class: 'sonor-edit-panel',
      'data-dirty': '0',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': opts.title || 'Edit'
    });

    // Header
    var header = el('header', { class: 'sonor-edit-header' });
    var titles = el('div', { class: 'sonor-edit-titles' });
    titles.appendChild(el('h2', { class: 'sonor-edit-title', text: opts.title || 'Edit' }));
    if (opts.subtitle) {
      titles.appendChild(el('p', { class: 'sonor-edit-subtitle', text: opts.subtitle }));
    }
    header.appendChild(titles);
    var closeBtn = el('button', {
      type: 'button',
      class: 'sonor-edit-btn-close',
      'aria-label': 'Close',
      html: '&times;'
    });
    closeBtn.addEventListener('click', function () { close('cancel'); });
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Body
    var body = el('div', { class: 'sonor-edit-body' });
    panel.appendChild(body);

    // Footer
    var footer = el('footer', { class: 'sonor-edit-footer' });
    var leftGroup = el('div', { class: 'sonor-edit-footer-left' });
    if (typeof opts.onDelete === 'function' && !opts.readonly) {
      var delBtn = el('button', {
        type: 'button',
        class: 'sonor-edit-btn sonor-edit-btn-delete',
        text: opts.deleteLabel || 'Delete'
      });
      delBtn.addEventListener('click', function () { handleDelete(); });
      leftGroup.appendChild(delBtn);
    }
    footer.appendChild(leftGroup);

    var rightGroup = el('div', { class: 'sonor-edit-footer-right' });
    var cancelBtn = el('button', {
      type: 'button',
      class: 'sonor-edit-btn sonor-edit-btn-cancel',
      text: 'Cancel'
    });
    cancelBtn.addEventListener('click', function () { close('cancel'); });
    rightGroup.appendChild(cancelBtn);

    if (!opts.readonly) {
      var saveBtn = el('button', {
        type: 'button',
        class: 'sonor-edit-btn sonor-edit-btn-save',
        text: opts.saveLabel || 'Save'
      });
      saveBtn.disabled = true;
      saveBtn.addEventListener('click', function () { handleSave(); });
      rightGroup.appendChild(saveBtn);
    }
    footer.appendChild(rightGroup);
    panel.appendChild(footer);

    return { panel: panel, body: body };
  }

  // --------------------------------------------------------------------
  // Save / delete / close flow
  // --------------------------------------------------------------------
  function handleSave() {
    if (!validate()) return;
    var current = collectCurrent();
    state.workingRecord = current;
    var result = null;
    if (typeof state.opts.onSave === 'function') {
      try {
        result = state.opts.onSave(current, state.initialRecord);
      } catch (err) {
        console.error('[SonorEditPanel] onSave threw', err);
        return;
      }
    }
    // onSave may return a Promise
    if (result && typeof result.then === 'function') {
      var saveBtn = state.panel.querySelector('.sonor-edit-btn-save');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
      result.then(function () {
        dispatch('save', { record: current, initial: state.initialRecord });
        close('save');
      }).catch(function (err) {
        console.error('[SonorEditPanel] save failed', err);
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = state.opts.saveLabel || 'Save'; }
        alert('Save failed: ' + (err && err.message ? err.message : err));
      });
    } else {
      dispatch('save', { record: current, initial: state.initialRecord });
      close('save');
    }
  }

  function handleDelete() {
    if (!confirm('Delete this record? This cannot be undone.')) return;
    if (typeof state.opts.onDelete === 'function') {
      var r = state.opts.onDelete(state.initialRecord);
      if (r && typeof r.then === 'function') {
        r.then(function () { dispatch('delete', { record: state.initialRecord }); close('delete'); })
         .catch(function (err) { alert('Delete failed: ' + (err && err.message ? err.message : err)); });
        return;
      }
    }
    dispatch('delete', { record: state.initialRecord });
    close('delete');
  }

  function close(reason) {
    if (!state.open) return;
    // Dirty guard
    if (reason === 'cancel') {
      var current = collectCurrent();
      if (!shallowEqual(current, state.initialRecord)) {
        if (!confirm('Discard unsaved changes?')) return;
      }
    }
    state.open = false;
    if (state.backdrop) {
      // v0.1.1 — removing `.is-open` runs the CSS exit transitions
      // (backdrop fade + panel slide-out); `.is-closing` kept for any
      // future app-level styling hooks.
      state.backdrop.classList.remove('is-open');
      var _p = state.backdrop.querySelector('.sonor-edit-panel');
      if (_p) _p.classList.remove('is-open');
      state.backdrop.classList.add('is-closing');
      setTimeout(function () {
        if (state.backdrop && state.backdrop.parentNode) state.backdrop.parentNode.removeChild(state.backdrop);
        state.backdrop = null;
        state.panel = null;
        state.fieldInputs = {};
        state.initialRecord = null;
        state.workingRecord = null;
        state.schema = null;
        var opts = state.opts; state.opts = null;
        if (opts && typeof opts.onClose === 'function') {
          try { opts.onClose(reason); } catch (e) { console.error(e); }
        }
        dispatch('close', { reason: reason });
      }, 200);
    }
    document.removeEventListener('keydown', onKeyDown, true);
  }

  function onKeyDown(e) {
    if (!state.open) return;
    if (e.key === 'Escape') { e.preventDefault(); close('cancel'); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      var saveBtn = state.panel && state.panel.querySelector('.sonor-edit-btn-save');
      if (saveBtn && !saveBtn.disabled) handleSave();
    }
  }

  // --------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------
  function open(opts) {
    if (state.open) close('cancel'); // single-modal contract
    opts = opts || {};
    var record = opts.record ? JSON.parse(JSON.stringify(opts.record)) : {};
    var schema = opts.schema || [];

    state.opts = opts;
    state.schema = schema;
    state.initialRecord = JSON.parse(JSON.stringify(record));
    state.workingRecord = record;
    state.errors = {};

    var built = buildPanel(opts);
    state.panel = built.panel;

    var backdrop = el('div', { class: 'sonor-edit-backdrop' });
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) close('cancel');
    });
    backdrop.appendChild(built.panel);
    state.backdrop = backdrop;

    // Apply theme inheritance — the panel scopes dark theme via [data-theme]
    // on <html>, which it already picks up. No explicit forwarding needed.

    document.body.appendChild(backdrop);
    renderBody(built.body, schema, record);

    // v0.1.1 — visibility contract fix: the CSS gates visibility on
    // `.is-open` (backdrop: opacity 0 / pointer-events none; panel:
    // translateX(100%)) but v0.1.0 never added it, so the panel opened
    // invisible + off-screen and the inert-looking backdrop swallowed the
    // next click (surfacing as a phantom "Discard unsaved changes?").
    // Double-rAF so the entry transition animates from the initial state.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (state.backdrop !== backdrop) return; // closed/reopened meanwhile
        backdrop.classList.add('is-open');
        built.panel.classList.add('is-open');
      });
    });

    // v0.1.1 — dirty-baseline fix: snapshot the initial record THROUGH the
    // field readers, so renderer coercions (null → '' on text inputs, etc.)
    // don't register as phantom dirt the moment the panel opens.
    state.initialRecord = collectCurrent();
    validate();
    markDirty();

    // Focus first editable input
    setTimeout(function () {
      var first = built.body.querySelector('input, select, textarea, button');
      if (first) try { first.focus(); } catch (e) { /* noop */ }
    }, 240);

    state.open = true;
    document.addEventListener('keydown', onKeyDown, true);
    dispatch('open', { record: record });
  }

  function isOpen() { return !!state.open; }

  function getWorkingRecord() { return state.workingRecord ? JSON.parse(JSON.stringify(state.workingRecord)) : null; }

  // --------------------------------------------------------------------
  // Export
  // --------------------------------------------------------------------
  global.SonorEditPanel = {
    __loaded: true,
    version: VERSION,
    open: open,
    close: function () { close('cancel'); },
    isOpen: isOpen,
    getWorkingRecord: getWorkingRecord,
    // Expose renderers so callers can add custom types
    registerFieldType: function (typeName, renderer) {
      if (typeof renderer !== 'function') throw new Error('renderer must be a function');
      renderers[typeName] = renderer;
    }
  };
  global.SONOR_EDIT_PANEL_VERSION = VERSION;

})(window);
