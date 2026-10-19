export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type Task = { id: string; label: string; status: TaskStatus }
export type Usage = { tokens: number | null; window: number }

declare module 'claude-code' {
  interface PluginState {
    'progress-status': { tasks: Task[]; usage: Usage | null }
  }
}
