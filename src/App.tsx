import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as XLSX from "xlsx";
import "./App.css";

const PAGE_SIZE = 100;

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

interface SelectedTable {
  schema: string;
  name: string;
}

interface TableData {
  columns: string[];
  rows: (string | null)[][];
  total_rows: number;
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
  const [selectedTable, setSelectedTable] = useState<SelectedTable | null>(null);
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [dataPage, setDataPage] = useState(0);
  const [dataLoading, setDataLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  function updateParam<K extends keyof ConnectParams>(key: K, value: ConnectParams[K]) {
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  async function handleConnect(e: { preventDefault(): void }) {
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
    setSelectedTable(null);
    setTableData(null);
    setStatus({ message: "切断しました", isError: false });
  }

  async function loadTableData(schema: string, name: string, page: number) {
    setDataLoading(true);
    setStatus({ message: "", isError: false });
    try {
      const data = await invoke<TableData>("fetch_table_data", {
        schema,
        table: name,
        page,
        pageSize: PAGE_SIZE,
      });
      setTableData(data);
    } catch (err) {
      setStatus({ message: String(err), isError: true });
      setTableData(null);
    } finally {
      setDataLoading(false);
    }
  }

  async function handleSelectTable(schema: string, name: string) {
    setSelectedTable({ schema, name });
    setDataPage(0);
    setTableData(null);
    await loadTableData(schema, name, 0);
  }

  async function changePage(newPage: number) {
    if (!selectedTable) return;
    setDataPage(newPage);
    await loadTableData(selectedTable.schema, selectedTable.name, newPage);
  }

  // macOS の WKWebView は Blob URL ダウンロードを拒否するため、
  // バイト列を Rust に渡してダウンロードフォルダへ直接保存する
  async function saveFile(filename: string, data: Uint8Array): Promise<string> {
    return invoke<string>("save_file", { filename, data: Array.from(data) });
  }

  // 全行を取得してCSVとして保存（BOM付き UTF-8 でExcelでも文字化けしない）
  async function handleExportCsv() {
    if (!selectedTable) return;
    setExporting(true);
    setStatus({ message: "CSV 出力中…", isError: false });
    try {
      const data = await invoke<TableData>("fetch_all_rows", {
        schema: selectedTable.schema,
        table: selectedTable.name,
      });
      const rows = [data.columns, ...data.rows.map((r) => r.map((c) => c ?? ""))];
      const csv = rows
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\r\n");
      // UTF-8 BOM (EF BB BF) を先頭に付与
      const encoded = new TextEncoder().encode(csv);
      const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...encoded]);
      const path = await saveFile(`${selectedTable.name}.csv`, withBom);
      setStatus({ message: `CSV 保存完了（${data.rows.length.toLocaleString()} 件）→ ${path}`, isError: false });
    } catch (err) {
      setStatus({ message: String(err), isError: true });
    } finally {
      setExporting(false);
    }
  }

  // 全行を取得して Excel（.xlsx）として保存
  async function handleExportExcel() {
    if (!selectedTable) return;
    setExporting(true);
    setStatus({ message: "Excel 出力中…", isError: false });
    try {
      const data = await invoke<TableData>("fetch_all_rows", {
        schema: selectedTable.schema,
        table: selectedTable.name,
      });
      const aoa = [data.columns, ...data.rows.map((r) => r.map((c) => c ?? ""))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      // Excel のシート名は 31 文字以内
      XLSX.utils.book_append_sheet(wb, ws, selectedTable.name.slice(0, 31));
      const buf: number[] = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      const path = await saveFile(`${selectedTable.name}.xlsx`, new Uint8Array(buf));
      setStatus({ message: `Excel 保存完了（${data.rows.length.toLocaleString()} 件）→ ${path}`, isError: false });
    } catch (err) {
      setStatus({ message: String(err), isError: true });
    } finally {
      setExporting(false);
    }
  }

  // テーブルをスキーマごとにグループ化
  const grouped = tables.reduce<Record<string, TableInfo[]>>((acc, t) => {
    (acc[t.schema] ??= []).push(t);
    return acc;
  }, {});

  const totalPages = tableData ? Math.max(1, Math.ceil(tableData.total_rows / PAGE_SIZE)) : 1;

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
                placeholder="必須"
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
                      <li
                        key={t.name}
                        className={[
                          t.table_type === "VIEW" ? "is-view" : "",
                          selectedTable?.schema === schema && selectedTable?.name === t.name
                            ? "selected"
                            : "",
                        ]
                          .join(" ")
                          .trim()}
                        onClick={() => handleSelectTable(schema, t.name)}
                      >
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
        {!connected || !selectedTable ? (
          <div className="main-centered">
            <p className="placeholder">
              {!connected
                ? "左のフォームから SQL Server に接続してください"
                : "← テーブルを選択するとデータを表示します"}
            </p>
          </div>
        ) : dataLoading ? (
          <div className="main-centered">
            <p className="placeholder">読み込み中…</p>
          </div>
        ) : tableData ? (
          <div className="data-view">
            <div className="data-header">
              <span className="data-table-name">
                [{selectedTable.schema}].[{selectedTable.name}]
              </span>
              <span className="data-row-count">
                {tableData.total_rows.toLocaleString()} 件
              </span>
              <div className="export-buttons">
                <button
                  onClick={handleExportCsv}
                  disabled={exporting || dataLoading}
                  title="CSV ファイルとしてダウンロード（最大 50,000 件）"
                >
                  CSV
                </button>
                <button
                  onClick={handleExportExcel}
                  disabled={exporting || dataLoading}
                  title="Excel ファイルとしてダウンロード（最大 50,000 件）"
                >
                  Excel
                </button>
                <button
                  onClick={() => invoke("print_window")}
                  title="印刷 / PDF として保存"
                >
                  印刷
                </button>
              </div>
            </div>

            <div className="data-grid-wrapper">
              <table className="data-grid">
                <thead>
                  <tr>
                    {tableData.columns.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.rows.length === 0 ? (
                    <tr>
                      <td colSpan={tableData.columns.length} className="empty-rows">
                        データがありません
                      </td>
                    </tr>
                  ) : (
                    tableData.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} className={cell === null ? "cell-null" : ""}>
                            {cell === null ? "NULL" : cell}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <button disabled={dataPage === 0} onClick={() => changePage(dataPage - 1)}>
                ‹ 前へ
              </button>
              <span className="page-info">
                {tableData.total_rows > 0
                  ? `${dataPage + 1} / ${totalPages} ページ（${(dataPage * PAGE_SIZE + 1).toLocaleString()}–${Math.min(
                      (dataPage + 1) * PAGE_SIZE,
                      tableData.total_rows
                    ).toLocaleString()} 件目）`
                  : "0 件"}
              </span>
              <button
                disabled={(dataPage + 1) * PAGE_SIZE >= tableData.total_rows}
                onClick={() => changePage(dataPage + 1)}
              >
                次へ ›
              </button>
            </div>
          </div>
        ) : null}
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
