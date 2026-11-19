# 2026-11-19 SDK 接通 — 审查报告

分支：feature/sdk-wire-up　方案：[2026-11-19-sdk-integration-plan.md](2026-11-19-sdk-integration-plan.md)

## 第一轮（全 diff）

**PASS**，2 条 🟡：

| # | 位置 | 发现 | 处置 |
|---|---|---|---|
| 1 | frontend/playhub-web/components/game-frame.tsx:8 | handler 只认 `data.source`，页面任意脚本能伪造 `game_over`；sandbox 无 `allow-same-origin`，`event.origin` 恒 "null"，不能用作校验 | ✅ 已修（见第二轮） |
| 2 | games/pool-game/src/main.ts:11 | `loadingComplete()` 依赖 SDK `init()` 无 await；SDK 未来加真异步会静默丢消息 | follow-up（改 SDK 源码，方案范围外） |

第一轮确认无误项：两处替换与原信封逐字段等价；`init()` 同步执行时序成立；useEffect deps/cleanup 正确；`id="gameFrame"` 保留（fullscreen-button.tsx 依赖）；全仓无内联协议字面量残留；package-lock.json:768-771 确认 `@playhub/sdk` 为 workspace link 非registry 拉取。

## 第二轮（🟡1 修复后重审）

**PASS**。`event.source !== frameRef.current?.contentWindow` 为 MDN 推荐绑定方式；类型比较合法（`MessageEventSource | null` 与 `Window | null` 有交集）；fail-closed（ref 为 null 时条件恒真直接 return）；无过期闭包；无回归、无文件集扩散。

## 验证记录

| 命令 | 结果 |
|---|---|
| `npm run build -w frontend/playhub-sdk` | exit 0 |
| `npm run build -w games/pool-game` | exit 0（Phaser chunk >500kB 警告为预存现象） |
| `npm run build -w frontend/playhub-web` | exit 0，6 路由全部生成（修复后复跑仍绿） |

人工验收（待用户）：起 dev（web :5173 + game :5174），开 `/play/8-ball-pool`，console 见 `[playhub] game_loading_completed`，打完一杆见 `[playhub] game_over` 含 score；Fullscreen 按钮可用。
