function fmtB(b) {
  if (typeof b !== 'number' || isNaN(b)) return '0 B';
  const abs = Math.abs(b);
  const sign = b < 0 ? '-' : '';
  if (abs >= 1048576) return sign + (abs/1048576).toFixed(2) + ' MB';
  if (abs >= 1024) return sign + (abs/1024).toFixed(1) + ' KB';
  return sign + abs.toLocaleString('en-US') + ' B';
}

function escapeHtml(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function typeBadge(t) {
  const cls = t==='STT_OBJECT' ? 'tag-obj' : t==='STT_FUNC' ? 'tag-func' : 'tag-none';
  const lbl = t ? t.replace('STT_','') : '?';
  return `<span class="badge ${cls}">${lbl}</span>`;
}

function dl(data, name, mime) {
  const a = document.createElement('a');
  const blob = new Blob([data], {type: mime});
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 100);
}

async function _isElf(file) {
  try {
    const header = await file.slice(0, 4).arrayBuffer();
    const magic = new Uint8Array(header);
    if (magic[0] === 0x7f && magic[1] === 0x45 && magic[2] === 0x4c && magic[3] === 0x46) return true;
  } catch {}
  return file.name.toLowerCase().endsWith('.elf');
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
