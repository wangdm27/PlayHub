# PlayHub：HTML5 小游戏平台技术方案

> 版本：1.0\
> 日期：2026-11-18\
> 产品定位：参考 Poki 的 HTML5
> 游戏门户、开发者上传发布平台与运营管理平台。\
> 首款自研游戏：2D 俯视角美式八球（8-Ball Pool）。

------------------------------------------------------------------------

## 1. 项目目标与范围

PlayHub 是一个面向玩家、游戏开发者和平台运营人员的 HTML5
游戏平台。平台不要求所有游戏使用同一引擎；开发者上传符合平台规范的 Web
游戏构建包，平台负责校验、隔离托管、审核、发布和数据统计。

### 1.1 三类用户

  用户       核心诉求
  ---------- ------------------------------------------------------------
  玩家       浏览、搜索、启动游戏、收藏、查看最近玩过的游戏
  开发者     创建游戏、上传 ZIP、在线预览、版本管理、提交审核、查看数据
  运营人员   审核游戏、管理分类与推荐位、处理违规内容、查看平台数据

### 1.2 MVP 目标

第一版优先完成一条完整闭环：

1.  玩家访问门户并打开游戏。
2.  平台运营人员可以创建和管理游戏信息。
3.  开发者可以上传 HTML5 游戏 ZIP 包。
4.  系统校验、解压、生成版本并提供预览。
5.  运营人员审核通过后发布。
6.  游戏静态资源通过对象存储和 CDN 分发。
7.  平台能够记录游戏启动、结束和游戏时长等基础事件。
8.  首款自研桌球游戏通过同一上传发布流程上架。

### 1.3 MVP 暂不实现

-   实时在线多人桌球。
-   复杂推荐算法和机器学习。
-   自建广告联盟及自动收益结算。
-   Go、Java 微服务。
-   多区域多活和复杂 Kubernetes 集群。
-   完整的开发者税务、付款和财务合规流程。

------------------------------------------------------------------------

## 2. 总体技术选型

### 2.1 推荐技术栈

  层次           技术                                  用途
  -------------- ------------------------------------- --------------------------
  玩家端         Next.js、React、TypeScript            游戏门户、SEO、页面渲染
  管理端         Next.js、React、TypeScript            开发者中心和运营后台
  UI             Tailwind CSS                          页面样式
  前端状态       Zustand                               客户端状态
  API 数据请求   TanStack Query                        请求缓存与状态同步
  游戏引擎       Phaser + TypeScript                   首款 2D 桌球游戏
  构建工具       Vite                                  游戏构建
  游戏物理       Planck.js 或 Matter.js + 自定义逻辑   碰撞、摩擦、进洞
  后端           .NET 10 / ASP.NET Core                平台核心 API
  ORM            EF Core                               业务数据访问
  SQL 查询       Dapper（按需）                        报表和复杂查询
  验证           FluentValidation                      请求验证
  日志           Serilog                               结构化日志
  缓存           Redis / StackExchange.Redis           热点数据、限流、排行榜
  消息队列       RabbitMQ                              上传处理、异步统计、通知
  业务数据库     SQL Server                            用户、游戏、版本、审核等
  分析数据库     ClickHouse（第二阶段引入）            大规模行为事件分析
  文件存储       S3 兼容对象存储 / Cloudflare R2       ZIP 包、游戏资源、封面
  CDN            Cloudflare CDN 或 AWS CloudFront      全球静态资源分发
  自动化测试     xUnit、Playwright                     后端测试和端到端测试
  部署           Docker、Linux、Nginx                  容器化和反向代理
  CI/CD          GitHub Actions                        自动构建、测试和部署
  可观测性       OpenTelemetry、Prometheus、Grafana    链路、指标和监控

### 2.2 是否需要 Go、Java、Python

MVP 阶段不需要额外引入这些语言。

-   **C#**：平台 API、发布 Worker、审核工作流、业务管理。
-   **TypeScript**：Next.js 前端、Phaser 游戏、平台 JavaScript SDK。
-   **Go**：未来确实出现高并发独立基础设施需求时再考虑。
-   **Python**：未来做 AI 推荐、图像识别、智能内容审核时再考虑。
-   **Java**：当前没有必须引入的独立场景。

