// Opencode view — 6 tabs (port of legacy views/opencode.py). The `Body`
// component renders from a ParseResult and is shared with embedded mode.

import { useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import type { ParseResult, TraceEntry } from '../../api/types'
import { api } from '../../api/client'
import { useMermaid, useWorkflowTree } from '../../hooks'
import Plot, { plotColors } from '../../components/Plot'
import MermaidView from '../../components/MermaidView'
import TokenTrend from '../../components/TokenTrend'
import ReplayView from '../../components/ReplayView'
import RawEventsTab from '../../components/RawEventsTab'
import SessionHeader, { type CallFilter } from '../../components/SessionHeader'
import ToolInspector from '../../components/ToolInspector'
import ToolEfficiencyTable from '../../components/ToolEfficiencyTable'
import { Tabs, DataTable, Expander, Info } from '../../components/ui/primitives'
import TimelineView from '../../components/TimelineView'
import { fmtTok, formatDuration, shapeTools, grouped, toolSuccessRate, buildTimelineOpencode, opencodeInspectedCalls } from '../../derive'

const TABS = [
  { key: 'replay', label: '会话回放' },
  { key: 'calls', label: '调用明细' },
  { key: 'overview', label: '总览' },
  { key: 'subagent', label: '子代理' },
  { key: 'tokens', label: 'Token 趋势' },
  { key: 'timeline', label: '时间轴' },
  { key: 'tools', label: '工具执行与消耗' },
  { key: 'raw', label: '原始数据' },
]

export default function OpencodeBody({
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
  const [tab, setTab] = useState(initialTab ?? 'replay')
  const [callFilter, setCallFilter] = useState<CallFilter>('all')
  const inspectCalls = (filter: CallFilter) => {
    setCallFilter(filter)
    setTab('calls')
  }
  const workflowTree = useWorkflowTree(result)
  const mermaid = useMermaid({
    kind: 'sequence-opencode',
    rawEvents: result.raw_events,
    maxEvents: 60,
    seed: 42,
  })

  const tools = result.tool_calls
  const inspected = useMemo(() => tab === 'calls' ? opencodeInspectedCalls(tools, result.raw_events) : [], [tab, tools, result.raw_events])

  const overview = useMemo(() => {
    const eventTypes = new Map<string, number>()
    for (const raw of result.raw_events) {
      const t = String((raw as Record<string, unknown>).type ?? '?')
      eventTypes.set(t, (eventTypes.get(t) ?? 0) + 1)
    }
    const toolCounts = new Map<string, number>()
    for (const tc of tools) toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1)
    return {
      eventTypes: [...eventTypes.entries()].sort((a, b) => b[1] - a[1]),
      toolCounts: [...toolCounts.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [result.raw_events, tools])

  return (
    <div className="session-detail">
      <SessionHeader result={result} entry={entry} fileName={fileName} onInspect={inspectCalls} />
      <Tabs items={TABS} active={tab} onChange={setTab} />

      {tab === 'replay' && (
        <ReplayView
          agent="opencode"
          rawEvents={result.raw_events}
          workflowRoot={workflowTree.data ?? null}
          result={result}
        />
      )}

      {tab === 'overview' && (
        <OverviewTab result={result} overview={overview} mermaidSrc={mermaid.data?.src} />
      )}

      {tab === 'subagent' && <SubagentTab result={result} />}

      {tab === 'tokens' && <TokenTrend result={result} />}

      {tab === 'timeline' && (
        <OpencodeTimelineTab rawEvents={liveEvents ?? result.raw_events} live={live} />
      )}

      {tab === 'tools' && <ToolsTab result={result} />}

      {tab === 'raw' && <RawEventsTab rawEvents={result.raw_events} keyPrefix="opencode" />}

      {tab === 'calls' && <ToolInspector key={callFilter} tools={inspected} filter={callFilter} onFilter={setCallFilter} />}
    </div>
  )
}

// ── Overview tab ──────────────────────────────────────────────

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
        <div className="metric-card"><div className="m-title">LLM 轮次</div><div className="m-value">{ri.num_turns || result.turns.length}</div></div>
        <div className="metric-card"><div className="m-title">工具调用</div><div className="m-value">{result.tool_calls.length}</div></div>
        <div className="metric-card"><div className="m-title">总 Input</div><div className="m-value">{fmtTok(ri.total_input)}</div></div>
        <div className="metric-card"><div className="m-title">总 Output</div><div className="m-value">{fmtTok(ri.total_output)}</div></div>
        <div className="metric-card"><div className="m-title">耗时</div><div className="m-value">{formatDuration(ri.duration_ms)}</div></div>
      </div>

      <div className="two-col">
        <div>
          <h3>事件类型分布</h3>
          <Plot
            data={[
              {
                type: 'bar',
                x: overview.eventTypes.map(([k]) => k),
                y: overview.eventTypes.map(([, v]) => v),
                marker: { color: overview.eventTypes.map((_, i) => plotColors(i)) },
              },
            ]}
            layout={{ height: 300, margin: { t: 20, b: 60 }, yaxis: { title: '次数' } }}
          />
        </div>
        <div>
          <h3>工具调用分布</h3>
          <Plot
            data={[
              {
                type: 'pie',
                labels: overview.toolCounts.map(([k]) => k),
                values: overview.toolCounts.map(([, v]) => v),
                hole: 0.4,
              },
            ]}
            layout={{ height: 300, margin: { t: 20, b: 0 } }}
          />
        </div>
      </div>

      <h3>时序图</h3>
      {mermaidSrc && <MermaidView src={mermaidSrc} notice={null} />}

      <h3>模型调用时序</h3>
      <Plot
        data={[
          {
            type: 'scatter',
            mode: 'lines+markers',
            x: result.turns.map((t) => t.turn_no),
            y: result.turns.map((t) => t.input_tokens),
            name: 'Input',
          },
          {
            type: 'scatter',
            mode: 'lines+markers',
            x: result.turns.map((t) => t.turn_no),
            y: result.turns.map((t) => t.output_tokens),
            name: 'Output',
          },
        ]}
        layout={{ height: 260, margin: { t: 20, b: 40 }, xaxis: { title: 'Step' }, yaxis: { title: 'Tokens' } }}
      />
    </div>
  )
}

// ── Subagent tab ──────────────────────────────────────────────
// Port of legacy `_tab_subagents`: overview table (with child-trace
// enrichment), token/tool charts, and per-subagent detail expanders.

const STATE_LABELS: Record<string, string> = {
  completed: '✅ 已完成',
  failed: '❌ 失败',
  error: '❌ 出错',
  running: '⏳ 进行中',
  unknown: '❓ 未知',
}

function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? (state ? `❓ ${state}` : '❓ 未知')
}

function peakInputTokens(result: ParseResult): number {
  if (result.result_info.total_input > 0) return result.result_info.total_input
  return result.turns.reduce((m, t) => Math.max(m, t.input_tokens), 0)
}

interface SubagentView {
  sub: Record<string, unknown>
  childId: string
  child: ParseResult | undefined
  isLoading: boolean
  available: boolean
}

function SubagentTab({ result }: { result: ParseResult }) {
  const childQueries = useQueries({
    queries: result.subagents.map((s) => {
      const childId = String(s.childSessionID ?? '')
      return {
        queryKey: ['subagent', childId],
        queryFn: () => api.subagent(childId),
        enabled: !!childId,
        retry: false,
      }
    }),
  })

  if (result.subagents.length === 0) {
    return <Info>本次会话未派发任何 subagent。</Info>
  }

  const views: SubagentView[] = result.subagents.map((sub, i) => {
    const childId = String(sub.childSessionID ?? '')
    const q = childQueries[i]
    const child = (q?.data ?? undefined) as ParseResult | undefined
    const available = !!child && child.raw_events.length > 0
    return {
      sub,
      childId,
      child,
      isLoading: q?.isLoading ?? false,
      available,
    }
  })

  const overviewRows = views.map((v) => ({
    '名称': (v.sub.agentName as string) || 'unnamed',
    '任务描述': (v.sub.description as string) || '—',
    '状态': stateLabel(String(v.sub.state ?? '')),
    'Session': v.childId ? `${v.childId.slice(0, 16)}…` : '（尚未拿到，派发中）',
    '派发 Step': v.sub.globalStep ?? '?',
    '派发耗时（父侧观测）':
      v.sub.dispatchDurationMs != null ? formatDuration(Number(v.sub.dispatchDurationMs)) : '—',
    '峰值 Input Tokens': v.available ? grouped(peakInputTokens(v.child!)) : '—',
    '总 Output Tokens': v.available ? grouped(v.child!.result_info.total_output) : '—',
    '工具调用次数': v.available ? v.child!.tool_calls.length : '—',
    '成功率': v.available ? `${toolSuccessRate(v.child!.tool_calls).toFixed(1)}%` : '—',
    '数据可用': v.available ? '✅' : '❌ 未找到 trace 文件',
  }))

  const available = views.filter((v) => v.available)

  return (
    <div>
      <h3>Subagent 派发概览（共 {result.subagents.length} 个）</h3>
      <DataTable rows={overviewRows} />

      {available.length > 0 && (
        <>
          <hr />
          <div className="two-col">
            <div>
              <h3>各 Subagent Token 消耗</h3>
              <Plot
                data={[
                  {
                    type: 'bar',
                    x: available.map((v) => String(v.sub.agentName ?? 'unnamed')),
                    y: available.map((v) => peakInputTokens(v.child!)),
                    name: 'Input',
                    marker: { color: '#1a73e8' },
                  },
                  {
                    type: 'bar',
                    x: available.map((v) => String(v.sub.agentName ?? 'unnamed')),
                    y: available.map((v) => v.child!.result_info.total_output),
                    name: 'Output',
                    marker: { color: '#0a9e6a' },
                  },
                ]}
                layout={{ barmode: 'group', height: 320, margin: { t: 30, b: 0 } }}
              />
            </div>
            <div>
              <h3>各 Subagent 工具调用次数</h3>
              <Plot
                data={[
                  {
                    type: 'bar',
                    x: available.map((v) => String(v.sub.agentName ?? 'unnamed')),
                    y: available.map((v) => v.child!.tool_calls.length),
                    marker: {
                      color: available.map((_, i) => plotColors(i)),
                    },
                  },
                ]}
                layout={{ height: 320, margin: { t: 30, b: 0 }, showlegend: false }}
              />
            </div>
          </div>
        </>
      )}

      <hr />
      <h3>逐个 Subagent 详情</h3>
      {views.map((v, i) => (
        <SubagentDetail key={i} view={v} />
      ))}
    </div>
  )
}

function SubagentDetail({ view }: { view: SubagentView }) {
  const { sub, childId, child, isLoading, available } = view
  const name = (sub.agentName as string) || 'unnamed'
  const sessionLabel = childId ? `session: ${childId.slice(0, 16)}…` : '派发中，尚无子会话 ID'

  return (
    <Expander title={`🤖 ${name}  (${sessionLabel})  ${stateLabel(String(sub.state ?? ''))}`}>
      <p className="muted">派发于 Global Step {String(sub.globalStep ?? '?')}</p>
      {sub.description ? <p className="muted">任务描述：{String(sub.description)}</p> : null}
      {sub.dispatchDurationMs != null && (
        <p className="muted">父侧观测到的派发耗时：{formatDuration(Number(sub.dispatchDurationMs))}</p>
      )}

      {!childId ? (
        <Info>该 task 调用还没有对应的 tool.finish，子会话 ID 尚未产生，暂无法展示详情。</Info>
      ) : isLoading ? (
        <p className="muted">加载子会话 trace…</p>
      ) : !available ? (
        <Info>本机未找到该子会话的 trace 文件，暂无法展示 Token / 工具调用详情。</Info>
      ) : (
        <>
          <div className="metric-row">
            <div className="metric-card"><div className="m-title">峰值 Input Tokens</div><div className="m-value">{grouped(peakInputTokens(child!))}</div></div>
            <div className="metric-card"><div className="m-title">总 Output Tokens</div><div className="m-value">{grouped(child!.result_info.total_output)}</div></div>
            <div className="metric-card"><div className="m-title">工具调用次数</div><div className="m-value">{child!.tool_calls.length}</div></div>
            <div className="metric-card"><div className="m-title">工具调用成功率</div><div className="m-value">{toolSuccessRate(child!.tool_calls).toFixed(1)}%</div></div>
          </div>
          {child!.tool_calls.length > 0 && (
            <DataTable
              rows={shapeTools(child!.tool_calls).map((t) => ({
                '工具名称': t.name,
                '次数': t.count,
              }))}
            />
          )}
        </>
      )}
    </Expander>
  )
}

// ── Timeline tab：与 Claude Code 同款三泳道时间轴 ─────────────

function OpencodeTimelineTab({ rawEvents, live = false }: { rawEvents: unknown[]; live?: boolean }) {
  const model = useMemo(() => buildTimelineOpencode(rawEvents), [rawEvents])
  return <TimelineView model={model} live={live} />
}

// ── Tools tab ─────────────────────────────────────────────────

function ToolsTab({ result }: { result: ParseResult }) {
  const tools = result.tool_calls
  const agg = shapeTools(tools)
  const maxAllot = tools.reduce((m, t) => Math.max(m, t.allotted_tokens), 0)
  const ranking = [...tools].sort((a, b) => b.allotted_tokens - a.allotted_tokens).slice(0, 10)

  const rankingRows = ranking.map((t, i) => ({
    '排名': i + 1,
    '工具': t.name,
    'Step': t.turn_no,
    '分摊 Tokens': grouped(t.allotted_tokens),
    'Tiktoken Tokens': grouped(t.tiktoken_tokens),
    '耗时': t.duration_ms > 0 ? `${t.duration_ms.toFixed(0)}ms` : '—',
  }))

  return (
    <div>
      <div className="metric-row">
        <div className="metric-card"><div className="m-title">调用次数</div><div className="m-value">{tools.length}</div></div>
        <div className="metric-card"><div className="m-title">平均耗时</div><div className="m-value">{formatDuration(tools.reduce((s, t) => s + t.duration_ms, 0) / Math.max(1, tools.length))}</div></div>
        <div className="metric-card"><div className="m-title">最大耗时</div><div className="m-value">{formatDuration(tools.reduce((m, t) => Math.max(m, t.duration_ms), 0))}</div></div>
        <div className="metric-card"><div className="m-title">最大分摊</div><div className="m-value">{maxAllot > 0 ? grouped(maxAllot) : '—'}</div></div>
      </div>

      <h3>每次调用 Tiktoken Tokens</h3>
      <Plot
        data={[
          {
            type: 'bar',
            x: tools.map((_, i) => i + 1),
            y: tools.map((t) => t.tiktoken_tokens),
            marker: { color: tools.map((t) => plotColors(agg.findIndex((a) => a.name === t.name))) },
            name: 'Tiktoken Tokens',
          },
        ]}
        layout={{ height: 300, margin: { t: 20, b: 40 }, xaxis: { title: '第 N 次调用' }, yaxis: { title: 'Tiktoken Tokens' } }}
      />

      <h3>分摊 Tokens vs Tiktoken Tokens</h3>
      <Plot
        data={[
          {
            type: 'scatter',
            mode: 'markers',
            x: tools.map((t) => t.tiktoken_tokens),
            y: tools.map((t) => t.allotted_tokens),
            text: tools.map((t) => t.name),
            marker: { size: 9 },
          },
        ]}
        layout={{
          height: 300,
          margin: { t: 20, b: 40 },
          xaxis: { title: 'Tiktoken Tokens' },
          yaxis: { title: '分摊 Tokens' },
        }}
      />

      <h3>分摊消耗排名（Top 10）</h3>
      <DataTable rows={rankingRows} compact />

      <h3>工具效率总表</h3>
      <ToolEfficiencyTable tools={tools} />
    </div>
  )
}

export { TABS }
