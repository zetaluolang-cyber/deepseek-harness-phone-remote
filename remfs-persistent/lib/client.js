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
/* Agent Presence floating ball (design §10-11): fixed over the page,
   draggable. Bright brand-whale badge + state ring + corner state badge +
   text tag — never color-only. */
/* Agent Presence floating ball (design §10-11): fixed over the page,
   draggable. Bright brand-whale badge + state ring + corner state badge +
   text tag — never color-only. Animations: state-colored breathing glow,
   dashed spin ring while RUNNING, bobbing whale, popping badge, fade-up
   peek. All pure CSS; prefers-reduced-motion disables them. */
.remfs-orbwrap{position:fixed;right:16px;bottom:16px;z-index:1500;display:flex;flex-direction:column;align-items:center;gap:4px;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none}
.remfs-orbwrap.drag{cursor:grabbing}
.remfs-orbwrap.quiet{opacity:.72}
.remfs-orbwrap.quiet .remfs-orb-logo{animation:none}
.remfs-orb{width:46px;height:46px;border-radius:50%;border:2px solid rgba(128,128,128,.5);background:linear-gradient(145deg,#7b96ff 0%,#4a6cf7 50%,#2c4bd6 100%);color:#fff;line-height:1;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;box-shadow:0 0 12px var(--orb-glow,rgba(74,108,247,.55)),0 6px 20px rgba(47,79,216,.45);transition:transform .12s, box-shadow .3s;position:relative}
.remfs-orb:hover{transform:scale(1.06)}
.remfs-orb.alert{animation:remfs-glow 1.6s ease-in-out infinite}
.remfs-orb.running::before{content:'';position:absolute;inset:-6px;border-radius:50%;border:2px dashed var(--orb-glow,#4a6cf7);opacity:.65;animation:remfs-spin 7s linear infinite;pointer-events:none}
@keyframes remfs-glow{0%,100%{box-shadow:0 0 8px var(--orb-glow,rgba(74,108,247,.45)),0 6px 20px rgba(47,79,216,.45)}50%{box-shadow:0 0 18px var(--orb-glow,rgba(74,108,247,.85)),0 6px 20px rgba(47,79,216,.5)}}
@keyframes remfs-spin{to{transform:rotate(360deg)}}
@keyframes remfs-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}
@keyframes remfs-pop{from{transform:scale(.3)}to{transform:scale(1)}}
@keyframes remfs-fade-up{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@media (prefers-reduced-motion: reduce){.remfs-orb,.remfs-orb.running::before,.remfs-orb-logo,.remfs-orb-badge,.remfs-peek{animation:none}}
.remfs-orb-logo{width:26px;height:26px;fill:#fff;pointer-events:none}
.remfs-orb.alert .remfs-orb-logo{animation:remfs-bob 2.6s ease-in-out infinite}
.remfs-orb-badge{position:absolute;top:-5px;right:-5px;width:18px;height:18px;border-radius:50%;background:#fff;color:#16181d;font-size:11px;font-weight:800;line-height:1;display:flex;align-items:center;justify-content:center;border:1.5px solid rgba(22,24,29,.18);box-shadow:0 2px 6px rgba(0,0,0,.35);pointer-events:none;animation:remfs-pop .25s cubic-bezier(.2,1.6,.4,1)}
.remfs-orb-tag{font-size:10px;color:var(--dsw-alias-label-primary,#eee);background:rgba(20,20,24,.82);padding:1px 8px;border-radius:999px;pointer-events:none;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.remfs-peek{position:fixed;right:16px;bottom:76px;z-index:1510;width:min(320px,92vw);background:var(--dsw-specific-sidebar-fill,#202024);border:1px solid rgba(128,128,128,.3);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:6px;box-shadow:0 8px 28px rgba(0,0,0,.45);animation:remfs-fade-up .18s ease-out}
.remfs-peek-state{font-size:13px;font-weight:700}
.remfs-peek-title{font-size:13px}
.remfs-peek-summary{font-size:12px;color:var(--dsw-alias-label-secondary,#999)}
.remfs-peek-reasons{font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
.remfs-peek-prog{font-size:11px;color:var(--dsw-alias-label-secondary,#999)}
.remfs-peek-actions{display:flex;gap:8px;margin-top:4px}
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
        orbTitle: 'Agent 状态', orbTasks: '任务', orbOpen: '打开', orbLockedTitle: '配对后可查看任务详情',
        orbPeekTitle: '任务进展', orbLastProg: '上次推进', orbNoTask: '无任务',
        boardTitle: 'Agent 任务', boardNeedsYou: '需要你', boardRunning: '运行中', boardNotStarted: '未开始', boardDone: '已完成', boardFailed: '失败',
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
        rootOutside: '新增目录必须在已批准目录内——在电脑上编辑 .remfs-roots.json 添加新位置',
        authFailed: '设备未授权,请重新配对',
        encNotUtf8: '检测到非 UTF-8 编码,请转为 UTF-8 后重试'
      },
      en: {
        tabSession: '＋ New Session', tabFiles: '📁 Files',
        headSession: 'New Session', headFiles: 'Files',
        close: '✕ Close', loading: 'Loading…',
        orbTitle: 'Agent presence', orbTasks: 'Tasks', orbOpen: 'Open', orbLockedTitle: 'Pair to view task details',
        orbPeekTitle: 'Task progress', orbLastProg: 'Last progress', orbNoTask: 'No tasks',
        boardTitle: 'Agent tasks', boardNeedsYou: 'Needs You', boardRunning: 'Running', boardNotStarted: 'Not Started', boardDone: 'Done', boardFailed: 'Failed',
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
        rootOutside: 'New roots must stay inside approved roots — edit .remfs-roots.json on the PC to add new locations',
        authFailed: 'Device not authorized — please pair again',
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
    const ensurePushSubscription = async (conn, reg) => {
      const cred = getCred()
      if (!cred || !reg) return null
      try {
        let sub = await reg.pushManager.getSubscription()
        if (!sub) {
          const r = await window.fetch('/remfs-push-vapid.json', { cache: 'no-store' }).then((x) => x.json())
          const key = r && r.ok && r.value && r.value.publicKeyB64
          if (!key) return null
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
        }
        const p256dh = sub.getKey('p256dh') ? b64urlFromBytes(sub.getKey('p256dh')) : ''
        const auth = sub.getKey('auth') ? b64urlFromBytes(sub.getKey('auth')) : ''
        if (!p256dh || !auth) return null
        let lang = 'zh'
        try { lang = window.localStorage.getItem('remfs-lang') === 'en' ? 'en' : 'zh' } catch { /* default zh */ }
        return conn.rpc.call('/pocket', 'push.subscribe', {
          deviceId: cred.deviceId, credential: cred.credential, lang,
          subscription: { endpoint: sub.endpoint, keys: { p256dh, auth } },
        })
      } catch { return null }
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
        if (getCred() && pushEnabled()) ensurePushSubscription(conn, reg)
        return { supported: true, reg }
      } catch { return { supported: false } }
    }

    const friendlyErr = (msg, code) => {
      const s = String(msg || '')
      if (code === 'encoding-not-utf8') return { lock: false, text: t('encNotUtf8') }
      if (code === 'root-outside-approved') return { lock: false, text: t('rootOutside') }
      if (code === 'auth-required' || code === 'auth-invalid') return { lock: true, text: t('authFailed') }
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
    const P_NEEDS = 'NEEDS_USER', P_FAILED = 'FAILED', P_STALE = 'STALE', P_RUNNING = 'RUNNING', P_DONE = 'DONE', P_IDLE = 'IDLE', P_DISC = 'DISCONNECTED'
    const P_PRIORITY = { [P_NEEDS]: 0, [P_FAILED]: 1, [P_STALE]: 2, [P_RUNNING]: 3, [P_DONE]: 4, [P_IDLE]: 5, [P_DISC]: 6 }
    const P_LABEL = { [P_IDLE]: { icon: '○', text: 'Idle' }, [P_RUNNING]: { icon: '●', text: 'Running' }, [P_STALE]: { icon: '◐', text: 'Possibly stalled' }, [P_NEEDS]: { icon: '!', text: 'Needs you' }, [P_FAILED]: { icon: '×', text: 'Failed' }, [P_DONE]: { icon: '✓', text: 'Done' }, [P_DISC]: { icon: '?', text: 'Disconnected' } }
    const P_NOTIFY_DEFAULT = { [P_NEEDS]: true, [P_FAILED]: true, [P_DONE]: false, [P_STALE]: false, [P_RUNNING]: false, [P_IDLE]: false, [P_DISC]: false }

    function highestPriorityTaskLocal(tasks) {
      const list = Array.isArray(tasks) ? tasks : []
      if (list.length === 0) return null
      let best = null
      for (const t of list) {
        if (!t) continue
        if (best === null || (P_PRIORITY[t.state] ?? 99) < (P_PRIORITY[best.state] ?? 99)) best = t
      }
      return best
    }
    function orbStateLocal(task) {
      if (!task) return { icon: '○', text: P_LABEL[P_IDLE].text, state: P_IDLE, taskId: null, title: '', summary: '' }
      const label = P_LABEL[task.state] || P_LABEL[P_IDLE]
      return { icon: label.icon, text: label.text, state: task.state, taskId: task.sessionId || task.taskId || null, title: task.title || '', summary: task.summary || '' }
    }
    function quickPeekLocal(task) {
      const orb = orbStateLocal(task)
      const now = Date.now()
      let lastProgressLabel = ''
      if (task && task.progressHeartbeatAt) {
        const p = Date.parse(task.progressHeartbeatAt)
        if (Number.isFinite(p) && p > 0) {
          const mins = Math.max(1, Math.floor((now - p) / 60000))
          lastProgressLabel = mins < 60 ? mins + 'm ago' : Math.floor(mins / 60) + 'h ago'
        }
      }
      return { state: orb.state, icon: orb.icon, text: orb.text, title: orb.title, summary: orb.summary, staleReason: (task && task.staleReason) || [], lastProgressLabel, taskId: orb.taskId }
    }
    function shouldNotifyLocal(state) { return P_NOTIFY_DEFAULT[state] === true }
    function groupTasksLocal(tasks) {
      const groups = { needsUser: [], running: [], notStarted: [], done: [], failed: [] }
      for (const t of Array.isArray(tasks) ? tasks : []) {
        let key = 'notStarted'
        if (t.state === P_NEEDS) key = 'needsUser'
        else if (t.state === P_RUNNING || t.state === P_STALE) key = 'running'
        else if (t.state === P_DONE) key = 'done'
        else if (t.state === P_FAILED) key = 'failed'
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

    // ── Agent Presence (Phase B): Orb + Task Board + notifications ─────────
    // All UI consumes ONLY the presence task DTOs (single source of truth,
    // design §25). Orb / Quick Peek / Board / notification never re-derive
    // state from raw events. The pure logic lives in lib/presence/ui.js and is
    // unit-tested; this file only renders it.

    // Floating ball: fixed over the page, draggable via pointer capture.
    // Drag vs click: any pointer move beyond 4px counts as a drag and
    // suppresses the click (peek toggle).
    //
    // The ball face is the DSH brand whale (official favicon path) on a
    // bright blue gradient, with the presence STATE as: colored ring, corner
    // badge (state icon) and the text tag below — state is never color-only.
    const WHALE_LOGO_PATH = 'M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z'
    function PresenceOrb({ conn, sessionsApi }) {
      const [tasks, setTasks] = React.useState([])
      const [peekOpen, setPeekOpen] = React.useState(false)
      const [notified, setNotified] = React.useState({}) // state-per-session notification dedup
      const [lastOrb, setLastOrb] = React.useState(null)
      const [pos, setPos] = React.useState(() => {
        try {
          const raw = window.localStorage.getItem('remfs-orb-pos')
          if (raw) {
            const p = JSON.parse(raw)
            if (p && typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y }
          }
        } catch { /* ignore */ }
        return null
      }) // {x,y} after drag; null = default corner
      const posRef = React.useRef(null)
      const [firstRun, setFirstRun] = React.useState(() => {
        try { return window.localStorage.getItem('remfs-orb-hint') !== '1' } catch { return false }
      })
      const dragRef = React.useRef(null)
      const draggedRef = React.useRef(false)

      const openSession = (id) => {
        try {
          if (sessionsApi && typeof sessionsApi.open === 'function') { sessionsApi.open(id) }
        } catch { /* ignore */ }
      }

      const refresh = () => {
        pocketRpc(conn, 'presence.tasks', {}).then((r) => {
          if (!(r && r.ok)) return
          const list = (r.value && r.value.tasks) || []
          setTasks(list)
          // notification rules (design §14): NEEDS_USER/FAILED always; DONE
          // off by default; never RUNNING/STALE. Dedup per session+state.
          const seen = {}
          for (const task of list) {
            const key = task.sessionId + ':' + task.state
            if (shouldNotifyLocal(task.state) && !notified[key]) {
              seen[key] = true
              firePresenceNotification(task)
            }
          }
          if (Object.keys(seen).length > 0) {
            setNotified((prev) => Object.assign({}, prev, seen))
          }
          const orb = highestPriorityTaskLocal(list)
          setLastOrb(orb)
        }).catch(() => { /* orb stays as-is on transient errors */ })
      }

      React.useEffect(() => { refresh() }, [])
      React.useEffect(() => {
        // design §39: no aggressive polling; 8s is enough for Phase B proof.
        const h = setInterval(refresh, 8000)
        return () => { try { clearInterval(h) } catch { /* ignore */ } }
      }, [])
      React.useEffect(() => {
        // first-run hint: open the peek once so the ball explains itself.
        if (firstRun) {
          setPeekOpen(true)
          try { window.localStorage.setItem('remfs-orb-hint', '1') } catch { /* ignore */ }
        }
      }, [])

      const onPointerDown = (e) => {
        draggedRef.current = false
        dragRef.current = { x: e.clientX, y: e.clientY }
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      }
      const onPointerMove = (e) => {
        const d = dragRef.current
        if (!d) return
        const dx = e.clientX - d.x
        const dy = e.clientY - d.y
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return
        draggedRef.current = true
        const rect = e.currentTarget.getBoundingClientRect()
        const vw = (window.innerWidth || 0)
        const vh = (window.innerHeight || 0)
        const x = Math.min(Math.max(4, rect.left + dx), Math.max(4, vw - rect.width - 4))
        const y = Math.min(Math.max(4, rect.top + dy), Math.max(4, vh - rect.height - 4))
        const next = { x, y }
        posRef.current = next
        setPos(next)
        d.x = e.clientX
        d.y = e.clientY
      }
      const onPointerUp = () => {
        if (draggedRef.current && posRef.current) {
          try { window.localStorage.setItem('remfs-orb-pos', JSON.stringify(posRef.current)) } catch { /* ignore */ }
        }
        dragRef.current = null
      }

      const orb = orbStateLocal(lastOrb)
      const qp = quickPeekLocal(lastOrb)
      const paired = getCred() !== null
      const orbQuiet = orb.state === P_IDLE || orb.state === P_DONE || orb.state === P_DISC
      const orbAlert = orb.state === P_NEEDS || orb.state === P_FAILED
      const displayTitle = paired ? (qp.title || t('orbNoTask')) : t('orbLockedTitle')
      const displaySummary = paired ? qp.summary : null
      const wrapStyle = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : null
      const peekStyle = pos
        ? { left: Math.max(8, Math.min(pos.x - 160, (window.innerWidth || 0) - 328)), top: Math.max(8, pos.y - 230), right: 'auto', bottom: 'auto' }
        : null

      return React.createElement(React.Fragment, null,
        React.createElement('div', {
          className: 'remfs-orbwrap' + (draggedRef.current ? ' drag' : '') + (orbQuiet ? ' quiet' : ''),
          style: wrapStyle,
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
        },
          React.createElement('button', {
            className: 'remfs-orb' + (orb.state === P_RUNNING ? ' running' : '') + (orbAlert ? ' alert' : ''),
            title: t('orbTitle') + ': ' + orb.text + (paired && orb.title ? ' — ' + orb.title : ''),
            style: { borderColor: orb.color, '--orb-glow': orb.color },
            onClick: () => {
              if (draggedRef.current) { draggedRef.current = false; return }
              setPeekOpen(!peekOpen)
            },
          },
            React.createElement('svg', { className: 'remfs-orb-logo', viewBox: '0 0 50 50', 'aria-hidden': 'true' },
              React.createElement('path', { d: WHALE_LOGO_PATH })
            ),
            React.createElement('span', { key: orb.state, className: 'remfs-orb-badge' }, orb.icon)
          ),
          React.createElement('span', { className: 'remfs-orb-tag' }, orb.text)
        ),
        peekOpen ? React.createElement('div', { className: 'remfs-peek', style: peekStyle },
          React.createElement('div', { className: 'remfs-peek-state', style: { color: orb.color } }, qp.icon + ' ' + qp.text),
          React.createElement('div', {
            className: 'remfs-peek-title',
            style: qp.taskId && paired ? { cursor: 'pointer', color: 'var(--dsw-alias-interactive,#4a6cf7)' } : undefined,
            title: qp.taskId && paired ? t('orbOpen') : undefined,
            onClick: () => { if (qp.taskId && paired) { openSession(qp.taskId); setPeekOpen(false) } }
          }, displayTitle),
          displaySummary ? React.createElement('div', { className: 'remfs-peek-summary' }, displaySummary) : null,
          qp.staleReason && qp.staleReason.length > 0
            ? React.createElement('div', { className: 'remfs-peek-reasons' }, qp.staleReason.map((r, i) => React.createElement('div', { key: i }, '· ' + r)))
            : null,
          qp.lastProgressLabel ? React.createElement('div', { className: 'remfs-peek-prog' }, t('orbLastProg') + ' · ' + qp.lastProgressLabel) : null,
          React.createElement('div', { className: 'remfs-peek-actions' },
            React.createElement('button', { className: 'remfs-btn', onClick: () => { setPeekOpen(false); openBoard() } }, t('orbTasks')),
            React.createElement('button', { className: 'remfs-btn primary', disabled: !qp.taskId, onClick: () => { if (qp.taskId) openSession(qp.taskId); setPeekOpen(false) } }, t('orbOpen'))
          )
        ) : null
      )
    }

    function PresenceBoard({ conn, sessionsApi, onClose, paired }) {
      const [tasks, setTasks] = React.useState([])
      const [loading, setLoading] = React.useState(true)
      const [err, setErr] = React.useState(null)

      const refresh = () => {
        pocketRpc(conn, 'presence.tasks', {}).then((r) => {
          if (r && r.ok) { setTasks((r.value && r.value.tasks) || []); setErr(null) }
          else if (r && !r.ok) setErr(t('boardLoadFail'))
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
            tasks.length === 0 ? React.createElement('div', { className: 'remfs-sec' }, t('boardEmpty')) : null
          )

      return React.createElement('div', { className: 'remfs-panel remfs-board' },
        React.createElement('div', { className: 'remfs-head' },
          React.createElement('b', null, t('boardTitle')),
          React.createElement('span', { className: 'p' }, counts.needsYou + ' need · ' + counts.running + ' run'),
          React.createElement('button', { className: 'remfs-btn remfs-close', onClick: onClose }, t('close'))
        ),
        body
      )
    }

    // Board overlay state: opened from the Orb Quick Peek [Tasks] action.
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

    // Expose board-open to the Orb Quick Peek [Tasks] button.
    const openBoard = () => setBoardOpen(true)

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
      const [pushReg, setPushReg] = React.useState(null)
      const [pushOk, setPushOk] = React.useState(pushSupported())
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
          const doSubscribe = () => { ensurePushSubscription(conn, pushReg).then((r) => { if (r && !r.ok) showToast(t('pushEnableErr'), 'error') }) }
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
        React.createElement('label', { className: 'remfs-hidebox', style: { marginTop: 8, borderTop: '1px solid rgba(128,128,128,.25)', paddingTop: 8 }, title: t('pushUnsupported') },
          React.createElement('input', { type: 'checkbox', checked: pushEnabled(), disabled: !pushOk, onChange: (e) => onTogglePush(e.target.checked) }),
          t('pushToggle'),
          pushOk ? null : React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary,#999)', fontSize: 11 } }, ' · ' + t('pushUnsupported'))
        ),
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

      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'remfs.page', order: 60, label: t('slotPageLabel') },
        (props) => React.createElement(Workbench, { embedded: true, conn, onClose: props && typeof props.close === 'function' ? props.close : null })
      ))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'remfs.panel' },
        () => React.createElement(OverlayBridge, { conn })
      ))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'remfs.presence.orb' },
        () => React.createElement(PresenceOrb, { conn, sessionsApi: window.__remfsSessionsApi })
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
    }

    const inject = ['slots', 'connection', 'workspaces', 'sessions']
    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
