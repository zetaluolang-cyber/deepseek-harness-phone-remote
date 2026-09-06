// Persistent client module: the phone remote workbench.
// Loaded on every page via the dsh.client module table (no per-session run needed).
// RPC goes through ctx.connection.rpc.call('/remfs', method, payload).
window.__ModuleLoader__.load({
  id: '@zetaluolang/remfs-persistent',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    // ── Upstream DSH CSS-module selector adapter (65c52ca audit item 7) ──────
    // The DeepSeek Harness web shell uses GENERATED CSS-module class names
    // (e.g. .pI_x6G_frame) that change between DSH builds. ALL upstream
    // selector coupling lives in this one object so a DSH upgrade touches a
    // single adapter instead of scattering hashed selectors through the CSS
    // below. The mobile layout tweaks target these classes because DSH exposes
    // no stable slot seam for the conversation grid on small screens.
    const UPSTREAM_SELECTORS = {
      row: '.uV2eYG_row',
      trailing: '.uV2eYG_trailing',
      card: '.uV2eYG_card',
      root: '._7KE1Ra_root',
      trigger: '._7KE1Ra_trigger',
      frame: '.pI_x6G_frame',
      centerCol: '.pI_x6G_centerCol',
      sidebarCol: '.pI_x6G_sidebarCol',
      detailsCol: '.pI_x6G_detailsCol',
      handle: '.pI_x6G_handle',
    }

    // Runtime drift watchdog for the selector coupling above. These are
    // GENERATED CSS-module class names: a DSH rebuild can invalidate every one
    // of them and the only symptom is the mobile layout quietly degrading
    // (see 942db92 for how long a silent presence failure survived). Audited
    // once after the shell has rendered; result is exposed for debugging and,
    // when EVERY selector is gone (an upstream rebuild, not a partial screen),
    // a one-line notice is shown in the workbench.
    const selectorAudit = { done: false, missing: [], total: 0, allMissing: false }
    function auditUpstreamSelectors() {
      if (selectorAudit.done) return selectorAudit
      selectorAudit.done = true
      try {
        const entries = Object.entries(UPSTREAM_SELECTORS)
        selectorAudit.total = entries.length
        for (const [name, sel] of entries) {
          if (!document.querySelector(sel)) selectorAudit.missing.push(name + ' (' + sel + ')')
        }
        selectorAudit.allMissing = selectorAudit.missing.length === selectorAudit.total
        if (selectorAudit.allMissing) {
          console.warn('[remfs-persistent] UPSTREAM DRIFT: none of the ' + selectorAudit.total +
            ' DSH CSS-module selectors matched — the DSH build has changed and the mobile layout adapter is inactive. Update UPSTREAM_SELECTORS in client.js.')
        } else if (selectorAudit.missing.length > 0) {
          console.warn('[remfs-persistent] selector audit: ' + selectorAudit.missing.length + '/' +
            selectorAudit.total + ' upstream selectors unmatched (may be off-screen views): ' + selectorAudit.missing.join(', '))
        }
      } catch { /* audit is diagnostics only */ }
      try { window.__remfsSelectorAudit = selectorAudit } catch { /* ignore */ }
      return selectorAudit
    }
    // Delayed so the DSH shell has finished its first render.
    try { setTimeout(auditUpstreamSelectors, 5000) } catch { /* ignore */ }

    const CSS = `
.remfs-block{background:var(--dsw-specific-sidebar-fill,#202024);color:var(--dsw-alias-label-primary,#eee);display:flex;flex-direction:column;font-size:13px;font-family:system-ui,sans-serif;height:min(640px,74vh);min-height:340px;border:1px solid rgba(128,128,128,.2);border-radius:10px;overflow:hidden}
.remfs-panel{position:fixed;right:0;top:0;bottom:0;width:min(430px,96vw);background:var(--dsw-specific-sidebar-fill,#202024);color:var(--dsw-alias-label-primary,#eee);z-index:120;box-shadow:-8px 0 24px rgba(0,0,0,.35);display:flex;flex-direction:column;font-size:13px;font-family:system-ui,sans-serif}
.remfs-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:119}
.remfs-head{padding:10px 12px;border-bottom:1px solid rgba(128,128,128,.25);display:flex;align-items:center;gap:8px}
.remfs-head .p{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
.remfs-tabs{display:flex;gap:6px;padding:8px 12px 0;border-bottom:1px solid rgba(128,128,128,.2)}
.remfs-tab{background:transparent;border:none;color:var(--dsw-alias-label-secondary,#999);font-size:13px;padding:6px 12px;cursor:pointer;border-bottom:2px solid transparent;border-radius:0}
.remfs-tab.on{color:var(--dsw-alias-label-primary,#eee);border-bottom-color:#4a6cf7}
.remfs-body{flex:1;display:flex;flex-direction:column;min-height:0}
.remfs-drift{padding:6px 12px;font-size:11px;color:#f59e0b;background:rgba(245,158,11,.08);border-bottom:1px solid rgba(245,158,11,.25)}
.remfs-crumb{display:flex;gap:4px;padding:6px 12px 0;align-items:center;overflow-x:auto;flex:none}
.remfs-crumb .remfs-chip{flex:none}
.remfs-chip.cur{opacity:.7;cursor:default}
.remfs-path{display:flex;gap:6px;padding:8px 12px;align-items:center}
.remfs-path input{flex:1;background:rgba(128,128,128,.15);border:1px solid rgba(128,128,128,.3);border-radius:6px;color:inherit;padding:6px 8px;font-size:12px;min-width:0}
.remfs-roots{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 8px;align-items:center}
.remfs-chip{border:1px solid rgba(128,128,128,.35);border-radius:999px;padding:3px 10px;cursor:pointer;font-size:12px;background:transparent;color:inherit;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.remfs-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.2))}
.remfs-hidebox{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary,#999);cursor:pointer;user-select:none}
.remfs-manage{background:transparent;border:1px solid rgba(128,128,128,.3);border-radius:6px;color:inherit;font-size:11px;padding:3px 8px;cursor:pointer}
.remfs-manage:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.2))}
.remfs-moremenu{display:flex;gap:12px;padding:6px 12px 8px;align-items:center;border-bottom:1px solid rgba(128,128,128,.15)}
.remfs-list{flex:1;overflow:auto;padding:4px 0}
.remfs-row{display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer}
.remfs-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.15))}
.remfs-row .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.remfs-row .s{color:var(--dsw-alias-label-secondary,#999);font-size:11px}
.remfs-row.file-dim{cursor:default;opacity:.55}
.remfs-row.file-dim:hover{background:transparent}
.remfs-wsbadge{border:1px solid rgba(74,108,247,.5);background:rgba(74,108,247,.12);color:#7d97ff;border-radius:4px;font-size:10px;padding:1px 5px;flex:none}
.remfs-prev{padding:10px 12px;border-top:1px solid rgba(128,128,128,.25);display:flex;flex-direction:column;gap:8px;max-height:45%;min-height:0}
.remfs-prev pre{margin:0;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow:auto;background:rgba(0,0,0,.25);border-radius:6px;padding:8px;font-size:12px}
.remfs-prev img{max-width:100%;border-radius:6px}
.remfs-btn{border:1px solid rgba(128,128,128,.35);border-radius:6px;padding:4px 10px;cursor:pointer;background:transparent;color:inherit;font-size:12px}
.remfs-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.2))}
.remfs-btn.primary{background:#4a6cf7;border-color:#4a6cf7;color:#fff}
.remfs-btn:disabled{opacity:.4;cursor:default}
.remfs-err{color:#ff8a8a;padding:6px 12px;font-size:12px}
.remfs-err.lock{color:#ffb86b}
.remfs-tools{display:flex;gap:6px;flex-wrap:wrap}
.remfs-close{margin-left:auto;font-size:13px;padding:6px 12px}
.remfs-upload{align-self:flex-start;display:inline-flex;align-items:center;gap:4px}
.remfs-wsbtn{background:#4a6cf7;border:1px solid #4a6cf7;color:#fff;border-radius:8px;padding:9px 14px;cursor:pointer;font-size:13px;width:100%;text-align:center}
.remfs-wsbtn:hover{filter:brightness(1.1)}
.remfs-wsbtn:disabled{opacity:.5;cursor:default}
.remfs-sec{padding:8px 12px 2px;font-size:11px;font-weight:700;color:var(--dsw-alias-label-secondary,#999);text-transform:uppercase;letter-spacing:.4px}
.remfs-card{border:1px solid rgba(128,128,128,.2);border-radius:10px;margin:6px 12px;padding:9px 11px;display:flex;flex-direction:column;gap:6px;background:rgba(255,255,255,.02)}
.remfs-card.need{background:rgba(224,108,108,.08);border-color:rgba(224,108,108,.45)}
.remfs-card.fail{border-color:rgba(224,108,108,.4)}
.remfs-card.ok{border-color:rgba(46,125,50,.4)}
.remfs-card .tt{font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px}
.remfs-card .st2{font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
.remfs-card .la{font-size:11px;color:var(--dsw-alias-label-secondary,#999);word-break:break-all}
.remfs-card .delta{display:flex;gap:10px;font-size:10px;color:var(--dsw-alias-label-secondary,#999);flex-wrap:wrap}
.remfs-card .sz{font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
.remfs-card .sz.warn{color:#ffb86b}
.remfs-card .row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.remfs-open{background:transparent;border:1px solid rgba(74,108,247,.6);color:#7d97ff;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:11px;flex:none}
.remfs-open:hover{background:rgba(74,108,247,.15)}
.remfs-board{max-height:86vh}
.remfs-card.stalled{border-color:rgba(255,183,107,.5)}
.remfs-card-stale{font-size:11px;color:#ffb86b}
.remfs-hbtn{background:transparent;border:1px solid rgba(128,128,128,.3);border-radius:8px;color:inherit;font-size:13px;height:34px;padding:0 10px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.remfs-hbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.2))}
.remfs-hbtn.open{border-color:#4a6cf7}
.remfs-manager{padding:10px 12px;border-top:1px solid rgba(128,128,128,.25);display:flex;flex-direction:column;gap:8px}
.remfs-manager textarea{width:100%;box-sizing:border-box;min-height:110px;font-family:monospace;font-size:12px;background:rgba(0,0,0,.2);color:inherit;border:1px solid rgba(128,128,128,.3);border-radius:6px;padding:8px}
.remfs-wssec{padding:8px 12px 4px;display:flex;flex-direction:column;gap:6px}
.remfs-wssec .lbl{font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
.remfs-pushbox{margin:8px 12px 0;padding:10px 12px;border:1px solid rgba(128,128,128,.28);border-radius:10px;background:rgba(30,30,36,.6);display:flex;flex-direction:column;gap:8px}
.remfs-pushrow{display:flex;align-items:center;gap:10px}
.remfs-pushicon{font-size:18px}
.remfs-pushinfo{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}
.remfs-pushtitle{font-size:13px;font-weight:600}
.remfs-pushhint{font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
.remfs-pushask{display:flex;flex-direction:column;gap:8px}
.remfs-pushask .remfs-tools,.remfs-pushrow .remfs-tools{display:flex;gap:8px;flex-wrap:wrap}
.remfs-wschips{display:flex;flex-wrap:wrap;gap:6px}
.remfs-wschip{border:1px solid rgba(74,108,247,.55);border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;background:rgba(74,108,247,.12);color:inherit;display:flex;flex-direction:column;gap:1px;align-items:flex-start;max-width:200px}
.remfs-wschip:hover{background:rgba(74,108,247,.2)}
.remfs-wschip .t{font-size:12px}
.remfs-wschip .pt{font-size:10px;color:var(--dsw-alias-label-secondary,#999);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.remfs-wschip .pt.warn{color:#ffb86b}
.remfs-go{padding:8px 12px 10px}
.remfs-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2000;max-width:88vw;padding:10px 16px;border-radius:10px;font-size:13px;background:var(--dsw-specific-sidebar-fill,rgba(30,30,36,.95));color:var(--dsw-alias-label-primary,#eee);border:1px solid var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.4));box-shadow:0 4px 16px rgba(0,0,0,.25);opacity:0;transition:opacity .22s;pointer-events:none;text-align:center;word-break:break-all}
.remfs-toast-show{opacity:1}
.remfs-toast-success{border-color:rgba(46,125,50,.85)}
.remfs-toast-error{border-color:rgba(224,108,108,.85);color:#e06c6c}
@media (max-width: 700px) {
  ${UPSTREAM_SELECTORS.row} { flex-wrap: wrap; row-gap: 8px; }
  ${UPSTREAM_SELECTORS.trailing} { flex: 1 1 100%; min-width: 100%; margin-left: 0; }
  ${UPSTREAM_SELECTORS.root}, ${UPSTREAM_SELECTORS.trigger} { width: 100%; }
  ${UPSTREAM_SELECTORS.card} { padding-bottom: 8px; }
  ${UPSTREAM_SELECTORS.centerCol} { position: relative; z-index: 5; }
}
.remfs-sbar{display:none;position:fixed;left:10px;bottom:16px;z-index:1000;width:38px;height:38px;border:1px solid rgba(128,128,128,.35);border-radius:50%;background:rgba(20,20,24,.8);color:var(--dsw-alias-label-primary,#eee);font-size:17px;cursor:grab;align-items:center;justify-content:center;padding:0;touch-action:none;-webkit-user-select:none;user-select:none}
.remfs-sbar:active{cursor:grabbing}
.remfs-sbar:hover{background:rgba(40,40,48,.85)}
@media (max-width: 700px) {
  ${UPSTREAM_SELECTORS.frame} { grid-template-columns: 0px 1fr 0px !important; }
  ${UPSTREAM_SELECTORS.centerCol} { grid-column: 2 !important; }
  ${UPSTREAM_SELECTORS.sidebarCol} { display: none !important; }
  ${UPSTREAM_SELECTORS.detailsCol} { display: none !important; }
  ${UPSTREAM_SELECTORS.handle} { display: none !important; }
  html.remfs-sidebar-open ${UPSTREAM_SELECTORS.sidebarCol} { display: flex !important; position: fixed; left: 0; top: 0; bottom: 0; z-index: 105; box-shadow: 4px 0 20px rgba(0,0,0,.35); }
  .remfs-sbar{display:flex}
}
`

    const join = (dir, name) => (dir.endsWith('\\') || dir.endsWith('/') ? dir + name : dir + '\\' + name)
    const normPath = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase()

    const fmtSize = (n) => {
      if (n === undefined || n === null) return ''
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(1) + ' MB'
    }

    // Short "x 分钟前 / min ago" label for epoch-ms timestamps (push delivery).
    const agoLabel = (ms) => {
      const diff = Math.max(0, Date.now() - Number(ms))
      const m = Math.floor(diff / 60000)
      if (m < 1) return lang === 'zh' ? '刚刚' : 'just now'
      if (m < 60) return lang === 'zh' ? m + ' 分钟前' : m + ' min ago'
      const h = Math.floor(m / 60)
      if (h < 24) return lang === 'zh' ? h + ' 小时前' : h + ' h ago'
      return lang === 'zh' ? Math.floor(h / 24) + ' 天前' : Math.floor(h / 24) + ' d ago'
    }

    // Sessions above this on-disk size get a "suggest archiving" hint in the
    // session/workspace lists (big persisted logs bloat harness memory).
    const ARCHIVE_HINT_BYTES = 10 * 1024 * 1024

    // Data-integrity: the browser client inlines the encoding checks because
    // it cannot import lib/encoding.js (browser bundle). Mirrors that module
    // exactly: reject UTF-16 BOMs and invalid UTF-8 (GBK/ANSI) uploads before
    // they can write, preserve a UTF-8 BOM.
    const encHasUtf16Bom = (b) => b && b.length >= 2 && ((b[0] === 0xFF && b[1] === 0xFE) || (b[0] === 0xFE && b[1] === 0xFF))
    const encHasUtf8Bom = (b) => b && b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF
    const encValidUtf8 = (b) => {
      try { new TextDecoder('utf-8', { fatal: true }).decode(b); return true } catch { return false }
    }

    const ext = (name) => {
      const i = name.lastIndexOf('.')
      return i < 0 ? '' : name.slice(i + 1).toLowerCase()
    }

    const mimeOf = (name) => {
      const m = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
      return m[ext(name)] || 'application/octet-stream'
    }

    const SYSTEM_DIRS = new Set(['system volume information', '$recycle.bin', 'recovery', 'config.msi', '$sysreset', 'windows', 'perflogs', 'msocache', 'windows.old', '$winreagent'])

    // ── i18n ─────────────────────────────────────────────────────────────────
    const L10N = {
      zh: {
        tabSession: '＋ 新建会话', tabFiles: '📁 文件浏览',
        headSession: '新建会话', headFiles: '文件浏览',
        close: '✕ 关闭', loading: '加载中…',
        boardButton: '任务', orbLockedTitle: '配对后可查看任务详情',
        boardTitle: 'Agent 任务', boardNeedsYou: '需要你', boardRunning: '运行中', boardNotStarted: '未开始', boardDone: '已完成', boardFailed: '失败', boardDisconnected: '已断开',
        boardStalled: '可能停滞', boardOpen: '打开', boardEmpty: '暂无任务', boardLoadFail: '任务加载失败',
        sessSizeWarn: '建议归档', wsSessions: '{n} 个会话 · {size}',
        notifNeedsYou: 'DeepSeek Harness 需要你', notifFailed: 'Agent 执行失败', notifDone: '任务完成',
        wsSection: '已有工作区(点击直接开新会话)', wsEmpty: '暂无,可从下方目录新建',
        wsSection2: '或选择文件夹作为新工作区',
        startHere: '🚀 在这里开始会话', continueHere: '🚀 在此继续会话', busy: '处理中…',
        absPath: '绝对路径',
        hideSystemTitle: '隐藏系统保护目录', hideSystem: '隐藏系统目录', manageRoots: '⚙ 管理可访问目录',
        editPrefix: '编辑: ', save: '💾 保存', cancel: '取消',
        download: '⬇ 下载', editFile: '✎ 编辑',
        tooLarge: '文件超过 5MB,暂不支持预览/下载', binary: '二进制文件,点击下载查看',
        uploadHint: '⬆ 上传文本文件到当前目录',
        managerTitle: '可访问目录(每行一个,手机端只能浏览这些目录):',
        exampleRoots: 'C:\\Users\\<user>\\Documents\nD:\\素材',
        savedToast: '✅ 已保存: ', uploadedToast: '✅ 已上传: ',
        sessionStarted: '✅ 已在此文件夹开始新会话', wsOpened: '✅ 已打开工作区并开始新会话',
        rootsSaved: '✅ 可访问目录已保存({n} 个)', saveFailed: '❌ 保存失败',
        lockDenied: '🔒 无权限访问(系统保护目录或其他用户的文件夹)', outside: '该路径不在可访问目录内',
        wsBadge: '★ 工作区',
        toggleTitleOpen: '关闭', toggleTitleClosed: '新建会话 / 文件浏览',
        sidebarOpen: '收起侧边栏', sidebarClosed: '展开侧边栏',
        headerNew: '＋ 新会话',
        slotLabel: '新会话', slotPageLabel: '＋ 新会话 / 文件浏览',
        otherLang: 'EN',
        pairTitle: '设备配对', pairHint: '在电脑上打开 %USERPROFILE%\\.dsh\\remfs-pairing.txt 获取配对码(一次性,10 分钟有效)',
        pairCode: '配对码', deviceName: '设备名称', pairBtn: '配对', pairingBtn: '配对中…',
        pairedToast: '✅ 配对成功', pairFailed: '配对失败',
        devicesTitle: '已配对设备', revokeBtn: '吊销', revokeAllBtn: '吊销全部',
        revokedToast: '✅ 已吊销', noDevices: '暂无设备', devMgmt: '🔐 设备管理',
        pushToggle: '推送通知(关页面也能收到「需要你」)', pushUnsupported: '需 HTTPS(localhost 或 Tailscale HTTPS)', pushEnableErr: '推送不可用,请确认已连接 Tailscale HTTPS',
        pushHint: '关页面也能收到「需要你 / 失败」提醒', pushAskTitle: '开启推送通知?', pushAskHint: '关闭页面也能收到重要提醒', pushAskYes: '开启', pushAskLater: '稍后', pushOn: '已开启', pushOff: '开启', pushOnToast: '✅ 推送已订阅',
        pushTestBtn: '测试推送', pushTestOk: '✅ 已发送 — 请留意手机通知;收不到多为推送服务(如 FCM)不可达', pushTestFail: '❌ 推送发送失败', pushTestNone: '请先开启推送开关',
        rootOutside: '新增目录必须在已批准目录内——在电脑上编辑 .remfs-roots.json 添加新位置',
        authFailed: '设备未授权,请重新配对', capDenied: '此设备没有执行该操作所需的权限',
        upstreamDrift: '⚠ DSH 界面结构已变化,移动端布局适配可能失效(功能不受影响)',
        encNotUtf8: '检测到非 UTF-8 编码,请转为 UTF-8 后重试'
      },
      en: {
        tabSession: '＋ New Session', tabFiles: '📁 Files',
        headSession: 'New Session', headFiles: 'Files',
        close: '✕ Close', loading: 'Loading…',
        boardButton: 'Tasks', orbLockedTitle: 'Pair to view task details',
        boardTitle: 'Agent tasks', boardNeedsYou: 'Needs You', boardRunning: 'Running', boardNotStarted: 'Not Started', boardDone: 'Done', boardFailed: 'Failed', boardDisconnected: 'Disconnected',
        boardStalled: 'Possibly stalled', boardOpen: 'Open', boardEmpty: 'No tasks', boardLoadFail: 'Failed to load tasks',
        sessSizeWarn: 'suggest archiving', wsSessions: '{n} sessions · {size}',
        notifNeedsYou: 'DeepSeek Harness needs you', notifFailed: 'Agent failed', notifDone: 'Task completed',
        wsSection: 'Existing workspaces (tap to open a new session)', wsEmpty: 'None yet — pick a folder below',
        wsSection2: 'Or choose a folder as a new workspace',
        startHere: '🚀 Start a session here', continueHere: '🚀 Continue here', busy: 'Working…',
        absPath: 'Absolute path',
        hideSystemTitle: 'Hide system-protected dirs', hideSystem: 'Hide system dirs', manageRoots: '⚙ Manage allowed dirs',
        editPrefix: 'Editing: ', save: '💾 Save', cancel: 'Cancel',
        download: '⬇ Download', editFile: '✎ Edit',
        tooLarge: 'File exceeds 5 MB — preview/download unsupported', binary: 'Binary file — tap Download to view',
        uploadHint: '⬆ Upload a text file to this folder',
        managerTitle: 'Allowed dirs (one per line; the phone can only browse these):',
        exampleRoots: 'C:\\Users\\<user>\\Documents\nD:\\Assets',
        savedToast: '✅ Saved: ', uploadedToast: '✅ Uploaded: ',
        sessionStarted: '✅ Session started in this folder', wsOpened: '✅ Workspace opened, new session started',
        rootsSaved: '✅ Allowed dirs saved ({n})', saveFailed: '❌ Save failed',
        lockDenied: '🔒 Access denied (system-protected or another user\'s folder)', outside: 'Path is outside the allowed dirs',
        wsBadge: '★ Workspace',
        toggleTitleOpen: 'Close', toggleTitleClosed: 'New session / Files',
        sidebarOpen: 'Collapse sidebar', sidebarClosed: 'Expand sidebar',
        headerNew: '＋ New Session',
        slotLabel: 'New Session', slotPageLabel: '＋ New Session / Files',
        otherLang: '中',
        pairTitle: 'Device pairing', pairHint: 'Open %USERPROFILE%\\.dsh\\remfs-pairing.txt on the PC and enter the code (one-time, valid 10 min)',
        pairCode: 'Pairing code', deviceName: 'Device name', pairBtn: 'Pair', pairingBtn: 'Pairing…',
        pairedToast: '✅ Paired', pairFailed: 'Pairing failed',
        devicesTitle: 'Paired devices', revokeBtn: 'Revoke', revokeAllBtn: 'Revoke all',
        revokedToast: '✅ Revoked', noDevices: 'No devices', devMgmt: '🔐 Devices',
        pushToggle: 'Push notifications (get "needs you" with the page closed)', pushUnsupported: 'needs HTTPS (localhost or Tailscale HTTPS)', pushEnableErr: 'Push unavailable — check you are on Tailscale HTTPS',
        pushHint: 'Get "needs you / failed" alerts with the page closed', pushAskTitle: 'Enable push notifications?', pushAskHint: 'Important alerts arrive even with the page closed', pushAskYes: 'Enable', pushAskLater: 'Later', pushOn: 'On', pushOff: 'Enable', pushOnToast: '✅ Push subscribed',
        pushTestBtn: 'Test push', pushTestOk: '✅ Sent — watch for the notification; if none arrives the push service (e.g. FCM) is unreachable', pushTestFail: '❌ Test push failed', pushTestNone: 'Enable the push toggle first',
        rootOutside: 'New roots must stay inside approved roots — edit .remfs-roots.json on the PC to add new locations',
        authFailed: 'Device not authorized — please pair again', capDenied: 'This device does not have permission for that operation',
        upstreamDrift: '⚠ DSH UI structure changed — mobile layout tweaks may be inactive (features unaffected)',
        encNotUtf8: 'Non-UTF-8 encoding detected — convert to UTF-8 and retry'
      }
    }

    let lang = 'zh'
    try {
      const saved = window.localStorage.getItem('remfs-lang')
      if (saved === 'zh' || saved === 'en') lang = saved
      else lang = (window.navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
    } catch { /* default zh */ }
    const langListeners = new Set()
    const setLang = (l) => {
      lang = l
      try { window.localStorage.setItem('remfs-lang', l) } catch { /* ignore */ }
      langListeners.forEach((fn) => fn())
    }
    const toggleLang = () => setLang(lang === 'zh' ? 'en' : 'zh')
    const t = (key, vars) => {
      const table = L10N[lang] || L10N.zh
      let s = table[key] !== undefined ? table[key] : key
      if (vars) {
        for (const k of Object.keys(vars)) s = s.replace('{' + k + '}', String(vars[k]))
      }
      return s
    }
    const subscribeLang = (fn) => { langListeners.add(fn); return () => langListeners.delete(fn) }

    // ── device auth ──────────────────────────────────────────────────────────
    const getCred = () => {
      try {
        const id = window.localStorage.getItem('remfs-device-id')
        const cred = window.localStorage.getItem('remfs-device-credential')
        return (id && cred) ? { deviceId: id, credential: cred } : null
      } catch { return null }
    }
    const saveCred = (deviceId, credential) => {
      try {
        window.localStorage.setItem('remfs-device-id', deviceId)
        window.localStorage.setItem('remfs-device-credential', credential)
      } catch { /* ignore */ }
    }
    const clearCred = () => {
      try {
        window.localStorage.removeItem('remfs-device-id')
        window.localStorage.removeItem('remfs-device-credential')
      } catch { /* ignore */ }
    }

    // ── Web Push (phone notifications with the page closed) ────────────────
    // The phone registers the service worker served at /remfs-sw.js (same
    // origin) and, once paired + opted in, subscribes to push with the VAPID
    // public key from /remfs-push-vapid.json. The subscription is reported to
    // the host via /pocket push.subscribe (device-authenticated); the host
    // then pushes NEEDS_USER/FAILED (and DONE when enabled) transitions even
    // when the phone tab is closed. Requires a secure context: HTTPS via
    // Tailscale, or http://localhost. Plain-LAN (http://192.168.x.x) and
    // Tailscale-IP HTTP cannot register a service worker.
    const pushEnabled = () => { try { return window.localStorage.getItem('remfs-push-enabled') === '1' } catch { return false } }
    const setPushEnabledFlag = (v) => { try { window.localStorage.setItem('remfs-push-enabled', v ? '1' : '0') } catch { /* ignore */ } }
    const pushSupported = () => {
      try {
        if (window.isSecureContext !== true) return false
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false
        if (typeof Notification === 'undefined' || typeof PushManager === 'undefined') return false
        return true
      } catch { return false }
    }
    const b64urlFromBytes = (buf) => {
      let s = ''
      for (const b of buf) s += String.fromCharCode(b)
      try { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') } catch { return '' }
    }
    const urlBase64ToUint8Array = (b64) => {
      const raw = String(b64).replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/')
      const bin = atob(raw)
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      return arr
    }

    /** Subscribe (or refresh) the push subscription for the CURRENT device. */
    // Returns a normal RPC envelope, or { ok:false, error:{code,message} }
    // describing WHY it failed. It used to `return null` on every failure and
    // the caller tested `if (r && !r.ok)` - so a failed subscribe showed NO
    // error at all while the toggle still flipped to "on": the UI claimed push
    // was enabled while the host had no subscription at all. subscribe() is
    // the one that actually fails in the field (no Google Play services, FCM
    // unreachable, permission denied), so its real DOMException now reaches
    // the user instead of being swallowed.
    const pushFail = (code, message) => ({ ok: false, error: { code, message: String(message || code) } })
    const ensurePushSubscription = async (conn, reg) => {
      const cred = getCred()
      if (!cred) return pushFail('not-paired', 'device is not paired')
      if (!reg) return pushFail('no-service-worker', 'service worker not registered')
      let sub
      try {
        sub = await reg.pushManager.getSubscription()
      } catch (e) {
        return pushFail('subscribe-failed', (e && (e.name + ': ' + e.message)) || e)
      }
      if (!sub) {
        let key
        try {
          const r = await window.fetch('/remfs-push-vapid.json', { cache: 'no-store' }).then((x) => x.json())
          key = r && r.ok && r.value && r.value.publicKeyB64
        } catch (e) {
          return pushFail('vapid-unavailable', (e && e.message) || e)
        }
        if (!key) return pushFail('vapid-unavailable', 'host returned no VAPID public key')
        try {
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
        } catch (e) {
          // The field failure: AbortError "Registration failed - push service
          // error" = no GMS / FCM unreachable. NotAllowedError = permission denied.
          return pushFail('subscribe-failed', (e && (e.name + ': ' + e.message)) || e)
        }
      }
      const p256dh = sub.getKey('p256dh') ? b64urlFromBytes(sub.getKey('p256dh')) : ''
      const auth = sub.getKey('auth') ? b64urlFromBytes(sub.getKey('auth')) : ''
      if (!p256dh || !auth) return pushFail('no-keys', 'subscription carried no p256dh/auth keys')
      let lang = 'zh'
      try { lang = window.localStorage.getItem('remfs-lang') === 'en' ? 'en' : 'zh' } catch { /* default zh */ }
      try {
        return await conn.rpc.call('/pocket', 'push.subscribe', {
          deviceId: cred.deviceId, credential: cred.credential, lang,
          subscription: { endpoint: sub.endpoint, keys: { p256dh, auth } },
        })
      } catch (e) {
        return pushFail('rpc-failed', (e && e.message) || e)
      }
    }

    /** Unsubscribe from push and tell the host to forget the endpoint. */
    const disablePush = async (conn, reg) => {
      setPushEnabledFlag(false)
      try {
        const cred = getCred()
        if (reg) {
          const sub = await reg.pushManager.getSubscription()
          if (sub) {
            if (cred) {
              try {
                await conn.rpc.call('/pocket', 'push.unsubscribe', {
                  deviceId: cred.deviceId, credential: cred.credential, endpoint: sub.endpoint,
                })
              } catch { /* ignore */ }
            }
            try { await sub.unsubscribe() } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }

    /** Register the service worker and (when paired + opted in) subscribe. */
    const setupPush = async (conn) => {
      if (!pushSupported()) return { supported: false }
      try {
        const reg = await navigator.serviceWorker.register('/remfs-sw.js')
        await navigator.serviceWorker.ready
        reg.addEventListener('pushsubscriptionchange', () => { ensurePushSubscription(conn, reg) })
        // 1.5: notification click deep-link. The SW stashes the target session
        // in a Cache-API flag (SWs cannot touch localStorage) and posts a
        // message to an already-open window; both paths land here.
        navigator.serviceWorker.addEventListener('message', (e) => {
          const d = e && e.data
          if (d && d.type === 'remfs-push-target') {
            openPushTarget(d.sessionId)
            clearPushTargetFlag()
          }
        })
        if (getCred() && pushEnabled()) ensurePushSubscription(conn, reg)
        return { supported: true, reg }
      } catch { return { supported: false } }
    }

    // ── Notification click deep-link (1.5) ────────────────────────────────
    // Tapping a push notification must land the user in the right session.
    // The GUI has no session URL routing, so the SW writes a same-origin
    // Cache-API flag (cache 'remfs-persistent-push-v1', key '/remfs-push-target')
    // holding the sessionId; on page load this flag is read once, the session
    // is opened via ctx.sessions.open(id) (selects an EXISTING session, never
    // a replacement) and the flag is deleted. Reading fails silently whenever
    // the API is absent (no SW / no session service).
    const PUSH_TARGET_CACHE = 'remfs-persistent-push-v1'
    const PUSH_TARGET_KEY = '/remfs-push-target'
    const openPushTarget = (sessionId) => {
      if (!sessionId) return
      try {
        if (window.__remfsSessionsApi && typeof window.__remfsSessionsApi.open === 'function') {
          window.__remfsSessionsApi.open(String(sessionId))
        }
      } catch { /* best-effort: the session may no longer exist */ }
    }
    const clearPushTargetFlag = () => {
      try {
        if (typeof window.caches === 'undefined') return
        window.caches.open(PUSH_TARGET_CACHE).then((cache) => {
          cache.delete(PUSH_TARGET_KEY).catch(() => { /* ignore */ })
        }).catch(() => { /* ignore */ })
      } catch { /* ignore */ }
    }
    // The DESKTOP companion is a native process: it cannot write the
    // same-origin Cache flag the Service Worker uses, so it deep-links
    // through the URL fragment instead - #remfs-session=<id>. Same
    // consume-once semantics, and the fragment is stripped afterwards so a
    // refresh does not re-open the session. A fragment never reaches the
    // server, so this adds no route and leaks no session id off-machine.
    const REMFS_HASH_PREFIX = '#remfs-session='
    const consumeHashTarget = () => {
      try {
        const h = String(window.location.hash || '')
        if (h.indexOf(REMFS_HASH_PREFIX) !== 0) return
        const sessionId = decodeURIComponent(h.slice(REMFS_HASH_PREFIX.length))
        // Clear first: opening may throw for a session that no longer exists,
        // and the fragment must not survive to fire again on the next load.
        try { window.history.replaceState(null, '', window.location.pathname + window.location.search) } catch { window.location.hash = '' }
        if (sessionId) openPushTarget(sessionId)
      } catch { /* best-effort */ }
    }

    const consumePushTarget = () => {
      try {
        if (typeof window.caches === 'undefined') return
        window.caches.open(PUSH_TARGET_CACHE).then((cache) =>
          cache.match(PUSH_TARGET_KEY).then((hit) => {
            if (!hit) return null
            cache.delete(PUSH_TARGET_KEY).catch(() => { /* ignore */ })
            return hit.text()
          })
        ).then((sessionId) => { if (sessionId) openPushTarget(sessionId) })
          .catch(() => { /* ignore */ })
      } catch { /* ignore */ }
    }

    const friendlyErr = (msg, code) => {
      const s = String(msg || '')
      if (code === 'encoding-not-utf8') return { lock: false, text: t('encNotUtf8') }
      if (code === 'root-outside-approved') return { lock: false, text: t('rootOutside') }
      if (code === 'auth-required' || code === 'auth-invalid') return { lock: true, text: t('authFailed') }
      if (code === 'capability-required') return { lock: true, text: t('capDenied') }
      if (/denied|EACCES|EPERM/i.test(s)) return { lock: true, text: t('lockDenied') }
      if (/allowed|范围|outside/i.test(s)) return { lock: true, text: t('outside') }
      return { lock: false, text: s }
    }

    // ── Agent Presence (/pocket) ──────────────────────────────────────────
    // RPC goes to /pocket (separate namespace from /remfs). The UI renders
    // ONLY the stable presence contract (docs/presence-api-v1.md).
    const pocketRpc = (conn, method, payload) => {
      const c = getCred()
      return conn.rpc.call('/pocket', method, Object.assign({}, payload, c || {}))
    }

    // ── Presence UI local helpers (mirror lib/presence/ui.js; the browser
    // bundle cannot import the lib module). The pure logic is unit-tested in
    // test/presence-ui.test.js against these EXACT rules.
    const P_NEEDS = 'NEEDS_USER', P_FAILED = 'FAILED', P_STALE = 'STALE', P_RUNNING = 'RUNNING', P_DONE = 'DONE', P_DISCONNECTED = 'DISCONNECTED'

    // ── Browser notifications (design §14) ────────────────────────────────
    // NEEDS_USER/FAILED always notify; never RUNNING/STALE/DONE/IDLE. This
    // used to live inside the floating Orb's refresh loop and was deleted
    // together with the Orb — but notifications are event delivery, not a
    // visual; they now run as a HEADLESS poll started from apply(), so the
    // page alerts the user with no orb and no board open. Permission is only
    // ever requested by the push toggle; without a grant this stays silent.
    const P_NOTIFY = { [P_NEEDS]: true, [P_FAILED]: true }
    // 1.1: browser notification dedupe mirrors the host push dispatcher. Keys
    // are sessionId:STATE:turnCycle (page-lifetime) so a repeat NEEDS_USER /
    // FAILED after a NEW user turn re-alerts, and a per-session 2-minute
    // cooldown keeps rapid cycles from spamming. A cooldown-suppressed event
    // is NOT marked, so a later poll re-checks it once the window elapses.
    const NOTIFY_COOLDOWN_MS = 2 * 60 * 1000
    const notifiedKeys = {} // sessionId:state:turnCycle -> true (page-lifetime dedupe)
    const notifiedAtBySession = {} // sessionId -> epoch ms of the last page alert
    const taskNotifyCycle = (task) => {
      const n = Number(task && task.turnCycle)
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
    }
    function firePresenceNotification(task) {
      try {
        if (typeof Notification !== 'function' || Notification.permission !== 'granted') return
        const title = task.state === P_NEEDS ? t('notifNeedsYou') : task.state === P_FAILED ? t('notifFailed') : t('notifDone')
        const body = (task.title || task.sessionId) + (task.summary ? ' — ' + task.summary : '')
        const n = new Notification(title, { body, tag: 'remfs-presence-' + task.sessionId })
        n.onclick = () => {
          try { window.focus(); n.close() } catch { /* ignore */ }
          try {
            if (window.__remfsSessionsApi && typeof window.__remfsSessionsApi.open === 'function') {
              window.__remfsSessionsApi.open(task.sessionId)
            }
          } catch { /* ignore */ }
        }
      } catch { /* notifications are best-effort */ }
    }
    function notifyPresencePoll(conn) {
      if (typeof Notification !== 'function' || Notification.permission !== 'granted') return
      pocketRpc(conn, 'presence.tasks', {}).then((r) => {
        if (!(r && r.ok && r.value && Array.isArray(r.value.tasks))) return
        const now = Date.now()
        for (const task of r.value.tasks) {
          if (!task || P_NOTIFY[task.state] !== true) continue
          const key = task.sessionId + ':' + task.state + ':' + taskNotifyCycle(task)
          if (notifiedKeys[key]) continue
          const last = notifiedAtBySession[task.sessionId] || 0
          if (now - last < NOTIFY_COOLDOWN_MS) continue // cooldown: retried on a later poll
          notifiedKeys[key] = true
          notifiedAtBySession[task.sessionId] = now
          firePresenceNotification(task)
        }
      }).catch(() => { /* best-effort */ })
    }

    function groupTasksLocal(tasks) {
      const groups = { needsUser: [], running: [], notStarted: [], done: [], failed: [], disconnected: [] }
      for (const t of Array.isArray(tasks) ? tasks : []) {
        let key = 'notStarted'
        if (t.state === P_NEEDS) key = 'needsUser'
        else if (t.state === P_RUNNING || t.state === P_STALE) key = 'running'
        else if (t.state === P_DONE) key = 'done'
        else if (t.state === P_FAILED) key = 'failed'
        else if (t.state === P_DISCONNECTED) key = 'disconnected'
        groups[key].push(t.state === P_STALE ? Object.assign({}, t, { stalled: true }) : t)
      }
      for (const k of Object.keys(groups)) {
        groups[k].sort((a, b) => {
          if (!!a.stalled !== !!b.stalled) return a.stalled ? -1 : 1
          return (b.updatedAt || 0) - (a.updatedAt || 0)
        })
      }
      return groups
    }
    function boardCountsLocal(groups) {
      const out = {}
      for (const k of Object.keys(groups || {})) out[k] = (groups[k] || []).length
      return out
    }
    function PresenceBoard({ conn, sessionsApi, onClose, paired }) {
      const [tasks, setTasks] = React.useState([])
      const [loading, setLoading] = React.useState(true)
      const [err, setErr] = React.useState(null)

      const refresh = () => {
        pocketRpc(conn, 'presence.tasks', {}).then((r) => {
          if (r && r.ok) { setTasks((r.value && r.value.tasks) || []); setErr(null) }
          // Surface the host's error code (sessions-unavailable = upstream
          // shape drift, capability-unavailable = presence disabled) instead
          // of one generic string — a drift diagnosis must stay diagnosable.
          else if (r && !r.ok) setErr(t('boardLoadFail') + (r.error && r.error.code ? ' (' + r.error.code + ')' : ''))
          setLoading(false)
        }).catch(() => { setLoading(false); setErr(t('boardLoadFail')) })
      }
      React.useEffect(() => { refresh() }, [])

      const openSession = (id) => {
        try {
          if (sessionsApi && typeof sessionsApi.open === 'function') { sessionsApi.open(id); if (onClose) onClose() }
        } catch { /* ignore */ }
      }

      const groups = groupTasksLocal(tasks)
      const counts = boardCountsLocal(groups)

      const groupRow = (key, labelKey) => {
        const items = groups[key] || []
        if (items.length === 0) return null
        return React.createElement('div', { key },
          React.createElement('div', { className: 'remfs-sec' }, t(labelKey) + ' (' + items.length + ')'),
          items.map((task) => React.createElement('div', { key: task.sessionId, className: 'remfs-card' + (task.stalled ? ' stalled' : '') },
            React.createElement('div', { className: 'row' },
              React.createElement('div', { className: 'tt' }, (task.stalled ? '◐ ' : '') + (paired ? (task.title || task.sessionId) : t('orbLockedTitle'))),
              React.createElement('button', { className: 'remfs-open', onClick: () => openSession(task.sessionId) }, t('boardOpen'))
            ),
            task.sizeBytes > 0
              ? React.createElement('div', { className: 'sz' + (task.sizeBytes > ARCHIVE_HINT_BYTES ? ' warn' : '') },
                  '📦 ' + fmtSize(task.sizeBytes) + (task.sizeBytes > ARCHIVE_HINT_BYTES ? ' · ' + t('sessSizeWarn') : ''))
              : null,
            paired && task.summary ? React.createElement('div', { className: 'la' }, task.summary) : null,
            task.staleReason && task.staleReason.length > 0
              ? React.createElement('div', { className: 'remfs-card-stale' }, task.staleReason[0])
              : null
          ))
        )
      }

      const body = err ? React.createElement('div', { className: 'remfs-err' }, err)
        : loading ? React.createElement('div', { className: 'remfs-row' }, t('loading'))
        : React.createElement('div', { className: 'remfs-body' },
            groupRow('needsUser', 'boardNeedsYou'),
            groupRow('running', 'boardRunning'),
            groupRow('notStarted', 'boardNotStarted'),
            groupRow('done', 'boardDone'),
            groupRow('failed', 'boardFailed'),
            groupRow('disconnected', 'boardDisconnected'),
            tasks.length === 0 ? React.createElement('div', { className: 'remfs-sec' }, t('boardEmpty')) : null
          )

      return React.createElement('div', { className: 'remfs-panel remfs-board' },
        React.createElement('div', { className: 'remfs-head' },
          React.createElement('b', null, t('boardTitle')),
          React.createElement('span', { className: 'p' }, counts.needsUser + ' need · ' + counts.running + ' run'),
          React.createElement('button', { className: 'remfs-btn remfs-close', onClick: onClose }, t('close'))
        ),
        body
      )
    }

    // Board overlay state: opened from the compact header action. The browser
    // no longer carries a second floating companion; that role belongs to the
    // always-on-top Windows widget.
    let boardOpen = false
    const boardListeners = new Set()
    const setBoardOpen = (v) => { boardOpen = v; boardListeners.forEach((fn) => fn()) }
    const subscribeBoard = (fn) => { boardListeners.add(fn); return () => boardListeners.delete(fn) }

    function PresenceBoardOverlay({ conn }) {
      const [, force] = React.useState(0)
      React.useEffect(() => subscribeBoard(() => force((n) => n + 1)), [])
      if (!boardOpen) return null
      return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'remfs-backdrop', onClick: () => setBoardOpen(false) }),
        React.createElement(PresenceBoard, { conn, sessionsApi: window.__remfsSessionsApi, onClose: () => setBoardOpen(false), paired: getCred() !== null })
      )
    }

    function Workbench({ embedded, onClose, conn }) {
      const [tab, setTab] = React.useState('files')
      const [path, setPath] = React.useState('')
      const [parent, setParent] = React.useState(null)
      const [allowed, setAllowed] = React.useState([])
      const [wsList, setWsList] = React.useState([])
      const [wsAgg, setWsAgg] = React.useState({}) // workspaceId -> { count, bytes, big } from presence.tasks
      const [entries, setEntries] = React.useState([])
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [preview, setPreview] = React.useState(null)
      const [editing, setEditing] = React.useState(null)
      const [editText, setEditText] = React.useState('')
      const [inputPath, setInputPath] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [hideSystem, setHideSystem] = React.useState(true)
      const [managing, setManaging] = React.useState(false)
      const [manageText, setManageText] = React.useState('')
      const [moreOpen, setMoreOpen] = React.useState(false)
      const [, forceLang] = React.useState(0)
      React.useEffect(() => subscribeLang(() => forceLang((n) => n + 1)), [])
      const [cred, setCredState] = React.useState(() => getCred())
      const [pairCode, setPairCode] = React.useState('')
      const [deviceName, setDeviceName] = React.useState('')
      const [pairing, setPairing] = React.useState(false)
      const [devicesOpen, setDevicesOpen] = React.useState(false)
      const [devices, setDevices] = React.useState([])
      // pushHealth (1.3): the push.status response for the CURRENT device
      // (owner-scoped) - null when the op is absent or failed, which keeps the
      // Devices pane rendering exactly as before (no push delivery lines).
      const [pushHealth, setPushHealth] = React.useState(null)
      const loadPushHealth = () => {
        pocketRpc(conn, 'push.status', {}).then((r) => {
          setPushHealth(r && r.ok && r.value ? r.value : null)
        }).catch(() => setPushHealth(null))
      }
      const [pushReg, setPushReg] = React.useState(null)
      const [pushOk, setPushOk] = React.useState(pushSupported())
      const [pushAsk, setPushAsk] = React.useState(false)
      const pushDeclined = () => { try { return window.localStorage.getItem('remfs-push-declined') === '1' } catch { return false } }
      const declinePush = () => { try { window.localStorage.setItem('remfs-push-declined', '1') } catch { /* ignore */ } }
      React.useEffect(() => {
        // The service worker registration resolves asynchronously in apply();
        // grab it when it appears so the toggle can subscribe with it.
        let alive = true
        const grab = () => {
          if (!alive) return
          const reg = window.__remfsPushReg
          if (reg) setPushReg(reg)
          else setTimeout(grab, 400)
        }
        grab()
        return () => { alive = false }
      }, [])

      const rpc = (method, payload) => {
        const c = getCred()
        return conn.rpc.call('/remfs', method, Object.assign({}, payload, c || {}))
      }

      // Returns true when the response signals an auth problem (pairing UI shows).
      const noteAuth = (r) => {
        if (r && !r.ok && r.error && (r.error.code === 'auth-required' || r.error.code === 'auth-invalid')) {
          clearCred()
          setCredState(null)
          setError({ lock: true, text: t('authFailed') })
          return true
        }
        return false
      }

      const doPair = () => {
        if (!pairCode.trim() || pairing) return
        setPairing(true); setError(null)
        rpc('pair', { code: pairCode, deviceName: deviceName || 'phone' }).then((r) => {
          if (r && r.ok && r.value && r.value.deviceId && r.value.credential) {
            saveCred(r.value.deviceId, r.value.credential)
            setCredState(getCred())
            setPairCode(''); setDeviceName('')
            showToast(t('pairedToast'), 'success')
            refresh(null)
            // If push is opted in, subscribe with the freshly paired identity.
            if (pushEnabled() && window.__remfsPushReg) ensurePushSubscription(conn, window.__remfsPushReg)
            // Freshly paired + HTTPS + not previously declined: nudge toward
            // push right on the home screen (the toggle lives there now).
            if (pushOk && !pushEnabled() && !pushDeclined()) setPushAsk(true)
          } else {
            const fe = friendlyErr((r && r.error && r.error.message) || t('pairFailed'), r && r.error && r.error.code)
            setError(fe)
            showToast('❌ ' + fe.text, 'error')
          }
        }).catch((e) => {
          const fe = friendlyErr(String(e))
          setError(fe)
          showToast('❌ ' + fe.text, 'error')
        }).then(() => setPairing(false))
      }

      const loadDevices = () => {
        rpc('devices', {}).then((r) => {
          if (r && r.ok) setDevices((r.value && r.value.devices) || [])
          else if (noteAuth(r)) { /* pairing UI */ }
        }).catch(() => {})
      }

      const doRevoke = (id) => {
        // Protocol: the revoke target is a SEPARATE field from the caller's
        // auth identity (deviceId/credential are attached by rpc()).
        rpc('revoke', { targetDeviceId: id }).then((r) => {
          if (r && r.ok) { showToast(t('revokedToast'), 'success'); loadDevices() }
          else if (noteAuth(r)) { /* pairing UI */ }
        }).catch(() => {})
      }

      const doRevokeAll = () => {
        rpc('revokeAll', {}).then((r) => {
          if (r && r.ok) { showToast(t('revokedToast'), 'success'); loadDevices() }
          else if (noteAuth(r)) { /* pairing UI */ }
        }).catch(() => {})
      }

      // ── Web Push toggle (Devices pane) ────────────────────────────────────
      // Enabling requests notification permission (if needed) and subscribes
      // through the host (/pocket push.subscribe). Disabling unsubscribes and
      // tells the host to drop the endpoint.
      const onTogglePush = (on) => {
        if (on) {
          setPushEnabledFlag(true)
          const doSubscribe = () => {
            ensurePushSubscription(conn, pushReg).then((r) => {
              if (r && r.ok) { showToast(t('pushOnToast'), 'success'); forceLang((n) => n + 1); return }
              // Failure must NOT leave the toggle claiming "on" - that is how a
              // dead subscription looked enabled while the host had nothing.
              setPushEnabledFlag(false)
              const code = (r && r.error && r.error.code) || 'unknown'
              const msg = (r && r.error && r.error.message) || ''
              if (code === 'capability-denied') showToast(t('capDenied'), 'error')
              else showToast(t('pushEnableErr') + ' [' + code + '] ' + msg, 'error')
              forceLang((n) => n + 1)
            })
          }
          if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission().then((p) => {
              if (p === 'granted') doSubscribe()
              else { setPushEnabledFlag(false); forceLang((n) => n + 1) }
            })
          } else {
            doSubscribe()
          }
        } else {
          disablePush(conn, pushReg)
        }
        forceLang((n) => n + 1)
      }

      const load = (p, fallback) => {
        setLoading(true); setError(null); setPreview(null); setEditing(null)
        rpc('list', { path: p }).then((r) => {
          setLoading(false)
          if (r && r.ok) {
            const d = (r && r.value) || {}
            setPath(d.path || '')
            setParent(d.parent || null)
            setEntries(d.entries || [])
            setInputPath(d.path || '')
          } else {
            if (noteAuth(r)) return
            const fe = friendlyErr((r && r.error && r.error.message) || 'load failed', r && r.error && r.error.code)
            if (fe.lock && fallback) { load(fallback, null) }
            else setError(fe)
          }
        }).catch((e) => { setLoading(false); setError(friendlyErr(String(e))) })
      }

      const refresh = (target) => {
        rpc('allowed', {}).then((r) => {
          if (noteAuth(r)) return
          const d = (r && r.value) || {}
          if (r && r.ok && Array.isArray(d.allowed) && d.allowed.length > 0) {
            setAllowed(d.allowed)
            load(target || d.allowed[0], null)
          }
        }).catch(() => {})
        rpc('workspaces', {}).then((r) => {
          if (noteAuth(r)) return
          if (r && r.ok) setWsList((r.value && r.value.workspaces) || [])
        }).catch(() => {})
        // Per-workspace session sizes: aggregated from the presence task DTOs
        // (each carries its persisted session dir size on disk).
        pocketRpc(conn, 'presence.tasks', {}).then((r) => {
          if (r && r.ok && r.value && Array.isArray(r.value.tasks)) {
            const agg = {}
            for (const task of r.value.tasks) {
              const wsId = task.workspaceId || ''
              if (!agg[wsId]) agg[wsId] = { count: 0, bytes: 0, big: false }
              agg[wsId].count += 1
              const b = Number(task.sizeBytes) || 0
              agg[wsId].bytes += b
              if (b > ARCHIVE_HINT_BYTES) agg[wsId].big = true
            }
            setWsAgg(agg)
          }
        }).catch(() => {})
      }

      React.useEffect(() => { refresh(null) }, [])

      const openFile = (name) => {
        setPreview(null); setError(null)
        rpc('read', { path: join(path, name) }).then((r) => {
          if (r && r.ok) setPreview(Object.assign({ name }, (r && r.value) || {}))
          else {
            if (noteAuth(r)) return
            setError(friendlyErr((r && r.error && r.error.message) || 'read failed', r && r.error && r.error.code))
          }
        }).catch((e) => setError(friendlyErr(String(e))))
      }

      const saveEdit = () => {
        if (!editing) return
        rpc('write', { path: editing.path, content: editText }).then((r) => {
          if (r && r.ok) {
            setEditing(null); setPreview(null); load(path)
            showToast(t('savedToast') + editing.name, 'success')
          } else {
            if (noteAuth(r)) return
            setError(friendlyErr((r && r.error && r.error.message) || 'save failed', r && r.error && r.error.code))
          }
        }).catch((e) => setError(friendlyErr(String(e))))
      }

      const upload = (file) => {
        if (!file) return
        // Read the RAW bytes so non-UTF-8 uploads (UTF-16 BOM, GBK/ANSI byte
        // sequences) can be rejected BEFORE they write; file.text() would have
        // already mangled them into replacement chars. A UTF-8 BOM is kept.
        file.arrayBuffer().then((buf) => {
          const bytes = new Uint8Array(buf)
          if (encHasUtf16Bom(bytes) || !encValidUtf8(bytes)) {
            const fe = { lock: false, text: t('encNotUtf8') }
            setError(fe)
            showToast('❌ ' + fe.text, 'error')
            return
          }
          let text = new TextDecoder('utf-8').decode(bytes)
          if (encHasUtf8Bom(bytes)) text = '\uFEFF' + text
          rpc('write', { path: join(path, file.name), content: text }).then((r) => {
            if (r && r.ok) { load(path); showToast(t('uploadedToast') + file.name, 'success') }
            else {
              if (noteAuth(r)) return
              setError(friendlyErr((r && r.error && r.error.message) || 'upload failed', r && r.error && r.error.code))
            }
          }).catch((e) => setError(friendlyErr(String(e))))
        }).catch((e) => setError(friendlyErr(String(e))))
      }

      const download = () => {
        if (!preview) return
        const a = document.createElement('a')
        if (preview.kind === 'text') {
          a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(preview.text)
        } else if (preview.kind === 'base64') {
          a.href = 'data:' + mimeOf(preview.name) + ';base64,' + preview.base64
        } else return
        a.download = preview.name
        document.body.appendChild(a)
        a.click()
        a.remove()
      }

      const startSessionHere = () => {
        if (!path || busy) return
        setBusy(true); setError(null)
        rpc('ensureWorkspace', { path }).then((r) => {
          if (r && r.ok && r.value && r.value.workspaceId) {
            return ctxWorkspaces.connectWorkspace(r.value.workspaceId).then(() => {
              showToast(t('sessionStarted'), 'success')
              if (onClose) onClose()
            }).catch((e2) => {
              const fe = friendlyErr(String(e2))
              setError(fe)
              showToast('❌ ' + fe.text, 'error')
            })
          }
          if (noteAuth(r)) { setBusy(false); return }
          const fe = friendlyErr((r && r.error && r.error.message) || 'failed', r && r.error && r.error.code)
          setError(fe)
          showToast('❌ ' + fe.text, 'error')
        }).catch((e) => {
          const fe = friendlyErr(String(e))
          setError(fe)
          showToast('❌ ' + fe.text, 'error')
        }).then(() => setBusy(false))
      }

      const openWorkspace = (id) => {
        if (busy) return
        setBusy(true)
        Promise.resolve(ctxWorkspaces.connectWorkspace(id)).then(() => {
          showToast(t('wsOpened'), 'success')
          if (onClose) onClose()
        }).catch((e) => {
          showToast('❌ ' + String((e && e.message) || e), 'error')
        }).then(() => setBusy(false))
      }

      const saveAllowed = () => {
        const roots = manageText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
        rpc('setAllowed', { roots }).then((r) => {
          if (r && r.ok) {
            setManaging(false)
            showToast(t('rootsSaved', { n: roots.length }), 'success')
            refresh(null)
          } else {
            if (noteAuth(r)) return
            setError(friendlyErr((r && r.error && r.error.message) || 'save failed', r && r.error && r.error.code))
            showToast(t('saveFailed'), 'error')
          }
        }).catch((e) => {
          setError(friendlyErr(String(e)))
          showToast(t('saveFailed'), 'error')
        })
      }

      const sorted = [...entries].sort((a, b) => {
        const ad = a.type === 'directory' ? 0 : 1
        const bd = b.type === 'directory' ? 0 : 1
        if (ad !== bd) return ad - bd
        return a.name.localeCompare(b.name)
      }).filter((e) => !hideSystem || !SYSTEM_DIRS.has(e.name.toLowerCase()))

      const wsPaths = new Set(wsList.map((w) => normPath(w.path)))
      const currentIsWs = path ? wsPaths.has(normPath(path)) : false

      const isImage = preview && preview.kind === 'base64' && /^(png|jpe?g|webp|gif)$/.test(ext(preview.name))

      const segs = path ? path.split(/[\\/]+/).filter(Boolean) : []
      let acc = ''
      const crumbs = segs.map((seg, i) => {
        acc = i === 0 ? seg : acc + '\\' + seg
        const crumbPath = acc // capture THIS crumb's own prefix (closure bug fix)
        const last = i === segs.length - 1
        return React.createElement('button', { key: i, className: 'remfs-chip' + (last ? ' cur' : ''), onClick: () => { if (!last) load(crumbPath) } }, seg)
      })

      const navBar = React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'remfs-crumb' },
          React.createElement('button', { className: 'remfs-btn', disabled: !parent, onClick: () => parent && load(parent) }, '↑'),
          crumbs
        ),
        React.createElement('div', { className: 'remfs-path' },
          React.createElement('input', { value: inputPath, onChange: (e) => setInputPath(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') load(inputPath) }, placeholder: t('absPath') }),
          React.createElement('button', { className: 'remfs-btn primary', onClick: () => load(inputPath) }, 'Go')
        )
      )

      const listRows = React.createElement('div', { className: 'remfs-list' },
        loading ? React.createElement('div', { className: 'remfs-row' }, t('loading')) :
        sorted.map((e) => {
          const isDir = e.type === 'directory'
          const click = () => {
            if (isDir) load(join(path, e.name))
            else if (tab === 'files') openFile(e.name)
            else { setTab('files'); openFile(e.name) }
          }
          const dim = !isDir && tab !== 'files'
          const isWs = isDir && wsPaths.has(normPath(join(path, e.name)))
          return React.createElement('div', { key: e.name, className: 'remfs-row' + (dim ? ' file-dim' : ''), onClick: click },
            React.createElement('span', null, isDir ? '📁' : '📄'),
            React.createElement('span', { className: 'n' }, e.name),
            isWs ? React.createElement('span', { className: 'remfs-wsbadge' }, t('wsBadge')) : null,
            React.createElement('span', { className: 's' }, fmtSize(e.size))
          )
        })
      )

      const rootsRow = (withTools) => React.createElement('div', { className: 'remfs-roots' },
        allowed.map((r) => React.createElement('button', { key: r, className: 'remfs-chip', onClick: () => load(r) }, r)),
        withTools ? React.createElement('button', { className: 'remfs-manage', onClick: () => setMoreOpen(!moreOpen) }, '⋯') : null
      )

      const moreMenu = moreOpen ? React.createElement('div', { className: 'remfs-moremenu' },
        React.createElement('label', { className: 'remfs-hidebox', title: t('hideSystemTitle') },
          React.createElement('input', { type: 'checkbox', checked: hideSystem, onChange: (e) => setHideSystem(e.target.checked) }),
          t('hideSystem')
        ),
        React.createElement('button', { className: 'remfs-manage', onClick: () => { setMoreOpen(false); setManaging(true); setManageText(allowed.join('\n')) } }, t('manageRoots')),
        React.createElement('button', { className: 'remfs-manage', onClick: () => { setMoreOpen(false); setDevicesOpen(true); loadDevices(); loadPushHealth() } }, t('devMgmt'))
      ) : null

      // 1.3 push delivery line (owner-scoped): push.status only returns the
      // CALLING device's subscriptions, so the line renders only under the
      // device row matching the current credential. Every other device - or an
      // absent/errored push.status op - renders nothing (non-breaking).
      const pushDeliveryLines = (d) => {
        if (!d || !pushHealth || !Array.isArray(pushHealth.subscriptions)) return null
        const mine = getCred()
        if (!mine || String(d.id) !== String(mine.deviceId)) return null
        const prefix = lang === 'zh' ? '推送' : 'Push'
        const lines = []
        for (const sub of pushHealth.subscriptions) {
          const err = sub.lastError || null
          const errAt = Number(sub.lastErrorAt) || 0
          const delAt = Number(sub.lastDeliveredAt) || 0
          let text
          if (err) {
            text = prefix + ': ❌ ' + err + (errAt > 0 ? ' (' + agoLabel(errAt) + ')' : '')
          } else if (delAt > 0) {
            text = prefix + ': ✅ ' + agoLabel(delAt)
          } else {
            text = prefix + (lang === 'zh' ? ': 尚未收到推送' : ': no delivery yet')
          }
          lines.push(React.createElement('div', {
            key: sub.endpoint,
            style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary,#999)', wordBreak: 'break-all', marginTop: 2 },
          }, text))
        }
        return lines.length > 0 ? lines : null
      }

      const devicesPane = devicesOpen ? React.createElement('div', { className: 'remfs-manager' },
        React.createElement('div', null, t('devicesTitle')),
        devices.length === 0 ? React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#999)' } }, t('noDevices')) :
        devices.map((d) => React.createElement('div', { key: d.id, style: { marginBottom: 6 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 } },
            React.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, d.name),
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary,#999)' } }, new Date(d.lastSeen).toLocaleString()),
            React.createElement('button', { className: 'remfs-btn', onClick: () => doRevoke(d.id) }, t('revokeBtn'))
          ),
          pushDeliveryLines(d)
        )),
        React.createElement('label', { className: 'remfs-hidebox', style: { marginTop: 8, borderTop: '1px solid rgba(128,128,128,.25)', paddingTop: 8 }, title: t('pushUnsupported') },
          React.createElement('input', { type: 'checkbox', checked: pushEnabled(), disabled: !pushOk, onChange: (e) => onTogglePush(e.target.checked) }),
          t('pushToggle'),
          pushOk ? null : React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary,#999)', fontSize: 11 } }, ' · ' + t('pushUnsupported')),
          // End-to-end delivery check: a dead push channel (FCM unreachable,
          // stale endpoint) looks exactly like "no events" — this makes it
          // testable at setup time instead of discovered at failure time.
          pushOk && pushEnabled() ? React.createElement('button', {
            className: 'remfs-btn', style: { marginLeft: 8 },
            onClick: (e) => {
              e.preventDefault()
              pocketRpc(conn, 'push.test', {}).then((r) => {
                if (r && r.ok && r.value && r.value.sent > 0) showToast(t('pushTestOk'), 'success')
                else if (r && !r.ok && r.error && r.error.code === 'capability-denied') showToast(t('capDenied'), 'error')
                else if (r && !r.ok && r.error && /no subscription/i.test(r.error.message || '')) showToast(t('pushTestNone'), 'error')
                else showToast(t('pushTestFail') + (r && r.error ? ' [' + r.error.code + '] ' + (r.error.message || '') : ''), 'error')
              }).catch(() => showToast(t('pushTestFail'), 'error'))
            },
          }, t('pushTestBtn')) : null
        ),
        React.createElement('div', { className: 'remfs-tools' },
          React.createElement('button', { className: 'remfs-btn', onClick: () => { setDevicesOpen(false); setMoreOpen(true) } }, t('cancel')),
          React.createElement('button', { className: 'remfs-btn', style: { color: '#e06c6c' }, onClick: doRevokeAll }, t('revokeAllBtn'))
        )
      ) : null

      const errLine = error ? React.createElement('div', { className: 'remfs-err' + (error.lock ? ' lock' : '') }, error.text) : null

      const sessionBody = React.createElement(React.Fragment, null,
        // Push notifications, front and center: a post-pairing prompt card and
        // an always-visible toggle + test button on the home tab (no longer
        // buried in Files → ⋯ → Devices).
        (pushOk ? React.createElement('div', { className: 'remfs-pushbox' },
          pushAsk ? React.createElement('div', { className: 'remfs-pushask' },
            React.createElement('div', { className: 'remfs-pushtitle' }, '🔔 ' + t('pushAskTitle')),
            React.createElement('div', { className: 'remfs-pushhint' }, t('pushAskHint')),
            React.createElement('div', { className: 'remfs-tools' },
              React.createElement('button', { className: 'remfs-btn primary', onClick: () => { setPushAsk(false); onTogglePush(true) } }, t('pushAskYes')),
              React.createElement('button', { className: 'remfs-btn', onClick: () => { setPushAsk(false); declinePush() } }, t('pushAskLater'))
            )
          ) : React.createElement('div', { className: 'remfs-pushrow' },
            React.createElement('span', { className: 'remfs-pushicon' }, '🔔'),
            React.createElement('div', { className: 'remfs-pushinfo' },
              React.createElement('div', { className: 'remfs-pushtitle' }, t('pushToggle')),
              React.createElement('div', { className: 'remfs-pushhint' }, t('pushHint'))
            ),
            React.createElement('div', { className: 'remfs-tools' },
              pushEnabled()
                ? React.createElement('button', { className: 'remfs-btn primary', onClick: () => onTogglePush(false) }, '✓ ' + t('pushOn'))
                : React.createElement('button', { className: 'remfs-btn', onClick: () => onTogglePush(true) }, t('pushOff')),
              pushEnabled() ? React.createElement('button', { className: 'remfs-btn', onClick: () => {
                pocketRpc(conn, 'push.test', {}).then((r) => {
                  if (r && r.ok && r.value && r.value.sent > 0) showToast(t('pushTestOk'), 'success')
                  else if (r && !r.ok && r.error && r.error.code === 'capability-denied') showToast(t('capDenied'), 'error')
                  else if (r && !r.ok && r.error && /no subscription/i.test(r.error.message || '')) showToast(t('pushTestNone'), 'error')
                  else showToast(t('pushTestFail') + (r && r.error ? ' [' + r.error.code + '] ' + (r.error.message || '') : ''), 'error')
                }).catch(() => showToast(t('pushTestFail'), 'error'))
              } }, t('pushTestBtn')) : null
            )
          )
        ) : null),
        React.createElement('div', { className: 'remfs-wssec' },
          React.createElement('span', { className: 'lbl' }, t('wsSection')),
          React.createElement('div', { className: 'remfs-wschips' },
            wsList.length === 0 ? React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#999)' } }, t('wsEmpty')) :
            wsList.map((w) => {
              const a = wsAgg[w.id]
              return React.createElement('button', { key: w.id, className: 'remfs-wschip', onClick: () => openWorkspace(w.id) },
                React.createElement('span', { className: 't' }, w.title || w.path),
                React.createElement('span', { className: 'pt' }, w.path),
                a && a.count > 0
                  ? React.createElement('span', { className: 'pt' + (a.big ? ' warn' : '') },
                      t('wsSessions', { n: a.count, size: fmtSize(a.bytes) }) + (a.big ? ' · ' + t('sessSizeWarn') : ''))
                  : null
              )
            })
          )
        ),
        React.createElement('div', { className: 'remfs-wssec' },
          React.createElement('span', { className: 'lbl' }, t('wsSection2')),
          rootsRow(false)
        ),
        navBar,
        errLine,
        listRows,
        React.createElement('div', { className: 'remfs-go' },
          React.createElement('button', { className: 'remfs-wsbtn', disabled: !path || loading || busy, onClick: startSessionHere }, busy ? t('busy') : (currentIsWs ? t('continueHere') : t('startHere')))
        )
      )

      const filesBody = React.createElement(React.Fragment, null,
        devicesOpen ? devicesPane :
        React.createElement(React.Fragment, null,
          rootsRow(true),
          moreMenu,
          navBar,
          errLine,
          listRows,
          editing ? React.createElement('div', { className: 'remfs-prev' },
          React.createElement('div', null, t('editPrefix') + editing.name),
          React.createElement('textarea', { value: editText, onChange: (e) => setEditText(e.target.value), style: { minHeight: 140, fontFamily: 'monospace', fontSize: 12, width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,.2)', color: 'inherit', border: '1px solid rgba(128,128,128,.3)', borderRadius: 6 } }),
          React.createElement('div', { className: 'remfs-tools' },
            React.createElement('button', { className: 'remfs-btn primary', onClick: saveEdit }, t('save')),
            React.createElement('button', { className: 'remfs-btn', onClick: () => { setEditing(null); setPreview(null) } }, t('cancel'))
          )
        ) :
        preview ? React.createElement('div', { className: 'remfs-prev' },
          React.createElement('div', null,
            React.createElement('b', null, preview.name),
            '  ',
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary,#999)' } }, fmtSize(preview.size))
          ),
          preview.kind === 'text' ? React.createElement('pre', null, preview.text) :
          preview.kind === 'base64' && isImage ? React.createElement('img', { src: 'data:' + mimeOf(preview.name) + ';base64,' + preview.base64, alt: preview.name }) :
          preview.kind === 'too-large' ? React.createElement('div', null, t('tooLarge')) :
          React.createElement('div', null, t('binary')),
          React.createElement('div', { className: 'remfs-tools' },
            React.createElement('button', { className: 'remfs-btn primary', onClick: download }, t('download')),
            preview.kind === 'text' ? React.createElement('button', { className: 'remfs-btn', onClick: () => { setEditing({ path: join(path, preview.name), name: preview.name }); setEditText(preview.text) } }, t('editFile')) : null
          )
        ) : null,
        React.createElement('div', { className: 'remfs-prev', style: { borderTop: 'none', paddingTop: 0, maxHeight: 'none' } },
          React.createElement('label', { className: 'remfs-btn remfs-upload' },
            t('uploadHint'),
            React.createElement('input', { type: 'file', accept: '.txt,.md,.json,.js,.ts,.tsx,.py,.html,.css,.yaml,.yml,.csv,.log,.xml,.sh,.ps1,.ini,.env', style: { display: 'none' }, onChange: (e) => { if (e.target.files && e.target.files[0]) upload(e.target.files[0]); e.target.value = '' } })
          )
        )
        )
      )

      if (!cred) {
        return React.createElement('div', { className: embedded ? 'remfs-block' : 'remfs-panel' },
          React.createElement('div', { className: 'remfs-head' },
            React.createElement('b', null, t('pairTitle')),
            React.createElement('span', { className: 'p' }, ''),
            React.createElement('button', { className: 'remfs-btn', title: lang === 'zh' ? 'English' : '中文', onClick: toggleLang }, t('otherLang')),
            React.createElement('button', { className: 'remfs-btn remfs-close', onClick: onClose }, t('close'))
          ),
          React.createElement('div', { className: 'remfs-body', style: { padding: 12, display: 'flex', flexDirection: 'column', gap: 10 } },
            React.createElement('span', { style: { fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary,#999)' } }, t('pairHint')),
            errLine,
            React.createElement('input', { value: pairCode, onChange: (e) => setPairCode(e.target.value), placeholder: t('pairCode'), style: { background: 'rgba(128,128,128,.15)', border: '1px solid rgba(128,128,128,.3)', borderRadius: 6, color: 'inherit', padding: '9px 10px', fontSize: 15, fontFamily: 'monospace', letterSpacing: 1 } }),
            React.createElement('input', { value: deviceName, onChange: (e) => setDeviceName(e.target.value), placeholder: t('deviceName'), style: { background: 'rgba(128,128,128,.15)', border: '1px solid rgba(128,128,128,.3)', borderRadius: 6, color: 'inherit', padding: '9px 10px', fontSize: 14 } }),
            React.createElement('button', { className: 'remfs-wsbtn', disabled: pairing || !pairCode.trim(), onClick: doPair }, pairing ? t('pairingBtn') : t('pairBtn'))
          )
        )
      }

      return React.createElement('div', { className: embedded ? 'remfs-block' : 'remfs-panel' },
        React.createElement('div', { className: 'remfs-head' },
          React.createElement('b', null, tab === 'session' ? t('headSession') : t('headFiles')),
          React.createElement('span', { className: 'p' }, path || '…'),
          currentIsWs ? React.createElement('span', { className: 'remfs-wsbadge' }, t('wsBadge')) : null,
          React.createElement('button', { className: 'remfs-btn', title: lang === 'zh' ? 'English' : '中文', onClick: toggleLang }, t('otherLang')),
          React.createElement('button', { className: 'remfs-btn remfs-close', onClick: onClose }, t('close'))
        ),
        (selectorAudit.done && selectorAudit.allMissing)
          ? React.createElement('div', { className: 'remfs-drift' }, t('upstreamDrift'))
          : null,
        React.createElement('div', { className: 'remfs-tabs' },
          React.createElement('button', { className: 'remfs-tab' + (tab === 'session' ? ' on' : ''), onClick: () => setTab('session') }, t('tabSession')),
          React.createElement('button', { className: 'remfs-tab' + (tab === 'files' ? ' on' : ''), onClick: () => setTab('files') }, t('tabFiles'))
        ),
        managing ? React.createElement('div', { className: 'remfs-manager' },
          React.createElement('div', null, t('managerTitle')),
          React.createElement('textarea', { value: manageText, onChange: (e) => setManageText(e.target.value), placeholder: t('exampleRoots') }),
          React.createElement('div', { className: 'remfs-tools' },
            React.createElement('button', { className: 'remfs-btn primary', onClick: saveAllowed }, t('save')),
            React.createElement('button', { className: 'remfs-btn', onClick: () => setManaging(false) }, t('cancel'))
          )
        ) :
        React.createElement('div', { className: 'remfs-body' },
          tab === 'session' ? sessionBody : filesBody)
      )
    }

    let open = false
    const listeners = new Set()
    let ctxWorkspaces = null

    const setOpen = (v) => { open = v; listeners.forEach((fn) => fn()) }
    const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

    // Workbench drawer button (Files / Sessions).
    function WorkbenchToggle() {
      const [, force] = React.useState(0)
      React.useEffect(() => subscribe(() => force((n) => n + 1)), [])
      React.useEffect(() => subscribeLang(() => force((n) => n + 1)), [])
      return React.createElement('button', { className: 'remfs-hbtn' + (open ? ' open' : ''), title: open ? t('toggleTitleOpen') : t('headerNew'), onClick: () => setOpen(!open) }, open ? t('close') : t('headerNew'))
    }

    function PresenceBoardToggle() {
      const [, force] = React.useState(0)
      React.useEffect(() => subscribeBoard(() => force((n) => n + 1)), [])
      React.useEffect(() => subscribeLang(() => force((n) => n + 1)), [])
      return React.createElement('button', {
        className: 'remfs-hbtn' + (boardOpen ? ' open' : ''),
        title: t('boardTitle'),
        onClick: () => setBoardOpen(!boardOpen)
      }, t('boardButton'))
    }

    function OverlayBridge({ conn }) {
      const [, force] = React.useState(0)
      React.useEffect(() => subscribe(() => force((n) => n + 1)), [])
      if (!open) return null
      return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'remfs-backdrop', onClick: () => setOpen(false) }),
        React.createElement(Workbench, { embedded: false, onClose: () => setOpen(false), conn })
      )
    }

    let toastEl = null
    let toastDisposer = null
    function showToast(text, kind) {
      if (!toastEl) return
      toastEl.textContent = text
      toastEl.className = 'remfs-toast remfs-toast-show' + (kind === 'error' ? ' remfs-toast-error' : kind === 'success' ? ' remfs-toast-success' : '')
      if (toastDisposer) { try { toastDisposer() } catch { /* ignore */ } }
      if (window.__remfsTimer && typeof window.__remfsTimer.timeout === 'function') {
        toastDisposer = window.__remfsTimer.timeout(() => {
          if (toastEl) toastEl.className = 'remfs-toast'
        }, 2600)
      } else {
        window.setTimeout(() => {
          if (toastEl) toastEl.className = 'remfs-toast'
        }, 2600)
      }
    }

    const apply = (ctx) => {
      ctxWorkspaces = ctx.get('workspaces') || null
      // Session handoff: ctx.sessions.open(id) selects the EXISTING session
      // (never creates a replacement).
      try { window.__remfsSessionsApi = ctx.get('sessions') || null } catch { window.__remfsSessionsApi = null }
      // Notification deep-link: a push click stashed the target session id in
      // the Cache-API flag while this page was closed - open it now, once.
      try { consumePushTarget() } catch { /* ignore */ }
      try { consumeHashTarget() } catch { /* ignore */ }
      const conn = ctx.get('connection')
      if (conn === undefined) return
      const timer = ctx.get('timer')
      window.__remfsTimer = timer

      ctx.effect(() => {
        const st = document.createElement('style')
        st.textContent = CSS
        document.head.appendChild(st)
        return () => st.remove()
      })

      ctx.effect(() => {
        toastEl = document.createElement('div')
        toastEl.className = 'remfs-toast'
        document.body.appendChild(toastEl)
        return () => {
          if (toastEl) { toastEl.remove(); toastEl = null }
          if (toastDisposer) { try { toastDisposer() } catch { /* ignore */ } ; toastDisposer = null }
        }
      })

      ctx.effect(() => {
        const btn = document.createElement('button')
        btn.className = 'remfs-sbar'
        btn.textContent = '☰'
        btn.title = t('sidebarClosed')
        let sbOpen = false
        let dragging = false
        let moved = false
        let sx = 0, sy = 0, ox = 0, oy = 0
        const applyState = () => {
          btn.textContent = sbOpen ? '✕' : '☰'
          btn.title = sbOpen ? t('sidebarOpen') : t('sidebarClosed')
          if (sbOpen) document.documentElement.classList.add('remfs-sidebar-open')
          else document.documentElement.classList.remove('remfs-sidebar-open')
        }
        const onDown = (e) => {
          dragging = true
          moved = false
          sx = e.clientX; sy = e.clientY
          const r = btn.getBoundingClientRect()
          ox = r.left; oy = r.top
          try { btn.setPointerCapture(e.pointerId) } catch { /* ignore */ }
          e.preventDefault()
        }
        const onMove = (e) => {
          if (!dragging) return
          const dx = e.clientX - sx, dy = e.clientY - sy
          if (Math.abs(dx) + Math.abs(dy) > 6) moved = true
          if (moved) {
            const bw = btn.offsetWidth, bh = btn.offsetHeight
            const nx = Math.max(4, Math.min(window.innerWidth - bw - 4, ox + dx))
            const ny = Math.max(4, Math.min(window.innerHeight - bh - 4, oy + dy))
            btn.style.left = nx + 'px'
            btn.style.top = ny + 'px'
            btn.style.right = 'auto'
            btn.style.bottom = 'auto'
          }
        }
        const onUp = () => {
          dragging = false
          if (!moved) { sbOpen = !sbOpen; applyState() }
        }
        btn.addEventListener('pointerdown', onDown)
        btn.addEventListener('pointermove', onMove)
        btn.addEventListener('pointerup', onUp)
        btn.addEventListener('click', (e) => { if (moved) e.preventDefault() })
        document.body.appendChild(btn)
        return () => {
          btn.remove()
          document.documentElement.classList.remove('remfs-sidebar-open')
        }
      })

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'remfs.header', order: 20, label: () => t('slotLabel') },
        () => React.createElement(WorkbenchToggle, null)
      ))

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'remfs.presence.tasks', order: 21, label: () => t('boardTitle') },
        () => React.createElement(PresenceBoardToggle, null)
      ))

      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'remfs.page', order: 60, label: t('slotPageLabel') },
        (props) => React.createElement(Workbench, { embedded: true, conn, onClose: props && typeof props.close === 'function' ? props.close : null })
      ))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'remfs.panel' },
        () => React.createElement(OverlayBridge, { conn })
      ))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'remfs.presence.board' },
        () => React.createElement(PresenceBoardOverlay, { conn })
      ))

      // Web Push: register the service worker once per page; subscription is
      // (re)established when a paired device has push enabled. The resulting
      // registration is shared with the Workbench via __remfsPushReg.
      setupPush(conn).then((r) => {
        if (r && r.reg) { try { window.__remfsPushReg = r.reg } catch { /* ignore */ } }
      })

      // Headless presence-notification poll (page open, permission granted).
      ctx.effect(() => {
        const id = setInterval(() => notifyPresencePoll(conn), 8000)
        notifyPresencePoll(conn)
        return () => clearInterval(id)
      })
    }

    const inject = ['slots', 'connection', 'workspaces', 'sessions']
    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
