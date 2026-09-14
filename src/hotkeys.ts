import { Injectable } from '@angular/core'
import { HotkeyDescription, HotkeyProvider, TranslateService } from 'tabby-core'

/** @hidden */
@Injectable()
export class FilterHotkeyProvider extends HotkeyProvider {
    hotkeys: HotkeyDescription[] = [
        {
            id: 'filter-output.toggle-panel',
            name: this.translate.instant('Focus the filter pattern input'),
        },
    ]

    constructor (private translate: TranslateService) {
        super()
    }

    async provide (): Promise<HotkeyDescription[]> {
        return this.hotkeys
    }
}
