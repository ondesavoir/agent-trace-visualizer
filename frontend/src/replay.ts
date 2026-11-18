import type { AgentType } from './api/types'
import { joinToolOutput, opencodeToolPairs } from './derive'

type LogEvent = Record<string, unknown>
type TextKind = 'user' | 'thinking' | 'reply'
type TextItem = { kind: TextKind; text: string }
type ToolItem = {
  kind: 'tool'
  name: string
  input?: unknown
  output?: string | null
  status: '完成' | '失败' | '未记录结果'
  duration?: number
}
export type ReplayItem = (TextItem | ToolItem) & { time?: number }
export type ReplayRound = { number: number; items: ReplayItem[]; time?: number }

function record(value: unknown): LogEvent {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as LogEvent : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function timestamp(e: LogEvent): number | undefined {
  const ms = typeof e.ts === 'number' ? e.ts : Date.parse(text(e.timestamp))
  return Number.isFinite(new Date(ms).getTime()) ? ms : undefined
}

function blocks(content: unknown): LogEvent[] {
  const list = Array.isArray(content) ? content : [content]
  return list.map((item) => typeof item === 'string' ? { type: 'text', text: item } : record(item))
}

function claudeItems(events: LogEvent[]): ReplayItem[] {
  const items: ReplayItem[] = []
  const pending = new Map<string, ToolItem & { time?: number }>()
  let lastReply = ''

  function finish(result: LogEvent, time?: number) {
    const id = text(result.tool_use_id ?? result.toolUseId)
    const call = pending.get(id)
    const output = joinToolOutput(result.content)
    const status = result.is_error || result.isError ? '失败' : '完成'
    if (call) {
      call.output = output
      call.status = status
      if (time !== undefined && call.time !== undefined) call.duration = Math.max(0, time - call.time)
      pending.delete(id)
    } else {
      items.push({ kind: 'tool', name: '工具结果', output, status, time })
    }
  }

  for (const e of events) {
    const time = timestamp(e)
    if (e.type === 'tool_result') { finish(e, time); continue }
    if (e.type === 'result') {
      const reply = text(e.result)
      if (reply.trim() && reply !== lastReply) items.push({ kind: 'reply', text: reply, time })
      continue
    }
    if (e.type !== 'user' && e.type !== 'assistant') continue
    const content = blocks(record(e.message).content)
    if (e.type === 'user') {
      for (const b of content) if (b.type === 'tool_result') finish(b, time)
      if (e.isMeta || e.isCompactSummary || e.parent_tool_use_id || e.sourceToolAssistantUUID) continue
      const input = content.map((b) => b.type === 'text' ? text(b.text) : b.type === 'image' ? '〔图片〕' : b.type === 'document' ? '〔文档〕' : '').filter(Boolean).join('\n')
      if (input.trim()) { items.push({ kind: 'user', text: input, time }); lastReply = '' }
      continue
    }
    for (const b of content) {
      if (b.type === 'tool_use') {
        const call = { kind: 'tool', name: text(b.name) || '工具调用', input: b.input, status: '未记录结果', time } as const
        items.push(call)
        if (b.id) pending.set(text(b.id), call)
      } else if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        const thinking = text(b.thinking ?? b.text)
        if (thinking.trim() || b.type === 'redacted_thinking')
          items.push({ kind: 'thinking', text: thinking || '日志已隐藏思考正文。', time })
      } else if (b.type === 'text' && text(b.text).trim()) {
        lastReply = text(b.text)
        items.push({ kind: 'reply', text: lastReply, time })
      }
    }
  }
  return items
}

