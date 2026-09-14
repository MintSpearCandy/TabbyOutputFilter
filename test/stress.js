#!/usr/bin/env node
/**
 * High-frequency log output stress tester for tabby-filter-output.
 *
 * Live mode (default) — floods stdout with realistic log traffic.
 * Run it in a terminal inside Tabby, point a filter pane and/or a recording
 * at that terminal, and watch stats / pause buffering / file output behave:
 *
 *     node test/stress.js                          # ~10s, no throttling
 *     node test/stress.js --duration 60 --rate 5000
 *
 * Traffic mix: colored INFO/DEBUG/WARN/ERROR lines, Chinese text, long JSON
 * blobs, progress-bar \r redraw bursts, OSC title reports and cursor moves —
 * everything the filter is supposed to scrub or preserve.
 *
 * Benchmark mode — feeds the same traffic through LineFilter directly, in
 * random-sized chunks (1-8 KB, like PTY output), optionally through several
 * parallel filter instances (several filter panes on one source terminal):
 *
 *     node test/stress.js --benchmark
 *     node test/stress.js --benchmark --filters 5 --duration 5 --mb 64
 */
'use strict'

/* ---------------------------------------------------------------- args -- */

const args = {
    benchmark: false,
    duration: 10,       // seconds
    rate: 0,            // lines/sec cap; 0 = unlimited
    mb: 32,             // benchmark: MB of traffic per pass
    filters: 3,         // benchmark: parallel filter instances
}

for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]
    if (a === '--benchmark') {
        args.benchmark = true
    } else if (a === '--duration') {
        args.duration = parseFloat(process.argv[++i])
    } else if (a === '--rate') {
        args.rate = parseInt(process.argv[++i], 10)
    } else if (a === '--mb') {
        args.mb = parseInt(process.argv[++i], 10)
    } else if (a === '--filters') {
        args.filters = parseInt(process.argv[++i], 10)
    } else {
        console.error(`unknown option: ${a}`)
        process.exit(1)
    }
}

/* -------------------------------------------------------------- traffic -- */

// Seeded RNG so benchmark runs are reproducible
let seed = 0x2f6e2b1
function rnd () {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
}
function pick (arr) {
    return arr[Math.floor(rnd() * arr.length)]
}

const C = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
}

const MESSAGES = [
    'request completed', 'cache miss for key=user:%d', 'connection reset by peer',
    'retrying in %dms (attempt %d/5)', 'gc pause %dms', 'snapshot written (%d bytes)',
    'session %s authenticated', 'queue depth=%d lag=%dms', 'disk usage at %d%%',
    'forked worker pid=%d', 'rate limited: client=%s', 'certificate renews in %d days',
]
const CN_MESSAGES = [
    '数据库连接池已满，等待释放', '任务队列积压：当前 %d 条', '定时快照写入完成，耗时 %d 毫秒',
    '检测到网络抖动，重连第 %d 次', '中文与 English 混合输出 stress 测试 line %d',
]

let lineNo = 0

