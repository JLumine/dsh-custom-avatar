/**
 * dsh-custom-avatar —— 宿主半端
 * ============================================================================
 * 干三件事：
 *   1. 往页面里推一行注入（桌面壳走 `webserver/index-inject` 的结构化行；web 形态走 tapIndex），
 *      让 client.js 在浏览器里跑起来 —— 那一半负责换头像 + 设置页。
 *   2. 存你自己选的图（家目录 ~/.dsh/custom-avatar/avatar.<ext>），**只在本机**。
 *   3. 提供 /api/avatar/* 这组小接口：state / image / upload / enable / reset。
 *
 * 文件布局（与其它插件一致：DSH_HOME 下按插件 id 起一个家目录）：
 *   <DSH_HOME>/custom-avatar/avatar.png|jpg|webp|gif
 *   <DSH_HOME>/custom-avatar/state.json   { "enabled": true }
 * ============================================================================
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MOUNT = '/dsh-custom-avatar'
const API = '/api/avatar'
const MAX_BYTES = 8 * 1024 * 1024 // 8MB —— 头像用不着更大，更大的 base64 也在浏览器里卡
const EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']

function dshHome() {
  const env = (process.env.DSH_HOME || '').trim()
  return env || path.join(os.homedir(), '.dsh')
}
const homeDir = () => path.join(dshHome(), 'custom-avatar')
const statePath = () => path.join(homeDir(), 'state.json')

function ensureDir() {
  try { fs.mkdirSync(homeDir(), { recursive: true }) } catch {}
}

function readState() {
  try {
    const v = JSON.parse(fs.readFileSync(statePath(), 'utf8'))
    return { enabled: v && v.enabled !== false }
  } catch {
    return { enabled: true }
  }
}

function writeState(next) {
  ensureDir()
  fs.writeFileSync(statePath(), JSON.stringify({ enabled: !!next.enabled }, null, 2) + '\n', 'utf8')
}

/** 当前生效的图片文件（按扩展名优先级取第一个存在的）。 */
function currentImage() {
  for (const ext of EXTS) {
    const p = path.join(homeDir(), 'avatar.' + ext)
    try {
      const st = fs.statSync(p)
      if (st.isFile() && st.size > 0) {
        return { path: p, ext, size: st.size, version: st.mtimeMs.toString(36) + '-' + st.size.toString(36) }
      }
    } catch {}
  }
  return null
}

function snapshot() {
  const st = readState()
  const img = currentImage()
  return {
    enabled: !!st.enabled && !!img,
    hasImage: !!img,
    version: img ? img.version : '0',
    bytes: img ? img.size : 0,
    fileName: img ? path.basename(img.path) : null,
    home: homeDir(),
  }
}

function sniff(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: 'png', mime: 'image/png' }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' }
  if (buf.length >= 6 && buf.toString('latin1', 0, 4) === 'GIF8') return { ext: 'gif', mime: 'image/gif' }
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' }
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp' && /avi[fs]/.test(buf.toString('latin1', 8, 12))) return { ext: 'avif', mime: 'image/avif' }
  return null
}

/* ── 信任栅栏（与 whale-widget 同一套口径：只认回环 / 同源，跨站一律拒） ── */
function isLoopback(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (!h) return false
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '::1') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  return Number(m[1]) === 127 && [m[2], m[3], m[4]].every((x) => Number(x) <= 255)
}

function rejection(req) {
  try {
    const headers = (req && req.headers) || {}
    if (String(headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return 403
    const hostRaw = String(headers.host || '')
    let hostUrl = null
    try { hostUrl = new URL('http://' + hostRaw) } catch { /* dsh-app:// 之类没有 Host 的取法，跳过 */ }
    if (hostUrl && !isLoopback(hostUrl.hostname)) return 403
    const origin = headers.origin
    if (typeof origin === 'string' && origin && origin !== 'null' && hostUrl) {
      let ou = null
      try { ou = new URL(origin) } catch { return 403 }
      if (ou.host.toLowerCase() !== hostUrl.host.toLowerCase()) return 403
    }
    return null
  } catch {
    return 403
  }
}

function readJson(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limitBytes) { reject(new Error('太大了')) ; try { req.destroy() } catch {} ; return }
      chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) }
      catch (err) { reject(new Error('请求体不是合法 JSON')) }
    })
    req.on('error', reject)
  })
}

function sendJson(res, code, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': String(body.length) })
  res.end(body)
}