优先保持少语言、少服务、清晰边界，避免为了技术多样性增加维护成本。

------------------------------------------------------------------------

## 3. 系统总体架构

``` mermaid
flowchart TD
    U[玩家 / 开发者 / 运营人员] --> CF[DNS / CDN / WAF]
    CF --> WEB[Next.js 玩家门户]
    CF --> CONSOLE[Next.js 管理端]
    WEB --> API[ASP.NET Core API]
    CONSOLE --> API

    API --> SQL[(SQL Server)]
    API --> REDIS[(Redis)]
    API --> MQ[(RabbitMQ)]
    API --> OBJ[(对象存储)]

    MQ --> WORKER[Publish Worker]
    WORKER --> OBJ
    WORKER --> SQL

    WEB --> GAMECDN[游戏 CDN]
    GAMECDN --> GAME[独立 Origin 下的 HTML5 游戏]

    API --> EVENTS[事件接入]
    EVENTS --> MQ
    MQ --> CH[(ClickHouse / 后续引入)]
```

### 3.1 核心架构原则

1.  **平台业务与游戏运行分离**：游戏静态文件不经过 ASP.NET Core API
    代理。
2.  **游戏与平台解耦**：游戏只依赖公开的 PlayHub JavaScript SDK 协议。
3.  **版本不可变**：发布后的游戏版本不覆盖原文件；更新必须生成新版本。
4.  **先模块化单体**：第一版使用一个 API 应用，按领域模块组织代码。
5.  **异步处理耗时任务**：ZIP 解压、扫描、缩略图生成、发布等放到
    Worker。
6.  **不信任上传内容**：开发者游戏代码视为不可信第三方代码。
7.  **统计与交易数据分离**：高频行为事件不直接持续写入核心业务表。

------------------------------------------------------------------------

## 4. 应用与项目结构

建议采用 Monorepo：

``` text
PlayHub/
├── frontend/
│   ├── playhub-web/                 # 玩家门户 Next.js
│   ├── playhub-console/             # 开发者中心和运营后台
│   └── playhub-sdk/                 # 面向游戏开发者的 JS SDK
├── games/
│   └── pool-game/                   # 第一款桌球游戏
├── backend/
│   ├── PlayHub.Api/                 # ASP.NET Core API 入口
│   ├── PlayHub.Domain/              # 实体、值对象、领域规则
│   ├── PlayHub.Application/         # 用例、命令、查询、接口
│   ├── PlayHub.Infrastructure/      # EF Core、Redis、RabbitMQ、存储
│   ├── PlayHub.Contracts/           # API DTO、消息契约
│   └── PlayHub.PublishWorker/       # 游戏包处理后台服务
├── tests/
│   ├── PlayHub.UnitTests/
│   ├── PlayHub.IntegrationTests/
│   ├── PlayHub.ArchitectureTests/
│   └── PlayHub.E2ETests/
├── deploy/
│   ├── docker/
│   ├── nginx/
│   ├── database/
│   └── scripts/
├── docs/
│   ├── architecture/
│   ├── database/
│   ├── api/
│   └── game-sdk/
└── docker-compose.yml
```

### 4.1 后端模块边界

  模块            职责
  --------------- ------------------------------
  Identity        用户、登录、角色、权限
  GameCatalog     游戏资料、分类、标签、封面
  Developer       开发者、团队、成员权限
  GameUpload      上传会话、文件校验、上传记录
  GameVersion     游戏版本、入口文件、资源清单
  Publishing      预览、发布、下架、回滚
  Review          审核任务、审核意见、审核历史
  Player          收藏、浏览历史、评分
  Analytics       事件接入、统计查询
  Advertisement   广告位、广告事件（后续）
  Finance         收益和结算（后续）

第一版不必将每个模块拆成独立微服务。模块之间通过应用层接口和领域事件协作。

------------------------------------------------------------------------

## 5. 玩家端功能设计

