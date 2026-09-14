/* Standalone smoke test for the line filter logic.
 * Run: npm test */
const assert = require('assert')
const { LineFilter } = require('../test-build/lineFilter')

function run (name, fn) {
    try {
        fn()
        console.log('OK  ', name)
    } catch (e) {
        console.error('FAIL', name, '\n     ', e.message)
        process.exitCode = 1
    }
}

run('keyword match keeps colored original bytes', () => {
    const f = new LineFilter()
    f.setMatcher({ pattern: 'ERROR', isRegex: false, caseSensitive: false, invert: false })
    const out = f.process(Buffer.from('\x1b[31mERROR\x1b[0m something\r\ninfo line\r\nanother ERROR here\r\n'))
    assert.strictEqual(out.toString('utf8'), '\x1b[31mERROR\x1b[0m something\nanother ERROR here\n')
})

run('case-insensitive by default, case-sensitive when asked', () => {
    const f = new LineFilter()
    f.setMatcher({ pattern: 'error', isRegex: false, caseSensitive: false, invert: false })
    assert.ok(f.process(Buffer.from('An Error occurred\n')).toString().includes('An Error'))
    f.setMatcher({ pattern: 'error', isRegex: false, caseSensitive: true, invert: false })
    assert.strictEqual(f.process(Buffer.from('An Error occurred\n')), null)
})

run('invert shows non-matching lines', () => {
    const f = new LineFilter()
    f.setMatcher({ pattern: 'x', isRegex: false, caseSensitive: false, invert: true })
    const out = f.process(Buffer.from('aaa\nbbb x ccc\nddd\n'))
    assert.strictEqual(out.toString('utf8'), 'aaa\nddd\n')
})

run('regex mode', () => {
    const f = new LineFilter()
    f.setMatcher({ pattern: 'time[=<]\\d+', isRegex: true, caseSensitive: false, invert: false })
    const out = f.process(Buffer.from('time=10 ms\ntime>10 ms\nnope\n'))
    assert.strictEqual(out.toString('utf8'), 'time=10 ms\n')
})

run('invalid regex falls back to literal matching', () => {
    const f = new LineFilter()
    f.setMatcher({ pattern: 'a[b', isRegex: true, caseSensitive: false, invert: false })
    assert.ok(f.stats.invalidRegex)
    const out = f.process(Buffer.from('contains a[b here\nnothing\n'))
    assert.strictEqual(out.toString('utf8'), 'contains a[b here\n')
})

run('empty pattern passes everything through', () => {
    const f = new LineFilter()
    f.setMatcher({ pattern: '', isRegex: false, caseSensitive: false, invert: false })
    const out = f.process(Buffer.from('one\ntwo\n'))
    assert.strictEqual(out.toString('utf8'), 'one\ntwo\n')
})

run('lines split across chunks, UTF-8 multibyte safe', () => {
    const f = new LineFilter()
    f.setMatcher({ pattern: '中文', isRegex: false, caseSensitive: false, invert: false })
    const whole = Buffer.from('ascii 中文 line\nplain\n')
    // split at a byte boundary that cuts a multibyte char in half
    const mid = 8
    const a = f.process(whole.subarray(0, mid))
    const b = f.process(whole.subarray(mid))
    assert.strictEqual((a ? a.toString('utf8') : '') + (b ? b.toString('utf8') : ''), 'ascii 中文 line\n')
})

run('lone \\r redraw keeps only the final version', () => {
    const f = new LineFilter()
    f.setMatcher({ pattern: 'progress', isRegex: false, caseSensitive: false, invert: false })
    const out = f.process(Buffer.from('progress 10%\rprogress 50%\rprogress 90%\n'))
    assert.strictEqual(out.toString('utf8'), 'progress 90%\n')
})

run('lone \\r redraw does not emit dropped intermediate versions', () => {
    const f = new LineFilter()
    f.setMatcher({ pattern: '50', isRegex: false, caseSensitive: false, invert: false })
    const out = f.process(Buffer.from('progress 10%\rprogress 50%\rprogress 90%\n'))
    assert.strictEqual(out, null) // the 50% version was redrawn away
})

run('trailing \\r does not split when \\n follows in next chunk', () => {
    const f = new LineFilter()
    f.setMatcher({ pattern: 'done', isRegex: false, caseSensitive: false, invert: false })
    const a = f.process(Buffer.from('done\r'))
    assert.strictEqual(a, null) // held back waiting to see if \n follows
    const b = f.process(Buffer.from('\nnext\n'))
    assert.strictEqual(b.toString('utf8'), 'done\n')
})

run('redraw before \\r\\n yields the final clean line (PSReadLine flow)', () => {
    const f = new LineFilter()
    f.setMatcher({ pattern: 'Desktop', isRegex: false, caseSensitive: false, invert: false })
    // prompt line redrawn (prediction text removed) right before Enter
    const out = f.process(Buffer.from('PS D:\\Data\\Desktop> cd .. .\\Home\\\rPS D:\\Data\\Desktop> cd ..\r\n'))
    assert.strictEqual(out.toString('utf8'), 'PS D:\\Data\\Desktop> cd ..\n')
})

run('hidden OSC payload does not drive matching', () => {
    const f = new LineFilter()
    f.setMatcher({ pattern: 'Home', isRegex: false, caseSensitive: false, invert: false })
    // ST-terminated OSC 9;9 cwd report hides "D:\Home" from view — must not match
    const out = f.process(Buffer.from('PS D:\\Data\\Desktop> cd ..\x1b]9;9;"D:\\Home"\x1b\\\r\n'))
    assert.strictEqual(out, null)
})

run('cursor-control sequences scrubbed from output, SGR colors kept', () => {
    const f = new LineFilter()
    f.setMatcher({ pattern: 'ERROR', isRegex: false, caseSensitive: false, invert: false })
    const out = f.process(Buffer.from('\x1b[2K\r\x1b[31mERROR\x1b[0m boom\x1b[K\n'))
    const text = out.toString('utf8')
    assert.strictEqual(text, '\x1b[31mERROR\x1b[0m boom\n')
    assert.ok(!text.includes('\x1b[2K') && !text.includes('\x1b[K') && !text.includes('\r'))
})

run('flushPartial emits unmatched-tail matched line', () => {
    const f = new LineFilter()
    f.setMatcher({ pattern: 'tail', isRegex: false, caseSensitive: false, invert: false })
    f.process(Buffer.from('nope\nunterminated tail'))
    const out = f.flushPartial()
    assert.strictEqual(out.toString('utf8'), 'unterminated tail')
})

run('pause buffers, resume drains with drop accounting', () => {
    const f = new LineFilter(64) // tiny limit
    f.setMatcher({ pattern: 'x', isRegex: false, caseSensitive: false, invert: false })
    f.setPaused(true)
    for (let i = 0; i < 20; i++) {
        f.process(Buffer.from('x0123456789\n')) // 12 bytes each, all match
    }
    assert.ok(f.stats.pausedDropped)
    const drained = f.drainPauseBuffer()
    f.setPaused(false)
    assert.ok(drained.data.length > 0)
    assert.ok(drained.data.length <= 64)
    assert.ok(drained.droppedLines >= 1)
})

run('stats count matched/total', () => {
    const f = new LineFilter()
    f.setMatcher({ pattern: 'a', isRegex: false, caseSensitive: false, invert: false })
    f.process(Buffer.from('a1\nb2\na3\n'))
    assert.strictEqual(f.stats.total, 3)
    assert.strictEqual(f.stats.matched, 2)
})

console.log(process.exitCode ? '\nSOME TESTS FAILED' : '\nALL TESTS PASSED')
