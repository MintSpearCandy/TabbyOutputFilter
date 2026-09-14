import { ChangeDetectorRef, Component, ElementRef, Injector, ViewChild } from '@angular/core'
import { SubscriptionContainer } from 'tabby-core'
import { BaseTerminalTabComponent, ConnectableTerminalTabComponent } from 'tabby-terminal'
import { FilterHistoryEntry, FilterProfile, historyEntryKey } from './api'
import { FilterRegistryService } from './filterRegistry'
import { RecordingManager } from './recordingManager'
import { FilterSession } from './filterSession'
import { LineFilterStats } from './lineFilter'

/** @hidden */
@Component({
    selector: 'filter-tab',
    template: `${BaseTerminalTabComponent.template} ${require('./filterTab.component.pug')}`,
    styles: [...BaseTerminalTabComponent.styles, require('./filterTab.component.scss')],
    animations: BaseTerminalTabComponent.animations,
})
export class FilterTabComponent extends ConnectableTerminalTabComponent<FilterProfile> {
    static readonly FOCUS_PATTERN_HOTKEY = 'filter-output.toggle-panel'

    session: FilterSession|null = null
    sourceTabId: string|null = null

    // Toolbar edit state (applied to the session via applyFilter())
    pattern: string
    isRegex: boolean
    caseSensitive: boolean
    invert: boolean
    paused = false
    selectedSourceId: string|null = null

    history: FilterHistoryEntry[] = []
    sources: { id: string, title: string }[] = []

    @ViewChild('patternInput') patternInput: ElementRef
    @ViewChild('historyButton') historyButton: ElementRef

    private sourceSubs = new SubscriptionContainer()
    private statsTick: number|null = null
    private historyMenu: HTMLElement|null = null
    private historyMenuDismiss: ((e: Event) => void)|null = null
    private historyMenuEsc: ((e: KeyboardEvent) => void)|null = null

    constructor (
        injector: Injector,
        private registry: FilterRegistryService,
        private recording: RecordingManager,
        private cdr: ChangeDetectorRef,
    ) {
        super(injector)
        this.enableToolbar = true
    }

    ngOnInit (): void {
        this.subscribeUntilDestroyed(this.hotkeys.hotkey$, hotkey => {
            if (!this.hasFocus) {
                return
            }
            if (hotkey === FilterTabComponent.FOCUS_PATTERN_HOTKEY) {
                this.focusPatternInput()
            }
        })

        this.subscribeUntilDestroyed(this.registry.sourceClosed$, id => {
            if (id === this.sourceTabId) {
                this.onSourceLost()
            }
        })

        super.ngOnInit()

        this.disableDynamicTitle = true
        this.pattern = this.profile.options.pattern
        this.isRegex = this.profile.options.isRegex
        this.caseSensitive = this.profile.options.caseSensitive
        this.invert = this.profile.options.invert
        this.selectedSourceId = this.profile.options.sourceTabId
        this.loadHistory()
        this.reloadSources()

        // Periodic local change detection so the live stats readout keeps
        // updating. Runs outside the Angular zone: a zone interval would
        // trigger whole-application change detection every second for every
        // open filter tab; detectChanges() only refreshes this component.
        this.zone.runOutsideAngular(() => {
            this.statsTick = window.setInterval(() => this.cdr.detectChanges(), 1000)
        })

        setImmediate(() => this.updateTitle())
    }

    async initializeSession (): Promise<void> {
        await super.initializeSession()

        const pauseLimit = this.config.store.filterOutput?.pauseBufferLimitBytes
        const session = new FilterSession(
            this.logger,
            typeof pauseLimit === 'number' && pauseLimit > 0 ? pauseLimit : undefined,
        )
        this.setSession(session)
        await session.start()

        session.filter.setMatcher(this.profile.options)
        this.bindSource(this.profile.options.sourceTabId)

        if (!this.profile.options.pattern && this.hasFocus) {
            setImmediate(() => this.focusPatternInput())
        }
    }

