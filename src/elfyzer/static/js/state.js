let D = null;
let DiffData = null;
let chartInst = null;
let chartMode = 'treemap';
let activeView = 'upload';
let diffTab = 'overview';
let diffMode = false;

let symSortKey = 'size';
let symSortDir = 'desc';
let symPage    = 0;
const SYM_PAGE_SIZE = 200;

let _diffFileA = null, _diffFileB = null;
let segDetailOpen = {};
let ADDR_WIDTH = 8;
let _parsing = false;

const AS_COLORS = [
  '#38bdf8', '#4ade80', '#fbbf24', '#c084fc', '#fb923c',
  '#f87171', '#2dd4bf', '#818cf8', '#f472b6', '#34d399',
];
const SEC_COLORS = [
  '#60a5fa', '#a78bfa', '#f59e0b', '#10b981', '#ec4899',
  '#06b6d4', '#14b8a6', '#8b5cf6', '#d946ef', '#eab308',
  '#38bdf8', '#4ade80', '#fbbf24', '#c084fc', '#fb923c',
];
function asColor(i) { return AS_COLORS[i % AS_COLORS.length]; }
function secColor(i) { return SEC_COLORS[i % SEC_COLORS.length]; }
const VIEWS = ['overview','symbols','writable','readonly','executable','sources','objects','segments','report','diff','diff-upload'];

function initApp(filename) {
  const s = D.summary;
  document.getElementById('sidebar').style.display = '';

  document.getElementById('hdr-file').textContent = filename;
  document.getElementById('hdr-arch').textContent =
    `${s.arch} / ${s.bits}-bit ${s.endian}-endian`;

  document.getElementById('nb-symbols').textContent = D.symbols.length;
  document.getElementById('nb-segments').textContent = D.segments.length;
  ADDR_WIDTH = s.bits === 64 ? 16 : 8;

  document.getElementById('view-upload').style.display = 'none';
  showView('overview');
}

function resetApp() {
  D = null;
  const fileInput = document.getElementById('file-input');
  if (fileInput) fileInput.value = '';
  DiffData = null;
  _diffFileA = null;
  _diffFileB = null;
  segDetailOpen = {};
  diffMode = false;
  document.getElementById('diff-toggle').checked = false;
  document.body.classList.remove('diff-mode');
  document.getElementById('sidebar').style.display = 'none';
  document.getElementById('view-upload').style.display = '';
  document.getElementById('dz-inner').innerHTML = `
    <svg style="margin:0 auto 14px;display:block;" width="40" height="40" fill="none" stroke="var(--border2)" stroke-width="1.4" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
    <p style="color:var(--sub);font-size:14px;font-weight:500;">Drop ELF binary here</p>
    <p style="color:var(--muted);font-size:11px;margin-top:4px;font-family:'IBM Plex Mono',monospace;">.elf - or click to browse</p>`;
  const dz = document.getElementById('dropzone');
  if (dz) dz.className = '';
  ['a','b'].forEach(side => {
    const inp = document.getElementById('diff-input-'+side);
    if (inp) inp.value = '';
    const inner = document.getElementById('diff-dz-'+side+'-inner');
    const ddz = document.getElementById('diff-dz-'+side);
    if (inner) inner.innerHTML = `<svg style="margin:0 auto 10px;display:block;" width="28" height="28" fill="none" stroke="var(--border2)" stroke-width="1.4" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
    <p style="color:var(--sub);font-size:12px;font-weight:500;">Drop or click to select</p>`;
    if (ddz) ddz.className = 'diff-dropzone';
  });
  document.getElementById('hdr-file').textContent = '';
  document.getElementById('hdr-arch').textContent = '';
  const rc = document.getElementById('render-error-card');
  if (rc) rc.remove();
  VIEWS.forEach(v => {
    const el = document.getElementById('view-'+v);
    if (el) el.style.display = 'none';
  });
  activeView = 'upload';
}

