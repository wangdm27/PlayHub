using System.IO.Compression;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddHostedService<PublishWorker>();
var host = builder.Build();
host.Run();

sealed class PublishWorker(ILogger<PublishWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            logger.LogInformation("Publish worker heartbeat: waiting for package jobs");
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
    }
}