### 5.1 页面规划

  页面       路由示例                功能
  ---------- ----------------------- --------------------------
  首页       `/`                     热门、最新、推荐游戏
  游戏分类   `/category/sports`      分类列表
  游戏搜索   `/search?q=pool`        名称、标签搜索
  游戏详情   `/games/8-ball-pool`    封面、简介、开发者、启动
  游戏运行   `/play/8-ball-pool`     iframe 加载游戏
  登录注册   `/login`、`/register`   用户身份
  我的收藏   `/me/favorites`         收藏游戏
  最近玩过   `/me/history`           游戏历史

### 5.2 游戏运行页面

游戏详情页由平台提供页面框架，实际游戏在 iframe
中运行。游戏资源从独立游戏 Origin 加载。

需要考虑：

-   iframe `sandbox` 权限最小化。
-   CSP 限制脚本、网络连接、媒体和嵌入来源。
-   不向游戏 iframe 暴露平台登录令牌。
-   不允许游戏直接访问平台管理 API。
-   使用 `postMessage` 与平台通信，并严格校验
    `origin`、消息类型和数据结构。
-   对第三方游戏设置独立 Origin，避免不同开发者游戏共享同一安全边界。

------------------------------------------------------------------------

## 6. 开发者中心与运营后台

### 6.1 开发者中心

-   开发者注册和资料管理。
-   创建游戏及编辑元信息。
-   上传 ZIP 游戏包。
-   查看上传、扫描和构建状态。
-   版本管理和版本说明。
-   预览未发布版本。
-   提交审核。
-   查看审核意见。
-   发布、下架和回滚。
-   查看游戏 PV、UV、启动次数、时长等数据。

### 6.2 运营后台

-   用户和开发者管理。
-   游戏审核和审核历史。
-   游戏上下架。
-   分类和标签管理。
-   首页推荐位管理。
-   游戏内容举报处理。
-   平台统计。
-   操作审计日志。
-   系统参数和权限配置。

### 6.3 权限模型

建议至少包含：

-   Player
-   DeveloperOwner
-   DeveloperMember
-   Reviewer
-   Operator
-   Administrator

开发者只能操作自己所属团队有权限的游戏。所有管理操作记录操作者、时间、对象和变更摘要。

------------------------------------------------------------------------

## 7. 游戏上传、处理和发布流程

### 7.1 上传包格式

示例：

``` text
pool-game-v1.0.0.zip
├── index.html
├── manifest.json
├── assets/
│   ├── game.js
│   ├── game.css
│   ├── images/
│   └── audio/
└── ...
```

`manifest.json` 示例：

``` json
{
  "gameId": "pool-game",
  "name": "8 Ball Pool",
  "version": "1.0.0",
  "engine": "Phaser",
  "entry": "index.html",
  "orientation": "landscape",
  "width": 1280,
  "height": 720,
  "sdkVersion": "1.0.0"
}
```

正式协议还应定义字段必填规则、版本兼容、资源路径约束、文件清单和校验和。`gameId`
应由平台分配或校验，不能仅信任 ZIP 内的值。

### 7.2 发布状态机

``` mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Uploading
    Uploading --> Uploaded
    Uploaded --> Processing
    Processing --> Preview
    Processing --> Rejected
    Preview --> Submitted
    Submitted --> Reviewing
    Reviewing --> ChangesRequested
    ChangesRequested --> Preview
    Reviewing --> Approved
    Approved --> Published
    Published --> Unpublished
    Published --> Suspended
```

### 7.3 处理流程

1.  API 创建上传会话，返回受限的预签名上传地址。
2.  浏览器将 ZIP 直接上传到对象存储临时区。
3.  上传完成后 API 校验对象大小、哈希和上传归属。
4.  API 发布 RabbitMQ 处理消息。
5.  Publish Worker 下载或读取 ZIP。
6.  校验压缩包结构、文件数量、解压后大小和路径。
7.  校验 manifest 和入口文件。
8.  执行恶意文件扫描和内容审核。
9.  解压到隔离工作目录。
10. 生成不可变版本目录和资源清单。
11. 开发者在线预览。
12. 提交运营审核。
13. 审核通过后将版本标记为可发布。
14. 发布静态资源到正式存储并刷新 CDN 缓存。
15. 更新游戏当前发布版本。

### 7.4 安全要求

