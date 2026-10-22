(() => {
  'use strict';

  /* ---------- Helpers ---------- */
  const KEY = 'notes-dashboard:v1';
  const COLORS = ['', 'green', 'blue', 'amber', 'rose'];
  const VIEWS = [['all', 'All notes'], ['pinned', 'Pinned'], ['archive', 'Archive'], ['trash', 'Trash']];
  const $ = (s, r = document) => r.querySelector(s);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = n => String(n).padStart(2, '0');
  const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const words = s => (s.trim().match(/\S+/g) || []).length;
  const ago = t => {
    const m = Math.floor((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    if (m < 1440) return `${Math.floor(m / 60)}h ago`;
    if (m < 10080) return `${Math.floor(m / 1440)}d ago`;
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  /* ---------- State ---------- */
  const seed = () => {
    const now = Date.now();
    const mk = (title, body, tags, pinned, color) => ({
      id: uid(), title, body, tags, pinned, archived: false, trashed: false, color, created: now, updated: now
    });
    return {
      theme: '',
      activity: {},
      notes: [
        mk('Welcome to your notes', 'Everything you write is saved in this browser only. Nothing is uploaded.\n\nUse Export backup in the sidebar to keep a copy, or to move your notes to another device.', ['start'], true, 'blue'),
        mk('Shortcuts', 'Alt+N  new note\nCtrl+K  search\nEsc  close the editor', ['start'], false, '')
      ]
    };
  };
  const load = () => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.notes)) { s.activity = s.activity || {}; s.theme = s.theme || ''; return s; }
    } catch (e) { /* fall through to seed */ }
    return seed();
  };

  let state = load();
  const ui = { view: 'all', tag: null, q: '', sort: 'updated', openId: null };
  let saveTimer, editTimer, toastTimer;

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); }
      catch (e) { toast('Storage is full. Export a backup, then delete old notes.'); }
    }, 150);
  };

  const inView = (n, v) => {
    if (v === 'trash') return n.trashed;
    if (n.trashed) return false;
    if (v === 'archive') return n.archived;
    if (n.archived) return false;
    return v === 'pinned' ? n.pinned : true;
  };
  const byId = id => state.notes.find(n => n.id === id);

  const visible = () => {
    const q = ui.q.trim().toLowerCase();
    let list = state.notes.filter(n => inView(n, ui.view));
    if (ui.tag) list = list.filter(n => n.tags.includes(ui.tag));
    if (q) list = list.filter(n => (n.title + ' ' + n.body + ' ' + n.tags.join(' ')).toLowerCase().includes(q));
    const sorters = {
      updated: (a, b) => b.updated - a.updated,
      created: (a, b) => b.created - a.created,
      title: (a, b) => a.title.localeCompare(b.title)
    };
    list.sort((a, b) => (ui.view === 'all' ? b.pinned - a.pinned : 0) || sorters[ui.sort](a, b));
    return list;
  };

  const logActivity = t => { const k = dayKey(t); state.activity[k] = (state.activity[k] || 0) + 1; };

  /* ---------- Rendering ---------- */
  const renderSide = () => {
    $('#views').innerHTML = VIEWS.map(([id, label]) => {
      const n = state.notes.filter(x => inView(x, id)).length;
      return `<button class="view-btn" data-view="${id}" aria-current="${ui.view === id}"><span>${label}</span><span>${n}</span></button>`;
    }).join('');

    const counts = {};
    state.notes.filter(n => !n.trashed).forEach(n => n.tags.forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    const tags = Object.keys(counts).sort();
    $('#tagList').innerHTML = tags.length
      ? tags.map(t => `<button class="tag-btn" data-tag="${esc(t)}" aria-pressed="${ui.tag === t}"><span>${esc(t)}</span><span>${counts[t]}</span></button>`).join('')
      : '<span class="muted" style="padding-left:.65rem">No tags yet</span>';

    $('#themeBtn').textContent = 'Theme: ' + (state.theme || 'auto');
  };

  const streak = () => {
    const d = new Date();
    if (!state.activity[dayKey(d)]) d.setDate(d.getDate() - 1); // today doesn't break a streak until it's over
    let n = 0;
    while (state.activity[dayKey(d)] > 0) { n++; d.setDate(d.getDate() - 1); }
    return n;
  };

  const renderStats = () => {
    const live = state.notes.filter(n => inView(n, 'all') || n.archived && !n.trashed);
    const today = dayKey(Date.now());
    const s = streak();
    const items = [
      [live.length, live.length === 1 ? 'note' : 'notes'],
      [live.reduce((a, n) => a + words(n.body), 0).toLocaleString(), 'words written'],
      [live.filter(n => dayKey(n.updated) === today).length, 'edited today'],
      [s, s === 1 ? 'day streak' : 'day streak']
    ];
    $('#stats').innerHTML = items.map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  };

  const renderHeat = () => {
    const WEEKS = 16;
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const start = new Date(now); start.setDate(now.getDate() - ((WEEKS - 1) * 7 + now.getDay()));
    let html = '', total = 0;
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      if (d > now) { html += '<i class="future"></i>'; continue; }
      const k = dayKey(d), c = state.activity[k] || 0;
      total += c;
      const lvl = c === 0 ? 0 : c < 3 ? 1 : c < 7 ? 2 : c < 15 ? 3 : 4;
      html += `<i class="l${lvl}${d.getTime() === now.getTime() ? ' today' : ''}" title="${k}: ${c} edit${c === 1 ? '' : 's'}"></i>`;
    }
    $('#heat').innerHTML = html;
    $('#heatTotal').textContent = `${total} edit${total === 1 ? '' : 's'} in 16 weeks`;
    const box = $('#heat'); box.scrollLeft = box.scrollWidth;
  };

  const EMPTY = {
    all: 'No notes here yet. Choose New note to write your first one.',
    pinned: 'Nothing pinned. Open a note and choose Pin to keep it at the top.',
    archive: 'The archive is empty. Archive notes you want out of the way but not deleted.',
    trash: 'Trash is empty. Deleted notes stay here until you remove them for good.'
  };

  const renderList = () => {
    const label = VIEWS.find(v => v[0] === ui.view)[1];
    $('#listTitle').textContent = ui.tag ? `${label} tagged “${ui.tag}”` : label;
    $('#emptyTrash').hidden = !(ui.view === 'trash' && state.notes.some(n => n.trashed));
    const list = visible();
    if (!list.length) {
      $('#list').innerHTML = `<p class="empty">${ui.q || ui.tag ? 'No notes match. Clear the search or tag filter.' : EMPTY[ui.view]}</p>`;
      return;
    }
    $('#list').innerHTML = list.map(n => `
      <article class="card" tabindex="0" data-id="${n.id}" data-color="${n.color}" aria-current="${ui.openId === n.id}">
        <h3>${esc(n.title || 'Untitled')}</h3>
        ${n.body ? `<p>${esc(n.body.slice(0, 220))}${n.body.length > 220 ? '…' : ''}</p>` : ''}
        ${n.tags.length ? `<div class="chips">${n.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="card-meta"><span>${n.pinned ? 'Pinned' : ''}</span><span>${ago(n.updated)}</span></div>
      </article>`).join('');
  };

  const renderAll = () => { renderSide(); renderStats(); renderHeat(); renderList(); };

  /* ---------- Editor ---------- */
  const syncEditorChrome = n => {
    $('#ePin').textContent = n.pinned ? 'Unpin' : 'Pin';
    $('#eArchive').textContent = n.archived ? 'Unarchive' : 'Archive';
    $('#eTrash').textContent = n.trashed ? 'Restore' : 'Move to trash';
    $('#eDelete').hidden = !n.trashed;
    $('#eCount').textContent = `${words(n.body)} word${words(n.body) === 1 ? '' : 's'}`;
    $('#eColors').innerHTML = COLORS.map(c =>
      `<button class="sw" data-c="${c}" aria-label="${c || 'No color'}" aria-pressed="${n.color === c}"></button>`).join('');
  };

  const openNote = (id, focusTitle) => {
    const n = byId(id); if (!n) return;
    ui.openId = id;
    $('#eTitle').value = n.title;
    $('#eBody').value = n.body;
    $('#eTags').value = n.tags.join(', ');
    $('#eStatus').textContent = 'Saved';
    syncEditorChrome(n);
    $('#editor').hidden = false;
    $('#app').classList.add('has-editor');
    renderList();
    if (focusTitle) $('#eTitle').focus();
  };

  const closeEditor = () => {
    flushEdit();
    const n = byId(ui.openId);
    if (n && !n.title.trim() && !n.body.trim() && !n.tags.length) { // discard blank notes
      state.notes = state.notes.filter(x => x !== n);
      save();
    }
    ui.openId = null;
    $('#editor').hidden = true;
    $('#app').classList.remove('has-editor');
    renderAll();
  };

  const parseTags = v => [...new Set(v.split(',').map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))];

  const flushEdit = () => {
    if (!editTimer) return;
    clearTimeout(editTimer); editTimer = null;
    const n = byId(ui.openId); if (!n) return;
    logActivity(n.updated); save();
    $('#eStatus').textContent = 'Saved';
    renderSide(); renderStats(); renderHeat(); renderList();
  };

  const onEdit = () => {
    const n = byId(ui.openId); if (!n) return;
    n.title = $('#eTitle').value;
    n.body = $('#eBody').value;
    n.tags = parseTags($('#eTags').value);
    n.updated = Date.now();
    $('#eCount').textContent = `${words(n.body)} word${words(n.body) === 1 ? '' : 's'}`;
    $('#eStatus').textContent = 'Saving…';
    clearTimeout(editTimer);
    editTimer = setTimeout(flushEdit, 700);
  };

  const newNote = () => {
    flushEdit();
    if (ui.view === 'trash' || ui.view === 'archive') ui.view = 'all';
    ui.q = ''; ui.tag = null; $('#search').value = '';
    const now = Date.now();
    const n = { id: uid(), title: '', body: '', tags: [], pinned: false, archived: false, trashed: false, color: '', created: now, updated: now };
    state.notes.unshift(n);
    save(); renderAll(); openNote(n.id, true);
  };

  const mutate = (fn, message, undo) => {
    const n = byId(ui.openId); if (!n) return;
    flushEdit();
    const before = { pinned: n.pinned, archived: n.archived, trashed: n.trashed };
    fn(n); n.updated = Date.now(); save();
    if (message) toast(message, undo ? () => { Object.assign(n, before); save(); renderAll(); } : null);
  };

  /* ---------- Toast ---------- */
  const toast = (msg, undo) => {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>`;
    if (undo) {
      const b = document.createElement('button');
      b.textContent = 'Undo';
      b.onclick = () => { undo(); t.hidden = true; };
      t.appendChild(b);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
  };

  /* ---------- Backup ---------- */
  const exportData = () => {
    flushEdit();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `notes-backup-${dayKey(Date.now())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Backup downloaded');
  };

  const importData = file => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data || !Array.isArray(data.notes)) throw new Error('bad file');
        let added = 0;
        data.notes.forEach(n => {
          if (!n || typeof n !== 'object' || !n.id) return;
          const clean = {
            id: String(n.id), title: String(n.title || ''), body: String(n.body || ''),
            tags: Array.isArray(n.tags) ? n.tags.map(String) : [], pinned: !!n.pinned, archived: !!n.archived,
            trashed: !!n.trashed, color: COLORS.includes(n.color) ? n.color : '',
            created: Number(n.created) || Date.now(), updated: Number(n.updated) || Date.now()
          };
          const i = state.notes.findIndex(x => x.id === clean.id);
          if (i >= 0) state.notes[i] = clean; else { state.notes.push(clean); added++; }
        });
        Object.entries(data.activity || {}).forEach(([k, v]) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number(v) > (state.activity[k] || 0)) state.activity[k] = Number(v);
        });
        save(); renderAll();
        toast(`Imported ${added} new note${added === 1 ? '' : 's'}`);
      } catch (e) { toast('That file is not a valid notes backup.'); }
    };
    r.readAsText(file);
  };

  /* ---------- Events ---------- */
  $('#newBtn').onclick = newNote;
  $('#eClose').onclick = closeEditor;
  $('#exportBtn').onclick = exportData;
  $('#importFile').onchange = e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; };
  $('#importLabel').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#importFile').click(); } };

  $('#themeBtn').onclick = () => {
    const order = ['', 'light', 'dark'];
    state.theme = order[(order.indexOf(state.theme) + 1) % 3];
    document.documentElement.dataset.theme = state.theme;
    if (!state.theme) delete document.documentElement.dataset.theme;
    save(); renderSide();
  };

  $('#search').oninput = e => { ui.q = e.target.value; renderList(); };
  $('#sort').onchange = e => { ui.sort = e.target.value; renderList(); };

  $('#views').onclick = e => {
    const b = e.target.closest('[data-view]'); if (!b) return;
    ui.view = b.dataset.view; renderSide(); renderList();
  };
  $('#tagList').onclick = e => {
    const b = e.target.closest('[data-tag]'); if (!b) return;
    ui.tag = ui.tag === b.dataset.tag ? null : b.dataset.tag; renderSide(); renderList();
  };

  const openFromCard = e => {
    const c = e.target.closest('.card'); if (!c) return;
    flushEdit(); openNote(c.dataset.id);
  };
  $('#list').onclick = openFromCard;
  $('#list').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFromCard(e); } };

  ['#eTitle', '#eBody', '#eTags'].forEach(s => $(s).addEventListener('input', onEdit));

  $('#eColors').onclick = e => {
    const b = e.target.closest('.sw'); if (!b) return;
    mutate(n => { n.color = b.dataset.c; });
    syncEditorChrome(byId(ui.openId)); renderAll();
  };
  $('#ePin').onclick = () => {
    mutate(n => { n.pinned = !n.pinned; }, null);
    syncEditorChrome(byId(ui.openId)); renderAll();
  };
  $('#eArchive').onclick = () => {
    const n = byId(ui.openId); const was = n.archived;
    mutate(x => { x.archived = !was; }, was ? 'Moved back to notes' : 'Archived', true);
    closeEditor();
  };
  $('#eTrash').onclick = () => {
    const n = byId(ui.openId);
    if (n.trashed) { mutate(x => { x.trashed = false; }, 'Restored'); closeEditor(); return; }
    mutate(x => { x.trashed = true; }, 'Moved to trash', true);
    closeEditor();
  };
  $('#eDelete').onclick = () => {
    const n = byId(ui.openId);
    if (!n || !confirm('Delete this note forever? This cannot be undone.')) return;
    state.notes = state.notes.filter(x => x !== n);
    save(); closeEditor();
  };
  $('#emptyTrash').onclick = () => {
    const count = state.notes.filter(n => n.trashed).length;
    if (!count || !confirm(`Delete ${count} note${count === 1 ? '' : 's'} forever? This cannot be undone.`)) return;
    state.notes = state.notes.filter(n => !n.trashed);
    save(); renderAll();
  };

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
    else if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
    else if (e.key === 'Escape' && ui.openId) closeEditor();
  });

  // Keep several open tabs in sync
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    if (ui.openId) flushEdit();
    state = load();
    if (ui.openId && !byId(ui.openId)) { ui.openId = null; $('#editor').hidden = true; $('#app').classList.remove('has-editor'); }
    renderAll();
  });

  // Persist any pending edit if the tab is closed
  window.addEventListener('beforeunload', () => { flushEdit(); try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } });

  /* ---------- Init ---------- */
  if (state.theme) document.documentElement.dataset.theme = state.theme;
  renderAll();
})();
