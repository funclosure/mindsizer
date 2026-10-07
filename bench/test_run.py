import unittest
import run


def card(topic, level=None, score=6.0):
    c = {"topic": topic, "style": "ink", "confounded": False, "cost": 1, "build": {"seconds": 1},
         "quiz": {"correct": 6, "partial": 0, "wrong": 0, "of": 8, "score": score},
         "fidelity": {"high": 0, "medium": 0, "low": 0}, "rubric": {"overall": 3.0},
         "states": {k: 0 for k in ("first_read_words", "look_alike", "small_text", "handwriting", "dup_keys", "script_errors", "close_new")},
         "newcomer": {"confidence": 4}, "mechanism": {"mean": 3.0, "gaps": 0}}
    if level: c["level"] = level
    return c


class LevelTests(unittest.TestCase):
    def test_level_line(self):
        self.assertEqual(run.level_line("low"), " Build it at low effort.")
        self.assertEqual(run.level_line("high"), " Build it at high effort.")

    def test_baseline_without_level_counts_as_high(self):
        base = {"cards": [card("commons", score=8.0)]}
        md = run.scorecard_md([card("commons", "high", score=6.0)], base)
        self.assertIn("quiz fell", md)

    def test_low_card_not_compared_with_high_baseline(self):
        base = {"cards": [card("commons", score=8.0)]}
        md = run.scorecard_md([card("commons", "low", score=4.0)], base)
        self.assertNotIn("quiz fell", md)
        self.assertNotIn("(-4)", md)

    def test_scorecard_shows_level(self):
        md = run.scorecard_md([card("commons", "medium")], None)
        self.assertIn("| commons | medium |", md)

    def test_save_baseline_refused_below_high(self):
        import sys, tempfile, pathlib
        from unittest import mock
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(run, "BENCH", pathlib.Path(tmp)), \
                 mock.patch.object(sys, "argv", ["run.py", "commons", "--level", "low", "--save-baseline"]):
                with self.assertRaises(SystemExit) as cm:
                    run.main()
            self.assertIn("--save-baseline only for --level high", str(cm.exception))
            self.assertFalse((pathlib.Path(tmp) / "runs").exists())


if __name__ == "__main__":
    unittest.main()
