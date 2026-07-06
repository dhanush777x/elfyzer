document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app');

  app.addEventListener('click', e => {
    // Nav buttons (with SVG inside)
    const navBtn = e.target.closest('.nav-btn');
    if (navBtn) {
      e.preventDefault();
      if (navBtn.id.startsWith('nav-df-')) {
        showDiffTab(navBtn.id.replace('nav-df-', ''));
      } else {
        showView(navBtn.id.replace('nav-', ''));
      }
      return;
    }

    // Chart mode buttons
    if (e.target.id === 'chart-btn-treemap' || e.target.closest('#chart-btn-treemap')) {
      setChartMode('treemap');
      return;
    }
    if (e.target.id === 'chart-btn-sunburst' || e.target.closest('#chart-btn-sunburst')) {
      setChartMode('sunburst');
      return;
    }

    // Export buttons
    if (e.target.id === 'export-sym-csv' || e.target.closest('#export-sym-csv')) {
      exportSymCSV();
      return;
    }
    if (e.target.id === 'export-json' || e.target.closest('#export-json')) {
      exportJSON();
      return;
    }

    // Symbol table header sort
    const sortHeader = e.target.closest('th[id^="sth-"]');
    if (sortHeader) {
      symSort(sortHeader.id.replace('sth-', ''));
      return;
    }

    // "Load new ELF" / reset button
    if (e.target.id === 'reset-btn' || e.target.closest('#reset-btn')) {
      resetApp();
      return;
    }
  });

  // Search inputs (debounced)
  const _debouncedSrcSearch = debounce(renderSources, 200);
  const _debouncedObjSearch = debounce(renderObjects, 200);
  app.addEventListener('input', e => {
    if (e.target.id === 'src-search') {
      _debouncedSrcSearch();
      return;
    }
    if (e.target.id === 'obj-search') {
      _debouncedObjSearch();
      return;
    }
  });
});
