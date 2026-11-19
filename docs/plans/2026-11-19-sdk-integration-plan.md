# 2026-11-19 playhub-sdk 接通（game + web 双端消费）

## 背景

`@playhub/sdk` 目前零消费：pool-game 在 main.ts 两处硬编码 postMessage 内联协议，
playhub-web play 页 iframe 无 message 监听。目标：SDK 成为真实被消费的包，消除协议双份。

## 方案（用户已确认）

### 任务 1：pool-game 引入 SDK

- `games/pool-game/package.json` dependencies 加 `"@playhub/sdk": "*"`（npm workspace 解析）
- 根目录 `npm install` 链接 workspace 包
- `games/pool-game/src/main.ts`：
  - 顶部 `import { PlayHubSDK } from "@playhub/sdk"`
  - 模块级单例 `const playhub = new PlayHubSDK(); void playhub.init();`
    （init 无 await，同步完成 target 赋值）
  - 替换 L352-353：`window.parent?.postMessage({...game_over...})` → `playhub.gameOver({ score: this.score })`
  - 替换 L553：`window.parent?.postMessage({...game_loading_completed...})` → `playhub.loadingComplete()`
- 协议信封只存 SDK 一处，删全部内联字面量

### 任务 2：playhub-web play 页加监听

- 新建 `frontend/playhub-web/components/game-frame.tsx`（"use client"）：
  - props：`src` / `title`
  - `useEffect` 挂 `window.addEventListener("message", handler)`
  - handler 校验：`event.data?.source === "playhub-game"`、`sdkVersion` 存在
  - `game_over` → `console.info`（API 无落库端点，注释 TODO）；`game_loading_completed` → 可选状态位
  - cleanup 移除监听
- `app/play/[slug]/page.tsx`：iframe 换成 `<GameFrame src={gameOrigin} title={game.name} />`
  （sandbox/allow 属性原样保留在 GameFrame 内）

### 不做

- 不实现 web→game 下行指令通道
- 不实现 game_over 落库（API 缺端点）
- 不改 sandbox 策略
- 不动 SDK 源码

## 验证

1. `npm run build -w frontend/playhub-sdk`（产物存在，消费方类型可解析）
2. `npm run build -w games/pool-game`（tsc -b + vite build 通过）
3. `npm run build -w frontend/playhub-web`（Next build 通过）
4. 人工：起 dev，玩一杆，浏览器 console 见 game_loading_completed / game_over 消息

## 风险

- pool-game tsconfig `tsc -b` 项目引用对 workspace 包类型解析——npm install 后应正常
- Next build 预存问题与本改动无关，tester 需区分