function toggleDiffMode() {
  if (_parsing) { document.getElementById('diff-toggle').checked = !diffMode; return; }
  diffMode = !diffMode;
  document.body.classList.toggle('diff-mode', diffMode);
  if (diffMode) {
    D = null;
    DiffData = null;
    _diffFileA = null;
    segDetailOpen = {};
    _diffFileB = null;
    document.getElementById('hdr-file').textContent = '';
    document.getElementById('hdr-arch').textContent = '';
    ['a','b'].forEach(s => { const i = document.getElementById('diff-input-'+s); if (i) i.value = ''; });
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('dz-inner').innerHTML = `
      <svg style="margin:0 auto 14px;display:block;" width="40" height="40" fill="none" stroke="var(--border2)" stroke-width="1.4" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <p style="color:var(--sub);font-size:14px;font-weight:500;">Drop ELF binary here</p>
      <p style="color:var(--muted);font-size:11px;margin-top:4px;font-family:'IBM Plex Mono',monospace;">.elf - or click to browse</p>`;
    document.getElementById('dropzone').className = '';
    activeView = 'diff-upload';
    VIEWS.filter(v => v !== 'diff-upload').forEach(v => {
      const el = document.getElementById('view-'+v);
      if (el) el.style.display = 'none';
    });
    document.getElementById('view-upload').style.display = 'none';
    document.getElementById('view-diff-upload').style.display = '';
    document.querySelectorAll('#sidebar-diff .nav-btn').forEach(b => b.classList.remove('active'));
  } else {
    resetApp();
  }
}
function showDiffTab(tab) {
  showView('diff');
  if (DiffData) {
    switchDiffTab(tab);
    document.querySelectorAll('#sidebar-diff .nav-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('nav-df-' + tab);
    if (btn) btn.classList.add('active');
  }
}

function showView(viewName) {
   if (diffMode && viewName !== 'diff' && viewName !== 'diff-upload') return;
   let displayName = viewName;
   if (viewName === 'diff') {
     displayName = DiffData ? 'diff' : 'diff-upload';
   }
   VIEWS.forEach(v => {
     const el = document.getElementById('view-'+v);
     if (el) el.style.display = 'none';
     const nb = document.getElementById('nav-'+v);
     if (nb) nb.classList.remove('active');
   });
   document.getElementById('view-'+displayName).style.display = '';
   if (displayName.startsWith('diff')) {
     const nd = document.getElementById('nav-diff');
     if (nd) nd.classList.add('active');
   } else {
     const nb = document.getElementById('nav-'+displayName);
     if (nb) nb.classList.add('active');
   }
   activeView = displayName;
   if (!D || displayName === 'diff-upload') return;

  try {
    switch(displayName) {
      case 'overview':       renderOverview(); break;
      case 'symbols':        renderSymTable(); break;
      case 'writable':       renderWritableSections(); break;
      case 'readonly':       renderReadonlySections(); break;
      case 'executable':     renderExecutableSections(); break;
      case 'sources':        renderSources(); break;
      case 'objects':        renderObjects(); break;
      case 'segments':       renderSegments(); break;
      case 'report':         renderReportView(); break;
    }
  } catch(e) {
    console.error('Render error:', e);
    const prev = document.getElementById('render-error-card');
    if (prev) prev.remove();
    const ec = document.createElement('div');
    ec.id = 'render-error-card';
    ec.className = 'card';
    ec.style.cssText = 'padding:40px;text-align:center;margin-bottom:20px;';
    ec.innerHTML =
      '<div style="color:var(--red);font-size:16px;font-weight:600;margin-bottom:8px;">Render Error</div>' +
      '<div style="color:var(--muted);font-size:12px;font-family:var(--font-mono);margin-bottom:12px;">' + escapeHtml(e.message) + '</div>' +
      '<button class="btn" onclick="resetApp()">← Upload a different file</button>';
    document.getElementById('main').prepend(ec);
  }
}
