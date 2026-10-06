// `at` and `isMidTurn` are absent on rows kept before they were recorded.
export type Said = { uuid: string; text: string; at?: number; isMidTurn?: boolean }

declare module 'claude-code' {
  interface PluginState {
    // `focus` is the row id of the message the transcript is at, or null before one is known.
    said: { prompts: Said[]; focus: string | null }
  }
}
