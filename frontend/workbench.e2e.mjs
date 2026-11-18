// Run after building frontend/dist and the debug backend. Uses an isolated trace directory.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const fixtures = join(root, 'backend/tests/fixtures')
const temp = await mkdtemp(join(tmpdir(), 'trace-workbench-'))
const listener = createServer()
listener.listen(0, '127.0.0.1')
await once(listener, 'listening')
const port = listener.address().port
await new Promise((resolve) => listener.close(resolve))
const url = 'http://127.0.0.1:' + port
const binary = 'trace-viz-backend' + (process.platform === 'win32' ? '.exe' : '')
const server = spawn(join(root, 'backend/target/debug', binary), [], {
  cwd: root, windowsHide: true, stdio: 'ignore',
  env: { ...process.env, HOME: temp, DASHBOARD_HOST: '127.0.0.1', DASHBOARD_PORT: String(port), DIST_DIR: join(root, 'frontend/dist') },
})
let browser
try {
  for (let retry = 0; retry < 50; retry++) {
    if (server.exitCode !== null) throw new Error('Backend exited before serving requests')
    if (await fetch(url + '/api/health').then((r) => r.ok, () => false)) break
    await delay(100)
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto(url)
  await page.getByRole('heading', { name: '还没有本地会话' }).waitFor()
  await page.getByRole('button', { name: '查看示例会话' }).click()
  await page.getByRole('heading', { name: 'refactor dashboard' }).waitFor()
  await page.getByRole('button', { name: '返回会话列表' }).click()

  for (const [dir, name] of [
    ['.claude/projects/parser', 'sample_claude_code_transcript.jsonl'],
    ['.cac/projects/parser', 'sample_claude_code_transcript.jsonl'],
    ['.local/share/opencode/trace', 'sample_opencode.ndjson'],
  ]) {
    await mkdir(join(temp, dir), { recursive: true })
    await copyFile(join(fixtures, name), join(temp, dir, name))
  }
  await page.getByRole('button', { name: '刷新' }).click()
  const search = page.getByRole('textbox', { name: '搜索会话' })
  await search.waitFor()
  const capture = async (name) => {
    if (process.env.WORKBENCH_SHOTS) await page.screenshot({ animations: 'disabled', path: join(process.env.WORKBENCH_SHOTS, name + '.png') })
  }
  await capture('session-workbench')
  await search.fill('refactor')
  await page.getByLabel('Agent 类型').selectOption('opencode')
  assert.equal(await page.locator('.session-row').count(), 1)
  await page.getByRole('button', { name: /refactor dashboard/ }).click()
  await page.getByRole('heading', { name: 'refactor dashboard' }).waitFor()
  assert.equal(await page.getByRole('tab', { name: '时间轴', exact: true }).getAttribute('aria-selected'), 'true')
  async function trendSeries(name) {
    await page.waitForFunction((name) => [...document.querySelectorAll('.token-trend .js-plotly-plot')]
      .some((plot) => plot.data?.some((series) => series.name === name)), name)
    return page.evaluate((name) => [...document.querySelectorAll('.token-trend .js-plotly-plot')]
      .flatMap((plot) => plot.data ?? []).find((series) => series.name === name).y, name)
  }
  await page.getByRole('tab', { name: 'Token 趋势' }).click()
  assert.deepEqual(await trendSeries('输入'), [1000, 600, 200])
  assert.deepEqual(await trendSeries('输出'), [100, 150, 50])
  assert.deepEqual(await trendSeries('推理'), [50, 80, 20])
  assert.deepEqual(await trendSeries('缓存读取'), [300, 500, 150])
  assert.deepEqual(await trendSeries('输入变化'), [null, -400, -400])
  await page.getByRole('button', { name: /工具调用 ↗/ }).click()
  await page.getByLabel('查看方式').selectOption('slowest')
  assert.match(await page.locator('.call-list button[aria-pressed="true"]').innerText(), /500 ms/)
  assert.match(await page.locator('.call-detail').innerText(), /Explore the codebase/)
  assert.match(await page.locator('.call-detail').innerText(), /ses_child123/)
  await page.getByRole('button', { name: /^read\b/i }).click()
  assert.match(await page.locator('.call-detail').innerText(), /src\/lib\.rs/)
  assert.match(await page.locator('.call-detail').innerText(), /pub fn add/)
  await capture('tool-call-detail')
  await page.getByRole('button', { name: '返回会话列表' }).click()
  assert.equal(await search.inputValue(), 'refactor')
  assert.equal(await page.getByLabel('Agent 类型').inputValue(), 'opencode')
  await search.fill('parser')
  await page.getByLabel('Agent 类型').selectOption('claude_code')
  await page.getByRole('button', { name: /fix the bug/ }).click()
  await page.getByRole('tab', { name: '调用明细' }).click()
  await page.getByRole('button', { name: /^Read\b/ }).click()
  await page.locator('.call-detail pre').first().waitFor()
  await page.goBack()
  assert.equal(await search.inputValue(), 'parser')
  await page.getByLabel('Agent 类型').selectOption('codeagent')
  assert.equal(await page.locator('.session-row').count(), 1)
  await page.getByRole('button', { name: /fix the bug/ }).click()
  await page.locator('.run-meta').getByText('CodeAgent', { exact: true }).waitFor()
  await page.getByRole('tab', { name: '会话回放' }).click()
  await page.locator('.replay-round').getByText('fix the bug in parser', { exact: true }).waitFor()
  assert.equal(await page.locator('.replay-round').count(), 1)
  assert.equal(await page.locator('.replay-tool[open]').count(), 0)
  await page.getByRole('tab', { name: '调用明细' }).click()
  await page.getByRole('button', { name: /^Read\b/ }).click()
  assert.match(await page.locator('.call-detail').innerText(), /def parse/)
  await page.getByRole('link', { name: 'CodeAgent', exact: true }).click()
  await page.locator('.live-banner').getByText(/SSE 实时/).waitFor()
  await page.locator('.run-meta').getByText('CodeAgent', { exact: true }).waitFor()
  await page.getByRole('button', { name: '退出实时' }).click()
  assert.equal(await page.locator('.session-row').count(), 1)
  await page.getByRole('link', { name: /返回会话工作台/ }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.getByRole('link', { name: '导入日志' }).last().click()
  await page.getByLabel('日志来源').selectOption('codeagent')
  await page.locator('input[type=file]').setInputFiles(join(fixtures, 'sample_claude_code_stream.json'))
  await page.locator('.run-meta').getByText('CodeAgent', { exact: true }).waitFor()
  await page.getByRole('tab', { name: '会话回放' }).click()
  await page.locator('.replay-reply').getByText('All done.', { exact: true }).waitFor()
  assert.equal(await page.locator('.replay-tool').count(), 0)
  await page.getByRole('button', { name: '查看全部工具调用（2）', exact: true }).click()
  assert.equal(await page.locator('.replay-tool').count(), 2)
  await page.getByRole('button', { name: '重新导入' }).click()
  const fragments = [
    ['m1', { input_tokens: 20, output_tokens: 3, cache_read_input_tokens: 50, cache_creation_input_tokens: 30 }],
    ['m2', { input_tokens: 20, output_tokens: 2 }],
    ['m1', { output_tokens: 8 }],
    ['m1', null],
    [null, { input_tokens: 20, output_tokens: 0 }],
    [null, { output_tokens: 1 }],
  ].map(([id, usage]) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-sonnet-4-5', usage } }))
  await page.locator('input[type=file]').setInputFiles({ name: 'usage.jsonl', mimeType: 'text/plain', buffer: Buffer.from(fragments.join('\n')) })
  await page.getByRole('tab', { name: 'Token 趋势' }).click()
  assert.deepEqual(await trendSeries('输入'), [20, 20, 20, null])
  assert.deepEqual(await trendSeries('输出'), [8, 2, 0, 1])
  assert.deepEqual(await trendSeries('缓存命中率'), [50, null, null, null])
  assert.deepEqual(await trendSeries('输入变化'), [null, 0, 0, null])
  assert.match(await page.locator('.token-trend').innerText(), /覆盖 3 \/ 4/)
  assert.match(await page.locator('.run-metrics').innerText(), /60 \/ 11/)
  await page.getByRole('button', { name: '重新导入' }).click()
  const conversation = [
    { type: 'user', message: { content: '检查解析器' } },
    { type: 'assistant', message: { content: [
      { type: 'thinking', thinking: '先读取测试文件。' },
      { type: 'tool_use', id: 'read-1', name: 'Read', input: { path: 'parser.rs' } },
    ] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'file contents' }] } },
    ...Array.from({ length: 11 }, (_, i) => ({
      type: 'assistant', message: { content: [{ type: 'tool_use', id: 'check-' + i, name: 'Check', input: { index: i } }] },
    })),
    { type: 'assistant', message: { content: [{ type: 'text', text: '已读完测试文件。' }] } },
    ...Array.from({ length: 10 }, (_, i) => ({ type: 'user', message: { content: '继续检查 ' + (i + 2) } })),
  ]
  await page.locator('input[type=file]').setInputFiles({ name: 'rounds.jsonl', mimeType: 'text/plain', buffer: Buffer.from(conversation.map((event) => JSON.stringify(event)).join('\n')) })
  await page.getByRole('tab', { name: '会话回放' }).click()
  const firstRound = page.locator('.replay-round').first()
  await firstRound.getByText('先读取测试文件。', { exact: true }).waitFor()
  await firstRound.getByText('已读完测试文件。', { exact: true }).waitFor()
  assert.equal(await firstRound.locator('.replay-tool').count(), 0)
  await firstRound.getByRole('button', { name: '查看全部工具调用（12）' }).click()
  assert.equal(await firstRound.locator('.replay-tool').count(), 12)
  assert.equal(await firstRound.locator('details[open]').count(), 0)
  await firstRound.locator('summary').first().click()
  assert.equal(await firstRound.locator('details[open]').count(), 1)
  await firstRound.getByText('file contents', { exact: true }).waitFor()
  assert.match(await firstRound.locator('.replay-payload').innerText(), /parser\.rs/)
  await firstRound.getByRole('button', { name: '收起工具调用（12）' }).click()
  assert.equal(await firstRound.locator('.replay-tool').count(), 0)
  await firstRound.getByText('已读完测试文件。', { exact: true }).waitFor()
  await page.getByLabel('跳转到轮次').selectOption({ label: '第 11 轮 · 继续检查 11' })
  await page.getByRole('heading', { name: '第 11 轮', exact: true }).waitFor()
  await page.getByLabel('搜索回放').fill('测试文件')
  await page.getByRole('heading', { name: '第 1 轮', exact: true }).waitFor()
  assert.equal(await page.locator('.replay-round').count(), 1)
  await page.getByRole('button', { name: '重新导入' }).click()
  await page.getByLabel('日志来源').selectOption('opencode')
  const log = await readFile(join(fixtures, 'sample_opencode.ndjson'), 'utf8')
  const withFailure = log.trim().split(/\r?\n/).flatMap((line) => {
    const event = JSON.parse(line)
    if (event.type === 'text.user') return [
      JSON.stringify({ ...event, type: 'message.user', messageID: 'user-1' }),
      JSON.stringify({ type: 'reasoning', messageID: 'assistant-1', stepIndex: 1, thinking: '检查' }),
      JSON.stringify({ type: 'reasoning', messageID: 'assistant-1', stepIndex: 1, thinking: '检查当前实现。' }),
    ]
    if (event.type === 'tool.finish' && event.tool === 'write') {
      event.isError = true
      event.output = 'Permission denied'
    }
    return JSON.stringify(event)
  }).join('\n')
  await page.locator('input[type=file]').setInputFiles({ name: 'failure.ndjson', mimeType: 'text/plain', buffer: Buffer.from(withFailure) })
  await page.getByRole('heading', { name: 'refactor dashboard' }).waitFor()
  await page.getByRole('tab', { name: '会话回放' }).click()
  await page.locator('.replay-round').getByText('refactor this', { exact: true }).waitFor()
  await page.locator('.replay-thinking').getByText('检查当前实现。', { exact: true }).waitFor()
  assert.equal(await page.locator('.replay-thinking').count(), 1)
  assert.equal(await page.locator('.replay-round').count(), 1)
  await page.getByRole('button', { name: /失败调用/ }).click()
  assert.equal(await page.locator('.call-list button').count(), 1)
  assert.match(await page.locator('.call-detail').innerText(), /Permission denied/)
  await page.getByRole('button', { name: '重新导入' }).click()
  await page.getByLabel('日志来源').selectOption('gemini')
  await page.locator('input[type=file]').setInputFiles(join(fixtures, 'sample_gemini.log'))
  await page.getByRole('heading', { name: 'sample_gemini.log' }).waitFor()
  await page.getByRole('tab', { name: '会话回放' }).click()
  await page.getByRole('button', { name: '查看全部工具调用（1）' }).click()
  await page.locator('.replay-tool').getByText('read_file', { exact: true }).waitFor()
  await page.locator('.replay-tool summary').first().click()
  await page.locator('.replay-payload').getByText('response body', { exact: true }).waitFor()
  await page.getByRole('tab', { name: '调用明细' }).click()
  await page.locator('.call-detail pre').first().waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: session browsing, tool inspection, live monitoring, import, replay rounds, thinking, collapsed calls, search and cross-page jump')
} finally {
  try { await browser?.close() } finally {
    if (server.exitCode === null && server.pid) {
      const exited = once(server, 'exit')
      server.kill()
      await exited
    }
    if (dirname(resolve(temp)) === resolve(tmpdir())) await rm(temp, { recursive: true, force: true })
  }
}
