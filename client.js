// Browser half of the Finesse visualizer.
//
// Plain hand-written bundle: no imports/exports, no JSX. The page hands the
// factory React through `require`; everything else is React state and a plain
// same-origin fetch to the Host route this bundle's Host half registered.
//
// The card lives in `conversation.chat.turnTail`, the seat the framework
// allocates for per-turn artifacts. It reads the figures of its own Turn from
// `/finesse-vis/turn` and stays invisible when that Turn contains no Finesse
// code.
window.__ModuleLoader__.load({
  id: 'dsh-finesse-visualizer',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'finesse-visualizer'
    const CARD_ID = 'finesse-visualizer'

    const MESSAGES = {
      en: {
        title: 'Finesse visualization',
        rendering: 'Rendering figures…',
        failed: 'Could not render this model',
        user: 'from your message',
        assistant: 'from the assistant',
        detectors: 'Detectors',
        quiet: 'Finesse 3 · generated automatically',
        open: 'Open image',
      },
      zh: {
        title: 'Finesse 可视化',
        rendering: '正在生成图像…',
        failed: '无法渲染这个模型',
        user: '来自你的消息',
        assistant: '来自助手回复',
        detectors: '探测器读数',
        quiet: 'Finesse 3 · 自动生成',
        open: '在新标签页打开',
      },
    }

    const S = {
      card: {
        marginTop: '10px',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        borderRadius: '12px',
        background: 'var(--dsw-alias-bg-layer-1)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      },
      head: { display: 'flex', alignItems: 'center', gap: '8px', minHeight: '20px' },
      glyph: { display: 'inline-flex', flex: 'none' },
      title: {
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary)',
        lineHeight: '20px',
      },
      source: {
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        borderRadius: '999px',
        padding: '1px 7px',
        whiteSpace: 'nowrap',
      },
      status: {
        marginLeft: 'auto',
        fontSize: '11.5px',
        color: 'var(--dsw-alias-state-warn-primary)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        whiteSpace: 'nowrap',
      },
      dot: {
        width: '6px',
        height: '6px',
        borderRadius: '999px',
        background: 'var(--dsw-alias-state-warn-primary)',
        animation: 'fv-pulse 1.2s ease-in-out infinite',
      },
      figure: { margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' },
      frame: {
        background: '#ffffff',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        overflow: 'hidden',
        display: 'block',
      },
      image: { display: 'block', width: '100%', height: 'auto', cursor: 'zoom-in' },
      caption: {
        fontSize: '11.5px',
        color: 'var(--dsw-alias-label-secondary)',
        lineHeight: '17px',
        padding: '0 2px',
      },
      error: {
        fontSize: '12px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-state-error-primary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        borderRadius: '8px',
        padding: '8px 10px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      },
      chips: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
      chip: {
        fontSize: '11.5px',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '0.5px solid var(--dsw-alias-border-l1)',
        borderRadius: '6px',
        padding: '2px 8px',
        fontVariantNumeric: 'tabular-nums',
      },
      warn: {
        fontSize: '11.5px',
        color: 'var(--dsw-alias-label-secondary)',
        lineHeight: '17px',
      },
      itemTitle: {
        fontSize: '12px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary)',
        marginTop: '2px',
      },
      footer: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
    }

    function number(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return String(value)
      if (value === 0) return '0'
      const abs = Math.abs(value)
      if (abs >= 1e-3 && abs < 1e5) return String(Number(value.toPrecision(4)))
      return value.toExponential(3)
    }

    function formatDetector(detector) {
      if (!detector || typeof detector.name !== 'string') return ''
      if (typeof detector.value === 'number') return `${detector.name} = ${number(detector.value)}`
      if (typeof detector.max === 'number') return `${detector.name} ∈ [${number(detector.min)}, ${number(detector.max)}]`
      return detector.name
    }

    function turnItems(sessionId, turn) {
      const [state, setState] = React.useState({ phase: 'idle', items: [] })
      React.useEffect(() => {
        if (!sessionId || turn === undefined || turn === null) return undefined
        let alive = true
        let timer = null
        let attempts = 0
        const load = async () => {
          attempts += 1
          try {
            const query = `/finesse-vis/turn?sessionId=${encodeURIComponent(String(sessionId))}&turn=${encodeURIComponent(String(turn))}`
            const response = await fetch(query, {
              cache: 'no-store',
              credentials: 'same-origin',
              headers: { accept: 'application/json' },
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const payload = await response.json()
            if (!alive) return
            const items = Array.isArray(payload.items) ? payload.items : []
            setState({ phase: 'ready', items })
            const rendering = items.some((item) => item && item.status === 'rendering')
            if (rendering && attempts < 160) timer = setTimeout(load, 1200)
            else if (items.length === 0 && attempts < 3) timer = setTimeout(load, 1800)
          } catch (error) {
            if (!alive) return
            if (attempts < 3) {
              timer = setTimeout(load, 2200)
              return
            }
            setState({ phase: 'error', items: [] })
          }
        }
        setState({ phase: 'loading', items: [] })
        load()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [sessionId, turn])
      return state
    }

    function Card(props) {
      const { sessionId, turn, t } = props
      const state = turnItems(sessionId, turn)
      if (state.items.length === 0) return null

      const rendering = state.items.some((item) => item.status === 'rendering')
      return h(
        'section',
        { style: S.card, 'data-finesse-visualizer': String(turn) },
        h(
          'header',
          { style: S.head },
          h(Glyph),
          h('span', { style: S.title }, t('title')),
          h('span', { style: S.source }, t(state.items.some((i) => i.source === 'user') ? 'user' : 'assistant')),
          rendering
            ? h('span', { style: S.status }, h('span', { style: S.dot }), t('rendering'))
            : null,
        ),
        ...state.items.map((item, index) => h(Item, { key: item.id || index, item, t })),
        h('span', { style: S.footer }, t('quiet')),
      )
    }

    function Item(props) {
      const { item, t } = props
      const images = Array.isArray(item.images) ? item.images : []
      const detectors = Array.isArray(item.detectors) ? item.detectors : []
      const warnings = Array.isArray(item.warnings) ? item.warnings : []
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        item.title && images.length > 1 ? h('span', { style: S.itemTitle }, item.title) : null,
        ...images.map((image) =>
          h(
            'figure',
            { key: image.file || image.url, style: S.figure },
            h(
              'a',
              {
                href: image.url,
                target: '_blank',
                rel: 'noreferrer noopener',
                title: t('open'),
                style: S.frame,
              },
              h('img', { src: image.url, alt: image.title || item.title || 'Finesse figure', style: S.image }),
            ),
            image.title || image.caption
              ? h('figcaption', { style: S.caption }, [image.title, image.caption].filter(Boolean).join(' · '))
              : null,
          ),
        ),
        item.status === 'error' && item.error ? h('div', { style: S.error }, item.error) : null,
        detectors.length > 0
          ? h(
              'div',
              { style: S.chips, 'aria-label': t('detectors') },
              ...detectors.map((detector, index) =>
                h('span', { key: index, style: S.chip }, formatDetector(detector)),
              ),
            )
          : null,
        warnings.length > 0
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
              ...warnings.slice(0, 3).map((warning, index) =>
                h('span', { key: index, style: S.warn }, warning),
              ),
            )
          : null,
      )
    }

    function Glyph() {
      return h(
        'svg',
        { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, style: S.glyph },
        h('rect', { x: 1.6, y: 3.2, width: 20.8, height: 17.6, rx: 4, fill: 'var(--dsw-alias-bg-layer-2)' }),
        h('path', { d: 'M4.6 12h5.2', stroke: '#c0392b', strokeWidth: 2, strokeLinecap: 'round' }),
        h('path', { d: 'M9.8 12h4.6', stroke: '#2c6fb5', strokeWidth: 2, strokeLinecap: 'round' }),
        h('path', { d: 'M14.4 12 17 8.8M14.4 12 17 15.2', stroke: '#2c6fb5', strokeWidth: 1.4, strokeLinecap: 'round', opacity: 0.75 }),
        h('path', { d: 'M17 8.4v7.2', stroke: '#7d3c98', strokeWidth: 2.2, strokeLinecap: 'round' }),
        h('path', { d: 'M19.4 12h1.4', stroke: '#1e8449', strokeWidth: 2, strokeLinecap: 'round' }),
      )
    }

    // ==================== visual designer ====================
    const PANEL_ID = 'finesse-designer'
    const BOX_W = 88
    const BOX_H = 92

    const TYPES = {
      laser: {
        label: '激光器', prefix: 'L', icon: 'laser.png', ports: ['p1'],
        params: ['P'], defaults: { P: 1 },
      },
      mirror: {
        label: '反射镜', prefix: 'M', icon: 'mirror.png', ports: ['p1', 'p2'],
        params: ['R', 'T', 'Rc'], defaults: { R: 0.99, T: 0.01, Rc: '' },
      },
      beamsplitter: {
        label: '分束器', prefix: 'BS', icon: 'beamsplitter.png', ports: ['p1', 'p2', 'p3', 'p4'],
        params: ['R', 'T', 'alpha'], defaults: { R: 0.5, T: 0.5, alpha: 45 },
      },
      lens: {
        label: '透镜', prefix: 'LENS', icon: 'lens.png', ports: ['p1', 'p2'],
        params: ['f'], defaults: { f: 1 },
      },
      modulator: {
        label: '调制器', prefix: 'EOM', icon: 'modulator.png', ports: ['p1', 'p2'],
        params: ['f', 'midx'], defaults: { f: 1e7, midx: 0.1 },
      },
      isolator: {
        label: '隔离器', prefix: 'ISO', icon: 'isolator.png', ports: ['p1', 'p2'],
        params: ['S'], defaults: { S: 0 },
      },
      photodetector: {
        label: '光电探测器', prefix: 'PD', icon: 'photodetector.png', ports: ['p1'],
        params: [], defaults: {},
      },
      ccd: {
        label: 'CCD 相机', prefix: 'CCD', icon: 'ccd.png', ports: ['p1'],
        params: ['xlim', 'ylim', 'npts'], defaults: { xlim: 1, ylim: 1, npts: 64 },
      },
    }
    const TYPE_ORDER = ['laser', 'mirror', 'beamsplitter', 'lens', 'modulator', 'isolator', 'photodetector', 'ccd']

    const D = {
      page: {
        padding: '18px 20px 26px', display: 'flex', flexDirection: 'column', gap: '12px',
        minHeight: '100%', boxSizing: 'border-box', background: 'var(--dsw-alias-bg-base)',
      },
      header: { display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' },
      title: { fontSize: '18px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      subtitle: { fontSize: '12.5px', color: 'var(--dsw-alias-label-secondary)', marginTop: '3px' },
      toolbar: { marginLeft: 'auto', display: 'flex', gap: '8px', flexWrap: 'wrap' },
      button: {
        fontSize: '12.5px', lineHeight: '18px', padding: '6px 12px', borderRadius: '8px',
        border: '0.5px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)', cursor: 'pointer',
      },
      primary: {
        fontSize: '12.5px', lineHeight: '18px', padding: '6px 12px', borderRadius: '8px',
        border: '0.5px solid transparent', background: 'var(--dsw-alias-brand-primary)',
        color: '#ffffff', cursor: 'pointer',
      },
      layout: {
        display: 'grid', gridTemplateColumns: '150px minmax(0, 1fr) 270px',
        gap: '12px', alignItems: 'start',
      },
      panel: {
        border: '0.5px solid var(--dsw-alias-border-l1)', borderRadius: '12px',
        background: 'var(--dsw-alias-bg-layer-1)', padding: '10px',
      },
      sectionTitle: {
        fontSize: '11.5px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)',
        marginBottom: '8px', letterSpacing: '0.02em',
      },
      paletteItem: {
        display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '5px 6px',
        marginBottom: '3px', borderRadius: '8px', border: '0.5px solid transparent',
        background: 'transparent', cursor: 'grab', color: 'var(--dsw-alias-label-primary)',
        fontSize: '12px', textAlign: 'left',
      },
      paletteIcon: { width: '26px', height: '26px', objectFit: 'contain', flex: 'none' },
      canvasWrap: {
        overflow: 'auto', border: '0.5px solid var(--dsw-alias-border-l1)',
        borderRadius: '12px', background: 'var(--dsw-alias-bg-base)',
        height: '600px', position: 'relative',
      },
      canvas: {
        position: 'relative', width: '1040px', height: '700px',
        backgroundImage: 'radial-gradient(circle, var(--dsw-alias-border-l1) 1px, transparent 1px)',
        backgroundSize: '20px 20px', touchAction: 'none',
      },
      comp: {
        position: 'absolute', width: BOX_W + 'px', height: BOX_H + 'px',
        cursor: 'grab', userSelect: 'none', touchAction: 'none', borderRadius: '8px',
      },
      compGlyph: { position: 'absolute', left: '18px', top: '4px', pointerEvents: 'none' },
      compName: {
        position: 'absolute', left: 0, right: 0, bottom: '3px', textAlign: 'center',
        fontSize: '10.5px', color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none',
      },
      port: {
        position: 'absolute', width: '12px', height: '12px', marginLeft: '-6px',
        marginTop: '-6px', borderRadius: '999px', background: 'var(--dsw-alias-bg-layer-1)',
        border: '1.5px solid #c0392b', cursor: 'crosshair', zIndex: 3, boxSizing: 'border-box',
      },
      field: { display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '8px' },
      fieldLabel: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      input: {
        width: '100%', boxSizing: 'border-box', fontSize: '12.5px', padding: '5px 8px',
        borderRadius: '7px', border: '0.5px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
      },
      hint: { fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)', lineHeight: '18px' },
      code: {
        margin: 0, padding: '10px 12px', borderRadius: '8px', maxHeight: '260px',
        overflow: 'auto', background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)', fontSize: '12px', lineHeight: '18px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        whiteSpace: 'pre',
      },
      warn: { fontSize: '11.5px', color: 'var(--dsw-alias-state-warn-primary)', lineHeight: '18px' },
      codeHead: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' },
      legendRow: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      dot: { width: '8px', height: '8px', borderRadius: '999px' },
    }

    function isDetector(component) {
      return !!component && (component.type === 'photodetector' || component.type === 'ccd')
    }

    function portPos(type, port) {
      if (type === 'beamsplitter') {
        if (port === 'p1') return { x: 0, y: BOX_H / 2 }
        if (port === 'p2') return { x: BOX_W / 2, y: 0 }
        if (port === 'p3') return { x: BOX_W, y: BOX_H / 2 }
        return { x: BOX_W / 2, y: BOX_H }
      }
      if (type === 'laser') return { x: BOX_W, y: BOX_H / 2 }
      if (type === 'photodetector' || type === 'ccd') return { x: 0, y: BOX_H / 2 }
      return port === 'p2' ? { x: BOX_W, y: BOX_H / 2 } : { x: 0, y: BOX_H / 2 }
    }

    function fmtNumber(value) {
      if (value === '' || value === null || value === undefined) return null
      const n = Number(value)
      if (!Number.isFinite(n)) return String(value)
      if (n === 0) return '0'
      const abs = Math.abs(n)
      if (abs < 1e-3 || abs >= 1e6) return n.toExponential().replace('e+', 'e')
      return String(Number(n.toPrecision(12)))
    }

    function uniqueName(prefix, components) {
      let index = 1
      const taken = new Set(components.map((c) => c.name))
      while (taken.has(prefix + index)) index += 1
      return prefix + index
    }

    function generateKat(components, connections) {
      const byId = new Map(components.map((c) => [c.id, c]))
      const lines = ['# Finesse model from the visual designer', '']
      const warnings = []
      const body = []

      components.filter((c) => !isDetector(c)).forEach((c) => {
        const p = c.params || {}
        const f = (key) => fmtNumber(p[key])
        switch (c.type) {
          case 'laser':
            body.push(`l ${c.name} P=${f('P') ?? 1}`)
            break
          case 'mirror':
            body.push(`m ${c.name} R=${f('R') ?? 0.99} T=${f('T') ?? 0.01}${p.Rc !== '' && p.Rc !== undefined && p.Rc !== null && Number(p.Rc) !== 0 ? ` Rc=${f('Rc')}` : ''}`)
            break
          case 'beamsplitter':
            body.push(`bs ${c.name} R=${f('R') ?? 0.5} T=${f('T') ?? 0.5} alpha=${f('alpha') ?? 45}`)
            break
          case 'lens':
            body.push(`lens ${c.name} f=${f('f') ?? 1}`)
            break
          case 'modulator':
            body.push(`mod ${c.name} f=${f('f') ?? 1e7} midx=${f('midx') ?? 0.1}`)
            break
          case 'isolator':
            body.push(`isol ${c.name} S=${f('S') ?? 0}`)
            break
          default:
            break
        }
      })

      const spaces = []
      const detectors = []
      const usedDetectors = new Set()
      let spaceIndex = 0

      connections.forEach((conn) => {
        const A = byId.get(conn.a.comp)
        const B = byId.get(conn.b.comp)
        if (!A || !B) return
        const aDet = isDetector(A)
        const bDet = isDetector(B)
        if (aDet && bDet) {
          warnings.push(`${A.name} 与 ${B.name} 都是探测器，已跳过`)
          return
        }
        if (aDet || bDet) {
          const det = aDet ? A : B
          const other = aDet ? B : A
          const otherPort = aDet ? conn.b.port : conn.a.port
          usedDetectors.add(det.id)
          if (det.type === 'photodetector') {
            detectors.push(`pd ${det.name} ${other.name}.${otherPort}.o`)
          } else {
            const p = det.params || {}
            detectors.push(`ccd ${det.name} ${other.name}.${otherPort}.o ${fmtNumber(p.xlim) ?? 1} ${fmtNumber(p.ylim) ?? 1} ${Math.round(Number(p.npts) || 64)}`)
          }
          return
        }
        spaceIndex += 1
        spaces.push(`s s${spaceIndex} ${A.name}.${conn.a.port} ${B.name}.${conn.b.port} L=${fmtNumber(conn.length) ?? 0.5}`)
      })

      components.filter(isDetector).forEach((det) => {
        if (!usedDetectors.has(det.id)) warnings.push(`${det.name} 还没有连接，未写进代码`)
      })
      components.filter((c) => !isDetector(c)).forEach((c) => {
        const used = connections.some((conn) => conn.a.comp === c.id || conn.b.comp === c.id)
        if (!used) warnings.push(`${c.name} 还没有连接`)
      })

      const code = lines.concat(body, [''], spaces, [''], detectors).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
      return { code, warnings }
    }

    const PRESET = {
      components: [
        { id: 'preset-1', type: 'laser', name: 'L1', x: 70, y: 300, params: { P: 1 } },
        { id: 'preset-2', type: 'beamsplitter', name: 'BS1', x: 310, y: 300, params: { R: 0.5, T: 0.5, alpha: 45 } },
        { id: 'preset-3', type: 'mirror', name: 'M1', x: 580, y: 300, params: { R: 0.99, T: 0.01, Rc: '' } },
        { id: 'preset-4', type: 'mirror', name: 'M2', x: 310, y: 80, params: { R: 0.99, T: 0.01, Rc: '' } },
        { id: 'preset-5', type: 'photodetector', name: 'PD1', x: 310, y: 530, params: {} },
      ],
      connections: [
        { id: 'preset-c1', a: { comp: 'preset-1', port: 'p1' }, b: { comp: 'preset-2', port: 'p1' }, length: 0.5 },
        { id: 'preset-c2', a: { comp: 'preset-2', port: 'p2' }, b: { comp: 'preset-4', port: 'p1' }, length: 3 },
        { id: 'preset-c3', a: { comp: 'preset-2', port: 'p3' }, b: { comp: 'preset-3', port: 'p1' }, length: 3 },
        { id: 'preset-c4', a: { comp: 'preset-2', port: 'p4' }, b: { comp: 'preset-5', port: 'p1' }, length: 0.5 },
      ],
    }

    function DesignerGlyph(props) {
      const type = props.type
      const size = props.size || 44
      const base = {
        width: size, height: size, viewBox: '0 0 64 64', fill: 'none',
        'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
      }
      if (type === 'laser') {
        return h('svg', base,
          h('rect', { x: 8, y: 15, width: 48, height: 6, rx: 3, fill: '#8fa2b4' }),
          h('rect', { x: 8, y: 43, width: 48, height: 6, rx: 3, fill: '#8fa2b4' }),
          h('rect', { x: 6, y: 20, width: 52, height: 24, rx: 6, fill: '#2b3746', stroke: '#131a22', strokeWidth: 1.5 }),
          h('rect', { x: 14, y: 26, width: 18, height: 12, rx: 2, fill: '#111a24' }),
          h('circle', { cx: 19, cy: 32, r: 2, fill: '#54c08a' }),
          h('circle', { cx: 25, cy: 32, r: 2, fill: '#d84b3a' }),
          h('rect', { x: 34, y: 25, width: 20, height: 14, rx: 5, fill: '#d84b3a' }),
          h('rect', { x: 36, y: 27, width: 14, height: 4, rx: 2, fill: '#ff8a75' }),
        )
      }
      if (type === 'mirror') {
        return h('svg', base,
          h('rect', { x: 18, y: 5, width: 28, height: 54, rx: 6, fill: '#53667a', stroke: '#131a22', strokeWidth: 1.5 }),
          h('rect', { x: 22, y: 9, width: 20, height: 46, rx: 3, fill: '#bcd7e8' }),
          h('rect', { x: 22, y: 9, width: 5, height: 46, rx: 2, fill: '#eef9ff' }),
          h('rect', { x: 37, y: 9, width: 5, height: 46, rx: 2, fill: '#74c79a' }),
          h('path', { d: 'M28 14c4 10 4 26 0 36', stroke: '#ffffff', strokeWidth: 2, opacity: 0.6 }),
        )
      }
      if (type === 'beamsplitter') {
        return h('svg', base,
          h('rect', { x: 9, y: 9, width: 46, height: 46, rx: 7, fill: '#53667a', stroke: '#131a22', strokeWidth: 1.5 }),
          h('rect', { x: 13, y: 13, width: 38, height: 38, rx: 4, fill: '#cfe4f2' }),
          h('path', { d: 'M15 49 49 15', stroke: '#9b59b6', strokeWidth: 4, strokeLinecap: 'round' }),
          h('path', { d: 'M15 49 49 15', stroke: '#f3e6f8', strokeWidth: 1.2, strokeLinecap: 'round' }),
        )
      }
      if (type === 'lens') {
        return h('svg', base,
          h('path', { d: 'M32 6c14 14 14 38 0 52-14-14-14-38 0-52Z', fill: '#74d3a2', stroke: '#1f7a52', strokeWidth: 2 }),
          h('path', { d: 'M28 12c-5 12-5 28 0 40', stroke: '#ffffff', strokeWidth: 3, opacity: 0.55 }),
        )
      }
      if (type === 'modulator') {
        return h('svg', base,
          h('rect', { x: 8, y: 10, width: 48, height: 44, rx: 6, fill: '#46586a', stroke: '#131a22', strokeWidth: 1.5 }),
          h('rect', { x: 16, y: 18, width: 32, height: 28, rx: 3, fill: '#f4c430', stroke: '#a86d0c' }),
          h('rect', { x: 13, y: 12, width: 38, height: 5, rx: 2, fill: '#d4af37' }),
          h('rect', { x: 13, y: 47, width: 38, height: 5, rx: 2, fill: '#d4af37' }),
          h('circle', { cx: 56, cy: 32, r: 3, fill: '#d4af37' }),
        )
      }
      if (type === 'isolator') {
        return h('svg', base,
          h('rect', { x: 5, y: 21, width: 54, height: 22, rx: 11, fill: '#3d4f61', stroke: '#131a22', strokeWidth: 1.5 }),
          h('rect', { x: 4, y: 24, width: 8, height: 16, rx: 3, fill: '#8fa2b4' }),
          h('rect', { x: 52, y: 24, width: 8, height: 16, rx: 3, fill: '#8fa2b4' }),
          h('rect', { x: 15, y: 25, width: 34, height: 14, rx: 3, fill: '#0d1a20' }),
          h('path', { d: 'M20 28l5 4-5 4Z', fill: '#1abc9c' }),
          h('path', { d: 'M29 28l5 4-5 4Z', fill: '#1abc9c' }),
        )
      }
      if (type === 'photodetector') {
        return h('svg', base,
          h('rect', { x: 11, y: 19, width: 16, height: 30, rx: 4, fill: '#2b3746', stroke: '#131a22', strokeWidth: 1.5 }),
          h('ellipse', { cx: 30, cy: 34, rx: 4, ry: 18, fill: '#d4af37' }),
          h('path', { d: 'M30 15c16 2 22 9 22 19s-6 17-22 19Z', fill: '#e67e22', stroke: '#8e1b13', strokeWidth: 1.5 }),
          h('path', { d: 'M34 18c8 2 12 7 12 11', stroke: '#ffe0a8', strokeWidth: 3, opacity: 0.6 }),
        )
      }
      if (type === 'ccd') {
        return h('svg', base,
          h('rect', { x: 6, y: 13, width: 52, height: 38, rx: 7, fill: '#3d4f61', stroke: '#131a22', strokeWidth: 1.5 }),
          h('rect', { x: 11, y: 18, width: 42, height: 28, rx: 4, fill: '#1b2430' }),
          h('circle', { cx: 32, cy: 32, r: 12, fill: '#7ab6dc', stroke: '#0c1a24' }),
          h('circle', { cx: 32, cy: 32, r: 6, fill: '#0b1a24' }),
          h('circle', { cx: 47, cy: 22, r: 2, fill: '#54c08a' }),
        )
      }
      return h('svg', base, h('rect', { x: 12, y: 12, width: 40, height: 40, rx: 6, fill: '#53667a' }))
    }

    function DesignerIcon(props) {
      const size = props && props.size ? props.size : 18
      return h(
        'svg',
        {
          width: size, height: size, viewBox: '0 0 20 20', fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
          strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false',
        },
        h('path', { d: 'M2.5 15h15' }),
        h('rect', { x: 3, y: 7.5, width: 3, height: 5, rx: 1 }),
        h('path', { d: 'M6 10h5' }),
        h('path', { d: 'M11 10l2.4-2.4M11 10l2.4 2.4' }),
        h('circle', { cx: 15.6, cy: 10, r: 1.6 }),
      )
    }

    function DesignerLink(props) {
      return h(
        'button',
        {
          type: 'button',
          onClick: props.openPanel,
          title: '打开 Finesse 光学设计器',
          style: {
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            margin: '0 auto 6px', padding: '4px 10px', borderRadius: '999px',
            border: '0.5px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-layer-1)',
            color: 'var(--dsw-alias-label-secondary)', fontSize: '11.5px',
            cursor: 'pointer',
          },
        },
        h(DesignerIcon, { size: 13 }),
        h('span', null, 'Finesse 设计器'),
      )
    }

    function DesignerPanel() {
      const [components, setComponents] = React.useState([])
      const [connections, setConnections] = React.useState([])
      const [selected, setSelected] = React.useState(null)
      const [pending, setPending] = React.useState(null)
      const [dragId, setDragId] = React.useState(null)
      const [copied, setCopied] = React.useState(false)
      const canvasRef = React.useRef(null)
      const idRef = React.useRef(0)
      const dragRef = React.useRef(null)
      const pendingRef = React.useRef(null)
      const componentsRef = React.useRef(components)
      const connectRef = React.useRef(null)
      componentsRef.current = components
      pendingRef.current = pending
      const nextId = (prefix) => {
        idRef.current += 1
        return prefix + idRef.current
      }

      function addComponent(type, x, y) {
        const spec = TYPES[type]
        if (!spec) return
        const id = nextId('node-')
        setComponents((prev) => [
          ...prev,
          {
            id, type, name: uniqueName(spec.prefix, prev),
            x: Math.max(0, Math.min(940, x)), y: Math.max(0, Math.min(600, y)),
            params: { ...spec.defaults },
          },
        ])
        setSelected({ kind: 'component', id })
      }

      function removeSelected() {
        if (!selected) return
        if (selected.kind === 'component') {
          setComponents((prev) => prev.filter((c) => c.id !== selected.id))
          setConnections((prev) => prev.filter((c) => c.a.comp !== selected.id && c.b.comp !== selected.id))
        } else {
          setConnections((prev) => prev.filter((c) => c.id !== selected.id))
        }
        setSelected(null)
      }

      function connect(aComp, aPort, bComp, bPort) {
        const list = componentsRef.current
        const A = list.find((c) => c.id === aComp)
        const B = list.find((c) => c.id === bComp)
        if (!A || !B || aComp === bComp) return
        if (isDetector(A) && isDetector(B)) return
        const id = nextId('link-')
        setConnections((prev) => {
          const keep = prev.filter((conn) => {
            const aHit = (conn.a.comp === aComp && conn.a.port === aPort) || (conn.b.comp === aComp && conn.b.port === aPort)
            const bHit = (conn.a.comp === bComp && conn.b.port === bPort) || (conn.b.comp === bComp && conn.b.port === bPort)
            return !aHit && !bHit
          })
          return keep.concat([{ id, a: { comp: aComp, port: aPort }, b: { comp: bComp, port: bPort }, length: 0.5 }])
        })
        setSelected({ kind: 'connection', id })
      }
      connectRef.current = connect

      React.useEffect(() => {
        const onMove = (event) => {
          const canvas = canvasRef.current
          if (!canvas) return
          const rect = canvas.getBoundingClientRect()
          if (dragRef.current) {
            const drag = dragRef.current
            const x = Math.max(0, Math.min(940, event.clientX - rect.left - drag.dx))
            const y = Math.max(0, Math.min(600, event.clientY - rect.top - drag.dy))
            setComponents((prev) => prev.map((c) => (c.id === drag.id ? { ...c, x, y } : c)))
          }
          if (pendingRef.current) {
            const inside = event.clientX - rect.left
            const insideY = event.clientY - rect.top
            setPending((p) => (p ? { ...p, cursorX: inside, cursorY: insideY } : p))
          }
        }
        const onUp = (event) => {
          const pointer = pendingRef.current
          if (pointer) {
            pendingRef.current = null
            setPending(null)
            const element = document.elementFromPoint(event.clientX, event.clientY)
            const target = element && element.closest ? element.closest('[data-fport]') : null
            if (target) {
              const comp = target.getAttribute('data-comp')
              const port = target.getAttribute('data-port')
              if (comp && port && comp !== pointer.comp) connectRef.current(pointer.comp, pointer.port, comp, port)
            }
          }
          if (dragRef.current) {
            dragRef.current = null
            setDragId(null)
          }
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
        }
      }, [])

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Delete' && event.key !== 'Backspace') return
          const tag = document.activeElement && document.activeElement.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA') return
          if (selected) {
            event.preventDefault()
            removeSelected()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [selected])

      const { code, warnings } = generateKat(components, connections)
      const selectedComponent = selected && selected.kind === 'component'
        ? components.find((c) => c.id === selected.id)
        : null
      const selectedConnection = selected && selected.kind === 'connection'
        ? connections.find((c) => c.id === selected.id)
        : null

      const startDrag = (event, component) => {
        if (event.button !== 0) return
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        dragRef.current = {
          id: component.id,
          dx: event.clientX - rect.left - component.x,
          dy: event.clientY - rect.top - component.y,
        }
        setDragId(component.id)
        setSelected({ kind: 'component', id: component.id })
        event.stopPropagation()
        event.preventDefault()
      }

      const startConnect = (event, component, port) => {
        if (event.button !== 0) return
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        pendingRef.current = {
          comp: component.id,
          port,
          cursorX: event.clientX - rect.left,
          cursorY: event.clientY - rect.top,
        }
        setPending(pendingRef.current)
        event.stopPropagation()
        event.preventDefault()
      }

      const byId = new Map(components.map((c) => [c.id, c]))
      const absolutePort = (component, port) => {
        const offset = portPos(component.type, port)
        return { x: component.x + offset.x, y: component.y + offset.y }
      }

      const links = connections.map((conn) => {
        const A = byId.get(conn.a.comp)
        const B = byId.get(conn.b.comp)
        if (!A || !B) return null
        const p1 = absolutePort(A, conn.a.port)
        const p2 = absolutePort(B, conn.b.port)
        const detectorLink = isDetector(A) || isDetector(B)
        const isSelected = selected && selected.kind === 'connection' && selected.id === conn.id
        return h(
          'g',
          { key: conn.id },
          h('line', {
            x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
            stroke: 'transparent', strokeWidth: 14,
            style: { pointerEvents: 'stroke', cursor: 'pointer' },
            onClick: () => setSelected({ kind: 'connection', id: conn.id }),
          }),
          h('line', {
            x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
            stroke: isSelected ? '#2c6fb5' : '#9fb0c0',
            strokeWidth: isSelected ? 3 : 2,
            strokeDasharray: detectorLink ? '5 4' : undefined,
            style: { pointerEvents: 'none' },
          }),
          h(
            'text',
            {
              x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 - 5,
              textAnchor: 'middle', fontSize: 9, fill: '#6b7785',
              style: { pointerEvents: 'none', userSelect: 'none' },
            },
            detectorLink ? 'detector' : `${fmtNumber(conn.length) ?? 0.5} m`,
          ),
        )
      })

      const palette = TYPE_ORDER.map((type) => h(
        'button',
        {
          key: type,
          type: 'button',
          draggable: true,
          style: D.paletteItem,
          onDragStart: (event) => {
            event.dataTransfer.setData('text/plain', type)
            event.dataTransfer.effectAllowed = 'copy'
          },
          onClick: () => addComponent(type, 70 + (components.length % 6) * 150, 70 + Math.floor(components.length / 6) * 130),
          title: `拖动或点击添加${TYPES[type].label}`,
        },
        h(DesignerGlyph, { type, size: 26 }),
        h('span', null, TYPES[type].label),
      ))

      const componentNodes = components.map((component) => {
        const selectedHere = selected && selected.kind === 'component' && selected.id === component.id
        return h(
          'div',
          {
            key: component.id,
            style: {
              ...D.comp,
              left: component.x + 'px',
              top: component.y + 'px',
              outline: selectedHere ? '2px solid var(--dsw-alias-brand-primary)' : 'none',
              outlineOffset: '1px',
              background: selectedHere ? 'var(--dsw-alias-bg-layer-2)' : 'transparent',
              zIndex: dragId === component.id ? 5 : 2,
            },
            onPointerDown: (event) => startDrag(event, component),
          },
          h('div', { style: D.compGlyph }, h(DesignerGlyph, { type: component.type, size: 52 })),
          h('div', { style: D.compName }, component.name),
          TYPES[component.type].ports.map((port) => {
            const offset = portPos(component.type, port)
            return h('div', {
              key: port,
              'data-fport': 'true',
              'data-comp': component.id,
              'data-port': port,
              style: { ...D.port, left: offset.x + 'px', top: offset.y + 'px' },
              onPointerDown: (event) => startConnect(event, component, port),
              title: `${component.name}.${port}`,
            })
          }),
        )
      })

      const properties = selectedComponent
        ? h(
            'div',
            null,
            h('div', { style: D.sectionTitle }, '元件属性'),
            h('div', { style: D.field },
              h('span', { style: D.fieldLabel }, '名称'),
              h('input', {
                style: D.input, value: selectedComponent.name,
                onChange: (event) => {
                  const value = event.target.value
                  setComponents((prev) => prev.map((c) => (c.id === selectedComponent.id ? { ...c, name: value } : c)))
                },
              }),
            ),
            TYPES[selectedComponent.type].params.map((key) => h(
              'div',
              { key, style: D.field },
              h('span', { style: D.fieldLabel }, key === 'Rc' ? 'Rc（可选，m）' : key),
              h('input', {
                style: D.input, type: 'text', inputMode: 'decimal',
                value: selectedComponent.params[key] === undefined ? '' : String(selectedComponent.params[key]),
                onChange: (event) => {
                  const value = event.target.value
                  setComponents((prev) => prev.map((c) => (
                    c.id === selectedComponent.id ? { ...c, params: { ...c.params, [key]: value } } : c
                  )))
                },
              }),
            )),
            h('div', { style: D.hint }, `类型：${TYPES[selectedComponent.type].label}`),
            h('button', {
              type: 'button',
              style: { ...D.button, marginTop: '8px' },
              onClick: removeSelected,
            }, '删除元件'),
          )
        : selectedConnection
          ? h(
              'div',
              null,
              h('div', { style: D.sectionTitle }, '链路属性'),
              h('div', { style: D.hint }, `${byId.get(selectedConnection.a.comp)?.name}.${selectedConnection.a.port} ↔ ${byId.get(selectedConnection.b.comp)?.name}.${selectedConnection.b.port}`),
              h('div', { style: { ...D.field, marginTop: '8px' } },
                h('span', { style: D.fieldLabel }, '长度 L（m）'),
                h('input', {
                  style: D.input, type: 'text', inputMode: 'decimal',
                  value: String(selectedConnection.length),
                  onChange: (event) => {
                    const value = event.target.value
                    setConnections((prev) => prev.map((c) => (c.id === selectedConnection.id ? { ...c, length: value } : c)))
                  },
                }),
              ),
              h('button', {
                type: 'button',
                style: { ...D.button, marginTop: '8px' },
                onClick: removeSelected,
              }, '删除链路'),
            )
          : h('div', { style: D.hint }, '选择一个元件或链路后在这里编辑参数。\n拖动元件移动位置；从红色端口拖到另一个端口建立连接；选中后按 Delete 删除。')

      return h(
        'div',
        { style: D.page },
        h(
          'div',
          { style: D.header },
          h('div', null,
            h('div', { style: D.title }, 'Finesse 光学设计器'),
            h('div', { style: D.subtitle }, '拖动元件到画布、连接端口，右侧实时生成 KatScript。'),
          ),
          h('div', { style: D.toolbar },
            h('button', {
              type: 'button', style: D.button,
              onClick: () => {
                setComponents(PRESET.components.map((c) => ({ ...c, params: { ...c.params } })))
                setConnections(PRESET.connections.map((c) => ({ ...c })))
                setSelected(null)
              },
            }, '迈克尔逊示例'),
            h('button', {
              type: 'button', style: D.button,
              onClick: () => { setComponents([]); setConnections([]); setSelected(null) },
            }, '清空'),
            h('button', {
              type: 'button', style: D.primary,
              onClick: () => {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(code).then(() => {
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1500)
                  }).catch(() => {})
                }
              },
            }, copied ? '已复制' : '复制代码'),
          ),
        ),
        h(
          'div',
          { style: D.layout },
          h('div', { style: D.panel }, h('div', { style: D.sectionTitle }, '元件库'), ...palette),
          h(
            'div',
            { style: D.canvasWrap, className: 'finesse-canvas' },
            h(
              'div',
              {
                ref: canvasRef,
                style: D.canvas,
                onPointerDown: () => setSelected(null),
                onDragOver: (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' },
                onDrop: (event) => {
                  event.preventDefault()
                  const type = event.dataTransfer.getData('text/plain')
                  if (!TYPES[type]) return
                  const rect = canvasRef.current.getBoundingClientRect()
                  addComponent(type, event.clientX - rect.left - BOX_W / 2, event.clientY - rect.top - BOX_H / 2)
                },
              },
              h('svg', { style: { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' } },
                ...links,
                pending && byId.get(pending.comp)
                  ? h('line', {
                      x1: absolutePort(byId.get(pending.comp), pending.port).x,
                      y1: absolutePort(byId.get(pending.comp), pending.port).y,
                      x2: pending.cursorX, y2: pending.cursorY,
                      stroke: '#2c6fb5', strokeWidth: 2, strokeDasharray: '5 4',
                    })
                  : null,
              ),
              ...componentNodes,
            ),
          ),
          h('div', { style: D.panel }, properties,
            h('div', { style: { ...D.hint, marginTop: '10px', borderTop: '0.5px solid var(--dsw-alias-border-l1)', paddingTop: '8px' } },
              h('div', { style: D.legendRow }, h('span', { style: { ...D.dot, background: '#c0392b' } }), '端口（拖动连线）'),
              h('div', { style: D.legendRow }, h('span', { style: { ...D.dot, background: '#9fb0c0' } }), '链路（虚线=探测器挂接）'),
            ),
          ),
        ),
        h(
          'div',
          { style: D.panel },
          h('div', { style: D.codeHead },
            h('span', { style: { ...D.sectionTitle, marginBottom: 0 } }, 'KatScript'),
            h('span', { style: { ...D.hint, marginLeft: 'auto' } }, `${components.length} 个元件 · ${connections.length} 条连接`),
          ),
          h('pre', { style: D.code }, code),
          warnings.length > 0
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '6px' } },
                ...warnings.map((warning, index) => h('div', { key: index, style: D.warn }, warning)))
            : null,
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.locale
        const slots = ctx.slots
        if (!locale || !slots) return

        ctx.effect(() => locale.register(NS, MESSAGES), 'finesse-visualizer: dictionaries')
        const t = locale.bind(NS)

        const CardWithText = (props) => h(Card, { ...props, t })

        slots.inject('conversation.chat.turnTail', () =>
          slots.register(
            { name: 'conversation.chat.turnTail', id: CARD_ID, order: 20 },
            CardWithText,
          ),
        )

        const layout = ctx.get('layout')
        if (layout && typeof layout.selectPanel === 'function') {
          const openDesigner = () => layout.selectPanel(PANEL_ID)
          slots.inject('conversation.composer.dock', () =>
            slots.register(
              { name: 'conversation.composer.dock', id: 'finesse-designer-link', order: 6 },
              () => h(DesignerLink, { openPanel: openDesigner }),
            ),
          )
        }

        slots.inject('main', () =>
          slots.inject('sidebar.panellist', () => {
            const stopMain = slots.register({ name: 'main', key: PANEL_ID }, DesignerPanel)
            const stopIcon = slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: 60, label: () => 'Finesse 设计器' },
              DesignerIcon,
            )
            return () => {
              if (typeof stopIcon === 'function') stopIcon()
              if (typeof stopMain === 'function') stopMain()
            }
          }),
        )

        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {}
          const style = document.createElement('style')
          style.id = 'finesse-visualizer-keyframes'
          style.textContent =
            '@keyframes fv-pulse{0%,100%{opacity:.35}50%{opacity:1}}' +
            '@media (prefers-reduced-motion: reduce){@keyframes fv-pulse{0%,100%{opacity:1}}}'
          document.head.appendChild(style)
          return () => {
            style.remove()
          }
        }, 'finesse-visualizer: keyframes')
      },
    }
  },
})
