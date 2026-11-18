using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

public sealed class PlayHubDbContext(DbContextOptions<PlayHubDbContext> options)
    : IdentityDbContext<PlayHubUser, IdentityRole, string>(options)
{
    public DbSet<PlayHubGame> Games => Set<PlayHubGame>();
    public DbSet<PlayHubGameReview> GameReviews => Set<PlayHubGameReview>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.Entity<PlayHubGame>(entity =>
        {
            entity.HasKey(game => game.Id);
            entity.HasIndex(game => game.Slug).IsUnique();
            entity.Property(game => game.Name).HasMaxLength(160).IsRequired();
            entity.Property(game => game.Slug).HasMaxLength(160).IsRequired();
            entity.Property(game => game.Description).HasMaxLength(2000).IsRequired();
            entity.Property(game => game.Category).HasMaxLength(80).IsRequired();
            entity.Property(game => game.Status).HasMaxLength(32).IsRequired();
        });
        builder.Entity<PlayHubGameReview>(entity =>
        {
            entity.HasKey(review => review.Id);
            entity.HasIndex(review => new { review.GameId, review.Status });
            entity.Property(review => review.Status).HasMaxLength(32).IsRequired();
            entity.Property(review => review.Comment).HasMaxLength(2000);
            entity.HasOne<PlayHubGame>().WithMany().HasForeignKey(review => review.GameId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}

public sealed class PlayHubUser : IdentityUser
{
    public string DisplayName { get; set; } = "";
    public bool IsActive { get; set; } = true;
}

public sealed class PlayHubGame
{
    public Guid Id { get; set; }
    public string Slug { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Category { get; set; } = "";
    public string Status { get; set; } = "Draft";
    public Guid? CurrentPublishedVersionId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class PlayHubGameReview
{
    public Guid Id { get; set; }
    public Guid GameId { get; set; }
    public string Status { get; set; } = "Submitted";
    public string? Comment { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
