import { ConfigProvider } from 'tabby-core'

/** @hidden */
export class FilterConfigProvider extends ConfigProvider {
    defaults = {
        outputFilter: {
            history: [],
            historyLimit: 20,
            pauseBufferLimitBytes: 1 << 20,
            recording: {
                directory: null,
                filenameTemplate: '{date}_{time}.log',
            },
        },
        hotkeys: {
            'output-filter': {
                'toggle-panel': 'ctrl+alt+f',
            },
        },
    }

    platformDefaults = { }
}