-   防止 ZIP Slip 路径穿越。
-   限制压缩包大小、文件数量、目录深度和解压后总大小。
-   防止 ZIP Bomb。
-   校验文件扩展名、实际文件类型和 MIME。
-   不在 API 进程中执行上传的脚本。
-   Worker 使用低权限账号、临时目录和资源限制。
-   禁止上传内容覆盖系统文件。
-   对游戏文件执行恶意内容扫描和人工审核。
-   游戏使用独立 Origin，禁止共享主站 Cookie。
-   配置 CSP、iframe sandbox 和最小权限。
-   限制游戏 iframe 的网络访问能力；必要时使用网络出口策略。
-   游戏版本发布后不可原地修改，更新必须创建新版本。
-   对上传、审核、发布、下架和回滚操作保留审计记录。

------------------------------------------------------------------------

## 8. 游戏托管与 CDN 设计

### 8.1 域名规划

  域名                           用途
  ------------------------------ --------------------
  `www.playhub.example`          玩家门户
  `api.playhub.example`          平台 API
  `console.playhub.example`      管理端
  `cdn.playhub.example`          图片和公共静态资源
  `games.playhub-game.example`   独立游戏运行域名

正式环境应使用独立注册域名或独立站点边界承载不可信游戏，不能只依赖同一主域名下的子域名隔离。Cookie
应设置为 host-only，不设置宽泛的 Domain。

### 8.2 存储目录建议

``` text
object-storage/
├── uploads-temp/
├── games/
│   └── {gameId}/
│       └── versions/
│           └── {versionId}/
│               ├── index.html
│               ├── manifest.json
│               └── assets/
├── covers/
└── screenshots/
```

### 8.3 CDN 策略

-   版本目录不可变，资源文件名或路径带版本标识。
-   对带版本的 JS、CSS、图片设置较长缓存时间。
-   HTML 入口文件使用较短缓存或发布时主动刷新。
-   正确配置 MIME、CORS 和压缩。
-   不允许用户上传资源覆盖其他游戏资源。
-   记录资源访问量和带宽成本。

------------------------------------------------------------------------

## 9. 首款游戏：8-Ball Pool 设计

### 9.1 游戏定位

首款游戏采用 2D
俯视角美式八球。第一版实现单人练习或本地双人轮流操作；在线实时对战放到后续版本。

### 9.2 技术选型

  技术                     用途
  ------------------------ ----------------------------
  Phaser                   场景、渲染、输入和游戏循环
  TypeScript               游戏逻辑
  Vite                     开发服务器和生产构建
  Planck.js 或 Matter.js   物理基础能力评估
  自定义物理模块           桌球碰撞、摩擦、旋转、进洞
  Web Audio API            音效
  Playwright               游戏启动和交互自动化测试

桌球运动对稳定性和手感要求较高。不要仅依赖通用刚体引擎默认参数；应通过物理测试和实际试玩调优。建议使用固定时间步长更新物理状态，渲染帧率与物理模拟解耦。

### 9.3 MVP 游戏功能

  功能                   优先级
  ---------------------- --------
  球桌、六个球洞和球杆   P0
  白球及 15 颗目标球     P0
  鼠标瞄准               P0
  拖动或按压调整力度     P0
  球与球碰撞             P0
  球与库边反弹           P0
  摩擦减速和停止判定     P0
  进球判定               P0
  基础八球规则和犯规     P0
  音效和简单动画         P1
  手机触控适配           P1
  人机对手               P1
  旋转球控制             P2
  在线多人对战           P2

### 9.4 游戏项目目录

``` text
games/pool-game/
├── public/
│   └── assets/
│       ├── images/
│       ├── audio/
│       └── fonts/
├── src/
│   ├── scenes/
│   │   ├── BootScene.ts
│   │   ├── PreloadScene.ts
│   │   ├── MenuScene.ts
│   │   └── PoolScene.ts
│   ├── physics/
│   │   ├── BallPhysics.ts
│   │   ├── CollisionSystem.ts
│   │   ├── FrictionSystem.ts
│   │   └── PocketSystem.ts
│   ├── game/
│   │   ├── Ball.ts
│   │   ├── Cue.ts
│   │   ├── PoolTable.ts
│   │   ├── GameRules.ts
│   │   └── GameManager.ts
│   ├── ai/
│   │   └── PoolAI.ts
│   ├── sdk/
│   │   └── PlayHubSDK.ts
│   └── main.ts
├── index.html
├── package.json
└── vite.config.ts
```

