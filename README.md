# Stick Fighterの動かし方

サーバーを起動すると、同じポートでクライアント用のページも配信されます。プレイヤーはブラウザでサーバーのURLにアクセスするだけで参加できます。

## セットアップ
1. 依存関係をインストールしてクライアントをビルドします。
   ```bash
   cd client
   npm install
   npm run build
   cd ../server
   npm install
   ```

## サーバーの起動
1. `server` ディレクトリで Socket.IO サーバーを起動します。
   ```bash
   npm start
   ```
2. ブラウザで `http://<サーバーのホスト名またはIP>:3000` にアクセスするとゲームが開始できます。

> **Note:** `client/script.js` を編集してIPアドレスを指定する必要はなくなりました。サーバーと同じホスト・ポートで自動的にSocket.IOへ接続します。
