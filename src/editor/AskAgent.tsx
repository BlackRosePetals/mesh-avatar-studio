import { useState } from 'react';
import { readPreference, savePreference } from './preferences';
import { useI18n } from './i18n';
import { CopyButton } from './CopyButton';
import { revealRepository, type VariantGroup } from './project';

export function AskAgent({ rootPath, projectPath, target = ['eyes', 'mouth'], newProject = false, readOnlySource }: {
  rootPath?: string; projectPath?: string; target?: VariantGroup[]; newProject?: boolean; readOnlySource?: string;
}) {
  const { t, locale } = useI18n();
  const [recipient, setRecipient] = useState(() => readPreference('mesh-avatar-agent-recipient') === 'claude' ? 'claude' : 'codex');
  const [revealError, setRevealError] = useState(false);
  const reveal = async () => {
    try { await revealRepository(); setRevealError(false); }
    catch { setRevealError(true); }
  };
  const agent = newProject || recipient === 'codex' ? 'Codex' : 'Claude Code';
  const path = projectPath ?? 'projects/my-avatar';
  const prompt = (readOnlySource ? t.agentCopySample.replace('SOURCE', readOnlySource).replace('PROJECT', path) : '') + (newProject ? t.agentNewPrompt : recipient === 'codex' ? t.agentCodexPrompt : t.agentClaudePrompt).replace('PROJECT', path).replace('TARGET', new Intl.ListFormat(locale).format(target.map(group => ({ eyes: t.agentEyes, expression: t.agentExpression, mouth: t.agentMouth })[group])));
  return <section className="ask-agent" data-testid={newProject ? 'ask-agent-new' : 'ask-agent-variants'} aria-label={t.askAgent}>
    <p className="agent-instruction">{t.agentInstruction.replace('AGENT', agent)}</p>
    {rootPath ? <div className="agent-folder-actions"><CopyButton value={rootPath} label={t.copyFolderPath} /><button type="button" onClick={() => { void reveal(); }}>{t.showFolder}</button></div> : <p className="workflow-note">{t.rootUnavailable}</p>}
    {revealError && <p role="alert">{t.revealError}</p>}
    {!newProject && <><div className="agent-recipient" role="group" aria-label={t.agentRecipient}>
      {(['codex', 'claude'] as const).map(value => <button key={value} type="button" aria-pressed={recipient === value} onClick={() => { setRecipient(value); savePreference('mesh-avatar-agent-recipient', value); }}>{value === 'codex' ? 'Codex' : 'Claude Code'}</button>)}
    </div>{recipient === 'codex' && <p className="agent-disclosure">{t.agentDisclosure}</p>}</>}
    <textarea aria-label={t.copyPrompt} readOnly value={prompt} rows={4} />
    <CopyButton value={prompt} label={t.copyPrompt} />
  </section>;
}
