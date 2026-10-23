import { MessageCircleQuestion, Pencil } from 'lucide-react';
import type { ChatCardReference } from './canvas-object-finder';
import { referenceCardInChat } from './canvas-object-finder';

type RuleKind = NonNullable<ChatCardReference['rule']>['kind'];

export function RuleChatActions({
  kind,
  id,
  title,
  detail,
  canEdit = false,
  onEdit,
}: {
  kind: RuleKind;
  id: string;
  title: string;
  detail: string;
  canEdit?: boolean;
  onEdit?: (prompt?: string) => void;
}) {
  const reference = () => referenceCardInChat({
    id: `rule:${kind}:${id}`,
    title,
    detail,
    rule: { kind, id },
  });

  const ask = () => { reference(); };
  const change = () => {
    reference();
    onEdit?.('Change this rule');
  };

  return <div className="tt-rule-chat-actions" aria-label={`Chat about ${title}`}>
    {canEdit && onEdit && <button type="button" className="tt-button tt-button--primary tt-rule-chat-actions__change" onClick={change}><Pencil size={13} aria-hidden="true" />Change this rule</button>}
    <button type="button" className="tt-button tt-button--quiet tt-rule-chat-actions__ask" onClick={ask}><MessageCircleQuestion size={13} aria-hidden="true" />Ask</button>
  </div>;
}
