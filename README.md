# Atlas

Atlas は、ブラウザ上で動作するビジュアルドキュメントエディタです。ノードとエッジからなる図を編集でき、Mermaid からの取り込み、3D モデルの埋め込み、Web カメラを用いたハンドジェスチャ操作、LLM を用いたドキュメント支援チャットを統合しています。ジェスチャ入力では MediaPipe Gesture Recognizer の出力ランドマークに対してカルマンフィルタによる平滑化と先読み補正を行い、Mermaid レイアウトでは ForceAtlas2 ベースの独自拡張アルゴリズムを利用しています。フロントエンドは React + Vite、API と静的配信は Cloudflare Workers 上の Hono で構成されています。

## プロジェクト概要

- ノードベースのキャンバス上で図やメモを編集する Web アプリです。
- 独自の .atlas バイナリ形式でドキュメントを保存・読込できます。
- Mermaid コードからノードとエッジを生成でき、意味グループ化と ForceAtlas2 ベースの独自拡張レイアウトで自動配置できます。
- OpenAI / Google の LLM を UI から切り替え、現在のドキュメント状態を参照しながらチャットできます。
- MediaPipe の Gesture Recognizer を使い、カメラ映像からパン、ズーム、ノード操作などのジェスチャ入力を扱います。ランドマーク座標はカルマンフィルタで平滑化し、短い先読み補正で操作のブレを抑えています。

## 主な機能 / ユースケース

- 図解メモ、関係図、概念図の作成
- Mermaid フローチャートやマインドマップの Atlas ドキュメント化
- Mermaid フローチャートの意味構造を保った自動レイアウト
- 画像ノード、図形ノード、テキストノード、3D モデルノードの配置
- カメラ入力を使ったハンズフリー操作の実験
- ドキュメント内容を LLM に要約・説明させる対話支援

## 技術スタック

- 言語: TypeScript
- フロントエンド: React 19, Vite 7, SWC
- UI: Tailwind CSS 4, Radix UI, lucide-react
- 3D 表示: three
- 図編集: 独自ドキュメントモデル + プラグイン構成
- Mermaid 配置: ForceAtlas2 ベースの独自拡張レイアウトエンジン
- サーバ: Hono, Cloudflare Workers, Wrangler
- LLM SDK: openai, @google/genai
- ビジョン/ジェスチャ: @mediapipe/tasks-vision + カルマンフィルタ平滑化
- 品質管理: ESLint, TypeScript, oxfmt

## モデル情報

このリポジトリは、学習済みモデルを複数利用します。学習コードは含まれていません。

### 1. LLM

- OpenAI 系
  - 既定モデル: gpt-4.1-mini
  - 選択可能モデル例: gpt-5.4, gpt-5.4-mini, gpt-4.1, o4-mini, gpt-4o など
  - 取得先: https://platform.openai.com/docs/models
- Google 系
  - 既定モデル: gemini-2.5-flash
  - 選択可能モデル例: gemini-2.5-flash, gemini-2.5-pro, gemini-3-flash-preview など
  - 取得先: https://ai.google.dev/gemini-api/docs/models

Atlas では API キーを環境変数ではなく UI から入力し、ブラウザ Cookie に保存します。

### 2. ジェスチャ認識モデル

- モデル名: MediaPipe Gesture Recognizer task asset
- 配置場所: public/tasks/gesture_recognizer.task
- 用途: 手のランドマーク検出とジェスチャ分類
- 取得先: https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer

## 使用データの概要と取得方法

- 同梱モデル資産
  - public/tasks/gesture_recognizer.task
  - 用途: ブラウザ上でのジェスチャ認識

追加の学習用データセットや Hugging Face 依存はありません。LLM は各プロバイダ API をオンライン利用します。

## 前提環境

- OS
  - macOS, Linux, Windows のいずれでも Node.js が動作すれば実行可能
  - 開発時の現在環境は macOS
- Node.js
  - Node.js 20 以上を推奨
- パッケージマネージャ
  - npm を想定
- ブラウザ
  - 最新の Chromium / Gecko 系ブラウザを推奨
  - カメラ機能を使う場合は getUserMedia と WebGL が利用可能であること
- GPU
  - 必須ではありません
  - ただし 3D 表示やカメラ推論を快適に使うには WebGL 対応 GPU が望まれます

Python や CUDA は不要です。

## セットアップ手順

### 1. 依存関係のインストール

```bash
npm install
```

requirements.txt はありません。依存関係は package.json で管理しています。

### 2. Cloudflare Workers 開発ツールの利用準備

Wrangler を使うため、初回のみ必要に応じて Cloudflare にログインします。

```bash
npx wrangler login
```

ローカル開発だけであれば、環境によっては未ログインでも動作します。

## 環境変数設定

必須の .env ファイルはありません。

- OpenAI / Google の API キー
  - アプリ起動後、Chat パネルの Settings から入力します
  - 保存先はブラウザ Cookie です
  - サーバ側で固定の秘密情報を保持する構成ではありません

Cloudflare 配備時に追加のバインディングを使う場合は wrangler.jsonc を拡張してください。現状の必須バインディングは静的ファイル配信用の ASSETS のみです。

## 実行方法

