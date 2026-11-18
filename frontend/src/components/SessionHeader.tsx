import type { ParseResult, TraceEntry } from '../api/types'
import { fmtTok, formatDuration, userInputText } from '../derive'

export type CallFilter = 'all' | 'failed' | 'slowest'

export default function SessionHeader({ result, entry, fileName, onInspect }: {
  result: ParseResult
  entry?: TraceEntry
  fileName?: string
  onInspect: (filter: CallFilter) => void
}) {
  const { result_info: stats, tool_calls: calls, session_info: session } = result
  const events = result.raw_events as { timestamp?: string; ts?: number; type?: string; message?: { content?: unknown } }[]
  const first = events.find((e) => e && (e.timestamp || typeof e.ts === 'number'))
  const started = first?.timestamp ? Date.parse(first.timestamp) : first?.ts
  const startDate = started == null ? null : new Date(started)
  const prompt = events.find((e) => e?.type === 'user' && userInputText(e.message?.content))
  const title = entry?.name || session.title || userInputText(prompt?.message?.content, 90) || fileName || session.session_id || '会话详情'
  const directory = entry?.directory || String(result.parse_debug.cwd ?? '')
  const failures = calls.filter((c) => c.is_error).length
  return <header className="run-heading">
    <h1>{title}</h1>
    <div className="run-meta">
      <b>{{ opencode: 'Opencode', gemini: 'Gemini CLI', claude_code: 'Claude Code', codeagent: 'CodeAgent' }[result.source] ?? result.source}</b>
      {directory && <span title={directory}>{directory}</span>}
      {startDate && Number.isFinite(startDate.getTime()) && <time dateTime={startDate.toISOString()}>开始于 {startDate.toLocaleString('zh-CN', { hour12: false })}</time>}
      {session.model && <span>{session.model}</span>}
    </div>
    <div className="run-metrics">
      <div><span>会话耗时</span><strong>{formatDuration(stats.duration_ms || entry?.durationMs || 0)}</strong></div>
      <div><span>输入 / 输出 Tokens</span><strong>{fmtTok(stats.total_input)} / {fmtTok(stats.total_output)}</strong></div>
      <button onClick={() => onInspect('all')}><span>工具调用 ↗</span><strong>{calls.length}</strong></button>
      <button disabled={!failures} onClick={() => onInspect('failed')} className={failures ? 'has-failures' : ''}><span>失败调用{failures > 0 && ' ↗'}</span><strong>{failures}</strong></button>
    </div>
  </header>
}
