import { describe, expect, it } from "vitest";
import { buildCameraGameplayFilter, buildCutArgs, buildJumpCutArgs, buildVideoFilters } from "../cut";
import type { CameraGameplayLayout } from "../../shared/camera-layout";

const layout: CameraGameplayLayout = {
  cameraHeightFrac: 0.4,
  cameraCrop: { x: 0.1, y: 0.05, w: 0.4, h: 0.5 },
};

describe("composition verticale caméra au-dessus du gameplay", () => {
  it("duplique la source, applique le cadre manuel et assemble 1080×1920", () => {
    const graph = buildCameraGameplayFilter(layout);
    expect(graph).toContain("split=2[vh_cam][vh_game]");
    expect(graph).toContain("floor(iw*0.400000/2)*2");
    expect(graph).toContain("floor(iw*0.100000/2)*2");
    expect(graph).toContain("h=768:force_original_aspect_ratio=increase");
    expect(graph).toContain("h=1152:force_original_aspect_ratio=increase");
    expect(graph).toContain("[vh_camera][vh_gameplay]vstack=inputs=2");
  });

  it("place les finitions et les sous-titres après les deux zones, sans zoom incompatible", () => {
    const filters = buildVideoFilters({
      vertical: true,
      cameraGameplay: layout,
      autoZoom: { durationSec: 8, fps: 30 },
      subtitlePath: "/tmp/captions.ass",
    });
    const graph = filters.join(",");
    expect(graph).toContain("vstack=inputs=2,subtitles=filename='/tmp/captions.ass'");
    expect(graph).not.toContain("zoompan=");
    expect(graph).not.toContain("min(iw,ih*9/16)");
  });

  it("force le réencodage et fonctionne aussi après des coupes de silence", () => {
    const args = buildCutArgs("/source.mp4", "/clip.mp4", 0, 10, {
      mode: "copy",
      vertical: true,
      cameraGameplay: layout,
    });
    expect(args[args.indexOf("-vf") + 1]).toContain("vstack=inputs=2");
    expect(args).toContain("libx264");

    const jumped = buildJumpCutArgs("/source.mp4", "/clip.mp4", 0, [
      { startSec: 0, endSec: 4 },
      { startSec: 6, endSec: 10 },
    ], { vertical: true, cameraGameplay: layout });
    expect(jumped[jumped.indexOf("-filter_complex") + 1]).toContain("[vc]split=2[vh_cam][vh_game]");
  });

  it("ne change pas un export horizontal", () => {
    expect(buildVideoFilters({ vertical: false, cameraGameplay: layout })).toEqual([]);
  });
});
