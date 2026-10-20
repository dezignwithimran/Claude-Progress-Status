export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type Task = { id: string; label: string; status: TaskStatus }
export type Usage = { tokens: number | null; window: number }
// Steps of the current request, for work done without a task list.
export type Activity = { steps: number; last: string | null; isWorking: boolean }

declare module 'claude-code' {
  interface PluginState {
    'progress-status': { tasks: Task[]; usage: Usage | null; activity: Activity }
  }
}
