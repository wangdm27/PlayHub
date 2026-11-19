// ============ PlayHub 游戏模板：Phaser 3（外壳）+ Planck（物理） ============
// 分层原则（新游戏照此结构）：
//   Phaser   → 渲染 / 输入 / 动画 / 缩放适配（游戏外壳运行时）
//   Planck   → 刚体物理（碰撞/摩擦/CCD），坐标用 PPM=100 换算，见下方说明
//   游戏逻辑 → 本游戏规则（计分/回合/进袋判定）
//   PlayHub SDK → postMessage 协议（game_loading_completed / game_over），平台契约勿动
import Phaser from "phaser";
import { World, Vec2, Circle, Edge, type Body } from "planck";
import { PlayHubSDK } from "@playhub/sdk";

const playhub = new PlayHubSDK(); void playhub.init(); // 宿主通信（无 await，同步完成 target 赋值）

// ============ 常量 ============

const W = 1280, H = 720; // 游戏逻辑分辨率（Phaser Scale.FIT 负责缩放适配）
const radius = 13;       // 球半径（像素，渲染用）

// 物理世界单位缩放：Box2D 按"米"调参（内部默认速度上限 2 单位/步），
// 若 1px = 1 单位，满力 1080px/s 会被钳到 240px/s。
// PPM=100 → 物理 1 单位 = 100px，进物理世界 ÷PPM，出来 ×PPM。
const PPM = 100;
const px = (v: number) => v / PPM; // 像素 → 物理单位
const pu = (v: number) => v * PPM; // 物理单位 → 像素

const POCKET_R = 28; // 进袋判定半径（约为球 2 倍）
// 6 个袋口坐标：4 角 + 上下边中点
const pockets = [
  { x: 70, y: 70 }, { x: 640, y: 54 }, { x: 1210, y: 70 },
  { x: 70, y: 650 }, { x: 640, y: 666 }, { x: 1210, y: 650 },
];

// ============ 旋量层（跟/缩/塞） ============
// Planck 是俯视 2D 引擎：左/右塞（绕竖直轴 ωz，在桌面平面内）直接喂角速度，
// 碰库变向由库边摩擦自然算出；跟/缩杆（垂直桌面轴）2D 引擎表达不了，
// 用"接触点等效速度 s"手动积分模拟，物理结论来自真实台球动力学：
//   接触点速度 u = v + s；滑动摩擦使 u 以 3.5×v 的速率衰减（滑动→纯滚自动转换）
//   缩杆 = 白球撞球后 v≈0 而 s 仍在 → 摩擦把球往回推（真物理回退，非脚本）
const SPIN_UI = { cx: W - 110, cy: 120, r: 40 }; // 击球点选择盘（HUD 右上角）
const SLIDE_A = 180;    // 滑动摩擦减速度 px/s²（真实 ≈ μ·g ≈ 0.2×9.8×100 ≈ 200）
const MAX_SPIN = 0.8;   // 击球点归一化上限（±0.8，避免滑杆失误区）

/** 球色：0 白球，1-7 纯色，8 黑，9-15 条纹（复用 1-7 的色相） */
const PALETTE = ["#f4ca38", "#1e72cf", "#d64b55", "#7a45ba", "#f09531", "#22a96b", "#6b3e26"]; // 黄 蓝红 紫 橙 绿 棕
function ballColor(n: number) {
  if (n === 0) return "#f7f7ee";
  return n === 8 ? "#272a31" : PALETTE[(n - 1) % 7];
}

/** 球的元数据：物理刚体 + Phaser 精灵 + 游戏状态 */
type BallMeta = {
  body: Body;
  sprite: Phaser.GameObjects.Image;
  number: number;
  color: string;
  pocketed: boolean;
  /** 旋量等效接触速度（px/s）：跟/缩杆载体，u = v + spin；左/右塞走 body 角速度 */
  spin: { x: number; y: number };
  /** 视觉滚动角（rad）：平滚时纹理转动，弥补引擎看不到垂直轴滚动 */
  visualRoll: number;
};

