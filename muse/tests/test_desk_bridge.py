"""Tests for muse/desk_bridge.py. No Muse, gadget or Linux needed:
    python -m unittest discover -s muse/tests
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import desk_bridge  # noqa: E402

SECRET = "a-test-secret-of-some-length"


class FakeSender:
    def __init__(self) -> None:
        self.sent: list[str] = []
        self.event = threading.Event()

    def __call__(self, text: str):
        self.sent.append(text)
        self.event.set()
        return True, "message_id: 1"


class BridgeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.mkdtemp()
        self.state = os.path.join(self.dir, "state", "status.json")
        self.sender = FakeSender()
        handler = type("H", (desk_bridge.Handler,), {})
        handler.secret = SECRET
        handler.state_path = self.state
        handler.outbox = desk_bridge.Outbox(self.sender)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def post(self, body, token=SECRET, content_type="application/json", path="/event"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method="POST")
        req.add_header("Content-Type", content_type)
        if token is not None:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as err:
            with err:
                return err.code, json.loads(err.read())

    def test_health(self):
        with urllib.request.urlopen(self.base + "/health", timeout=5) as res:
            self.assertEqual(res.status, 200)

    def test_rejects_missing_or_wrong_token(self):
        self.assertEqual(self.post({"kind": "test", "text": "hi"}, token=None)[0], 401)
        self.assertEqual(self.post({"kind": "test", "text": "hi"}, token="wrong")[0], 401)
        self.assertEqual(self.post({"kind": "test", "text": "hi"}, token="é")[0], 401)
        self.assertEqual(self.sender.sent, [])

    def test_rejects_bad_bodies(self):
        self.assertEqual(self.post(b"not json")[0], 400)
        self.assertEqual(self.post({"kind": "rm -rf", "text": "hi"})[0], 400)
        self.assertEqual(self.post({"kind": "test"})[0], 400)
        self.assertEqual(self.post({"kind": "test", "text": 5})[0], 400)
        self.assertEqual(self.post({"kind": "test", "text": "hi"}, content_type="text/plain")[0], 415)
        self.assertEqual(self.post({"kind": "test", "text": "hi"}, path="/other")[0], 404)

    def test_message_is_framed_and_sent(self):
        status, body = self.post({"kind": "daily_run", "text": "Internship desk: done.\x07\x1b[31m"})
        self.assertEqual(status, 202)
        self.assertTrue(body["queued"])
        self.assertTrue(self.sender.event.wait(5))
        sent = self.sender.sent[0]
        self.assertTrue(sent.startswith(desk_bridge.FRAME))
        self.assertTrue(sent.endswith("Internship desk: done.[31m"))  # control characters dropped
        self.assertFalse(os.path.exists(self.state))

    def test_snapshot_only_is_kept_not_sent(self):
        snap = {"awaiting_approval": {"count": 2, "items": []}}
        status, body = self.post({"kind": "snapshot", "text": None, "snapshot": snap})
        self.assertEqual(status, 202)
        self.assertTrue(body["stored"])
        self.assertFalse(body["queued"])
        with open(self.state, encoding="utf-8") as f:
            record = json.load(f)
        self.assertEqual(record["snapshot"], snap)
        time.sleep(0.1)
        self.assertEqual(self.sender.sent, [])

    def test_long_text_clipped(self):
        self.post({"kind": "test", "text": "x" * 10000})
        self.assertTrue(self.sender.event.wait(5))
        self.assertEqual(len(self.sender.sent[0]) - len(desk_bridge.FRAME), desk_bridge.MAX_TEXT)


class StatusTest(unittest.TestCase):
    def record(self, received: datetime) -> dict:
        return {
            "received_at": received.isoformat(),
            "snapshot": {
                "desk_url": "http://127.0.0.1:3001",
                "awaiting_approval": {"count": 1, "items": [{"company": "Acme", "title": "Dev intern", "location": "Montreal"}]},
                "needs_you": {"count": 1, "items": [{"company": "Bolt", "title": "QA intern", "reason": "CAPTCHA"}]},
                "pipeline": {"ready": 3, "applied": 9},
                "submitted_today": 2,
                "followups_due": 4,
                "latest_daily_run": {"started_at": "2026-10-07T13:00:00Z", "finished_at": None, "new_companies": 1, "new_jobs": 5},
            },
        }

    def test_render(self):
        now = datetime.now(timezone.utc).astimezone()
        out = desk_bridge.render_status(self.record(now - timedelta(minutes=5)), now)
        self.assertIn("5 min ago", out)
        self.assertIn("Waiting for approval: 1", out)
        self.assertIn("Acme: Dev intern (Montreal)", out)
        self.assertIn("Bolt: QA intern - CAPTCHA", out)
        self.assertIn("Submitted today: 2 · Follow-ups due: 4", out)
        self.assertIn("Applications: applied 9, ready 3", out)
        self.assertIn("still running", out)
        self.assertIn("http://127.0.0.1:3001/approvals", out)
        self.assertNotIn("STALE", out)

    def test_stale(self):
        now = datetime.now(timezone.utc).astimezone()
        self.assertIn("STALE", desk_bridge.render_status(self.record(now - timedelta(hours=30)), now))

    def test_empty_snapshot(self):
        out = desk_bridge.render_status({"snapshot": {}})
        self.assertIn("Waiting for approval: 0", out)


if __name__ == "__main__":
    unittest.main()
