import { Injectable } from '@angular/core'
import { HotkeyDescription, HotkeyProvider, TranslateService } from 'tabby-core'

/** @hidden */
@Injectable()
export class FilterHotkeyProvider extends HotkeyProvider {
    hotkeys: HotkeyDescription[] = [
        {
            id: 'output-filter.toggle-panel',
            name: this.translate.instant('Focus the filter pattern input'),
        },
        {
            id: 'output-filter.new-pane',
            name: this.translate.instant('Open a filter pane below the current terminal'),
        },
    ]

    constructor (private translate: TranslateService) {
        super()
    }

    async provide (): Promise<HotkeyDescription[]> {
        return this.hotkeys
    }
}