### 9.5 物理模块边界

-   BallMovement：位置和速度积分。
-   BallCollision：球与球碰撞。
-   WallCollision：球与库边碰撞。
-   FrictionSystem：滚动摩擦和停止阈值。
-   PocketDetection：球洞检测和进洞动画。
-   CueController：方向、力度和击球输入。
-   GameRules：轮次、球组、犯规和胜负判定。

建议为物理模块编写确定性测试：给定初始球位、速度和时间步，验证碰撞后速度、反弹方向、能量损失和最终停止状态。

### 9.6 桌球开发验收

-   正面碰撞。
-   斜向碰撞。
-   连续多球碰撞。
-   库边反弹。
-   球洞边缘掠过但未进洞。
-   球进入球洞。
-   多球同时运动并最终停止。
-   浏览器切后台再恢复。
-   快速连续输入不会造成重复击球。
-   桌面鼠标和手机触控操作可用。

------------------------------------------------------------------------

## 10. PlayHub JavaScript SDK

所有游戏通过统一 SDK 与平台通信。SDK 应独立发布、版本化，并提供
TypeScript 类型定义。

### 10.1 建议接口

``` typescript
export interface GameResult {
  score?: number;
  win?: boolean;
  durationSeconds?: number;
}

export interface PlayHubSDK {
  init(): Promise<void>;
  loadingComplete(): void;
  gameStart(): void;
  gamePause(): void;
  gameResume(): void;
  gameOver(result?: GameResult): void;
  trackEvent(
    eventName: string,
    data?: Record<string, unknown>
  ): void;
  showInterstitial(): Promise<void>;
  showRewardedAd(): Promise<boolean>;
}
```

### 10.2 SDK 设计原则

-   SDK 不包含平台密钥和服务端凭证。
-   SDK 不信任游戏上报的胜负、收益等敏感数据。
-   事件上报使用短期、最小权限的游戏会话凭证。
-   SDK 必须兼容未接入 SDK 的普通 HTML5 游戏。
-   广告 API 第一版可以返回"不支持"，后续再接入广告供应商。
-   SDK 通过 `postMessage` 与父页面通信时，严格校验消息来源和 schema。
-   SDK 接口应有版本号和兼容策略。

------------------------------------------------------------------------

## 11. 数据库初步设计

以下为核心业务表建议，实际建表时还需补充主键、外键、唯一约束、索引、审计字段和并发控制字段。

### 11.1 用户与开发者

  表                     关键字段
  ---------------------- ----------------------------------------
  Users                  Id、Username、Email、Status、CreatedAt
  UserProfiles           UserId、Nickname、Avatar
  Developers             Id、OwnerUserId、DeveloperName、Status
  DeveloperTeams         Id、DeveloperId、TeamName
  DeveloperTeamMembers   TeamId、UserId、Role、Status

### 11.2 游戏目录与版本

  -----------------------------------------------------------------------------------------------------------------
  表                                  关键字段
  ----------------------------------- -----------------------------------------------------------------------------
  Games                               Id、DeveloperId、Name、Slug、Description、Status、CurrentPublishedVersionId

  GameCategories                      Id、Name、ParentId、Status

  GameCategoryRelations               GameId、CategoryId

  GameTags                            Id、Name

  GameTagRelations                    GameId、TagId

  GameVersions                        Id、GameId、Version、EntryFile、StorageKey、PackageHash、Status

  GameAssets                          Id、GameVersionId、AssetPath、StorageKey、ContentType、Size

  GameReviews                         Id、GameVersionId、ReviewerId、Status、Comment、ReviewedAt

  GamePublishRecords                  Id、GameId、GameVersionId、Action、OperatorId、CreatedAt
  -----------------------------------------------------------------------------------------------------------------