export default {
  name: 'custom-avatar',

  apply(root) {
    // ① 注入行必须**尽早**进表：桌面端这张表是宿主启动时一次性收集的（晚一步就永远进不去）
    root.on('webserver/index-inject', (table) => {
      try {
        if (!Array.isArray(table)) return
        for (const row of table) {
          if (!row) continue
          if (row.kind === 'script-src' && row.src === MOUNT + '/client.js') return
          if (row.kind === 'script' && typeof row.text === 'string' && row.text.indexOf(MOUNT + '/client.js') >= 0) return
        }
        // 内联行：由我们自己建 <script src>，并**吞掉** onerror —— 路由不在时静默失败，
        // 绝不让宿主因为一个装饰性插件起不来（whale-widget 的 issue #154 就是这么栽的）。
        table.push({
          kind: 'script',
          placement: 'body',
          text:
            '(function(){try{var d=document.body||document.documentElement;if(!d)return;' +
            'if(document.querySelector(\'script[data-dsh-custom-avatar]\'))return;' +
            'var s=document.createElement("script");s.src="' + MOUNT + '/client.js";' +
            's.setAttribute("data-dsh-custom-avatar","1");s.async=true;s.onerror=function(){};' +
            'd.appendChild(s)}catch(e){}})()',
        })
      } catch {}
    })

    // ② 其余逻辑等 webServer 就绪（不 await 别的服务，免得挡住 ①）
    root.inject(['webServer'], (ctx) => {
      const disposers = []
      const register = (route) => {
        const inner = route.handler
        disposers.push(ctx.webServer.register(Object.assign({}, route, {
          handler: (req, res) => {
            const code = rejection(req)
            if (code) { try { res.statusCode = code; res.end() } catch {} ; return }
            return inner(req, res)
          },
        })))
      }

      const method = (req) => String(req.method || 'GET').toUpperCase()

      // 状态（顺带记一笔访问：浏览器半端有没有真的加载起来，看这个日志就知道）
      const touchedBy = (who) => {
        try {
          ensureDir()
          fs.appendFileSync(path.join(homeDir(), 'access.log'),
            new Date().toISOString() + ' ' + who + '\n', 'utf8')
        } catch {}
      }
      register({
        kind: 'exact',
        path: API + '/state',
        handler: (req, res) => { touchedBy('state ' + String(req.url || '')); sendJson(res, 200, snapshot()) },
      })

      // 图片字节
      register({
        kind: 'exact',
        path: API + '/image',
        handler: (req, res) => {
          const img = currentImage()
          if (!img) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('no avatar'); return }
          let bytes
          try { bytes = fs.readFileSync(img.path) } catch { res.writeHead(500); res.end(); return }
          const kind = sniff(bytes) || { mime: 'application/octet-stream' }
          res.writeHead(200, {
            'Content-Type': kind.mime,
            'Cache-Control': 'no-store',
            'Content-Length': String(bytes.length),
          })
          res.end(bytes)
        },
      })

      // 上传（dataURL）—— 只写本机家目录
      register({
        kind: 'exact',
        path: API + '/upload',
        handler: async (req, res) => {
          if (method(req) !== 'POST') { sendJson(res, 405, { ok: false, error: '只收 POST' }); return }
          let body
          try { body = await readJson(req, Math.ceil(MAX_BYTES * 1.4) + 4096) }
          catch (err) { sendJson(res, 400, { ok: false, error: String((err && err.message) || err) }); return }
          const dataUrl = body && typeof body.dataUrl === 'string' ? body.dataUrl : ''
          const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
          if (!m) { sendJson(res, 400, { ok: false, error: '图片数据看不出来（要 dataURL）' }); return }
          let bytes
          try { bytes = Buffer.from(m[3], m[2] ? 'base64' : 'utf8') }
          catch { sendJson(res, 400, { ok: false, error: 'base64 解不开' }); return }
          if (bytes.length === 0) { sendJson(res, 400, { ok: false, error: '空的' }); return }
          if (bytes.length > MAX_BYTES) { sendJson(res, 413, { ok: false, error: '图太大了（上限 8MB），换张小的' }); return }
          const kind = sniff(bytes)
          if (!kind) { sendJson(res, 415, { ok: false, error: '只认 PNG / JPG / WebP / GIF / AVIF' }); return }
          ensureDir()
          // 先清掉旧的（扩展名可能不同），再写新的
          for (const ext of EXTS) { try { fs.unlinkSync(path.join(homeDir(), 'avatar.' + ext)) } catch {} }
          fs.writeFileSync(path.join(homeDir(), 'avatar.' + kind.ext), bytes)
          writeState({ enabled: true })
          sendJson(res, 200, Object.assign({ ok: true }, snapshot()))
        },
      })

      // 开关（暂时戴回默认头像）
      register({
        kind: 'exact',
        path: API + '/enable',
        handler: async (req, res) => {
          if (method(req) !== 'POST') { sendJson(res, 405, { ok: false, error: '只收 POST' }); return }
          let body = {}
          try { body = await readJson(req, 8192) } catch {}
          writeState({ enabled: !(body && body.enabled === false) })
          sendJson(res, 200, Object.assign({ ok: true }, snapshot()))
        },
      })

      // 还原默认（图留着，只是不用）
      register({
        kind: 'exact',
        path: API + '/reset',
        handler: (req, res) => {
          if (method(req) !== 'POST') { sendJson(res, 405, { ok: false, error: '只收 POST' }); return }
          writeState({ enabled: false })
          sendJson(res, 200, Object.assign({ ok: true }, snapshot()))
        },
      })

      // 浏览器半端脚本
      register({
        kind: 'exact',
        path: MOUNT + '/client.js',
        handler: (req, res) => {
          const p = new URL('./client.js', import.meta.url)
          let text = ''
          try { text = fs.readFileSync(p, 'utf8') } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('client.js 读不到：' + String((err && err.message) || err))
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(text)
        },
      })

      // web 形态（非桌面）走 tapIndex
      try {
        disposers.push(ctx.webServer.tapIndex((html) => {
          if (html.indexOf(MOUNT + '/client.js') !== -1) return html
          const tag = '<script defer data-dsh-custom-avatar="1" src="' + MOUNT + '/client.js"></script>'
          return html.indexOf('</body>') !== -1 ? html.replace('</body>', tag + '</body>') : html + tag
        }))
      } catch {}

      ctx.effect(() => () => {
        for (const d of disposers) { try { d() } catch {} }
      }, 'custom-avatar: routes')
    })
  },
}
