import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Said } from '../types'

const PANE = 'said'
const prompts = atom({ plugin: 'said', key: 'prompts' } as const, [] as Said[])
const focus = atom({ plugin: 'said', key: 'focus' } as const, null as string | null)

// Row ids of the person's messages the transcript shows now, as their rows report it.
const shown = new Set<string>()

// The focus follows the topmost of those; with none on screen it stays where it was.
const follow = async ($: EngineInterface) => {
  const top = (await read($, prompts)).find(one => shown.has(one.uuid))
  if (top !== undefined) await update($, focus, () => top.uuid)
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

// 24-hour local time, as `10:36`.
export const clockTime = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

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
    await $.ui.open({ id: PANE, title: 'Said' })
    return { text: 'Opened the Said pane.' }
  })

  // The person's own prompts on the main conversation, kept with the row id
  // the transcript draws them under; one sent mid-turn comes in as a delivery.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    const isPersons = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const isPrompt = e.door === 'prompt' || e.door === 'delivery'
    if (isPrompt && isPersons && e.agentId === undefined && stored.deny === undefined) {
      const text = stored.message.content.map(block => (block.type === 'text' ? block.text : '')).join(' ')
      const at = await $.clock.now()
      const isMidTurn = e.door === 'delivery'
      await update($, prompts, list => [...list, { uuid: stored.uuid, text, at, isMidTurn }])
    }
    return stored
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
    return (
      <Box flexDirection="column">
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
              <Text color="subtle">{one.at === undefined ? '     ' : clockTime(one.at)}</Text>
              <Text color={i === accent ? 'claude' : 'inactive'}>{' ● '}</Text>
            </Text>
          )
          const width = one.isMidTurn ? 9 : 8
          const row = (
            <Box key={`r-${one.uuid}`} flexDirection="row">
              {marker}
              <Button
                key={`m-${one.uuid}`}
                plain
                label={shorten(one.isMidTurn ? unframe(one.text) : one.text, columns - width)}
                dimColor={one.isMidTurn}
                hover={{ color: 'claude' }}
                onPress={jump}
              />
            </Box>
          )
          if (i === 0 || one.isMidTurn) return [row]
          return [
            <Text key={`g-${one.uuid}`} color="subtle">
              {'      │'}
            </Text>,
            row,
          ]
        })}
      </Box>
    )
  })
}
