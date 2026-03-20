use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;
use tiberius::{AuthMethod, Client, Config, EncryptionLevel};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

type MssqlClient = Client<Compat<TcpStream>>;

pub struct DbState(Arc<Mutex<Option<MssqlClient>>>);

#[derive(Deserialize)]
pub struct ConnectParams {
    host: String,
    port: u16,
    database: String,
    username: String,
    password: String,
    /// true: TLS必須, false: TLS無効（古いサーバー向け）
    encrypt: bool,
    /// サーバー証明書を検証せずに信頼する
    trust_cert: bool,
}

#[derive(Serialize)]
pub struct TableInfo {
    schema: String,
    name: String,
    table_type: String,
}

/// SQL Server に接続する。
/// - encrypt=false の場合は暗号化なし（TLS不要）で接続
/// - encrypt=true + trust_cert=true の場合は TLS接続（証明書検証なし）
/// - native-tls を使用しているため OS の TLS スタック（Windows: SChannel）を利用可能
///   → TLS 1.0 / 1.1 が OS レベルで有効であれば接続できる
#[tauri::command]
async fn connect_db(
    params: ConnectParams,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let mut config = Config::new();
    config.host(&params.host);
    config.port(params.port);
    config.database(&params.database);

    if params.username.is_empty() {
        // Windows 統合認証
        config.authentication(AuthMethod::windows());
    } else {
        config.authentication(AuthMethod::sql_server(&params.username, &params.password));
    }

    if params.trust_cert {
        config.trust_cert();
    }

    if params.encrypt {
        config.encryption(EncryptionLevel::Required);
    } else {
        // 暗号化なし: 古いサーバーや TLS 未設定環境向け
        config.encryption(EncryptionLevel::NotSupported);
    }

    let tcp = TcpStream::connect(format!("{}:{}", params.host, params.port))
        .await
        .map_err(|e| format!("TCP接続エラー: {}", e))?;
    tcp.set_nodelay(true).map_err(|e| e.to_string())?;

    let client = Client::connect(config, tcp.compat_write())
        .await
        .map_err(|e| format!("DB接続エラー: {}", e))?;

    let mut conn = state.0.lock().await;
    *conn = Some(client);

    Ok("接続しました".to_string())
}

#[tauri::command]
async fn disconnect_db(state: State<'_, DbState>) -> Result<(), String> {
    let mut conn = state.0.lock().await;
    *conn = None;
    Ok(())
}

/// 接続中のDBのテーブル・ビュー一覧を取得する
#[tauri::command]
async fn list_tables(state: State<'_, DbState>) -> Result<Vec<TableInfo>, String> {
    let mut conn = state.0.lock().await;
    let client = conn.as_mut().ok_or("DBに接続されていません")?;

    let rows = client
        .query(
            "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE \
             FROM INFORMATION_SCHEMA.TABLES \
             ORDER BY TABLE_SCHEMA, TABLE_NAME",
            &[],
        )
        .await
        .map_err(|e| format!("クエリエラー: {}", e))?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let tables = rows
        .iter()
        .map(|row| TableInfo {
            schema: row.get::<&str, _>(0).unwrap_or("").to_string(),
            name: row.get::<&str, _>(1).unwrap_or("").to_string(),
            table_type: row.get::<&str, _>(2).unwrap_or("").to_string(),
        })
        .collect();

    Ok(tables)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(DbState(Arc::new(Mutex::new(None))))
        .invoke_handler(tauri::generate_handler![connect_db, disconnect_db, list_tables])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
