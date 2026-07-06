const dzA = document.getElementById('diff-dz-a');
const dzB = document.getElementById('diff-dz-b');

function _diffDZSetup(dz, inputId, innerId, side) {
  const input = document.getElementById(inputId);
  const inner = document.getElementById(innerId);
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', async e => {
    e.preventDefault(); dz.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) await _diffSelectFile(f, side, inner, dz);
  });
  input.addEventListener('change', async e => {
    if (e.target.files[0]) await _diffSelectFile(e.target.files[0], side, inner, dz);
  });
}

async function _diffSelectFile(file, side, inner, dz) {
  if (!(await _isElf(file))) {
    dz.className = 'diff-dropzone error';
    inner.innerHTML = `<p style="color:var(--red);font-size:12px;font-weight:500;">Unsupported format</p><p style="color:var(--muted);font-size:10px;margin-top:4px;">Only .elf files are accepted.</p>`;
    return;
  }
  if (side === 'a') _diffFileA = file; else _diffFileB = file;
  dz.className = 'diff-dropzone loaded';
  inner.innerHTML = `
    <p style="color:var(--green);font-size:12px;font-weight:500;">✓ ${escapeHtml(file.name)}</p>
    <p style="color:var(--muted);font-size:10px;margin-top:4px;font-family:'IBM Plex Mono',monospace;">${(file.size/1024).toFixed(1)} KB</p>`;
  _diffTryRun();
}

function _diffTryRun() {
  if (_diffFileA && _diffFileB) uploadDiff(_diffFileA, _diffFileB);
}

_diffDZSetup(dzA, 'diff-input-a', 'diff-dz-a-inner', 'a');
_diffDZSetup(dzB, 'diff-input-b', 'diff-dz-b-inner', 'b');

async function uploadDiff(fileA, fileB) {
  _parsing = true;
  document.getElementById('diff-toggle').disabled = true;
  const progress = document.getElementById('diff-progress');
  const errorEl = document.getElementById('diff-upload-error');
  progress.style.display = '';
  errorEl.style.display = 'none';
  const fd = new FormData();
  fd.append('file_a', fileA);
  fd.append('file_b', fileB);
  try {
    const res = await fetch('/diff', { method:'POST', body:fd });
    if (!res.ok) {
      const err = await res.json().catch(()=>({detail:'Server error'}));
      throw new Error(err.detail || res.statusText);
    }
    DiffData = await res.json();
    _parsing = false;
    document.getElementById('diff-toggle').disabled = false;
    progress.style.display = 'none';
    initDiff(fileA.name, fileB.name);
  } catch(e) {
    _parsing = false;
    document.getElementById('diff-toggle').disabled = false;
    progress.style.display = 'none';
    errorEl.style.display = '';
    errorEl.textContent = 'Diff failed: ' + e.message;
  }
}

