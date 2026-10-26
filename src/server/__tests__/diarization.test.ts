import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transcript } from "../../shared/api-types";

const mocks = vi.hoisted(() => ({
  ensureModel: vi.fn(),
  runDiarization: vi.fn(),
  labelTranscript: vi.fn(),
  detectHighlights: vi.fn(),
  probeMedia: vi.fn(),
  loadReviewMemory: vi.fn(),
  loadPerformanceMemory: vi.fn(),
}));

vi.mock(import("../../core/models"), async (importOriginal) => ({
  ...(await importOriginal()),
  ensureModel: mocks.ensureModel,
}));
vi.mock("../../core/diarize", () => ({
  runDiarization: mocks.runDiarization,
  labelTranscript: mocks.labelTranscript,
}));
vi.mock("../../core/highlight/detect", () => ({
  detectHighlights: mocks.detectHighlights,
  chatComplete: vi.fn(),
}));
vi.mock("../../core/probe", () => ({ probeMedia: mocks.probeMedia }));
vi.mock("../../core/media-evidence", () => ({
  collectSignalsEvidence: vi.fn().mockResolvedValue(undefined),
  collectVisionEvidence: vi.fn(),
}));
vi.mock("../../core/review-memory", () => ({
  loadReviewMemory: mocks.loadReviewMemory,
  recordReview: vi.fn(),
}));
vi.mock("../../core/performance-memory", () => ({
  clearPerformanceMemory: vi.fn(),
  importPerformanceFile: vi.fn(),
  loadPerformanceMemory: mocks.loadPerformanceMemory,
  summarizePerformance: vi.fn(),
}));

import { LocalService } from "../service";

function transcript(): Transcript {
  return {
    language: "fr", engine: "whisper-fr", durationSec: 4,
    segments: [{ id: 1, startSec: 0, endSec: 4, text: "Bonjour les amis", words: [] }],
  };
}

const llm = { provider: "builtin", baseUrl: "builtin://local", model: "builtin", apiKey: "" };
const filePath = "/tmp/viral-hit-diarization-test/uploads/source.mp4";

async function detect(): Promise<Record<string, unknown>> {
  const service = new LocalService({ emit: vi.fn() } as never);
  return await service.invoke("detectHighlights", [
    transcript(), llm, filePath, true, null, null, "auto", [], null, null, { maxClips: 8 }, false,
  ]) as Record<string, unknown>;
}

describe("browser speaker diarization", () => {
  beforeEach(() => {
    process.env.VIRALHIT_DATA_DIR = "/tmp/viral-hit-diarization-test";
    mocks.ensureModel.mockResolvedValue(undefined);
    mocks.runDiarization.mockResolvedValue([{ startSec: 0, endSec: 4, speaker: 0 }]);
    mocks.labelTranscript.mockImplementation((value: Transcript) => ({
      ...value,
      segments: value.segments.map((segment) => ({ ...segment, speaker: 0 })),
    }));
    mocks.detectHighlights.mockImplementation(async (value: Transcript) => ({ candidates: [], received: value }));
    mocks.probeMedia.mockResolvedValue(null);
    mocks.loadReviewMemory.mockResolvedValue([]);
    mocks.loadPerformanceMemory.mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.VIRALHIT_DATA_DIR;
    vi.clearAllMocks();
  });

  it("uses the same local speaker models as desktop and returns the labeled transcript", async () => {
    const result = await detect();
    expect(mocks.ensureModel).toHaveBeenCalledTimes(2);
    expect(mocks.runDiarization).toHaveBeenCalledWith(filePath, expect.any(String));
    expect(mocks.detectHighlights.mock.calls[0][0].segments[0].speaker).toBe(0);
    expect(mocks.detectHighlights.mock.calls[0][10]).toMatchObject({ maxClips: 8 });
    expect((result.transcript as Transcript).segments[0].speaker).toBe(0);
  });

  it("continues highlight detection when the optional diarization stage fails", async () => {
    mocks.runDiarization.mockRejectedValue(new Error("native model unavailable"));
    const result = await detect();
    expect(mocks.detectHighlights).toHaveBeenCalledOnce();
    expect(result.candidates).toEqual([]);
    expect((result.transcript as Transcript).segments[0].text).toBe("Bonjour les amis");
  });
});
