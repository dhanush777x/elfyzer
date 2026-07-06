const _MONO_FONT = "'IBM Plex Mono',monospace";

// Upload
const dz = document.getElementById('dropzone');
dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', ()=> dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) uploadFile(f);
});
document.getElementById('file-input').addEventListener('change', e => {
  if (e.target.files[0]) uploadFile(e.target.files[0]);
});

async function uploadFile(file) {
  if (!(await _isElf(file))) {
    dz.className = 'error';
    document.getElementById('dz-inner').innerHTML = '<p style="color:var(--red);font-size:13px;font-weight:500;">Unsupported format</p><p style="color:var(--muted);font-size:11px;margin-top:4px;">Only .elf files are accepted.</p>';
    return;
  }
  _parsing = true;
  document.getElementById('diff-toggle').disabled = true;
  dz.className = 'loading';
  document.getElementById('dz-inner').innerHTML =
    '<div class="spinner" style="margin:0 auto 12px;"></div>' +
    '<p style="color:var(--purple);font-size:13px;font-weight:500;">Parsing ' + escapeHtml(file.name) + '…</p>' +
    '<p style="color:var(--muted);font-size:11px;margin-top:4px;font-family:' + _MONO_FONT + ';">Extracting sections · symbols · DWARF</p>';
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res  = await fetch('/upload', { method:'POST', body:fd });
    if (!res.ok) {
      const err = await res.json().catch(()=>({detail:'Server error'}));
      throw new Error(err.detail || res.statusText);
    }
    D = await res.json();
    _parsing = false;
    document.getElementById('diff-toggle').disabled = false;
    initApp(file.name);
  } catch(e) {
    _parsing = false;
    document.getElementById('diff-toggle').disabled = false;
    dz.className = 'error';
    document.getElementById('dz-inner').innerHTML =
      '<p style="color:var(--red);font-size:13px;font-weight:500;">Parse Error</p>' +
      '<p style="color:var(--muted);font-size:11px;margin-top:6px;font-family:' + _MONO_FONT + ';">' + escapeHtml(e.message) + '</p>';
  }
}

// Overview
function renderOverview() {
  renderWarnings();
  renderStats();
  renderAddrCards();
  renderChart();
  renderTop20();
}

function renderWarnings() {
  const el = document.getElementById('warnings-area');
  el.innerHTML = '';
  (D.warnings || []).forEach(w => {
    el.innerHTML += '<div class="warn">' +
      '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;margin-top:1px"><path d="M21.73 18.73a2 2 0 0 1-1.73 1H4a2 2 0 0 1-1.73-3l8-13.27a2 2 0 0 1 3.46 0l8 13.27a2 2 0 0 1-.16 2Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>' +
      '<span>' + escapeHtml(w) + '</span></div>';
  });
}

function renderStats() {
  const s  = D.summary;
  const el = document.getElementById('stat-grid-el');
  const items = [
    { label:'Architecture', value: s.arch + ' ' + s.bits + '-bit', color:'var(--accent)' },
    { label:'Entry Point',  value: '0x'+s.entry.toString(16).padStart(ADDR_WIDTH, '0').toUpperCase(), color:'var(--sub)' },
    { label:'Total Symbols',value: s.total_symbols.toLocaleString(), color:'var(--green)' },
    { label:'Sections',     value: s.total_sections, color:'var(--sub)' },
    { label:'Segments',     value: s.total_segments, color:'var(--sub)' },
    { label:'Addr Spaces',  value: s.address_spaces,  color:'var(--purple)' },
    { label:'Writable Sections', value: fmtB(s.writable_bytes), color:'var(--green)' },
    { label:'Read-Only Sections', value: fmtB(s.readonly_bytes), color:'var(--accent)' },
    { label:'Copied (VMA≠LMA)', value: fmtB(s.total_copy_bytes), color:'var(--purple)' },
    { label:'Zeroed (BSS)', value: fmtB(s.total_zero_bytes), color:'var(--teal)' },
    { label:'In-Place (XIP)', value: fmtB(s.total_xip_bytes), color:'var(--orange)' },
  ];
  if (s.no_sized_symbols) items.push({ label:'Note', value:'No sized symbols', color:'var(--red)' });
  el.innerHTML = items.map(i =>
    '<div class="stat">' +
      '<div class="stat-label">' + i.label + '</div>' +
      '<div class="stat-value" style="color:' + i.color + '">' + i.value + '</div>' +
    '</div>'
  ).join('');
}

