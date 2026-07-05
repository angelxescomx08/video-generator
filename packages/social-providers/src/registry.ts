import { FacebookProvider } from "./facebook.provider";
import { YouTubeProvider } from "./youtube.provider";
import type { SocialPlatformProvider } from "./types";

export type SocialPlatformName = "youtube" | "facebook";

export function resolveSocialProvider(platform: SocialPlatformName): SocialPlatformProvider {
  switch (platform) {
    case "youtube":
      return new YouTubeProvider();
    case "facebook":
      return new FacebookProvider();
  }
}
