# Tailscale ACL 硬化指南

DeepSeek Harness Phone Remote 通过 Tailscale 把电脑的 443/3080 暴露给手机。
Tailscale 的**默认策略是"同 tailnet 全通"**(任何已登录你账号的设备都能访问
你的所有节点)——对"远程桌面"来说过宽。本文给出一个最小 ACL:只允许
**指定的手机设备**访问**这台电脑的 443/3080**,其他设备一律不可达。

> 前提:已在 [admin console](https://login.tailscale.com/admin/acls) 登录你的
> tailnet。改 ACL 会立即生效并**替换默认策略**——请先读完全文再动手。

## 1. 最小 ACL 示例

把 admin console → **Access Controls** 里的内容整体替换为:

```json
{
  "hosts": {
    "desktop": "100.110.86.0"
  },
  "acls": [
    { "action": "accept", "src": ["tag:phone"], "dst": ["desktop:443", "desktop:3080"] },
    { "action": "accept", "src": ["autogroup:self"], "dst": ["*:*"] }
  ],
  "tagOwners": {
    "tag:phone": ["user@example.com"]
  }
}
```

字段说明:

| 字段 | 含义 |
|---|---|
| `hosts.desktop` | 把电脑的 Tailscale IP(上例 `100.110.86.0`,用你 `install.ps1` 打印的真实 IP)映射成好读的名字 |
| `acls[0]` | **唯一**的外访规则:带 `tag:phone` 标签的设备可以访问 `desktop` 的 443(HTTPS Serve)与 3080(HTTP forwarder) |
| `acls[1]` | `autogroup:self` = 每个节点自己总可访问 `*:*`(管理/排障必需,防止把自己锁在门外) |
| `tagOwners` | 谁有资格给设备打 `tag:phone` 标签(换成你的 Tailscale 账号邮箱) |

## 2. 给手机打标签

两种方式任选其一:

- **推荐(管理后台)**:admin console → **Machines** → 找到手机设备 → **Edit
  ACL tags** → 添加 `tag:phone` → Save。
- **命令行**:在手机上执行(Android 需 root / iOS 不适用,建议用管理后台):

  ```sh
  tailscale up --advertise-tags=tag:phone
  ```

> 若 `tagOwners` 未包含你的账号,打标签会被拒绝——先按上面的示例配置
> `tagOwners`,再给手机打标签。

## 3. 替换默认策略后自检

1. **先保底**:改之前确认电脑能 `tailscale ping desktop`(或访问
   `http://127.0.0.1:3080`),并保留一份原策略文本。
2. 替换保存后:
   - 电脑访问自己:`tailscale ssh desktop`(若开过 SSH)或管理后台 —— 由
     `autogroup:self` 保证。
   - 手机访问:`https://<电脑的 ts.net 域名>`(443,serve)与
     `http://100.x.y.z:3080`(3080,forwarder)—— 都应正常。
   - 手机尝试访问电脑的**其他端口**(如 22、3389):必须被拒绝。
3. 若手机连不上:确认手机设备已带 `tag:phone` 且 `tagOwners` 生效;确认
   `hosts.desktop` 的 IP 与 `install.ps1` 打印的一致(Tailscale IP 变了要同步改)。

## 4. 常见问题

| 现象 | 原因/处理 |
|---|---|
| 手机 403 / 连不上 | 手机未打 `tag:phone`,或 ACL 未保存生效 |
| 电脑自己也无法访问某些端口 | 删掉了 `autogroup:self` 规则——必须保留 |
| 其他设备仍能访问 | 默认策略没被替换(ACL 里还残留 `accept *:*`) |
| SSH 突然不可用 | 最小策略未放行 SSH——如需,显式加 `{ "action": "accept", "src": ["tag:phone"], "dst": ["desktop:22"] }` |
| Tailscale IP 变了 | 更新 `hosts.desktop` 并保存;重跑 `install.ps1` 会打印新 IP |

## 5. 与默认策略的关系

Tailscale ACL 是**整体替换**语义:保存后旧策略不再生效。因此上面的最小策略
里 `autogroup:self` 是**必留项**——否则改完自己先失联。若你的 tailnet 还跑着
其他服务,请把它们的访问规则合并进这份策略,而不是加回 `*:*`。