function _buildSymRow(sym) {
  return '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0 3px 22px;border-bottom:1px solid rgba(31,41,55,.15);">' +
    '<span style="font-family:' + _MONO_FONT + ';font-size:10.5px;color:var(--sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;" title="' + escapeHtml(sym.name) + '">' + escapeHtml(sym.name) + '</span>' +
    '<span style="font-family:' + _MONO_FONT + ';font-size:10px;color:var(--muted);margin-left:auto;padding-left:12px;">' + fmtB(sym.size) + '</span>' +
  '</div>';
}

function _buildSectionRow(item, sc, symList, symExtra, loadedBadge, nobitsBadge) {
  let symRows = symList.map(_buildSymRow).join('');
  if (symExtra > 0) {
    symRows += '<div style="padding:3px 0 3px 22px;font-size:10px;color:var(--muted);">+ ' + symExtra + ' more</div>';
  }
  return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(31,41,55,.35);cursor:pointer;" class="sec-header" onclick="toggleSecSyms(this)">' +
    '<span style="background:' + sc + ';width:3px;height:16px;border-radius:2px;flex-shrink:0;"></span>' +
    '<span style="font-size:11px;font-weight:600;color:var(--text);font-family:' + _MONO_FONT + ';">' + escapeHtml(item.name) + '</span>' +
    loadedBadge + nobitsBadge +
    '<span class="badge" style="background:var(--border);color:var(--sub);font-size:9px;font-family:' + _MONO_FONT + ';">' + escapeHtml(item.flags) + '</span>' +
    '<span style="font-size:10px;color:var(--muted);margin-left:auto;font-family:' + _MONO_FONT + ';">' + item.symbols.length + ' sym</span>' +
    '<span style="font-family:' + _MONO_FONT + ';font-size:11px;color:var(--amber);">' + fmtB(item.actual_size) + '</span>' +
    '<span style="font-family:' + _MONO_FONT + ';font-size:11px;color:var(--muted);margin-left:8px;transition:transform .3s cubic-bezier(.4,0,.2,1);" class="sec-exp-icon">▶</span>' +
  '</div>' +
  '<div class="sec-syms" style="display:none;overflow:hidden;">' + symRows + '</div>';
}

function _buildTimelineItem(item) {
  if (item.kind === 'gap') {
    const gs = item.end - item.start;
    return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;opacity:0.45;">' +
      '<span style="color:var(--amber);font-size:10px;font-weight:600;font-family:' + _MONO_FONT + ';min-width:28px;">GAP</span>' +
      '<span style="font-size:10px;color:var(--muted);font-family:' + _MONO_FONT + ';">0x' + item.start.toString(16).padStart(ADDR_WIDTH, '0').toUpperCase() + '<svg width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" style="flex-shrink:0;vertical-align:middle;margin:0 2px;"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>0x' + item.end.toString(16).padStart(ADDR_WIDTH, '0').toUpperCase() + '</span>' +
      '<span style="font-size:10px;color:var(--muted);font-family:' + _MONO_FONT + ';margin-left:auto;">' + fmtB(gs) + '</span>' +
    '</div>';
  }
  return '';
}

