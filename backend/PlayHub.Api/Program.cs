using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("Set ConnectionStrings__DefaultConnection to a SQL Server connection string.");
var signingKey = builder.Configuration["Authentication:SigningKey"];
if (builder.Environment.IsDevelopment() && string.IsNullOrWhiteSpace(signingKey))
{
    signingKey = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(48));
    builder.Logging.AddConsole();
    Console.WriteLine("Using an ephemeral JWT signing key for Development. Configure Authentication__SigningKey to keep local tokens valid across restarts.");
}
if (string.IsNullOrWhiteSpace(signingKey) || Encoding.UTF8.GetByteCount(signingKey) < 32)
    throw new InvalidOperationException("Set Authentication__SigningKey to a random secret of at least 32 bytes. Only Development generates an ephemeral key automatically.");

builder.Services.AddDbContext<PlayHubDbContext>(options => options.UseSqlServer(connectionString));
builder.Services
    .AddIdentityCore<PlayHubUser>(options =>
    {
        options.Password.RequiredLength = 12;
        options.Password.RequireDigit = true;
        options.Password.RequireLowercase = true;
        options.Password.RequireUppercase = true;
        options.Password.RequireNonAlphanumeric = true;
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
        options.User.RequireUniqueEmail = true;
    })
    .AddRoles<IdentityRole>()
    .AddEntityFrameworkStores<PlayHubDbContext>()
    .AddSignInManager();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = "PlayHub",
            ValidateAudience = true,
            ValidAudience = "PlayHub.Console",
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
            RoleClaimType = ClaimTypes.Role
        };
    });
builder.Services.AddAuthorization();
var allowedOrigins = builder.Configuration.GetSection("AllowedOrigins").Get<string[]>()
    ?? ["http://localhost:5173", "http://localhost:5176"];
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

await InitializeDatabaseAsync(app);

app.MapGet("/", () => Results.Ok(new { name = "PlayHub API", version = "1.0", status = "running" }));
var api = app.MapGroup("/api/v1");

api.MapPost("/auth/login", async (LoginRequest request, UserManager<PlayHubUser> users) =>
{
    if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrEmpty(request.Password))
        return Results.BadRequest(new { error = "email_and_password_required" });
    var user = await users.FindByEmailAsync(request.Email);
    if (user is null || !user.IsActive)
        return Results.Unauthorized();
    if (await users.IsLockedOutAsync(user))
        return Results.Problem(statusCode: StatusCodes.Status423Locked, title: "Account temporarily locked.");

    var result = await users.CheckPasswordAsync(user, request.Password);
    if (!result)
    {
        await users.AccessFailedAsync(user);
        return Results.Unauthorized();
    }

    await users.ResetAccessFailedCountAsync(user);
    var roles = await users.GetRolesAsync(user);
    var claims = new List<Claim>
    {
        new(JwtRegisteredClaimNames.Sub, user.Id),
        new(JwtRegisteredClaimNames.Email, user.Email!),
        new(ClaimTypes.NameIdentifier, user.Id),
        new(ClaimTypes.Name, user.UserName ?? user.Email!)
    };
    claims.AddRange(roles.Select(role => new Claim(ClaimTypes.Role, role)));
    var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey));
    var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
    var expiresAt = DateTimeOffset.UtcNow.AddMinutes(60);
    var token = new JwtSecurityToken("PlayHub", "PlayHub.Console", claims, expires: expiresAt.UtcDateTime, signingCredentials: credentials);
    return Results.Ok(new LoginResponse(new JwtSecurityTokenHandler().WriteToken(token), expiresAt, user.Email!, roles));
});

api.MapGet("/auth/me", async (ClaimsPrincipal principal, UserManager<PlayHubUser> users) =>
{
    var user = await users.GetUserAsync(principal);
    return user is null ? Results.Unauthorized() : Results.Ok(new { user.Id, user.Email, user.DisplayName, roles = await users.GetRolesAsync(user) });
}).RequireAuthorization();

api.MapGet("/games", async (PlayHubDbContext db, string? category = null, string? q = null, int page = 1, int pageSize = 20) =>
{
    page = Math.Max(1, page);
    pageSize = Math.Clamp(pageSize, 1, 50);
    var query = db.Games.AsNoTracking().Where(game => game.Status == "Published");
    if (!string.IsNullOrWhiteSpace(category))
        query = query.Where(game => game.Category == category);
    if (!string.IsNullOrWhiteSpace(q))
        query = query.Where(game => game.Name.Contains(q));
    var total = await query.CountAsync();
    var items = await query.OrderBy(game => game.Name).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
    return Results.Ok(new { page, pageSize, total, items });
});
api.MapGet("/games/{slug}", async (string slug, PlayHubDbContext db) =>
{
    var game = await db.Games.AsNoTracking().FirstOrDefaultAsync(item => item.Slug == slug && item.Status == "Published");
    return game is null ? Results.NotFound() : Results.Ok(game);
});
api.MapGet("/categories", async (PlayHubDbContext db) =>
    Results.Ok(await db.Games.Where(game => game.Status == "Published").Select(game => game.Category).Distinct().ToListAsync()));
