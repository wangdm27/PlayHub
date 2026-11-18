export interface GameResult { score?: number; win?: boolean; durationSeconds?: number }
export type PlayHubEvent = "game_page_view" | "game_loading_started" | "game_loading_completed" | "game_started" | "game_paused" | "game_resumed" | "game_over" | "game_error";

export class PlayHubSDK {
  private target: Window | null = null;
  constructor(private allowedOrigin = "*") {}
  async init() {
    this.target = window.parent !== window ? window.parent : null;
  }
  private send(type: string, data: Record<string, unknown> = {}) {
    if (this.target) this.target.postMessage({ source: "playhub-game", sdkVersion: "1.0.0", type, data }, this.allowedOrigin);
  }
  loadingComplete() { this.send("game_loading_completed"); }
  gameStart() { this.send("game_started"); }
  gamePause() { this.send("game_paused"); }
  gameResume() { this.send("game_resumed"); }
  gameOver(result?: GameResult) { this.send("game_over", result as unknown as Record<string, unknown>); }
  trackEvent(eventName: PlayHubEvent, data: Record<string, unknown> = {}) { this.send(eventName, data); }
  async showInterstitial() { this.trackEvent("game_error", { reason: "interstitial_not_supported" }); }
  async showRewardedAd() { return false; }
}
