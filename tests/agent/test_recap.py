from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from agent.providers import LLMConfig
from agent.recap import RecapAgent, RecapAgentError, RecapOptions, validate_clip_plan, validate_narration


class Planner:
    def __init__(self):
        self.phases = []

    def plan_cut(self, work_dir, options, source_ids):
        self.phases.append("cut")
        return {"clip_plan": {"clips": [{"start": 1, "end": 5, "reason": "observed"}]}, "story_plan": {"beats": []}}

    def plan_cut_narration(self, work_dir, options):
        self.phases.append("narration")
        return {"narration": [{"start": 0, "end": 2.5, "narration": "Voici le moment décisif.", "overlaps_speech": False}]}


class RecapTests(unittest.TestCase):
    def test_narration_shape_and_order(self):
        rows = validate_narration([{"start": 0, "end": 2, "narration": "Une phrase — claire."}])
        self.assertEqual(rows[0]["narration"], "Une phrase, claire.")
        with self.assertRaises(RecapAgentError):
            validate_narration([{"start": 2, "end": 1, "narration": "bad"}])
        with self.assertRaises(RecapAgentError):
            validate_narration([{"start": 0, "end": 2, "narration": "a"}, {"start": 1, "end": 3, "narration": "b"}])

    def test_multi_source_clip_plan_requires_real_source_id(self):
        with self.assertRaises(RecapAgentError):
            validate_clip_plan({"clips": [{"start": 0, "end": 3, "source_id": "invented"}]}, multi_source=True, source_ids={"source-a"})
        plan = validate_clip_plan({"clips": [{"start": 0, "end": 3, "source_id": "source-a"}]}, multi_source=True, source_ids={"source-a"})
        self.assertEqual(plan["clips"][0]["source_id"], "source-a")

    def test_agent_fills_both_cut_pauses_and_writes_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            video = root / "source.mp4"
            video.write_bytes(b"fake-test-media")
            work = root / "run"
            output = root / "final.mp4"
            planner = Planner()
            calls = []

            def runner(command, **_kwargs):
                calls.append(command)
                if len(calls) == 1:
                    (work / "agent_narration_brief.md").write_text("evidence", encoding="utf-8")
                    return subprocess.CompletedProcess(command, 1, "", "pause for clip plan")
                if len(calls) == 2:
                    self.assertTrue((work / "clip_plan.json").is_file())
                    (work / "edited_source.mp4").write_bytes(b"edit")
                    return subprocess.CompletedProcess(command, 1, "", "pause for narration")
                self.assertTrue((work / "narration.json").is_file())
                output.write_bytes(b"final")
                (work / "final_qc.json").write_text(json.dumps({"metadata": {"final_output": {"path": str(output)}, "warnings": []}}), encoding="utf-8")
                return subprocess.CompletedProcess(command, 0, "done", "")

            config = LLMConfig("ollama", "local", "", "http://127.0.0.1:11434/v1")
            agent = RecapAgent(config, planner=planner, runner=runner)
            receipt = agent.produce(RecapOptions((video,), work, edit_mode="cut"))
            self.assertEqual(receipt.status, "completed")
            self.assertEqual(receipt.final_output, output)
            self.assertEqual(planner.phases, ["cut", "narration"])
            self.assertEqual(len(calls), 3)
            saved = json.loads((work / "viral_hit_receipt.json").read_text(encoding="utf-8"))
            self.assertNotIn("api_key", json.dumps(saved))
            self.assertEqual(saved["llm"]["model"], "local")

    def test_dub_requires_rights_confirmation(self):
        with tempfile.TemporaryDirectory() as temp:
            video = Path(temp) / "source.mp4"
            video.write_bytes(b"fake")
            config = LLMConfig("ollama", "local", "", "http://127.0.0.1:11434/v1")
            agent = RecapAgent(config, planner=Planner(), runner=lambda *_args, **_kwargs: self.fail("must not run"))
            with self.assertRaisesRegex(RecapAgentError, "rights"):
                agent.produce(RecapOptions((video,), Path(temp) / "run", edit_mode="dub"))


if __name__ == "__main__":
    unittest.main()
