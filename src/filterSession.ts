import colors from 'ansi-colors'
import { Observable, Subject } from 'rxjs'
import { Logger } from 'tabby-core'
import { BaseSession } from 'tabby-terminal'
import { LineFilter } from './lineFilter'

/**
 * A display-only session: it has no process behind it, it only re-emits
 * lines of another terminal's output that pass the active filter.
 */
export class FilterSession extends BaseSession {
    readonly filter: LineFilter

    private matchedOutput = new Subject<Buffer>()

    /**
     * The sanitized matched lines only — unlike output$ this excludes banner
     * and service messages, so it is exactly what a filtered recording
     * should write to disk.
     */
    get matchedOutput$ (): Observable<Buffer> { return this.matchedOutput }

    constructor (logger: Logger, pauseLimitBytes?: number) {
        super(logger)
        this.filter = new LineFilter(pauseLimitBytes)
    }

    async start (_options?: unknown): Promise<void> {
        this.open = true
        this.emitOutput(Buffer.from(
            '\r\n' + colors.black.bgWhite(' Filter ') + ' output filter terminal ready\r\n' +
            colors.black.bgWhite(' Filter ') + ' right-click or press the hotkey to configure\r\n'
        ))
    }

    resize (_columns: number, _rows: number): void { }

    write (_data: Buffer): void {
        // Read-only view: keyboard input is ignored
    }

    kill (_signal?: string): void { }

    async gracefullyKillProcess (): Promise<void> { }

    async destroy (): Promise<void> {
        this.matchedOutput.complete()
        await super.destroy()
    }

    supportsWorkingDirectory (): boolean {
        return false
    }

    async getWorkingDirectory (): Promise<string|null> {
        return null
    }

    /** Called by the tab when a new chunk arrives from the source terminal */
    pushChunk (chunk: Buffer): void {
        const out = this.filter.process(chunk)
        if (out) {
            this.emitOutput(out)
            this.matchedOutput.next(out)
        }
    }

    /** Called when the last partial line should be matched (e.g. source lost) */
    flushPartialLine (): void {
        const out = this.filter.flushPartial()
        if (out) {
            this.emitOutput(out)
            this.matchedOutput.next(out)
        }
    }

    /** Called when the bound source tab was closed */
    onSourceLost (): void {
        this.flushPartialLine()
        this.emitOutput(Buffer.from(
            '\r\n' + colors.black.bgRed(' Filter ') + ' ' + colors.red('source tab was closed - pick another source\r\n')
        ))
    }

    /** Resumes output and emits whatever was buffered while paused */
    resumeFromPause (): void {
        this.filter.setPaused(false)
        const drained = this.filter.drainPauseBuffer()
        if (drained) {
            if (drained.droppedLines > 0) {
                this.notice(`resumed, ${drained.droppedLines} oldest buffered line(s) were dropped`)
            }
            this.emitOutput(drained.data)
            this.matchedOutput.next(drained.data)
        }
    }

    notice (msg: string): void {
        this.emitOutput(Buffer.from(
            '\r\n' + colors.black.bgWhite(' Filter ') + ` ${msg}\r\n`
        ))
    }
}
