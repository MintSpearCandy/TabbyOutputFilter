import stripAnsi from 'strip-ansi'

export interface MatcherOptions {
    pattern: string
    isRegex: boolean
    caseSensitive: boolean
    invert: boolean
}

export interface LineFilterStats {
    matched: number
    total: number
    invalidRegex: boolean
    pausedBufferedBytes: number
    pausedDropped: boolean
}

/** Upper bound for a single line without a newline, to survive binary garbage */
const PARTIAL_LIMIT_BYTES = 1 << 20

/**
 * OSC sequences (window title, cwd reports, hyperlinks, ...) with either
 * BEL or ST terminator. strip-ansi@5 only handles the BEL variant.
 */
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g

/** Any CSI sequence; kept only when the final byte is "m" (SGR = colors) */
const CSI_RE = /\x1b\[[0-9;:<=>?]*[A-Za-z]/g

/** Stray C0 control noise that must never reach the filter terminal */
const C0_RE = /[\x00\r\b\x0b\x0c\x0e\x0f\x7f]/g

/**
 * Removes everything that must not influence matching nor reach the filter
 * terminal: OSC sequences (any terminator), CSI sequences other than SGR
 * color codes, and stray C0 controls. Colors are preserved.
 */
export function sanitizeText (text: string): string {
    return text
        .replace(OSC_RE, '')
        .replace(CSI_RE, m => m.endsWith('m') ? m : '')
        .replace(C0_RE, '')
}

/**
 * Line-oriented stream filter.
 *
 * Lines are split at the Buffer level on 0x0A, which is UTF-8 safe because
 * UTF-8 continuation bytes are always >= 0x80. A lone 0x0D means the sender
 * is redrawing the current line (ConPTY / PSReadLine repaint), so the text
 * before it is dropped and only the final version of the line is kept.
 *
 * Matching happens on the ANSI-stripped decoded text. Matched lines are
 * forwarded with SGR color codes preserved, but cursor-control / erase
 * sequences are scrubbed so repaint noise cannot corrupt the filter
 * terminal's own rendering, and hidden sequence payloads (e.g. OSC cwd
 * reports) cannot influence matching.
 */
export class LineFilter {
    private partial = Buffer.alloc(0)
    private pausedBuffer: Buffer[] = []
    private pausedBytes = 0
    private pausedDroppedLineCount = 0
    private paused = false
    private regexCache: RegExp|null = null
    private lowercasePattern = ''
    private matcher: MatcherOptions = {
        pattern: '',
        isRegex: false,
        caseSensitive: false,
        invert: false,
    }

    stats: LineFilterStats = {
        matched: 0,
        total: 0,
        invalidRegex: false,
        pausedBufferedBytes: 0,
        pausedDropped: false,
    }

    constructor (private pauseLimitBytes = 1 << 20) { }

    setPauseLimitBytes (limit: number): void {
        this.pauseLimitBytes = limit
    }

    setPaused (paused: boolean): void {
        this.paused = paused
        if (!paused) {
            this.stats.pausedBufferedBytes = 0
            this.stats.pausedDropped = false
        }
    }

    isPaused (): boolean {
        return this.paused
    }

    setMatcher (options: MatcherOptions): void {
        this.matcher = { ...options }
        this.stats.invalidRegex = false
        this.regexCache = null
        this.lowercasePattern = options.caseSensitive ? options.pattern : options.pattern.toLowerCase()
        if (options.pattern && options.isRegex) {
            try {
                this.regexCache = new RegExp(options.pattern, options.caseSensitive ? '' : 'i')
            } catch {
                // Invalid pattern: fall back to literal substring matching
                this.stats.invalidRegex = true
            }
        }
    }

    /** Drop any unterminated partial line (used when clearing output) */
    resetLineBuffer (): void {
        this.partial = Buffer.alloc(0)
    }

    resetPauseBuffer (): void {
        this.pausedBuffer = []
        this.pausedBytes = 0
        this.pausedDroppedLineCount = 0
        this.stats.pausedBufferedBytes = 0
        this.stats.pausedDropped = false
    }

    /**
     * Feeds a chunk of source output. Returns the sanitized bytes (SGR colors
     * and the newline intact) that should be written to the filter terminal
     * now, or null. While paused, matched lines are buffered instead.
     */
    process (chunk: Buffer): Buffer|null {
        let pending = Buffer.concat([this.partial, chunk])

        const completeLines: Buffer[] = []

        while (true) {
            const nl = pending.indexOf(0x0A)
            const cr = pending.indexOf(0x0D)
            if (nl === -1 && cr === -1) {
                break
            }
            if (cr !== -1 && (nl === -1 || cr < nl)) {
                if (cr + 1 === nl) {
                    // \r\n pair: a normal line ending, keep the raw bytes
                    completeLines.push(pending.subarray(0, nl + 1))
                    pending = pending.subarray(nl + 1)
                    continue
                }
                if (cr === pending.length - 1) {
                    // Lone trailing \r: wait for the next chunk to see whether
                    // a \n follows (split \r\n) before treating it as a rewrite
                    break
                }
                // Lone \r: the sender is redrawing the current line. Drop the
                // version being replaced, keep what follows — the final
                // version before the eventual \n is the real line.
                pending = pending.subarray(cr + 1)
                continue
            }
            const line = pending.subarray(0, nl + 1) // keep the \n
            completeLines.push(line)
            pending = pending.subarray(nl + 1)
        }

        // Guard against pathological unterminated lines
        if (pending.length > PARTIAL_LIMIT_BYTES) {
            completeLines.push(pending)
            pending = Buffer.alloc(0)
        }
        this.partial = pending

        if (!completeLines.length) {
            return null
        }

        const matched: Buffer[] = []
        for (const line of completeLines) {
            const text = sanitizeText(line.toString('utf8'))
            if (this.textMatches(text)) {
                this.stats.matched++
                matched.push(Buffer.from(text))
            }
            this.stats.total++
        }

        if (!matched.length) {
            return null
        }

        const out = Buffer.concat(matched)

        if (this.paused) {
            this.pushToPauseBuffer(out)
            return null
        }

        return out
    }

    /** Final flush of an unterminated trailing line, e.g. on source close */
    flushPartial (): Buffer|null {
        if (!this.partial.length) {
            return null
        }
        const line = this.partial
        this.partial = Buffer.alloc(0)
        const text = sanitizeText(line.toString('utf8'))
        if (this.textMatches(text)) {
            this.stats.matched++
            this.stats.total++
            if (this.paused) {
                this.pushToPauseBuffer(Buffer.from(text))
                return null
            }
            return Buffer.from(text)
        }
        this.stats.total++
        return null
    }

    /**
     * Returns buffered lines to emit when un-pausing, or null.
     * If oldest lines were dropped, `droppedLines` reports how many.
     */
    drainPauseBuffer (): { data: Buffer, droppedLines: number }|null {
        if (!this.pausedBuffer.length) {
            return null
        }
        const data = Buffer.concat(this.pausedBuffer)
        const droppedLines = this.pausedDroppedLineCount
        this.pausedBuffer = []
        this.pausedBytes = 0
        this.pausedDroppedLineCount = 0
        this.stats.pausedBufferedBytes = 0
        this.stats.pausedDropped = false
        return { data, droppedLines }
    }

    private pushToPauseBuffer (out: Buffer): void {
        this.pausedBuffer.push(out)
        this.pausedBytes += out.length
        while (this.pausedBytes > this.pauseLimitBytes && this.pausedBuffer.length > 1) {
            const dropped = this.pausedBuffer.shift()
            this.pausedBytes -= dropped.length
            this.pausedDroppedLineCount++
            this.stats.pausedDropped = true
        }
        this.stats.pausedBufferedBytes = this.pausedBytes
    }

    private textMatches (sanitizedText: string): boolean {
        const plain = stripAnsi(sanitizedText).replace(/[\r\n]+$/, '')
        let result: boolean
        const { pattern, isRegex, caseSensitive, invert } = this.matcher
        if (!pattern) {
            result = true
        } else if (isRegex && this.regexCache) {
            result = this.regexCache.test(plain)
        } else {
            if (caseSensitive) {
                result = plain.includes(pattern)
            } else {
                result = plain.toLowerCase().includes(this.lowercasePattern)
            }
        }
        return invert ? !result : result
    }
}
