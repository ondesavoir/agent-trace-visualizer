// Claude Code view — 7 tabs (+ transcript-only 时间轴). Shared with
// embedded mode.

import { useMemo, useState } from 'react'
import type { ParseResult, TraceEntry } from '../../api/types'
import { useMermaid, useWorkflowTree } from '../../hooks'
import Plot, { plotColors } from '../../components/Plot'
import MermaidView from '../../components/MermaidView'
import TokenTrend from '../../components/TokenTrend'
import ReplayView from '../../components/ReplayView'
import RawEventsTab from '../../components/RawEventsTab'
import SessionHeader, { type CallFilter } from '../../components/SessionHeader'
import ToolInspector from '../../components/ToolInspector'
import ToolEfficiencyTable from '../../components/ToolEfficiencyTable'
import TimelineView from '../../components/TimelineView'
import { Tabs, DataTable, DebugJson, Expander, Info } from '../../components/ui/primitives'
import {
  fmtTok,
  formatDuration,
  buildTimeline,
  grouped,
} from '../../derive'

export default function ClaudeBody({
  result,
  live = false,
  liveEvents,
  initialTab,
  entry,
  fileName,
}: {
  result: ParseResult
  embedded?: boolean
  /// 实时监控模式：时间轴自动滚动 + 新行高亮；各 tab 随节流刷新更新
  live?: boolean
  /// 实时模式下的即时事件流（SSE 毫秒级）；未提供时用 result.raw_events
  liveEvents?: unknown[]
  /// 初始选中的 tab（实时模式默认落在时间轴）
  initialTab?: string
  entry?: TraceEntry
  fileName?: string
}) {
  const isTranscript = result.parse_debug.format === 'transcript'
  const [tab, setTab] = useState(initialTab ?? 'replay')
  const [callFilter, setCallFilter] = useState<CallFilter>('all')
  const inspectCalls = (filter: CallFilter) => {
    setCallFilter(filter)
    setTab('calls')
  }
  const workflowTree = useWorkflowTree(result)
  const mermaid = useMermaid({
    kind: 'sequence-claude',
    rawEvents: result.raw_events,
    isTranscript,
    maxEvents: 60,
    seed: 42,
  })

  const tabs = useMemo(() => {
    const base = [
      { key: 'replay', label: '会话回放' },
      { key: 'calls', label: '调用明细' },
      { key: 'overview', label: '总览' },
      { key: 'tokens', label: 'Token 趋势' },
    ]
    if (isTranscript) base.push({ key: 'timeline', label: '时间轴' })
    base.push(
      { key: 'tools', label: '工具执行' },
      { key: 'subagent', label: '子代理' },
      { key: 'cost', label: '成本分析' },
      { key: 'raw', label: '原始数据' },
    )
    return base
  }, [isTranscript])

  const overview = useMemo(() => {
    const eventTypes = new Map<string, number>()
    for (const raw of result.raw_events) {
      const t = String((raw as Record<string, unknown>).type ?? '?')
      eventTypes.set(t, (eventTypes.get(t) ?? 0) + 1)
    }
    const toolCounts = new Map<string, number>()
    for (const tc of result.tool_calls) toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1)
    return {
      eventTypes: [...eventTypes.entries()].sort((a, b) => b[1] - a[1]),
      toolCounts: [...toolCounts.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [result])

  return (
    <div className="session-detail">
      <SessionHeader result={result} entry={entry} fileName={fileName} onInspect={inspectCalls} />
      <Tabs items={tabs} active={tab} onChange={setTab} />

      {tab === 'replay' && (
        <ReplayView
          agent="claude_code"
          rawEvents={result.raw_events}
          workflowRoot={workflowTree.data ?? null}
          result={result}
        />
      )}

      {tab === 'overview' && (
        <OverviewTab result={result} overview={overview} mermaidSrc={mermaid.data?.src} />
      )}

      {tab === 'tokens' && <TokenTrend result={result} />}

      {tab === 'timeline' && isTranscript && (
        <TimelineTab rawEvents={liveEvents ?? result.raw_events} live={live} />
      )}

      {tab === 'tools' && (
        <div>
          <h3>工具执行与效率</h3>
          <ToolEfficiencyTable tools={result.tool_calls} />
          <h3>每次调用 Output Tokens</h3>
          <Plot
            data={[
              {
                type: 'bar',
                x: result.tool_calls.map((_, i) => i + 1),
                y: result.tool_calls.map((t) => t.tiktoken_tokens),
                marker: { color: '#1a73e8' },
                name: 'Tiktoken Tokens',
              },
            ]}
            layout={{ height: 280, margin: { t: 20, b: 40 }, xaxis: { title: '第 N 次调用' }, yaxis: { title: 'Tokens' } }}
          />
        </div>
      )}

      {tab === 'subagent' && <SubagentTab result={result} />}

      {tab === 'cost' && <CostTab result={result} />}

      {tab === 'raw' && <RawEventsTab rawEvents={result.raw_events} keyPrefix="claude" />}

      {tab === 'calls' && <ToolInspector key={callFilter} tools={result.tool_calls} filter={callFilter} onFilter={setCallFilter} />}
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────────

function OverviewTab({
  result,
  overview,
  mermaidSrc,
}: {
  result: ParseResult
  overview: { eventTypes: [string, number][]; toolCounts: [string, number][] }
  mermaidSrc?: string
}) {
  const ri = result.result_info
  return (
    <div>
      <div className="metric-row">
        <div className="metric-card"><div className="m-title">模型</div><div className="m-value" style={{ fontSize: 15 }}>{result.session_info.model || '—'}</div></div>
        <div className="metric-card"><div className="m-title">模型回复</div><div className="m-value">{result.token_usage?.length ?? 0}</div></div>
        <div className="metric-card"><div className="m-title">工具调用</div><div className="m-value">{result.tool_calls.length}</div></div>
        <div className="metric-card"><div className="m-title">总 Input</div><div className="m-value">{fmtTok(ri.total_input)}</div></div>
        <div className="metric-card"><div className="m-title">总 Output</div><div className="m-value">{fmtTok(ri.total_output)}</div></div>
        <div className="metric-card"><div className="m-title">耗时</div><div className="m-value">{formatDuration(ri.duration_ms)}</div></div>
      </div>
      <div className="two-col">
        <div>
          <h3>事件类型分布</h3>
          <Plot
            data={[{ type: 'bar', x: overview.eventTypes.map(([k]) => k), y: overview.eventTypes.map(([, v]) => v), marker: { color: overview.eventTypes.map((_, i) => plotColors(i)) } }]}
            layout={{ height: 280, margin: { t: 20, b: 60 } }}
          />
        </div>
        <div>
          <h3>工具调用分布</h3>
          <Plot
            data={[{ type: 'pie', labels: overview.toolCounts.map(([k]) => k), values: overview.toolCounts.map(([, v]) => v), hole: 0.4 }]}
            layout={{ height: 280, margin: { t: 20, b: 0 } }}
          />
        </div>
      </div>
      <h3>时序图</h3>
      {mermaidSrc && <MermaidView src={mermaidSrc} />}
    </div>
  )
}

// ── Subagent tab ──────────────────────────────────────────────
// Port of legacy claude `_tab_subagents`: dispatch overview + per-call
// detail expanders (基本信息 / 任务描述 / 输入参数 / 输出内容).

const SUBAGENT_NAMES = new Set(['task', 'Task', 'delegate', 'subagent', 'agent', 'Agent'])

function SubagentTab({ result }: { result: ParseResult }) {
  const subagentCalls = result.tool_calls.filter((tc) => SUBAGENT_NAMES.has(tc.name))

  if (subagentCalls.length === 0) {
    return (
      <div>
        <Info>本次会话未派发任何 subagent。（通过 task 工具派发子代理）</Info>
        <p className="muted">
          提示：如果使用了 `claude -p` 模式（stream-json），subagent 调用信息可能不完整。
          建议使用交互会话记录（transcript）模式获取完整数据。
        </p>
      </div>
    )
  }

  const overviewRows = subagentCalls.map((tc, i) => {
    const inp = isRecord(tc.input) ? tc.input : {}
    const desc = String(inp.description ?? inp.prompt ?? '—')
    return {
      '序号': i + 1,
      '类型': String(inp.subagent_type ?? inp.type ?? 'task'),
      '任务描述': desc.slice(0, 120),
      'Turn': tc.turn_no,
      '是否出错': tc.is_error ? '❌ 是' : '✅ 否',
      '输出大小': `${grouped(tc.output_chars)} chars`,
      'Tiktoken Tokens': grouped(tc.tiktoken_tokens),
      '耗时': tc.duration_ms > 0 ? `${tc.duration_ms.toFixed(0)}ms` : '—',
    }
  })

  return (
    <div>
      <h3>🤖 Subagent 派发概览（共 {subagentCalls.length} 个）</h3>
      <DataTable rows={overviewRows} />

      <hr />
      <h3>逐个 Subagent 详情</h3>
      {subagentCalls.map((tc, i) => {
        const inp = isRecord(tc.input) ? tc.input : {}
        const desc = String(inp.description ?? inp.prompt ?? '(无描述)')
        const subagentType = String(inp.subagent_type ?? inp.type ?? 'task')
        return (
          <Expander
            key={i}
            title={`🤖 Subagent #${i + 1}: ${desc.slice(0, 80)}  ${tc.is_error ? '❌' : '✅'}  Turn ${tc.turn_no}`}
          >
            <div className="two-col">
              <div>
                <p><b>基本信息</b></p>
                <p className="muted" style={{ whiteSpace: 'pre-line' }}>
                  {`类型: ${subagentType}\nTurn: ${tc.turn_no}\n调用序号: #${tc.call_idx + 1}\n输出大小: ${grouped(tc.output_chars)} chars\nTiktoken Tokens: ${grouped(tc.tiktoken_tokens)}${tc.duration_ms > 0 ? `\n耗时: ${tc.duration_ms.toFixed(0)}ms` : ''}${tc.file_path ? `\n关联文件: ${tc.file_path}` : ''}\n状态: ${tc.is_error ? '❌ 出错' : '✅ 成功'}`}
                </p>
              </div>
              <div>
                <p><b>任务描述</b></p>
                <div className="banner banner-info">{desc}</div>
              </div>
            </div>

            <Expander title="📥 输入参数（完整 JSON）">
              <DebugJson value={inp} />
            </Expander>

            <Expander title="📤 输出内容">
              {tc.output ? (
                <textarea className="tool-output" readOnly value={tc.output} rows={16} />
              ) : (
                <p className="muted">(无输出)</p>
              )}
            </Expander>
          </Expander>
        )
      })}
    </div>
  )
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ── Timeline (transcript only)：共享 TimelineView ─────────────

function TimelineTab({ rawEvents, live = false }: { rawEvents: unknown[]; live?: boolean }) {
  const model = useMemo(() => buildTimeline(rawEvents), [rawEvents])
  return <TimelineView model={model} live={live} />
}

// ── Cost analysis ─────────────────────────────────────────────

function CostTab({ result }: { result: ParseResult }) {
  const ri = result.result_info
  const totalCache = ri.total_cache_read + ri.total_cache_creation
  const apiMs = ri.duration_api_ms
  const localMs = Math.max(0, ri.duration_ms - ri.duration_api_ms)

  return (
    <div>
      <div className="metric-row">
        <div className="metric-card"><div className="m-title">总费用</div><div className="m-value">${ri.total_cost_usd.toFixed(4)}</div></div>
        <div className="metric-card"><div className="m-title">Cache Read</div><div className="m-value">{fmtTok(ri.total_cache_read)}</div></div>
        <div className="metric-card"><div className="m-title">Cache Creation</div><div className="m-value">{fmtTok(ri.total_cache_creation)}</div></div>
        <div className="metric-card"><div className="m-title">API 等待</div><div className="m-value">{apiMs > 0 ? formatDuration(apiMs) : '—'}</div></div>
        <div className="metric-card"><div className="m-title">本地处理</div><div className="m-value">{localMs > 0 ? formatDuration(localMs) : '—'}</div></div>
      </div>

      <h3>Token 构成</h3>
      <Plot
        data={[
          {
            type: 'pie',
            labels: ['Input', 'Output', 'Cache Read', 'Cache Creation'],
            values: [ri.total_input, ri.total_output, ri.total_cache_read, ri.total_cache_creation],
            hole: 0.4,
          },
        ]}
        layout={{ height: 320, margin: { t: 20, b: 0 } }}
      />

      <h3>API 等待 vs 本地处理</h3>
      <Plot
        data={[
          { type: 'bar', x: ['API 等待', '本地处理'], y: [apiMs, localMs], marker: { color: ['#ea4335', '#0a9e6a'] } },
        ]}
        layout={{ height: 260, margin: { t: 20, b: 40 }, yaxis: { title: 'ms' } }}
      />

      <h3>模型回复 Token 明细</h3>
      <DataTable
        rows={(result.token_usage ?? []).map((t, i) => ({
          '回复': i + 1,
          'Input': t.input == null ? '—' : grouped(t.input),
          'Output': t.output == null ? '—' : grouped(t.output),
          'Cache Read': t.cache_read == null ? '—' : grouped(t.cache_read),
          'Cache Creation': t.cache_write == null ? '—' : grouped(t.cache_write),
          '模型': t.model || '—',
        }))}
      />
      {totalCache === 0 && <Info>此会话无 cache 活动。</Info>}
    </div>
  )
}
