import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Said } from '../types'

const PANE = 'said'
const prompts = atom({ plugin: 'said', key: 'prompts' } as const, [] as Said[])
const focus = atom({ plugin: 'said', key: 'focus' } as const, null as string | null)
const pulse = atom({ plugin: 'said', key: 'pulse' } as const, false)

// Row ids of the person's messages the transcript shows now, as their rows report it.
const shown = new Set<string>()
// The topmost of them when the focus last followed it.
let top: string | undefined

// The focus follows the topmost of those when that changes, so a message sent below
// it keeps the focus; with none on screen it stays where it was.
const follow = async ($: EngineInterface) => {
  const first = (await read($, prompts)).find(one => shown.has(one.uuid))
  if (first?.uuid === top) return
  top = first?.uuid
  if (first !== undefined) await update($, focus, () => first.uuid)
}

// The message whose turn is running, its dot pulsing on the beat; a reload forgets it.
let running: string | undefined
let beat: Timer | undefined

// The pane's window and its tree's height when it was last drawn.
let seen: { offset: number; bodyRows: number; total: number } | undefined

// Whether a turn was interrupted since the latest message was checked for.
let isAborted = false

// The slash command stored last, listed once a turn starts with it: one that runs
// no turn (`/clear`, `/model`, `/said`) never is.
let waiting: { uuid: string; text: string; at: number } | undefined

// Esc before Claude answers takes the message back into the prompt: once the
// conversation holds fewer messages of the latest one's text than are listed, it goes.
const dropTaken = async ($: EngineInterface) => {
  const list = await read($, prompts)
  const latest = list.findLast(one => !one.isMidTurn)
  if (latest === undefined) return
  const words = latest.text.trim()
  const kept = (await $.session.messages()).filter(m => m.role === 'user' && m.text.trim() === words).length
  const listed = list.filter(one => !one.isMidTurn && one.text.trim() === words).length
  if (kept < listed) await update($, prompts, now => now.filter(one => one.uuid !== latest.uuid))
}

// Lists a message the person sent and gives it the focus; a turn's message pulses
// until the turn ends.
const record = async ($: EngineInterface, one: Said & { at: number; isMidTurn: boolean }) => {
  await update($, prompts, list => [...list, one])
  await update($, focus, () => one.uuid)
  // The pane follows it down once it is drawn with it; with the pane closed, the
  // scroll is refused and nothing moves.
  $.clock.after(100, () => void $.ui.scroll({ in: PANE, to: 'end' }))
  if (!one.isMidTurn) {
    running = one.uuid
    beat ??= $.clock.every(800, () => void update($, pulse, isLit => !isLit))
  }
}

// One line: whitespace collapsed, cut to the room with an ellipsis.
export const shorten = (text: string, room: number) => {
  const flat = text.replace(/\s+/g, ' ').trim() || '(no text)'
  return flat.length <= room ? flat : flat.slice(0, Math.max(1, room - 1)) + '…'
}

// A message sent mid-turn reaches the model inside the engine's reminder
// ("The user sent a new message while you were working: …", then "IMPORTANT: …"
// or "This is how Claude Code surfaces …");
// this is the person's own words from it.
export const unframe = (text: string) => {
  const sent = text.match(/new message while you were working:\s*([\s\S]*?)\s*(?:\n\s*(?:IMPORTANT:|This is how Claude Code)|<\/system-reminder>|$)/)
  return (sent?.[1] ?? text).replace(/<\/?system-reminder>/g, '').trim()
}

// A slash command is stored inside the engine's tags; this is its name as typed,
// less a plugin's namespace, and the words after it. Undefined for any other message.
export const command = (text: string) => {
  const name = text.match(/<command-name>\s*\/?(?:[^<:]*:)?([^<]*?)\s*<\/command-name>/)?.[1]
  if (name === undefined) return undefined
  const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? ''
  return { name: `/${name}`, args: args.trim() }
}

