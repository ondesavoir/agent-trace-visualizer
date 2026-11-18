import { useMemo, useState } from 'react'
import type { ToolCall } from '../api/types'
import type { CallFilter } from './SessionHeader'
import { grouped } from '../derive'

export default function ToolInspector({ tools, filter, onFilter }: {
  tools: ToolCall[]
  filter: CallFilter
  onFilter: (filter: CallFilter) => void
}) {
  const [selected, setSelected] = useState<ToolCall | null>(null)
  const calls = useMemo(() => {
    if (filter === 'failed') return tools.filter((call) => call.is_error)
    if (filter === 'slowest') return [...tools].sort((a, b) => b.duration_ms - a.duration_ms)
    return tools
  }, [tools, filter])
  const call = selected && calls.includes(selected) ? selected : calls[0]
  return <section className="call-inspector">
    <div className="index-heading"><h3>工具调用明细</h3>
      <label>查看方式 <select className="pill-input" value={filter} onChange={(event) => { setSelected(null); onFilter(event.target.value as CallFilter) }}>
        <option value="all">执行顺序</option><option value="slowest">耗时最长优先</option><option value="failed">仅失败调用</option>
      </select></label>
    </div>
    {call ? <div className="call-layout">
      <div className="call-list" aria-label="工具调用列表">
        {calls.map((t, i) => <button key={i} aria-pressed={t === call} onClick={() => setSelected(t)}>
          <span><b>{t.name}</b><small>第 {t.turn_no} 轮 · 调用 #{t.call_idx + 1}{t.is_error && ' · 失败'}</small></span>
          <code>{t.duration_ms > 0 ? grouped(t.duration_ms) + ' ms' : '—'}</code>
        </button>)}
      </div>
      <article className="call-detail">
        <h3>{call.name}</h3>
        <p className="muted">{call.is_error ? '失败' : '完成'} · 第 {call.turn_no} 轮 · {grouped(call.tiktoken_tokens)} 输出 Tokens · {grouped(call.output_chars)} 字符</p>
        <h4>输入参数</h4><pre>{call.input == null ? '未记录输入' : JSON.stringify(call.input, null, 2)}</pre>
        <h4>返回结果</h4><pre>{call.output || '未记录输出'}</pre>
      </article>
    </div> : <p className="workspace-empty">{filter === 'failed' ? '这次会话没有失败调用。' : '这次会话没有工具调用。'}</p>}
  </section>
}