function opencodeItems(events: LogEvent[]): ReplayItem[] {
  const ends = new Map<LogEvent, LogEvent>()
  const pairs = opencodeToolPairs(events)
  for (const [finish, start] of pairs) if (start) ends.set(start, finish)
  const items: ReplayItem[] = []
  const userIds = new Set<string>()
  let previousPart: { key: string; item: TextItem } | undefined
  for (const e of events) {
    const time = timestamp(e)
    if (e.type === 'message.user' || e.type === 'text.user') {
      const id = text(e.messageID)
      if (!text(e.text).trim() || (id && userIds.has(id))) continue
      if (id) userIds.add(id)
      items.push({ kind: 'user', text: text(e.text), time })
    } else if (e.type === 'reasoning' || e.type === 'text.assistant') {
      const body = text(e.thinking ?? e.text)
      if (!body.trim()) continue
      const key = JSON.stringify([e.type, e.messageID, e.stepIndex, e.partID])
      // message.part.updated may emit successive full snapshots of one part.
      if (e.messageID && previousPart?.key === key && previousPart.item === items.at(-1) && body.startsWith(previousPart.item.text)) {
        previousPart.item.text = body
      } else {
        const item: TextItem = { kind: e.type === 'reasoning' ? 'thinking' : 'reply', text: body }
        const entry = { ...item, time }
        items.push(entry)
        previousPart = { key, item: entry }
      }
    } else if (e.type === 'tool.start' || e.type === 'tool.finish') {
      if (e.type === 'tool.finish' && pairs.get(e)) continue
      const finish = e.type === 'tool.finish' ? e : ends.get(e)
      items.push({ kind: 'tool', name: text(e.tool) || '工具调用', time, input: finish?.args ?? e.args,
        output: joinToolOutput(finish?.output), duration: typeof finish?.duration === 'number' ? finish.duration : undefined,
        status: !finish ? '未记录结果' : finish.isError ? '失败' : '完成' })
    }
  }
  return items
}

function decoded(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

function geminiItems(events: LogEvent[]): ReplayItem[] {
  const items: ReplayItem[] = []
  const pending = new Map<string, ToolItem>()
  let unkeyed: ToolItem | undefined
  let ambiguous = false
  for (const e of events) {
    const time = timestamp(e)
    const attrs = record(decoded(e.attrs_json))
    const body = text(e.body)
    const id = text(attrs.tool_call_id ?? attrs.call_id ?? attrs['gen_ai.tool.call.id'])
    if (e.category === '工具调用') {
      const status = text(e.status).toLowerCase()
      const call: ToolItem & { time?: number } = { kind: 'tool', name: text(e.tool_name || e.function_name) || '工具调用',
        input: attrs.function_args ?? attrs.args ?? (body || undefined), time,
        duration: typeof e.duration_ms === 'number' ? e.duration_ms : undefined,
        status: ['false', 'error', 'failed'].includes(status) ? '失败' : ['true', 'success'].includes(status) ? '完成' : '未记录结果' }
      items.push(call)
      if (id) pending.set(id, call)
      else {
        if (unkeyed) ambiguous = true
        unkeyed = call
      }
    } else if (e.category === '工具响应') {
      const call = id ? pending.get(id) : ambiguous ? undefined : unkeyed
      const output = body || text(e.attrs_json)
      const failed = ['false', 'error', 'failed'].includes(text(e.status).toLowerCase())
      if (call) {
        call.output = output
        call.status = failed || call.status === '失败' ? '失败' : '完成'
        if (id) pending.delete(id)
        else unkeyed = undefined
      } else items.push({ kind: 'tool', name: text(e.tool_name) || '工具结果', status: failed ? '失败' : '完成', output, time })
    } else if (e.event_name === 'gemini_cli.user_prompt' || attrs.role === 'user') {
      unkeyed = undefined
      ambiguous = false
      const prompt = text(attrs.prompt ?? attrs.content ?? e.body)
      if (prompt.trim()) items.push({ kind: 'user', text: prompt, time })
    } else {
      // Output messages can contain multiple parts. Input histories on API requests
      // repeat earlier turns and must not be counted as new user messages.
      const output = decoded(attrs['gen_ai.output.messages'])
      if (output && typeof output === 'object') {
        for (const message of Array.isArray(output) ? output : [output]) {
          const msg = record(message)
          for (const part of blocks(msg.parts ?? msg.content)) {
            const value = text(part.text ?? part.content)
            if (value.trim()) items.push({ kind: part.thought || part.type === 'thinking' ? 'thinking' : 'reply', text: value, time })
          }
        }
      } else if ((attrs.role === 'assistant' || attrs.role === 'model') && body.trim()) {
        items.push({ kind: 'reply', text: body, time })
      }
    }
  }
  return items
}

export function replayRounds(agent: AgentType, raw: unknown[]): ReplayRound[] {
  const events = raw.map(record)
  const items = agent === 'opencode' ? opencodeItems(events) : agent === 'gemini' ? geminiItems(events) : claudeItems(events)
  const rounds: ReplayRound[] = []
  let number = 0
  for (const item of items) {
    if (item.kind === 'user') number++
    if (!rounds.length || item.kind === 'user') rounds.push({ number, time: item.time, items: [] })
    rounds[rounds.length - 1].items.push(item)
  }
  return rounds
}