function initDiff(nameA, nameB) {
  document.getElementById('view-diff-upload').style.display = 'none';
  document.getElementById('view-upload').style.display = 'none';
  document.getElementById('view-diff').style.display = '';
  diffMode = true;
  document.getElementById('hdr-file').textContent = escapeHtml(nameA) + ' ↔ ' + escapeHtml(nameB);
  document.getElementById('hdr-arch').textContent = 'Diff';
  document.body.classList.add('diff-mode');
  document.getElementById('sidebar').style.display = '';
  document.getElementById('diff-toggle').checked = true;
  diffTab = 'overview';
  renderDiffHeader(nameA, nameB);
  renderDiffOverview();
  document.querySelectorAll('#sidebar-diff .nav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('nav-df-overview');
  if (btn) btn.classList.add('active');
}

function renderDiffHeader(nameA, nameB) {
  const s = DiffData.summary;
  document.getElementById('diff-header').innerHTML = `
    <div class="card-header">
      <span class="card-title">${escapeHtml(nameA)}  ↔  ${escapeHtml(nameB)}</span>
      <div style="display:flex;gap:14px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted);align-items:center;">
        <span style="display:flex;align-items:center;gap:4px;"><span style="color:#6ee7b7;font-weight:600;">+${s.new_symbols}</span> new</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="color:#fca5a5;font-weight:600;">-${s.removed_symbols}</span> removed</span>
        <span style="display:flex;align-items:center;gap:4px;"><span style="color:#fcd34d;font-weight:600;">${s.changed_symbols}</span> changed</span>
        <span style="width:1px;height:16px;background:var(--border);"></span>
        <span style="font-weight:600;${s.delta_sym_size > 0 ? 'color:var(--red)' : s.delta_sym_size < 0 ? 'color:var(--green)' : 'color:var(--muted)'}">
          ${s.delta_sym_size > 0 ? '+' : ''}${fmtB(s.delta_sym_size)}
        </span>
      </div>
    </div>`;
}

function switchDiffTab(name) {
  diffTab = name;
  switch(name) {
    case 'overview': renderDiffOverview(); break;
    case 'symbols':  renderDiffSymbols(); break;
    case 'sections': renderDiffSections(); break;
    case 'sources':  renderDiffSources(); break;
    case 'objects':  renderDiffObjects(); break;
  }
}

function renderDiffOverview() {
  const s = DiffData.summary;
  const _dc = n => n > 0 ? 'delta-pos' : n < 0 ? 'delta-neg' : '';

  let html = `<div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));">`;
  const stats = [
    ['Symbols (A → B)', `${s.a_total_symbols} → ${s.b_total_symbols}`, _dc(s.b_total_symbols - s.a_total_symbols)],
    ['Total Size (A)',  fmtB(s.a_total_sym_size)],
    ['Total Size (B)',  fmtB(s.b_total_sym_size)],
    ['Δ Total Size',    `${s.delta_sym_size > 0 ? '+' : ''}${fmtB(s.delta_sym_size)}`, _dc(s.delta_sym_size)],
    ['New Symbols',     s.new_symbols, _dc(s.new_symbols)],
    ['Removed Symbols', s.removed_symbols, _dc(-s.removed_symbols)],
    ['Changed Symbols', s.changed_symbols],
    ['', ''],
    ['Writable',        `${fmtB(s.a_writable)} → ${fmtB(s.b_writable)}`, _dc(s.b_writable - s.a_writable)],
    ['Read-Only',       `${fmtB(s.a_readonly)} → ${fmtB(s.b_readonly)}`, _dc(s.b_readonly - s.a_readonly)],
    ['Executable',      `${fmtB(s.a_executable)} → ${fmtB(s.b_executable)}`, _dc(s.b_executable - s.a_executable)],
    ['', ''],
    ['Sections',        `${s.a_sections} → ${s.b_sections}`],
    ['Segments',        `${s.a_segments} → ${s.b_segments}`],
    ['Address Spaces',  `${s.a_address_spaces} → ${s.b_address_spaces}`],
  ];
  stats.forEach(([label, value, cls]) => {
    if (!label && !value) return;
    html += `<div class="stat-card"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value ${cls||''}">${value}</div></div>`;
  });
  html += `</div>`;

  const syms = DiffData.symbols;
  const gainers = syms.filter(s => s.delta > 0).sort((a,b) => b.delta - a.delta).slice(0, 10);
  const losers  = syms.filter(s => s.delta < 0).sort((a,b) => a.delta - b.delta).slice(0, 10);

  if (gainers.length || losers.length) {
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px;">`;
    if (gainers.length) {
      html += `<div style="border:1px solid var(--border);border-radius:7px;overflow:hidden;"><div style="padding:10px 14px;font-size:11px;font-weight:600;color:var(--red);border-bottom:1px solid var(--border);">Largest Gainers</div><table class="data-table" style="font-size:11px;"><thead><tr><th>Symbol</th><th style="text-align:right">Growth</th></tr></thead><tbody>`;
      gainers.forEach(g => {
        html += `<tr><td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(g.name)}</td><td style="text-align:right;color:var(--red);font-family:'IBM Plex Mono',monospace;">+${fmtB(g.delta)}</td></tr>`;
      });
      html += `</tbody></table></div>`;
    }
    if (losers.length) {
      html += `<div style="border:1px solid var(--border);border-radius:7px;overflow:hidden;"><div style="padding:10px 14px;font-size:11px;font-weight:600;color:var(--green);border-bottom:1px solid var(--border);">Largest Losers</div><table class="data-table" style="font-size:11px;"><thead><tr><th>Symbol</th><th style="text-align:right">Shrinkage</th></tr></thead><tbody>`;
      losers.forEach(g => {
        html += `<tr><td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(g.name)}</td><td style="text-align:right;color:var(--green);font-family:'IBM Plex Mono',monospace;">-${fmtB(Math.abs(g.delta))}</td></tr>`;
      });
      html += `</tbody></table></div>`;
    }
    html += `</div>`;
  }

  document.getElementById('diff-content').innerHTML = html;
}

function _diffTableHtml(items, cols) {
  if (!items.length) return `<p style="padding:16px;color:var(--muted);font-size:12px;text-align:center;">No items</p>`;
  let h = `<div class="tbl-wrap"><table class="data-table"><thead><tr>`;
  cols.forEach(c => { h += `<th style="${c.right ? 'text-align:right' : ''}">${escapeHtml(c.label)}</th>`; });
  h += `</tr></thead><tbody>`;
  items.forEach(item => {
    h += `<tr>`;
    cols.forEach(c => {
      let val = c.val(item);
      if (c.fmt) val = c.fmt(val, item);
      if (c.cls) {
        const cls = typeof c.cls === 'function' ? c.cls(item) : c.cls;
        h += `<td style="${c.right ? 'text-align:right' : ''}" class="${cls}">${val}</td>`;
      } else {
        h += `<td style="${c.right ? 'text-align:right' : ''}">${val}</td>`;
      }
    });
    h += `</tr>`;
  });
  h += `</tbody></table></div>`;
  return h;
}

function _deltaText(delta) {
  if (delta > 0) return `<span class="delta-pos">+${fmtB(delta)}</span>`;
  if (delta < 0) return `<span class="delta-neg">−${fmtB(Math.abs(delta))}</span>`;
  return `<span class="delta-zero">0</span>`;
}

function _statusBadge(status) {
  if (status === 'new')      return `<span class="badge" style="background:#065f46;color:#6ee7b7;">new</span>`;
  if (status === 'removed')  return `<span class="badge" style="background:#7f1d1d;color:#fca5a5;">removed</span>`;
  if (status === 'changed')  return `<span class="badge" style="background:#713f12;color:#fcd34d;">changed</span>`;
  return `<span class="badge" style="background:var(--surface);color:var(--muted);">unchanged</span>`;
}

function renderDiffSymbols() {
  if (diffTab !== 'symbols') return;
  const items = DiffData.symbols;
  const categories = [
    {key:'all', label:`All (${items.length})`, filter: ()=>true},
    {key:'new', label:`New (${items.filter(s=>s.status==='new').length})`, filter: s=>s.status==='new'},
    {key:'removed', label:`Removed (${items.filter(s=>s.status==='removed').length})`, filter: s=>s.status==='removed'},
    {key:'changed', label:`Changed (${items.filter(s=>s.status==='changed').length})`, filter: s=>s.status==='changed'},
  ];
  const activeCat = document.getElementById('diff-sym-cat')?.value || 'all';
  const filtered = items.filter(categories.find(c=>c.key===activeCat)?.filter || (()=>true));
  const q = (document.getElementById('diff-sym-search')?.value||'').toLowerCase();
  const searched = q ? filtered.filter(s => s.name.toLowerCase().includes(q)) : filtered;

  if (!document.getElementById('diff-sym-bar')) {
    let html = `<div id="diff-sym-bar" style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">`;
    html += `<input class="search-input" placeholder="Search symbols…" id="diff-sym-search" style="flex:1;min-width:120px;"/>`;
    html += `<select id="diff-sym-cat" style="background:var(--surface);border:1px solid var(--border2);border-radius:5px;color:var(--sub);font-family:'IBM Plex Mono',monospace;font-size:11px;padding:5px 8px;outline:none;">`;
    categories.forEach(c => { html += `<option value="${c.key}">${c.label}</option>`; });
    html += `</select>`;
    html += `<span id="diff-sym-count" style="font-size:11px;color:var(--muted);font-family:'IBM Plex Mono',monospace;"></span>`;
    html += `</div><div id="diff-sym-tbl"></div>`;
    document.getElementById('diff-content').innerHTML = html;
  }

  document.getElementById('diff-sym-cat').value = activeCat;
  document.getElementById('diff-sym-count').textContent = `${searched.length} symbols`;

  const cols = [
    {label:'Status', right:false, val:s=>_statusBadge(s.status)},
    {label:'Symbol', right:false, val:s=>escapeHtml(s.name)},
    {label:'Type', right:false, val:s=>escapeHtml(s.type)},
    {label:'Size (A)', right:true, val:s=>fmtB(s.size_a)},
    {label:'Size (B)', right:true, val:s=>fmtB(s.size_b)},
    {label:'Δ', right:true, val:s=>_deltaText(s.delta), cls:s=>s.delta>0?'delta-pos':s.delta<0?'delta-neg':''},
    {label:'Section (A)', right:false, val:s=>escapeHtml(s.section_a)},
    {label:'Section (B)', right:false, val:s=>escapeHtml(s.section_b)},
  ];
  document.getElementById('diff-sym-tbl').innerHTML = _diffTableHtml(searched, cols);
}

function renderDiffSources() {
  const items = DiffData.source_files;
  if (!items.length) {
    document.getElementById('diff-content').innerHTML = `<p style="padding:16px;color:var(--muted);font-size:12px;text-align:center;">No source file attribution changes</p>`;
    return;
  }
  const cols = [
    {label:'Status', val:s=>_statusBadge(s.status)},
    {label:'Source File', val:s=>escapeHtml(s.name)},
    {label:'Size (A)', right:true, val:s=>fmtB(s.size_a)},
    {label:'Size (B)', right:true, val:s=>fmtB(s.size_b)},
    {label:'Δ', right:true, val:s=>_deltaText(s.delta), cls:s=>s.delta>0?'delta-pos':s.delta<0?'delta-neg':''},
    {label:'Symbols (A)', right:true, val:s=>s.count_a},
    {label:'Symbols (B)', right:true, val:s=>s.count_b},
  ];
  document.getElementById('diff-content').innerHTML = _diffTableHtml(items, cols);
}

function renderDiffSections() {
  const items = DiffData.sections;
  if (!items.length) {
    document.getElementById('diff-content').innerHTML = `<p style="padding:16px;color:var(--muted);font-size:12px;text-align:center;">No section changes</p>`;
    return;
  }
  const cols = [
    {label:'Status', val:s=>_statusBadge(s.status)},
    {label:'Section', val:s=>escapeHtml(s.name)},
    {label:'Type', val:s=>escapeHtml(s.type)},
    {label:'Size (A)', right:true, val:s=>fmtB(s.size_a)},
    {label:'Size (B)', right:true, val:s=>fmtB(s.size_b)},
    {label:'Δ', right:true, val:s=>_deltaText(s.delta), cls:s=>s.delta>0?'delta-pos':s.delta<0?'delta-neg':''},
  ];
  document.getElementById('diff-content').innerHTML = _diffTableHtml(items, cols);
}

function renderDiffObjects() {
  const items = DiffData.object_files;
  if (!items.length) {
    document.getElementById('diff-content').innerHTML = `<p style="padding:16px;color:var(--muted);font-size:12px;text-align:center;">No object file changes</p>`;
    return;
  }
  const cols = [
    {label:'Status', val:s=>_statusBadge(s.status)},
    {label:'Object File', val:s=>escapeHtml(s.name)},
    {label:'Size (A)', right:true, val:s=>fmtB(s.size_a)},
    {label:'Size (B)', right:true, val:s=>fmtB(s.size_b)},
    {label:'Δ', right:true, val:s=>_deltaText(s.delta), cls:s=>s.delta>0?'delta-pos':s.delta<0?'delta-neg':''},
    {label:'Count (A)', right:true, val:s=>s.count_a},
    {label:'Count (B)', right:true, val:s=>s.count_b},
  ];
  document.getElementById('diff-content').innerHTML = _diffTableHtml(items, cols);
}

const _debouncedRenderDiffSymbols = debounce(renderDiffSymbols, 200);
document.getElementById('main').addEventListener('input', e => {
  if (e.target.id === 'diff-sym-search') _debouncedRenderDiffSymbols();
});
document.getElementById('main').addEventListener('change', e => {
  if (e.target.id === 'diff-sym-cat') renderDiffSymbols();
});