// ============ 游戏场景 ============

class PoolScene extends Phaser.Scene {
  // 物理世界与球
  private world!: World;
  private balls: BallMeta[] = [];
  private cueBall!: BallMeta;

  // 输入与回合状态
  private pointer = { x: 0, y: 0, down: false };
  private shot = false;          // 是否有一杆正在滚动
  private score = 0;

  // 击杆动画：松手后杆快速前推的视觉反馈
  private strikeActive = false;
  private strikePull = 0;
  private lastShotAng = 0;

  // 旋量层：击球点选择（跟/缩/塞）
  private spinPt = { x: 0, y: 0 };    // 击球点在盘上的位置（UI 像素，相对盘心）
  private spinDragging = false;       // 正在拖击球点（此按下不触发瞄准）
  private spinLabel!: Phaser.GameObjects.Text;

  // 渲染对象
  private gfx!: Phaser.GameObjects.Graphics;      // 瞄准层（每帧重绘）
  private shadowGfx!: Phaser.GameObjects.Graphics; // 投影层（每帧重绘，球下方）
  private scoreText!: Phaser.GameObjects.Text;

  // 固定步长累加器：物理固定 120Hz，不随帧率波动
  private acc = 0;

  constructor() {
    super("pool");
  }

  // ---------- 初始化 ----------

  create() {
    this.buildStaticTable();          // 台面/木框/袋口（静态，画一次）
    this.buildPhysics();              // Planck 世界 + 库边 + 16 球
    this.shadowGfx = this.add.graphics().setDepth(0); // 投影层：球下、台面上
    this.gfx = this.add.graphics();   // 瞄准层置顶
    this.gfx.setDepth(10);
    this.scoreText = this.add.text(92, 36, "Score 0", {
      fontFamily: "sans-serif", fontSize: "24px", fontStyle: "bold", color: "#ffffff",
    }).setOrigin(0, 0.5).setDepth(11);

    // 击球点标签（盘下方）
    this.spinLabel = this.add.text(SPIN_UI.cx, SPIN_UI.cy + SPIN_UI.r + 18, "", {
      fontFamily: "sans-serif", fontSize: "14px", color: "#ffe9a8",
    }).setOrigin(0.5).setDepth(11);

    this.bindInput();
  }

  /** 台面静态视觉：背景 → 木框 → 台面 → 边框线 → 袋口 */
  private buildStaticTable() {
    const g = this.add.graphics().setDepth(-1);
    g.fillStyle(0x07110f);           g.fillRect(0, 0, W, H);
    g.fillStyle(0x9e6b3b);           g.fillRect(46, 30, 1188, 660);
    g.fillStyle(0x1a8165);           g.fillRoundedRect(66, 50, 1148, 620, 18);
    g.lineStyle(10, 0xc59a64, 1);    g.strokeRect(70, 54, 1140, 612);
    // 袋口：洞口视觉半径 25（贴近判定半径 28）+ 深色洞底 + 皮质护圈
    for (const p of pockets) {
      g.fillStyle(0x020403, 1);      g.fillCircle(p.x, p.y, 25);
      g.fillStyle(0x000000, 1);      g.fillCircle(p.x, p.y, 17);
      g.lineStyle(4, 0x5a3a20, 0.9); g.strokeCircle(p.x, p.y, 25);
    }
  }

