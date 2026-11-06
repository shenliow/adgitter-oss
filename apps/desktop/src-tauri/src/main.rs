// Hide the console window on Windows for release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    adgitter_lib::run();
}
