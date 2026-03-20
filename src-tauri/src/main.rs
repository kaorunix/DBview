// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// #[tauri::command]
// fn greet(name: &str) -> String {
//     format!("こんにちは{}さん")
// }

fn main() {
    dbview_lib::run()
    // tauri::Builder::default()
    //     // ここで使用するコマンド関数を登録する
    //     .invoke_handler(tauri::generate_handler![greet])
    //     .run(tauri::generate_context!())
    //     .expect("error while running tauri application")

}