  /** Planck 物理世界：重力 0（俯视），桌面阻力=线性阻尼，库边=静态 Edge 刚体 */
  private buildPhysics() {
    this.world = new World({ gravity: new Vec2(0, 0) });

    // 库边（静态刚体）：留下袋口缺口；friction 让旋量碰库变向（真实"吃塞"）
    const table = this.world.createBody({ type: "static" });
    const seg = (x1: number, y1: number, x2: number, y2: number) =>
      table.createFixture({
        shape: new Edge(new Vec2(px(x1), px(y1)), new Vec2(px(x2), px(y2))),
        friction: 0.2,
        restitution: 0.85,
      });
    // 上库边（中袋左右两段）/ 下库边 / 左右库边
    seg(96, 54, 614, 54);    seg(666, 54, 1184, 54);
    seg(96, 666, 614, 666);  seg(666, 666, 1184, 666);
    seg(70, 80, 70, 624);    seg(1210, 80, 1210, 624);
    // 袋口后挡墙（防漏袋：把冲进袋口的球导向袋心）
    seg(44, 104, 104, 44);        seg(1176, 44, 1236, 104);
    seg(44, 616, 104, 676);       seg(1176, 676, 1236, 616);
    seg(616, 30, 664, 30);        seg(616, 690, 664, 690);

    // 白球放在左侧开球点
    this.cueBall = this.makeBall(330, 360, 0);

    // 15 颗彩球摆三角形：第 row 排 row+1 颗，8 号固定三角中心
    const rackX = 850, rackY = 360;
    const rackOrder = [1, 2, 3, 4, 8, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
    let rackIdx = 0;
    for (let row = 0; row < 5; row++) {
      for (let c = 0; c <= row; c++) {
        // (c - row/2) 每排纵向居中；row*23 排间横向间距
        this.makeBall(rackX + row * 23, rackY + (c - row / 2) * 26, rackOrder[rackIdx++]);
      }
    }
  }

  /** 创建一颗球：Planck 动态刚体 + Canvas 生成纹理的 Phaser 精灵 */
  private makeBall(x: number, y: number, n: number): BallMeta {
    const key = `ball-${n}`;
    if (!this.textures.exists(key)) this.makeBallTexture(key, n);

    const body = this.world.createBody({
      type: "dynamic",
      position: new Vec2(px(x), px(y)),
      bullet: true,          // CCD 连续碰撞检测：高速球防穿墙/穿球
      linearDamping: 0.6,    // 桌面滚动阻力 ≈ 每秒速度×0.58 的指数衰减
      angularDamping: 1.0,   // 自旋衰减
      allowSleep: true,      // 静止后休眠，省 CPU
    });
    body.createFixture({
      shape: new Circle(px(radius)),
      density: 1,
      friction: 0.05,        // 真实球-球摩擦系数 ≈ 0.05
      restitution: 0.93,     // 真实球-球恢复系数 ≈ 0.93-0.98
    });

    const sprite = this.add.image(x, y, key).setOrigin(0.5).setDepth(1);
    const meta: BallMeta = { body, sprite, number: n, color: ballColor(n), pocketed: false, spin: { x: 0, y: 0 }, visualRoll: 0 };
    this.balls.push(meta);
    return meta;
  }

  /** 用 Canvas 画球纹理（一次生成）：底色/条纹 → 编号 → 球面明暗 → 高光 */
  private makeBallTexture(key: string, n: number) {
    const tex = this.textures.createCanvas(key, radius * 2 + 4, radius * 2 + 4)!;
    const c = tex.getContext();
    const color = ballColor(n);
    c.translate(radius + 2, radius + 2);

    // 底色层：1-8 纯色 / 9-15 白底色带
    if (n >= 9) {
      c.save();
      c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.clip();
      c.fillStyle = "#f7f5e9"; c.fillRect(-radius, -radius, radius * 2, radius * 2);
      c.fillStyle = color;     c.fillRect(-radius, -radius * 0.45, radius * 2, radius * 0.9);
      c.restore();
    } else {
      c.beginPath(); c.fillStyle = color; c.arc(0, 0, radius, 0, Math.PI * 2); c.fill();
    }

    // 编号小白点（画在明暗层下面，让阴影也压在号上 → 更立体）
    if (n > 0) {
      c.beginPath(); c.fillStyle = "#f7f5e9"; c.arc(0, -5, 6, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#151515"; c.font = "bold 8px sans-serif";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(String(n), 0, -5);
    }

    // 球面明暗：径向渐变，左上受光、右下背光（画在最上层把整球压立体）
    const shade = c.createRadialGradient(-radius * 0.45, -radius * 0.5, radius * 0.15, 0, 0, radius * 1.05);
    shade.addColorStop(0, "rgba(255,255,255,0.40)");
    shade.addColorStop(0.5, "rgba(255,255,255,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.30)");
    c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.fillStyle = shade; c.fill();

    // 镜面高光：左上小亮斑
    const hi = c.createRadialGradient(-radius * 0.42, -radius * 0.55, 0, -radius * 0.42, -radius * 0.55, radius * 0.5);
    hi.addColorStop(0, "rgba(255,255,255,0.95)");
    hi.addColorStop(1, "rgba(255,255,255,0)");
    c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.fillStyle = hi; c.fill();

    // 描边收尾
    c.beginPath(); c.strokeStyle = "#eae8da"; c.lineWidth = 1;
    c.arc(0, 0, radius, 0, Math.PI * 2); c.stroke();
    tex.refresh();
  }

  // ---------- 输入 ----------

  private bindInput() {
    // Phaser 指针坐标已是 1280x720 游戏坐标（Scale.FIT 自动换算）
    // 指针监听目标在 game config 里升级到 window（见启动配置），黑边内拖拽不断流
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      // 点在击球盘上 → 进入击球点编辑（此按下不进入瞄准）
      if (Math.hypot(p.worldX - SPIN_UI.cx, p.worldY - SPIN_UI.cy) <= SPIN_UI.r + 8) {
        this.spinDragging = true;
        this.updateSpinPoint(p.worldX, p.worldY);
        return;
      }
      if (this.shot) return;
      this.pointer = { x: p.worldX, y: p.worldY, down: true };
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (this.spinDragging) {
        this.updateSpinPoint(p.worldX, p.worldY);
        return;
      }
      this.pointer.x = p.worldX;
      this.pointer.y = p.worldY;
    });
    this.input.on("pointerup", () => {
      if (this.spinDragging) {
        this.spinDragging = false;
        return;
      }
      this.tryStrike();
    });

    // 切走页面时松手，避免卡在瞄准态
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pointer.down = false;
    });
  }

  /** 拖动击球点：限制在盘心 0.8 半径内（避免滑杆失误区） */
  private updateSpinPoint(wx: number, wy: number) {
    let dx = wx - SPIN_UI.cx, dy = wy - SPIN_UI.cy;
    const d = Math.hypot(dx, dy);
    const max = MAX_SPIN * SPIN_UI.r;
    if (d > max) { dx = dx / d * max; dy = dy / d * max; }
    this.spinPt.x = dx;
    this.spinPt.y = dy;
  }

  /** 松手击球：力度 = 拉离白球距离/7（上限 18），朝反方向发射（拉弹弓） */
  private tryStrike() {
    if (!this.pointer.down || this.shot || this.cueBall.pocketed || this.spinDragging) return;
    this.pointer.down = false;
    const cuePos = this.cueBall.body.getPosition();
    const dx = pu(cuePos.x) - this.pointer.x, dy = pu(cuePos.y) - this.pointer.y;
    const power = Math.min(18, Math.hypot(dx, dy) / 7);
    if (power <= 1) return;

    const a = Math.atan2(dy, dx);
    this.lastShotAng = a;
    const ux = Math.cos(a), uy = Math.sin(a);

    // 注入旋量：
    //   纵向偏移 f（上=跟杆 +f，下=缩杆 −f）→ 接触点等效速度 s = −f·|v|·方向
    //   横向偏移 e（右=右塞 +e，左=左塞 −e）→ body 角速度 ωz（引擎碰库自然变向）
    const e = this.spinPt.x / SPIN_UI.r;
    const f = -this.spinPt.y / SPIN_UI.r;
    const v0 = power * 60; // px/s
    this.cueBall.spin.x = -f * v0 * ux;
    this.cueBall.spin.y = -f * v0 * uy;
    this.cueBall.body.setAwake(true);
    this.cueBall.body.setAngularVelocity(e * 30 * (power / 18)); // 满力满塞 ≈ 30 rad/s
    // 1 px/帧 = 60 px/s = 60/PPM 物理单位/s；满力 18 → 1080px/s → 10.8 单位/s
    this.cueBall.body.setLinearVelocity(
      new Vec2(ux * power * 60 / PPM, uy * power * 60 / PPM),
    );
    this.shot = true;

    // 击杆动画：拉距快速归位（杆头顶到球）后消失，纯视觉，物理已生效
    this.strikeActive = true;
    this.strikePull = Math.min(50, (Math.hypot(dx, dy) / 7) * 2.5);
    this.tweens.addCounter({
      from: this.strikePull,
      to: -4,
      duration: 110,
      ease: "Cubic.easeIn",
      onUpdate: t => { this.strikePull = t.getValue() ?? 0; },
      onComplete: () => { this.strikeActive = false; this.strikePull = 0; },
    });
  }

  // ---------- 物理步进与游戏规则 ----------

  /** 固定 1/120s 调一次：引擎求解碰撞，这里做旋量积分/进袋判定/回合结束检测 */
  private step(dt: number) {
    this.integrateSpin(dt);    // 旋量层：先手动积分（跟/缩杆），引擎再求解碰撞
    this.world.step(dt, 8, 3); // 8 次速度迭代 + 3 次位置迭代（Box2D 精确迭代参数）

    // 进袋判定：引擎负责"到袋口之前"的一切运动，进袋仍用距离判定
    for (const m of this.balls) {
      if (m.pocketed) continue;
      const pos = m.body.getPosition();
      for (const p of pockets) {
        if (Math.hypot(pu(pos.x) - p.x, pu(pos.y) - p.y) < POCKET_R) {
          this.captureBall(m);
          break;
        }
      }
    }

    // 一杆打完（全部球近乎静止）→ 通知宿主平台游戏结束与得分
    if (this.shot) {
      const allStill = this.balls.every(m =>
        m.pocketed ||
        (m.body.getLinearVelocity().length() < px(4) && Math.abs(m.body.getAngularVelocity()) < 0.2)
      );
      if (allStill) {
        this.shot = false;
        playhub.gameOver({ score: this.score });
      }
    }
  }

  /**
   * 旋量层积分（跟/缩杆）：手动模拟 2D 引擎表达不了的垂直轴旋转
   * 每步：u = v + s；摩擦让 u 以 3.5×v 的速率衰减（真实结论：
   * dv/dt = −a·û，ds/dt = −2.5a·û，合计 |u| 衰减 3.5a）
   * 收敛后 s 置零 = 进入纯滚动；缩杆回退 = 撞球后 v≈0 而 s 仍在，
   * u = s 反向 → 摩擦沿 −û 推球倒退（物理回退，非脚本）
   */
  private integrateSpin(dt: number) {
    for (const m of this.balls) {
      if (m.pocketed) continue;
      const s = m.spin;
      if (s.x === 0 && s.y === 0) continue;
      if (!m.body.isAwake()) { m.spin.x = 0; m.spin.y = 0; continue; }

      const vel = m.body.getLinearVelocity();
      const v = { x: pu(vel.x), y: pu(vel.y) };
      const u = { x: v.x + s.x, y: v.y + s.y };
      const um = Math.hypot(u.x, u.y);
      if (um < 2) { // |u| 足够小 → 已进入纯滚动，丢弃残余旋量
        m.spin.x = 0; m.spin.y = 0;
        continue;
      }
      const axn = u.x / um, ayn = u.y / um; // 滑动摩擦方向（−û）
      const d = SLIDE_A * dt;
      const nvx = v.x - axn * d, nvy = v.y - ayn * d; // v 衰减 a
      // s 衰减 2.5a（合计 u 衰减 3.5a）；过冲则收敛置零
      let nsx = s.x - axn * d * 2.5, nsy = s.y - ayn * d * 2.5;
      const u2x = nvx + nsx, u2y = nvy + nsy;
      if (u2x * u.x + u2y * u.y <= 0) {
        m.spin.x = 0; m.spin.y = 0;
      } else {
        m.spin.x = nsx; m.spin.y = nsy;
      }
      m.body.setLinearVelocity(new Vec2(px(nvx), px(nvy)));
    }
  }

  /** 球进袋：彩球缩小消失并计分，白球重置回开球点 */
  private captureBall(m: BallMeta) {
    m.pocketed = true;
    m.body.setLinearVelocity(new Vec2(0, 0));
    m.body.setAngularVelocity(0);
    m.body.setActive(false); // 从物理世界摘除（不再参与碰撞）
    if (m.number === 0) {
      // 白球进袋 → 重置回开球点，继续用（旋量也清零）
      m.body.setPosition(new Vec2(px(330), px(360)));
      m.body.setActive(true);
      m.pocketed = false;
      m.spin.x = 0; m.spin.y = 0;
      m.body.setAngularVelocity(0);
      m.sprite.setPosition(330, 360).setVisible(true).setAlpha(1).setScale(1);
    } else {
      // 彩球计分：8 号 50 分，其余 10 分；精灵缩小淡出动画
      this.score += m.number === 8 ? 50 : 10;
      this.scoreText.setText(`Score ${this.score}`);
      this.tweens.add({
        targets: m.sprite,
        scale: 0.35, alpha: 0,
        duration: 150,
        onComplete: () => m.sprite.setVisible(false),
      });
    }
  }

  // ---------- 主循环 ----------

  update(_time: number, delta: number) {
    const dt = Math.min(0.033, delta / 1000); // 单帧上限 33ms，防切页回来跳变
    this.acc += dt;
    while (this.acc >= 1 / 120) {
      this.step(1 / 120);
      this.acc -= 1 / 120;
    }
    this.syncSprites(dt);
    this.drawAim();
  }

  /** 每帧：滚动角累积 + 物理位置/角度同步到精灵 + 画投影 */
  private syncSprites(dt: number) {
    this.shadowGfx.clear();
    this.shadowGfx.fillStyle(0x000000, 0.28);
    for (const m of this.balls) {
      if (m.pocketed) continue;
      const pos = m.body.getPosition();
      const x = pu(pos.x), y = pu(pos.y);
      // 视觉滚动：平滚距离/半径 累积旋转角（引擎只看得见 ωz 自旋，垂直轴滚动补视觉）
      const vel = m.body.getLinearVelocity();
      m.visualRoll += Math.hypot(pu(vel.x), pu(vel.y)) * dt / radius;
      m.sprite.setPosition(x, y);
      m.sprite.rotation = m.body.getAngle() + m.visualRoll;
      // 投影：光从左上 → 影在右下，扁椭圆
      this.shadowGfx.fillEllipse(x + 3, y + 4.5, radius * 2 - 2, radius * 2 - 5);
    }
  }

  // ---------- 瞄准与球杆渲染（每帧重绘 Graphics） ----------

  private drawAim() {
    const g = this.gfx;
    g.clear();

    // 击球点选择盘（HUD 右上角）：白球面 + 十字线 + 红点 + 效果标签
    const SP = SPIN_UI;
    g.lineStyle(2, 0xffffff, 0.45);
    g.strokeCircle(SP.cx, SP.cy, SP.r);
    g.lineStyle(1, 0xffffff, 0.15);
    g.beginPath(); g.moveTo(SP.cx - SP.r, SP.cy); g.lineTo(SP.cx + SP.r, SP.cy); g.strokePath();
    g.beginPath(); g.moveTo(SP.cx, SP.cy - SP.r); g.lineTo(SP.cx, SP.cy + SP.r); g.strokePath();
    g.fillStyle(0xf7f7ee, 0.9);
    g.fillCircle(SP.cx, SP.cy, SP.r - 2);
    g.fillStyle(0x1a8165, 0.15);
    g.fillCircle(SP.cx, SP.cy, SP.r - 2);
    g.fillStyle(0xd64b55, 1);
    g.fillCircle(SP.cx + this.spinPt.x, SP.cy + this.spinPt.y, 5);
    const f = -this.spinPt.y / SPIN_UI.r, e = this.spinPt.x / SPIN_UI.r;
    let txt = "中杆";
    if (f > 0.15) txt = "跟杆 ↑";
    else if (f < -0.15) txt = "缩杆 ↓";
    if (Math.abs(e) > 0.15) txt += e > 0 ? "  右塞 →" : "  ← 左塞";
    this.spinLabel.setText(txt);

    if (this.cueBall.pocketed) return;
    const cuePosV = this.cueBall.body.getPosition();
    const cue = { x: pu(cuePosV.x), y: pu(cuePosV.y) };

    // 射出方向：拉弓式——拖拽方向是拉杆方向，球往反方向飞
    const aiming = !this.shot;
    const shotAng = aiming
      ? (this.pointer.down
        ? Math.atan2(cue.y - this.pointer.y, cue.x - this.pointer.x)
        : 0)
      : this.lastShotAng; // 击杆动画期间冻结方向
    const drag = Math.hypot(this.pointer.x - cue.x, this.pointer.y - cue.y);

    // 瞄准虚线：沿射出方向，长度随拉距变长（仅在瞄准态画）
    if (aiming) {
      const aimLen = this.pointer.down ? Math.min(220, Math.max(60, drag)) : 180;
      const ux = Math.cos(shotAng), uy = Math.sin(shotAng);
      g.lineStyle(2, 0xffffff, 0.55);
      // 手动虚线：20px 一个周期（10 实 10 空）
      for (let t0 = 0; t0 < aimLen; t0 += 20) {
        const t1 = Math.min(t0 + 10, aimLen);
        g.beginPath();
        g.moveTo(cue.x + ux * t0, cue.y + uy * t0);
        g.lineTo(cue.x + ux * t1, cue.y + uy * t1);
        g.strokePath();
      }
    }

    // 球杆：摆在射出方向的反侧（指针一侧），杆头顶着白球
    // 只在瞄准态或击杆动画期间绘制；拉杆距离随拖拽力度增大 → 力度反馈
    if (!this.shot || this.strikeActive) {
      const pull = this.strikeActive
        ? this.strikePull
        : (this.pointer.down ? Math.min(50, (drag / 7) * 2.5) : 10);
      const tipDist = radius + 5 + pull; // 杆头距球心（负 pull = 顶到球上）
      const buttDist = tipDist + 230;    // 杆尾
      const ux = Math.cos(shotAng), uy = Math.sin(shotAng);
      const tipX = cue.x - ux * tipDist, tipY = cue.y - uy * tipDist;
      const midX = cue.x - ux * (tipDist + 140), midY = cue.y - uy * (tipDist + 140);
      const buttX = cue.x - ux * buttDist, buttY = cue.y - uy * buttDist;
      g.lineStyle(6, 0xd9b98a, 1);  // 前段：浅色杆身
      g.beginPath(); g.moveTo(tipX, tipY); g.lineTo(midX, midY); g.strokePath();
      g.lineStyle(8, 0x4a2c14, 1);  // 后段：深色握把
      g.beginPath(); g.moveTo(midX, midY); g.lineTo(buttX, buttY); g.strokePath();
      g.fillStyle(0x7fb3d5, 1);     // 皮头：蓝色圆点
      g.fillCircle(tipX, tipY, 3);
    }
  }
}

// ============ 启动 ============

new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  parent: "app",
  backgroundColor: "#07110f",
  scale: {
    mode: Phaser.Scale.FIT,            // 等比缩放铺满容器，替代手写 resize/dpr
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    // 指针监听挂到整个窗口：Scale.FIT 的黑边不是画布，
    // 默认只听 canvas 时拖出画布事件断流（拉杆冻住、使不上劲）
    mouse: { target: window },
    touch: { target: window },
  },
  scene: PoolScene,
});

// 通知宿主平台：游戏加载完成（SDK 契约，勿动）
playhub.loadingComplete();
