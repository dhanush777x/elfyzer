const CHART_COLORS = [
  '#38bdf8', '#4ade80', '#facc15', '#c084fc', '#fb923c',
  '#f87171', '#2dd4bf', '#818cf8', '#f472b6', '#34d399',
  '#60a5fa', '#a78bfa', '#f59e0b', '#10b981', '#ec4899',
  '#06b6d4', '#14b8a6', '#8b5cf6', '#d946ef', '#eab308',
];

function chartColor(i, opacity) {
  return CHART_COLORS[i % CHART_COLORS.length] + (opacity || '');
}

function renderChart() {
  const el = document.getElementById('chart-el');
  try {
    if (!chartInst) {
      chartInst = echarts.init(el, 'dark', { renderer:'canvas' });
      window.addEventListener('resize', ()=>chartInst && chartInst.resize());
    }
    if (chartMode === 'treemap') buildTreemap();
    else buildSunburst();
  } catch(e) {
    console.error('Chart error:', e);
  }
}

function setChartMode(m) {
  chartMode = m;
  document.getElementById('chart-btn-treemap').classList.toggle('active', m==='treemap');
  document.getElementById('chart-btn-sunburst').classList.toggle('active', m==='sunburst');
  renderChart();
}

function buildTreemap() {
  const data = D.address_spaces
    .filter(r => r.used_bytes > 0)
    .map((r, ri) => {
      const label = `0x${r.start.toString(16).padStart(ADDR_WIDTH, '0').toUpperCase()}…0x${r.end.toString(16).padStart(ADDR_WIDTH, '0').toUpperCase()}`;
      const sections = r.sections.filter(s=>s.attributed_size>0);
      return {
        name:  label,
        value: r.used_bytes,
        itemStyle: { color: chartColor(ri, 'cc') },
        children: sections.map((s, si) => ({
          name:  s.name,
          value: s.attributed_size,
          itemStyle: { color: chartColor(ri) },
          children: s.symbols.slice(0,20).map(sym => ({
            name:  sym.name,
            value: sym.size,
            itemStyle: { color: chartColor(ri, '88') },
          })),
        })),
      };
    });

  chartInst.setOption({
    backgroundColor: 'transparent',
    animationDuration: 600,
    animationDurationUpdate: 400,
    animationEasing: 'cubicOut',
    tooltip: {
      formatter: p => `<div style="font-family:'Inter',sans-serif;">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;color:#f1f5f9;margin-bottom:4px;">${escapeHtml(p.name)}</div>
        <div style="display:flex;gap:12px;font-size:11px;">
          <span style="color:#94a3b8;">${fmtB(p.value)}</span>
          <span style="color:#64748b;">${p.value.toLocaleString()} B</span>
        </div></div>`,
      backgroundColor: 'rgba(18,20,30,0.92)',
      borderColor: 'rgba(255,255,255,0.06)',
      borderWidth: 1,
      textStyle: { color: '#f1f5f9', fontSize: 12 },
      extraCssText: 'backdrop-filter:blur(12px);border-radius:10px;padding:10px 14px;box-shadow:0 8px 32px rgba(0,0,0,0.4);',
    },
    series:[{
      type:'treemap', data,
      width:'100%', height:'100%', top:4, bottom:4, left:4, right:4,
      roam:false,
      breadcrumb:{ show:true, bottom:4,
        itemStyle:{ color:'rgba(30,32,48,0.8)', borderColor:'rgba(255,255,255,0.06)', borderWidth:1,
          textStyle:{color:'#94a3b8',fontSize:11,fontFamily:"'IBM Plex Mono',monospace"} },
        emptyItemStyle:{ color:'transparent', borderWidth:0 } },
      label:{
        show:true,
        formatter: p => p.value > 4096
          ? `{n|${p.name}}\n{s|${fmtB(p.value)}}`
          : p.value > 512 ? `{n|${p.name}}` : '',
        rich:{
          n:{ color:'#fff', fontFamily:"'IBM Plex Mono',monospace", fontSize:12, fontWeight:700, textShadow:'0 2px 6px rgba(0,0,0,0.5)' },
          s:{ color:'rgba(255,255,255,0.65)', fontFamily:"'IBM Plex Mono',monospace", fontSize:10 },
        },
        overflow:'break', padding:[4,6],
      },
      upperLabel:{ show:true, height:26, color:'#fff', fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:700, textShadow:'0 2px 6px rgba(0,0,0,0.5)' },
      itemStyle:{ borderColor:'rgba(8,11,16,0.5)', borderWidth:2, gapWidth:2, borderRadius:4 },
      levels:[
        {
          itemStyle:{borderWidth:4,borderColor:'rgba(8,11,16,0.6)',gapWidth:4,borderRadius:6},
          upperLabel:{show:true,height:28,fontSize:12},
          label:{fontSize:13},
        },
        {
          itemStyle:{borderWidth:2,gapWidth:2,borderRadius:3},
          label:{fontSize:11},
        },
        {
          itemStyle:{borderWidth:1,gapWidth:1,borderRadius:2},
          label:{fontSize:9,formatter:p=>p.value>1024?p.name:''},
        },
      ],
      emphasis:{
        itemStyle:{ borderColor:'#38bdf8', borderWidth:2.5, shadowBlur:16, shadowColor:'rgba(56,189,248,0.35)', borderRadius:6 },
        label:{color:'#fff',fontWeight:700},
      },
    }],
  }, true);
}

