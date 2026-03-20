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
        return Err("ユーザー名を入力してください（Windows統合認証はこのプラットフォームでは未対応）".to_string());
    }
    config.authentication(AuthMethod::sql_server(&params.username, &params.password));

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

/// SQL Server の識別子を角括弧でクォートする（] は ]] にエスケープ）
fn quote_ident(s: &str) -> String {
    format!("[{}]", s.replace(']', "]]"))
}

#[derive(Serialize)]
pub struct TableData {
    columns: Vec<String>,
    rows: Vec<Vec<Option<String>>>,
    total_rows: i64,
}

/// 指定テーブルのデータをページネーション付きで取得する。
/// すべての列を TRY_CONVERT(NVARCHAR(MAX), ...) で文字列化して返す。
/// バイナリ型列は "(binary)" と表示する。
#[tauri::command]
async fn fetch_table_data(
    schema: String,
    table: String,
    page: i64,
    page_size: i64,
    state: State<'_, DbState>,
) -> Result<TableData, String> {
    if page_size <= 0 {
        return Err("page_size は 1 以上を指定してください".to_string());
    }

    let mut conn = state.0.lock().await;
    let client = conn.as_mut().ok_or("DBに接続されていません")?;

    // 1. 列名と型を取得
    let col_rows = client
        .query(
            "SELECT COLUMN_NAME, DATA_TYPE \
             FROM INFORMATION_SCHEMA.COLUMNS \
             WHERE TABLE_SCHEMA = @P1 AND TABLE_NAME = @P2 \
             ORDER BY ORDINAL_POSITION",
            &[&schema.as_str(), &table.as_str()],
        )
        .await
        .map_err(|e| format!("列情報取得エラー: {}", e))?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let columns: Vec<(String, String)> = col_rows
        .iter()
        .map(|row| {
            let name: &str = row.get::<&str, _>(0).unwrap_or("");
            let dtype: &str = row.get::<&str, _>(1).unwrap_or("");
            (name.to_string(), dtype.to_string())
        })
        .collect();

    let q_schema = quote_ident(&schema);
    let q_table = quote_ident(&table);

    // 2. 総件数を取得
    let count_sql = format!("SELECT COUNT(*) FROM {}.{}", q_schema, q_table);
    let count_rows = client
        .query(count_sql.as_str(), &[])
        .await
        .map_err(|e| format!("件数取得エラー: {}", e))?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let total_rows = count_rows
        .first()
        .map(|r| r.get::<i32, _>(0).unwrap_or(0))
        .unwrap_or(0) as i64;

    // 3. ページネーション付きでデータを取得
    //    バイナリ型は TRY_CONVERT が NULL を返すため固定文字列で表示
    let binary_types = ["binary", "varbinary", "image", "timestamp", "rowversion"];
    let col_selects: Vec<String> = columns
        .iter()
        .map(|(name, dtype)| {
            let q_name = quote_ident(name);
            if binary_types.contains(&dtype.to_lowercase().as_str()) {
                format!("N'(binary)' AS {}", q_name)
            } else {
                format!("TRY_CONVERT(NVARCHAR(MAX), {}) AS {}", q_name, q_name)
            }
        })
        .collect();

    let offset = page * page_size;
    let data_sql = format!(
        "SELECT {} FROM {}.{} ORDER BY (SELECT NULL) OFFSET {} ROWS FETCH NEXT {} ROWS ONLY",
        col_selects.join(", "),
        q_schema,
        q_table,
        offset,
        page_size
    );

    let data_rows = client
        .query(data_sql.as_str(), &[])
        .await
        .map_err(|e| format!("データ取得エラー: {}", e))?
        .into_first_result()
        .await
        .map_err(|e| e.to_string())?;

    let column_names: Vec<String> = columns.into_iter().map(|(name, _)| name).collect();
    let n_cols = column_names.len();

    let rows: Vec<Vec<Option<String>>> = data_rows
        .iter()
        .map(|row| {
            (0..n_cols)
                .map(|i| row.get::<&str, _>(i).map(|s| s.to_string()))
                .collect()
        })
        .collect();

    Ok(TableData {
        columns: column_names,
        rows,
        total_rows,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(DbState(Arc::new(Mutex::new(None))))
        .invoke_handler(tauri::generate_handler![
            connect_db,
            disconnect_db,
            list_tables,
            fetch_table_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
