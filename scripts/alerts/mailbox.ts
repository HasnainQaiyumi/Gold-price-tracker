/**
 * Keeps only the latest gold email: after a new one is sent, older ones from this job are moved to
 * Gmail's Trash (recoverable for 30 days). Uses the same Gmail app password over IMAP.
 * Safety: only messages whose Message-ID carries our marker (see isOurUpdate) are touched.
 */
import { ImapFlow } from 'imapflow';
import { isOurUpdate, THREAD_SUBJECT } from '../../src/lib/alertMessages';

export async function trashOlderUpdates(user: string, pass: string, keepMessageId: string): Promise<number> {
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  await client.connect();
  try {
    const boxes = await client.list();
    const all = boxes.find((b) => b.specialUse === '\\All')?.path ?? '[Gmail]/All Mail';
    const trash = boxes.find((b) => b.specialUse === '\\Trash')?.path ?? '[Gmail]/Trash';
    const lock = await client.getMailboxLock(all);
    try {
      const uids = await client.search({ gmraw: `from:me subject:"${THREAD_SUBJECT}" -in:trash` }, { uid: true });
      if (!uids || !uids.length) return 0;
      const old: number[] = [];
      for await (const m of client.fetch(uids, { envelope: true }, { uid: true })) {
        const id = m.envelope?.messageId;
        if (isOurUpdate(id) && id !== keepMessageId) old.push(m.uid);
      }
      if (old.length) await client.messageMove(old, trash, { uid: true });
      return old.length;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}
