# Muse gadget bridge

This connects the desk to **Muse** through a Muse gadget built with Meta's open source
[Muse Gadget SDK](https://github.com/facebookincubator/muse-gadget-sdk). It uses the SDK's **Linux Device SDK**: a
Raspberry Pi (or any Linux box with Bluetooth LE) running the `musegadget` service, paired with the Muse app.

What you get:

- **Muse tells you** when the daily careers run ends (new companies, forms filled, how many wait for your approval),
  when it fails, and when an employer email comes in (interview, assessment, offer, rejection, application received).
  These arrive in a Muse side chat of their own.
- **You ask Muse**: "anything waiting on my internship desk?", "which applications need me?", "how many did I send
  today?". Muse runs `desk-status` on the gadget and answers from the desk's latest snapshot.

```
 PC (Windows)                          Raspberry Pi (Muse gadget)                   Muse
 ─────────────                         ───────────────────────────                  ────
 npm run daily ─┐                      desk-bridge.service (desk_bridge.py serve)
 sync-inbox ────┼─ POST /event ──────▶   ├─ text ──▶ musegadget send-user-msg ──────▶ side chat
 npm run muse:send ┘  (bearer token)     └─ snapshot ─▶ /var/lib/desk-bridge/status.json
                                       desk-status ◀──── system.run ◀─────────────── "anything waiting?"
```

The desk only sends. It is not served beyond the PC (`proxy.ts` is unchanged), and it holds no Muse credentials. The
bridge holds none either: `musegadget send-user-msg` uses the gadget's existing connection.

**Approving and submitting stay on the desk.** Nothing here can approve, submit, or send an email.

## Set it up

1. **The gadget.** Set up the Linux Device SDK on the Pi and pair it, following
   [its README](https://github.com/facebookincubator/muse-gadget-sdk/tree/main/linux). You need an SDK token from
   [gadgets.muse.ai](https://gadgets.muse.ai/settings/sdk-tokens), and you must accept the Gadget SDK Terms. Prefer an
   account without sudo for Muse (`bash install.sh --run-as someone`): Muse gets that account's access to the Pi.
2. **The bridge.** Copy this `muse/` directory to the Pi, then on the Pi:
   ```sh
   cd muse
   bash install.sh            # --user <account> if musegadget runs commands as another account
   ```
   It installs `desk-bridge.service` and `desk-status`, makes a token, opens a Muse side chat, and posts a hello there
   that tells Muse to run `desk-status` when you ask about the desk. It ends by printing two lines for the desk.
3. **The desk.** Put the two printed lines in `.env.local` on the PC:
   ```
   MUSE_BRIDGE_URL=http://192.168.1.50:8788
   MUSE_BRIDGE_TOKEN=…
   ```
   Then check the whole path:
   ```
   npm run muse:send                    # a test message in the Muse chat
   npm run muse:send -- --snapshot      # only refresh what desk-status shows
   npm run muse:send -- "any text"      # your own message
   ```

From then on, `npm run daily` (the 9:00 scheduled task too) and `npm run sync:inbox` send on their own, and
`npm run automate` also refreshes the snapshot every hour. With only the scheduled task, `desk-status` is as fresh as
the last daily run; schedule `npm run muse:send -- --snapshot` for more.

## Security

- The desk and the bridge share a token. The bridge reads nothing from a request until the token matches. It accepts
  only JSON and caps the body (512 KB) and the text (4,000 characters). It drops control characters.
- The link is plain HTTP on your LAN, like the SDK's Pebble ring example. Use it on a network you trust. Anyone who
  can read that traffic can learn the token and post into your Muse chat.
- Muse can run commands on the gadget, and the desk's messages name companies and postings found on the web. So
  email subjects and bodies are never forwarded. Every message is labeled for Muse as information, not instructions.
  Muse should still run as an account without sudo.
- The desk does not follow a redirect from the bridge, so the token is only ever sent to `MUSE_BRIDGE_URL`.

## Develop

```
npm run muse:check                              # desk side, offline (fake bridge)
python -m unittest discover -s muse/tests       # bridge side, anywhere (no Pi, no Muse)
```

| File | Role |
| --- | --- |
| `lib/notify/muse.ts` | the desk side: config, the snapshot (read-only queries), `notifyMuse`, the message texts |
| `scripts/muse-send.ts`, `scripts/muse-check.ts` | `npm run muse:send`, `npm run muse:check` |
| `muse/desk_bridge.py` | the bridge (`serve`) and `desk-status` (`status`); Python 3.9+, standard library only |
| `muse/install.sh`, `muse/desk-bridge.service` | install on the gadget (`--uninstall` removes it) |

On the Pi: `sudo journalctl -u desk-bridge -f` follows the bridge, and `desk-status --json` prints the raw snapshot.

**Ideas.** A dedicated `desk.status` Muse command, added to the SDK's `executor.py` (`COMMAND_SPECS` plus a branch in
`Executor.run`, see its `AGENTS.md`), would save Muse from going through `system.run`. An ESP32 gadget with a screen
(M5Stack, Waveshare round AMOLED) could show the approvals count on your desk.
