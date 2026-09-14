import { Injectable, NgZone } from '@angular/core'
import { Subject, Subscription } from 'rxjs'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ConfigService, NotificationsService } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import { FilterRegistryService } from './filterRegistry'
import { FilterSession } from './filterSession'
import { sanitizeText } from './lineFilter'

/** Structural view of FilterTabComponent, to avoid an import cycle */
export interface FilterRecordingHost {
    session: FilterSession|null
    profile: { options: { pattern: string } }
    title: string
}

interface ActiveRecording {
    mode: 'full'|'filtered'
    filePath: string
    stream: fs.WriteStream
    startedAt: number
}

interface FullRecording {
    tab: BaseTerminalTabComponent<any>
    recording: ActiveRecording
    /** Single shared subscription to the source tab's output */
    sub: Subscription
    ui: HTMLElement
}

interface FilteredRecording {
    /** Single shared subscription to the session's matched output */
    sub: Subscription
    recording: ActiveRecording
}

/**
 * Manages output recordings.
 *
 * Stream sharing: exactly one subscription per recorded terminal (full mode)
 * and one per filter session (filtered mode), no matter how many consumers
 * exist — recording never adds per-recorder load on the source terminal's
 * output stream, so several filters recording the same terminal do not
 * multiply its output overhead.
 */
@Injectable({ providedIn: 'root' })
export class RecordingManager {
    private full = new Map<string, FullRecording>()
    private filtered = new Map<FilterSession, FilteredRecording>()
    private changed = new Subject<void>()

    /** Fires whenever a recording starts or stops */
    readonly recordingsChanged$ = this.changed.asObservable()

    constructor (
        private registry: FilterRegistryService,
        private config: ConfigService,
        private notifications: NotificationsService,
        private zone: NgZone,
    ) {
        this.registry.sourceClosed$.subscribe(id => {
            if (this.full.has(id)) {
                this.stopFullRecording(id)
            }
        })
    }

    isRecordingFull (sourceTabId: string): boolean {
        return this.full.has(sourceTabId)
    }

    getFullInfo (sourceTabId: string): { filePath: string, bytes: number }|null {
        const entry = this.full.get(sourceTabId)
        return entry ? {
            filePath: entry.recording.filePath,
            bytes: entry.recording.stream.bytesWritten,
        } : null
    }

    async toggleFullRecording (tab: BaseTerminalTabComponent<any>): Promise<void> {
        const id = this.registry.getId(tab)
        if (this.full.has(id)) {
            this.stopFullRecording(id)
            return
        }

        let filePath: string
        try {
            filePath = this.buildPath('full', {
                title: tab.title ?? 'terminal',
                pattern: '',
            })
            fs.mkdirSync(path.dirname(filePath), { recursive: true })
        } catch (e) {
            this.notifications.error(`Could not create recording file: ${e.message}`)
            return
        }

        const stream = fs.createWriteStream(filePath)
        stream.on('error', e => {
            this.notifications.error(`Recording error: ${e.message}`)
            this.stopFullRecording(id)
        })

        // One subscription per source terminal, feeding the recorder
        const sub = tab.output$.subscribe(data => {
            stream.write(sanitizeText(data))
        })

        const ui = this.attachFullUI(tab, filePath)

        this.full.set(id, { tab, recording: { mode: 'full', filePath, stream, startedAt: Date.now() }, sub, ui })
        this.emitChanged()
        this.notifications.notice(`Recording full output to ${filePath}`)
    }

    private stopFullRecording (id: string): void {
        const entry = this.full.get(id)
        if (!entry) {
            return
        }
        this.full.delete(id)
        entry.sub.unsubscribe()
        this.detachFullUI(entry.ui)
        this.finishRecording(entry.recording)
        this.emitChanged()
    }

    isRecordingFiltered (session: FilterSession|null): boolean {
        return !!session && this.filtered.has(session)
    }

    getFilteredInfo (session: FilterSession|null): { filePath: string, bytes: number }|null {
        const entry = session ? this.filtered.get(session) : undefined
        return entry ? {
            filePath: entry.recording.filePath,
            bytes: entry.recording.stream.bytesWritten,
        } : null
    }

