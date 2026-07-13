(function (global) {
  'use strict';

  // Constants

  var STORAGE_KEY_REGIONS = 'elfyzer_report_regions';
  var STORAGE_KEY_TITLE = 'elfyzer_report_title';
  var DEFAULT_TITLE = 'Memory Profile Report';
  var DEFAULT_TOP_N = 10;
  var SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];

  var HEX_ADDR_RE = /^0X[0-9A-F]+$/;
  var DEC_SIZE_RE = /^(\d+(?:\.\d+)?)\s*(B|K|KB|M|MB|G|GB)?$/;
  var VALID_NAME_RE = /^[A-Za-z0-9_.\-]+$/;

  // Utilities

  function localEscapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escHtml(str) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(str);
    return localEscapeHtml(str);
  }

  function escMarkdown(str) {
    return String(str == null ? '' : str)
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/\r?\n/g, ' ');
  }

  function byId(id) {
    return document.getElementById(id);
  }

  var storage = {
    get: function (key) {
      try {
        return sessionStorage.getItem(key);
      } catch (e) {
        console.warn('sessionStorage read failed for "' + key + '":', e);
        return null;
      }
    },
    set: function (key, value) {
      try {
        sessionStorage.setItem(key, value);
        return true;
      } catch (e) {
        console.warn('sessionStorage write failed for "' + key + '":', e);
        return false;
      }
    }
  };

  // Parsing

  function parseReportSize(s) {
    if (s == null) return null;
    s = String(s).trim().toUpperCase();
    if (!s) return null;

    if (HEX_ADDR_RE.test(s)) {
      var hexVal = parseInt(s.slice(2), 16);
      return isFinite(hexVal) ? hexVal : null;
    }

    var m = DEC_SIZE_RE.exec(s);
    if (!m) return null;

    var value = parseFloat(m[1]);
    if (!isFinite(value) || value < 0) return null;

    var unit = m[2] || 'B';
    var multiplier = 1;
    if (unit === 'K' || unit === 'KB') multiplier = 1024;
    else if (unit === 'M' || unit === 'MB') multiplier = 1048576;
    else if (unit === 'G' || unit === 'GB') multiplier = 1073741824;

    return Math.round(value * multiplier);
  }

  function parseHexAddress(s) {
    if (s == null) return null;
    s = String(s).trim().toUpperCase();
    if (!s) return null;
    if (!HEX_ADDR_RE.test(s)) return null;
    var n = parseInt(s.slice(2), 16);
    return isFinite(n) ? n : null;
  }

  function fmtReportBytes(bytes) {
    if (!isFinite(bytes)) return '0 B';
    if (bytes === 0) return '0 B';
    var sign = bytes < 0 ? '-' : '';
    var v = Math.abs(bytes);
    var i = 0;
    while (v >= 1024 && i < SIZE_UNITS.length - 1) {
      v /= 1024;
      i++;
    }
    return sign + v.toFixed(1) + ' ' + SIZE_UNITS[i];
  }

  function fmtHex(n) {
    return '0x' + n.toString(16).toUpperCase();
  }

  function fmtTimestamp(date) {
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) + ' local';
  }

  // Interval math

  function mergeIntervals(intervals) {
    if (!intervals || !intervals.length) return [];
    var sorted = intervals.slice().sort(function (a, b) { return a[0] - b[0]; });
    var merged = [sorted[0].slice()];
    for (var i = 1; i < sorted.length; i++) {
      var last = merged[merged.length - 1];
      if (sorted[i][0] <= last[1]) {
        if (sorted[i][1] > last[1]) last[1] = sorted[i][1];
      } else {
        merged.push(sorted[i].slice());
      }
    }
    return merged;
  }

  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }

  // Region data

  function collectRegions() {
    var rows = document.querySelectorAll('.region-row');
    var raw = [];
    var valid = [];
    var errors = [];
    var seenNames = Object.create(null);

    rows.forEach(function (row, idx) {
      var rowNum = idx + 1;
      var nameEl = row.querySelector('.reg-name');
      var startEl = row.querySelector('.reg-start');
      var sizeEl = row.querySelector('.reg-size');
      if (!nameEl || !startEl || !sizeEl) return;

      var name = nameEl.value.trim();
      var startStr = startEl.value.trim();
      var sizeStr = sizeEl.value.trim();

      // Entirely blank row: skip silently, not an error.
      if (!name && !startStr && !sizeStr) return;

      raw.push({ name: name, start: startStr, size: sizeStr });

      if (!name) {
        errors.push({ row: rowNum, message: 'Row ' + rowNum + ': name is required.' });
        return;
      }
      if (!VALID_NAME_RE.test(name)) {
        errors.push({ row: rowNum, message: 'Row ' + rowNum + ' ("' + name + '"): name may only contain letters, digits, "_", "-", "."' });
        return;
      }
      if (Object.prototype.hasOwnProperty.call(seenNames, name)) {
        errors.push({ row: rowNum, message: 'Row ' + rowNum + ': duplicate region name "' + name + '".' });
        return;
      }

      var start = parseHexAddress(startStr);
      if (start === null) {
        errors.push({ row: rowNum, message: 'Row ' + rowNum + ' ("' + name + '"): "' + startStr + '" is not a valid hex address (expected e.g. 0x20000000).' });
        return;
      }

      var size = parseReportSize(sizeStr);
      if (size === null) {
        errors.push({ row: rowNum, message: 'Row ' + rowNum + ' ("' + name + '"): "' + sizeStr + '" is not a valid size (expected e.g. 128K, 4M, 4096).' });
        return;
      }
      if (size <= 0) {
        errors.push({ row: rowNum, message: 'Row ' + rowNum + ' ("' + name + '"): size must be greater than zero.' });
        return;
      }

      var end = start + size;
      if (end > 0xFFFFFFFFFFFF) {
        errors.push({ row: rowNum, message: 'Row ' + rowNum + ' ("' + name + '"): region end address overflows a sane address range.' });
        return;
      }

      seenNames[name] = true;
      valid.push({ name: name, start: start, end: end, size: size });
    });

    // Overlap detection across all valid regions (independent of name).
    for (var i = 0; i < valid.length; i++) {
      for (var j = i + 1; j < valid.length; j++) {
        if (rangesOverlap(valid[i].start, valid[i].end, valid[j].start, valid[j].end)) {
          errors.push({
            row: null,
            message: 'Regions "' + valid[i].name + '" and "' + valid[j].name + '" overlap (' +
              fmtHex(valid[i].start) + '-' + fmtHex(valid[i].end) + ' vs ' +
              fmtHex(valid[j].start) + '-' + fmtHex(valid[j].end) + ').'
          });
        }
      }
    }

    return { raw: raw, valid: valid, errors: errors };
  }

  // Persistence (sessionStorage)

  function saveReportRegions() {
    var data = collectRegions().raw;
    storage.set(STORAGE_KEY_REGIONS, JSON.stringify(data));
  }

  function loadReportRegions() {
    var data = storage.get(STORAGE_KEY_REGIONS);
    if (!data) return [];
    try {
      var parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (r) {
        return r && typeof r === 'object';
      });
    } catch (e) {
      console.warn('Corrupt region data in sessionStorage, ignoring:', e);
      return [];
    }
  }

  function saveReportTitle(title) {
    storage.set(STORAGE_KEY_TITLE, String(title == null ? '' : title));
  }

  function loadReportTitle() {
    return storage.get(STORAGE_KEY_TITLE) || '';
  }

  // Import / Export

  function showImportNotice(message, isError) {
    var notice = byId('import-notice');
    if (!notice) return;
    notice.textContent = message;
    notice.style.color = isError ? 'var(--red)' : '';
    notice.style.display = '';
    clearTimeout(notice._hideTimer);
    notice._hideTimer = setTimeout(function () {
      notice.style.display = 'none';
    }, isError ? 4500 : 3000);
  }

  function downloadTextFile(filename, content, mimeType) {
    var blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Defer revoke slightly so the download reliably starts in all browsers.
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function safeFilename(title, extension) {
    var base = String(title || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!base) base = 'report';
    return base + '.' + extension;
  }

  function exportRegionsJson() {
    var regions = collectRegions().raw;
    if (regions.length === 0) {
      showImportNotice('Nothing to export: add at least one region first.', true);
      return;
    }
    var json = JSON.stringify(regions, null, 2);
    downloadTextFile('elfyzer_regions.json', json, 'application/json');
  }

  function importRegionsJson(file) {
    if (!file) return;
    var reader = new FileReader();

    reader.onerror = function () {
      showImportNotice('Error: could not read the selected file.', true);
    };

    reader.onload = function (e) {
      var data;
      try {
        data = JSON.parse(e.target.result);
      } catch (err) {
        showImportNotice('Error: file is not valid JSON.', true);
        return;
      }

      if (!Array.isArray(data) || data.length === 0) {
        showImportNotice('Error: expected a non-empty JSON array of regions.', true);
        return;
      }

      var cleaned = [];
      for (var i = 0; i < data.length; i++) {
        var r = data[i];
        if (!r || typeof r !== 'object') {
          showImportNotice('Error: entry at index ' + i + ' is not an object.', true);
          return;
        }
        if (typeof r.name !== 'string' || typeof r.start !== 'string' || typeof r.size !== 'string') {
          showImportNotice('Error: entry at index ' + i + ' must have string "name", "start", and "size" fields.', true);
          return;
        }
        if (!r.name.trim() || !r.start.trim() || !r.size.trim()) {
          showImportNotice('Error: entry at index ' + i + ' has an empty name, start, or size.', true);
          return;
        }
        cleaned.push({ name: r.name.trim(), start: r.start.trim(), size: r.size.trim() });
      }

      var tbody = byId('region-tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
      cleaned.forEach(function (r) { addRegionRow(r.name, r.start, r.size); });
      saveReportRegions();
      showImportNotice('Loaded ' + cleaned.length + ' region' + (cleaned.length > 1 ? 's' : '') + '.', false);
    };

    reader.readAsText(file);
  }

  // DOM

  var INPUT_STYLE =
    'background:var(--inset-bg);border:1px solid var(--glass-border);border-radius:var(--radius-pill);' +
    'color:var(--text);font-family:var(--font-mono);font-size:11px;padding:6px 10px;outline:none;' +
    'width:100%;box-sizing:border-box;transition:border-color var(--transition),box-shadow var(--transition);';

  function addRegionRow(name, start, size) {
    var tbody = byId('region-tbody');
    if (!tbody) return;
    var tr = document.createElement('tr');
    tr.className = 'region-row';
    tr.innerHTML =
      '<td><input class="reg-name" value="' + escHtml(name || '') + '" placeholder="SRAM0" style="' + INPUT_STYLE + '"/></td>' +
      '<td><input class="reg-start" value="' + escHtml(start || '') + '" placeholder="0x20000000" style="' + INPUT_STYLE + '"/></td>' +
      '<td><input class="reg-size" value="' + escHtml(size || '') + '" placeholder="128K" style="' + INPUT_STYLE + '"/></td>' +
      '<td style="text-align:center;"><button class="btn btn-ghost reg-del" style="padding:4px 8px;font-size:13px;line-height:1;" title="Remove this region">&#x2715;</button></td>';
    tbody.appendChild(tr);
  }

  function renderValidationMessages(errors) {
    var el = byId('report-warnings');
    if (!el) return;
    if (!errors || errors.length === 0) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }
    var items = errors.map(function (e) {
      return '<li>' + escHtml(e.message) + '</li>';
    }).join('');
    el.innerHTML =
      '<div style="padding:10px 14px;border-radius:var(--radius-lg);background:rgba(255,80,80,0.08);border:1px solid var(--red);">' +
      '<div style="font-weight:600;font-size:12px;color:var(--red);margin-bottom:4px;">' +
      errors.length + ' issue' + (errors.length > 1 ? 's' : '') + ' found:' +
      '</div>' +
      '<ul style="margin:0;padding-left:18px;font-size:11px;font-family:var(--font-mono);color:var(--text-secondary);">' +
      items +
      '</ul></div>';
    el.style.display = '';
  }

  // View rendering

  function renderReportView() {
    var regions = loadReportRegions();
    var el = byId('view-report');
    if (!el) return;

    el.innerHTML =
      '<div class="card" style="position:relative;">' +
        '<div class="card-header">' +
          '<span class="card-title">Memory Regions</span>' +
          '<div style="display:flex;gap:6px;align-items:center;">' +
            '<button class="btn" id="import-regions-btn">Import</button>' +
            '<button class="btn" id="export-regions-btn">Export</button>' +
          '</div>' +
        '</div>' +
        '<div class="card-body" style="padding:0;">' +
          '<table class="data-table" style="border:none;margin:0;">' +
            '<thead><tr>' +
              '<th style="width:28%;">Name</th>' +
              '<th style="width:30%;">Start Address</th>' +
              '<th style="width:28%;">Size</th>' +
              '<th style="width:14%;"></th>' +
            '</tr></thead>' +
            '<tbody id="region-tbody"></tbody>' +
          '</table>' +
          '<div style="padding:12px 16px;border-top:1px solid var(--glass-border);display:flex;align-items:center;justify-content:space-between;">' +
            '<button class="btn" id="add-region-btn">+ Add Region</button>' +
            '<span id="import-notice" style="font-size:11px;color:var(--green);display:none;font-family:var(--font-mono);"></span>' +
          '</div>' +
        '</div>' +
        '<input type="file" accept=".json" id="import-regions-input" style="position:absolute;width:0;height:0;opacity:0;pointer-events:none;"/>' +
      '</div>' +
      '<div class="card" style="display:flex;flex-direction:row;align-items:center;gap:10px;padding:12px 16px;flex-wrap:wrap;">' +
        '<span style="font-size:12px;color:var(--text-secondary);font-weight:500;white-space:nowrap;">Title:</span>' +
        '<input id="report-title-input" value="' + escHtml(DEFAULT_TITLE) + '" placeholder="' + escHtml(DEFAULT_TITLE) + '" style="background:var(--inset-bg);border:1px solid var(--glass-border);border-radius:var(--radius-pill);color:var(--text);font-family:var(--font-mono);font-size:12px;padding:6px 12px;outline:none;min-width:180px;flex:1;transition:border-color var(--transition),box-shadow var(--transition);"/>' +
        '<span style="font-size:12px;color:var(--text-secondary);font-weight:500;white-space:nowrap;">Top N Symbols by Size:</span>' +
        '<select id="top-n-select" style="background:var(--surface);border:1px solid var(--border2);border-radius:5px;color:var(--sub);font-family:\'IBM Plex Mono\',monospace;font-size:11px;padding:5px 8px;outline:none;">' +
          [10, 20, 50, 100].map(function (v) {
            return '<option value="' + v + '"' + (DEFAULT_TOP_N === v ? ' selected' : '') + '>' + v + '</option>';
          }).join('') +
        '</select>' +
        '<button class="btn" id="generate-report-btn">Generate Report</button>' +
      '</div>' +
      '<div id="report-warnings" style="display:none;margin-bottom:12px;"></div>' +
      '<div id="report-output" style="display:none;">' +
        '<div class="card">' +
          '<div class="card-header">' +
            '<span class="card-title">Report Preview</span>' +
            '<button class="btn" id="download-md-btn">Download .md</button>' +
          '</div>' +
          '<div class="card-body" style="padding:0;">' +
            '<pre id="report-markdown" style="margin:0;padding:16px;overflow:auto;max-height:600px;font-family:var(--font-mono);font-size:12px;line-height:1.6;color:var(--text);background:var(--inset-bg);border-radius:0 0 var(--radius-lg) var(--radius-lg);white-space:pre-wrap;word-break:break-word;"></pre>' +
          '</div>' +
        '</div>' +
      '</div>';

    if (regions.length > 0) {
      regions.forEach(function (r) { addRegionRow(r.name, r.start, r.size); });
    }

    var savedTitle = loadReportTitle();
    var titleInput = byId('report-title-input');
    if (savedTitle && titleInput) titleInput.value = savedTitle;

    bindReportViewEvents(el);
  }

  function bindReportViewEvents(el) {
    var addBtn = byId('add-region-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        addRegionRow('', '', '');
        saveReportRegions();
      });
    }

    el.addEventListener('input', function (e) {
      if (e.target.closest('.region-row')) saveReportRegions();
      if (e.target.id === 'report-title-input') saveReportTitle(e.target.value);
    });

    el.addEventListener('click', function (e) {
      var delBtn = e.target.closest('.reg-del');
      if (delBtn) {
        delBtn.closest('.region-row').remove();
        saveReportRegions();
      }
    });

    var genBtn = byId('generate-report-btn');
    if (genBtn) genBtn.addEventListener('click', generateReport);

    var importBtn = byId('import-regions-btn');
    var importInput = byId('import-regions-input');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', function () { importInput.click(); });
      importInput.addEventListener('change', function (e) {
        if (e.target.files && e.target.files[0]) importRegionsJson(e.target.files[0]);
        e.target.value = '';
      });
    }

    var exportBtn = byId('export-regions-btn');
    if (exportBtn) exportBtn.addEventListener('click', exportRegionsJson);
  }

  // Report generation

  function sectionsForRegion(region, sections) {
    var fullyInside = [];
    var clipped = [];
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (!s || !(s.actual_size > 0) || s.vma === undefined || s.vma === null) continue;
      var sStart = s.vma;
      var sEnd = s.vma + s.actual_size;
      if (sStart >= region.start && sEnd <= region.end) {
        fullyInside.push(s);
      } else if (rangesOverlap(sStart, sEnd, region.start, region.end)) {
        clipped.push(s); // crosses boundary, count clipped portion
      }
    }
    return { fullyInside: fullyInside, clipped: clipped };
  }

  function computeRegionUsage(region, sections) {
    var split = sectionsForRegion(region, sections || []);
    var intervals = split.fullyInside.map(function (s) { return [s.vma, s.vma + s.actual_size]; });
    // Count clipped portion of sections that cross the region boundary
    split.clipped.forEach(function (s) {
      var start = Math.max(s.vma, region.start);
      var end = Math.min(s.vma + s.actual_size, region.end);
      if (end > start) intervals.push([start, end]);
    });
    var merged = mergeIntervals(intervals);
    var used = merged.reduce(function (sum, iv) { return sum + (iv[1] - iv[0]); }, 0);
    return {
      used: used,
      free: Math.max(region.size - used, 0),
      sections: split.fullyInside,
      clippedSections: split.clipped
    };
  }

  function buildRegionTable(regionReports) {
    var lines = [];
    lines.push('| Region | Start | End | Size | Used | Free | Usage |');
    lines.push('|--------|-------|-----|------|------|------|-------|');
    regionReports.forEach(function (rr) {
      var r = rr.region;
      var pct = r.size > 0 ? ((rr.usage.used / r.size) * 100).toFixed(1) : '0.0';
      lines.push(
        '| ' + escMarkdown(r.name) +
        ' | ' + fmtHex(r.start) +
        ' | ' + fmtHex(r.end) +
        ' | ' + fmtReportBytes(r.size) +
        ' | ' + fmtReportBytes(rr.usage.used) +
        ' | ' + fmtReportBytes(rr.usage.free) +
        ' | ' + pct + '% |'
      );
    });
    lines.push('');
    return lines;
  }

  function buildRegionDetail(rr, topN, symbols) {
    var lines = [];
    var r = rr.region;
    lines.push('## ' + escMarkdown(r.name) + ' (' + fmtHex(r.start) + ' - ' + fmtHex(r.end) + ')');
    lines.push('');

    if (rr.usage.clippedSections.length > 0) {
      lines.push('> ⚠ ' + rr.usage.clippedSections.length + ' section(s) cross this region\'s boundary; ' +
        'only the overlapping portion is counted toward "Used" above.');
      lines.push('');
    }

    if (rr.usage.sections.length === 0 && rr.usage.clippedSections.length === 0) {
      lines.push('No allocated sections in this region.');
      lines.push('');
    } else {
      lines.push('### Sections');
      lines.push('');
      lines.push('| Section | VMA | Size | % of Region | Note |');
      lines.push('|---------|-----|------|-------------|------|');

      var all = rr.usage.sections.map(function (s) { return { s: s, clipped: false }; })
        .concat(rr.usage.clippedSections.map(function (s) { return { s: s, clipped: true }; }));
      all.sort(function (a, b) { return b.s.actual_size - a.s.actual_size; });

      all.forEach(function (entry) {
        var s = entry.s;
        var secPct = r.size > 0 ? ((s.actual_size / r.size) * 100).toFixed(1) : '0.0';
        lines.push(
          '| ' + escMarkdown(s.name || '(unnamed)') +
          ' | ' + fmtHex(s.vma) +
          ' | ' + fmtReportBytes(s.actual_size) +
          ' | ' + secPct + '%' +
          ' | ' + (entry.clipped ? 'crosses boundary' : '') + ' |'
        );
      });
      lines.push('');
    }

    var regionSymbols = (symbols || []).filter(function (s) {
      return s && s.size > 0 && s.address !== undefined && s.address !== null &&
        s.address >= r.start && s.address < r.end;
    }).sort(function (a, b) { return b.size - a.size; });

    var topSymbols = regionSymbols.slice(0, topN);
    if (topSymbols.length > 0) {
      lines.push('### Top ' + Math.min(topN, regionSymbols.length) + ' Symbols by Size in ' + escMarkdown(r.name));
      lines.push('');
      lines.push('| Symbol | Size | Section | Address |');
      lines.push('|--------|------|---------|---------|');
      topSymbols.forEach(function (sym) {
        lines.push(
          '| ' + escMarkdown(sym.name || '(unnamed)') +
          ' | ' + fmtReportBytes(sym.size) +
          ' | ' + escMarkdown(sym.section || '-') +
          ' | ' + fmtHex(sym.address) + ' |'
        );
      });
      lines.push('');
    }

    return lines;
  }

  function generateReport() {
    var collected = collectRegions();
    renderValidationMessages(collected.errors);

    if (collected.valid.length === 0 || collected.errors.length > 0) {
      var out = byId('report-output');
      if (out) out.style.display = 'none';
      if (collected.errors.length === 0) {
        showImportNotice('Add at least one valid region to generate a report.', true);
      }
      return;
    }

    var topNSelect = byId('top-n-select');
    var topN = (topNSelect && parseInt(topNSelect.value, 10)) || DEFAULT_TOP_N;

    var titleInput = byId('report-title-input');
    var title = ((titleInput && titleInput.value) || DEFAULT_TITLE).trim() || DEFAULT_TITLE;

    var sections = (typeof D !== 'undefined' && D && D.sections) || [];
    var symbols = (typeof D !== 'undefined' && D && D.symbols) || [];

    var regionReports = collected.valid.map(function (region) {
      return { region: region, usage: computeRegionUsage(region, sections) };
    });

    var lines = [];
    lines.push('# ' + escMarkdown(title));
    lines.push('');

    var filenameEl = byId('hdr-file');
    var filename = filenameEl ? filenameEl.textContent : '';
    if (filename) lines.push('**File:** ' + escMarkdown(filename));
    lines.push('**Generated:** ' + fmtTimestamp(new Date()));
    lines.push('');

    lines = lines.concat(buildRegionTable(regionReports));

    regionReports.forEach(function (rr) {
      lines = lines.concat(buildRegionDetail(rr, topN, symbols));
    });

    var md = lines.join('\n');

    var mdEl = byId('report-markdown');
    var outEl = byId('report-output');
    if (mdEl) mdEl.textContent = md;
    if (outEl) outEl.style.display = '';

    var dlBtn = byId('download-md-btn');
    if (dlBtn) {
      dlBtn.onclick = function () {
        downloadTextFile(safeFilename(title, 'md'), md, 'text/markdown');
      };
    }
  }

  // Exports

  global.parseReportSize = parseReportSize;
  global.fmtReportBytes = fmtReportBytes;
  global.saveReportRegions = saveReportRegions;
  global.loadReportRegions = loadReportRegions;
  global.saveReportTitle = saveReportTitle;
  global.loadReportTitle = loadReportTitle;
  global.mergeIntervals = mergeIntervals;
  global.addRegionRow = addRegionRow;
  global.exportRegionsJson = exportRegionsJson;
  global.importRegionsJson = importRegionsJson;
  global.renderReportView = renderReportView;
  global.generateReport = generateReport;

})(typeof window !== 'undefined' ? window : this);