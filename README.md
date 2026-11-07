<div align="center">

<img src="assets/icon.svg" alt="Orbit icon" width="128" height="128" />

# Orbit

**Claude Code sessions, replayed as trajectories.**

A local-first viewer for your Claude Code transcripts: timelines, agent graphs, token costs and diffs, live and searchable.

**[⬇ Download Orbit for macOS (Apple Silicon)](https://github.com/bugrasitemkar/orbit/releases/latest/download/Orbit-0.1.0-arm64.dmg)**

</div>

---

## Install

1. Download **`Orbit-0.1.0-arm64.dmg`** from the [latest release](https://github.com/bugrasitemkar/orbit/releases/latest).
2. Open it and drag **Orbit** into **Applications**.
3. Launch Orbit. Your browser opens at `http://localhost:4810`.

The app isn't notarized, so on first launch right-click Orbit and choose **Open**, or run:

```bash
xattr -dr com.apple.quarantine /Applications/Orbit.app
```

## Features

- 🕰 **Trajectory timeline**: turns, steps and tool calls with real durations, token columns and a scrubbing playhead.
- 🕸 **Agent graph**: the main session plus every subagent it spawned.
- ⚡ **Live tailing**: running sessions update in real time.
- 📊 **Analytics**: per-step token chart and cumulative cost curve.
- 📝 **Diff view**: every edited file as red/green hunks.
- 🔎 **Search**: Cmd+K full-text search across all sessions.
- 📤 **Export**: HTML, Markdown, JSON or raw JSONL.

## Screenshots

| Session browser | Trajectory timeline |
|---|---|
| ![Session browser](main%20page.png) | ![Trajectory timeline](timeline.png) |

| Diff view | Analytics |
|---|---|
| ![Diff view](files.png) | ![Analytics](analytics.png) |

## Privacy

Orbit runs entirely on your Mac. It reads `~/.claude/projects` read-only, serves only localhost and sends no telemetry. Its index lives in `~/Library/Application Support/Orbit`.

## License

MIT. See [LICENSE](./LICENSE).
