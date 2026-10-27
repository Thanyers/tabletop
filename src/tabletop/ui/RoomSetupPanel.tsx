import { useState } from 'react';
import './room-setup.css';

/**
 * F080 / D-049: turn a table into a collaboration room.
 *
 * Until this existed the only way to get a room was a `space.create` command sent by hand, so a person
 * could open a room but never make one — which is what blocked the human study. The panel only asks for
 * the two pieces the command needs and reports what the authority said; it never writes state itself.
 */

export interface RoomSetupResult {
  ok: boolean;
  /** The slug the room is addressed by on `/s/:id`, when it was created. */
  spaceId?: string;
  message: string;
}

export interface RoomSetupPanelProps {
  /** Runs `space.create` for this workspace and returns the outcome. */
  createRoom: (input: { spaceId: string; title: string }) => Promise<RoomSetupResult>;
  /** Called after a room exists, so the caller can show it. */
  onCreated?: (spaceId: string) => void;
  defaultTitle?: string;
}

const SLUG = /^[a-z0-9][a-z0-9-]{2,39}$/u;

/** A readable slug from a title: lowercase, hyphens, digits only. */
export function roomSlugFrom(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
  return slug.length >= 3 ? slug : '';
}

export function RoomSetupPanel(props: RoomSetupPanelProps): React.ReactElement {
  const [title, setTitle] = useState(props.defaultTitle ?? '');
  const [slug, setSlug] = useState(() => roomSlugFrom(props.defaultTitle ?? ''));
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RoomSetupResult | undefined>();

  const slugProblem = slug.length === 0
    ? 'Use at least three characters: lowercase letters, digits and hyphens.'
    : SLUG.test(slug) ? '' : 'Use 3 to 40 lowercase letters, digits or hyphens, starting with a letter or digit.';

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || slugProblem || title.trim().length === 0) return;
    setBusy(true);
    try {
      const outcome = await props.createRoom({ spaceId: slug, title: title.trim() });
      setResult(outcome);
      if (outcome.ok && outcome.spaceId) props.onCreated?.(outcome.spaceId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tt-setup" data-testid="room-setup">
      <h2 className="tt-setup__title">เปิดห้องให้หลายโต๊ะทำงานด้วยกัน</h2>
      <p className="tt-setup__hint">
        ห้องคือที่ที่โต๊ะหลายตัวมารวมกัน: คนในห้องอ่านข้อมูลที่โต๊ะต้นทางให้สิทธิ์ และใช้เครื่องมือของห้องได้
      </p>
      <form className="tt-setup__form" onSubmit={submit}>
        <label className="tt-setup__field">
          ชื่อห้อง
          <input
            data-testid="room-setup-title"
            value={title}
            onChange={event => {
              const nextTitle = event.target.value;
              setTitle(nextTitle);
              if (!slugEdited) setSlug(roomSlugFrom(nextTitle));
            }}
            maxLength={80}
            required
          />
        </label>
        <label className="tt-setup__field">
          ที่อยู่ของห้อง (/s/…)
          <input
            data-testid="room-setup-slug"
            value={slug}
            onChange={event => { setSlugEdited(true); setSlug(event.target.value.toLowerCase()); }}
            maxLength={40}
            aria-describedby="room-setup-slug-problem"
            required
          />
        </label>
        {slugProblem && slug.length > 0 ? (
          <p className="tt-setup__problem" id="room-setup-slug-problem" role="status" data-testid="room-setup-problem">
            {slugProblem}
          </p>
        ) : null}
        <button type="submit" className="tt-setup__submit" data-testid="room-setup-submit" disabled={busy || Boolean(slugProblem) || title.trim().length === 0}>
          {busy ? 'กำลังสร้างห้อง…' : 'สร้างห้อง'}
        </button>
      </form>
      {result ? (
        <p
          className={result.ok ? 'tt-setup__ok' : 'tt-setup__problem'}
          role="status"
          data-testid="room-setup-result"
        >
          {result.message}
        </p>
      ) : null}
    </section>
  );
}
