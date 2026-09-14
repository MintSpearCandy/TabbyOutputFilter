import { Injectable } from '@angular/core'
import { Subject } from 'rxjs'
import { AppService, BaseTabComponent, HotkeysService, SplitTabComponent, TabsService } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import { FilterOptions, FilterProfile, makeFilterProfile } from './api'
import type { FilterTabComponent } from './filterTab.component'

export interface SourceTabInfo {
    id: string
    title: string
}

/**
 * Runtime registry mapping terminal tabs to stable ids, enumerating usable
 * source terminals and opening filter panes as split tabs.
 */
@Injectable({ providedIn: 'root' })
export class FilterRegistryService {
    private idByTab = new WeakMap<BaseTabComponent, string>()
    private tabsById = new Map<string, BaseTabComponent>()
    private counter = 0
    private sourceClosed = new Subject<string>()

    /** Emits the registry id of a source tab that was closed */
    readonly sourceClosed$ = this.sourceClosed.asObservable()

    constructor (
        private app: AppService,
        private tabsService: TabsService,
        hotkeys: HotkeysService,
    ) {
        hotkeys.hotkey$.subscribe(hotkey => {
            if (hotkey !== 'output-filter.new-pane') {
                return
            }
            // Open a filter pane below whichever terminal pane has focus
            const active = this.app.activeTab
            const focused = active instanceof SplitTabComponent ? active.getFocusedTab() : active
            if (focused instanceof BaseTerminalTabComponent) {
                const { FilterTabComponent } = require('./filterTab.component')
                if (!(focused instanceof FilterTabComponent)) {
                    this.openFilterPane(focused, {})
                }
            }
        })
    }

    getId (tab: BaseTabComponent): string {
        let id = this.idByTab.get(tab)
        if (!id) {
            id = `tab-${++this.counter}`
            this.idByTab.set(tab, id)
            this.tabsById.set(id, tab)
            tab.destroyed$.subscribe(() => {
                this.idByTab.delete(tab)
                this.tabsById.delete(id)
                this.sourceClosed.next(id)
            })
        }
        return id
    }

    getTab (id: string|null): BaseTabComponent|null {
        if (!id) {
            return null
        }
        return this.tabsById.get(id) ?? null
    }

    /** Lists all terminal tabs usable as a filter source (excluding filter tabs) */
    getTerminalTabs (): SourceTabInfo[] {
        // Late require: avoids a load-time circular dependency with filterTab.component
        const { FilterTabComponent } = require('./filterTab.component')
        const all: BaseTabComponent[] = this.app.tabs.flatMap(
            t => t instanceof SplitTabComponent ? t.getAllTabs() : [t],
        )
        return all
            .filter(t => t instanceof BaseTerminalTabComponent && !(t instanceof FilterTabComponent))
            .map(t => ({
                id: this.getId(t),
                title: t.title ?? t.constructor.name,
            }))
    }

    /** Opens a filter terminal in a pane below `sourceTab`, bound to it */
    async openFilterPane (sourceTab: BaseTerminalTabComponent<any>, options: Partial<FilterOptions>): Promise<FilterTabComponent> {
        const { FilterTabComponent } = require('./filterTab.component')
        const sourceTabId = this.getId(sourceTab)
        const profile = makeFilterProfile({ ...options, sourceTabId })
        const newTab = this.tabsService.create<FilterTabComponent>({ type: FilterTabComponent, inputs: { profile } })
        const splitTab = sourceTab.parent instanceof SplitTabComponent
            ? sourceTab.parent
            : this.app.wrapAndAddTab(sourceTab)
        await splitTab.addTab(newTab, sourceTab, 'b')
        return newTab
    }

    makeProfile (options: Partial<FilterOptions>): FilterProfile {
        return makeFilterProfile(options)
    }
}
