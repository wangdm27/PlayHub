// ============ 物理引擎：Planck.js（Box2D 官方 JS 移植） ============
// 碰撞求解、动量守恒、摩擦、CCD 防穿透全部交给引擎。
// 手写版物理核心保留在下方"手写版物理"注释块中，供对照学习。
import { World, Vec2, Circle, Edge, type Body } from "planck";

// ============ 类型定义 ============

/** 球的元数据：物理刚体 + 视觉信息（位置/速度从 body 实时读） */
type BallMeta = { body: Body; number: number; color: string; pocketed: boolean };

// ============ 画布与全局状态 ============

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;

const W = 1280, H = 720; // 游戏逻辑分辨率（坐标体系固定，显示时缩放铺满）
const radius = 13;       // 球半径（像素，渲染用）
// 物理世界单位缩放：Box2D 按"米"调参（默认速度上限 2 米/步），
// 若 1px = 1 单位，满力 1080px/s 会被钳到 240px/s（力道没了的原因）。
// PPM=100 → 物理 1 单位 = 100px，1080px/s = 10.8 单位/s，远低于上限。
const PPM = 100;
const px = (v: number) => v / PPM; // 像素 → 物理单位
const pu = (v: number) => v * PPM; // 物理单位 → 像素

let dpr = 1;                                   // 设备像素比（渲染清晰度用）
const pointer = { x: 0, y: 0, down: false };   // 指针（鼠标/触摸）当前状态
let shot = false;                              // 是否有一杆正在滚动
let score = 0;                                 // 得分
let cueBall!: BallMeta;                        // 白球（编号 0）

// 6 个袋口坐标：4 角 + 上下边中点
const pockets = [
  { x: 70, y: 70 }, { x: 640, y: 54 }, { x: 1210, y: 70 },
  { x: 70, y: 650 }, { x: 640, y: 666 }, { x: 1210, y: 650 },
];
const POCKET_R = 28; // 进袋判定半径（约为球 2 倍，同手写版）

// ============ Planck 物理世界 ============
// 本项目是俯视 2D 台球：重力设为 0，"桌面摩擦"用线性阻尼模拟，
// 库边反弹能量损失用 restitution 模拟，球间动量交换由求解器精确计算。

const world = new World({ gravity: new Vec2(0, 0) });

// --- 库边（静态刚体）：留下袋口缺口，缺口几何见各段坐标 ---
const table = world.createBody({ type: "static" });
const seg = (x1: number, y1: number, x2: number, y2: number) =>
  table.createFixture({
    shape: new Edge(new Vec2(px(x1), px(y1)), new Vec2(px(x2), px(y2))),
    friction: 0.2,     // 呢面库边摩擦 → 有旋量时碰库会变向（真实"吃塞"）
    restitution: 0.85, // 手写版反弹 ×0.88 对应参数
  });
// 上库边（中袋左右两段）
seg(96, 54, 614, 54);  seg(666, 54, 1184, 54);
// 下库边
seg(96, 666, 614, 666);  seg(666, 666, 1184, 666);
// 左右库边
seg(70, 80, 70, 624);  seg(1210, 80, 1210, 624);
// 袋口后挡墙（防漏袋：斜挡板把冲进袋口的球导向袋心）
seg(44, 104, 104, 44);        // 左上角袋
seg(1176, 44, 1236, 104);     // 右上角袋
seg(44, 616, 104, 676);       // 左下角袋
seg(1176, 676, 1236, 616);    // 右下角袋
seg(616, 30, 664, 30);        // 上中袋
seg(616, 690, 664, 690);      // 下中袋

// ============ 摆球 ============

/** 球色：1-7 纯色，8 黑，9-15 条纹（复用 1-7 的色相） */
const PALETTE = ["#f4ca38", "#1e72cf", "#d64b55", "#7a45ba", "#f09531", "#22a96b", "#6b3e26"]; // 黄 蓝红 紫 橙 绿 棕
function ballColor(n: number) {
  if (n === 0) return "#f7f7ee"; // 白球（迁移时漏了这条，导致白球画成黑球的 bug）
  return n === 8 ? "#272a31" : PALETTE[(n - 1) % 7];
}