### 11.3 玩家数据

  -----------------------------------------------------------------------------------------------------
  表                                  关键字段
  ----------------------------------- -----------------------------------------------------------------
  UserGameFavorites                   UserId、GameId、CreatedAt

  UserGameHistory                     UserId、GameId、LastPlayedAt、PlayCount

  GameRatings                         UserId、GameId、Rating、CreatedAt

  GamePlaySessions                    Id、GameId、UserId（可空）、StartedAt、EndedAt、DurationSeconds
  -----------------------------------------------------------------------------------------------------

### 11.4 统计与商业化（后续）

  ------------------------------------------------------------------------------------------
  表                                  关键字段
  ----------------------------------- ------------------------------------------------------
  GameEventOutbox                     EventId、Payload、CreatedAt、PublishedAt

  GameDailyStatistics                 GameId、StatDate、PV、UV、PlayCount、TotalDuration

  AdvertisementPlacements             Id、GameId、PlacementType、Status

  AdvertisementEvents                 Id、GameId、EventType、Provider、CreatedAt

  DeveloperRevenueRecords             DeveloperId、GameId、Amount、Currency、StatDate

  DeveloperSettlements                Id、DeveloperId、Amount、Currency、Status、SettledAt
  ------------------------------------------------------------------------------------------

### 11.5 数据设计原则

-   业务时间统一使用 UTC。
-   游戏 ZIP 和静态文件不存 SQL Server，数据库只存对象存储 Key。
-   游戏版本发布后不可变。
-   收藏关系设置 `(UserId, GameId)` 唯一索引。
-   游戏 Slug 设置唯一索引。
-   高频事件异步写入分析系统。
-   UV 统计需要明确去重口径、时间窗口和隐私策略。
-   匿名玩家标识应使用受控的随机标识，不收集不必要的个人信息。

------------------------------------------------------------------------

## 12. API 初步规划

建议 API 使用 `/api/v1` 版本前缀。

### 12.1 玩家端 API

  方法     路径                            说明
  -------- ------------------------------- --------------
  GET      `/api/v1/games`                 游戏分页列表
  GET      `/api/v1/games/{slug}`          游戏详情
  GET      `/api/v1/categories`            分类列表
  GET      `/api/v1/search`                游戏搜索
  POST     `/api/v1/games/{id}/favorite`   收藏
  DELETE   `/api/v1/games/{id}/favorite`   取消收藏
  GET      `/api/v1/me/favorites`          我的收藏
  GET      `/api/v1/me/history`            最近玩过

### 12.2 开发者 API

  方法   路径                                                说明
  ------ --------------------------------------------------- --------------
  POST   `/api/v1/developer/games`                           创建游戏
  PUT    `/api/v1/developer/games/{id}`                      编辑游戏信息
  POST   `/api/v1/developer/games/{id}/upload-sessions`      创建上传会话
  POST   `/api/v1/developer/upload-sessions/{id}/complete`   完成上传
  GET    `/api/v1/developer/games/{id}/versions`             版本列表
  POST   `/api/v1/developer/versions/{id}/preview`           创建预览
  POST   `/api/v1/developer/versions/{id}/submit-review`     提交审核
  GET    `/api/v1/developer/games/{id}/statistics`           游戏统计

### 12.3 运营 API

  方法   路径                                           说明
  ------ ---------------------------------------------- ------------
  GET    `/api/v1/admin/reviews`                        待审核列表
  POST   `/api/v1/admin/reviews/{id}/approve`           审核通过
  POST   `/api/v1/admin/reviews/{id}/request-changes`   要求修改
  POST   `/api/v1/admin/games/{id}/publish`             发布游戏
  POST   `/api/v1/admin/games/{id}/unpublish`           下架游戏

所有写操作应进行身份认证、授权、输入验证、幂等性设计和审计记录。上传完成、发布等关键操作应有幂等键或状态机保护。

------------------------------------------------------------------------

## 13. 统计与事件设计

### 13.1 第一版事件

-   `game_page_view`
-   `game_loading_started`
-   `game_loading_completed`
-   `game_started`
-   `game_paused`
-   `game_resumed`
-   `game_over`
-   `game_error`

### 13.2 事件流

