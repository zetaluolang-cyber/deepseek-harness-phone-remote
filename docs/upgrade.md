# 升级检查清单(Upgrade Checklist)

升级 DeepSeek Harness(dsh)或本仓库代码前,按本清单走一遍,避免会话数据损坏、
demo 残留、插件不兼容等问题。

## 0. 升级前备份(必做)

```powershell
# 会话与存储是 dsh 的数据命根:任何升级前先整目录备份
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
robocopy "$env:USERPROFILE\.dsh\sessions"  "$env:USERPROFILE\.dsh\backup-$stamp\sessions"  /E /COPYALL /R:1 /W:1
robocopy "$env:USERPROFILE\.dsh\storages"  "$env:USERPROFILE\.dsh\backup-$stamp\storages"  /E /COPYALL /R:1 /W:1
```

要点:

- `sessions` 目录里是全部会话日志(`session-*/session.jsonl.zstd`),`storages`
  里是 `workspace.json` / `session_projcache.json` 等索引。升级出错时用备份
  整体还原即可。
- 不要只拷单个文件:dsh 在启动时按目录扫描并校验会话,缺了索引会重新生成,
  但**缺了会话日志则历史丢失且无法恢复**。

## 1. 仓库代码测试(本地全量)

在仓库根目录(含 `remfs-persistent`)运行:

```powershell
cd C:\Users\zeta\Documents\dsh-remote\remfs-persistent
node --test
```

- 期望:**全部通过**(当前约 128 个测试)。任何失败都先定位再升级。
- 改过 `.ps1` 时,额外做 PowerShell 语法检查:

```powershell
$errs = $null
[System.Management.Automation.Language.Parser]::ParseFile('install.ps1', [ref]$null, [ref]$errs)
$errs   # 应为空
```

## 2. demo 工具兼容性验证(隔离目录)

demo-presence 脚本默认写**线上 profile**,永远不要直接跑。用隔离目录验证
`--add` / `--clean` 在新 dsh 上仍工作:

```powershell
$env:REMF_DEMO_SESSIONS_ROOT = "$env:TEMP\remfs-demo-check"
node remfs-persistent\scripts\demo-presence.js --add
node remfs-persistent\scripts\demo-presence.js --clean
Remove-Item $env:REMF_DEMO_SESSIONS_ROOT -Recurse -Force
Remove-Item Env:REMF_DEMO_SESSIONS_ROOT
```

- `--add` 应写入 3 个 `demo-presence-*` 会话,`--clean` 应全部移除且不碰其他
  目录。若 dsh 新版本改了持久化格式(header 字段/压缩),这里会暴露。

## 3. 关注 CI 的 real-dsh-smoke-upstream job

仓库 CI 里 `real-dsh-smoke-upstream`(非阻塞)会在每次推送时用上游 `next`
通道的 dsh 跑一次插件真实加载冒烟。**它红不代表失败**(continue-on-error),
但**升级前看它是否变红**:红了说明上游已破坏兼容性,升级 dsh 前先等修复。

## 4. 升级 dsh 本体

```powershell
npx @deepseek-ai/dsh@latest web --version   # 先看当前
npm i -g @deepseek-ai/dsh@latest            # 或按官方说明升级
# 重跑部署,让 launcher / 插件 / 看门狗 / 快捷方式与仓库一致:
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\zeta\Documents\dsh-remote\install.ps1
```

`install.ps1` 幂等:会更新 `start_harness.ps1`、注册/更新看门狗任务、修桌面
快捷方式、重新安装插件到 profile 并确保 loader 行。

## 5. 升级后验证

1. **启动**:`schtasks /run /tn dsh_restart`(或双击桌面快捷方式),确认
   `http://127.0.0.1:3080` 返回 200。
2. **配对**:删除 `%USERPROFILE%\.dsh\remfs-pairing.txt` 由 harness 重新生成,
   或直接重启 harness 拿新码;手机上重新配对一次,确认 `/remfs` 可列目录。
3. **文件通道**:手机浏览/编辑/上传一个 UTF-8 文本文件,确认 BOM 与换行保持
   原样;再试上传一个 GBK 文件,应被拒绝并提示"检测到非 UTF-8 编码"。
4. **会话索引**:打开会话/任务面板,确认旧会话都在、标题正常、无 corrupt
   报错;任务板显示真实会话状态(不是空 Orb)。
5. **看门狗**:等 5 分钟看 `%USERPROFILE%\.dsh\launcher\watchdog.log` 出现
   新的健康行(`OK: our harness (pid ...) owns 127.0.0.1:3080`)。
