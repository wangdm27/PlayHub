# PlayHub

按照《PlayHub-游戏平台技术方案》实现的 HTML5 游戏平台 MVP。

## 目录

- `frontend/playhub-web` - 玩家门户
- `frontend/playhub-console` - 开发者与运营控制台
- `frontend/playhub-sdk` - 游戏 postMessage SDK
- `games/pool-game` - 可玩桌球游戏
- `backend/PlayHub.Api` - 平台 API
- `backend/PlayHub.PublishWorker` - 发布 Worker 骨架
- `deploy/database/schema.sql` - SQL Server 核心表

## 本地运行

门户和管理端使用 Next.js App Router 服务。门户在服务器端从 ASP.NET Core API 加载已发布游戏和详情；控制台使用 Next.js 页面承载交互式登录与运营界面。业务数据持久化到 SQL Server，API 使用 EF Core 与 ASP.NET Core Identity，控制台管理接口要求 JWT 登录和运营角色。

### 使用已安装的本地 SQL Server（无需 Docker）

项目在 Development 环境默认连接 `.\SQLEXPRESS`，使用当前 Windows 登录身份；启动 SQL Server Express 服务后，在项目根目录执行：

```powershell
dotnet run --project backend\PlayHub.Api\PlayHub.Api.csproj
```

`launchSettings.json` 会以 Development 环境启动；API 首次运行会在本地 SQL Server Express 中创建 `PlayHub` 数据库、表、角色和示例游戏。开发环境若未设置 JWT 密钥，会自动生成临时密钥；重启 API 后此前签发的 JWT 会失效。

若要从控制台登录，建议用 .NET User Secrets 设置首个管理员凭证（只需初始化一次）：

```powershell
dotnet user-secrets init --project backend\PlayHub.Api\PlayHub.Api.csproj
dotnet user-secrets set "BootstrapAdmin:Email" "admin@playhub.local" --project backend\PlayHub.Api\PlayHub.Api.csproj
dotnet user-secrets set "BootstrapAdmin:Password" "替换为自己的强密码PlayHub2026!" --project backend\PlayHub.Api\PlayHub.Api.csproj
```

管理员密码至少 12 位，并包含大小写字母、数字和特殊字符。然后分别打开三个 PowerShell 窗口运行：

```powershell
npm run dev -w frontend\playhub-web -- -p 5173
npm run dev -w frontend\playhub-console -- -p 5176
npm run game
```

访问玩家门户 http://localhost:5173、控制台 http://localhost:5176、桌球 http://localhost:5174、API http://localhost:5280。

如果本机 SQL Server 实例不是 `SQLEXPRESS`，可通过 User Secrets 覆盖连接串，例如 `dotnet user-secrets set "ConnectionStrings:DefaultConnection" "Server=localhost;Database=PlayHub;Trusted_Connection=True;TrustServerCertificate=True;Encrypt=False" --project backend\PlayHub.Api\PlayHub.Api.csproj`。

### Docker 部署

首次使用 Docker 时，复制 `.env.example` 为 `.env` 并更换所有占位密码和密钥，再运行 `docker compose up --build`。Compose 会启动容器化 SQL Server。

数据库通过 `ConnectionStrings__DefaultConnection` 配置；非 Development 环境必须配置至少 32 字节的 `Authentication__SigningKey`。开发环境首次创建使用 EF Core `EnsureCreated`；生产部署前应切换为版本化 EF Core migrations、HTTPS、密钥管理服务和正式 SQL Server 实例。

`frontend/playhub-console` 中的上传处理、统计分析和部分运营功能仍未实现，页面会明确标记未接通，不应将其视为已完成的平台能力。
