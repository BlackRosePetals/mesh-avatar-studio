import type { LiveExpression } from 'mesh-avatar';

interface Messages {
  expressions: Record<LiveExpression, string>;
  pointerHint: string;
  expressionHint: string;
  loading: string;
  loadFailed: string;
  copy: string;
  copied: string;
  copySucceeded: string;
  copyFailed: string;
}

const messages: Record<'en' | 'ja', Messages> = {
  en: {
    expressions: {
      neutral: 'Neutral', smile: 'Smile', shy: 'Shy', surprise: 'Surprise',
      halfLidded: 'Half-lidded', angry: 'Angry', sad: 'Sad', wink: 'Wink',
    },
    pointerHint: 'Move your pointer to catch her eye.',
    expressionHint: 'Pick an expression to try it.',
    loading: 'Loading the live preview…',
    loadFailed: 'The live preview couldn’t load. Try reloading in a browser with WebGL enabled. You can still explore the project on GitHub or npm.',
    copy: 'Copy',
    copied: 'Copied',
    copySucceeded: 'Copied to clipboard.',
    copyFailed: 'Copy wasn’t available. The code is selected; use your browser’s copy command.',
  },
  ja: {
    expressions: {
      neutral: '通常', smile: '笑顔', shy: '照れ', surprise: '驚き',
      halfLidded: '半目', angry: '怒り', sad: '悲しみ', wink: 'ウインク',
    },
    pointerHint: 'ポインターを動かすと、視線が追いかけます。',
    expressionHint: 'ボタンで表情を切り替えられます。',
    loading: 'プレビューを読み込んでいます…',
    loadFailed: 'プレビューを読み込めませんでした。WebGL が使えるブラウザで再読み込みしてください。プロジェクトの詳細は GitHub や npm でも確認できます。',
    copy: 'コピー',
    copied: 'コピー済み',
    copySucceeded: 'クリップボードにコピーしました。',
    copyFailed: 'コピーできませんでした。コードを選択したので、ブラウザのコピー操作を使ってください。',
  },
};

export const language = document.documentElement.lang.split('-')[0] === 'ja' ? 'ja' : 'en';
export const copy = messages[language];
