import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface ConnectParams {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  encrypt: boolean;
  trust_cert: boolean;
}

interface TableInfo {
  schema: string;
  name: string;
  table_type: string;
}

const DEFAULT_PARAMS: ConnectParams = {
  host: "localhost",
  port: 1433,
  database: "",
  username: "",
  password: "",
  encrypt: false,
  trust_cert: true,
};

function App() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ message: string; isError: boolean }>({
    message: "",
    isError: false,
  });
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [params, setParams] = useState<ConnectParams>(DEFAULT_PARAMS);

  function updateParam<K extends keyof ConnectParams>(key: K, value: ConnectParams[K]) {
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus({ message: "", isError: false });
    try {
      await invoke("connect_db", { params });
      setConnected(true);
      const result = await invoke<TableInfo[]>("list_tables");
      setTables(result);
      setStatus({ message: `接続成功 — テーブル ${result.length} 件`, isError: false });
    } catch (err) {
      setStatus({ message: String(err), isError: true });
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    await invoke("disconnect_db");
    setConnected(false);
    setTables([]);
    setStatus({ message: "切断しました", isError: false });
  }

  // テーブルをスキーマごとにグループ化
  const grouped = tables.reduce<Record<string, TableInfo[]>>((acc, t) => {
    (acc[t.schema] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="app">
      {/* サイドバー */}
      <aside className="sidebar">
        {!connected ? (
          <form onSubmit={handleConnect} className="connect-form">
            <h2>DB 接続</h2>

            <label>
              ホスト
              <input
                value={params.host}
                onChange={(e) => updateParam("host", e.target.value)}
                required
              />
            </label>

            <label>
              ポート
              <input
                type="number"
                value={params.port}
                onChange={(e) => updateParam("port", Number(e.target.value))}
                required
              />
            </label>

            <label>
              データベース名
              <input
                value={params.database}
                onChange={(e) => updateParam("database", e.target.value)}
                required
              />
            </label>

            <label>
              ユーザー名
              <input
                value={params.username}
                onChange={(e) => updateParam("username", e.target.value)}
                placeholder="空白で Windows 認証"
              />
            </label>

            <label>
              パスワード
              <input
                type="password"
                value={params.password}
                onChange={(e) => updateParam("password", e.target.value)}
              />
            </label>

            <div className="checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={params.encrypt}
                  onChange={(e) => updateParam("encrypt", e.target.checked)}
                />
                TLS 暗号化を使用
              </label>
              <p className="hint-text">
                無効にすると TLS なしで接続（TLS 1.0/1.1 しか使えない古いサーバーでも「有効」を試してください）
              </p>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={params.trust_cert}
                  onChange={(e) => updateParam("trust_cert", e.target.checked)}
                />
                サーバー証明書を無条件に信頼
              </label>
            </div>

            <button type="submit" disabled={loading}>
              {loading ? "接続中…" : "接続"}
            </button>
          </form>
        ) : (
          <div className="table-list">
            <div className="table-list-header">
              <h2>テーブル一覧</h2>
              <button onClick={handleDisconnect} className="btn-disconnect">
                切断
              </button>
            </div>

            {Object.keys(grouped).length === 0 ? (
              <p className="empty">テーブルが見つかりません</p>
            ) : (
              Object.entries(grouped).map(([schema, items]) => (
                <div key={schema} className="schema-group">
                  <div className="schema-name">{schema}</div>
                  <ul>
                    {items.map((t) => (
                      <li key={t.name} className={t.table_type === "VIEW" ? "is-view" : ""}>
                        <span className="table-name">{t.name}</span>
                        {t.table_type === "VIEW" && <span className="badge">VIEW</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        )}
      </aside>

      {/* メインエリア */}
      <main className="main">
        {connected ? (
          <p className="placeholder">← テーブルを選択するとデータを表示します（Phase 2）</p>
        ) : (
          <p className="placeholder">左のフォームから SQL Server に接続してください</p>
        )}
      </main>

      {/* ステータスバー */}
      {status.message && (
        <div className={`statusbar ${status.isError ? "statusbar--error" : ""}`}>
          {status.message}
        </div>
      )}
    </div>
  );
}

export default App;
