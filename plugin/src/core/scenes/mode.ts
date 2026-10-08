// The spinner's turn phase, folded into the three moods every game animates.
export type Mode = 'think' | 'tool' | 'reply'

export type SpinnerMode = 'requesting' | 'responding' | 'thinking' | 'tool-input' | 'tool-use'

export function modeOf(mode: SpinnerMode | undefined): Mode {
  if (mode === 'tool-use' || mode === 'tool-input') return 'tool'
  if (mode === 'responding') return 'reply'
  return 'think'
}

export function modeLabel(mode: SpinnerMode | undefined): string {
  switch (mode) {
    case 'tool-use':
      return 'running tool'
    case 'tool-input':
      return 'writing tool input'
    case 'responding':
      return 'responding'
    case 'requesting':
      return 'requesting'
    default:
      return 'thinking'
  }
}
