import { Component } from '@angular/core'
import { ConfigService } from 'tabby-core'

/** @hidden */
@Component({
    template: require('./settingsTab.component.pug'),
})
export class FilterSettingsTabComponent {
    historyLimit: number
    pauseBufferLimitKB: number
    highlightMatches: boolean
    recordingDirectory: string
    filenameTemplate: string

    // Kept as a component property: literal braces in template text would be
    // parsed as ICU message blocks by Angular's template compiler
    tokenHelp = 'Tokens: {date} = 2026-09-14, {time} = 153045, {title} = tab title, ' +
        '{pattern} = filter pattern (or "all"), {mode} = full / filtered'

    constructor (public config: ConfigService) {
        this.historyLimit = config.store.outputFilter?.historyLimit ?? 20
        this.pauseBufferLimitKB = Math.round((config.store.outputFilter?.pauseBufferLimitBytes ?? 1048576) / 1024)
        this.highlightMatches = config.store.outputFilter?.highlightMatches ?? true
        this.recordingDirectory = config.store.outputFilter?.recording?.directory ?? ''
        this.filenameTemplate = config.store.outputFilter?.recording?.filenameTemplate ?? '{date}_{time}.log'
    }

    save (): void {
        const store = this.config.store
        store.outputFilter ??= {}
        store.outputFilter.historyLimit = this.clamp(this.historyLimit, 0, 500, 20)
        store.outputFilter.pauseBufferLimitBytes = this.clamp(this.pauseBufferLimitKB, 64, 65536, 1024) * 1024
        store.outputFilter.highlightMatches = !!this.highlightMatches
        store.outputFilter.recording ??= {}
        store.outputFilter.recording.directory = this.recordingDirectory.trim() || null
        store.outputFilter.recording.filenameTemplate = this.filenameTemplate.trim() || '{date}_{time}.log'
        this.config.save()
    }

    private clamp (value: number, min: number, max: number, fallback: number): number {
        const n = Math.round(Number(value))
        if (!Number.isFinite(n)) {
            return fallback
        }
        return Math.max(min, Math.min(max, n))
    }
}
