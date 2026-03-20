# CHANGELOG

## [Unreleased] - 2026-03-20

### Phase 1: DB接続 + テーブル一覧表示

#### 追加
- **SQL Server 接続機能** (`src-tauri/src/lib.rs`)
  - `connect_db` コマンド: ホスト・ポート・DB名・ユーザー/パスワードで接続
  - `disconnect_db` コマンド: 接続を切断
  - `list_tables` コマンド: `INFORMATION_SCHEMA.TABLES` からテーブル・ビュー一覧を取得
  - SQL Server 認証 / Windows 統合認証 の両方に対応
  - TLS 暗号化の有効/無効を選択可能（古いサーバー向けに無効化オプションあり）
  - サーバー証明書の検証スキップオプション（自己署名証明書対応）

- **依存クレートの追加** (`src-tauri/Cargo.toml`)
  - `tiberius 0.12` (native-tls フィーチャー): Rust 製 SQL Server クライアント
    - `native-tls` を使用することで OS の TLS スタック経由で TLS 1.0/1.1 に対応可能
  - `tokio 1` (full フィーチャー): 非同期ランタイム
  - `tokio-util 0.7` (compat フィーチャー): tokio ↔ tiberius の互換レイヤー

- **接続フォーム UI** (`src/App.tsx`)
  - ホスト・ポート・データベース名・ユーザー名・パスワードの入力フォーム
  - TLS 暗号化の有効/無効チェックボックス
  - サーバー証明書を無条件に信頼するチェックボックス
  - 接続後: スキーマ別にグループ化されたテーブル・ビュー一覧をサイドバーに表示
  - 下部ステータスバー（成功/エラーメッセージ）
  - ダークモード対応

- **プロジェクト設定ファイル**
  - `CLAUDE.md`: Claude Code 向けのプロジェクトガイダンス

#### 技術的決定事項
- `sqlx` は MSSQL 非対応のため `tiberius` を採用
- TLS 1.0/1.1 対応のため `rustls` ではなく `native-tls` フィーチャーを使用
- DB コネクションは `Arc<Mutex<Option<Client>>>` で Tauri の State として管理

---

## 今後の予定

### Phase 2: テーブルデータ表示
- テーブル選択時にデータをページネーション付きで表示
- カラム情報の取得・表示
- ソート機能

### Phase 3: エクスポート
- CSV ダウンロード（Rust 側で生成）
- Excel ダウンロード（SheetJS を使用）
- PDF 印刷（ブラウザの `window.print()` + CSS）
