// `at` and `isMidTurn` are absent on rows kept before they were recorded. `tookMs` and `ended`
// are how long Claude took over a turn and why it stopped, absent until it does.
export type Said = {
  uuid: string
  text: string
  at?: number
  isMidTurn?: boolean
  tookMs?: number
  ended?: 'answer' | 'aborted' | 'refusal' | 'error'
}

declare module 'claude-code' {
  interface PluginState {
    // `focus` is the row id of the message the transcript is at, or null before one is known.
    // `pulse` flips while a turn runs, its message's dot drawn hollow when it is false.
    said: { prompts: Said[]; focus: string | null; pulse: boolean }
  }
}
