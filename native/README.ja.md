# Native mesh avatars

[English](README.md) · [简体中文](README.zh.md)

Rust 版のランタイムは、JavaScript 版と同じ `.mavatar` ファイルとビルド済みプロジェクトフォルダを読み込みます。
透明なデスクトップアバターと PNG レンダラーが入っています。デスクトップ版の主な対象は Metal を使う macOS です。

## 必要なもの

- Rust 1.88 以降と Cargo。
- macOS では Xcode Command Line Tools と、Metal に対応した GPU。
- アバターのアーカイブ、または `rig.json`・`built/layers.json`・ビルド済み PNG を含むプロジェクト。
  イラスト単体ではアバターとして動かせません。

以下のコマンドはリポジトリのルートで実行します。既定のアバターは `samples/miko-qipao` で、その画像がインストールされている必要があります。
サンプルには[素材の利用規約](../samples/miko-qipao/MIKO_ASSET_TERMS.md)が適用されます。

## デスクトップアプリ

```sh
cargo build --release --manifest-path native/Cargo.toml -p mesh-avatar-desktop
native/target/release/mesh-avatar-desktop
```

別のアバターを開く:

```sh
native/target/release/mesh-avatar-desktop /path/to/avatar.mavatar
native/target/release/mesh-avatar-desktop /path/to/project
```

引数を省略すると、ソースのチェックアウトまたは実行ファイルの位置からサンプルを探します。
実行ファイルを別の場所にコピーした場合は、アバターのパスを指定してください。

macOS では、ウィンドウは透明・枠なし・通常のウィンドウより手前に表示され、影はつきません。
初期の幅は 400 論理ピクセルで、高さはアバターの画像サイズと表示余白から決まります。同梱サンプルは約 400 × 372 で始まり、画像上端の平らな切れ目はウィンドウの外に置かれます。
大きく動いたときは、その切れ目が見えないよう、切り取り位置が少し下がることがあります。拡大縮小しても縦横比は変わりません。
スクロールとキーボードによる拡大縮小の範囲は 40%〜400% で、モニターの大きさと GPU のテクスチャ上限によってさらに制限されます。
連続した入力はまとめてからリサイズし、描画面とウィンドウの大きさが一致するまで描画を待ちます。

macOS では、**File → Open Avatar…** で標準のダイアログが開き、`.mavatar` アーカイブか、`rig.json` と `built/` を含むプロジェクトフォルダを選べます。
どちらもアバターのウィンドウにドロップして開くこともできます。読み込みはバックグラウンドで行い、読み込めないアバターを選んだ場合は今のアバターを表示したままエラーを出します。
切り替えに成功すると、GPU リソースと表示領域を作り直します。拡大率は新しいサイズの上限の範囲で保ち、ウィンドウ左上の位置とクリック透過の状態も維持します。新しいモーションの一覧はターミナルに表示されます。

**File → Open Recent** には、正常に開けたパスが最新 8 件まで残ります。保存先は OS のユーザー設定ディレクトリ(macOS では `~/Library/Application Support/`)の `mesh-avatar-desktop/recent.json` です。
存在しなくなったパスは、起動時とアプリが再びフォーカスされたときに一覧から外れます。**File → Reload** は、編集後に今のアバターを読み込み直します。
新しいアバターを読み込むと、表情とアニメーションの状態はリセットされます。

| 操作 | 動作 |
|---|---|
| Command + `O` | アバターのアーカイブかビルド済みプロジェクトフォルダを開く(macOS) |
| Command + `R` | 今のアバターを読み込み直す |
| `.mavatar` かプロジェクトフォルダをドロップ | 同じウィンドウでアバターを切り替える |
| 左ドラッグ | アバターのウィンドウを移動する |
| スクロール | ウィンドウを拡大縮小する |
| Command + `+` / `-` | ウィンドウを拡大縮小する |
| `1`〜`9` | 組み込みモーションの最初の 9 個を再生する(一覧はターミナルに表示) |
| `E` | ライブ表情を順に切り替える |
| `K` | かなの口形デモを再生する(音声は出ません) |
| `C` | カーソルのクリック透過を切り替える(起動時はオフ) |
| Escape または Command + `Q` | 終了する |

操作は、アバターのアプリにキーボードフォーカスがあるときに有効です。クリック透過をオンにすると、マウス操作は下のウィンドウに届きます。
オフに戻すには、Dock か Command-Tab でアバターのアプリにフォーカスを戻してから `C` を押します。このキーはグローバルショートカットではありません。
フォーカスを戻せない場合は Dock から終了して起動し直してください。クリック透過は起動時に必ずオフになります。

待機中の動き、まばたき、呼吸、ときどき入るモーションは自動で再生されます。
描画はディスプレイの表示レートに合わせます。リサイズやモニターの拡大率の変更に合わせて実際の描画サイズを更新し、処理が止まったりスリープから復帰したりした後のアニメーションの時間刻みは 0.05 秒までに抑えます。

## PNG を書き出す

```sh
cargo run --release --manifest-path native/Cargo.toml -p mesh-avatar-wgpu \
  --bin mesh-avatar-render -- samples/miko-qipao --size 512x640 -o avatar.png
```

`--pose` には `{"angleX":20,"mouthOpen":0.8}` のような JSON オブジェクトを渡します。
指定しなかったポーズのパラメータは既定値になります。`--seconds` を指定すると、書き出す前に毎秒 60 ステップでアバターの時間を進めます。
`--help` で、表示余白、fit、表情、マルチサンプリングのオプションを確認できます。

## チェックと見た目の比較

Node.js 22.17 以降とリポジトリの npm 依存関係は、JavaScript 版との比較にだけ必要です。

```sh
node --experimental-strip-types native/conformance/dump.mjs
cargo test --manifest-path native/Cargo.toml
cargo clippy --manifest-path native/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path native/Cargo.toml --all --check
node native/conformance/compare-pixels.mjs
```

dump は、Rust 側に埋め込んだモーションデータが JavaScript のソースと一致しているかも確認します。
意図して更新するときは `node --experimental-strip-types native/conformance/sync-motion-data.mjs` を実行します。
数値の比較データ、PNG、レポートは git の管理外の `native/target/` に出力されます。生成データがない場合、比較テストはスキップした旨を表示します。
画素の比較には Playwright がインストールした Chromium を使います。macOS では `--metal` で Metal バックエンドを選べ、`--dpr=2` で HiDPI 時に同じ物理サイズで比較します。

## 制限事項

- Windows と Linux のデスクトップでの動作は確認していません。ウィンドウの透明化、最前面表示、クリック透過は OS のコンポジタに依存します。
  透明な描画面を使えない環境では、アプリは終了します。
- メニューバーと Open Avatar ダイアログは macOS 専用です。実行ファイルには、アプリバンドルなしで「Mesh Avatar」という名前を埋め込んでいます。
  macOS がほかの場所で表示する名前は、起動のしかたによって変わることがあります。
- デスクトップでの入力は上の操作に限られます。カメラトラッキング、マイク入力、音声再生、ライティングには対応していません。
- デスクトップ版は Cargo でビルドする実行ファイルで、インストーラー、署名済みアプリバンドル、グローバルショートカットはありません。
  ウィンドウの位置と拡大率は起動のたびにリセットされます。
- GPU のラスタライズとアンチエイリアスは Chromium とわずかに異なることがあります。ほぼ透明な画像の縁を調べるときは、プリマルチプライド済みの色で比較してください。
