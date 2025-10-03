# Stick Fighter の動かし方

1人が Node.js サーバーを起動し、もう1人がブラウザでアクセスするだけで対戦できるようにするための基本的なセットアップ手順です。

## 必要環境
- Node.js 18 以上
- npm 9 以上

## セットアップ手順
1. リポジトリ直下で依存関係をインストールします。
   ```bash
   npm --prefix client install
   npm --prefix server install
   ```
2. クライアントをビルドしてからサーバーを起動します。
   ```bash
   npm --prefix server run start
   ```
   `server` 側の `prestart` スクリプトでクライアントが自動ビルドされ、`server/server.js` が `client/dist` を配信します。
3. サーバーを立てた PC のポート `3000` を外部に開放し、`http://<サーバーのIPまたはドメイン>:3000/` にアクセスするとゲームが遊べます。
4. 2人とも同じ URL にアクセスすれば、そのままオンライン対戦が始められます。

> **補足**: Linux 環境でビルド時に `vite: Permission denied` が出る場合は `client` ディレクトリの依存関係を一度削除して `npm install` し直してください。Windows 用バイナリが混在していると実行権限エラーになることがあります。
