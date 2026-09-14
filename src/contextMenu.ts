import { Injectable } from '@angular/core'
import { BaseTabComponent, MenuItemOptions, TabContextMenuItemProvider, TranslateService } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import { FilterRegistryService } from './filterRegistry'
import { RecordingManager } from './recordingManager'
import { FilterTabComponent } from './filterTab.component'

@Injectable()
export class FilterContextMenuProvider extends TabContextMenuItemProvider {
    weight = 1

    constructor (
        private registry: FilterRegistryService,
        private recording: RecordingManager,
        private translate: TranslateService,
    ) {
        super()
    }

    async getItems (tab: BaseTabComponent): Promise<MenuItemOptions[]> {
        if (tab instanceof FilterTabComponent) {
            return [
                {
                    label: this.translate.instant('Edit filter pattern...'),
                    click: () => {
                        setTimeout(() => tab.focusPatternInput())
                    },
                },
                {
                    label: this.recording.isRecordingFiltered(tab.session)
                        ? this.translate.instant('Stop recording filtered output')
                        : this.translate.instant('Record filtered output to file'),
                    click: () => {
                        setTimeout(() => tab.toggleRecording())
                    },
                },
                {
                    label: tab.session?.filter.isPaused()
                        ? this.translate.instant('Resume filter output')
                        : this.translate.instant('Pause filter output'),
                    click: () => {
                        setTimeout(() => tab.onPanelPause(!tab.session?.filter.isPaused()))
                    },
                },
            ]
        }
        if (tab instanceof BaseTerminalTabComponent) {
            const recordingFull = this.recording.isRecordingFull(this.registry.getId(tab))
            return [
                {
                    label: this.translate.instant('Filter output to new pane...'),
                    click: () => {
                        setTimeout(() => this.registry.openFilterPane(tab, {}))
                    },
                },
                {
                    label: recordingFull
                        ? this.translate.instant('Stop recording output')
                        : this.translate.instant('Record output to file'),
                    click: () => {
                        setTimeout(() => this.recording.toggleFullRecording(tab))
                    },
                },
            ]
        }
        return []
    }
}
