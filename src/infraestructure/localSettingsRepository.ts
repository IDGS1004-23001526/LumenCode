import type { SettingsRepository } from "../application/ports";

const KEY = "lumencode.settings";

export const localSettingsRepository: SettingsRepository = {
    load() {
        try {
            return JSON.parse(localStorage.getItem(KEY) ?? "null");
        } catch {
            return null;
        }
    },
    save(settings) {
        localStorage.setItem(KEY, JSON.stringify(settings));
    },
};