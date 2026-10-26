from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from agent import setup_media


class MediaSetupTests(unittest.TestCase):
    def test_pinned_cached_ffmpeg_skips_pip_download(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp)
            binary = target / "imageio_ffmpeg" / "binaries" / "ffmpeg-test-v7.0.2"
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b"cached-test-binary")
            binary.chmod(binary.stat().st_mode | 0o111)
            (target / f"imageio_ffmpeg-{setup_media.VERSION}.dist-info").mkdir()

            with patch.object(setup_media, "TARGET", target), patch("agent.setup_media.subprocess.run") as run:
                self.assertEqual(setup_media.main(), 0)
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
