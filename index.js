/**
 * Host half of the Finesse visualizer.
 *
 * Watches committed conversation messages, detects Finesse 3 KatScript (or a
 * pasted Python cell that builds a Finesse model), renders the model with the
 * bundled Python renderer and serves the resulting PNGs to the turn card in the
 * Web page.
 *
 * Data flow:
 *   session/event ──► detect ──► queue ──► python render_finesse.py
 *                                              │
 *                                              ▼
 *                               ~/.dsh/finesse-vis/<session>/<item>/*.png
 *                                              │
 *   GET /finesse-vis/turn?sessionId&turn ◄─────┤ metadata
 *   GET /finesse-vis/image/<session>/<item>/<file> ◄─ PNG bytes
 *
 * The plugin only imports Node builtins: a locally installed bundle cannot
 * resolve the Harness packages from its own directory.
 */
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RENDERER = path.join(HERE, 'python', 'render_finesse.py')
const MAX_CODE = 20000
const MAX_BLOCKS_PER_MESSAGE = 2
const MAX_ITEMS_PER_TURN = 3
const RENDER_TIMEOUT_MS = Number(process.env.FINESSE_VIZ_TIMEOUT_MS) || 180000
const STORE_ROOT = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'finesse-vis')
const HD_ASSET_DIR = path.join(HERE, 'assets', 'components', 'hd')

