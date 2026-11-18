# PlayHub 游戏模板

新游戏照此结构开仓。参考实现：`games/pool-game/`（Phaser 3 + Planck 台球）。

## 分层架构（铁律）

```
┌─ Phaser 3 ──────── 游戏外壳：渲染/输入/缩放/动画/音频
├─ 物理引擎（可选）── pool-game 用 Planck.js；简单游戏可不用引擎
├─ 游戏逻辑 ──────── 本游戏规则：计分/回合/胜负/进袋判定
└─ PlayHub SDK ──── postMessage 协议，平台契约，勿动
```

**原则：物理和游戏逻辑不进 Phaser 对象体系**（不继承 Phaser 物理类，
自定义逻辑放自己 class / 闭包，Phaser 只当外壳运行时）。
换游戏时只换中间两层，外壳与 SDK 照抄。

## 新游戏开仓步骤

1. 复制 `pool-game/` 为 `games/<新游戏>/`
2. 改 `package.json`：`name` 改 `@playhub/<新游戏>`
3. 改 `manifest.json`：gameId / name / entry / orientation / 分辨率 / sdkVersion
4. 改 `vite.config.ts`：dev 端口**递增分配**（pool-game=5174，下一款 5175，依次+1）
5. `src/main.ts` 换成自己的 Scene；Planck 代码按需保留或删除
6. `Dockerfile` 原样保留（两阶段：node 编译 → nginx 托管 dist）
7. 后端/平台侧注册 gameId，上架

## manifest.json 字段（平台契约）

| 字段 | 说明 |
|---|---|
| gameId | 平台唯一 ID，与后端注册一致 |
| name | 显示名 |
| engine | 引擎标识（"Phaser 3 + Planck"） |
| entry | 入口 HTML（固定 index.html） |
| orientation | landscape / portrait |
| width / height | 逻辑分辨率 |
| sdkVersion | SDK 协议版本，协议变更时递增 |

## SDK 消息契约（勿动签名）

每条消息：`{ source: "playhub-game", sdkVersion, type, data }`

| type | 时机 | data |
|→ game_loading_completed | 游戏可玩后 | `{}` |
|→ game_over | 一杆/一局结束 | `{ score }` |

方向都是游戏 → 签子页面 → `window.parent.postMessage`。平台侧消费逻辑在
`frontend/playhub-sdk`，游戏侧只管发。

## 物理层约定（用 Planck 的游戏遵守）

- 单位换算：进物理世界 `px()` ÷100，出来 `pu()` ×100（Box2D 按米调参，
  1px=1单位会触发内部速度钳制——血泪教训，见 pool-game 注释）
- 球/桌面尺寸落在 Box2D 舒适区间（0.1~10 单位）
- 高速物体 `bullet: true`（CCD 防穿透）
- 固定步长 1/120s 累加器，物理不随帧率漂移（确定性）
- 弹性/摩擦参数用真实值：球球恢复系数 0.93，库边 0.85，呢面摩擦 0.2

## 动画/输入速查（Phaser 侧）

| 需求 | 用法 |
|---|---|
| 等比缩放适配 | `scale: { mode: Phaser.Scale.FIT, autoCenter: CENTER_BOTH }`，替代手写 resize/dpr |
| 精灵纹理 | `textures.createCanvas()` 画一次 → `add.image`；旋转走 `sprite.rotation` |
| 补间动画 | `tweens.add({ targets, ... })` / `tweens.addCounter`（击杆/进袋动画已示例） |
| 指针输入 | `this.input.on("pointerdown/move/up")`，坐标用 `p.worldX/worldY`（FIT 自动换算） |
| 每帧逻辑 | `update(time, delta)` + 固定步长累加器消化物理 |
| 音效（待接） | `this.sound.play()`，Phaser audio manager，音频文件放 `public/` |