api.MapGet("/search", async (string? q, PlayHubDbContext db) =>
{
    var games = db.Games.AsNoTracking().Where(game => game.Status == "Published");
    if (!string.IsNullOrWhiteSpace(q))
        games = games.Where(game => game.Name.Contains(q) || game.Description.Contains(q));
    return Results.Ok(await games.Take(50).ToListAsync());
});

var admin = api.MapGroup("/admin").RequireAuthorization(policy => policy.RequireRole("Administrator", "Operator"));
admin.MapGet("/overview", async (PlayHubDbContext db) => Results.Ok(new
{
    publishedGames = await db.Games.CountAsync(game => game.Status == "Published"),
    draftGames = await db.Games.CountAsync(game => game.Status == "Draft"),
    pendingReviews = await db.GameReviews.CountAsync(review => review.Status == "Submitted"),
    totalGames = await db.Games.CountAsync()
}));
admin.MapGet("/games", async (PlayHubDbContext db) => Results.Ok(await db.Games.AsNoTracking().OrderBy(game => game.Name).ToListAsync()));
admin.MapGet("/reviews", async (PlayHubDbContext db) => Results.Ok(await db.GameReviews.AsNoTracking().Where(review => review.Status == "Submitted").OrderBy(review => review.CreatedAt).ToListAsync()));
admin.MapPost("/games", async (CreateGameRequest request, PlayHubDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.Category))
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Name and category are required."] });
    var slug = Slugify(request.Name);
    if (await db.Games.AnyAsync(game => game.Slug == slug))
        return Results.Conflict(new { error = "slug_already_exists" });
    var game = new PlayHubGame
    {
        Id = Guid.NewGuid(),
        Name = request.Name.Trim(),
        Slug = slug,
        Description = request.Description?.Trim() ?? "",
        Category = request.Category.Trim(),
        Status = "Draft",
        CreatedAt = DateTimeOffset.UtcNow
    };
    db.Games.Add(game);
    await db.SaveChangesAsync();
    return Results.Created($"/api/v1/games/{game.Slug}", game);
});
admin.MapPost("/games/{id:guid}/unpublish", async (Guid id, PlayHubDbContext db) =>
{
    var game = await db.Games.FindAsync(id);
    if (game is null)
        return Results.NotFound();
    game.Status = "Unpublished";
    await db.SaveChangesAsync();
    return Results.Ok(game);
});

app.Run();

static async Task InitializeDatabaseAsync(WebApplication app)
{
    await using var scope = app.Services.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<PlayHubDbContext>();
    await db.Database.EnsureCreatedAsync();

    var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
    foreach (var roleName in new[] { "Player", "DeveloperOwner", "DeveloperMember", "Reviewer", "Operator", "Administrator" })
    {
        if (!await roles.RoleExistsAsync(roleName))
            EnsureSucceeded(await roles.CreateAsync(new IdentityRole(roleName)), $"Create role {roleName}");
    }

    if (!await db.Games.AnyAsync())
    {
        db.Games.AddRange(
            new PlayHubGame { Id = Guid.NewGuid(), Slug = "8-ball-pool", Name = "8 Ball Pool", Description = "Classic 8-ball billiards.", Category = "Sports", Status = "Published", CreatedAt = DateTimeOffset.UtcNow },
            new PlayHubGame { Id = Guid.NewGuid(), Slug = "neon-racer", Name = "Neon Racer", Description = "Fast arcade racing.", Category = "Racing", Status = "Published", CreatedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
    }

    var email = app.Configuration["BootstrapAdmin:Email"];
    var password = app.Configuration["BootstrapAdmin:Password"];
    if (string.IsNullOrWhiteSpace(email) != string.IsNullOrWhiteSpace(password))
        throw new InvalidOperationException("Set both BootstrapAdmin__Email and BootstrapAdmin__Password to seed the initial administrator.");
    if (string.IsNullOrWhiteSpace(email))
        return;

    var bootstrapPassword = password!;
    var userManager = scope.ServiceProvider.GetRequiredService<UserManager<PlayHubUser>>();
    var adminUser = await userManager.FindByEmailAsync(email);
    if (adminUser is null)
    {
        adminUser = new PlayHubUser { UserName = email, Email = email, EmailConfirmed = true, DisplayName = "PlayHub Administrator", IsActive = true, LockoutEnabled = true };
        EnsureSucceeded(await userManager.CreateAsync(adminUser, bootstrapPassword), "Create bootstrap administrator");
    }
    if (!await userManager.IsInRoleAsync(adminUser, "Administrator"))
        EnsureSucceeded(await userManager.AddToRoleAsync(adminUser, "Administrator"), "Assign administrator role");
}

static void EnsureSucceeded(IdentityResult result, string operation)
{
    if (!result.Succeeded)
        throw new InvalidOperationException($"{operation} failed: {string.Join("; ", result.Errors.Select(error => error.Description))}");
}

static string Slugify(string value)
{
    var slug = string.Join("-", value.Trim().ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    return slug;
}

record LoginRequest(string Email, string Password);
record LoginResponse(string AccessToken, DateTimeOffset ExpiresAt, string Email, IList<string> Roles);
record CreateGameRequest(string Name, string? Description, string Category);