export const inject = ['webServer']

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g
const COMPONENT_RE = /^\s*(?:l|laser|s|space|m|mirror|bs|beamsplitter|lens|mod|modulator|isol|isolator|pd|ad|ccd|cav|cavity|gauss|telescope)\s+[A-Za-z_]\w*/gim
const ANALYSIS_RE = /\b(?:no|x|x2)axis\s*\(/i
const PY_RE = /(?:^|\n)\s*(?:import\s+finesse|from\s+finesse)|finesse\.Model|model\s*\.\s*parse\s*\(/i

/** Resolve a Python interpreter that can import finesse. */
const PYTHON_CANDIDATES = [
  process.env.FINESSE_VIZ_PYTHON,
  process.env.FINESSE_PYTHON,
  process.env.CONDA_PREFIX ? path.join(process.env.CONDA_PREFIX, 'bin', 'python') : '',
  path.join(os.homedir(), 'miniconda3/envs/finesse_sim/bin/python'),
  path.join(os.homedir(), 'anaconda3/envs/finesse_sim/bin/python'),
  '/opt/anaconda3/envs/finesse_sim/bin/python',
  '/opt/anaconda3/bin/python3',
  '/opt/homebrew/bin/python3',
  '/usr/local/bin/python3',
  '/usr/bin/python3',
  'python3',
  'python',
].filter(Boolean)

function execFileP(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

function countComponents(code) {
  const matches = code.match(COMPONENT_RE)
  return matches ? matches.length : 0
}

function qualifies(code, lang) {
  const text = code.trim()
  if (text.length < 12 || text.length > MAX_CODE) return false
  if (PY_RE.test(text)) return true
  const components = countComponents(text)
  if (components >= 2) return true
  if (components >= 1 && ANALYSIS_RE.test(text)) return true
  if (/^(kat|katscript|finesse)$/.test(lang) && components >= 1) return true
  return false
}

/** Extract the KatScript snippets of one message. */
function extractBlocks(text, fromUser) {
  const blocks = []
  FENCE_RE.lastIndex = 0
  let match
  while ((match = FENCE_RE.exec(text)) !== null) {
    const lang = (match[1] || '').trim().toLowerCase()
    const code = match[2].trim()
    if (qualifies(code, lang)) blocks.push(code)
    if (blocks.length >= MAX_BLOCKS_PER_MESSAGE) return blocks
  }
  if (blocks.length === 0 && fromUser) {
    const trimmed = text.trim()
    if (trimmed.length <= MAX_CODE && countComponents(trimmed) >= 3 && qualifies(trimmed, '')) {
      blocks.push(trimmed)
    }
  }
  return blocks
}

function titleFor(code) {
  for (const raw of code.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const comment = /^#\s*(.+)$/.exec(line)
    if (comment) return comment[1].trim().slice(0, 60)
    break
  }
  return 'Finesse model'
}

function safeId(value) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)
}

function imageUrl(sessionId, itemId, file) {
  return `/finesse-vis/image/${encodeURIComponent(sessionId)}/${encodeURIComponent(itemId)}/${encodeURIComponent(file)}`
}

function publicItem(item) {
  return {
    id: item.id,
    turn: item.turn,
    source: item.source,
    title: item.title,
    status: item.status,
    createdAt: item.createdAt,
    error: item.error ?? null,
    warnings: item.warnings ?? [],
    detectors: item.detectors ?? [],
    images: (item.images ?? []).map((image) => ({
      file: image.file,
      title: image.title || '',
      caption: image.caption || '',
      url: imageUrl(item.sessionId, item.id, image.file),
    })),
  }
}

export function apply(ctx) {
  const webServer = ctx.webServer
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger?.warn?.('finesse-visualizer: no webServer service; the turn card cannot load figures')
    return
  }

  /** sessionId -> { items: Map<id, item>, order: string[], queue, running, seen: Set<string> } */
  const sessions = new Map()
  let turnCursor = new Map() // sessionId -> { current: number|null, lastEnded: number }
  let pythonResolution = null
  let pythonCheckedAt = 0

  function stateOf(sessionId) {
    let state = sessions.get(sessionId)
    if (!state) {
      state = { items: new Map(), order: [], queue: [], running: false, seen: new Set() }
      sessions.set(sessionId, state)
      if (sessions.size > 40) {
        const oldest = sessions.keys().next().value
        if (oldest !== sessionId) sessions.delete(oldest)
      }
    }
    return state
  }

  function turnOf(sessionId) {
    const cursor = turnCursor.get(sessionId) || { current: null, lastEnded: 0 }
    return cursor.current ?? cursor.lastEnded + 1
  }

  async function resolvePython() {
    const now = Date.now()
    if (pythonResolution && (pythonResolution.ok || now - pythonCheckedAt < 60000)) return pythonResolution
    pythonCheckedAt = now
    pythonResolution = { ok: false, python: null }
    for (const candidate of PYTHON_CANDIDATES) {
      try {
        const { stdout } = await execFileP(candidate, ['-c', 'import finesse, sys; print(sys.executable)'], {
          timeout: 25000,
          env: process.env,
        })
        pythonResolution = { ok: true, python: stdout.trim() || candidate }
        return pythonResolution
      } catch {
        // try the next interpreter
      }
    }
    return pythonResolution
  }

  function scheduleItem(session, event, code, source, turn) {
    const sessionId = String(session.id)
    const state = stateOf(sessionId)
    const digest = createHash('sha1').update(code.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16)
    const key = `${turn}:${digest}`
    if (state.seen.has(key)) return
    const turnCount = state.order.filter((id) => state.items.get(id)?.turn === turn).length
    if (turnCount >= MAX_ITEMS_PER_TURN) return
    state.seen.add(key)

    const item = {
      id: randomUUID().slice(0, 8),
      sessionId,
      code,
      turn,
      seq: Number(event?.seq) || 0,
      source,
      title: titleFor(code),
      status: 'rendering',
      createdAt: Date.now(),
      images: [],
      warnings: [],
      detectors: [],
      error: null,
    }
    item.dir = path.join(STORE_ROOT, safeId(sessionId), item.id)
    state.items.set(item.id, item)
    state.order.push(item.id)
    state.queue.push(item)
    if (!state.running) drain(state)
    return item
  }

  async function drain(state) {
    state.running = true
    while (state.queue.length > 0) {
      const item = state.queue.shift()
      try {
        await renderItem(item)
      } catch (error) {
        item.status = 'error'
        item.error = String(error?.message || error)
      }
    }
    state.running = false
  }

  async function renderItem(item) {
    await mkdir(item.dir, { recursive: true })
    const codePath = path.join(item.dir, 'code.kat')
    const resultPath = path.join(item.dir, 'result.json')
    await writeFile(codePath, item.code, 'utf8')
    await writeMeta(item)

    const resolved = await resolvePython()
    if (!resolved.ok) {
      item.status = 'error'
      item.error = 'No Python interpreter with finesse installed was found. Set FINESSE_VIZ_PYTHON to a Python that can `import finesse`.'
      await writeMeta(item)
      return
    }

    const args = [
      RENDERER,
      '--input', codePath,
      '--outdir', item.dir,
      '--json-out', resultPath,
      '--title', item.title,
    ]
    const env = {
      ...process.env,
      MPLCONFIGDIR: path.join(os.tmpdir(), 'dsh-finesse-visualizer-mpl'),
    }
    try {
      await execFileP(resolved.python, args, { timeout: RENDER_TIMEOUT_MS, env, maxBuffer: 8 * 1024 * 1024 })
    } catch (error) {
      // The renderer exits non-zero for model errors too; result.json still wins.
      const stderr = String(error?.stderr || '').trim()
      if (!existsSync(resultPath)) {
        item.status = 'error'
        item.error = stderr.split('\n').slice(0, 3).join(' | ') || String(error?.message || error)
        await writeMeta(item)
        return
      }
    }

    let result = null
    try {
      result = JSON.parse(await readFile(resultPath, 'utf8'))
    } catch {
      result = null
    }
    if (!result) {
      item.status = 'error'
      item.error = 'The renderer produced no result.'
      await writeMeta(item)
      return
    }

    item.status = result.ok ? 'done' : 'error'
    item.error = result.ok ? null : result.error || 'Rendering failed.'
    item.warnings = Array.isArray(result.warnings) ? result.warnings : []
    item.detectors = Array.isArray(result.detectors) ? result.detectors : []
    item.images = Array.isArray(result.images) ? result.images : []
    item.components = Array.isArray(result.components) ? result.components.length : 0
    await writeMeta(item)
  }

  async function writeMeta(item) {
    const meta = {
      id: item.id,
      sessionId: item.sessionId,
      turn: item.turn,
      seq: item.seq,
      source: item.source,
      title: item.title,
      status: item.status,
      createdAt: item.createdAt,
      error: item.error,
      warnings: item.warnings,
      detectors: item.detectors,
      images: item.images,
      components: item.components,
    }
    try {
      await writeFile(path.join(item.dir, 'meta.json'), JSON.stringify(meta, null, 1), 'utf8')
    } catch {
      // A missing metadata file only affects reload after a restart.
    }
    return meta
  }

  async function itemsForTurn(sessionId, turn) {
    const state = sessions.get(sessionId)
    if (state) {
      const items = state.order
        .map((id) => state.items.get(id))
        .filter((item) => item && item.turn === turn)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(publicItem)
      if (items.length > 0) return items
    }
    return await itemsFromDisk(sessionId, turn)
  }

  async function itemsFromDisk(sessionId, turn) {
    const dir = path.join(STORE_ROOT, safeId(sessionId))
    let entries = []
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const items = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const raw = await readFile(path.join(dir, entry.name, 'meta.json'), 'utf8')
        const meta = JSON.parse(raw)
        if (Number(meta.turn) !== Number(turn)) continue
        meta.sessionId = meta.sessionId || sessionId
        items.push(publicItem(meta))
      } catch {
        // Ignore half-written or foreign directories.
      }
    }
    return items.sort((a, b) => a.createdAt - b.createdAt)
  }

  async function readImage(sessionId, itemId, file) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(sessionId) || !/^[A-Za-z0-9_-]{1,80}$/.test(itemId)) return null
    if (!/^[A-Za-z0-9._-]{1,80}\.png$/.test(file)) return null
    const target = path.join(STORE_ROOT, safeId(sessionId), itemId, file)
    const root = path.join(STORE_ROOT, safeId(sessionId), itemId)
    if (!target.startsWith(root + path.sep)) return null
    try {
      return await readFile(target)
    } catch {
      return null
    }
  }

  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    })

  ctx.effect(() =>
    webServer.register({
      kind: 'prefix',
      path: '/finesse-vis',
      resource: async (request) => {
        const url = new URL(request.url || '/', 'http://localhost')
        try {
          if (url.pathname === '/finesse-vis/turn') {
            const sessionId = url.searchParams.get('sessionId') || ''
            const turn = Number(url.searchParams.get('turn'))
            if (!sessionId || !Number.isFinite(turn)) return json({ items: [] })
            return json({ items: await itemsForTurn(sessionId, turn) })
          }
          if (url.pathname.startsWith('/finesse-vis/asset/')) {
            const parts = url.pathname.split('/').filter(Boolean)
            if (parts.length !== 3) return new Response('not found', { status: 404 })
            const file = parts[2]
            if (!/^[a-z0-9_-]{1,40}\.png$/.test(file)) return new Response('not found', { status: 404 })
            const target = path.join(HD_ASSET_DIR, file)
            if (!target.startsWith(HD_ASSET_DIR + path.sep)) return new Response('not found', { status: 404 })
            try {
              const data = await readFile(target)
              return new Response(data, {
                status: 200,
                headers: {
                  'content-type': 'image/png',
                  'cache-control': 'private, max-age=3600',
                },
              })
            } catch {
              return new Response('not found', { status: 404 })
            }
          }
          if (url.pathname.startsWith('/finesse-vis/image/')) {
            const parts = url.pathname.split('/').filter(Boolean) // finesse-vis, image, sid, item, file
            if (parts.length !== 5) return new Response('not found', { status: 404 })
            const data = await readImage(parts[2], parts[3], parts[4])
            if (!data) return new Response('not found', { status: 404 })
            return new Response(data, {
              status: 200,
              headers: {
                'content-type': 'image/png',
                'cache-control': 'private, max-age=3600',
              },
            })
          }
          return new Response('not found', { status: 404 })
        } catch (error) {
          return json({ error: String(error?.message || error) }, 500)
        }
      },
    }),
  )

  ctx.on('session/event', (session, event) => {
    try {
      const sessionId = String(session.id)
      if (event.type === 'turn/start') {
        turnCursor.set(sessionId, { current: Number(event.data?.turn) || 0, lastEnded: 0 })
        return
      }
      if (event.type === 'turn/end') {
        const cursor = turnCursor.get(sessionId) || { current: null, lastEnded: 0 }
        turnCursor.set(sessionId, { current: null, lastEnded: Number(event.data?.turn) || cursor.lastEnded })
        return
      }
      let text = ''
      let source = ''
      let turn = turnOf(sessionId)
      if (event.type === 'user/message') {
        text = textOf(event.data?.content)
        source = 'user'
      } else if (event.type === 'assistant/message') {
        text = textOf(event.data?.message?.content)
        source = 'assistant'
        turn = Number(event.data?.turn) || turn
      } else {
        return
      }
      if (!text) return
      const blocks = extractBlocks(text, source === 'user')
      for (const code of blocks) scheduleItem(session, event, code, source, turn)
    } catch (error) {
      ctx.logger?.warn?.('finesse-visualizer: could not inspect session event', error)
    }
  })
}