``` mermaid
flowchart LR
    GAME[游戏 SDK] --> API[事件接入 API]
    API --> VALIDATE[鉴权与校验]
    VALIDATE --> MQ[RabbitMQ]
    MQ --> CONSUMER[统计消费者]
    CONSUMER --> DB[(ClickHouse)]
    CONSUMER --> CACHE[(Redis 实时指标)]
    DB --> DASH[开发者统计面板]
```

第一版可先将基础统计写入 SQL Server
或轻量事件存储，等事件量达到需要时再部署
ClickHouse。不要在没有业务规模依据时过早增加运维组件。

统计事件应考虑重复投递、乱序、机器人流量、匿名用户去重和异常时长过滤。

------------------------------------------------------------------------

## 14. 安全、隐私与合规

游戏平台需要把第三方游戏视为不可信代码。

### 14.1 核心安全控制

-   游戏运行 Origin 与主站隔离。
-   iframe 使用最小化 sandbox 权限。
-   CSP 限制脚本和网络来源。
-   不共享平台认证 Cookie。
-   不把访问令牌、服务端密钥放进游戏包。
-   游戏 SDK 使用短期、最小权限凭证。
-   上传包安全扫描和资源限制。
-   Worker 在隔离环境中运行。
-   管理端启用 RBAC 和操作审计。
-   API 实施限流、输入验证和反自动化措施。
-   资源下载使用受控签名 URL 或 CDN 访问策略。
-   处理用户数据时遵守适用隐私法规和平台政策。

### 14.2 游戏内容审核

审核范围至少包括：

-   违法或不适宜内容。
-   版权和商标侵权。
-   恶意脚本和钓鱼行为。
-   未授权外部跳转。
-   隐私数据收集。
-   诱导下载或执行本地文件。
-   违反广告政策的行为。

自动扫描不能替代人工审核。平台应提供举报、下架和紧急封禁机制。

------------------------------------------------------------------------

## 15. 部署方案

### 15.1 MVP 部署

初期可以使用一台 Linux 云主机运行：

-   Next.js 玩家端。
-   Next.js 管理端。
-   ASP.NET Core API。
-   Publish Worker。
-   Redis。
-   RabbitMQ。
-   SQL Server（也可使用托管数据库）。

游戏 ZIP、游戏版本资源和封面存储在对象存储，由 CDN
分发。生产环境建议优先使用托管 SQL Server
或独立数据库主机，不建议将数据库、消息队列和所有业务容器长期堆在一台小规格机器上。

### 15.2 域名建议

  域名                           用途
  ------------------------------ -----------------------
  `www.playhub.example`          玩家门户
  `api.playhub.example`          API
  `console.playhub.example`      管理端
  `cdn.playhub.example`          公共静态资源
  `games.playhub-game.example`   不可信游戏运行 Origin

### 15.3 CI/CD 流程

1.  Pull Request 触发代码检查。
2.  构建 Next.js、.NET 和 Phaser 项目。
3.  执行单元测试和集成测试。
4.  生成容器镜像和游戏构建包。
5.  将构建产物上传到制品库或对象存储。
6.  部署到测试环境。
7.  执行 Playwright E2E 测试。
8.  人工批准后发布生产环境。
9.  保留上一个稳定版本以便回滚。

------------------------------------------------------------------------

## 16. 测试策略与验收标准

  模块       验收标准
  ---------- --------------------------------------
  玩家门户   可以浏览、搜索并打开游戏
  游戏运行   iframe 正常加载，错误有提示
  桌球物理   碰撞、反弹、摩擦、进洞符合测试预期
  上传       大小限制、哈希校验和归属校验正常
  ZIP 安全   拒绝路径穿越和超限压缩包
  版本管理   新版本不会覆盖旧版本
  审核发布   未审核版本不可公开访问
  CDN        发布后资源可访问，旧版本仍可回滚
  权限       开发者不能修改其他团队的游戏
  统计       启动、暂停、结束事件可正确记录
  移动端     主流移动浏览器可正常操作
  可观测性   API 和 Worker 有日志、指标和异常追踪

------------------------------------------------------------------------