### 開発サーバ起動

フロントエンドと Workers サーバをまとめて起動するには以下を使います。

```bash
npm run dev
```

Vite 単体のフロントエンド開発サーバだけを使う場合は以下です。

```bash
npm run dev:vite
```

### ビルド

```bash
npm run build
```

このコマンドは以下を順に実行します。

- アプリ本体の TypeScript ビルド
- Vite によるフロントエンドビルド
- tsconfig.server.json を使った Workers エントリのビルド

### プレビュー

```bash
npm run preview
```

### デプロイ

```bash
npm run deploy
```

## 再現手順

最小構成で挙動を再現する手順です。

1. npm install を実行する
2. npm run dev を実行する
3. ブラウザで表示された URL を開く
4. 左サイドバーからドキュメントを作成または既存ドキュメントを開く
5. Add メニューからテキスト、図形、画像、3D ノードを追加する
6. File メニューまたはコマンドから Mermaid 読み込みを開き、サンプルコードを投入する
7. Chat パネルを開き、Provider と Model と API Token を設定する
8. 文書構造について質問し、LLM が現在のドキュメント状態を参照して回答することを確認する
9. カメラ機能を有効化し、ジェスチャ操作が必要な環境ではカメラ権限を許可する

## 学習方法

学習スクリプト、ファインチューニング手順、再学習用データセットはこのリポジトリに含まれていません。利用するのは外部提供の学習済みモデルです。

## 推論方法

### LLM 推論

- Chat パネルで Provider, Model, API Token を設定します
- クライアントは /api/llm/turn にリクエストを送ります
- サーバは OpenAI または Google Gemini API を呼び出します
- 必要に応じて現在のドキュメント状態をツール呼び出しとして LLM に渡します

### ジェスチャ推論

- カメラを有効にすると public/tasks/gesture_recognizer.task を読み込みます
- ブラウザ上で MediaPipe Gesture Recognizer がフレームごとに認識を行います
- 認識した各ランドマーク座標に対して 1 次元カルマンフィルタで平滑化を行い、短い lead 時間を使った先読み補正を加えます
- 左右の手スロットを安定して追跡しながら、平滑化済みの認識結果をエディタのジェスチャレジスタ群へ配信し、パンやズームなどの操作へ変換します

### Mermaid レイアウト

- フローチャートの無向接続を使って意味的なグループを構成し、グループ単位の木構造を生成します
- ルートグループの初期配置に対して、ForceAtlas2 ベースの独自拡張レイアウトエンジンを適用します
- このレイアウトでは反発力、重力、エッジの引力に加え、元の進行方向を保つための主軸・副軸バイアス、ノードサイズを考慮した衝突回避、反復ごとの適応的な速度制御を組み合わせています
- 最終的な配置は正規化とスケーリングを行ったうえでキャンバスへ反映され、アニメーション開始用の圧縮配置も別途生成されます

## エントリーポイント

- フロントエンド
  - src/main.tsx
  - src/App.tsx
  - src/layout.tsx
- エディタ本体
  - src/components/document/editor.tsx
- Workers サーバ
  - src/server/index.ts
- Wrangler エントリーポイント
  - src/server/index.js

主要な API エンドポイントは以下です。

- GET /api/health
- POST /api/llm/turn
- POST /api/llm/chat

## ディレクトリ構成

```text
.
├── public/
│   └── tasks/
│       └── gesture_recognizer.task    # MediaPipe ジェスチャ認識モデル
├── src/
│   ├── components/
│   │   ├── document/                  # ドキュメントモデル、エディタ、I/O、UI
│   │   ├── ui/                        # UI コンポーネント
│   │   └── vision/                    # カメラ・ジェスチャ処理
│   ├── hooks/                         # テーマなどのフック
│   ├── lib/                           # LLM 設定や共通ユーティリティ
│   ├── plugins/
│   │   └── builtin/                   # 標準ノード、メニュー、Mermaid、ジェスチャ
│   ├── server/                        # Cloudflare Workers + Hono
│   ├── shared/                        # クライアント/サーバ共有型
│   ├── App.tsx
│   ├── layout.tsx
│   └── main.tsx
├── index.html
├── package.json
├── vite.config.ts
└── wrangler.jsonc
```

## ドキュメント形式

- Atlas ドキュメントは独自の .atlas 形式で入出力します
- 画像や 3D モデルなどのバイナリはドキュメント内部に埋め込まれます
- ブラウザ内の作業中ドキュメントは IndexedDB に保存されます

## 制約・注意事項

- LLM 利用には OpenAI または Google の有効な API キーが必要です
- API キーはブラウザ Cookie に保存されるため、共有端末では取り扱いに注意してください
- ジェスチャ操作にはカメラ権限が必要です
- 3D 表示はブラウザと GPU の性能に依存します
- Gesture Recognizer は同梱済みですが、MediaPipe 実行時のブラウザ互換性に影響を受けます
- Cloudflare Workers での配備を前提にしています
- 外部 LLM API を使うため、完全オフラインではチャット機能は動作しません
- 学習処理は含まれていないため、モデル再学習の再現はできません

## 開発用コマンド

```bash
npm run lint
npm run fmt
```

## ライセンス

MIT