// 24-hour local time, as `10:36`.
export const clockTime = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// A length of time to the second, as `38s`, `4m12s` or `1h05m`.
export const span = (ms: number) => {
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  if (s < 60) return `${s}s`
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

// A pause between turns to the minute, as `25m` or `1h05m`.
export const pause = (ms: number) => {
  const m = Math.round(ms / 60_000)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

// What ends a turn's row once Claude is done: how long it took, after ✗ if you interrupted
// it or ! if it stopped on an error or a refusal. Nothing for a mid-turn message.
export const tail = (one: Said) => {
  if (one.isMidTurn || one.tookMs === undefined) return undefined
  const mark = one.ended === 'aborted' ? '✗ ' : one.ended === 'error' || one.ended === 'refusal' ? '! ' : ''
  return mark + span(one.tookMs)
}

// Turns this far apart get the pause shown between them.
const LONG_PAUSE = 10 * 60_000

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'said',
      description: 'Toggle a pane of the messages you sent; press one to jump to it',
    })
    return next(e)
  })

  on('command.run', { command: 'said' }, async $ => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Closed the Said pane.' }
    }
    const opened = await $.ui.open({ id: PANE, title: 'Said' })
    // Opens at the latest message. The body becomes this plugin's to scroll a moment
    // after the pane is placed ("not this plugin's site" until then), so it retries.
    for (let tries = 0; opened.isPlaced && tries < 10; tries++) {
      if ((await $.ui.scroll({ in: PANE, to: 'end' })).deny === undefined) break
      await $.clock.sleep(20)
    }
    return { text: 'Opened the Said pane.' }
  })

  // A turn's length and ending go on the latest turn listed, once: a turn nobody sent
  // (a background agent's report) finds it already timed.
  // A turn interrupted may have taken its message back; it is gone from the
  // conversation by now, or by the next message, which checks again.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      running = undefined
      beat?.cancel()
      beat = undefined
      await update($, pulse, () => false)
      await update($, prompts, list => {
        const i = list.findLastIndex(one => !one.isMidTurn)
        if (i === -1 || list[i]?.tookMs !== undefined) return list
        return list.map((one, j) => (j === i ? { ...one, tookMs: e.durationMs, ended: e.reason } : one))
      })
    }
    if (e.isAborted && e.agentId === undefined) {
      isAborted = true
      await dropTaken($)
    }
    return done
  })

  // The person's own prompts on the main conversation, kept with the row id
  // the transcript draws them under; one sent mid-turn comes in as a delivery.
  on('session.append', async ($, e, next) => {
    const isPersons = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const isPrompt = e.door === 'prompt' || e.door === 'delivery'
    // Checked before this one is stored, so the same words sent again aren't counted.
    if (isPrompt && isPersons && e.agentId === undefined && isAborted) {
      isAborted = false
      await dropTaken($)
    }
    const stored = await next(e)
    if (e.agentId === undefined && stored.deny === undefined) {
      const text = stored.message.content.map(block => (block.type === 'text' ? block.text : '')).join(' ')
      if (isPrompt && isPersons) await record($, { uuid: stored.uuid, text, at: await $.clock.now(), isMidTurn: e.door === 'delivery' })
      // Its origin doesn't say who ran it; a turn that starts with its text does.
      if (e.door === 'command' && command(text) !== undefined) waiting = { uuid: stored.uuid, text, at: await $.clock.now() }
    }
    return stored
  })

  on('turn.start', async ($, e, next) => {
    if (waiting !== undefined && waiting.text.trim() === e.text.trim()) {
      await record($, { ...waiting, isMidTurn: false })
      waiting = undefined
    }
    return next(e)
  })

  // Passes every row through as drawn, noting only whether it is on screen. A render
  // hook may not write, so the change is handed to a timer.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const isPersons = e.props.origin.kind === 'composer' || e.props.origin.kind === 'bridge'
    if (isPersons && e.props.onScreen !== undefined) {
      const was = shown.has(e.requestId)
      if (e.props.onScreen === null) shown.delete(e.requestId)
      else shown.add(e.requestId)
      if (was !== shown.has(e.requestId)) $.clock.after(0, () => void follow($))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, prompts)
    if (list.length === 0) return <Text dimColor>Nothing said yet.</Text>

    const columns = e.props.bodyColumns
    // The accent marks the turn the transcript is at: the focus, or a mid-turn focus's
    // turn; the latest turn while there is none.
    const current = await read($, focus)
    let accent = list.findIndex(one => one.uuid === current)
    if (accent === -1) accent = list.findLastIndex(one => !one.isMidTurn)
    while (accent > 0 && list[accent]?.isMidTurn) accent--
    const midTurns = list.filter(one => one.isMidTurn).length
    const working = list.reduce((sum, one) => sum + (one.tookMs ?? 0), 0)
    // Rows the tree takes: one per message, the rail between turns, the rule and the footer.
    const total = list.length + list.filter((one, i) => i > 0 && !one.isMidTurn).length + 2
    // A pane at the end stays there when it gets shorter (the prompt grows, a notice shows)
    // or the list longer, so the footer stays in view; scrolling up moves neither.
    const { offset, bodyRows } = e.props.scroll
    const wasAtEnd = seen !== undefined && seen.offset + seen.bodyRows >= seen.total
    const isResized = seen !== undefined && (seen.bodyRows !== bodyRows || seen.total !== total)
    if (wasAtEnd && isResized && offset + bodyRows < total) $.clock.after(0, () => void $.ui.scroll({ in: PANE, to: 'end' }))
    seen = { offset, bodyRows, total }
    const isLit = running === undefined || (await read($, pulse))
    return (
      // Docked, it fills the pane so the footer sits at the bottom under a short list.
      <Box flexDirection="column" minHeight={e.props.placement === 'dock' ? bodyRows : undefined}>
        {list.flatMap((one, i) => {
          const jump = async () => {
            await update($, focus, () => one.uuid)
            const moved = await $.ui.scroll({ to: { requestId: one.uuid }, block: 'start' })
            if (moved.deny !== undefined) $.ui.toast(`Couldn't jump there: ${moved.deny}`)
          }
          // A turn is a dot on the rail; a message sent mid-turn branches off it.
          const marker = one.isMidTurn ? (
            <Text color="subtle">{'      ├─ '}</Text>
          ) : (
            <Text>
              <Text color={i === accent ? 'claude' : 'subtle'}>
                {one.at === undefined ? '     ' : clockTime(one.at)}
                {` ${(i === accent ? '●○' : '•◦')[one.uuid === running && !isLit ? 1 : 0]} `}
              </Text>
            </Text>
          )
          const width = one.isMidTurn ? 9 : 8
          // The end of the row sits at the right edge, dot leaders running up to it.
          const end = tail(one)
          const slash = command(one.text)
          const words = slash === undefined ? (one.isMidTurn ? unframe(one.text) : one.text) : `${slash.name} ${slash.args}`
          const label = shorten(words, columns - width - (end === undefined ? 0 : end.length + 3))
          const after =
            end === undefined
              ? []
              : [
                  <Text key={`t-${one.uuid}`}>
                    <Text color="subtle">{` ${'·'.repeat(Math.max(1, columns - width - label.length - end.length - 2))} `}</Text>
                    <Text color="subtle">{end}</Text>
                  </Text>,
                ]
          const row = (
            <Box key={`r-${one.uuid}`} flexDirection="row">
              {marker}
              {slash === undefined ? (
                <Button key={`m-${one.uuid}`} plain label={label} dimColor={one.isMidTurn} hover={{ color: 'claude' }} onPress={jump} />
              ) : (
                // The command's name in grey, the words after it as any message's.
                <Button key={`m-${one.uuid}`} plain hover={{ color: 'claude' }} onPress={jump}>
                  <Text color="subtle">{label.slice(0, slash.name.length)}</Text>
                  {label.slice(slash.name.length)}
                </Button>
              )}
              {after}
            </Box>
          )
          if (i === 0 || one.isMidTurn) return [row]
          // A long pause since the turn before shows on the rail between them.
          const before = list.slice(0, i).findLast(other => !other.isMidTurn)
          const idle = one.at === undefined || before?.at === undefined ? 0 : one.at - before.at - (before.tookMs ?? 0)
          return [
            <Text key={`g-${one.uuid}`} color="subtle">
              {idle >= LONG_PAUSE ? `      ┆ ${pause(idle)}` : '      │'}
            </Text>,
            row,
          ]
        })}
        <Box key="spacer" flexGrow={1} />
        {/* Under the list, where the pane sits, so it stays in view. */}
        <Text key="rule" color="subtle">
          {'─'.repeat(columns)}
        </Text>
        <Text key="footer">
          <Text bold>said</Text>
          <Text color="inactive">
            {` · ${list.length} sent${midTurns > 0 ? ` · ${midTurns} mid-turn` : ''}${working > 0 ? ` · ${span(working)} working` : ''}`}
          </Text>
        </Text>
      </Box>
    )
  })
}
