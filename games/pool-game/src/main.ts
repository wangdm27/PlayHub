// ============ PlayHub 游戏模板：Phaser 3（外壳）+ Planck（物理） ============
// 分层原则（新游戏照此结构）：
//   Phaser   → 渲染 / 输入 / 动画 / 缩放适配（游戏外壳运行时）
//   Planck   → 刚体物理（碰撞/摩擦/CCD），坐标用 PPM=100 换算，见下方说明
//   游戏逻辑 → 本游戏规则（计分/回合/进袋判定）
//   PlayHub SDK → postMessage 协议（game_loading_completed / game_over），平台契约勿动
import Phaser from "phaser";
import { World, Vec2, Circle, Edge, type Body } from "planck";

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

  // 渲染对象
  private gfx!: Phaser.GameObjects.Graphics; // 瞄准层（每帧重绘）
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
    this.gfx = this.add.graphics();   // 瞄准层置顶
    this.gfx.setDepth(10);
    this.scoreText = this.add.text(92, 36, "Score 0", {
      fontFamily: "sans-serif", fontSize: "24px", fontStyle: "bold", color: "#ffffff",
    }).setOrigin(0, 0.5).setDepth(11);
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

    const sprite = this.add.image(x, y, key).setOrigin(0.5).setDepth(0);
    const meta: BallMeta = { body, sprite, number: n, color: ballColor(n), pocketed: false };
    this.balls.push(meta);
    return meta;
  }

  /** 用 Canvas 画球纹理（一次生成，条纹/编号随 sprite.rotation 旋转） */
  private makeBallTexture(key: string, n: number) {
    const tex = this.textures.createCanvas(key, radius * 2 + 4, radius * 2 + 4)!;
    const c = tex.getContext();
    const color = ballColor(n);
    c.translate(radius + 2, radius + 2);
    if (n >= 9) {
      // 条纹球：裁剪圆形后画白底 + 中部横向色带
      c.save();
      c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.clip();
      c.fillStyle = "#f7f5e9"; c.fillRect(-radius, -radius, radius * 2, radius * 2);
      c.fillStyle = color;     c.fillRect(-radius, -radius * 0.45, radius * 2, radius * 0.9);
      c.restore();
    } else {
      c.beginPath(); c.fillStyle = color; c.arc(0, 0, radius, 0, Math.PI * 2); c.fill();
    }
    c.beginPath(); c.strokeStyle = "#eae8da"; c.lineWidth = 1;
    c.arc(0, 0, radius, 0, Math.PI * 2); c.stroke();
    if (n > 0) {
      c.beginPath(); c.fillStyle = "#f7f5e9"; c.arc(0, -5, 6, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#151515"; c.font = "bold 8px sans-serif";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(String(n), 0, -5);
    }
    tex.refresh();
  }

  // ---------- 输入 ----------

  private bindInput() {
    // Phaser 指针坐标已是 1280x720 游戏坐标（Scale.FIT 自动换算）
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.shot) return;
      this.pointer = { x: p.worldX, y: p.worldY, down: true };
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      this.pointer.x = p.worldX;
      this.pointer.y = p.worldY;
    });
    this.input.on("pointerup", () => this.tryStrike());

    // 切走页面时松手，避免卡在瞄准态
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pointer.down = false;
    });
  }

  /** 松手击球：力度 = 拉离白球距离/7（上限 18），朝反方向发射（拉弹弓） */
  private tryStrike() {
    if (!this.pointer.down || this.shot || this.cueBall.pocketed) return;
    this.pointer.down = false;
    const cuePos = this.cueBall.body.getPosition();
    const dx = pu(cuePos.x) - this.pointer.x, dy = pu(cuePos.y) - this.pointer.y;
    const power = Math.min(18, Math.hypot(dx, dy) / 7);
    if (power <= 1) return;

    const a = Math.atan2(dy, dx);
    this.lastShotAng = a;
    // 1 px/帧 = 60 px/s = 60/PPM 物理单位/s；满力 18 → 1080px/s → 10.8 单位/s
    this.cueBall.body.setAwake(true);
    this.cueBall.body.setLinearVelocity(
      new Vec2(Math.cos(a) * power * 60 / PPM, Math.sin(a) * power * 60 / PPM),
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

  /** 固定 1/120s 调一次：引擎求解碰撞，这里做进袋判定和回合结束检测 */
  private step(dt: number) {
    this.world.step(dt, 8, 3); // 8 次速度迭代 + 3 次位置迭代（Box2D 推荐值）

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
        window.parent?.postMessage(
          { source: "playhub-game", sdkVersion: "1.0.0", type: "game_over", data: { score: this.score } },
          "*",
        );
      }
    }
  }

  /** 球进袋：彩球缩小消失并计分，白球重置回开球点 */
  private captureBall(m: BallMeta) {
    m.pocketed = true;
    m.body.setLinearVelocity(new Vec2(0, 0));
    m.body.setAngularVelocity(0);
    m.body.setActive(false); // 从物理世界摘除（不再参与碰撞）
    if (m.number === 0) {
      // 白球进袋 → 重置回开球点，继续用
      m.body.setPosition(new Vec2(px(330), px(360)));
      m.body.setActive(true);
      m.pocketed = false;
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
    this.syncSprites();
    this.drawAim();
  }

  /** 每帧把物理刚体的位置/角度同步到精灵 */
  private syncSprites() {
    for (const m of this.balls) {
      if (m.pocketed) continue;
      const pos = m.body.getPosition();
      m.sprite.setPosition(pu(pos.x), pu(pos.y));
      m.sprite.rotation = m.body.getAngle();
    }
  }

  // ---------- 瞄准与球杆渲染（每帧重绘 Graphics） ----------

  private drawAim() {
    const g = this.gfx;
    g.clear();
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
  scene: PoolScene,
});

// 通知宿主平台：游戏加载完成（SDK 契约，勿动）
window.parent?.postMessage({ source: "playhub-game", sdkVersion: "1.0.0", type: "game_loading_completed", data: {} }, "*");