    ngOnDestroy (): void {
        this.closeHistoryMenu()
        if (this.statsTick !== null) {
            window.clearInterval(this.statsTick)
        }
        this.sourceSubs.cancelAll()
        super.ngOnDestroy()
        this.session?.destroy()
    }

    get stats (): LineFilterStats|null {
        return this.session ? this.session.filter.stats : null
    }

    get recordingInfo (): { filePath: string, bytes: number }|null {
        return this.recording.getFilteredInfo(this.session)
    }

    async toggleRecording (): Promise<void> {
        await this.recording.toggleFilteredRecording(this)
    }

    formatBytes (bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`
        }
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`
        }
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }

    focusPatternInput (): void {
        const input = this.patternInput?.nativeElement as HTMLInputElement|undefined
        if (input) {
            input.focus()
            input.select()
        }
    }

    onPatternEscape (): void {
        this.frontend?.focus()
    }

    /** Applies the current toolbar state to the session and records history */
    applyFilter (): void {
        this.profile.options.pattern = this.pattern
        this.profile.options.isRegex = this.isRegex
        this.profile.options.caseSensitive = this.caseSensitive
        this.profile.options.invert = this.invert
        this.session?.filter.setMatcher(this.profile.options)
        this.updateTitle()
        this.saveHistory()
    }

    toggleHistoryMenu (): void {
        if (this.historyMenu) {
            this.closeHistoryMenu()
        } else {
            this.openHistoryMenu()
        }
    }

    closeHistoryMenu (): void {
        if (this.historyMenuDismiss) {
            document.removeEventListener('mousedown', this.historyMenuDismiss, true)
            this.historyMenuDismiss = null
        }
        if (this.historyMenuEsc) {
            document.removeEventListener('keydown', this.historyMenuEsc, true)
            this.historyMenuEsc = null
        }
        this.historyMenu?.remove()
        this.historyMenu = null
    }

    onSourceSelect (): void {
        this.bindSource(this.selectedSourceId || null)
        if (this.selectedSourceId) {
            this.profile.options.sourceTabId = this.selectedSourceId
        }
    }

    togglePause (): void {
        this.paused = !this.paused
        this.onPanelPause(this.paused)
    }

    onPanelPause (paused: boolean): void {
        if (!this.session) {
            return
        }
        if (paused) {
            this.session.filter.setPaused(true)
        } else {
            this.session.resumeFromPause()
        }
    }

    clearOutput (): void {
        this.session?.filter.resetLineBuffer()
        this.frontend?.clear()
    }

    reloadSources (): void {
        this.sources = this.registry.getTerminalTabs()
    }

    /**
     * Renders the history menu in document.body — appended there instead of
     * inside the toolbar so it is not clipped by the toolbar's
     * overflow: hidden.
     */
    private openHistoryMenu (): void {
        const button = this.historyButton?.nativeElement as HTMLElement|undefined
        if (!button) {
            return
        }
        this.loadHistory()

        const menu = document.createElement('div')
        menu.classList.add('filter-history-menu')

        if (!this.history.length) {
            const empty = document.createElement('div')
            empty.classList.add('filter-history-empty')
            empty.textContent = 'No saved filters yet'
            menu.appendChild(empty)
        }

        for (const entry of this.history) {
            const item = document.createElement('button')
            item.type = 'button'
            item.classList.add('filter-history-item')

            const label = document.createElement('span')
            label.classList.add('filter-history-pattern')
            label.textContent = entry.pattern.length > 60 ? entry.pattern.slice(0, 60) + '…' : entry.pattern
            item.appendChild(label)

            const flags = [
                entry.isRegex ? '.*' : null,
                entry.invert ? '!' : null,
                entry.caseSensitive ? 'Aa' : null,
            ].filter(x => x !== null).join(' ')
            if (flags) {
                const flagSpan = document.createElement('span')
                flagSpan.classList.add('filter-history-flags')
                flagSpan.textContent = flags
                item.appendChild(flagSpan)
            }

            item.addEventListener('click', () => {
                this.zone.run(() => {
                    this.pattern = entry.pattern
                    this.isRegex = entry.isRegex
                    this.caseSensitive = entry.caseSensitive
                    this.invert = entry.invert
                    this.applyFilter()
                })
                this.closeHistoryMenu()
            })
            menu.appendChild(item)
        }

        if (this.history.length) {
            const clear = document.createElement('button')
            clear.type = 'button'
            clear.classList.add('filter-history-clear')
            clear.textContent = 'Clear history'
            clear.addEventListener('click', () => {
                this.zone.run(() => this.clearHistory())
                this.closeHistoryMenu()
            })
            menu.appendChild(clear)
        }

        document.body.appendChild(menu)

        const menuRect = menu.getBoundingClientRect()
        const buttonRect = button.getBoundingClientRect()
        let left = buttonRect.right - menuRect.width
        left = Math.max(8, Math.min(left, window.innerWidth - menuRect.width - 8))
        let top = buttonRect.bottom + 4
        if (top + menuRect.height > window.innerHeight - 8) {
            top = Math.max(8, buttonRect.top - menuRect.height - 4)
        }
        menu.style.left = `${left}px`
        menu.style.top = `${top}px`

        this.historyMenu = menu
        this.historyMenuDismiss = e => {
            const target = e.target as Node|null
            if (target && !menu.contains(target) && !button.contains(target)) {
                this.closeHistoryMenu()
            }
        }
        document.addEventListener('mousedown', this.historyMenuDismiss, true)
        this.historyMenuEsc = e => {
            if (e.key === 'Escape') {
                e.stopPropagation()
                this.closeHistoryMenu()
            }
        }
        document.addEventListener('keydown', this.historyMenuEsc, true)
    }

    /** Idempotent: safe to call again on reconnect or source switch */
    private bindSource (id: string|null): void {
        this.sourceSubs.cancelAll()
        this.sourceTabId = id
        const source = id ? this.registry.getTab(id) : null
        if (source instanceof BaseTerminalTabComponent) {
            this.sourceSubs.subscribe(source.binaryOutput$, data => {
                this.session?.pushChunk(data)
            })
        } else {
            this.onSourceUnavailable(!!id)
        }
    }

    private onSourceLost (): void {
        // Release the subscription to the closed source's output Subject now:
        // keeping it would pin the destroyed tab component tree in memory
        // until the next bindSource() or until this tab is closed
        this.sourceSubs.cancelAll()
        this.session?.onSourceLost()
        this.sourceTabId = null
        this.selectedSourceId = null
        this.reloadSources()
    }

    private onSourceUnavailable (wasLost: boolean): void {
        if (wasLost) {
            this.onSourceLost()
        } else {
            this.sourceTabId = null
            this.selectedSourceId = null
            this.session?.notice('no source selected - pick a terminal in the toolbar')
        }
    }

    private get historyLimit (): number {
        const limit = this.config.store.filterOutput?.historyLimit
        return typeof limit === 'number' && limit > 0 ? limit : 20
    }

    private loadHistory (): void {
        const stored = this.config.store.filterOutput?.history ?? []
        this.history = [...stored]
            .sort((a, b) => b.lastUsed - a.lastUsed)
            .slice(0, this.historyLimit)
    }

    private saveHistory (): void {
        if (!this.pattern) {
            return
        }
        const entry: FilterHistoryEntry = {
            pattern: this.pattern,
            isRegex: this.isRegex,
            caseSensitive: this.caseSensitive,
            invert: this.invert,
            lastUsed: Date.now(),
        }
        const store = this.config.store
        store.filterOutput ??= {}
        const key = historyEntryKey(entry)
        let list = (store.filterOutput.history ?? []).filter(x => historyEntryKey(x) !== key)
        list.unshift(entry)
        store.filterOutput.history = list.slice(0, this.historyLimit)
        this.config.save()
        this.loadHistory()
    }

    private clearHistory (): void {
        const store = this.config.store
        store.filterOutput ??= {}
        store.filterOutput.history = []
        this.config.save()
        this.history = []
    }

    private updateTitle (): void {
        const pattern = this.profile.options.pattern
        this.setTitle(pattern ? `Filter: ${pattern}` : 'Filter output')
    }
}