function stamp () {
    const d = new Date()
    const p = n => String(n).padStart(2, '0')
    const ms = String(d.getMilliseconds()).padStart(3, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
        `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${ms}`
}

function fill (tpl) {
    return tpl.replace(/%[ds]/g, () => String(Math.floor(rnd() * 100000)))
}

/** One line of realistic traffic, ~65% of what a busy service prints */
function plainLine () {
    lineNo++
    const r = rnd()
    let level, color
    if (r < 0.5) {
        level = 'INFO'; color = C.green
    } else if (r < 0.75) {
        level = 'DEBUG'; color = C.dim
    } else if (r < 0.9) {
        level = 'WARN'; color = C.yellow
    } else {
        level = 'ERROR'; color = C.red
    }
    const msg = rnd() < 0.15 ? fill(pick(CN_MESSAGES)) : fill(pick(MESSAGES))
    return `${C.dim}${stamp()}${C.reset} ${color}${C.bold}${level.padEnd(5)}${C.reset} ` +
        `[worker-${Math.floor(rnd() * 8)}] ${msg}\n`
}

/** Occasional long JSON blob line (1-4 KB) */
function jsonLine () {
    lineNo++
    const fields = []
    const n = 20 + Math.floor(rnd() * 40)
    for (let i = 0; i < n; i++) {
        fields.push(`"field${i}":"${fill(pick(MESSAGES)).replace(/"/g, "'")}"`)
    }
    return `${C.dim}${stamp()}${C.reset} INFO  [audit] {"seq":${lineNo},"data":{${fields.join(',')}}}\n`
}

/** Progress-bar burst: ~8 repaints of one line via lone \r, then finish */
function progressBurst () {
    let out = ''
    const total = 100
    for (let done = 0; done <= total; done += 5 + Math.floor(rnd() * 10)) {
        const pct = Math.min(done, total)
        const bar = '='.repeat(Math.floor(pct / 2)).padEnd(50, ' ')
        out += `downloading [${bar}] ${pct}%\r`
    }
    return out + `downloading done, 1048576 bytes\n`
}

/** OSC title report + cursor moves — noise the filter must scrub */
function noise () {
    return `\x1b]0;stress ${lineNo}\x07\x1b]9;9;"D:\\stress\\test"\x1b\\\x1b[2K`
}

/**
 * Generates the next piece of traffic. Distribution is tuned so that ~85% of
 * bytes are plain log lines, with regular injections of everything else.
 */
function nextPiece () {
    const r = rnd()
    if (r < 0.03) {
        return noise()
    }
    if (r < 0.06) {
        return progressBurst()
    }
    if (r < 0.11) {
        return jsonLine()
    }
    return plainLine()
}

/* ----------------------------------------------------------- live mode -- */

function live () {
    console.log(`# stress: flooding stdout for ${args.duration}s` +
        (args.rate ? ` at ~${args.rate} lines/s` : ' (unlimited)') +
        ' — point a filter pane / recording at this terminal')
    const start = Date.now()
    let lines = 0

    function pump () {
        // ~200 lines per batch keeps stdout backpressure manageable
        for (let i = 0; i < 200; i++) {
            const piece = nextPiece()
            lines += piece.endsWith('\n') ? 1 : 0
            if (!process.stdout.write(piece)) {
                process.stdout.once('drain', throttled)
                return
            }
        }
        throttled()
    }

    function throttled () {
        if (Date.now() - start >= args.duration * 1000) {
            console.log(`\n# stress: done, ~${lines} lines`)
            process.exit(0)
        }
        if (args.rate) {
            const drift = lines - (Date.now() - start) / 1000 * args.rate
            setTimeout(pump, Math.max(0, Math.min(100, drift / args.rate * 1000)))
        } else {
            setImmediate(pump)
        }
    }

    pump()
}

/* ------------------------------------------------------ benchmark mode -- */

function benchmark () {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LineFilter } = require('../test-build/lineFilter')

    console.log(`# benchmark: ${args.mb} MB traffic in random 1-8 KB chunks, ` +
        `${args.filters} parallel filters, ${args.duration}s cap\n`)

    const configs = [
        { name: 'keyword ERROR', matcher: { pattern: 'ERROR', isRegex: false, caseSensitive: false, invert: false } },
        { name: 'regex time:.*ERROR', matcher: { pattern: '\\d\\d:\\d\\d:\\d\\d.*ERROR', isRegex: true, caseSensitive: false, invert: false } },
        { name: 'keyword 中文', matcher: { pattern: '中文', isRegex: false, caseSensitive: false, invert: false } },
        { name: 'invert INFO (show noise)', matcher: { pattern: 'INFO', isRegex: false, caseSensitive: false, invert: true } },
        { name: 'passthrough (empty)', matcher: { pattern: '', isRegex: false, caseSensitive: false, invert: false } },
    ]
    const filters = []
    for (let i = 0; i < args.filters; i++) {
        const cfg = configs[i % configs.length]
        const f = new LineFilter(1 << 20)
        f.setMatcher(cfg.matcher)
        filters.push({ ...cfg, filter: f, outBytes: 0, outLines: 0 })
    }
    // Dedicated pause-exercise filter: passthrough with a tiny 256 KB limit,
    // paused through most of the first pass so the drop path runs under load
    const pauseFilter = new LineFilter(256 * 1024)
    pauseFilter.setMatcher({ pattern: '', isRegex: false, caseSensitive: false, invert: false })
    let pauseDroppedLines = -1
    let pauseDropped = false
    let pausePeakBuffered = 0
    const rssSamples = []

    // Pre-generate one pass of traffic, then chunk it
    const pieces = []
    let bytes = 0
    const target = args.mb * 1024 * 1024
    while (bytes < target) {
        const p = nextPiece()
        pieces.push(p)
        bytes += p.length
    }
    const traffic = Buffer.from(pieces.join(''))
    const inLines = pieces.filter(p => p.includes('\n')).length
    pieces.length = 0

    const rssBefore = process.memoryUsage().rss
    const start = process.hrtime.bigint()
    let pos = 0
    let passBytes = 0
    let passes = 0

    while (Number(process.hrtime.bigint() - start) / 1e9 < args.duration) {
        // one pass over the traffic per loop, in random-sized chunks
        pos = 0
        while (pos < traffic.length) {
            const size = 1024 + Math.floor(rnd() * 7 * 1024)
            const chunk = traffic.subarray(pos, Math.min(pos + size, traffic.length))
            pos += size
            const ratio = pos / traffic.length
            // Pause filter[0] through nearly all of the first pass so its
            // matched output exceeds the 1 MiB buffer and exercises dropping
            if (passes === 0 && ratio > 0.05 && !pauseFilter.isPaused()) {
                pauseFilter.setPaused(true)
            }
            if (passes === 0 && ratio > 0.95 && pauseFilter.isPaused()) {
                pauseFilter.setPaused(false)
                const drained = pauseFilter.drainPauseBuffer()
                if (drained) {
                    pauseDroppedLines = drained.droppedLines
                    pauseDropped = drained.droppedLines > 0
                }
            }
            for (const f of filters) {
                const out = f.filter.process(chunk)
                if (out) {
                    f.outBytes += out.length
                    for (let i = 0; i < out.length; i++) {
                        if (out[i] === 0x0a) {
                            f.outLines++
                        }
                    }
                }
            }
            pauseFilter.process(chunk)
            pausePeakBuffered = Math.max(pausePeakBuffered, pauseFilter.stats.pausedBufferedBytes)
        }
        passBytes += traffic.length
        passes++
        rssSamples.push(process.memoryUsage().rss)
    }

    for (const f of filters) {
        const tail = f.filter.flushPartial()
        if (tail) {
            f.outBytes += tail.length
        }
    }

    const elapsedSec = Number(process.hrtime.bigint() - start) / 1e9
    const rssAfter = process.memoryUsage().rss
    const totalFilteredBytes = passBytes * filters.length

    console.log(`input      : ${(passBytes / 1048576).toFixed(1)} MB x ${filters.length} filters = ` +
        `${(totalFilteredBytes / 1048576).toFixed(1)} MB processed in ${elapsedSec.toFixed(2)}s`)
    console.log(`throughput : ${(totalFilteredBytes / 1048576 / elapsedSec).toFixed(0)} MB/s ` +
        `(${(passBytes / elapsedSec / 1048576).toFixed(0)} MB/s source, ${(inLines * passes / elapsedSec / 1000).toFixed(0)}k lines/s per filter)\n`)

    for (const f of filters) {
        const s = f.filter.stats
        console.log(
            `  ${f.name.padEnd(24)} matched ${(s.matched / 1000).toFixed(0)}k`.padEnd(42) +
            `out ${(f.outBytes / 1048576).toFixed(1)} MB`.padEnd(20) +
            `${s.invalidRegex ? 'INVALID-REGEX' : ''}`)
    }

    console.log(`\npause test : dropped=${pauseDropped}, ` +
        `droppedLines=${pauseDroppedLines >= 0 ? pauseDroppedLines : 'n/a'}, ` +
        `peakBuffered=${(pausePeakBuffered / 1024).toFixed(0)} KB ` +
        `(limit 256 KB, ${pauseFilter.stats.matched} matched lines seen while paused)`)

    // Invariants
    const problems = []
    const inTotal = filters.reduce((a, f) => a + f.filter.stats.total, 0)
    if (inTotal !== inLines * passes * filters.length) {
        problems.push(`line accounting mismatch: got ${inTotal}, expected ${inLines * passes * filters.length}`)
    }
    for (const f of filters) {
        if (f.filter.stats.invalidRegex) {
            problems.push(`${f.name}: unexpected invalid regex`)
        }
        if (f.matcher.pattern && f.outBytes >= passBytes) {
            problems.push(`${f.name}: output not smaller than input for a selective filter`)
        }
    }
    const rssDelta = (rssAfter - rssBefore) / 1048576
    const third = Math.max(1, Math.floor(rssSamples.length / 3))
    const firstAvg = rssSamples.slice(0, third).reduce((a, b) => a + b, 0) / third
    const lastAvg = rssSamples.slice(-third).reduce((a, b) => a + b, 0) / third
    const bounded = lastAvg <= firstAvg + 10 * 1048576
    console.log(`\nmemory     : RSS delta ${rssDelta >= 0 ? '+' : ''}${rssDelta.toFixed(1)} MB ` +
        `(before ${(rssBefore / 1048576).toFixed(0)} MB, after ${(rssAfter / 1048576).toFixed(0)} MB, ` +
        `per-pass trend: ${bounded ? 'PLATEAU (bounded)' : 'STILL GROWING (possible leak!)'})`)
    if (!bounded) {
        problems.push('RSS kept growing across passes')
    }
    if (problems.length) {
        console.log('\nINVARIANT FAILURES:')
        for (const p of problems) {
            console.log('  -', p)
        }
        process.exit(1)
    }
    console.log('\ninvariants : OK (line accounting, selective filters, no invalid regex)')
}

/* ----------------------------------------------------------------- go --- */

if (args.benchmark) {
    benchmark()
} else {
    live()
}
