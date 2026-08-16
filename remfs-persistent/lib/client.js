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
.remfs-away{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(128,128,128,.15)}
.remfs-away .st{font-size:12px;font-weight:600}
.remfs-away.on{background:rgba(74,108,247,.12);border-color:rgba(74,108,247,.4)}
.remfs-away .since{font-size:10px;color:var(--dsw-alias-label-secondary,#999)}
.remfs-sec{padding:8px 12px 2px;font-size:11px;font-weight:700;color:var(--dsw-alias-label-secondary,#999);text-transform:uppercase;letter-spacing:.4px}
.remfs-card{border:1px solid rgba(128,128,128,.2);border-radius:10px;margin:6px 12px;padding:9px 11px;display:flex;flex-direction:column;gap:6px;background:rgba(255,255,255,.02)}
.remfs-card.need{background:rgba(224,108,108,.08);border-color:rgba(224,108,108,.45)}
.remfs-card.fail{border-color:rgba(224,108,108,.4)}
.remfs-card.ok{border-color:rgba(46,125,50,.4)}
.remfs-card .tt{font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px}
.remfs-card .st2{font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
.remfs-card .la{font-size:11px;color:var(--dsw-alias-label-secondary,#999);word-break:break-all}
.remfs-card .delta{display:flex;gap:10px;font-size:10px;color:var(--dsw-alias-label-secondary,#999);flex-wrap:wrap}
.remfs-card .row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.remfs-open{background:transparent;border:1px solid rgba(74,108,247,.6);color:#7d97ff;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:11px;flex:none}
.remfs-open:hover{background:rgba(74,108,247,.15)}
.remfs-hbtn{background:transparent;border:1px solid rgba(128,128,128,.3);border-radius:8px;color:inherit;font-size:13px;height:34px;padding:0 10px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.remfs-hbtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.2))}
.remfs-hbtn.open{border-color:#4a6cf7}
.remfs-manager{padding:10px 12px;border-top:1px solid rgba(128,128,128,.25);display:flex;flex-direction:column;gap:8px}
.remfs-manager textarea{width:100%;box-sizing:border-box;min-height:110px;font-family:monospace;font-size:12px;background:rgba(0,0,0,.2);color:inherit;border:1px solid rgba(128,128,128,.3);border-radius:6px;padding:8px}
.remfs-wssec{padding:8px 12px 4px;display:flex;flex-direction:column;gap:6px}
.remfs-wssec .lbl{font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
.remfs-wschips{display:flex;flex-wrap:wrap;gap:6px}
.remfs-wschip{border:1px solid rgba(74,108,247,.55);border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12px;background:rgba(74,108,247,.12);color:inherit;display:flex;flex-direction:column;gap:1px;align-items:flex-start;max-width:200px}
.remfs-wschip:hover{background:rgba(74,108,247,.2)}
.remfs-wschip .t{font-size:12px}
.remfs-wschip .pt{font-size:10px;color:var(--dsw-alias-label-secondary,#999);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
        tabSession: '＋ 新建会话', tabFiles: '📁 文件浏览', tabCockpit: '🛸 驾驶舱',
        headSession: '新建会话', headFiles: '文件浏览', headCockpit: 'Agent 驾驶舱',
        close: '✕ 关闭', loading: '加载中…',
        awayTitle: '离席状态', awaySince: '已离开', awayStart: '🎒 开始离席', awayStop: '✅ 我回来了',
        awayFor: '离开 {n}', notAway: '在线',
        sinceCheck: '上次查看 {n} 前', sinceLeave: '你离开后 {n}',
        secNeedsYou: '🟠 需要你', secRunning: '🟢 运行中', secFinished: '✅ 已完成', secFailed: '🔴 失败', secIdle: '⚪ 空闲',
        ctaReview: '查看', ctaOpen: '打开', ctaCatchUp: '回顾', ctaInspect: '检查',
        secEmpty: '暂无会话', openSession: '打开', openSessionTitle: '回到原会话',
        runAt: '运行于', finishedAt: '完成于', failedAt: '失败于', lastAction: '最后动作',
        filesChanged: '文件变更', toolCalls: '工具调用', errors: '错误', approvals: '审批',
        awaitingApproval: '等待审批', attentionSummary: 'Agent 正在等待你',
        noCockpitCap: '设备无驾驶舱权限', cockpitLoadFail: '驾驶舱加载失败',
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
        rootOutside: '新增目录必须在已批准目录内——在电脑上编辑 .remfs-roots.json 添加新位置',
        authFailed: '设备未授权,请重新配对'
      },
      en: {
        tabSession: '＋ New Session', tabFiles: '📁 Files', tabCockpit: '🛸 Cockpit',
        headSession: 'New Session', headFiles: 'Files', headCockpit: 'Agent Cockpit',
        close: '✕ Close', loading: 'Loading…',
        awayTitle: 'Away status', awaySince: 'Away since', awayStart: '🎒 Start Away', awayStop: '✅ I\'m back',
        awayFor: 'Away {n}', notAway: 'Online',
        sinceCheck: 'Last checked {n} ago', sinceLeave: 'Since you left · {n}',
        secNeedsYou: '🟠 Needs You', secRunning: '🟢 Running', secFinished: '✅ Finished', secFailed: '🔴 Failed', secIdle: '⚪ Idle',
        ctaReview: 'Review', ctaOpen: 'Open', ctaCatchUp: 'Catch up', ctaInspect: 'Inspect',
        secEmpty: 'No sessions', openSession: 'Open', openSessionTitle: 'Return to the original session',
        runAt: 'Started', finishedAt: 'Finished', failedAt: 'Failed', lastAction: 'Last action',
        filesChanged: 'files changed', toolCalls: 'tool calls', errors: 'errors', approvals: 'approvals',
        awaitingApproval: 'Awaiting approval', attentionSummary: 'Agent is waiting for you',
        noCockpitCap: 'Device lacks cockpit capability', cockpitLoadFail: 'Cockpit failed to load',
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
        rootOutside: 'New roots must stay inside approved roots — edit .remfs-roots.json on the PC to add new locations',
        authFailed: 'Device not authorized — please pair again'
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

    const friendlyErr = (msg, code) => {
      const s = String(msg || '')
      if (code === 'root-outside-approved') return { lock: false, text: t('rootOutside') }
      if (code === 'auth-required' || code === 'auth-invalid') return { lock: true, text: t('authFailed') }
      if (/denied|EACCES|EPERM/i.test(s)) return { lock: true, text: t('lockDenied') }
      if (/allowed|范围|outside/i.test(s)) return { lock: true, text: t('outside') }
      return { lock: false, text: s }
    }

    // ── Pocket Cockpit (v0.3 Phase 1) ──────────────────────────────────────
    // Read-only agent supervision: away mode, session classification, one-tap
    // handoff. RPC goes to /pocket (separate namespace from /remfs). The UI
    // renders ONLY the stable cockpit contract - never DSH internals.
    const pocketRpc = (conn, method, payload) => {
      const c = getCred()
      return conn.rpc.call('/pocket', method, Object.assign({}, payload, c || {}))
    }

    const fmtAway = (sinceIso, nowIso) => {
      try {
        const s = Date.parse(sinceIso)
        const n = nowIso ? Date.parse(nowIso) : Date.now()
        const mins = Math.max(0, Math.floor((n - s) / 60000))
        if (mins < 60) return mins + 'm'
        return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm'
      } catch { return '…' }
    }

    // Attention-first section order (C-老师 design §4, §21): Needs You >
    // Failed > Running > Finished > Idle.
    const SECTION_OF = { NEEDS_ATTENTION: 'need', FAILED: 'fail', RUNNING: 'run', FINISHED: 'ok', IDLE: 'idle' }
    const SECTION_LABEL = { need: 'secNeedsYou', fail: 'secFailed', run: 'secRunning', ok: 'secFinished', idle: 'secIdle' }

    function CockpitPanel({ conn, sessionsApi, onClose }) {
      const [away, setAway] = React.useState(null)
      const [sessions, setSessions] = React.useState([])
      const [lastViewed, setLastViewed] = React.useState(0)
      const [loading, setLoading] = React.useState(true)
      const [err, setErr] = React.useState(null)
      const [busyAway, setBusyAway] = React.useState(false)
      const [menuOpen, setMenuOpen] = React.useState(false)
      const [nowTick, setNowTick] = React.useState(Date.now())

      const refresh = () => {
        pocketRpc(conn, 'cockpit.sessions', {}).then((r) => {
          if (r && r.ok) {
            setSessions((r.value && r.value.sessions) || [])
            setAway({ away: !!r.value.away, awaySince: r.value.awaySince || null })
            setLastViewed(Number(r.value.lastCockpitViewedAt) || 0)
            setErr(null)
          } else if (r && !r.ok && r.error && (r.error.code === 'auth-invalid' || r.error.code === 'auth-required')) {
            // Device credential no longer matches the host store: clear the
            // stale credential so the user can re-pair (the workbench panel
            // shows the pairing form).
            clearCred()
            setErr({ lock: true, text: t('authFailed') })
          } else if (r && !r.ok && r.error && r.error.code === 'capability-denied') {
            setErr(t('noCockpitCap'))
          } else if (r && !r.ok) {
            setErr(t('cockpitLoadFail') + (r.error && r.error.code ? ' (' + r.error.code + ')' : ''))
          }
          setLoading(false)
        }).catch(() => { setLoading(false); setErr(t('cockpitLoadFail')) })
      }
      React.useEffect(() => { refresh() }, [])
      React.useEffect(() => {
        // design §10: opening the cockpit records the automatic last-check
        // anchor, so the delta has a default "since last check" boundary
        pocketRpc(conn, 'cockpit.check', {}).catch(() => { /* best-effort */ })
        const h = setInterval(() => setNowTick(Date.now()), 30000)
        return () => { try { clearInterval(h) } catch { /* ignore */ } }
      }, [])

      const toggleAway = () => {
        if (busyAway) return
        setBusyAway(true)
        const op = away && away.away ? 'cockpit.away.stop' : 'cockpit.away.start'
        pocketRpc(conn, op, {}).then((r) => {
          if (r && r.ok) { setAway({ away: !!r.value.away, awaySince: r.value.awaySince || null }); refresh() }
          else if (r && r.error && r.error.code === 'capability-denied') setErr(t('noCockpitCap'))
          setBusyAway(false)
        }).catch(() => setBusyAway(false))
      }

      const openSession = (id) => {
        try {
          if (sessionsApi && typeof sessionsApi.open === 'function') {
            sessionsApi.open(id) // handoff: select the EXISTING session
            if (onClose) onClose()
          }
        } catch { /* ignore */ }
      }

      const groups = {}
      for (const s of sessions) {
        const key = SECTION_OF[s.status] || 'idle'
        ;(groups[key] = groups[key] || []).push(s)
      }
      const order = ['need', 'fail', 'run', 'ok', 'idle']

      // Heterogeneous cards: each status shows the information that matters
      // for THAT status (design §7) and its own CTA (design §5, §21).
      const card = (s) => {
        const st = s.status
        const delta = s.delta || {}
        const when = s.lastActivityAt ? new Date(s.lastActivityAt).toLocaleTimeString() : ''
        const base = { key: s.sessionId }
        const titleRow = React.createElement('div', { className: 'row' },
          React.createElement('div', { className: 'tt' }, s.title || s.sessionId)
        )
        if (st === 'NEEDS_ATTENTION') {
          const cls = 'remfs-card need'
          return React.createElement('div', Object.assign({ className: cls }, base),
            titleRow,
            React.createElement('div', { className: 'st2' }, '⚠ ' + ((s.attention && s.attention.summary) || t('attentionSummary'))),
            s.lastAction && s.lastAction.summary ? React.createElement('div', { className: 'la' }, s.lastAction.summary) : null,
            React.createElement('div', { className: 'delta' },
              React.createElement('span', null, t('awaitingApproval')),
              when ? React.createElement('span', null, when) : null
            ),
            React.createElement('div', { className: 'row' },
              React.createElement('span', null, ''),
              React.createElement('button', { className: 'remfs-open', title: t('openSessionTitle'), onClick: () => openSession(s.sessionId) }, t('ctaReview'))
            )
          )
        }
        if (st === 'FAILED') {
          const cls = 'remfs-card fail'
          return React.createElement('div', Object.assign({ className: cls }, base),
            titleRow,
            s.lastAction && s.lastAction.summary ? React.createElement('div', { className: 'la' }, t('lastAction') + ': ' + s.lastAction.summary) : null,
            React.createElement('div', { className: 'delta' },
              when ? React.createElement('span', null, t('failedAt') + ' ' + when) : null,
              delta.errors ? React.createElement('span', null, '✗ ' + delta.errors + ' ' + t('errors')) : null
            ),
            React.createElement('div', { className: 'row' },
              React.createElement('span', null, ''),
              React.createElement('button', { className: 'remfs-open', onClick: () => openSession(s.sessionId) }, t('ctaInspect'))
            )
          )
        }
        if (st === 'RUNNING') {
          const cls = 'remfs-card run'
          return React.createElement('div', Object.assign({ className: cls }, base),
            titleRow,
            s.lastAction && s.lastAction.summary ? React.createElement('div', { className: 'la' }, s.lastAction.summary) : null,
            React.createElement('div', { className: 'delta' },
              when ? React.createElement('span', null, t('runAt') + ' ' + when) : null,
              delta.filesChanged ? React.createElement('span', null, '✎ ' + delta.filesChanged + ' ' + t('filesChanged')) : null
            ),
            React.createElement('div', { className: 'row' },
              React.createElement('span', null, ''),
              React.createElement('button', { className: 'remfs-open', onClick: () => openSession(s.sessionId) }, t('ctaOpen'))
            )
          )
        }
        if (st === 'FINISHED') {
          const cls = 'remfs-card ok'
          return React.createElement('div', Object.assign({ className: cls }, base),
            titleRow,
            delta.testsPassed ? React.createElement('div', { className: 'st2' }, '✅ ' + delta.testsPassed + ' ' + t('secFinished')) : null,
            React.createElement('div', { className: 'delta' },
              when ? React.createElement('span', null, t('finishedAt') + ' ' + when) : null,
              delta.filesChanged ? React.createElement('span', null, '✎ ' + delta.filesChanged + ' ' + t('filesChanged')) : null
            ),
            React.createElement('div', { className: 'row' },
              React.createElement('span', null, ''),
              React.createElement('button', { className: 'remfs-open', onClick: () => openSession(s.sessionId) }, t('ctaCatchUp'))
            )
          )
        }
        // IDLE: minimal card, [Open]
        const cls = 'remfs-card'
        return React.createElement('div', Object.assign({ className: cls }, base),
          titleRow,
          React.createElement('div', { className: 'delta' }, when ? React.createElement('span', null, when) : null),
          React.createElement('div', { className: 'row' },
            React.createElement('span', null, ''),
            React.createElement('button', { className: 'remfs-open', onClick: () => openSession(s.sessionId) }, t('ctaOpen'))
          )
        )
      }

      // Header: automatic "since last check" (design §10) + a ⋯ menu holding
      // the optional Away anchor (design §11 - away is NOT the hero button).
      const header = React.createElement('div', { className: 'remfs-away' + (away && away.away ? ' on' : '') },
        React.createElement('div', null,
          React.createElement('div', { className: 'st' },
            away && away.away && away.awaySince
              ? t('sinceLeave', { n: fmtAway(away.awaySince, new Date(nowTick).toISOString()) })
              : lastViewed > 0
                ? t('sinceCheck', { n: fmtAway(new Date(lastViewed).toISOString(), new Date(nowTick).toISOString()) })
                : t('notAway')
          ),
          React.createElement('div', { className: 'since' },
            (away && away.away ? '🛫 ' : '👁 ') + (away && away.away ? t('awaySince') : '')
          )
        ),
        React.createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          menuOpen ? React.createElement(React.Fragment, null,
            React.createElement('button', { className: 'remfs-btn', disabled: busyAway, onClick: toggleAway }, away && away.away ? t('awayStop') : t('awayStart')),
            React.createElement('button', { className: 'remfs-btn', onClick: () => setMenuOpen(false) }, t('cancel'))
          ) : React.createElement('button', { className: 'remfs-btn', onClick: () => setMenuOpen(true) }, '⋯')
        )
      )

      const errText = err ? (typeof err === 'string' ? err : (err && err.text) || String(err)) : null
      const body = err ? React.createElement('div', { className: 'remfs-err' + (err && err.lock ? ' lock' : '') },
        errText,
        err && err.lock ? React.createElement('button', { className: 'remfs-btn', style: { marginTop: 8, display: 'block' }, onClick: () => { setCockpitOpen(false); setOpen(true) } }, t('pairBtn') + ' →') : null
      )
        : loading ? React.createElement('div', { className: 'remfs-row' }, t('loading'))
        : React.createElement(React.Fragment, null,
            header,
            order.map((key) => {
              const items = groups[key] || []
              if (items.length === 0) return null
              return React.createElement(React.Fragment, { key },
                React.createElement('div', { className: 'remfs-sec' }, t(SECTION_LABEL[key])),
                items.map(card)
              )
            }),
            sessions.length === 0 ? React.createElement('div', { className: 'remfs-sec' }, t('secEmpty')) : null
          )

      return React.createElement('div', { className: 'remfs-body' }, body)
    }

    function Workbench({ embedded, onClose, conn }) {
      const [tab, setTab] = React.useState('cockpit')
      const [path, setPath] = React.useState('')
      const [parent, setParent] = React.useState(null)
      const [allowed, setAllowed] = React.useState([])
      const [wsList, setWsList] = React.useState([])
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
        file.text().then((text) => {
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
        React.createElement('button', { className: 'remfs-manage', onClick: () => { setMoreOpen(false); setDevicesOpen(true); loadDevices() } }, t('devMgmt'))
      ) : null

      const devicesPane = devicesOpen ? React.createElement('div', { className: 'remfs-manager' },
        React.createElement('div', null, t('devicesTitle')),
        devices.length === 0 ? React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#999)' } }, t('noDevices')) :
        devices.map((d) => React.createElement('div', { key: d.id, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 } },
          React.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, d.name),
          React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary,#999)' } }, new Date(d.lastSeen).toLocaleString()),
          React.createElement('button', { className: 'remfs-btn', onClick: () => doRevoke(d.id) }, t('revokeBtn'))
        )),
        React.createElement('div', { className: 'remfs-tools' },
          React.createElement('button', { className: 'remfs-btn', onClick: () => { setDevicesOpen(false); setMoreOpen(true) } }, t('cancel')),
          React.createElement('button', { className: 'remfs-btn', style: { color: '#e06c6c' }, onClick: doRevokeAll }, t('revokeAllBtn'))
        )
      ) : null

      const errLine = error ? React.createElement('div', { className: 'remfs-err' + (error.lock ? ' lock' : '') }, error.text) : null

      const sessionBody = React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'remfs-wssec' },
          React.createElement('span', { className: 'lbl' }, t('wsSection')),
          React.createElement('div', { className: 'remfs-wschips' },
            wsList.length === 0 ? React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary,#999)' } }, t('wsEmpty')) :
            wsList.map((w) => React.createElement('button', { key: w.id, className: 'remfs-wschip', onClick: () => openWorkspace(w.id) },
              React.createElement('span', { className: 't' }, w.title || w.path),
              React.createElement('span', { className: 'pt' }, w.path)
            ))
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
        React.createElement('div', { className: 'remfs-tabs' },
          React.createElement('button', { className: 'remfs-tab' + (tab === 'cockpit' ? ' on' : ''), onClick: () => setTab('cockpit') }, t('tabCockpit')),
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
          tab === 'cockpit' ? React.createElement(CockpitPanel, { conn, sessionsApi: window.__remfsSessionsApi, onClose }) :
          tab === 'session' ? sessionBody : filesBody)
      )
    }

    let open = false
    let cockpitOpen = false
    const listeners = new Set()
    const cockpitListeners = new Set()
    let ctxWorkspaces = null

    const setOpen = (v) => { open = v; listeners.forEach((fn) => fn()) }
    const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
    const setCockpitOpen = (v) => { cockpitOpen = v; cockpitListeners.forEach((fn) => fn()) }
    const subscribeCockpit = (fn) => { cockpitListeners.add(fn); return () => cockpitListeners.delete(fn) }

    // C-老师 design §16/§21: Cockpit is its own entry — the header button
    // opens the COCKPIT directly (not the workbench drawer), so the phone's
    // first tap lands on the attention router.
    function HeaderToggle() {
      const [, force] = React.useState(0)
      React.useEffect(() => subscribeCockpit(() => force((n) => n + 1)), [])
      React.useEffect(() => subscribeLang(() => force((n) => n + 1)), [])
      return React.createElement('button', {
        className: 'remfs-hbtn' + (cockpitOpen ? ' open' : ''),
        title: cockpitOpen ? t('toggleTitleOpen') : t('tabCockpit'),
        onClick: () => setCockpitOpen(!cockpitOpen),
      }, cockpitOpen ? t('close') : t('tabCockpit'))
    }

    // Separate drawer button for the workbench (Files / Sessions), so Cockpit
    // and the workbench are independent entries.
    function WorkbenchToggle() {
      const [, force] = React.useState(0)
      React.useEffect(() => subscribe(() => force((n) => n + 1)), [])
      React.useEffect(() => subscribeLang(() => force((n) => n + 1)), [])
      return React.createElement('button', { className: 'remfs-hbtn' + (open ? ' open' : ''), title: open ? t('toggleTitleOpen') : t('headerNew'), onClick: () => setOpen(!open) }, open ? t('close') : t('headerNew'))
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

    // C-老师 design §21: opening the cockpit shows the attention router
    // directly — a dedicated full-panel view, not the workbench drawer.
    function CockpitOverlayBridge({ conn }) {
      const [, force] = React.useState(0)
      React.useEffect(() => subscribeCockpit(() => force((n) => n + 1)), [])
      if (!cockpitOpen) return null
      return React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'remfs-backdrop', onClick: () => setCockpitOpen(false) }),
        React.createElement('div', { className: 'remfs-panel' },
          React.createElement('div', { className: 'remfs-head' },
            React.createElement('b', null, t('headCockpit')),
            React.createElement('span', { className: 'p' }, ''),
            React.createElement('button', { className: 'remfs-btn', title: lang === 'zh' ? 'English' : '中文', onClick: toggleLang }, t('otherLang')),
            React.createElement('button', { className: 'remfs-btn remfs-close', onClick: () => setCockpitOpen(false) }, t('close'))
          ),
          React.createElement(CockpitPanel, { conn, sessionsApi: window.__remfsSessionsApi, onClose: () => setCockpitOpen(false) })
        )
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
      // Pocket Cockpit handoff: ctx.sessions.open(id) selects the EXISTING
      // session (one-tap handoff without creating a replacement).
      try { window.__remfsSessionsApi = ctx.get('sessions') || null } catch { window.__remfsSessionsApi = null }
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
        { name: 'conversation.session.header.utilities', id: 'remfs.cockpit', order: 15, label: () => t('tabCockpit') },
        () => React.createElement(HeaderToggle, null)
      ))

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'remfs.header', order: 20, label: () => t('slotLabel') },
        () => React.createElement(WorkbenchToggle, null)
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
        { name: 'shell.overlay', id: 'remfs.cockpit.panel' },
        () => React.createElement(CockpitOverlayBridge, { conn })
      ))
    }

    const inject = ['slots', 'connection', 'workspaces', 'sessions']
    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
