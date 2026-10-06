import { expect, test } from 'claude-code/testing'

import { clockTime, shorten, unframe } from '../hooks/register'

const PANE = {
  plugin: 'said',
  component: 'Pane',
  requestId: 'said',
  props: { title: 'Said', isFocused: false, bodyColumns: 30, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('an empty session says so on every surface', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /Nothing said yet/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a prompt becomes one line that fits the room', async () => {
  expect(shorten('fix the   flaky\ncrop test please', 40)).toBe('fix the flaky crop test please')
  expect(shorten('fix the flaky crop test please', 10)).toBe('fix the f…')
  expect(shorten('  \n ', 10)).toBe('(no text)')
})

test('a mid-turn message is shown without the reminder around it', async () => {
  const framed =
    '<system-reminder>\nThe user sent a new message while you were working:\ninclude a trailing call\n\nIMPORTANT: After completing your current task, you MUST address the user\'s message above. Do not ignore it.\n</system-reminder>'
  expect(unframe(framed)).toBe('include a trailing call')
  const newer =
    'The user sent a new message while you were working:\ninclude a trailing call\n\nThis is how Claude Code surfaces messages the user sends mid-turn.'
  expect(unframe(newer)).toBe('include a trailing call')
  expect(unframe('just the words')).toBe('just the words')
})

test('a time reads as 24-hour local hours and minutes', async () => {
  expect(clockTime(new Date(2026, 9, 6, 9, 5).getTime())).toBe('09:05')
  expect(clockTime(new Date(2026, 9, 6, 22, 41).getTime())).toBe('22:41')
})
