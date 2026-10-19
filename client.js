/**
 * dsh-custom-avatar —— 浏览器半端
 * ============================================================================
 * 两件事：
 *   1. **换头像**：盯着页面里的账号头像容器（侧边栏账号按钮 / 设置里的账号卡片），
 *      把里面的图换成你自己选的那张。React 重新渲染把 src 改回去时，观察者会再改回来。
 *   2. **设置页**：在「设置」左侧导航里加一项「头像」，选图 / 预览 / 恢复默认。
 *
 * 约定（2026-10-14 从 dsh-bili-scroll / 官方包里挖到的）：
 *   client bundle 不是 ESM，是自注册脚本：
 *       window.__ModuleLoader__.load({ id, factory: (require) => ({ inject, apply }) })
 *   进「设置」：ctx.get('slots').inject('settings.section', () => slots.register({...}, () => h(Panel)))
 * ============================================================================
 */
;(function () {
  if (window.__dshCustomAvatarBooted) return
  window.__dshCustomAvatarBooted = true

  const API = '/api/avatar'
  const IMG = API + '/image'

  // 启动指纹：脚本到底有没有被页面加载，看宿主家目录的 access.log 就知道
  try { fetch(API + '/state?boot=1', { credentials: 'same-origin' }) } catch (e) {}

  /** 头像容器：官方两处都带 data-avatar-status；类名是构建时哈希的，所以再兜一层 _avatar。 */
  const CANDIDATE = '[data-avatar-status],span[class*="avatar"],[class*="_avatar"]'

  const snapshot = { enabled: false, hasImage: false, version: '0' }
  const originalSrc = new WeakMap()

  function imageUrl() {
    return IMG + '?v=' + encodeURIComponent(String(snapshot.version || '0'))
  }

  function looksLikeAvatarBox(el) {
    if (!(el instanceof HTMLElement)) return false
    if (el.matches('[data-avatar-status]')) return true
    const r = el.getBoundingClientRect()
    const w = r.width || el.clientWidth
    const h = r.height || el.clientHeight
    if (!w || !h) return false
    if (w > 72 || h > 72) return false // 头像都是 24/32/40/56 这一档
    return !!(el.querySelector('img,svg'))
  }

  function restyle(img) {
    img.style.objectFit = 'cover'
    img.style.borderRadius = '50%'
    img.style.width = '100%'
    img.style.height = '100%'
    img.style.display = 'block'
  }

  function patchBox(el) {
    if (!looksLikeAvatarBox(el)) return
    const url = imageUrl()
    const img = el.querySelector('img')
    if (img) {
      if (!originalSrc.has(img)) originalSrc.set(img, img.getAttribute('src'))
      img.removeAttribute('srcset')
      if (!snapshot.enabled) {
        const orig = originalSrc.get(img)
        if (orig && img.getAttribute('src') !== orig) img.setAttribute('src', orig)
        return
      }
      if (img.getAttribute('src') !== url) img.setAttribute('src', url)
      restyle(img)
      return
    }
    // 没有 <img>：说明平台没给图（默认图标）。那我们自己叠一张上去。
    let mine = el.querySelector('img[data-custom-avatar]')
    if (!snapshot.enabled) {
      if (mine) mine.remove()
      const svg = el.querySelector('svg')
      if (svg) svg.style.visibility = ''
      return
    }
    const svg = el.querySelector('svg')
    if (svg) svg.style.visibility = 'hidden'
    if (!mine) {
      mine = document.createElement('img')
      mine.setAttribute('data-custom-avatar', '1')
      mine.setAttribute('alt', '')
      mine.setAttribute('referrerpolicy', 'no-referrer')
      el.style.position = el.style.position || 'relative'
      el.style.overflow = 'hidden'
      mine.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;'
      el.appendChild(mine)
    }
    if (mine.getAttribute('src') !== url) mine.setAttribute('src', url)
  }

  function patchAll() {
    let nodes
    try { nodes = document.querySelectorAll(CANDIDATE) } catch { return }
    for (const el of nodes) patchBox(el)
  }

  let scheduled = false
  function schedule() {
    if (scheduled) return
    scheduled = true
    const run = () => { scheduled = false; try { patchAll() } catch {} }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
    else setTimeout(run, 16)
  }

  function startObserver() {
    if (!document.documentElement) return
    const mo = new MutationObserver(() => schedule())
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'class', 'data-avatar-status'],
    })
    schedule()
    // 兜底：有些渲染路径不产生 mutation（或被节流），低频再扫一遍
    setInterval(() => { try { patchAll() } catch {} }, 4000)
    // 顺带把状态同步一次（另一个窗口换了图，这个窗口也能跟上）
    setInterval(() => { try { refresh() } catch {} }, 8000)
  }

  async function jfetch(path, opts) {
    const res = await fetch(API + path, Object.assign({ credentials: 'same-origin' }, opts || {}))
    const text = await res.text()
    let value = null
    try { value = text ? JSON.parse(text) : null } catch { value = null }
    if (!res.ok) throw new Error((value && value.error) || ('HTTP ' + res.status))
    return value
  }

  async function refresh() {
    try {
      const s = await jfetch('/state')
      if (s && typeof s === 'object') {
        snapshot.enabled = !!s.enabled
        snapshot.hasImage = !!s.hasImage
        snapshot.version = String(s.version || '0')
      }
    } catch {}
    schedule()
    return snapshot
  }

  const descriptor = {
    id: 'dsh-custom-avatar',
    factory: (require) => {
      const React = require('react')
      const h = React.createElement
      const useState = React.useState
      const useEffect = React.useEffect
      const useRef = React.useRef

      const CSS = `
[data-ca-page]{display:flex;flex-direction:column;gap:18px;padding:2px 2px 8px;max-width:640px;font-size:13px;}
[data-ca-sec]{display:flex;flex-direction:column;gap:10px;}
[data-ca-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-ca-row]{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
[data-ca-preview]{width:64px;height:64px;border-radius:50%;overflow:hidden;flex:none;display:flex;
  align-items:center;justify-content:center;background:var(--dsw-alias-bg-skeleton,rgba(128,128,128,.2));
  color:var(--dsw-alias-label-tertiary,#9aa0a6);font-size:11px;}
[data-ca-preview] img{width:100%;height:100%;object-fit:cover;display:block;}
[data-ca-note]{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-ca-btn]{padding:7px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;
  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.14));color:inherit;}
[data-ca-btn]:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.24));}
[data-ca-btn][data-primary]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-ca-btn][disabled]{opacity:.5;cursor:default;}
[data-ca-msg]{font-size:11px;line-height:16px;padding:7px 9px;border-radius:8px;word-break:break-all;
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.12));color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-ca-msg][data-good]{color:#22c55e;}
[data-ca-msg][data-warn]{color:#f59e0b;}
`

      function Panel() {
        const [s, setS] = useState({ enabled: snapshot.enabled, hasImage: snapshot.hasImage, version: snapshot.version })
        const [busy, setBusy] = useState('')
        const [msg, setMsg] = useState(null)
        const inputRef = useRef(null)

        const applySnapshot = (v) => {
          if (!v || typeof v !== 'object') return
          snapshot.enabled = !!v.enabled
          snapshot.hasImage = !!v.hasImage
          snapshot.version = String(v.version || '0')
          setS({ enabled: snapshot.enabled, hasImage: snapshot.hasImage, version: snapshot.version })
          schedule()
        }

        useEffect(() => { refresh().then(applySnapshot) }, [])

        const onPick = () => { if (inputRef.current) inputRef.current.click() }

        const onFile = (ev) => {
          const file = ev.target.files && ev.target.files[0]
          ev.target.value = ''
          if (!file) return
          setBusy('upload')
          setMsg(null)
          const reader = new FileReader()
          reader.onload = async () => {
            try {
              const v = await jfetch('/upload', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ dataUrl: String(reader.result || '') }),
              })
              applySnapshot(v)
              setMsg({ tone: 'good', text: '换好了 —— 看看左上角头像。' })
            } catch (err) {
              setMsg({ tone: 'warn', text: '没换成：' + String((err && err.message) || err) })
            } finally { setBusy('') }
          }
          reader.onerror = () => { setBusy(''); setMsg({ tone: 'warn', text: '这个文件读不出来' }) }
          reader.readAsDataURL(file)
        }

        const onReset = async () => {
          setBusy('reset')
          setMsg(null)
          try {
            const v = await jfetch('/reset', { method: 'POST' })
            applySnapshot(v)
            setMsg({ tone: 'good', text: '已经恢复成默认头像了（你的图还留着，随时能再戴回去）。' })
          } catch (err) {
            setMsg({ tone: 'warn', text: '没恢复成：' + String((err && err.message) || err) })
          } finally { setBusy('') }
        }

        const onEnable = async () => {
          setBusy('enable')
          setMsg(null)
          try {
            const v = await jfetch('/enable', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ enabled: true }),
            })
            applySnapshot(v)
            setMsg({ tone: 'good', text: '又戴上了。' })
          } catch (err) {
            setMsg({ tone: 'warn', text: String((err && err.message) || err) })
          } finally { setBusy('') }
        }

        return h('div', { 'data-ca-page': '' },
          h('div', { 'data-ca-sec': '' },
            h('div', { 'data-ca-h': '' }, '换头像'),
            h('div', { 'data-ca-row': '' },
              h('div', { 'data-ca-preview': '' },
                s.hasImage ? h('img', { src: IMG + '?v=' + encodeURIComponent(s.version), alt: '当前头像' }) : '没图'),
              h('div', { 'data-ca-note': '' },
                s.enabled && s.hasImage ? '正在用你自己的图。' : (s.hasImage ? '图有了，但现在戴着默认头像。' : '还没选图。'),
                h('br'),
                '只换**这个界面里显示的头像**；DeepSeek 账号本身（网页 / 手机 App）的头像不会变。')),
            h('div', { 'data-ca-row': '' },
              h('button', { 'data-ca-btn': '', 'data-primary': '', disabled: busy === 'upload', onClick: onPick },
                busy === 'upload' ? '正在换…' : '选一张图…'),
              s.hasImage ? h('button', { 'data-ca-btn': '', disabled: busy === 'enable' || (s.enabled && s.hasImage), onClick: onEnable }, '戴上') : null,
              s.hasImage || s.enabled ? h('button', { 'data-ca-btn': '', disabled: busy === 'reset', onClick: onReset }, '恢复默认') : null,
              h('input', {
                ref: inputRef, type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif',
                style: { display: 'none' }, onChange: onFile,
              })),
            msg ? h('div', { 'data-ca-msg': '', 'data-good': msg.tone === 'good' ? '' : undefined, 'data-warn': msg.tone === 'warn' ? '' : undefined }, msg.text) : null),

          h('div', { 'data-ca-sec': '' },
            h('div', { 'data-ca-h': '' }, '说明'),
            h('div', { 'data-ca-note': '' },
              '图片存在本机：C:\\Users\\<你>\\.dsh\\custom-avatar\\ —— 不上传、不联网。',
              h('br'),
              'PNG / JPG / WebP / GIF / AVIF，8MB 以内；方图观感最好（会被裁成圆的）。',
              h('br'),
              '侧边栏账号按钮和设置里的账号卡片会一起换。')))
      }

      return {
        inject: ['slots'],
        apply(ctx) {
          const style = document.createElement('style')
          style.setAttribute('data-plugin-css', 'dsh-custom-avatar')
          style.textContent = CSS
          document.head.appendChild(style)
          ctx.effect(() => () => style.remove(), 'custom-avatar: 设置页样式')

          refresh()
          startObserver()

          const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
          if (!slots) return
          slots.inject('settings.section', () => slots.register(
            { name: 'settings.section', id: 'custom-avatar', order: 42, label: '头像' },
            () => h(Panel),
          ))
        },
      }
    },
  }

  // 注入行是在 boot 过程中追加的，此刻 __ModuleLoader__ 可能还没就位 —— 等它出现再注册
  let tries = 0
  ;(function boot() {
    const loader = window.__ModuleLoader__
    if (loader && typeof loader.load === 'function') { loader.load(descriptor); return }
    if (tries++ < 600) setTimeout(boot, 100)
  })()
})()
