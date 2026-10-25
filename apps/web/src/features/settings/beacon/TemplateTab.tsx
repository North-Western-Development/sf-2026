import { useEffect, useState } from 'react';
import { Button, Input } from '@subspace/ui';
import { http } from '../../../lib/http';
import { term } from '../../../lib/strings';
import { formatFullDate } from '../../../lib/time';
import { copyText } from '../../../lib/clipboard';
import { confirmAction, toast } from '../../../app/ui';
import { SettingsTitle, SettingsSection, Field, RowButton } from '../SettingsLayout';

interface Template {
  code: string;
  name: string;
  description: string | null;
  usageCount: number;
  updatedAt: string;
}

/** Discord's Server Template: share this beacon's layout (never its members or transmissions). */
export function TemplateTab({ beaconId }: { beaconId: string }) {
  const [template, setTemplate] = useState<Template | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    http.get<{ template: Template | null }>(`/beacons/${beaconId}/template`).then((r) => {
      setTemplate(r.template);
      setName(r.template?.name ?? '');
      setDescription(r.template?.description ?? '');
    });
  }, [beaconId]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const link = template ? `${window.location.origin}/template/${template.code}` : '';
  if (template === undefined) return <SettingsTitle>{term('beacon')} Template</SettingsTitle>;

  return (
    <>
      <SettingsTitle>{term('beacon')} Template</SettingsTitle>
      <p className="-mt-4 mb-6 text-sm text-fg-muted">
        A template copies your {term('relay', true).toLowerCase()}, {term('band', true).toLowerCase()}, {term('clearance', true).toLowerCase()} and settings so anyone can start a {term('beacon').toLowerCase()} from it. It never
        includes members or transmissions.
      </p>
      {template && (
        <SettingsSection id="link" title="Template Link">
          <div className="flex gap-2">
            <Input aria-label="Template link" readOnly value={link} />
            <RowButton onClick={() => void copyText(link, 'Link copied')}>Copy</RowButton>
          </div>
          <p className="mt-2 text-sm text-fg-muted">
            Used {template.usageCount} time{template.usageCount === 1 ? '' : 's'} · Last synced {formatFullDate(template.updatedAt)}
          </p>
        </SettingsSection>
      )}
      <SettingsSection id="details" title={template ? 'Template Details' : 'Create a Template'}>
        <Field label="Template Title">
          <Input aria-label="Template title" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Who is this template for?" />
        </Field>
        <Field label="Template Description">
          <Input aria-label="Template description" value={description} maxLength={120} onChange={(e) => setDescription(e.target.value)} placeholder="What can people do in this beacon?" />
        </Field>
        <div className="flex flex-wrap gap-2">
          {template ? (
            <>
              <Button disabled={busy || !name.trim()} onClick={() => void run(async () => setTemplate((await http.patch<{ template: Template }>(`/beacons/${beaconId}/template`, { name, description: description || null })).template))}>
                Save
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void run(async () => {
                setTemplate((await http.put<{ template: Template }>(`/beacons/${beaconId}/template/sync`)).template);
                toast('Template synced', 'success');
              })}>
                Sync Template
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  confirmAction({
                    title: 'Delete Template',
                    body: 'The link stops working. Beacons already made from it are not affected.',
                    confirmLabel: 'Delete Template',
                    danger: true,
                    onConfirm: async () => {
                      await http.delete(`/beacons/${beaconId}/template`);
                      setTemplate(null);
                    },
                  })
                }
              >
                Delete Template
              </Button>
            </>
          ) : (
            <Button disabled={busy || !name.trim()} onClick={() => void run(async () => setTemplate((await http.post<{ template: Template }>(`/beacons/${beaconId}/template`, { name, description: description || null })).template))}>
              Generate Template
            </Button>
          )}
        </div>
      </SettingsSection>
    </>
  );
}
