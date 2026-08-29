# Presence API v1(冻结契约)

> Phase D — Presence API v1 Freeze。本文档是 `presence` 能力的**权威规范**。
> 契约的机器可读事实源是 `lib/presence/api.js`(版本号、操作名、错误码、DTO
> 校验器);实现必须与之保持一致,测试 `test/presence-api.test.js` 强制执行。

## 1. 版本策略(Frozen as of v1)

| 项 | 承诺 |
|---|---|
| 操作名 | `presence.status`、`presence.tasks` **永不改变** |
| Envelope | 永远是 `{ ok: true, value }` 或 `{ ok: false, error }` |
| `error.code` | **永远是** `ERROR_CODES` 之一(不新增、不删除) |
| 状态模型 | 7 状态 + 优先级顺序**永不改变**(见 §3) |
| DTO 字段 | 已有字段**永不删除/重命名/改类型**;允许**新增**字段(向后兼容) |
| 允许的演进 | v1 内:新增 DTO 字段、新增操作。破坏性变更必须升 v2 |

任何破坏 v1 的行为都是 bug。`apiVersion` 字段由 `presence.status` 返回,客户端
应检查 `engine === 'presence-v1'` 与 `apiVersion === 'v1'` 后再解析。

## 2. 传输与鉴权

- 通道:`/pocket` RPC(`conn.rpc`,authority `trusted-host`)
- `presence.status` / `presence.tasks` 是**只读操作**,允许**不携带设备凭据**
  调用(Orb/任务板渲染在与 GUI 相同的浏览器信任围栏内,DTO 只暴露 GUI
  已显示的信息:标题/状态/摘要)。携带有效凭据时返回设备能力列表。
- 其余任何操作都要求**有效设备凭据**(`deviceId` + `credential`),否则
  `auth-invalid`;安全存储损坏时返回 `store-corrupt`
- (历史上 /pocket 还要求 `cockpit` 设备能力;驾驶舱功能已删除,presence 是
  /pocket 唯一消费者)
- 请求负载统一携带 `deviceId` / `credential` 字段(仅需鉴权的操作)

## 3. 状态模型(design §4,§43)

```
IDLE          — 会话存在,无任务执行
RUNNING       — agent 在工作且最近观察到有意义进展
STALE         — agent 声称在跑、系统存活,但 >= 阈值无有意义进展("可能停滞")
NEEDS_USER    — agent 需要人工输入/审批才能继续
FAILED        — agent 因错误停止且无法自愈(仅已关闭的 turn 可判失败)
DONE          — 当前任务正常完成(可随时间衰减为 IDLE)
DISCONNECTED  — 无法确认 harness/agent 存活(与 STALE 不同:存活与否未知)
```

单 Orb 展示优先级:**NEEDS_USER > FAILED > STALE > RUNNING > DONE > IDLE**。

双心跳(design §5):
- `systemHeartbeatAt` — 系统/会话存活信号(默认 TTL 60s → DISCONNECTED)
- `progressHeartbeatAt` — 最后一次**有意义进展**(重复的相同工具调用/相同错误不推进;
  `assistant/chunk`、`user/message` 等纯活动不推进)

STALE 阈值:允许 10/20/30 分钟(默认 20),非法值 fail-closed 回默认。
STALE 是**可解释的观察事实**,不断言死锁;理由在 `staleReason` 中给出。

## 4. 操作

### 4.1 `presence.status`

请求:`{}`(仅鉴权字段)

响应 `value`:

| 字段 | 类型 | 说明 |
|---|---|---|
| `engine` | string | 恒为 `presence-v1` |
| `apiVersion` | string | 恒为 `v1` |
| `staleMinutes` | number | 当前 STALE 阈值(分钟) |
| `serverTime` | string | ISO 时间戳 |
| `capabilities` | string[] | 设备能力列表 |

示例:

```json
{
  "ok": true,
  "value": {
    "engine": "presence-v1",
    "apiVersion": "v1",
    "staleMinutes": 20,
    "serverTime": "2026-08-17T00:00:00.000Z",
    "capabilities": ["files", "device-admin"]
  }
}
```

### 4.2 `presence.tasks`

请求:`{}`(仅鉴权字段)

响应 `value`:

| 字段 | 类型 | 说明 |
|---|---|---|
| `tasks` | PresenceTaskDTO[] | 全部会话的任务快照,按优先级+更新时间排序 |
| `orb` | PresenceTaskDTO \| null | 最高优先级任务(单 Orb 展示,design §43) |

### 4.3 PresenceTaskDTO

| 字段 | 类型 | 说明 |
|---|---|---|
| `taskId` | string | 任务 id(Phase A: 即 sessionId) |
| `sessionId` | string | 会话 id |
| `workspaceId` | string \| null | 工作区 id |
| `title` | string | 会话标题(缺省 `Untitled`) |
| `state` | string | 上述 7 态之一 |
| `summary` | string | **进展**摘要(不是活动摘要,design §9) |
| `systemHeartbeatAt` | string \| null | ISO;系统心跳 |
| `progressHeartbeatAt` | string \| null | ISO;最后有意义进展 |
| `startedAt` | number | ms 时间戳 |
| `updatedAt` | number | ms 时间戳 |
| `attention` | object \| null | NEEDS_USER 时 `{ kind, summary }` |
| `staleReason` | string[] \| null | STALE 时的可解释事实列表 |
| `sizeBytes` | number | 持久化会话目录在磁盘上的大小(字节;host 无法测量时为 0)。客户端据此展示大小,超过 10MB 提示"建议归档" |

示例:

```json
{
  "taskId": "session-abc",
  "sessionId": "session-abc",
  "workspaceId": "ws-1",
  "title": "Fix the fs layer",
  "state": "STALE",
  "summary": "Agent is responsive, but no progress.",
  "systemHeartbeatAt": "2026-08-17T00:30:00.000Z",
  "progressHeartbeatAt": "2026-08-17T00:05:00.000Z",
  "startedAt": 1786870022000,
  "updatedAt": 1786870200000,
  "attention": null,
  "staleReason": [
    "no meaningful progress for 25m",
    "the same failure has repeated 3 times"
  ],
  "sizeBytes": 4730000
}
```

## 5. 错误码(`ERROR_CODES`)

| code | 触发 |
|---|---|
| `auth-invalid` | 设备凭据无效/未配对 |
| `store-corrupt` | 安全存储损坏(见 `.corrupt-*` 文件) |
| `capability-denied` | **冻结遗留码**:驾驶舱能力门禁已随功能删除,保留在 v1 词汇表(不触发) |
| `bad-request` | 未知操作 |
| `capability-unavailable` | `sessionQuery` 不可用(presence 被禁用) |
| `sessions-unavailable` | 会话查询失败 |

错误 envelope:

```json
{ "ok": false, "error": { "code": "bad-request", "message": "unknown /pocket endpoint: x", "details": {} } }
```

## 6. 消费方约定(design §25)

- Orb / Tasks / Notification **只消费** 上述 DTO,绝不允许从原始事件重推状态
- 客户端先调 `presence.status` 校验 `engine`/`apiVersion`,再调 `presence.tasks`
- 对未知字段宽容(向后兼容);对缺失的必需字段 fail-closed

## 7. 测试与守护

- `test/presence-api.test.js`:版本冻结、DTO 形状、错误码词汇、状态/优先级冻结
- `test/presence.test.js` / `test/presence-ui.test.js`:行为测试(状态机、通知规则)
- `test/dogfood.test.js` + `scripts/dogfood-board.js`:离线 CLI 用**同一套**推导逻辑
- `scripts/dump-session.js`:从持久化日志导出完整对话(compaction 不影响历史)
