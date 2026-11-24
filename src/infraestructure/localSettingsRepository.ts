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
        try {
            localStorage.setItem(KEY, JSON.stringify(settings));
        } catch {
            // Ignora errores de cuota/almacenamiento restringido
        }
    },
};