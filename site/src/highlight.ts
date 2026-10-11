// Minimal syntax colouring for the fixed code samples on the page.
// Tokens are wrapped in spans, so copying the element's textContent is unchanged.

type Rule = [kind: string, pattern: RegExp];

const rules: Record<string, Rule[]> = {
  js: [
    ['comment', /\/\/[^\n]*/y],
    ['string', /'[^'\n]*'|"[^"\n]*"/y],
    ['keyword', /\b(?:import|from|const|let|await|async|return|new)\b/y],
    ['literal', /\b(?:true|false|null|undefined)\b/y],
    ['number', /\b\d+(?:\.\d+)?\b/y],
    ['function', /\b[A-Za-z_$][\w$]*(?=\()/y],
    ['property', /\b[A-Za-z_$][\w$]*(?=\s*:)/y],
  ],
  html: [
    ['tag', /<\/?[a-z][\w-]*|\/?>/y],
    ['attr', /\b[a-z-]+(?==)/y],
    ['string', /"[^"\n]*"/y],
  ],
  shell: [
    ['keyword', /^(?:npm|npx)\b/y],
    ['string', /\b(?:install|run)\b/y],
  ],
};

function highlight(code: HTMLElement, language: string) {
  const text = code.textContent ?? '';
  const fragment = document.createDocumentFragment();
  let plain = '';
  let index = 0;
  const flush = () => { if (plain) fragment.append(plain); plain = ''; };
  while (index < text.length) {
    let matched = false;
    for (const [kind, pattern] of rules[language]) {
      pattern.lastIndex = index;
      const match = pattern.exec(text);
      if (!match || !match[0]) continue;
      flush();
      const span = document.createElement('span');
      span.className = `tok-${kind}`;
      span.textContent = match[0];
      fragment.append(span);
      index += match[0].length;
      matched = true;
      break;
    }
    if (!matched) plain += text[index++];
  }
  flush();
  code.replaceChildren(fragment);
}

export function highlightCodeSamples() {
  for (const code of document.querySelectorAll<HTMLElement>('code[data-lang]')) {
    if (code.dataset.lang && code.dataset.lang in rules) highlight(code, code.dataset.lang);
  }
}
