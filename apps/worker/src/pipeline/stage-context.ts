import type { JobType, VideoStatus } from "@video-generator/db";

export interface StageDefinition {
  jobType: JobType;
  /** Video status set while this stage is running. */
  activeStatus: VideoStatus;
}

export const STAGES: Record<string, StageDefinition> = {
  script: { jobType: "script", activeStatus: "generating_script" },
  tts: { jobType: "tts", activeStatus: "generating_tts" },
  stock: { jobType: "stock_footage", activeStatus: "fetching_stock" },
  edl: { jobType: "edl", activeStatus: "building_edl" },
  render: { jobType: "render", activeStatus: "rendering" },
  publish: { jobType: "publish", activeStatus: "publishing" },
};
