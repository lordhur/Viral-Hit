export type ProductionJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface RecapJobInput {
  videos: string[];
  workDir?: string;
  editMode?: "full" | "cut" | "dub";
  audioMode?: "narration" | "source-mix" | "adopted-packet-copy";
  style?: string;
  language?: string;
  context?: string;
  targetDuration?: string;
  outputDir?: string;
  skipAsr?: boolean;
  burnSubtitles?: boolean;
  confirmVoiceRights?: boolean;
}

export interface ProductionJob {
  id: string;
  kind: "recap";
  status: ProductionJobStatus;
  createdAt: string;
  updatedAt: string;
  workDir: string;
  videos: string[];
  finalOutput: string | null;
  error: string | null;
  logPath: string;
  request?: RecapJobInput;
}
