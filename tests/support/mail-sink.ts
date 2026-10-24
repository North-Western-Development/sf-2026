import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';

/** Where the browser suite's SMTP sink writes each email (one JSON file per message). */
export const UI_MAIL_DIR = path.join(os.tmpdir(), 'subspace-ui-mail');

export interface CapturedMail {
  to: string[];
  from: string;
  subject: string;
  text: string;
  html: string;
  at: string;
}

/**
 * A local SMTP server that accepts everything and keeps it: in memory, and (if `dir` is
 * given) as one JSON file per message so other processes, such as Playwright workers, can
 * read it.
 */
export async function startMailSink(port = 0, dir?: string) {
  const inbox: CapturedMail[] = [];
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onData(stream, session, callback) {
      simpleParser(stream)
        .then((parsed) => {
          const mail: CapturedMail = {
            to: (session.envelope.rcptTo || []).map((r) => r.address.toLowerCase()),
            from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
            subject: parsed.subject || '',
            text: parsed.text || '',
            html: typeof parsed.html === 'string' ? parsed.html : '',
            at: new Date().toISOString(),
          };
          inbox.push(mail);
          if (dir) fs.writeFileSync(path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.json`), JSON.stringify(mail));
          callback();
        })
        .catch(callback);
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const address = server.server.address() as { port: number };
  return {
    port: address.port,
    inbox,
    /** Wait for a message to `to` matching `subject`. */
    async waitFor(to: string, subject: RegExp, timeoutMs = 10_000): Promise<CapturedMail> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = inbox.find((m) => m.to.includes(to.toLowerCase()) && subject.test(m.subject));
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error(`No email to ${to} matching ${subject}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Read mail written by a sink in another process (see `dir` above); `since` skips older mail. */
export async function waitForMailFile(dir: string, to: string, subject: RegExp, { since = 0, timeoutMs = 15_000 } = {}): Promise<CapturedMail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).sort().reverse() : [];
    for (const f of files) {
      try {
        const mail = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as CapturedMail;
        if (mail.to.includes(to.toLowerCase()) && subject.test(mail.subject) && Date.parse(mail.at) >= since) return mail;
      } catch {
        /* being written */
      }
    }
    if (Date.now() > deadline) throw new Error(`No email to ${to} matching ${subject}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
