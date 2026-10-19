# dsh-custom-avatar

把 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) 桌面客户端里的**账号头像**换成你自己的图。

DeepSeek 账号本身不动 —— 换的只是这个客户端里显示的那一张。图片只留在本机，不上传、不联网。

## 装法

先在 DSH profile 目录里装包（`<profile>` 一般是 `~/.dsh/profiles/desktop`）：

```powershell
# 从 GitHub 装（推荐）
pnpm add "git+https://github.com/JLumine/dsh-custom-avatar.git" --dir "$env:USERPROFILE\.dsh\profiles\desktop"

# 或者本地开发：直接 link 你的工作副本
pnpm add link:D:/ai-learn/plugin-src/dsh-custom-avatar --dir "$env:USERPROFILE\.dsh\profiles\desktop"
```

> 桌面版没有把 dsh 放进 PATH，pnpm 要用应用自带的那个：
> `...\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe` +
> `...\dependencies\pnpm\bin\pnpm.mjs`。

然后打开 `~/.dsh/profiles/desktop/package.json`，确认两件事：

- `dependencies` 里有 `"dsh-custom-avatar": ...`
- `dsh.profile.bundles` 数组里有 `"dsh-custom-avatar"`（DSH 不会自动加，手动补一行）

**重启应用**（关掉再打开，光刷新页面不够 —— 宿主半端只在启动时装配）。

卸载：把 `bundles` 里那行和 `dependencies` 里那条删掉，再 `pnpm remove dsh-custom-avatar --dir <profile>`。

## 用法

设置 → **头像** → 「选一张图…」。换完立刻生效，侧边栏的账号按钮和设置里的账号卡片会一起变。

- 支持 PNG / JPG / WebP / GIF / AVIF，8MB 以内；方图最好（显示时会被裁成圆的）。
- 图片存在 `~/.dsh/custom-avatar/avatar.<ext>`。
- 「恢复默认」只是把图摘下来，文件还留着；「删掉图片」才会真删。

## 它怎么工作

- **宿主半端**（`index.js`）在 `~/.dsh/custom-avatar/` 存图，开 `/api/avatar/{state,image,upload,enable,reset}`
  几个本机接口（只认环回地址）。
- **浏览器半端**（`client.js`）通过 `package.json` 里的 `dsh.client` 清单由外壳加载，
  然后挂进「设置」的一节；它用 MutationObserver 盯 `[data-avatar-status]` / `*_avatar` 这些头像容器，
  把里面的 `src` 换成 `/api/avatar/image?v=<版本>`，平台没给图（默认图标）时自己叠一张上去。
  React 重新渲染把 `src` 改回去时，观察者会再改回来。
- 骨架照抄了同类插件（如 `dsh-bili-scroll`）的 `dsh.bundle.patch` + `dsh.client` 两段式结构。

## 注意 / 已知限制

- 类名是构建时哈希的（`ET65mq_avatar` / `_8RVnMG_avatar`），所以选择器优先用官方稳定的
  `data-avatar-status` 属性，再兜底 `class*="avatar"` + 尺寸 ≤72px 的判断。
  DSH 大版本升级后如果失效，先看这两条。
- 只管客户端显示；网页版 deepseek.com、官方 App 的头像不受影响。
- 需要 DSH ≥ 0.1.7-rc.1、Node ≥ 22。

## License

MIT
