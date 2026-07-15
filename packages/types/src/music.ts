export interface MusicSearchRequest {
  tags: string[];
  minDurationSeconds?: number;
  perPage?: number;
}

export interface MusicTrackRef {
  id: string;
  provider: string;
  title: string;
  artist?: string;
  url: string;
  previewUrl?: string;
  durationSeconds: number;
  licenseName?: string;
  attribution?: string;
}