## 17. 12 周 MVP 参考计划

  ----------------------------------------------------------------------------------------------------
  周期                    工作内容                                             交付物
  ----------------------- ---------------------------------------------------- -----------------------
  第 1--2 周              仓库、.NET、Next.js、数据库、Redis、RabbitMQ、登录   工程骨架

  第 3--4 周              首页、分类、搜索、详情、游戏 iframe                  玩家门户

  第 5--6 周              Phaser 桌球场景、物理、规则、触控                    可玩桌球游戏

  第 7--8 周              开发者中心、ZIP 上传、版本、预览                     上传系统

  第 9--10 周             Worker、校验、审核、发布、CDN                        发布闭环

  第 11--12 周            统计、监控、安全测试、部署                           MVP 上线候选版本
  ----------------------------------------------------------------------------------------------------

排期为单人主导、AI
辅助开发的粗略估算，不是固定承诺。桌球物理调校、游戏安全隔离和第三方上传流程可能显著影响周期。

------------------------------------------------------------------------

## 18. AI 辅助研发流程

建议使用 Architect、Planner、Backend Coder、Frontend Coder、Game
Coder、Tester、Reviewer 等角色协作。

``` mermaid
flowchart TD
    A[产品需求] --> B[架构分析]
    B --> C[任务拆分与验收标准]
    C --> D[后端 / 前端 / 游戏并行开发]
    D --> E[自动化测试]
    E --> F{测试通过?}
    F -->|否| D
    F -->|是| G[代码与安全审查]
    G --> H{审查通过?}
    H -->|否| D
    H -->|是| I[Pull Request 合并]
    I --> J[CI/CD 测试部署]
    J --> K[验收与生产发布]
```

AI 开发约束：

-   先确认接口契约和数据库设计，再生成代码。
-   每个任务必须有明确验收标准。
-   AI 不得自行更改架构约束或引入新技术栈。
-   物理算法必须有自动化测试，不能只靠视觉判断。
-   上传和发布代码必须进行安全审查。
-   所有变更通过 Git 分支和 Pull Request 管理。
-   生产发布必须经过测试和人工批准。

------------------------------------------------------------------------

## 19. 建议的实施顺序

不要同时启动所有模块。按以下顺序推进：

1.  建立 Monorepo 和工程规范。
2.  建立 .NET API、Next.js 门户和基础数据库。
3.  实现游戏目录、详情和 iframe 运行容器。
4.  独立完成桌球游戏，并通过平台 iframe 运行。
5.  开发游戏上传、版本管理和在线预览。
6.  实现审核、发布、对象存储和 CDN。
7.  实现游戏 SDK 和基础事件统计。
8.  完成安全测试、部署和 MVP 验收。
9.  再评估广告系统、收益分成、AI 推荐和在线多人游戏。

------------------------------------------------------------------------

## 20. 后续需要单独细化的设计文档

本方案作为总体设计基线。正式编码前，建议继续拆分以下专题文档：

1.  `01-Product-Requirements.md`：产品需求和用户故事。
2.  `02-System-Architecture.md`：系统组件、依赖和部署架构。
3.  `03-Technology-Stack.md`：技术版本、选型理由和约束。
4.  `04-Database-Design.md`：完整 DDL、索引、关系和数据字典。
5.  `05-Backend-Architecture.md`：.NET 分层、模块、依赖规则。
6.  `06-Frontend-Architecture.md`：页面路由、组件和状态管理。
7.  `07-Game-Architecture.md`：桌球场景、物理模型和规则。
8.  `08-Game-SDK-Protocol.md`：SDK API、postMessage 协议和事件格式。
9.  `09-Game-Publishing.md`：上传、扫描、预览、审核、发布状态机。
10. `10-Security-Design.md`：Origin 隔离、CSP、沙箱和上传安全。
11. `11-Deployment.md`：Docker、Linux、CDN、CI/CD。
12. `12-Development-Roadmap.md`：开发任务、依赖关系和验收标准。

**最终交付目标：** PlayHub
不只是一个能展示桌球游戏的网站，而是一套可以让平台自己开发游戏、让第三方开发者上传游戏、让玩家在线运行游戏，并逐步具备运营和商业化能力的
HTML5 游戏平台。