function renderAddrCards() {
  const el = document.getElementById('addr-bars-el');
  el.innerHTML = D.address_spaces.map(function(r, i) {
    const col = asColor(i);
    const obsSpan = r.end - r.start;
    const startHex = '0x' + r.start.toString(16).padStart(ADDR_WIDTH, '0').toUpperCase();
    const endHex   = '0x' + r.end.toString(16).padStart(ADDR_WIDTH, '0').toUpperCase();
    const secCount = r.sections.length;
    const syms = r.top_symbols.slice(0,15);
    const sortedSecs = [...r.sections].filter(function(s) { return s.actual_size > 0; }).sort(function(a, b) { return a.vma - b.vma; });

    const items = [];
    let cursor = r.start;
    for (const sec of sortedSecs) {
      if (sec.vma > cursor) items.push({ kind:'gap', start:cursor, end:sec.vma });
      items.push({ kind:'section', ...sec });
      cursor = cursor > sec.vma + sec.actual_size ? cursor : sec.vma + sec.actual_size;
    }
    if (cursor < r.end) items.push({ kind:'gap', start:cursor, end:r.end });

    let secIdx = 0;
    const timelineHtml = items
      .filter(function(it) {
        if (it.kind === 'gap') { const gs = it.end - it.start; return gs > 0; }
        return true;
      })
      .map(function(item) {
        if (item.kind === 'gap') {
          return _buildTimelineItem(item);
        }
        const sc = secColor(secIdx++);
        const symList = (item.symbols||[]).slice(0,12);
        const symExtra = (item.symbols||[]).length - symList.length;
        const loadedBadge = item.loaded
          ? '<span class="badge" style="background:rgba(192,132,252,.15);color:var(--purple);font-size:8px;">LOADED</span>'
          : '';
        const nobitsBadge = item.is_nobits
          ? '<span class="badge" style="background:rgba(45,212,191,.15);color:var(--teal);font-size:8px;">ZEROED</span>'
          : '';
        return _buildSectionRow(item, sc, symList, symExtra, loadedBadge, nobitsBadge);
      }).join('');

    const detailHtml =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid var(--border);margin-top:6px;">' +
        '<div style="padding:10px 12px;border-right:1px solid var(--border);">' +
          '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:5px;font-weight:600;">Sections (' + secCount + ')</div>' +
          sortedSecs.map(function(s) {
            const lmaShow = (s.lma !== undefined && s.lma !== s.vma)
              ? '<span style="font-size:9px;color:var(--muted);padding-left:4px;">LMA=0x' + s.lma.toString(16).padStart(ADDR_WIDTH, '0').toUpperCase() + '</span>'
              : '';
            return '<div style="display:flex;justify-content:space-between;padding:3px 0;">' +
              '<span style="font-family:' + _MONO_FONT + ';font-size:11px;color:var(--sub);">' + escapeHtml(s.name) + lmaShow + '</span>' +
              '<span style="font-family:' + _MONO_FONT + ';font-size:10.5px;color:var(--amber);">' + fmtB(s.actual_size) + '</span>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<div style="padding:10px 12px;">' +
          '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:5px;font-weight:600;">Top Symbols</div>' +
          (syms.length ? syms.map(function(s) {
            return '<div style="display:flex;justify-content:space-between;padding:3px 0;">' +
              '<span style="font-family:' + _MONO_FONT + ';font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px;" title="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + '</span>' +
              '<span style="font-family:' + _MONO_FONT + ';font-size:10.5px;color:var(--amber);">' + fmtB(s.size) + '</span>' +
            '</div>';
          }).join('') : '<span style="font-size:11px;color:var(--muted);">-</span>') +
        '</div>' +
      '</div>';

    return '<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;animation:fadeUp .3s ease forwards;animation-delay:' + (i * 0.05) + 's;opacity:0;">' +
      '<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;cursor:pointer;background:var(--panel);transition:background .15s;" onclick="toggleAddrSpace(this)">' +
        '<span style="width:3px;height:28px;border-radius:2px;flex-shrink:0;background:' + col + ';"></span>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-family:' + _MONO_FONT + ';font-size:13px;font-weight:600;color:' + col + ';display:flex;align-items:center;gap:5px;">' + startHex + '<svg width="11" height="11" fill="none" stroke="' + col + '" stroke-width="1.8" viewBox="0 0 24 24" style="flex-shrink:0;"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>' + endHex + '</div>' +
          '<div style="font-size:11px;color:var(--sub);margin-top:2px;font-family:' + _MONO_FONT + ';">' + fmtB(obsSpan) + ' observed span · ' + secCount + ' section' + (secCount !== 1 ? 's' : '') + '</div>' +
        '</div>' +
        '<span style="font-size:14px;color:var(--muted);transition:transform .3s cubic-bezier(.4,0,.2,1);" class="addr-exp-icon">▶</span>' +
      '</div>' +
      '<div class="addr-exp-body" style="display:none;overflow:hidden;border-top:1px solid var(--border);padding:8px 14px 4px;">' +
        timelineHtml +
        detailHtml +
      '</div>' +
    '</div>';
  }).join('');
}

function toggleAddrSpace(header) {
  const body = header.nextElementSibling;
  const icon = header.querySelector('.addr-exp-icon');
  const open  = body.style.display !== 'none';

  if (open) {
    body.animate([
      { height: body.scrollHeight + 'px', opacity: 1 },
      { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' }
    ], { duration: 200, easing: 'ease-out' }).onfinish = function() {
      body.style.display = 'none';
      body.style.height = '';
    };
    body.style.paddingTop = '';
    body.style.paddingBottom = '';
  } else {
    body.style.display = '';
    body.style.height = '0px';
    body.style.opacity = '0';
    body.style.paddingTop = '0px';
    body.style.paddingBottom = '0px';
    requestAnimationFrame(function() {
      body.animate([
        { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' },
        { height: body.scrollHeight + 'px', opacity: 1, paddingTop: '8px', paddingBottom: '4px' }
      ], { duration: 250, easing: 'ease-out' }).onfinish = function() {
        body.style.height = '';
        body.style.opacity = '';
        body.style.paddingTop = '';
        body.style.paddingBottom = '';
      };
    });
  }
  icon.style.transform = open ? '' : 'rotate(90deg)';
}

function toggleSecSyms(row) {
  const body = row.nextElementSibling;
  if (!body || !body.classList.contains('sec-syms')) return;
  const open = body.style.display !== 'none';
  const icon = row.querySelector('.sec-exp-icon');

  if (open) {
    body.animate([
      { height: body.scrollHeight + 'px', opacity: 1 },
      { height: '0px', opacity: 0 }
    ], { duration: 150, easing: 'ease-out' }).onfinish = function() {
      body.style.display = 'none';
      body.style.height = '';
    };
  } else {
    body.style.display = '';
    body.style.height = '0px';
    body.style.opacity = '0';
    requestAnimationFrame(function() {
      body.animate([
        { height: '0px', opacity: 0 },
        { height: body.scrollHeight + 'px', opacity: 1 }
      ], { duration: 200, easing: 'ease-out' }).onfinish = function() {
        body.style.height = '';
        body.style.opacity = '';
      };
    });
  }
  if (icon) icon.style.transform = open ? '' : 'rotate(90deg)';
}

function renderTop20() {
  const top = D.symbols.slice(0, 20);
  const tb  = document.getElementById('top20-tbody');
  tb.innerHTML = top.map(function(s) {
    return '<tr>' +
      '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + '</td>' +
      '<td style="color:var(--sub)">' + escapeHtml(s.section) + '</td>' +
      '<td>' + typeBadge(s.type) + '</td>' +
      '<td style="text-align:right;color:var(--amber)">' + fmtB(s.size) + '</td>' +
    '</tr>';
  }).join('');
}

// Symbols
function renderSymTable() {
  const q      = (document.getElementById('sym-search')?.value||'').toLowerCase();
  const tfilter= document.getElementById('sym-type-filter')?.value||'';

  let data = D.symbols.filter(function(s) {
    return (!tfilter || s.type === tfilter) &&
      (!q || s.name.toLowerCase().includes(q) ||
             (s.section||'').toLowerCase().includes(q) ||
             (s.source_file||'').toLowerCase().includes(q));
  });

  data.sort(function(a,b) {
    let av=a[symSortKey], bv=b[symSortKey];
    if(typeof av==='string') av=av.toLowerCase(), bv=bv.toLowerCase();
    return symSortDir==='asc'?(av>bv?1:-1):(av<bv?1:-1);
  });

  ['name','section','type','size','address'].forEach(function(k) {
    const th=document.getElementById('sth-'+k);
    if(!th) return;
    th.className = symSortKey===k?(symSortDir==='asc'?'sort-asc':'sort-desc'):'';
  });

  const total = Math.max(1, Math.ceil(data.length/SYM_PAGE_SIZE));
  symPage = symPage < total-1 ? symPage : total-1;
  const pageData = data.slice(symPage*SYM_PAGE_SIZE, (symPage+1)*SYM_PAGE_SIZE);

  const tb = document.getElementById('sym-tbody');
  tb.innerHTML = pageData.length ? pageData.map(function(s) {
    const addr = '0x'+s.address.toString(16).padStart(ADDR_WIDTH, '0').toUpperCase();
    const srcName = s.source_file ? s.source_file.split('/').pop() : '';
    return '<tr>' +
      '<td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + '</td>' +
      '<td style="color:var(--sub)">' + escapeHtml(s.section) + '</td>' +
      '<td>' + typeBadge(s.type) + '</td>' +
      '<td style="text-align:right;color:var(--amber)">' + fmtB(s.size) + '</td>' +
      '<td style="color:var(--muted)">' + addr + '</td>' +
      '<td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);" title="' + escapeHtml(s.source_file||'') + '">' + escapeHtml(srcName) + '</td>' +
      '<td><span class="badge tag-' + s.attribution + '">' + s.attribution + '</span></td>' +
    '</tr>';
  }).join('') : '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted);">No symbols match</td></tr>';

  const pg = document.getElementById('sym-pagination');
  pg.innerHTML = '';
  if (total > 1) {
    const mkBtn = function(label, page, active) {
      const b = document.createElement('button');
      b.className = 'pg-btn' + (active?' active':'');
      b.textContent = label;
      b.onclick = function() { symPage=page; renderSymTable(); };
      return b;
    };
    pg.appendChild(mkBtn('‹', symPage>0 ? symPage-1 : 0, false));
    let start = Math.max(0, symPage-2);
    const end = Math.min(total, start+5);
    for(let i=start;i<end;i++) pg.appendChild(mkBtn(i+1, i, i===symPage));
    pg.appendChild(mkBtn('›', symPage+1 < total ? symPage+1 : total-1, false));
    const info = document.createElement('span');
    info.style.cssText='font-family:"IBM Plex Mono",monospace;font-size:10px;color:var(--muted);margin-left:6px;';
    info.textContent = 'page ' + (symPage+1) + ' / ' + total;
    pg.appendChild(info);
  }

  document.getElementById('sym-count-lbl').textContent = data.length + ' symbols';
  const totalSz = data.reduce(function(a,s) { return a+s.size; }, 0);
  document.getElementById('sym-size-lbl').textContent = fmtB(totalSz) + ' total';
}

function symSort(key) {
  if(symSortKey===key) symSortDir=symSortDir==='asc'?'desc':'asc';
  else { symSortKey=key; symSortDir=key==='size'?'desc':'asc'; }
  symPage=0;
  renderSymTable();
}

// Section attributes
function renderSectionAttrView(dataKey, totalId, listId, color, title) {
  const d = D[dataKey];
  document.getElementById(totalId).textContent = fmtB(d.total) + ' attributed of ' + fmtB(d.total_section_bytes) + ' total';
  const el = document.getElementById(listId);
  if (!d.sections.length) {
    el.innerHTML = '<div style="padding:28px;text-align:center;color:var(--text-dim);font-size:13px;">No ' + title.toLowerCase() + ' found in this binary.</div>';
    return;
  }
  el.innerHTML = d.sections.map(function(s) {
    const syms = s.symbols || [];
    const showSyms = syms.slice(0, 30);
    const remaining = syms.length - showSyms.length;
    let symHtml = showSyms.map(function(sym) {
      return '<span class="attr-sym">' + escapeHtml(sym.name) + ' <strong>' + fmtB(sym.size) + '</strong></span>';
    }).join('');
    if (remaining > 0) {
      symHtml += '<span class="attr-sym-more">+' + remaining + ' more</span>';
    }
    return '<div class="attr-section">' +
      '<div class="attr-header-row">' +
        '<div class="attr-indicator" style="background:' + color + ';"></div>' +
        '<div class="attr-info">' +
          '<div class="attr-name-row">' +
            '<span class="attr-name">' + escapeHtml(s.name) + '</span>' +
            '<span class="attr-flags-badge">' + escapeHtml(s.flags) + '</span>' +
          '</div>' +
          '<div class="attr-meta-row">' +
            '<span class="attr-sizes">' + fmtB(s.attributed) + ' of ' + fmtB(s.size) + '</span>' +
            '<span style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono);">' + syms.length + ' symbol' + (syms.length === 1 ? '' : 's') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="attr-body">' +
        '<div class="attr-symbols">' + symHtml + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderWritableSections() {
  renderSectionAttrView('writable_sections', 'writable-total', 'writable-list', 'var(--green)', 'Writable Sections');
}

function renderReadonlySections() {
  renderSectionAttrView('readonly_sections', 'readonly-total', 'readonly-list', 'var(--accent)', 'Read-Only Sections');
}

function renderExecutableSections() {
  renderSectionAttrView('executable_sections', 'executable-total', 'executable-list', 'var(--orange)', 'Executable Sections');
}

// Sources
function renderSources() {
  const q   = (document.getElementById('src-search')?.value||'').toLowerCase();
  const el  = document.getElementById('sources-list');
  const visible = D.source_files.filter(function(f) {
    return f.path !== '__unknown__' && (!q || f.path.toLowerCase().includes(q));
  });

  el.innerHTML = visible.length ? visible.map(function(f) {
    const syms = f.symbols || [];
    const showSyms = syms.slice(0, 20);
    const remaining = syms.length - showSyms.length;
    let symHtml = showSyms.map(function(s) {
      return '<span class="attr-sym">' + escapeHtml(s.name) + ' <strong>' + fmtB(s.size) + '</strong></span>';
    }).join('');
    if (remaining > 0) {
      symHtml += '<span class="attr-sym-more">+' + remaining + ' more</span>';
    }
    return '<div class="attr-section">' +
      '<div class="attr-header-row">' +
        '<div class="attr-indicator" style="background:var(--accent);"></div>' +
        '<div class="attr-info">' +
          '<div class="attr-name-row">' +
            '<span class="attr-name" title="' + escapeHtml(f.path) + '">' + escapeHtml(f.path.split('/').pop()) + '</span>' +
            '<span class="attr-flags-badge">' + escapeHtml(f.path) + '</span>' +
          '</div>' +
          '<div class="attr-meta-row">' +
            '<span class="attr-sizes">' + fmtB(f.total_size) + '</span>' +
            '<span style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono);">' + syms.length + ' symbol' + (syms.length === 1 ? '' : 's') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="attr-body">' +
        '<div class="attr-symbols">' + symHtml + '</div>' +
      '</div>' +
    '</div>';
  }).join('') : '<p style="color:var(--muted);font-size:12px;text-align:center;padding:24px;">No DWARF source attribution available in this binary.</p>';
}

// Objects
function renderObjects() {
  const q   = (document.getElementById('obj-search')?.value||'').toLowerCase();
  const el  = document.getElementById('objects-list');
  const visible = D.object_files.filter(function(f) {
    return f.path !== '__unknown__.o' && (!q || f.path.toLowerCase().includes(q));
  });

  el.innerHTML = visible.length ? visible.map(function(f) {
    const syms = f.symbols || [];
    const showSyms = syms.slice(0, 20);
    const remaining = syms.length - showSyms.length;
    let symHtml = showSyms.map(function(s) {
      return '<span class="attr-sym">' + escapeHtml(s.name) + ' <strong>' + fmtB(s.size) + '</strong></span>';
    }).join('');
    if (remaining > 0) {
      symHtml += '<span class="attr-sym-more">+' + remaining + ' more</span>';
    }
    return '<div class="attr-section">' +
      '<div class="attr-header-row">' +
        '<div class="attr-indicator" style="background:var(--green);"></div>' +
        '<div class="attr-info">' +
          '<div class="attr-name-row">' +
            '<span class="attr-name" title="' + escapeHtml(f.path) + '">' + escapeHtml(f.path) + '</span>' +
            '<span class="badge tag-' + f.confidence + '" style="flex-shrink:0;">' + f.confidence + '</span>' +
          '</div>' +
          '<div class="attr-meta-row">' +
            '<span class="attr-sizes">' + fmtB(f.total_size) + '</span>' +
            '<span style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono);">' + syms.length + ' symbol' + (syms.length === 1 ? '' : 's') + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="attr-body">' +
        '<div class="attr-symbols">' + symHtml + '</div>' +
      '</div>' +
    '</div>';
  }).join('') : '<p style="color:var(--muted);font-size:12px;text-align:center;padding:24px;">No object file attribution available.</p>';
}

// Segments
function renderSegments() {
  const el = document.getElementById('seg-list');
  el.innerHTML = D.segments.map(function(s, i) {
    const secTags = (s.sections||[]).map(function(sn) {
      return '<span style="display:inline-block;font-family:' + _MONO_FONT + ';font-size:10px;color:var(--sub);background:var(--border);border-radius:3px;padding:1px 5px;margin:2px;">' + escapeHtml(sn) + '</span>';
    }).join('');
    const symRows = (s.symbols||[]).slice(0,15).map(function(sym) {
      return '<div style="display:flex;justify-content:space-between;padding:2px 0;font-family:' + _MONO_FONT + ';font-size:10px;">' +
        '<span style="color:var(--sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">' + escapeHtml(sym.name) + '</span>' +
        '<span style="color:var(--amber);">' + fmtB(sym.size) + '</span>' +
      '</div>';
    }).join('');
    return '<div class="seg-row" style="cursor:pointer;" onclick="toggleSegDetail(' + i + ')">' +
      '<span style="color:var(--accent);font-weight:600;">' + escapeHtml(s.type) + '</span>' +
      '<span>0x' + s.vaddr.toString(16).padStart(ADDR_WIDTH, '0').toUpperCase() + '</span>' +
      '<span>0x' + s.paddr.toString(16).padStart(ADDR_WIDTH, '0').toUpperCase() + '</span>' +
      '<span>' + fmtB(s.filesz) + '</span>' +
      '<span>' + fmtB(s.memsz) + '</span>' +
      '<span style="color:var(--sub);">' + escapeHtml(s.flags) + '</span>' +
    '</div>' +
    '<div id="seg-detail-' + i + '" style="display:none;padding:8px 16px;background:var(--surface);border-bottom:1px solid var(--border);">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
        '<div>' +
          '<div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.07em;margin-bottom:6px;">Sections (' + (s.sections||[]).length + ')</div>' +
          secTags +
        '</div>' +
        '<div>' +
          '<div style="font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.07em;margin-bottom:6px;">Largest Symbols</div>' +
          symRows +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function toggleSegDetail(i) {
  const el = document.getElementById('seg-detail-'+i);
  if (!el) return;
  segDetailOpen[i] = !segDetailOpen[i];
  el.style.display = segDetailOpen[i] ? '' : 'none';
}

// Export
function exportSymCSV() {
  const q      = (document.getElementById('sym-search')?.value||'').toLowerCase();
  const tfilter= document.getElementById('sym-type-filter')?.value||'';
  const data   = D.symbols.filter(function(s) {
    return (!tfilter||s.type===tfilter) &&
      (!q||s.name.toLowerCase().includes(q)||(s.section||'').toLowerCase().includes(q));
  });
  const rows = [['Symbol','Type','Section','Size (B)','Size (KB)','Address','Source File','Attribution'].map(function(h) { return '"' + h + '"'; })];
  data.forEach(function(s) {
    rows.push([
      '"' + s.name.replace(/"/g,'""') + '"',
      '"' + s.type.replace(/"/g,'""') + '"',
      '"' + (s.section||'').replace(/"/g,'""') + '"',
      s.size, (s.size/1024).toFixed(3),
      '0x'+s.address.toString(16).padStart(ADDR_WIDTH, '0').toUpperCase(),
      '"' + (s.source_file||'').replace(/"/g,'""') + '"',
      '"' + s.attribution.replace(/"/g,'""') + '"',
    ]);
  });
  dl(rows.map(function(r) { return r.join(','); }).join('\n'), 'elfyzer_symbols.csv', 'text/csv');
}

function exportJSON() { dl(JSON.stringify(D,null,2),'elfyzer_analysis.json','application/json'); }

document.getElementById('sym-search')?.addEventListener('input', debounce(function() { symPage=0; renderSymTable(); }, 200));
document.getElementById('sym-type-filter')?.addEventListener('change', function() { symPage=0; renderSymTable(); });
