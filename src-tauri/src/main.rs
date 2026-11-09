// Evita que se abra una ventana de consola extra en Windows (release).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lumen_lib::run()
}