function buildSunburst() {
  const totalSize = D.address_spaces.reduce((s, r) => s + (r.used_bytes || 0), 0);
  const data = D.address_spaces
    .filter(r => r.used_bytes > 0)
    .map((r, ri) => {
      const label = `0x${r.start.toString(16).padStart(ADDR_WIDTH, '0').toUpperCase()}…0x${r.end.toString(16).padStart(ADDR_WIDTH, '0').toUpperCase()}`;
      const sections = r.sections.filter(s=>s.attributed_size>0);
      return {
        name: label, value: r.used_bytes,
        itemStyle:{ color: chartColor(ri) },
        children: sections.map(s => ({
          name: s.name, value: s.attributed_size,
          itemStyle:{ color: chartColor(ri, 'bb') },
          children: s.symbols.slice(0,20).map(sym => ({
            name: sym.name, value: sym.size,
            itemStyle:{ color: chartColor(ri, '77') },
          })),
        })),
      };
    });

  chartInst.setOption({
    backgroundColor:'transparent',
    animationDuration: 700,
    animationDurationUpdate: 400,
    animationEasing: 'cubicOut',
    graphic: [{
      type:'text', left:'center', top:'46%', z:100,
      style:{ text:fmtB(totalSize), fill:'rgba(255,255,255,0.5)',
        fontFamily:"'IBM Plex Mono',monospace", fontSize:15, fontWeight:700, textAlign:'center' },
    }, {
      type:'text', left:'center', top:'52%', z:100,
      style:{ text:'total allocated', fill:'rgba(255,255,255,0.25)',
        fontFamily:"'IBM Plex Mono',monospace", fontSize:10, textAlign:'center' },
    }],
    tooltip:{
      formatter: p => `<div style="font-family:'Inter',sans-serif;">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;color:#f1f5f9;margin-bottom:4px;">${escapeHtml(p.name)}</div>
        <div style="display:flex;gap:12px;font-size:11px;">
          <span style="color:#94a3b8;">${fmtB(p.value)}</span>
          <span style="color:#64748b;">${p.value.toLocaleString()} B</span>
        </div></div>`,
      backgroundColor:'rgba(18,20,30,0.92)',
      borderColor:'rgba(255,255,255,0.06)',
      borderWidth:1,
      textStyle:{color:'#f1f5f9',fontSize:12},
      extraCssText:'backdrop-filter:blur(12px);border-radius:10px;padding:10px 14px;box-shadow:0 8px 32px rgba(0,0,0,0.4);',
    },
    series:[{
      type:'sunburst', data, sort:'desc',
      radius:['15%','90%'], center:['50%','50%'],
      label:{
        show:true, rotate:'radial',
        fontFamily:"'IBM Plex Mono',monospace", fontSize:11, color:'#fff',
        textShadow:'0 2px 6px rgba(0,0,0,0.5)',
        overflow:'truncate', ellipsis:'…', width:120,
        formatter: p => p.value > 4096 ? p.name : '',
      },
      itemStyle:{ borderColor:'rgba(8,11,16,0.4)', borderWidth:2, borderRadius:2 },
      levels:[
        {
          r0:'0%', r:'15%',
          itemStyle:{borderWidth:0},
          label:{show:false},
        },
        {
          r0:'17%', r:'45%',
          itemStyle:{borderWidth:2.5},
          label:{rotate:'tangential',fontSize:12,fontWeight:700},
        },
        {
          r0:'47%', r:'72%',
          itemStyle:{borderWidth:1.5},
          label:{rotate:'radial',fontSize:10},
        },
        {
          r0:'74%', r:'90%',
          itemStyle:{borderWidth:1},
          label:{rotate:'radial',fontSize:9},
        },
      ],
      emphasis:{
        focus:'ancestor',
        itemStyle:{ borderColor:'#38bdf8', borderWidth:2.5, shadowBlur:14, shadowColor:'rgba(56,189,248,0.3)', borderRadius:4 },
      },
    }],
  }, true);
}
