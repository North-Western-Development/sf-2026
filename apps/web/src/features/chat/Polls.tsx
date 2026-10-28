import { useState } from 'react';
import { clsx } from 'clsx';
import { Check, Plus, Trash2, Vote } from 'lucide-react';
import { Button, Input, Modal } from '@subspace/ui';
import { http } from '../../lib/http';
import { closeModal, toast } from '../../app/ui';
import { parseChannelKey, type ChannelKey, type Poll, type Transmission } from '../../lib/types';
import { patchMessage, useStore } from '../../data/store';
import { sendMessage } from '../../data/actions';

const DURATIONS: Array<[number, string]> = [
  [1, '1 hour'],
  [4, '4 hours'],
  [8, '8 hours'],
  [24, '24 hours'],
  [72, '3 days'],
  [168, '1 week'],
  [336, '2 weeks'],
];

/** Composer › Create Poll (Discord's): a question, up to 10 answers, how long, one or many. */
export function CreatePollModal({ channelKey }: { channelKey: ChannelKey }) {
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState(['', '']);
  const [hours, setHours] = useState(24);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);
  const filled = answers.map((a) => a.trim()).filter(Boolean);
  const post = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await sendMessage(channelKey, '', { poll: { question: question.trim(), answers: filled.map((text) => ({ text })), durationHours: hours, allowMultiselect: multi } });
      closeModal();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen onClose={closeModal} title="Create a Poll" maxWidth="md">
      <form onSubmit={post} className="space-y-4">
        <Input label="Question" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} placeholder="What should we play tonight?" autoFocus required />
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-bold uppercase text-fg-muted">Answers</legend>
          {answers.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label={`Answer ${i + 1}`} value={a} maxLength={55} placeholder="Type your answer" onChange={(e) => setAnswers(answers.map((x, j) => (j === i ? e.target.value : x)))} />
              {answers.length > 1 && (
                <button type="button" aria-label={`Remove answer ${i + 1}`} onClick={() => setAnswers(answers.filter((_, j) => j !== i))} className="text-fg-subtle hover:text-danger">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {answers.length < 10 && (
            <button type="button" onClick={() => setAnswers([...answers, ''])} className="flex items-center gap-1 text-sm font-medium text-brand-sky hover:underline">
              <Plus className="h-4 w-4" /> Add another answer
            </button>
          )}
        </fieldset>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-fg">
            Duration
            <select aria-label="Duration" value={hours} onChange={(e) => setHours(Number(e.target.value))} className="h-8 rounded-md border border-line bg-void px-2 text-sm text-fg">
              {DURATIONS.map(([h, label]) => (
                <option key={h} value={h}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
            Allow multiple answers
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="link" className="text-fg" onClick={closeModal}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} disabled={!question.trim() || filled.length < 1}>
            Post
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function timeLeft(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Poll closed';
  const h = Math.floor(ms / 3_600_000);
  return h >= 24 ? `${Math.floor(h / 24)}d left` : h >= 1 ? `${h}h left` : `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}

/** A poll in a transmission: vote, change your vote, and see the results once you have voted or it ended. */
export function PollCard({ m, channelKey }: { m: Transmission; channelKey: ChannelKey }) {
  const poll = m.poll!;
  const meId = useStore((s) => s.me?.id);
  const [picked, setPicked] = useState<number[]>(poll.myVotes);
  const [busy, setBusy] = useState(false);
  const voted = poll.myVotes.length > 0;
  const showResults = voted || poll.ended;
  const { type, id } = parseChannelKey(channelKey);
  const base = `/channels/${type}/${id}/transmissions/${m.id}/poll`;
  const apply = (next: Poll) => patchMessage(channelKey, m.id, { poll: next });

  const vote = async (answerIds: number[]) => {
    setBusy(true);
    try {
      apply((await http.put<{ poll: Poll }>(`${base}/votes`, { answerIds })).poll);
      setPicked(answerIds);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const end = async () => {
    try {
      apply((await http.post<{ poll: Poll }>(`${base}/end`)).poll);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const toggle = (answerId: number) => {
    if (showResults) return;
    if (!poll.allowMultiselect) return void vote([answerId]);
    setPicked((p) => (p.includes(answerId) ? p.filter((x) => x !== answerId) : [...p, answerId]));
  };
  const top = Math.max(1, ...poll.answers.map((a) => a.votes));

  return (
    <section aria-label={`Poll: ${poll.question}`} className="mt-1 w-full max-w-[460px] rounded-lg border border-line bg-raised p-4">
      <p className="font-semibold text-fg">{poll.question}</p>
      <p className="mb-3 text-xs text-fg-muted">{poll.allowMultiselect ? 'Select one or more answers' : 'Select one answer'}</p>
      <ul className="space-y-2">
        {poll.answers.map((a) => {
          const mine = poll.myVotes.includes(a.id);
          const pct = poll.totalVoters ? Math.round((a.votes / poll.totalVoters) * 100) : 0;
          return (
            <li key={a.id}>
              <button
                type="button"
                role={poll.allowMultiselect ? 'checkbox' : 'radio'}
                aria-checked={showResults ? mine : picked.includes(a.id)}
                aria-label={a.text}
                disabled={busy || showResults}
                onClick={() => toggle(a.id)}
                className={clsx(
                  'relative flex w-full items-center gap-3 overflow-hidden rounded-md px-3 py-2 text-left text-sm',
                  showResults ? 'bg-void' : 'bg-void hover:bg-hover',
                  (mine || (!showResults && picked.includes(a.id))) && 'ring-2 ring-brand'
                )}
              >
                {showResults && <span aria-hidden className={clsx('absolute inset-y-0 left-0', a.votes === top ? 'bg-brand/30' : 'bg-active')} style={{ width: `${pct}%` }} />}
                <span className="relative min-w-0 flex-1 truncate text-fg">{a.text}</span>
                {showResults && (
                  <span className="relative flex items-center gap-1 text-xs tabular-nums text-fg-muted">
                    {mine && <Check className="h-3.5 w-3.5 text-brand-sky" />}
                    {a.votes} · {pct}%
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <Vote className="h-3.5 w-3.5" />
        <span>
          {poll.totalVoters} {poll.totalVoters === 1 ? 'vote' : 'votes'} · {poll.ended ? 'Poll closed' : timeLeft(poll.expiresAt)}
        </span>
        <span className="ml-auto flex gap-2">
          {!showResults && poll.allowMultiselect && (
            <Button size="sm" disabled={!picked.length || busy} onClick={() => void vote(picked)}>
              Vote
            </Button>
          )}
          {voted && !poll.ended && (
            <Button size="sm" variant="secondary" onClick={() => void vote([])}>
              Remove Vote
            </Button>
          )}
          {!poll.ended && m.author.id === meId && (
            <Button size="sm" variant="secondary" onClick={() => void end()}>
              End Poll
            </Button>
          )}
        </span>
      </div>
    </section>
  );
}

/** POLL_UPDATE: new counts for a poll I can see (my own votes stay as they were). */
export function onPollUpdate(d: { channelType: string; channelId: string; transmissionId: string; counts: Record<string, number>; totalVoters: number; ended: boolean }) {
  const key = `${d.channelType}:${d.channelId}` as ChannelKey;
  patchMessage(key, d.transmissionId, (t) =>
    t.poll ? { poll: { ...t.poll, answers: t.poll.answers.map((a) => ({ ...a, votes: d.counts[a.id] ?? 0 })), totalVoters: d.totalVoters, ended: d.ended } } : {}
  );
}
