# said

A Claude Code mod: `/said` opens a side panel listing every message you've sent in the session, as a timeline. Press one and the transcript scrolls back to it.

```
10:31 ● build a mod that lists my messages
      │
10:33 ● yes but pick a different / command
      ├─ sent is kinda misleading?
      │
10:36 ● are we ready to test the mod now?
```

- Each turn is a dot with the time you sent it; a message you sent while Claude was still working branches off its turn (`├─`).
- The accented dot follows the transcript: it marks the message you jumped to, or the topmost of your messages on screen as you scroll.
- Run `/said` again to close the panel.

## Install

In a Claude Code terminal session:

```
/plugin install said --marketplace hfknight/claude-mod-said
```

Answer `y` to add the marketplace, then press Enter to install at user scope. It's active straight away and in every session after.

## Notes

- Jumping needs Claude Code's fullscreen layout, where Claude Code scrolls the transcript itself. In the normal layout your terminal owns the scrollback.
- Only messages sent after the mod loads are listed; messages from before, or from a `--resume`, aren't.
- The list is per session and isn't saved.

## Develop

`claude plugin validate .` checks the manifest, marketplace and hooks module; `claude plugin test .` runs `tests/`. Run it from this folder with `claude --plugin-dir .`.

## License

MIT