/** 在 (x,y) 创建一颗动态刚体球 */
function makeBall(x: number, y: number, n: number): BallMeta {
  const body = world.createBody({
    type: "dynamic",
    position: new Vec2(px(x), px(y)),
    bullet: true,          // CCD 连续碰撞检测：高速球防穿墙/穿球
    linearDamping: 0.6,    // 桌面滚动阻力 ≈ 手写版 0.991^60 ≈ 0.58/s 的指数衰减
    angularDamping: 1.0,   // 自旋衰减
    allowSleep: true,      // 静止后休眠，省 CPU
  });
  body.createFixture({
    shape: new Circle(px(radius)),
    density: 1,
    friction: 0.05,        // 真实球-球摩擦系数 ≈ 0.05（酚醛树脂球）
    restitution: 0.93,     // 真实球-球恢复系数 ≈ 0.93-0.98
  });
  const meta: BallMeta = { body, number: n, color: ballColor(n), pocketed: false };
  balls.push(meta);
  return meta;
}

const balls: BallMeta[] = [];

// 白球放在左侧开球点
cueBall = makeBall(330, 360, 0);

// 15 颗彩球在 (rackX, rackY) 摆三角形：第 row 排 row+1 颗
// 8 号黑球固定在三角中心（第 3 排中间），其余按标准摆球顺序
const rackX = 850, rackY = 360;
const rackOrder = [1, 2, 3, 4, 8, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
let rackIdx = 0;
for (let row = 0; row < 5; row++) {
  for (let c = 0; c <= row; c++) {
    // (c - row/2) 让每排纵向居中；row*23 是排间横向间距
    makeBall(rackX + row * 23, rackY + (c - row / 2) * 26, rackOrder[rackIdx++]);
  }
}

// ============ 手写版物理（对照参考，已停用） ============
// 迁移前的手写物理核心，保留供对比。对应关系：
//   手写摩擦 0.991^(dt*60)           → Planck linearDamping 0.6（同为指数衰减）
//   手写库边反弹 ×0.88               → Planck 库边 restitution 0.85
//   手写弹性碰撞（法线速度分量交换） → Planck 碰撞求解器（还含摩擦、旋转、接触点求解、CCD）
//   手写库边位置夹回                 → Planck 库边 Edge 刚体自动处理
//   手写重叠分离（overlap 各退一半） → Planck position solver（迭代求解，更稳定）
/*
type Ball = { x:number; y:number; vx:number; vy:number; r:number; color:string; number:number; pocketed:boolean };

function inTable(b: Ball) {
  if (b.x < 70 || b.x > 1210 || b.y < 54 || b.y > 666) return false;
  return true;
}

function collide(a: Ball, b: Ball) {
  if (a.pocketed || b.pocketed) return;
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  if (d >= a.r + b.r) return;            // 没接触

  const nx = dx / d, ny = dy / d;        // 碰撞法线（单位向量）
  const overlap = a.r + b.r - d;
  a.x -= nx * overlap / 2; a.y -= ny * overlap / 2; // 各退一半消除重叠
  b.x += nx * overlap / 2; b.y += ny * overlap / 2;

  const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
  const vel = rvx * nx + rvy * ny;       // 相对速度在法线上的投影
  if (vel > 0) return;                   // 正在分离，不用处理
  a.vx += vel * nx; a.vy += vel * ny;    // 交换法线方向的速度分量
  b.vx -= vel * nx; b.vy -= vel * ny;
}

function step(dt: number) {
  let moving = false;

  for (const b of balls) {
    if (b.pocketed) continue;

    // 摩擦：速度按 0.991^帧数 衰减；低于 0.025 视为静止
    b.vx *= Math.pow(.991, dt * 60);
    b.vy *= Math.pow(.991, dt * 60);
    if (Math.hypot(b.vx, b.vy) < .025) {
      b.vx = 0; b.vy = 0;
    } else {
      moving = true;
    }
    b.x += b.vx * dt * 60;
    b.y += b.vy * dt * 60;

    // 库边反弹：位置夹回 + 法向速度反向并损失 12%（×0.88）
    if (b.x - b.r < 70 && inTable(b)) {
      b.x = 70 + b.r;
      b.vx = Math.abs(b.vx) * .88;
    } else if (b.x + b.r > 1210 && inTable(b)) {
      b.x = 1210 - b.r;
      b.vx = -Math.abs(b.vx) * .88;
    }
    if (b.y - b.r < 54 && b.x > 65 && b.x < 1215) {
      b.y = 54 + b.r;
      b.vy = Math.abs(b.vy) * .88;
    } else if (b.y + b.r > 666 && b.x > 65 && b.x < 1215) {
      b.y = 666 - b.r;
      b.vy = -Math.abs(b.vy) * .88;
    }

    // 进袋判定：距任一袋心 < 28（约为球半径 2 倍）
    for (const p of pockets) {
      if (Math.hypot(b.x - p.x, b.y - p.y) < 28) {
        b.pocketed = true;
        b.vx = b.vy = 0;
        if (b.number === 0) {
          // 白球进袋 → 重置回开球点，继续用
          b.x = 330; b.y = 360;
          b.pocketed = false;
        } else {
          // 彩球计分：8 号 50 分，其余 10 分
          score += b.number === 8 ? 50 : 10;
        }
      }
    }
  }

  // 所有球两两做碰撞检测
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      collide(balls[i], balls[j]);
    }
  }

  // 一杆打完（全部球静止）→ 通知宿主平台游戏结束与得分
  if (!moving && shot) {
    shot = false;
    window.parent?.postMessage({ source: "playhub-game", sdkVersion: "1.0.0", type: "game_over", data: { score } }, "*");
  }
}
*/

// ============ 进袋与回合结束（Planck 版） ============

/** 球进入袋口判定圈：彩球移除并计分，白球重置回开球点 */
function captureBall(m: BallMeta) {
  m.pocketed = true;
  m.body.setLinearVelocity(new Vec2(0, 0));
  m.body.setAngularVelocity(0);
  m.body.setActive(false); // 从物理世界摘除（不再参与碰撞）
  if (m.number === 0) {
    // 白球进袋 → 重置回开球点，继续用
    m.body.setPosition(new Vec2(px(330), px(360)));
    m.body.setActive(true);
    m.pocketed = false;
  } else {
    // 彩球计分：8 号 50 分，其余 10 分
    score += m.number === 8 ? 50 : 10;
  }
}

/** 物理步进：固定 1/120s 调用一次 */
function step(dt: number) {
  world.step(dt, 8, 3); // 碰撞求解：8 次速度迭代 + 3 次位置迭代（Box2D 推荐值）

  // 进袋判定：引擎负责"到袋口之前"的一切运动，进袋仍用距离判定
  for (const m of balls) {
    if (m.pocketed) continue;
    const pos = m.body.getPosition();
    for (const p of pockets) {
      // pos 是物理单位 → ×PPM 转回像素再和袋口（像素坐标）比距离
      if (Math.hypot(pu(pos.x) - p.x, pu(pos.y) - p.y) < POCKET_R) {
        captureBall(m);
        break;
      }
    }
  }

  // 一杆打完（全部球近乎静止）→ 通知宿主平台游戏结束与得分
  // 阈值 4px/s（物理单位 0.04）：手写版 0.025px/帧 ≈ 1.5px/s，休眠前自然收敛
  if (shot) {
    const allStill = balls.every(m =>
      m.pocketed ||
      (m.body.getLinearVelocity().length() < px(4) && Math.abs(m.body.getAngularVelocity()) < 0.2)
    );
    if (allStill) {
      shot = false;
      window.parent?.postMessage({ source: "playhub-game", sdkVersion: "1.0.0", type: "game_over", data: { score } }, "*");
    }
  }
}

// ============ 画布自适应 ============

/** 按设备像素比放大画布（上限 2 倍）保证清晰；CSS 铺满容器，逻辑坐标不变 */
function resize() {
  dpr = Math.min(devicePixelRatio, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
addEventListener("resize", resize);

// ============ 输入：拖拽瞄准 ============

/** 屏幕坐标 → 游戏坐标（1280x720 体系） */
function pointerPos(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}

// 按下：进入瞄准状态（上一杆没停时不允许）
canvas.addEventListener("pointerdown", e => {
  if (!shot) {
    const pos = pointerPos(e);
    pointer.x = pos.x;
    pointer.y = pos.y;
    pointer.down = true;
    canvas.setPointerCapture(e.pointerId);
  }
});

// 移动：更新瞄准点（不改变按下状态）
canvas.addEventListener("pointermove", e => {
  const pos = pointerPos(e);
  pointer.x = pos.x;
  pointer.y = pos.y;
});

// 松手：击球。力度 = 拉离白球的距离/7（上限 18），朝反方向发射（拉弹弓）
// 手写版直接赋 vx/vy（px/帧）；Planck 版设线速度（物理单位/s）：
// 1 px/帧 = 60 px/s = 60/PPM 单位/s，满力 18 → 1080px/s → 10.8 单位/s
canvas.addEventListener("pointerup", () => {
  if (!pointer.down || shot) return;
  pointer.down = false;
  if (cueBall.pocketed) return;
  const cuePos = cueBall.body.getPosition();
  const dx = pu(cuePos.x) - pointer.x, dy = pu(cuePos.y) - pointer.y;
  const power = Math.min(18, Math.hypot(dx, dy) / 7);
  if (power > 1) {
    const a = Math.atan2(dy, dx);
    cueBall.body.setAwake(true);
    cueBall.body.setLinearVelocity(new Vec2(Math.cos(a) * power * 60 / PPM, Math.sin(a) * power * 60 / PPM));
    shot = true;
  }
});

// 切走页面时松手，避免卡在瞄准态
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pointer.down = false;
});

// ============ 主循环（固定步长累加器） ============

// 屏幕 60fps，物理固定 120Hz：把每帧真实耗时累积，
// 按 1/120s 固定步长消化 → 物理表现不随帧率波动（确定性，联机公平的基础）
let last = performance.now();
let acc = 0;
function loop(now: number) {
  const dt = Math.min(.033, (now - last) / 1000); // 单帧上限 33ms，防切页回来跳变
  last = now;
  acc += dt;
  while (acc >= 1 / 120) {
    step(1 / 120);
    acc -= 1 / 120;
  }
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// 通知宿主平台：游戏加载完成
window.parent?.postMessage({ source: "playhub-game", sdkVersion: "1.0.0", type: "game_loading_completed", data: {} }, "*");

// ============ 渲染 ============

function draw() {
  // 背景 → 木框 → 台面（圆角矩形）
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#07110f";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#9e6b3b";
  ctx.fillRect(46, 30, 1188, 660);
  ctx.fillStyle = "#1a8165";
  ctx.beginPath();
  ctx.roundRect(66, 50, 1148, 620, 18);
  ctx.fill();

  // 台面木色边框线
  ctx.strokeStyle = "#c59a64";
  ctx.lineWidth = 10;
  ctx.strokeRect(70, 54, 1140, 612);

  // 6 个袋口：洞口视觉半径 25（约球 2 倍，贴近判定半径 28）+ 深色洞底 + 皮质护圈
  for (const p of pockets) {
    ctx.beginPath();
    ctx.fillStyle = "#020403";
    ctx.arc(p.x, p.y, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = "#000";
    ctx.arc(p.x, p.y, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = "rgba(90, 58, 32, 0.9)";
    ctx.lineWidth = 4;
    ctx.arc(p.x, p.y, 25, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 每颗活球：1-7 纯色 / 8 黑 / 9-15 白底色带条纹，编号小白点
  // 位置和角度实时从物理刚体读取；条纹和编号随 body 角度旋转（球滚号也滚）
  for (const m of balls) {
    if (m.pocketed) continue;
    const pos = m.body.getPosition();
    const ang = m.body.getAngle();
    ctx.save();
    ctx.translate(pu(pos.x), pu(pos.y));
    ctx.rotate(ang);
    if (m.number >= 9) {
      // 条纹球：裁剪圆形后画白底 + 中部横向色带
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#f7f5e9";
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      ctx.fillStyle = m.color;
      ctx.fillRect(-radius, -radius * 0.45, radius * 2, radius * 0.9);
    } else {
      // 纯色球
      ctx.beginPath();
      ctx.fillStyle = m.color;
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#eae8da";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    if (m.number > 0) {
      ctx.beginPath();
      ctx.fillStyle = "#f7f5e9";
      ctx.arc(0, -5, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#151515";
      ctx.font = "bold 8px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(m.number), 0, -5);
    }
    ctx.restore();
  }

  // 拉弓式瞄准：拖拽方向 = 拉杆方向，球往反方向射出
  // 瞄准虚线指向真实射出方向，球杆画在指针一侧（拖哪边，杆就在哪边）
  if (!shot && !cueBall.pocketed) {
    const cuePosV = cueBall.body.getPosition();
    const cuePos = { x: pu(cuePosV.x), y: pu(cuePosV.y) }; // 物理单位 → 像素
    // 射出方向角：从指针指向白球（= 实际击出方向）；空闲时默认朝右打球堆
    const shotAng = pointer.down
      ? Math.atan2(cuePos.y - pointer.y, cuePos.x - pointer.x)
      : 0;
    const drag = Math.hypot(pointer.x - cuePos.x, pointer.y - cuePos.y);

    // 瞄准虚线：沿射出方向，长度随拉杆距离略增
    const aimLen = pointer.down ? Math.min(220, Math.max(60, drag)) : 180;
    ctx.beginPath();
    ctx.moveTo(cuePos.x, cuePos.y);
    ctx.lineTo(cuePos.x + Math.cos(shotAng) * aimLen, cuePos.y + Math.sin(shotAng) * aimLen);
    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.setLineDash([10, 10]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);

    // 球杆：摆在射出方向的反侧（即指针一侧），杆头顶着白球
    // 拉杆距离随拖拽力度增大 → 击球前有力度反馈
    const pull = pointer.down ? Math.min(50, (drag / 7) * 2.5) : 10;
    const tipX = -(radius + 5 + pull); // 杆头（白球身后）
    const buttX = tipX - 230;          // 杆尾（越拉离球越远）
    ctx.save();
    ctx.translate(cuePos.x, cuePos.y);
    ctx.rotate(shotAng);
    ctx.lineCap = "round";
    // 前段：浅色杆身
    ctx.strokeStyle = "#d9b98a";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(tipX, 0);
    ctx.lineTo(tipX - 140, 0);
    ctx.stroke();
    // 后段：深色握把
    ctx.strokeStyle = "#4a2c14";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(tipX - 140, 0);
    ctx.lineTo(buttX, 0);
    ctx.stroke();
    // 皮头：蓝色小段
    ctx.strokeStyle = "#7fb3d5";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(tipX + 3, 0);
    ctx.lineTo(tipX, 0);
    ctx.stroke();
    ctx.restore();
  }

  // 左上角记分板
  ctx.fillStyle = "#fff";
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`Score ${score}`, 92, 36);
}