    async toggleFilteredRecording (host: FilterRecordingHost): Promise<void> {
        const session = host.session
        if (!session) {
            return
        }
        if (this.filtered.has(session)) {
            this.stopFilteredRecording(session)
            return
        }

        let filePath: string
        try {
            filePath = this.buildPath('filtered', {
                title: host.title,
                pattern: host.profile.options.pattern,
            })
            fs.mkdirSync(path.dirname(filePath), { recursive: true })
        } catch (e) {
            this.notifications.error(`Could not create recording file: ${e.message}`)
            return
        }

        const stream = fs.createWriteStream(filePath)
        stream.on('error', e => {
            this.notifications.error(`Recording error: ${e.message}`)
            this.stopFilteredRecording(session)
        })

        // One subscription per filter session, tapping the already-produced
        // matched output — no extra work on the source terminal
        const sub = session.matchedOutput$.subscribe(data => {
            stream.write(data)
        })
        // Session destroyed (tab closed / reconnect) → stop recording.
        // stopFilteredRecording() deletes the entry before unsubscribing,
        // so the guard below only fires on natural completion.
        sub.add(() => {
            const entry = this.filtered.get(session)
            if (entry && entry.sub === sub) {
                this.filtered.delete(session)
                this.finishRecording(entry.recording)
                this.emitChanged()
            }
        })

        this.filtered.set(session, { sub, recording: { mode: 'filtered', filePath, stream, startedAt: Date.now() } })
        this.emitChanged()
        this.notifications.notice(`Recording filtered output to ${filePath}`)
    }

    private stopFilteredRecording (session: FilterSession): void {
        const entry = this.filtered.get(session)
        if (!entry) {
            return
        }
        this.filtered.delete(session)
        entry.sub.unsubscribe()
        this.finishRecording(entry.recording)
        this.emitChanged()
    }

    private finishRecording (recording: ActiveRecording): void {
        try {
            recording.stream.end()
        } catch {
            // already closed
        }
        const kb = Math.max(1, Math.round(recording.stream.bytesWritten / 1024))
        this.zone.run(() => {
            this.notifications.notice(`Recording saved (${kb} KB): ${recording.filePath}`)
        })
    }

    private emitChanged (): void {
        this.zone.run(() => this.changed.next())
    }

    /**
     * Builds the recording file path from the configured directory and
     * filename template. Template tokens: {date} {time} {title} {pattern}
     * {mode}.
     */
    private buildPath (mode: 'full'|'filtered', ctx: { title: string, pattern: string }): string {
        const config = this.config.store.outputFilter?.recording ?? {}
        const directory = config.directory || os.homedir()
        const template = config.filenameTemplate || '{date}_{time}.log'

        const now = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        let name = template
            .replace(/\{date\}/g, `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
            .replace(/\{time\}/g, `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`)
            .replace(/\{title\}/g, ctx.title)
            .replace(/\{pattern\}/g, ctx.pattern || 'all')
            .replace(/\{mode\}/g, mode)
        name = sanitizeFilename(name) || `recording-${Date.now()}.log`

        return path.join(directory, name)
    }

    /** Recording indicator shown at the top-right of the recorded terminal */
    private attachFullUI (tab: BaseTerminalTabComponent<any>, filePath: string): HTMLElement {
        const ui = document.createElement('div')
        ui.classList.add('output-filter-recording-ui')

        const dot = document.createElement('span')
        dot.classList.add('rec-dot')
        ui.appendChild(dot)

        const label = document.createElement('span')
        label.classList.add('rec-label')
        label.textContent = path.basename(filePath)
        label.title = filePath
        ui.appendChild(label)

        const stop = document.createElement('button')
        stop.classList.add('rec-stop')
        stop.textContent = 'Stop'
        stop.addEventListener('click', () => {
            this.zone.run(() => {
                this.stopFullRecording(this.registry.getId(tab))
            })
        })
        ui.appendChild(stop)

        const content = tab.element.nativeElement.querySelector('.content')
        content?.appendChild(ui)
        return ui
    }

    private detachFullUI (ui: HTMLElement): void {
        ui.remove()
    }
}

/** Replaces characters that are invalid in filenames (Windows-safe) */
function sanitizeFilename (name: string): string {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200).trim()
}
